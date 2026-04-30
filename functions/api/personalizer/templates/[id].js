import { requireRole, json, errorJson } from '../../../lib/auth-middleware.js';

export async function onRequest(context) {
  const { request } = context;
  try {
    if (request.method === 'GET') return await handleGet(context);
    if (request.method === 'PATCH') return await handlePatch(context);
    if (request.method === 'DELETE') return await handleDelete(context);
    return errorJson('Method not allowed', 405);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Template [id] error:', e);
    return errorJson('Internal server error', 500);
  }
}

async function handleGet(context) {
  const { params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);

  const tpl = await env.DB
    .prepare(`SELECT * FROM customization_templates WHERE id = ?`)
    .bind(id)
    .first();
  if (!tpl) return errorJson('Not found', 404);

  const { results: fields } = await env.DB
    .prepare(`SELECT * FROM customization_fields WHERE template_id = ? ORDER BY sort_order ASC, id ASC`)
    .bind(id)
    .all();
  return json({ ...tpl, fields: fields || [] });
}

async function handlePatch(context) {
  const { request, params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);

  let body;
  try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }

  const allowed = ['shopify_product_handle', 'base_image_url', 'canvas_width', 'canvas_height', 'status'];
  const sets = [];
  const binds = [];
  for (const k of allowed) {
    if (k in body) { sets.push(`${k} = ?`); binds.push(body[k]); }
  }
  if (body.status === 'published') sets.push(`published_at = datetime('now')`);
  if (sets.length === 0) return errorJson('No editable fields supplied', 400);
  sets.push(`updated_at = datetime('now')`);
  binds.push(id);

  await env.DB
    .prepare(`UPDATE customization_templates SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  return json({ success: true, id });
}

async function handleDelete(context) {
  const { params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const id = parseInt(params.id);
  if (isNaN(id)) return errorJson('Invalid id', 400);
  await env.DB
    .prepare(`UPDATE customization_templates SET status = 'archived', updated_at = datetime('now') WHERE id = ?`)
    .bind(id)
    .run();
  return json({ success: true, id, archived: true });
}
