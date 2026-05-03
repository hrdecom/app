/**
 * POST /api/claude/blacklist/import-shopify
 *
 * FIX 26d — Bulk import every product title currently published on the
 * merchant's Shopify storefront into the title blacklist so Claude
 * never re-suggests a name that's already in use.
 *
 * Flow:
 *   1) Paginate Shopify products via the Admin GraphQL API (250 per
 *      page, follow `pageInfo.endCursor` until exhausted). We only
 *      pull `id` + `title` — that's all the blacklist needs.
 *   2) Each title gets inserted into title_blacklist with a sentinel
 *      `product_type_slug = '__shopify__'`. The unique constraint is
 *      `(product_type_slug, name)`, so this slug stays out of the
 *      per-type-filtered blacklist views in the integrator UI but
 *      still gets caught by the GLOBAL filter that generate-title.js
 *      applies before returning suggestions to the integrator (see
 *      generate-title.js:213-218 — `SELECT name FROM title_blacklist`,
 *      no slug filter).
 *   3) INSERT OR IGNORE on each row, so re-running the import is
 *      idempotent and safely top-up — only NEW titles get added.
 *
 * Admin-only. Returns a summary: { imported, skipped, total_pages,
 * shopify_products }.
 */

import { requireRole, json, errorJson } from '../../../lib/auth-middleware.js';
import { shopifyAdminFetch } from '../../../lib/shopify-auth.js';

const SENTINEL_SLUG = '__shopify__';
const PAGE_SIZE = 250;

export async function onRequestPost(context) {
  try {
    await requireRole(context, 'admin');
    const { env } = context;

    // ── 1. Paginate every Shopify product title. The cursor walk
    //    stops when pageInfo.hasNextPage flips to false. We hard-cap
    //    at 200 pages (50,000 products) for sanity — far above any
    //    realistic catalog size.
    const titles = [];
    let cursor = null;
    let page = 0;
    const MAX_PAGES = 200;

    while (page < MAX_PAGES) {
      page += 1;
      const variables = cursor ? { cursor } : { cursor: null };
      const query = `query($cursor: String) {
        products(first: ${PAGE_SIZE}, after: $cursor) {
          edges { node { id title } }
          pageInfo { hasNextPage endCursor }
        }
      }`;

      const res = await shopifyAdminFetch(env, '/graphql.json', {
        method: 'POST',
        body: JSON.stringify({ query, variables }),
      });

      const text = await res.text();
      if (!res.ok) {
        console.error('[blacklist/import-shopify] upstream', res.status, text.slice(0, 400));
        return errorJson(
          `Shopify products fetch failed at page ${page}: ${res.status}`,
          502,
        );
      }

      let parsed;
      try { parsed = JSON.parse(text); }
      catch { return errorJson('Malformed Shopify response', 502); }

      if (parsed.errors) {
        const first = parsed.errors[0];
        const msg = first?.message || 'Shopify GraphQL error';
        const code = first?.extensions?.code || null;
        console.error('[blacklist/import-shopify] GraphQL error', { msg, code });
        return errorJson(
          code === 'ACCESS_DENIED' || /scope|access denied/i.test(msg)
            ? 'The Shopify token is missing the read_products scope. Enable it in your custom app and reinstall the token.'
            : `Shopify GraphQL error: ${msg}`,
          502,
        );
      }

      const edges = parsed?.data?.products?.edges || [];
      for (const e of edges) {
        const t = e?.node?.title;
        if (typeof t === 'string' && t.trim().length > 0) titles.push(t.trim());
      }

      const pageInfo = parsed?.data?.products?.pageInfo;
      if (!pageInfo?.hasNextPage) break;
      cursor = pageInfo.endCursor;
    }

    // ── 2. Bulk insert. INSERT OR IGNORE swallows the unique-
    //    constraint hit when the same title is already on the
    //    blacklist (from a prior import or a manual integrator
    //    accept). We do this in batches of 100 to keep each D1
    //    statement small and stay well under D1's bound-variable
    //    limits.
    let inserted = 0;
    let skipped = 0;
    const BATCH = 100;
    for (let i = 0; i < titles.length; i += BATCH) {
      const slice = titles.slice(i, i + BATCH);
      const stmts = slice.map((name) =>
        env.DB
          .prepare(
            `INSERT OR IGNORE INTO title_blacklist
                 (product_type_slug, name, product_id, created_at)
              VALUES (?, ?, NULL, datetime('now'))`,
          )
          .bind(SENTINEL_SLUG, name),
      );
      const results = await env.DB.batch(stmts);
      // D1 batch returns an array of meta objects; rows_written is 1
      // when a row was actually inserted, 0 when IGNORE'd.
      for (const r of results) {
        if (r?.meta?.changes && r.meta.changes > 0) inserted += 1;
        else skipped += 1;
      }
    }

    console.log(
      `[blacklist/import-shopify] pages=${page} shopify_products=${titles.length} inserted=${inserted} skipped=${skipped}`,
    );

    return json({
      ok: true,
      shopify_products: titles.length,
      inserted,
      skipped,
      total_pages: page,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[blacklist/import-shopify] uncaught', err);
    return errorJson(String(err?.message || err), 500);
  }
}
