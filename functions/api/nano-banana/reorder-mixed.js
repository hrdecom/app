/**
 * POST /api/nano-banana/reorder-mixed
 *
 * FIX 27b — unified reorder of GROUPS + UNGROUPED PROMPTS within a
 * single category. Until now, groups and ungrouped prompts had two
 * independent `sort_order` numberings (groups in `nano_banana_groups`,
 * prompts in `ai_prompts`). The integrator UI rendered all groups
 * first, then all ungrouped prompts — so a solo prompt could never
 * sit between two groups, even though that's the most natural way
 * to organize the panel.
 *
 * This endpoint takes ONE ordered array of mixed items
 *   items: [
 *     { type: 'group', id: 12 },
 *     { type: 'prompt', id: 47 },
 *     { type: 'group', id: 8 },
 *     ...
 *   ]
 * and writes the array index back to BOTH tables' sort_order
 * columns. The integrator render then merges both lists by sort_order
 * and gets exactly the order the admin set up.
 *
 * Validation:
 *   - All ids must exist and belong to the given category_id.
 *   - Prompts referenced here must be UNGROUPED (group_id IS NULL).
 *     Prompts inside a group keep their own intra-group ordering
 *     via the existing /api/nano-banana/prompts/reorder endpoint.
 *
 * Admin only.
 */

import { requireRole, json, errorJson } from '../../lib/auth-middleware.js';

export async function onRequestPost(context) {
  try {
    await requireRole(context, 'admin');
    const { request, env } = context;

    let body;
    try { body = await request.json(); }
    catch { return errorJson('Invalid JSON body', 400); }

    const { category_id, items } = body || {};
    if (category_id === undefined || category_id === null) {
      return errorJson('category_id is required', 400);
    }
    if (!Array.isArray(items) || items.length === 0) {
      return errorJson('items must be a non-empty array', 400);
    }

    // ── Normalize + validate every entry
    const normalized = [];
    for (const it of items) {
      const type = it?.type === 'group' || it?.type === 'prompt' ? it.type : null;
      const id = parseInt(it?.id);
      if (!type || !Number.isFinite(id)) {
        return errorJson('Each item must be { type: "group"|"prompt", id: number }', 400);
      }
      normalized.push({ type, id });
    }

    // ── Verify category exists
    const category = await env.DB
      .prepare('SELECT id FROM nano_banana_categories WHERE id = ?')
      .bind(category_id)
      .first();
    if (!category) return errorJson('Category not found', 404);

    // ── Verify each id belongs to this category (and prompts are ungrouped)
    const groupIds = normalized.filter((n) => n.type === 'group').map((n) => n.id);
    const promptIds = normalized.filter((n) => n.type === 'prompt').map((n) => n.id);

    if (groupIds.length > 0) {
      const ph = groupIds.map(() => '?').join(',');
      const { results: gFound = [] } = await env.DB
        .prepare(`SELECT id FROM nano_banana_groups WHERE id IN (${ph}) AND category_id = ?`)
        .bind(...groupIds, category_id).all();
      if (gFound.length !== groupIds.length) {
        return errorJson('One or more group IDs not found in this category', 404);
      }
    }
    if (promptIds.length > 0) {
      const ph = promptIds.map(() => '?').join(',');
      const { results: pFound = [] } = await env.DB
        .prepare(
          `SELECT id FROM ai_prompts
            WHERE id IN (${ph}) AND category_id = ? AND (group_id IS NULL)`,
        )
        .bind(...promptIds, category_id).all();
      if (pFound.length !== promptIds.length) {
        return errorJson(
          'One or more prompt IDs not found, not in this category, or not ungrouped',
          404,
        );
      }
    }

    // ── Build the batch — one UPDATE per item, sort_order = array index
    const stmts = normalized.map((n, idx) => {
      if (n.type === 'group') {
        return env.DB
          .prepare(
            `UPDATE nano_banana_groups
                SET sort_order = ?, updated_at = datetime('now')
              WHERE id = ?`,
          )
          .bind(idx, n.id);
      }
      return env.DB
        .prepare(
          `UPDATE ai_prompts
              SET sort_order = ?, updated_at = datetime('now')
            WHERE id = ?`,
        )
        .bind(idx, n.id);
    });

    await env.DB.batch(stmts);

    return json({
      success: true,
      updated: normalized.length,
      groups: groupIds.length,
      prompts: promptIds.length,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[nano-banana/reorder-mixed] error', err);
    return errorJson(String(err?.message || err), 500);
  }
}
