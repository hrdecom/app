import { describe, it, expect } from 'vitest';
import { verifyShopifyHmac } from '../functions/lib/shopify-webhook.js';

const SECRET = 'shpss_test_secret_value';
const BODY = '{"id":12345,"line_items":[]}';
const VALID_HMAC = 'ZvWke7oOvyFWFCOwAFy/jRgvW/Bp16ucWP6xR3wFRx8=';

describe('verifyShopifyHmac', () => {
  it('accepts a payload with the matching HMAC header', async () => {
    const ok = await verifyShopifyHmac(BODY, VALID_HMAC, SECRET);
    expect(ok).toBe(true);
  });

  it('rejects a payload with a tampered body', async () => {
    const ok = await verifyShopifyHmac(BODY + 'X', VALID_HMAC, SECRET);
    expect(ok).toBe(false);
  });

  it('rejects a missing or empty HMAC header', async () => {
    expect(await verifyShopifyHmac(BODY, '', SECRET)).toBe(false);
    expect(await verifyShopifyHmac(BODY, null, SECRET)).toBe(false);
  });

  it('is constant-time — different lengths still return false fast', async () => {
    expect(await verifyShopifyHmac(BODY, 'short', SECRET)).toBe(false);
  });
});
