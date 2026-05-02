/**
 * Pure SVG render for the personalizer live preview. Used in three
 * places: the storefront widget (every keystroke), the admin Live
 * Preview component (admin's draft values), and the production-queue
 * print PDF (final order spec).
 *
 * Output is a string of SVG markup. The caller decides what to do with
 * it (insert via innerHTML, serialize to PDF, etc.).
 *
 * No DOM access here — the function must run in Workers, Node (tests),
 * and browsers identically.
 */

export interface PreviewTemplate {
  canvas_width: number;
  canvas_height: number;
  base_image_url?: string | null;
  /** P25-4 — z-index where the product image sits in the layer stack.
   * Fields with `layer_z < base_image_layer_z` render UNDER the image
   * (useful for transparent-window products where a customer photo
   * shows through). Fields with `layer_z >= base_image_layer_z` render
   * on top (default behaviour). Defaults to 5 so admins can place
   * fields anywhere in [0, 10]. */
  base_image_layer_z?: number | null;
}

export interface PreviewField {
  id: number;
  field_kind: 'text' | 'image';
  label: string;
  layer_z?: number;
  sort_order?: number;
  default_value?: string | null;
  font_family?: string | null;
  font_size_px?: number | null;
  font_color?: string | null;
  text_align?: string | null;
  letter_spacing?: number | null;
  curve_mode?: 'linear' | 'arc' | 'circle' | null;
  curve_radius_px?: number | null;
  curve_path_d?: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  rotation_deg?: number | null;
  mask_shape?: 'rect' | 'circle' | 'heart' | null;
  /** P25-V4 — JSON map { variantValue: hexColor } of per-variant-value
   * text color overrides. Looked up case-insensitively against the
   * caller-supplied `currentColorValue` at render time. */
  font_color_by_value_json?: string | null;
}

export interface RenderOptions {
  template: PreviewTemplate;
  fields: PreviewField[];
  values: Record<string | number, string>;
  /** P25-V4 — current variant's color value (e.g. "Gold"). When a
   * field has `font_color_by_value_json` and this matches a key, the
   * mapped hex is used instead of the field's `font_color`. Optional
   * for backward compatibility — older callers omit it and get the
   * regular `font_color`. */
  currentColorValue?: string | null;
}

export function renderPreviewSvg(opts: RenderOptions): string {
  const { template, fields, values, currentColorValue } = opts;
  const w = template.canvas_width || 1080;
  const h = template.canvas_height || 1080;
  const baseZ = template.base_image_layer_z ?? 5;
  const ordered = [...fields].sort((a, b) => (a.layer_z ?? 10) - (b.layer_z ?? 10));

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">`);

  // P25-4 — render fields in z-order with the base image inserted at
  // its configured z slot. Fields with layer_z < baseZ render BEFORE
  // (i.e. behind) the image; fields with layer_z >= baseZ render AFTER
  // (on top of) the image. SVG paint order = document order, so the
  // last drawn element wins.
  let baseDrawn = false;
  for (const f of ordered) {
    const fz = f.layer_z ?? 10;
    if (!baseDrawn && fz >= baseZ && template.base_image_url) {
      parts.push(`<image href="${escapeAttr(template.base_image_url)}" x="0" y="0" width="${w}" height="${h}" />`);
      baseDrawn = true;
    }
    const raw = values[f.id] ?? values[String(f.id)];
    const value = (raw == null || raw === '') ? (f.default_value || '') : raw;
    if (!value) continue;
    // P25-V4 — wrap each field in a rotation <g> when rotation_deg is
    // non-zero. We rotate around the bbox CENTER so the field stays in
    // place visually as the user dials in the angle.
    const rotation = Number(f.rotation_deg) || 0;
    const cx = f.position_x + Math.floor(f.width / 2);
    const cy = f.position_y + Math.floor(f.height / 2);
    const inner =
      f.field_kind === 'text'
        ? renderTextField(f, value, currentColorValue)
        : f.field_kind === 'image'
          ? renderImageField(f, value)
          : '';
    if (!inner) continue;
    if (rotation !== 0) {
      parts.push(`<g transform="rotate(${rotation} ${cx} ${cy})">${inner}</g>`);
    } else {
      parts.push(inner);
    }
  }
  // Edge case: all fields have layer_z < baseZ → image still needs to
  // be drawn last (on top). Or no fields at all but we have an image.
  if (!baseDrawn && template.base_image_url) {
    parts.push(`<image href="${escapeAttr(template.base_image_url)}" x="0" y="0" width="${w}" height="${h}" />`);
  }

  parts.push('</svg>');
  return parts.join('');
}

