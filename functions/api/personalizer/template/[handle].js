/**
 * GET /api/personalizer/template/:handle
 *
 * Public read-only endpoint consumed by the storefront widget.
 * - Only returns published templates (drafts and archived are 404).
 * - Returns CORS headers so the storefront page can fetch from our domain.
 *
 * No auth — this is intentionally public. Templates contain no PII.
 */

import { json } from '../../../lib/auth-middleware.js';

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const handle = String(params.handle || '').trim();
  if (!handle) return jsonCors({ error: 'handle required' }, 400, request);

  const tpl = await env.DB
    .prepare(
      `SELECT * FROM customization_templates
        WHERE shopify_product_handle = ? AND status = 'published'
        ORDER BY published_at DESC LIMIT 1`,
    )
    .bind(handle)
    .first();
  if (!tpl) return jsonCors({ found: false }, 404, request);

  const { results: fields } = await env.DB
    .prepare(`SELECT * FROM customization_fields WHERE template_id = ? ORDER BY sort_order ASC`)
    .bind(tpl.id)
    .all();

  return jsonCors({
    found: true,
    template: tpl,
    fields: fields || [],
  }, 200, request);
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request) });
}

function jsonCors(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

function corsHeaders(request) {
  const origin = request?.headers?.get('Origin') || '';
  const allowed = origin.endsWith('.myshopify.com') || origin === 'https://riccardiparis.com'
    ? origin
    : '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
