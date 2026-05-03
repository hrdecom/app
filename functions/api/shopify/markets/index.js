/**
 * GET /api/shopify/markets — Fetch Shopify Markets (geographic regions).
 * Requires scope: read_markets.
 * Cached in KV for 5 minutes at `shopify:markets:all`. `?force=1` bypass.
 */

import { requireAuth, json, errorJson } from '../../../lib/auth-middleware.js';
import { shopifyAdminFetch } from '../../../lib/shopify-auth.js';

// FIX 25c — bumped key (v2) to invalidate stale cached payloads that
// contained publication_id=null because of the old singular `catalog`
// query. The new key forces every client to re-fetch with the correct
// catalogs(first: 5) query so excluded markets actually have a usable
// publication_id stored in D1.
const KV_KEY = 'shopify:markets:all:v2';
const TTL_SECONDS = 300;

// FIX 25c — query catalogs(first: 5) instead of the singular catalog field.
// On non-Plus / B2C shops, Market.catalog returns null and we lose the
// publication_id that's needed to unpublish the product from excluded
// markets. catalogs(first: 5) is the correct field on every plan and
// returns a connection — we take the first node's publication.id.
const QUERY = `{
  markets(first: 50) {
    nodes {
      id
      name
      enabled
      primary
      currencySettings { baseCurrency { currencyCode } }
      regions(first: 50) {
        nodes {
          ... on MarketRegionCountry { name code }
        }
      }
      catalogs(first: 5) {
        nodes { publication { id } }
      }
    }
  }
}`;

// If `catalog` field isn't exposed on this plan, fall back to no publication.
const FALLBACK_QUERY = `{
  markets(first: 50) {
    nodes {
      id
      name
      enabled
      primary
      currencySettings { baseCurrency { currencyCode } }
      regions(first: 50) {
        nodes {
          ... on MarketRegionCountry { name code }
        }
      }
    }
  }
}`;

export async function onRequestGet(context) {
  try {
    await requireAuth(context);
    const { env, request } = context;
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === '1';

    if (!force) {
      const cached = await env.SESSIONS.get(KV_KEY, { type: 'json' });
      if (cached && Array.isArray(cached.items)) {
        return json({ ...cached, cached: true });
      }
    }

    let data;
    let lastErr;
    for (const q of [QUERY, FALLBACK_QUERY]) {
      const res = await shopifyAdminFetch(env, '/graphql.json', {
        method: 'POST',
        body: JSON.stringify({ query: q }),
      });
      const text = await res.text();
      if (!res.ok) {
        console.error('[markets] upstream error', res.status, text.slice(0, 500));
        return json({ error: 'Shopify markets fetch failed', upstream_status: res.status, upstream_body: text.slice(0, 2000) }, 502);
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return json({ error: 'Malformed Shopify response', body_preview: text.slice(0, 500) }, 502);
      }
      if (parsed.errors) {
        lastErr = parsed.errors;
        // If catalog field is the only offender, try fallback
        const onlyCatalog = parsed.errors.every((e) =>
          /catalog/i.test(e?.message || '') || /catalog/i.test((e?.path || []).join('.')),
        );
        if (onlyCatalog) {
          console.warn('[markets] catalog field unavailable, retrying fallback');
          continue;
        }
        // Scope error → report with hint
        const first = parsed.errors[0];
        const message = first?.message || 'Shopify GraphQL error';
        const code = first?.extensions?.code || first?.code || null;
        console.error('[markets] GraphQL error', { message, code, full: JSON.stringify(parsed.errors).slice(0, 2000) });
        return json(
          {
            error: `Shopify GraphQL error: ${message}`,
            code,
            graphql_errors: parsed.errors,
            required_scope: 'read_markets',
            hint:
              code === 'ACCESS_DENIED' || /access denied|scope|not approved/i.test(message)
                ? 'Your Shopify Admin API token is missing the `read_markets` scope. Enable read_markets (and write_markets for publishing) in the app\'s Admin API access scopes, then regenerate/reinstall the token.'
                : undefined,
          },
          502,
        );
      }
      data = parsed;
      break;
    }
    if (!data) {
      return json({ error: 'Unable to query Shopify markets', graphql_errors: lastErr }, 502);
    }

    const nodes = data?.data?.markets?.nodes || [];
    const items = nodes.map((m) => {
      const fullId = m.id || '';
      const numericId = String(fullId.split('/').pop() || '');
      const regions = (m.regions?.nodes || []).map((r) => ({
        name: r?.name || null,
        code: r?.code || null,
      }));
      // FIX 25c — pull the first catalog's publication id. Some markets
      // share their primary's publication and have no catalog of their
      // own, in which case publication_id stays null and the publish
      // flow will fall back to its own catalogs() lookup or skip
      // unpublishing for that market (with a clear warning).
      const firstCatalogPub = m.catalogs?.nodes?.[0]?.publication?.id || null;
      return {
        id: numericId,
        gid: fullId,
        name: m.name,
        enabled: !!m.enabled,
        primary: !!m.primary,
        currency: m.currencySettings?.baseCurrency?.currencyCode || null,
        regions,
        publication_id: firstCatalogPub,
      };
    });
    items.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || a.name.localeCompare(b.name));

    const payload = { items, cached_at: Date.now() };
    await env.SESSIONS.put(KV_KEY, JSON.stringify(payload), { expirationTtl: TTL_SECONDS });

    return json({ ...payload, cached: false });
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error('[markets] uncaught', err);
    return errorJson(String(err?.message || err), 500);
  }
}
