import { requireRole, json, errorJson } from '../../../../lib/auth-middleware.js';

const VALID_KIND = new Set(['text', 'image']);
const VALID_CURVE = new Set(['linear', 'arc', 'circle']);
const VALID_MASK = new Set(['rect', 'circle', 'heart']);

export async function onRequestPost(context) {
  try {
    await requireRole(context, 'admin', 'integrator');
    const { request, params, env } = context;
    const templateId = parseInt(params.id);
    if (isNaN(templateId)) return errorJson('Invalid template id', 400);

    let body;
    try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }

    const kind = body.field_kind;
    if (!VALID_KIND.has(kind)) return errorJson('field_kind must be text or image', 400);
    if (!body.label) return errorJson('label is required', 400);
    if (typeof body.position_x !== 'number' || typeof body.position_y !== 'number') {
      return errorJson('position_x and position_y are required numbers', 400);
    }
    if (typeof body.width !== 'number' || typeof body.height !== 'number') {
      return errorJson('width and height are required numbers', 400);
    }
    if (body.curve_mode && !VALID_CURVE.has(body.curve_mode)) {
      return errorJson('curve_mode must be linear, arc, or circle', 400);
    }
    if (body.mask_shape && !VALID_MASK.has(body.mask_shape)) {
      return errorJson('mask_shape must be rect, circle, or heart', 400);
    }

    // Append to end by default — caller can reorder later.
    const maxRow = await env.DB
      .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM customization_fields WHERE template_id = ?`)
      .bind(templateId).first();
    const nextSort = (maxRow?.m ?? -1) + 1;

    const result = await env.DB
      .prepare(
        `INSERT INTO customization_fields
          (template_id, field_kind, sort_order, layer_z,
           label, placeholder, default_value, required, max_chars, allow_empty,
           font_family, font_size_px, font_color, text_align, letter_spacing,
           curve_mode, curve_radius_px, curve_path_d,
           position_x, position_y, width, height, rotation_deg,
           mask_shape, image_max_size_kb, config_json)
         VALUES (?, ?, ?, ?,  ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?)`,
      )
      .bind(
        templateId, kind, nextSort, body.layer_z ?? 10,
        body.label, body.placeholder || null, body.default_value || null,
        body.required ? 1 : 0, body.max_chars || null, body.allow_empty ? 1 : 0,
        body.font_family || null, body.font_size_px || null, body.font_color || null,
        body.text_align || null, body.letter_spacing ?? null,
        body.curve_mode || null, body.curve_radius_px || null, body.curve_path_d || null,
        body.position_x, body.position_y, body.width, body.height, body.rotation_deg ?? 0,
        body.mask_shape || null, body.image_max_size_kb || 5120,
        body.config_json ? JSON.stringify(body.config_json) : null,
      )
      .run();
    return json({ id: result.meta.last_row_id, sort_order: nextSort, created: true });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Field create error:', e);
    return errorJson('Internal server error', 500);
  }
}
