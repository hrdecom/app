/**
 * /api/personalizer/fields/:id/overrides
 *
 * Per-(non-color)-variant placement overrides for a single
 * customization field. The variant_signature is the slash-joined
 * list of non-color option values, computed by the admin UI from
 * the Shopify variants endpoint.
 *
 * GET    → { items: [{ variant_signature, position_x, position_y, ... hidden }] }
 * PATCH  body { variant_signature, patch: { ... } }  — upsert (only the
 *          keys present in `patch` are written; everything else stays NULL
 *          and the widget falls back to the field's default).
 * DELETE body { variant_signature }                  — remove.
 *
 * Auth: admin or integrator.
 */

import { requireRole, json, errorJson } from '../../../../lib/auth-middleware.js';

const PATCHABLE = [
  'position_x',
  'position_y',
  'width',
  'height',
  'rotation_deg',
  'curve_radius_px',
  // FIX 30 — per-variant override for the new arc tilt.
  'curve_tilt_deg',
  'hidden',
];

export async function onRequest(context) {
  const { request } = context;
  try {
    if (request.method === 'GET') return await handleGet(context);
    if (request.method === 'PATCH') return await handlePatch(context);
    if (request.method === 'DELETE') return await handleDelete(context);
    return errorJson('Method not allowed', 405);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Field overrides error:', e);
    return errorJson('Internal server error', 500);
  }
}

async function handleGet(context) {
  const { params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const fieldId = parseInt(params.id);
  if (isNaN(fieldId)) return errorJson('Invalid field id', 400);

  const { results } = await env.DB
    .prepare(
      `SELECT variant_signature, position_x, position_y, width, height,
              rotation_deg, curve_radius_px, curve_tilt_deg, hidden
         FROM customization_field_variant_overrides
        WHERE field_id = ?
        ORDER BY variant_signature ASC`,
    )
    .bind(fieldId)
    .all();
  return json({ items: results || [] });
}

async function handlePatch(context) {
  const { request, params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const fieldId = parseInt(params.id);
  if (isNaN(fieldId)) return errorJson('Invalid field id', 400);

  let body;
  try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }

  const sig = typeof body?.variant_signature === 'string' ? body.variant_signature.trim() : '';
  if (!sig) return errorJson('variant_signature required', 400);
  const patch = body?.patch && typeof body.patch === 'object' ? body.patch : {};

  // Build the column list — we always include every PATCHABLE column in
  // the INSERT so the UNIQUE-conflict UPDATE branch can address any of
  // them. Columns not present in `patch` are written as NULL on first
  // insert (which means "use the field default") and left untouched on
  // update.
  const insertCols = ['field_id', 'variant_signature', ...PATCHABLE, 'updated_at'];
  const insertVals = [
    fieldId,
    sig,
    ...PATCHABLE.map((k) => coerce(k, patch[k])),
    null, // updated_at — DEFAULT (datetime('now')) handles it
  ];
  const placeholders = insertCols.map(() => '?').join(', ');

  // For the ON CONFLICT branch only update keys actually present in
  // `patch` so a partial PATCH (just position_x for instance) doesn't
  // wipe the other override columns set by an earlier call.
  const updateKeys = PATCHABLE.filter((k) => k in patch);
  if (updateKeys.length === 0) {
    // Nothing to update — but we may still need to insert a hidden=0
    // row so the front end has a row to read back. If a row already
    // exists, leave it alone.
    const existing = await env.DB
      .prepare(
        `SELECT 1 FROM customization_field_variant_overrides WHERE field_id = ? AND variant_signature = ?`,
      )
      .bind(fieldId, sig)
      .first();
    if (existing) return json({ success: true, noop: true });
  }

  const updateSets = updateKeys
    .map((k) => `${k} = excluded.${k}`)
    .concat([`updated_at = datetime('now')`])
    .join(', ');
  const conflictClause = updateKeys.length > 0
    ? `ON CONFLICT(field_id, variant_signature) DO UPDATE SET ${updateSets}`
    : `ON CONFLICT(field_id, variant_signature) DO NOTHING`;

  // SQLite's DEFAULT only applies when the column is OMITTED from the
  // INSERT — passing NULL would store NULL. So we leave updated_at out
  // of the INSERT and add it as a no-op if needed via the conflict
  // clause. Re-build without updated_at:
  const cleanInsertCols = insertCols.filter((c) => c !== 'updated_at');
  const cleanInsertVals = insertVals.slice(0, cleanInsertCols.length);
  const cleanPlaceholders = cleanInsertCols.map(() => '?').join(', ');

  const sql = `INSERT INTO customization_field_variant_overrides (${cleanInsertCols.join(', ')})
               VALUES (${cleanPlaceholders})
               ${conflictClause}`;
  await env.DB.prepare(sql).bind(...cleanInsertVals).run();
  return json({ success: true });
}

async function handleDelete(context) {
  const { request, params, env } = context;
  await requireRole(context, 'admin', 'integrator');
  const fieldId = parseInt(params.id);
  if (isNaN(fieldId)) return errorJson('Invalid field id', 400);

  let body;
  try { body = await request.json(); } catch { return errorJson('Invalid JSON', 400); }
  const sig = typeof body?.variant_signature === 'string' ? body.variant_signature.trim() : '';
  if (!sig) return errorJson('variant_signature required', 400);

  await env.DB
    .prepare(
      `DELETE FROM customization_field_variant_overrides WHERE field_id = ? AND variant_signature = ?`,
    )
    .bind(fieldId, sig)
    .run();
  return json({ success: true });
}

function coerce(k, v) {
  // P25-V3 — `hidden` is INTEGER NOT NULL DEFAULT 0 in the schema.
  // We must NEVER write NULL into it — SQLite would throw a NOT NULL
  // constraint violation. When the PATCH payload doesn't mention
  // `hidden`, default it to 0 so the INSERT path stays valid even on
  // first-write-of-an-override (the most common case: user drags a
  // field for a non-default variant).
  if (k === 'hidden') return v ? 1 : 0;
  if (v === undefined) return null;
  if (v === null || v === '') return null;
  if (k === 'rotation_deg') return Number(v);
  // position/width/height/curve_radius — int
  return Math.round(Number(v));
}
