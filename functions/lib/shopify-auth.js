/**
 * Shopify OAuth 2.0 Client Credentials Grant + KV Token Cache
 *
 * Manages access tokens for Shopify Admin API using 2026 client credentials flow.
 * Tokens are cached in KV with TTL to minimize OAuth requests.
 */

const KV_KEY = 'shopify:access_token';
const TOKEN_REFRESH_BUFFER = 60_000; // 60s before expiry, refresh

/**
 * Get a valid Shopify access token from cache or mint a new one
 * @param {object} env - Cloudflare env bindings (SESSIONS KV, SHOPIFY_* secrets)
 * @returns {Promise<string>} Valid access token
 * @throws {Error} With .code = 'shopify_auth_failed' on OAuth failure
 */
export async function getShopifyAccessToken(env) {
  const { SESSIONS, SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_ADMIN_TOKEN } = env;

  // 1) PRIMARY: fixed admin token (custom apps / private apps).
  //    If set, use it directly — skip OAuth entirely. No KV caching needed
  //    since the token is static; expirations are managed in the Shopify
  //    admin UI.
  if (SHOPIFY_ADMIN_TOKEN && String(SHOPIFY_ADMIN_TOKEN).trim().length > 0) {
    return String(SHOPIFY_ADMIN_TOKEN).trim();
  }

  // 2) FALLBACK: OAuth 2.0 client credentials grant (Shopify Plus / specific app types only).
  //    Kept as a secondary path for future when the app is configured for it.

  // Check cache
  const cached = await SESSIONS.get(KV_KEY, { type: 'json' });
  if (cached && cached.access_token && cached.expires_at) {
    const now = Date.now();
    if (cached.expires_at - now > TOKEN_REFRESH_BUFFER) {
      return cached.access_token;
    }
  }

  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    const error = new Error(
      'Shopify auth is not configured. Set SHOPIFY_ADMIN_TOKEN (recommended for custom apps) or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (OAuth client credentials).',
    );
    error.code = 'shopify_auth_failed';
    throw error;
  }

  // Mint new token via client credentials grant
  const tokenUrl = `https://${SHOPIFY_SHOP}/admin/oauth/access_token`;
  const body = JSON.stringify({
    client_id: SHOPIFY_CLIENT_ID,
    client_secret: SHOPIFY_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });

  let response;
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (err) {
    const error = new Error(`Shopify OAuth network error: ${err.message}`);
    error.code = 'shopify_auth_failed';
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    const error = new Error(`Shopify OAuth failed: ${response.status} ${errorText}`);
    error.code = 'shopify_auth_failed';
    error.upstream_status = response.status;
    error.upstream_body = errorText;
    throw error;
  }

  const data = await response.json();
  const { access_token, expires_in = 3600, token_type } = data;

  if (!access_token) {
    const error = new Error('Shopify OAuth returned no access_token');
    error.code = 'shopify_auth_failed';
    throw error;
  }

  // Cache in KV
  const expires_at = Date.now() + expires_in * 1000;
  await SESSIONS.put(
    KV_KEY,
    JSON.stringify({ access_token, token_type, expires_at }),
    { expirationTtl: expires_in }
  );

  return access_token;
}

/**
 * Clear cached Shopify token (useful on 401 or forced refresh)
 * @param {object} env
 * @returns {Promise<void>}
 */
export async function clearShopifyAccessToken(env) {
  await env.SESSIONS.delete(KV_KEY);
}

/**
 * Fetch helper for Shopify Admin API with auto-retry on 401
 * @param {object} env
 * @param {string} path - API path (e.g., '/shop.json', '/products.json')
 * @param {RequestInit} [init] - Fetch options
 * @returns {Promise<Response>}
 */
/**
 * Normalize a shop domain: strip protocol + trailing slash, trim whitespace.
 * Accepts "mystore.myshopify.com", "https://mystore.myshopify.com", "  https://mystore.myshopify.com/  "
 */
function normalizeShopDomain(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .trim();
}

function maskToken(t) {
  if (!t) return '(none)';
  const s = String(t);
  if (s.length <= 10) return s.slice(0, 3) + '…';
  return s.slice(0, 10) + '…(' + s.length + ' chars)';
}

export async function shopifyAdminFetch(env, path, init = {}) {
  const shop = normalizeShopDomain(env.SHOPIFY_SHOP);
  const apiVersion = (env.SHOPIFY_API_VERSION || '2025-10').trim();

  if (!shop) {
    const error = new Error('SHOPIFY_SHOP is not set. Expected format: mystore.myshopify.com (no protocol).');
    error.code = 'shopify_config_missing';
    throw error;
  }

  const baseUrl = `https://${shop}/admin/api/${apiVersion}`;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${baseUrl}${normalizedPath}`;

  let token;
  try {
    token = await getShopifyAccessToken(env);
  } catch (e) {
    console.error('[shopify] getShopifyAccessToken failed:', e.message, e.code || '');
    throw e;
  }

  const usingFixedToken = !!(env.SHOPIFY_ADMIN_TOKEN && String(env.SHOPIFY_ADMIN_TOKEN).trim().length > 0);

  console.log('[shopify] fetch', {
    method: (init.method || 'GET').toUpperCase(),
    url,
    token_source: usingFixedToken ? 'admin_token' : 'oauth',
    token_preview: maskToken(token),
    api_version: apiVersion,
    shop,
  });

  const headers = {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...init.headers,
  };

  let response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (e) {
    console.error('[shopify] network error', { url, message: e.message });
    const error = new Error(`Shopify network error for ${url}: ${e.message}`);
    error.code = 'shopify_network_error';
    error.url = url;
    throw error;
  }

  console.log('[shopify] response', { status: response.status, url });

  // Retry once on 401 — only meaningful when minting via OAuth.
  if (response.status === 401 && !usingFixedToken) {
    console.log('[shopify] 401 — clearing cache and retrying once');
    await clearShopifyAccessToken(env);
    token = await getShopifyAccessToken(env);
    headers['X-Shopify-Access-Token'] = token;
    response = await fetch(url, { ...init, headers });
    console.log('[shopify] retry response', { status: response.status });
  }

  return response;
}
