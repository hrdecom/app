/**
 * POST /api/personalizer/upload
 *
 * Receives a customer-uploaded photo, stores in R2 under a pending key,
 * returns the proxied URL the storefront widget puts into the cart.
 *
 * Public — no auth. Rate-limited per IP (60 uploads / hour) via KV
 * counter when the RATE_LIMIT binding exists.
 */

// P26-15 — accept the formats every modern phone / camera produces.
// HEIC/HEIF cover iOS, AVIF covers newer Android, BMP/TIFF cover
// older scanners. GIF is intentionally excluded (animations break
// engraving previews). Browsers also send `image/heic` /
// `application/octet-stream` for some HEIC files; we accept by
// MIME OR by extension to cover both cases.
const MAX_SIZE = 16 * 1024 * 1024; // 16 MB to fit a typical iPhone shot
const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/heic', 'image/heif', 'image/avif', 'image/bmp', 'image/tiff',
]);
const ALLOWED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff',
]);
const RATE_PER_HOUR = 60;

// P26-15 — CORS. The storefront runs on the merchant's Shopify domain
// (e.g. riccardiparis.com) while this endpoint lives on
// jewelry-crm.pages.dev. Browsers block cross-origin POSTs without
// `Access-Control-Allow-Origin`. We use `*` because the endpoint is
// public anyway (rate-limited per IP). Preflight OPTIONS is also
// answered so multipart uploads with a file work.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function jsonRes(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.RATE_LIMIT) {
    const key = `personalizer-upload:${ip}:${Math.floor(Date.now() / 3600000)}`;
    const count = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
    if (count >= RATE_PER_HOUR) {
      return jsonRes({ error: 'Rate limit exceeded' }, 429);
    }
    await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 3700 });
  }

  if (!env.IMAGES) return jsonRes({ error: 'R2 not configured' }, 503);

  const ct = request.headers.get('content-type') || '';
  if (!ct.startsWith('multipart/form-data')) {
    return jsonRes({ error: 'Expected multipart/form-data' }, 400);
  }
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return jsonRes({ error: 'No file' }, 400);
  }
  if (file.size > MAX_SIZE) {
    return jsonRes({ error: 'File too large (max 16 MB)' }, 413);
  }
  // P26-15 — accept by MIME OR by extension because some browsers
  // (and the OS share-sheet on iOS) hand HEIC files over with an
  // empty / generic MIME type. Reject GIF explicitly even though
  // the customer might try to upload one.
  const mime = (file.type || '').toLowerCase();
  const filename = (file.name || '').toLowerCase();
  const extFromName = (filename.match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const mimeOk = ALLOWED_MIMES.has(mime);
  const extOk = ALLOWED_EXTENSIONS.has(extFromName);
  if (mime === 'image/gif' || extFromName === 'gif') {
    return jsonRes({ error: 'GIF is not supported' }, 400);
  }
  if (!mimeOk && !extOk) {
    return jsonRes({ error: `Unsupported file type (${mime || extFromName || 'unknown'})` }, 400);
  }

  // Pick a canonical extension for the storage key so the proxy
  // serves the right Content-Type later. Prefer the extension in
  // the filename when it's something we recognise; otherwise map
  // from MIME.
  const ext = ALLOWED_EXTENSIONS.has(extFromName)
    ? (extFromName === 'jpg' ? 'jpg' : extFromName)
    : (mime === 'image/jpeg' || mime === 'image/jpg') ? 'jpg'
    : mime === 'image/png' ? 'png'
    : mime === 'image/webp' ? 'webp'
    : mime === 'image/heic' ? 'heic'
    : mime === 'image/heif' ? 'heif'
    : mime === 'image/avif' ? 'avif'
    : mime === 'image/bmp' ? 'bmp'
    : mime === 'image/tiff' ? 'tiff'
    : 'bin';
  const rand = Math.random().toString(36).slice(2, 12);
  const key = `personalizer/pending/${Date.now()}-${rand}.${ext}`;
  await env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: mime || `image/${ext}` },
  });
  const url = `/api/images/r2/${key}`;
  return jsonRes({ url, key, size: file.size, mime: mime || `image/${ext}` }, 200);
}
