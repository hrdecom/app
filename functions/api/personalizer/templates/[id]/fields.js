import { requireRole, json, errorJson } from '../../../../lib/auth-middleware.js';

// P26-26 — 'birthstone' added: storefront renders a compact dropdown
// (12 month icons) plus an SVG image overlay at the field's position;
// see migration 0151_personalizer_birthstones.sql for the matching
// CHECK constraint relaxation.
const VALID_KIND = new Set(['text', 'image', 'birthstone']);
// FIX 30 v2 — `embrace` joins the valid set. It renders like arc but
// supports curve_tilt_deg (chord rotation) for wrapping perspective-
// tilted ring tips. Arc itself stays vanilla / untouched.
const VALID_CURVE = new Set(['linear', 'arc', 'circle', 'embrace']);
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
    if (!VALID_KIND.has(kind)) return errorJson('field_kind must be text, image, or birthstone', 400);
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

    // Pull global defaults so new fields inherit admin-configured values
    // unless the caller supplies explicit overrides.
    const settings = await env.DB
      .prepare(`SELECT * FROM personalizer_settings WHERE id = 1`)
      .first().catch(() => null);

    const fontFamily = body.font_family != null ? body.font_family : (settings?.default_font_family || null);
    const fontSizePx = body.font_size_px != null ? body.font_size_px : (settings?.default_font_size_px || null);
    const fontColor = body.font_color != null ? body.font_color : (settings?.default_font_color || null);
    const maxChars = body.max_chars != null ? body.max_chars : (settings?.default_max_chars || null);

    // P25-6 — visible_variant_options stored as JSON. Accepts an array
    // ["1","2"] or a comma-separated string "1,2" from the admin UI.
    let visibleVariants = body.visible_variant_options;
    if (Array.isArray(visibleVariants)) {
      visibleVariants = JSON.stringify(visibleVariants);
    } else if (typeof visibleVariants === 'string' && visibleVariants.includes(',')) {
      visibleVariants = JSON.stringify(visibleVariants.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (visibleVariants == null) {
      visibleVariants = null;
    }

    // P25-V4 — accept the per-color text color map either as a plain
    // object (preferred — `{ "Gold": "#FAEEDA" }`) or a pre-stringified
    // JSON. Empty / null collapses to NULL. Same defensive coercion we
    // already do for visible_variant_options above.
    let fontColorByValue = body.font_color_by_value_json;
    if (fontColorByValue && typeof fontColorByValue === 'object') {
      fontColorByValue = JSON.stringify(fontColorByValue);
    } else if (typeof fontColorByValue !== 'string' || !fontColorByValue.trim()) {
      fontColorByValue = null;
    }

    const result = await env.DB
      .prepare(
        `INSERT INTO customization_fields
          (template_id, field_kind, sort_order, layer_z,
           label, placeholder, default_value, required, max_chars, allow_empty,
           font_family, font_size_px, font_color, text_align, letter_spacing,
           curve_mode, curve_radius_px, curve_path_d,
           position_x, position_y, width, height, rotation_deg,
           mask_shape, image_max_size_kb, config_json,
           cart_label, visible_variant_options,
           font_color_by_value_json, customer_label, is_info, info_text)
         VALUES (?, ?, ?, ?,  ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?,  ?, ?,  ?, ?, ?, ?)`,
      )
      .bind(
        templateId, kind, nextSort, body.layer_z ?? 10,
        body.label, body.placeholder || null, body.default_value || null,
        body.required ? 1 : 0, maxChars, body.allow_empty ? 1 : 0,
        fontFamily, fontSizePx, fontColor,
        body.text_align || null, body.letter_spacing ?? null,
        body.curve_mode || null, body.curve_radius_px || null, body.curve_path_d || null,
        body.position_x, body.position_y, body.width, body.height, body.rotation_deg ?? 0,
        body.mask_shape || null, body.image_max_size_kb || 5120,
        body.config_json ? JSON.stringify(body.config_json) : null,
        body.cart_label || null, visibleVariants,
        fontColorByValue, body.customer_label || null,
        body.is_info ? 1 : 0, body.info_text || null,
      )
      .run();
    return json({ id: result.meta.last_row_id, sort_order: nextSort, created: true });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Field create error:', e);
    return errorJson('Internal server error', 500);
  }
}
