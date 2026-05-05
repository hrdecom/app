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
  /** P26-26 — JSON-encoded BirthstoneOption[] (length 12). Birthstone
   * fields look up their image URL here based on the value (month
   * index "1".."12") in `values[fieldId]`. NULL = no library. */
  birthstones_json?: string | null;
}

export interface PreviewField {
  id: number;
  field_kind: 'text' | 'image' | 'birthstone';
  label: string;
  layer_z?: number;
  sort_order?: number;
  default_value?: string | null;
  font_family?: string | null;
  font_size_px?: number | null;
  font_color?: string | null;
  text_align?: string | null;
  letter_spacing?: number | null;
  // FIX 30 v2 — `embrace` is a NEW dedicated curve mode that behaves
  // like arc but ALSO accepts a `curve_tilt_deg` rotation. arc itself
  // is left untouched (no tilt) so the legacy behaviour the merchant
  // already calibrated stays exactly as it was.
  curve_mode?: 'linear' | 'arc' | 'circle' | 'embrace' | null;
  curve_radius_px?: number | null;
  curve_path_d?: string | null;
  // FIX 30 v2 — degrees to rotate the chord around the bbox center.
  // Only honoured when curve_mode === 'embrace'; ignored for arc /
  // circle / linear. Range expected -90..+90 in the UI.
  curve_tilt_deg?: number | null;
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
  // FIX 34 — when truthy, the storefront widget uppercases customer
  // input on the way in AND when posting to the cart. The render
  // doesn't need to do anything: the value the renderer receives is
  // already uppercased upstream. We carry the flag here so the type
  // is consistent across surfaces.
  uppercase_only?: number | null;
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

  // P26-26 — parse the template-level birthstones library once so
  // birthstone fields can look up their image URL by month_index.
  const birthstones = parseBirthstones(template.birthstones_json);

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
    // P26-26 — birthstone fields render exactly like image fields,
    // but the URL is resolved from the template's birthstones library
    // using `value` as the month_index (1-12). If the library is
    // missing the entry or the URL is null, the field renders nothing
    // for this paint (the customer hasn't picked a month with an
    // uploaded icon yet).
    let inner = '';
    if (f.field_kind === 'text') {
      inner = renderTextField(f, value, currentColorValue);
    } else if (f.field_kind === 'image') {
      inner = renderImageField(f, value);
    } else if (f.field_kind === 'birthstone') {
      const monthIdx = parseInt(String(value), 10);
      if (Number.isFinite(monthIdx) && birthstones[monthIdx] && birthstones[monthIdx].image_url) {
        inner = renderImageField(f, birthstones[monthIdx].image_url as string);
      }
    }
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
  // FIX 34 — when the field has uppercase_only, ALL render surfaces
  // (admin canvas preview, storefront live SVG, production-queue PDF)
  // should show the value uppercased. The storefront widget also
  // upstream-uppercases the input + cart property, but doing it here
  // makes the admin canvas preview respect the setting too even when
  // the integrator is just looking at the field's default_value
  // (which may have been entered lowercase in the form).
  if (Number(f.uppercase_only || 0) === 1 && value) {
    value = value.toUpperCase();
  }
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

