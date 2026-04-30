/**
 * POST /api/personalizer/webhook/shopify-order
 *
 * Shopify orders/create webhook receiver. Steps:
 *   1. Read raw body + X-Shopify-Hmac-Sha256 header.
 *   2. HMAC-validate against SHOPIFY_WEBHOOK_SECRET.
 *   3. For each line item with personalization properties:
 *      - Look up the live template, snapshot it.
 *      - Insert customization_orders row.
 *      - Append spec to order.note + write JSON metafield.
 */

import { verifyShopifyHmac } from '../../../lib/shopify-webhook.js';
import { buildSpecText, buildSpecJson } from '../../../lib/personalizer-spec.js';
import { appendOrderNote, setOrderMetafield } from '../../../lib/shopify-graphql.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const raw = await request.text();
  const hmac = request.headers.get('X-Shopify-Hmac-Sha256');
  const ok = await verifyShopifyHmac(raw, hmac, env.SHOPIFY_WEBHOOK_SECRET);
  if (!ok) {
    return new Response('invalid hmac', { status: 401 });
  }

  let order;
  try { order = JSON.parse(raw); } catch { return new Response('invalid json', { status: 400 }); }
  if (!order?.id) return new Response('missing order id', { status: 400 });

  const orderGid = `gid://shopify/Order/${order.id}`;
  const orderName = order.name || `#${order.order_number || order.id}`;
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];

  const personalizedItems = [];

  for (const li of lineItems) {
    const props = parseProps(li.properties);
    const tplId = parseInt(props['_template_id']);
    if (!Number.isFinite(tplId)) continue;

    const tpl = await env.DB
      .prepare(`SELECT * FROM customization_templates WHERE id = ?`)
      .bind(tplId).first();
    if (!tpl) continue;
    const { results: fields } = await env.DB
      .prepare(`SELECT * FROM customization_fields WHERE template_id = ? ORDER BY sort_order ASC`)
      .bind(tplId).all();

    const snapshot = { template: tpl, fields: fields || [] };
    const values = {};
    for (const f of (fields || [])) {
      const v = props[f.label];
      if (v != null) values[String(f.id)] = v;
    }
    const productTitle = li.title || tpl?.product_title || '';
    const variantTitle = li.variant_title || '';
    const color = parseColorFromVariant(variantTitle);

    const specText = buildSpecText({ productTitle, color, snapshot, values });
    const specJson = buildSpecJson({ productTitle, color, snapshot, values });

    await env.DB.prepare(
      `INSERT OR IGNORE INTO customization_orders
        (shopify_order_id, shopify_order_name, shopify_line_item_id,
         product_id, template_id, template_snapshot_json, values_json,
         production_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    ).bind(
      String(order.id), orderName, String(li.id),
      tpl.product_id, tpl.id,
      JSON.stringify(snapshot), JSON.stringify(values),
    ).run();

    personalizedItems.push({ specText, specJson, lineItemTitle: productTitle });
  }

  if (personalizedItems.length > 0) {
    const combinedNote = personalizedItems.map((p) => p.specText).join('\n\n');
    const combinedJson = { items: personalizedItems.map((p) => p.specJson) };
    try {
      await appendOrderNote(env, orderGid, combinedNote);
      await setOrderMetafield(env, orderGid, 'riccardiparis', 'personalization_spec', combinedJson);
    } catch (e) {
      console.warn('[personalizer webhook] Shopify writeback failed:', e?.message);
    }
  }

  return new Response(JSON.stringify({ processed: personalizedItems.length }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

function parseProps(arr) {
  const out = {};
  if (!Array.isArray(arr)) return out;
  for (const p of arr) if (p?.name) out[p.name] = p.value ?? '';
  return out;
}

function parseColorFromVariant(s) {
  if (!s) return '';
  const m = /(Gold|Silver|Rose Gold)/i.exec(s);
  return m ? m[1] : '';
}
