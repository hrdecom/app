import { requireRole, json, errorJson } from '../../../lib/auth-middleware.js';

export async function onRequestGet(context) {
  try {
    await requireRole(context, 'admin', 'integrator');
    const { request, env } = context;
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    let q = `SELECT o.*, p.title AS product_title
               FROM customization_orders o
               LEFT JOIN products p ON p.id = o.product_id`;
    const binds = [];
    if (status) { q += ` WHERE o.production_status = ?`; binds.push(status); }
    q += ` ORDER BY o.created_at DESC LIMIT 200`;

    const stmt = binds.length ? env.DB.prepare(q).bind(...binds) : env.DB.prepare(q);
    const { results } = await stmt.all();
    return json({ items: results || [] });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Orders list error:', e);
    return errorJson('Internal server error', 500);
  }
}
