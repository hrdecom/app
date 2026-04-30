/**
 * Verify that a Shopify webhook payload was signed with our shared secret.
 * Uses the Web Crypto API so this works inside Cloudflare Workers (no
 * Node 'crypto' import).
 *
 * Shopify sends X-Shopify-Hmac-Sha256: base64(hmac-sha256(secret, body)).
 * We compute the same and constant-time-compare.
 */

export async function verifyShopifyHmac(body, headerHmacB64, secret) {
  if (!headerHmacB64 || typeof headerHmacB64 !== 'string') return false;
  if (!secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const expected = bufToBase64(sig);
  return constantTimeEq(expected, headerHmacB64);
}

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function constantTimeEq(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
