/**
 * Tiny GraphQL helpers for the Shopify Admin API. Used by the order
 * webhook receiver to:
 *   1. Append the supplier-facing spec block to order.note.
 *   2. Write a structured metafield (riccardiparis.personalization_spec)
 *      so downstream tooling parses without screen-scraping.
 *
 * Auth via SHOPIFY_ADMIN_TOKEN (existing wrangler secret).
 * Shop domain via SHOPIFY_SHOP env var (e.g. riccardiparis.myshopify.com).
 */

const API_VERSION = '2024-10';

export async function appendOrderNote(env, orderGid, suffix) {
  const existing = await graphql(env, `
    query($id: ID!) { order(id: $id) { id note } }
  `, { id: orderGid });
  const prevNote = existing?.order?.note || '';
  const sep = prevNote ? '\n\n' : '';
  const newNote = `${prevNote}${sep}${suffix}`;

  return graphql(env, `
    mutation($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id note }
        userErrors { field message }
      }
    }
  `, { input: { id: orderGid, note: newNote } });
}

export async function setOrderMetafield(env, orderGid, namespace, key, valueJson) {
  return graphql(env, `
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key value type }
        userErrors { field message }
      }
    }
  `, {
    metafields: [{
      ownerId: orderGid,
      namespace,
      key,
      type: 'json',
      value: JSON.stringify(valueJson),
    }],
  });
}

async function graphql(env, query, variables) {
  const shop = env.SHOPIFY_SHOP;
  const token = env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) throw new Error('Missing SHOPIFY_SHOP or SHOPIFY_ADMIN_TOKEN');

  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Shopify GraphQL ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}
