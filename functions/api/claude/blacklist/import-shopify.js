/**
 * POST /api/claude/blacklist/import-shopify
 *
 * FIX 26d (v2) — Bulk import every product title currently published on
 * the merchant's Shopify storefront into the title blacklist so the IA
 * model never re-suggests a name that's already in use FOR THE SAME
 * PRODUCT TYPE.
 *
 * Why per-type matters:
 *   The blacklist filter compares the IA's generated `name_part`
 *   (e.g. "Sparkle Gold") to the stored `name`. Storing the full
 *   Shopify title verbatim (e.g. `Initial Bracelet "Sparkle Gold"`)
 *   never matches because the IA doesn't return full titles, only
 *   name parts. Worse, even if it did, blocking globally would
 *   prevent reusing the name across DIFFERENT product types — but
 *   `Initial Necklace "Sparkle Gold"` is a perfectly different
 *   product than `Initial Bracelet "Sparkle Gold"` and should be
 *   allowed.
 *
 * Parsing strategy:
 *   1) Extract whatever sits between quotes (straight " or curly “”
 *      / French «»). That's the `name_part`.
 *   2) The text BEFORE the quoted name is `<collection?> <product_type>`.
 *      We try to match the LONGEST product_types.name from the prefix
 *      (longest-first so "Initial Bracelet" beats "Bracelet").
 *   3) Insert with the matched slug (or `__shopify_unmatched__` when
 *      we can't parse it — those still get caught by the safety
 *      filter as a defensive net).
 *
 * Idempotency:
 *   At the start of every run we DELETE all entries with slug
 *   `__shopify__` (legacy v1 entries — full titles, useless for the
 *   filter) AND `__shopify_unmatched__` (we'll re-derive them).
 *   Per-type entries created from accepted titles by integrators are
 *   left alone — they're real human-curated blocks.
 */

import { requireRole, json, errorJson } from '../../../lib/auth-middleware.js';
import { shopifyAdminFetch } from '../../../lib/shopify-auth.js';

const UNMATCHED_SLUG = '__shopify_unmatched__';
const LEGACY_FULL_TITLE_SLUG = '__shopify__';
const PAGE_SIZE = 250;

// Pull the value between the FIRST balanced pair of quotes we can
// find. Handles straight ASCII quotes and the most common curly /
// guillemet variants. Returns null when no quoted segment exists.
function extractQuotedName(title) {
  const patterns = [
    /["]([^"]+)["]/,        // straight double quote
    /[“]([^”]+)[”]/, // “ ”
    /[«]\s*([^»]+?)\s*[»]/, // « »
    /[‘]([^’]+)[’]/, // ‘ ’
    /[']([^']+)[']/,         // straight single quote (last resort)
  ];
  for (const re of patterns) {
    const m = title.match(re);
    if (m && m[1] && m[1].trim()) return { name: m[1].trim(), match: m[0] };
  }
  return null;
}

// Build a list of {slug, name, normalizedName} sorted by length DESC
// so the LONGEST prefix wins when matching ambiguous titles like
// "Initial Bracelet" vs "Bracelet".
function buildTypeIndex(productTypes) {
  return productTypes
    .filter((t) => t.name && t.slug)
    .map((t) => ({
      slug: String(t.slug),
      name: String(t.name),
      normalizedName: String(t.name).toLowerCase().trim(),
    }))
    .sort((a, b) => b.normalizedName.length - a.normalizedName.length);
}

// Given the prefix part of a title (everything BEFORE the quoted
// name) and the type index, return the matching slug or null.
function matchProductTypeFromPrefix(prefix, typeIndex) {
  const norm = prefix.toLowerCase();
  for (const t of typeIndex) {
    if (norm.includes(t.normalizedName)) return t.slug;
  }
  return null;
}

export async function onRequestPost(context) {
  try {
    await requireRole(context, 'admin');
    const { env } = context;

    // ── 1. Pull the merchant's product types so we can map Shopify
    //    titles to the correct slug. We don't gate on `is_active`
    //    here because retired types still own historical titles.
    const { results: typesRows = [] } = await env.DB
      .prepare('SELECT slug, name FROM product_types').all();
    const typeIndex = buildTypeIndex(typesRows);

    // ── 2. Wipe legacy + unmatched entries so re-runs don't pile up
    //    duplicates and so v1's full-title rows get cleaned out. We
    //    deliberately DON'T touch entries with real type slugs —
    //    those came from the integrator's accept-title flow and are
    //    human-curated.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM title_blacklist WHERE product_type_slug = ?').bind(LEGACY_FULL_TITLE_SLUG),
      env.DB.prepare('DELETE FROM title_blacklist WHERE product_type_slug = ?').bind(UNMATCHED_SLUG),
    ]);

    // ── 3. Paginate every Shopify product title.
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

    // ── 4. Parse + insert. For each Shopify title:
    //      a) extract the quoted name
    //      b) match the product type from the prefix
    //      c) insert (slug, name) — slug = matched product_type or
    //         UNMATCHED_SLUG when we can't parse it
    let insertedMatched = 0;
    let insertedUnmatched = 0;
    let skipped = 0;
    const BATCH = 100;
    const rows = [];

    for (const title of titles) {
      const quoted = extractQuotedName(title);
      if (quoted) {
        const prefix = title.slice(0, title.indexOf(quoted.match)).trim();
        const matchedSlug = matchProductTypeFromPrefix(prefix, typeIndex);
        if (matchedSlug) {
          rows.push({ slug: matchedSlug, name: quoted.name });
          continue;
        }
        // We found a quoted name but no matching product type. Store
        // the name under the unmatched slug so it still gets caught
        // by the per-type filter on at least the unmatched bucket
        // (which the safety filter still scans defensively below).
        rows.push({ slug: UNMATCHED_SLUG, name: quoted.name });
        continue;
      }
      // No quotes at all — store the full title under the unmatched
      // slug as a defensive last resort.
      rows.push({ slug: UNMATCHED_SLUG, name: title });
    }

    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const stmts = slice.map((r) =>
        env.DB
          .prepare(
            `INSERT OR IGNORE INTO title_blacklist
                 (product_type_slug, name, product_id, created_at)
              VALUES (?, ?, NULL, datetime('now'))`,
          )
          .bind(r.slug, r.name),
      );
      const results = await env.DB.batch(stmts);
      results.forEach((res, idx) => {
        const wasInserted = res?.meta?.changes && res.meta.changes > 0;
        if (wasInserted) {
          if (slice[idx].slug === UNMATCHED_SLUG) insertedUnmatched += 1;
          else insertedMatched += 1;
        } else {
          skipped += 1;
        }
      });
    }

    console.log(
      `[blacklist/import-shopify] pages=${page} shopify_products=${titles.length} matched=${insertedMatched} unmatched=${insertedUnmatched} skipped=${skipped}`,
    );

    return json({
      ok: true,
      shopify_products: titles.length,
      inserted: insertedMatched + insertedUnmatched,
      inserted_matched: insertedMatched,
      inserted_unmatched: insertedUnmatched,
      skipped,
      total_pages: page,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[blacklist/import-shopify] uncaught', err);
    return errorJson(String(err?.message || err), 500);
  }
}
