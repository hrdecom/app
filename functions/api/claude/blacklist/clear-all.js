/**
 * POST /api/claude/blacklist/clear-all
 *
 * Wipes EVERY row from title_blacklist. Admin-only and intentionally
 * unrecoverable — the merchant uses this to reset after a bad import
 * or to start over from scratch. Returns the count that was deleted
 * so the UI can confirm the wipe in a toast.
 *
 * Why a separate endpoint instead of bulk-deleting via the existing
 * DELETE /:id route: the per-id route requires N round-trips for N
 * rows. Wiping a few thousand entries one-by-one would be brutal on
 * D1 connections. This single statement runs server-side.
 */

import { requireRole, json, errorJson } from '../../../lib/auth-middleware.js';

export async function onRequestPost(context) {
  try {
    await requireRole(context, 'admin');
    const { env } = context;

    // Snapshot the count BEFORE the wipe so the response is honest
    // about what was removed (D1 doesn't return a row count from
    // DELETE in a uniformly accessible way across drivers).
    const countRow = await env.DB
      .prepare('SELECT COUNT(*) AS total FROM title_blacklist').first();
    const total = Number(countRow?.total || 0);

    await env.DB.prepare('DELETE FROM title_blacklist').run();

    console.log(`[blacklist/clear-all] wiped ${total} rows`);
    return json({ ok: true, deleted: total });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[blacklist/clear-all] uncaught', err);
    return errorJson(String(err?.message || err), 500);
  }
}
