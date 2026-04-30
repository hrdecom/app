/**
 * GET  /api/personalizer/templates — list all templates with field counts.
 * POST /api/personalizer/templates — create a new template for a product.
 *
 * Admin / integrator only.
 */

import { requireRole, json, errorJson } from '../../../lib/auth-middleware.js';

export async function onRequest(context) {
  const { request } = context;
  try {
    if (request.method === 'GET') return await handleGet(context);
    if (request.method === 'POST') return await handlePost(context);
    return errorJson('Method not allowed', 405);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Personalizer templates API error:', error);
    return errorJson('Internal server error', 500);
  }
}

async function handleGet(context) {
  const { request, env } = context;
  await requireRole(context, 'admin', 'integrator');

  const url = new URL(request.url);
  const productId = url.searchParams.get('product_id');
  const status = url.searchParams.get('status');

  let query = `SELECT t.*,
                      p.title AS product_title,
                      (SELECT COUNT(*) FROM customization_fields WHERE template_id = t.id) AS field_count
                 FROM customization_templates t
                 LEFT JOIN products p ON p.id = t.product_id
                 WHERE 1=1`;
  const bindings = [];
  if (productId) { query += ' AND t.product_id = ?'; bindings.push(parseInt(productId)); }
  if (status)    { query += ' AND t.status = ?';     bindings.push(status); }
  query += ' ORDER BY t.updated_at DESC';

  const stmt = bindings.length ? env.DB.prepare(query).bind(...bindings) : env.DB.prepare(query);
  const { results } = await stmt.all();
  return json({ items: results || [] });
}

async function handlePost(context) {
  const { request, env } = context;
  const user = await requireRole(context, 'admin', 'integrator');

  let body;
  try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }
  const { product_id, base_image_url, canvas_width, canvas_height, shopify_product_handle } = body;
  if (!product_id) return errorJson('product_id required', 400);

  // One published template per product. If a draft already exists, return it.
  const existing = await env.DB
    .prepare(`SELECT id FROM customization_templates WHERE product_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1`)
    .bind(parseInt(product_id))
    .first();
  if (existing) return json({ id: existing.id, existed: true });

  const result = await env.DB
    .prepare(
      `INSERT INTO customization_templates
        (product_id, shopify_product_handle, base_image_url, canvas_width, canvas_height, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
    )
    .bind(
      parseInt(product_id),
      shopify_product_handle || null,
      base_image_url || null,
      canvas_width || 1080,
      canvas_height || 1080,
      user.id,
    )
    .run();
  return json({ id: result.meta.last_row_id, created: true });
}