  // FIX 30 v6 — `embrace` is a SMOOTH CONTINUOUS perspective
  // deformation. The letter (or text) is rendered ONCE inside an SVG
  // foreignObject with CSS 3D perspective + rotateY, so the glyph
  // shape stays continuous (no visible split line) and just appears
  // tilted in 3D — the right side recedes into the page while the
  // left side stays close to the camera (or vice versa for negative
  // tilt). This matches what the merchant means by "se déforme à
  // partir du centre sur elle même".
  //
  // Why CSS 3D and not pure SVG: pure SVG only supports affine
  // (2D) transforms — you can scale, skew, rotate, but not project
  // a 3D rotation onto 2D as a smooth continuous deformation. The
  // closest pure-SVG approximations (per-letter matrix or clipped
  // slices) either look discrete or visibly cut the glyph in half.
  // CSS 3D + foreignObject gets us a real perspective rotation
  // applied to whatever font the browser already renders.
  //
  // tilt range: -89..+89. 45° gives a strong but legible 3D look.
  // 0 = flat (no rotation). The perspective distance is tied to the
  // field width — closer (smaller value) = stronger 3D effect.
  if (f.curve_mode === 'embrace') {
    const tiltDeg = Number(f.curve_tilt_deg || 0);
    // FIX 30 v6 — aggressive perspective so the 3D tilt is clearly
    // visible. width × 1.2 means the vanishing point sits roughly
    // one-and-a-quarter widths in front of the surface — strong
    // foreshortening without clipping the rotated content.
    const perspective = Math.max(150, f.width * 1.2);
    const lsCss = lsRaw != null && Number.isFinite(lsRaw) && lsRaw !== 0
      ? `letter-spacing:${lsRaw}px;`
      : '';
    // FIX 37 — reduced horizontal padding (was 0.6 × width). On
    // products with multiple text fields placed near opposite edges
    // of the canvas, padding 60 % of width on each side often pushed
    // the foreignObject's bbox outside the SVG viewBox. WebKit on
    // iOS silently CLIPS foreignObject elements whose bbox extends
    // past the viewBox — that's the root cause of "right letter not
    // rendering on mobile" for engraved rings where Right Letter
    // sits near x = canvas_width. 0.25 × width is enough to absorb
    // the rotated text spillover for tilts up to ~45° while keeping
    // the foreignObject inside any reasonable viewBox.
    const padX = Math.ceil(f.width * 0.25);
    const fox = f.position_x - padX;
    const fow = f.width + padX * 2;
    // FIX 37 — fallback plain-SVG <text> emitted ALONGSIDE the
    // foreignObject. On iOS Safari (and any WebKit browser where
    // foreignObject + CSS 3D fails), the widget strips the
    // foreignObject (FIX 38) and reveals this text instead.
    //
    // FIX 41 — fallback is `visibility="hidden"` BY DEFAULT. On
    // desktop browsers where the foreignObject renders correctly,
    // its 3D-rotated output does NOT pixel-align with the plain
    // <text> (rotateY shifts the visual horizontally + the inner
    // div uses HTML font metrics rather than SVG metrics). If the
    // fallback were visible, the customer would see TWO copies of
    // the letter slightly offset — the embrace 3D version PLUS the
    // flat fallback. Hiding by default eliminates that doubling
    // entirely. The iOS widget post-processor (FIX 40) flips
    // `visibility` to `visible` and applies the rotation transform
    // when stripping the foreignObject.
    const align = (f.text_align as string) || 'middle';
    const anchor = align === 'start' ? 'start' : align === 'end' ? 'end' : 'middle';
    const tx = anchor === 'middle' ? cx : anchor === 'end' ? f.position_x + f.width : f.position_x;
    // FIX 44 — vertically center using a manual y offset instead of
    // dominant-baseline="middle". The foreignObject path uses
    // CSS flexbox `align-items: center` to vertically center the
    // text within the bbox, which puts the BASELINE roughly at
    // bbox_center + fontSize × 0.3 (because most of a font's
    // line-box sits above the baseline). dominant-baseline="middle"
    // in SVG aligns the geometric middle of the lowercase x to the
    // y attribute, leaving capital letters appearing too HIGH —
    // which is exactly what the user reported on iOS where this
    // fallback is visible. By dropping dominant-baseline and
    // shifting y down by 0.32 × fontSize (empirical match for
    // typical Latin fonts), the SVG fallback's baseline lands at
    // the same y-position as the foreignObject's, so iOS sees the
    // letter at the same vertical position as desktop.
    const baselineY = cy + Math.round(fontSize * 0.32);
    const fallbackText =
      `<text x="${tx}" y="${baselineY}" text-anchor="${anchor}" ` +
      `font-family="${family}" ` +
      `font-size="${fontSize}" fill="${fill}"${lsAttr} ` +
      // FIX 41 — hidden by default; iOS widget makes it visible.
      `visibility="hidden" ` +
      // FIX 40 — these data attrs let the iOS widget post-process
      // find each fallback text and apply the right rotation/pivot
      // after stripping the foreignObject.
      `data-rp-embrace-fallback="1" ` +
      `data-rp-embrace-tilt="${tiltDeg.toFixed(2)}" ` +
      `data-rp-embrace-cx="${cx}" ` +
      `data-rp-embrace-cy="${cy}">${text}</text>`;
    const foreignObject =
      `<foreignObject x="${fox}" y="${f.position_y}" width="${fow}" height="${f.height}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" ` +
      `style="perspective:${perspective}px;perspective-origin:center center;` +
      `width:100%;height:100%;display:flex;align-items:center;justify-content:center;` +
      `font-family:${family};font-size:${fontSize}px;color:${fill};${lsCss}line-height:1;">` +
      `<div style="transform:rotateY(${tiltDeg.toFixed(2)}deg);transform-origin:center center;` +
      `transform-style:preserve-3d;backface-visibility:visible;white-space:nowrap;">` +
      `${text}` +
      `</div>` +
      `</div>` +
      `</foreignObject>`;
    return fallbackText + foreignObject;
  }

