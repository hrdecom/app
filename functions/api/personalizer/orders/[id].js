import { requireRole, json, errorJson } from '../../../lib/auth-middleware.js';

const VALID_STATUS = new Set(['pending', 'in_production', 'shipped', 'cancelled']);

export async function onRequestPatch(context) {
  try {
    await requireRole(context, 'admin', 'integrator');
    const { request, params, env } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) return errorJson('Invalid id', 400);

    let body;
    try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }

    const sets = [];
    const binds = [];
    if (body.production_status) {
      if (!VALID_STATUS.has(body.production_status)) return errorJson('Invalid status', 400);
      sets.push('production_status = ?'); binds.push(body.production_status);
    }
    if ('production_notes' in body) {
      sets.push('production_notes = ?'); binds.push(body.production_notes || null);
    }
    if (sets.length === 0) return errorJson('No updates', 400);
    sets.push(`updated_at = datetime('now')`);
    binds.push(id);

    await env.DB.prepare(`UPDATE customization_orders SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return json({ success: true, id });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Order PATCH error:', e);
    return errorJson('Internal server error', 500);
  }
}
