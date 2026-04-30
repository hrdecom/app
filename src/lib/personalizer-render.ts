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
}

export function renderPreviewSvg(opts: {
  template: PreviewTemplate;
  fields: PreviewField[];
  values: Record<string | number, string>;
}): string {
  const { template, fields, values } = opts;
  const w = template.canvas_width || 1080;
  const h = template.canvas_height || 1080;
  const ordered = [...fields].sort((a, b) => (a.layer_z ?? 10) - (b.layer_z ?? 10));

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">`);
  if (template.base_image_url) {
    parts.push(`<image href="${escapeAttr(template.base_image_url)}" x="0" y="0" width="${w}" height="${h}" />`);
  }

  for (const f of ordered) {
    const raw = values[f.id] ?? values[String(f.id)];
    const value = (raw == null || raw === '') ? (f.default_value || '') : raw;
    if (!value) continue;

    if (f.field_kind === 'text') {
      parts.push(renderTextField(f, value));
    } else if (f.field_kind === 'image') {
      parts.push(renderImageField(f, value));
    }
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

function renderTextField(f: PreviewField, value: string): string {
  const fontSize = autoShrinkFontSize(value, f.font_size_px || 22, f.width, 12);
  const fill = escapeAttr(f.font_color || '#000000');
  const family = escapeAttr(f.font_family || 'serif');
  const cx = f.position_x + Math.floor(f.width / 2);
  const cy = f.position_y + Math.floor(f.height / 2);
  const text = escapeText(value);

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
      `<text font-family="${family}" font-size="${fontSize}" fill="${fill}">` +
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
    `font-family="${family}" font-size="${fontSize}" fill="${fill}">` +
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
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
}

function arcPath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
}

function escapeAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeText(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
