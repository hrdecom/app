import { requireRole, json, errorJson } from '../../../lib/auth-middleware.js';

const ALLOWED = [
  'label', 'placeholder', 'default_value', 'required', 'max_chars', 'allow_empty',
  'font_family', 'font_size_px', 'font_color', 'text_align', 'letter_spacing',
  'curve_mode', 'curve_radius_px', 'curve_path_d',
  'position_x', 'position_y', 'width', 'height', 'rotation_deg',
  'mask_shape', 'image_max_size_kb', 'layer_z',
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