export function autoShrinkFontSize(
  text: string,
  requestedPx: number,
  boxWidthPx: number,
  floorPx: number,
): number {
  // Coarse approximation: 1 char ≈ 0.5 × font-size. Good enough for
  // serif italic. The real fit happens client-side via getBBox, but for
  // server-side preview / PDF we use this estimator.
  const approxWidth = text.length * requestedPx * 0.5;
  if (approxWidth <= boxWidthPx) return requestedPx;
  const scaled = Math.floor((boxWidthPx / Math.max(text.length, 1)) / 0.5);
  return Math.max(scaled, floorPx);
}

function renderTextField(f: PreviewField, value: string, currentColorValue?: string | null): string {
  const fontSize = autoShrinkFontSize(value, f.font_size_px || 22, f.width, 12);
  // P25-V4 — per-variant-value color override. When the field has a
  // `font_color_by_value_json` map AND the caller supplied a current
  // color value, look it up case-insensitively. Hit = use that hex;
  // miss / no map / no caller value = fall back to the field's
  // base `font_color`. Backward compatible: older callers omit
  // currentColorValue and get the original behaviour.
  let effectiveColor = f.font_color;
  if (f.font_color_by_value_json && currentColorValue) {
    const map = parseFontColorMap(f.font_color_by_value_json);
    const needle = String(currentColorValue).toLowerCase();
    for (const [k, v] of Object.entries(map)) {
      if (k.toLowerCase() === needle) { effectiveColor = v; break; }
    }
  }
  const fill = escapeAttr(normalizeColor(effectiveColor));
  const family = escapeAttr(f.font_family || 'serif');
  const cx = f.position_x + Math.floor(f.width / 2);
  const cy = f.position_y + Math.floor(f.height / 2);
  const text = escapeText(value);
  // P25-V2 — letter_spacing is now stored & rendered in user-space PX
  // (the same unit as positions/widths). SVG's `letter-spacing` attribute
  // accepts unitless numbers in the surrounding coordinate system, so we
  // just emit the raw value when set. Skipped when 0/null to keep the
  // markup clean.
  const lsRaw = f.letter_spacing;
  const lsAttr =
    lsRaw != null && Number.isFinite(lsRaw) && lsRaw !== 0
      ? ` letter-spacing="${lsRaw}"`
      : '';

  if (f.curve_mode === 'circle' || f.curve_mode === 'arc') {
    const radius = f.curve_radius_px || Math.floor(f.width / 2);
    const pathId = `pp-${f.id}`;
    const pathD =
      f.curve_path_d ||
      (f.curve_mode === 'circle'
        ? circlePath(cx, cy, radius)
        : arcPath(cx, cy, radius));
    return (
      `<defs><path id="${pathId}" d="${pathD}" /></defs>` +
      `<text font-family="${family}" font-size="${fontSize}" fill="${fill}"${lsAttr}>` +
      `<textPath href="#${pathId}" startOffset="50%" text-anchor="middle">${text}</textPath>` +
      `</text>`
    );
  }

  const align = (f.text_align as string) || 'middle';
  const anchor = align === 'start' ? 'start' : align === 'end' ? 'end' : 'middle';
  const x = anchor === 'middle' ? cx : anchor === 'end' ? f.position_x + f.width : f.position_x;
  return (
    `<text x="${x}" y="${cy + Math.floor(fontSize / 3)}" ` +
    `text-anchor="${anchor}" ` +
    `font-family="${family}" font-size="${fontSize}" fill="${fill}"${lsAttr}>` +
    `${text}</text>`
  );
}

