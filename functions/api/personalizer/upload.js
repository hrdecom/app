/**
 * POST /api/personalizer/upload
 *
 * Receives a customer-uploaded photo, stores in R2 under a pending key,
 * returns the proxied URL the storefront widget puts into the cart.
 *
 * Public — no auth. Rate-limited per IP (60 uploads / hour) via KV
 * counter when the RATE_LIMIT binding exists.
 */

const MAX_SIZE = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const RATE_PER_HOUR = 60;

export async function onRequestPost(context) {
  const { request, env } = context;

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.RATE_LIMIT) {
    const key = `personalizer-upload:${ip}:${Math.floor(Date.now() / 3600000)}`;
    const count = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
    if (count >= RATE_PER_HOUR) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 });
    }
    await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 3700 });
  }

  if (!env.IMAGES) return new Response(JSON.stringify({ error: 'R2 not configured' }), { status: 503 });

  const ct = request.headers.get('content-type') || '';
  if (!ct.startsWith('multipart/form-data')) {
    return new Response(JSON.stringify({ error: 'Expected multipart/form-data' }), { status: 400 });
  }
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return new Response(JSON.stringify({ error: 'No file' }), { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return new Response(JSON.stringify({ error: 'File too large (max 8 MB)' }), { status: 413 });
  }
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED.has(mime)) {
    return new Response(JSON.stringify({ error: `Unsupported type: ${mime}` }), { status: 400 });
  }

  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
  const rand = Math.random().toString(36).slice(2, 12);
  const key = `personalizer/pending/${Date.now()}-${rand}.${ext}`;
  await env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: mime } });
  const url = `/api/images/r2/${key}`;
  return new Response(JSON.stringify({ url, key, size: file.size, mime }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
