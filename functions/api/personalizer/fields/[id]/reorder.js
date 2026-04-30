import { requireRole, json, errorJson } from '../../../../lib/auth-middleware.js';

export async function onRequestPost(context) {
  try {
    await requireRole(context, 'admin', 'integrator');
    const { request, env } = context;
    let body;
    try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }

    const items = Array.isArray(body?.items) ? body.items : null;
    if (!items) return errorJson('items array required: [{id, sort_order, layer_z}, …]', 400);

    // Run as a single batch for atomicity.
    const stmts = items
      .filter((i) => Number.isFinite(i.id))
      .map((i) =>
        env.DB.prepare(
          `UPDATE customization_fields
              SET sort_order = COALESCE(?, sort_order),
                  layer_z = COALESCE(?, layer_z),
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).bind(
          Number.isFinite(i.sort_order) ? i.sort_order : null,
          Number.isFinite(i.layer_z) ? i.layer_z : null,
          i.id,
        ),
      );
    if (stmts.length === 0) return errorJson('No valid items', 400);
    await env.DB.batch(stmts);
    return json({ success: true, updated: stmts.length });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Field reorder error:', e);
    return errorJson('Internal server error', 500);
  }
}