function renderImageField(f: PreviewField, url: string): string {
  const safeUrl = escapeAttr(url);
  if (f.mask_shape === 'circle') {
    const cx = f.position_x + Math.floor(f.width / 2);
    const cy = f.position_y + Math.floor(f.height / 2);
    const r = Math.floor(Math.min(f.width, f.height) / 2);
    const clipId = `pp-clip-${f.id}`;
    return (
      `<defs><clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r}" /></clipPath></defs>` +
      `<image href="${safeUrl}" x="${f.position_x}" y="${f.position_y}" width="${f.width}" height="${f.height}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice" />`
    );
  }
  return `<image href="${safeUrl}" x="${f.position_x}" y="${f.position_y}" width="${f.width}" height="${f.height}" preserveAspectRatio="xMidYMid slice" />`;
}

function circlePath(cx: number, cy: number, r: number): string {
  const a = Math.abs(r);
  return `M ${cx - a} ${cy} A ${a} ${a} 0 1 1 ${cx + a} ${cy} A ${a} ${a} 0 1 1 ${cx - a} ${cy} Z`;
}

/**
 * P26 — signed radius. Positive r = arc curves UP (text reads on top
 * of the arc). Negative r = arc curves DOWN (text rolls underneath,
 * useful for the bottom rim of round pendants). Magnitude controls
 * how tight: small |r| = tight curl, large |r| = nearly flat.
 */
function arcPath(cx: number, cy: number, r: number): string {
  const a = Math.abs(r);
  // SVG sweep-flag with default Y-down: 1 = clockwise from start to end.
  // From left (cx-a, cy) to right (cx+a, cy) clockwise = arc bulges UP.
  // sweep=0 = counter-clockwise = arc bulges DOWN.
  const sweep = r < 0 ? 0 : 1;
  return `M ${cx - a} ${cy} A ${a} ${a} 0 0 ${sweep} ${cx + a} ${cy}`;
}

function escapeAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Normalize a CSS color value to something the browser will actually
 * paint. Catches the common admin-input bug of an off-by-one hex char
 * (e.g. "#FFFFF" with 5 F's instead of 6) — a malformed hex renders
 * transparent/black-default on most browsers, leaving the engraving
 * invisible on the storefront. Accepts:
 *   - "#abc"     → "#aabbcc"
 *   - "#abcd"    → "#aabbccdd"
 *   - "#aabbcc"  → as-is
 *   - "#aabbccdd"→ as-is
 *   - 5- or 7-char hex (typo) → padded with the last char
 *   - non-hex    → returned as-is so CSS color names (e.g. "white") still work
 */
function normalizeColor(raw: string | null | undefined): string {
  const s = String(raw || '').trim();
  if (!s) return '#000000';
  if (s.startsWith('#')) {
    const body = s.slice(1);
    if (/^[0-9a-fA-F]+$/.test(body)) {
      if (body.length === 3 || body.length === 4) {
        // Expand short form: #abc → #aabbcc, #abcd → #aabbccdd
        return '#' + body.split('').map((c) => c + c).join('');
      }
      if (body.length === 6 || body.length === 8) return s;
      // Off-by-one (5 or 7) — pad with last char so the user's intent
      // ("close to white") still renders. 5→6 and 7→8 keep the alpha
      // chunk reasonable. Better: return a visible color than nothing.
      if (body.length === 5 || body.length === 7) return '#' + body + body[body.length - 1];
      // Fallback: return as-is and let the browser deal.
      return s;
    }
  }
  return s;
}

function escapeText(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * P25-V4 — parse the font_color_by_value_json column. Returns an
 * empty object on null/missing/malformed so callers can iterate
 * without guarding. Values must be strings; non-string entries are
 * dropped (defensive against admin-typo'd JSON).
 */
function parseFontColorMap(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v) out[k] = v;
      }
      return out;
    }
  } catch {
    /* ignore malformed */
  }
  return {};
}