  if (f.curve_mode === 'circle' || f.curve_mode === 'arc') {
    const pathId = `pp-${f.id}`;
    let pathD: string;
    if (f.curve_path_d) {
      pathD = f.curve_path_d;
    } else if (f.curve_mode === 'circle') {
      const radius = Math.abs(f.curve_radius_px || Math.floor(f.width / 2));
      pathD = circlePath(cx, cy, radius);
    } else {
      // P26-2 — arc as a CHORD through the bbox horizontally. The
      // chord runs along the bbox vertical center from x=position_x
      // to x=position_x+width. The radius controls only how much the
      // arc bulges above (positive) or below (negative) that chord.
      // This is the natural "the text is where the bbox is, curvature
      // is independent" mental model the customer expects.
      // Sagitta s = r - sqrt(r² - (w/2)²) when r ≥ w/2; clamp r
      // upward when too small (chord wouldn't fit in the circle).
      const halfChord = f.width / 2;
      const requested = f.curve_radius_px;
      let r: number;
      if (requested == null || requested === 0) {
        // No curvature → make the radius huge so the arc looks straight.
        r = halfChord * 100;
      } else {
        const minR = halfChord;
        const a = Math.abs(requested);
        r = (a < minR ? minR : a) * (requested < 0 ? -1 : 1);
      }
      const a = Math.abs(r);
      const sweep = r < 0 ? 0 : 1;
      const startX = f.position_x;
      const endX = f.position_x + f.width;
      pathD = `M ${startX} ${cy} A ${a} ${a} 0 0 ${sweep} ${endX} ${cy}`;
    }
    // FIX 30 v3 — arc & circle restored to their original render
    // (no <g> wrapper, no tilt). Embrace handles its own deformation
    // earlier in this function via foreignObject + CSS perspective.
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
 * P26-26 — parse the birthstones_json column on a template. Returns a
 * { month_index: { month_index, label, image_url } } map (1-indexed)
 * for fast lookup. Empty / malformed JSON returns {}.
 */
function parseBirthstones(raw: string | null | undefined): Record<number, { month_index: number; label: string; image_url: string | null }> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const out: Record<number, { month_index: number; label: string; image_url: string | null }> = {};
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const idx = Number(entry.month_index);
      if (!Number.isFinite(idx) || idx < 1 || idx > 12) continue;
      out[idx] = {
        month_index: idx,
        label: typeof entry.label === 'string' ? entry.label : '',
        image_url: typeof entry.image_url === 'string' ? entry.image_url : null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

// P26-2 — arcPath helper removed; arc geometry is now inlined inside
// renderTextField and uses chord-through-bbox positioning instead of
// the old "arc apex offset from bbox center" model.

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
