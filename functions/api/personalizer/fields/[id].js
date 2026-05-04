import { requireRole, json, errorJson } from '../../../lib/auth-middleware.js';

const ALLOWED = [
  'label', 'placeholder', 'default_value', 'required', 'max_chars', 'allow_empty',
  'font_family', 'font_size_px', 'font_color', 'text_align', 'letter_spacing',
  'curve_mode', 'curve_radius_px', 'curve_path_d',
  // FIX 30 — curve_tilt_deg rotates the arc chord around bbox
  // center (degrees). Lets the merchant tilt the curve to match
  // foreshortened ring tips photographed at an angle.
  'curve_tilt_deg',
  'position_x', 'position_y', 'width', 'height', 'rotation_deg',
  'mask_shape', 'image_max_size_kb', 'layer_z',
  // P25-6 — cart_label overrides label for the Shopify cart line item.
  // visible_variant_options is a JSON array of variant option values
  // (e.g. ["2","3","4"]) — NULL means always visible.
  'cart_label', 'visible_variant_options',
  // P25-V4 — per-color text color overrides + customer-facing label +
  // info-only field flag.
  'font_color_by_value_json', 'customer_label', 'is_info', 'info_text',
];

export async function onRequest(context) {
  const { request } = context;
  try {
    if (request.method === 'PATCH') return await handlePatch(context);
    if (request.method === 'DELETE') return await handleDelete(context);
    return errorJson('Method not allowed', 405);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Field [id] error:', e);
    return errorJson('Internal server error', 500);
  }
}

async function handlePatch(context) {
  const { request, params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);

  let body;
  try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }

  const sets = [];
  const binds = [];
  for (const k of ALLOWED) {
    if (k in body) { sets.push(`${k} = ?`); binds.push(coerce(k, body[k])); }
  }
  if (sets.length === 0) return errorJson('No editable fields supplied', 400);
  sets.push(`updated_at = datetime('now')`);
  binds.push(id);

  await env.DB
    .prepare(`UPDATE customization_fields SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  return json({ success: true, id });
}

async function handleDelete(context) {
  const { params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);
  await env.DB.prepare(`DELETE FROM customization_fields WHERE id = ?`).bind(id).run();
  return json({ success: true, id, deleted: true });
}

function coerce(k, v) {
  if (['required', 'allow_empty'].includes(k)) return v ? 1 : 0;
  return v;
}
