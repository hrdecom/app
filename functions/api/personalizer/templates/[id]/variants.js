/**
 * GET /api/personalizer/templates/:id/variants
 *
 * Returns the Shopify variants for the product attached to this
 * personalizer template, normalized for the per-variant override UI:
 *
 *   {
 *     items: [
 *       {
 *         id: "gid://shopify/ProductVariant/123",
 *         title: "1 Heart / Gold",
 *         options: ["1 Heart", "Gold"],          // positional
 *         option_names: ["Style", "Color"],      // positional
 *         featured_image_url: "https://..." | null
 *       }
 *     ],
 *     option_names: ["Style", "Color"],
 *     // FIX 35 — distinct color values detected for this product, in
 *     // canonical order. Source: Shopify variants when one of the
 *     // option names matches personalizer_settings.color_option_names
 *     // OR the CRM's product_variants.color column populated by the
 *     // integrator before push. Drives the "Text color per variant
 *     // value" section in FieldConfigForm so the integrator gets one
 *     // editable row per color even when Shopify's option names don't
 *     // match our heuristic (e.g. "Plating", "Finish") or when the
 *     // product hasn't been pushed to Shopify yet.
 *     color_values: ["Gold", "Silver", "Rose Gold"]
 *   }
 *
 * The caller (PersonalizerPanel) builds the variant_signature by
 * stripping option values whose option_names match
 * personalizer_settings.color_option_names_json, then slash-joining
 * what's left.
 *
 * Auth: admin or integrator.
 */

import { requireRole, json, errorJson } from '../../../../lib/auth-middleware.js';
import { graphql } from '../../../../lib/shopify-graphql.js';

export async function onRequestGet(context) {
  try {
    await requireRole(context, 'admin', 'integrator');
    const { params, env } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) return errorJson('Invalid template id', 400);

    const tpl = await env.DB
      .prepare(`SELECT id, product_id, shopify_product_handle FROM customization_templates WHERE id = ?`)
      .bind(id)
      .first();
    if (!tpl) return errorJson('Template not found', 404);
    const handle = tpl.shopify_product_handle;

    // FIX 35 — colors from the CRM's own product_variants table.
    // Loaded EVERY time because this is the most reliable source of
    // color values: the integrator populates it via the Variants tab
    // before pushing to Shopify, and it stays accurate even if the
    // Shopify product uses a non-standard option name like "Plating"
    // or "Finish" that our color-option-names heuristic doesn't catch.
    // Used as a fallback when Shopify variants don't expose colors.
    // FIX 36 — also collect the per-color image map so the admin
    // canvas can swap the base image when the integrator switches
    // the preview color pill.
    const [crmColorValues, crmColorImages] = await Promise.all([
      collectCrmColors(env.DB, tpl.product_id),
      collectCrmColorImages(env.DB, tpl.product_id),
    ]);

    if (!handle) {
      return json({
        items: [],
        option_names: [],
        color_values: crmColorValues,
        color_images: crmColorImages,
        error: 'Template has no shopify_product_handle',
      });
    }

    let data;
    try {
      data = await graphql(env, `
        query($handle: String!) {
          productByHandle(handle: $handle) {
            id
            options { name position }
            variants(first: 250) {
              edges {
                node {
                  id
                  title
                  selectedOptions { name value }
                  image { url }
                }
              }
            }
          }
        }
      `, { handle });
    } catch (e) {
      console.error('[personalizer/variants] Shopify GraphQL error:', e?.message || e);
      return errorJson(`Shopify error: ${e?.message || 'unknown'}`, 502);
    }

    const product = data?.productByHandle;
    if (!product) {
      return json({
        items: [],
        option_names: [],
        color_values: crmColorValues,
        color_images: crmColorImages,
        error: 'Product not found on Shopify',
      }, 200);
    }

    // option_names — sorted by position so the array matches the
    // selectedOptions ordering Shopify returns per variant.
    const orderedOptions = (product.options || [])
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const option_names = orderedOptions.map((o) => o.name);

    const items = (product.variants?.edges || []).map(({ node }) => {
      // Index selectedOptions by name so we can output them in the
      // canonical order_names order regardless of Shopify's response order.
      const byName = Object.fromEntries(
        (node.selectedOptions || []).map((s) => [s.name, s.value]),
      );
      const options = option_names.map((name) => byName[name] ?? '');
      return {
        id: node.id,
        title: node.title,
        options,
        option_names,
        featured_image_url: node.image?.url || null,
      };
    });

    // FIX 35 — derive Shopify-side color values too, then merge with
    // the CRM's product_variants colors so the per-color override UI
    // gets EVERY known color regardless of source. The merge is
    // case-insensitive and order-preserving (Shopify first because
    // those are the actual storefront values; CRM rows that don't
    // appear in Shopify are appended).
    const colorOptionNames = await loadColorOptionNames(env.DB);
    const shopifyColors = extractShopifyColors(items, colorOptionNames);
    const colorValues = mergeColorValues(shopifyColors, crmColorValues);

    // FIX 36 — also build a Shopify-side per-color image map so we
    // can fall back to the variant's featured_image when the CRM
    // didn't have one assigned. Merge with the CRM map (CRM wins
    // because the integrator picks those images intentionally).
    const shopifyColorImages = extractShopifyColorImages(items, colorOptionNames);
    const colorImages = { ...shopifyColorImages, ...crmColorImages };

    return json({ items, option_names, color_values: colorValues, color_images: colorImages });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Personalizer variants API error:', e);
    return errorJson('Internal server error', 500);
  }
}

/**
 * FIX 35 — pull distinct color values from the CRM product_variants
 * table. Returns them in the order they appear (insertion order from
 * the integrator's Variants tab). Empty array on no rows / no product.
 */
async function collectCrmColors(db, productId) {
  if (!productId) return [];
  try {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT color FROM product_variants
         WHERE product_id = ? AND color IS NOT NULL AND TRIM(color) != ''
         ORDER BY id ASC`,
      )
      .bind(productId)
      .all();
    const seen = new Set();
    const out = [];
    for (const row of results || []) {
      const v = String(row.color || '').trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  } catch (e) {
    console.error('[personalizer/variants] CRM colors lookup failed:', e?.message || e);
    return [];
  }
}

/**
 * FIX 36 — build a `{ color: imageUrl }` map from the CRM's
 * product_variants joined with product_images. The integrator
 * assigns one image per color via the Variants tab; we surface that
 * mapping so the admin canvas can swap the base image when the
 * integrator clicks a different "Preview color" pill.
 *
 * Picks the first image found per color (multiple variants can share
 * the same color/image combo). Empty object when no rows / no
 * images attached.
 */
async function collectCrmColorImages(db, productId) {
  if (!productId) return {};
  try {
    const { results } = await db
      .prepare(
        `SELECT pv.color, pi.url_or_key AS image_url
         FROM product_variants pv
         LEFT JOIN product_images pi ON pv.image_id = pi.id
         WHERE pv.product_id = ?
           AND pv.color IS NOT NULL AND TRIM(pv.color) != ''
           AND pi.url_or_key IS NOT NULL AND TRIM(pi.url_or_key) != ''
         ORDER BY pv.id ASC`,
      )
      .bind(productId)
      .all();
    const out = {};
    for (const row of results || []) {
      const color = String(row.color || '').trim();
      const url = String(row.image_url || '').trim();
      if (!color || !url) continue;
      const key = color.toLowerCase();
      // First-write wins so the integrator's first-configured image
      // for a given color is the canonical preview.
      if (!out[key]) out[key] = { color, url };
    }
    // Return as { "Gold": "https://...", "Silver": "...", ... }
    // (preserve original casing of color in the key).
    const finalMap = {};
    for (const v of Object.values(out)) finalMap[v.color] = v.url;
    return finalMap;
  } catch (e) {
    console.error('[personalizer/variants] CRM color images lookup failed:', e?.message || e);
    return {};
  }
}

/**
 * FIX 35 — load the merchant-configured color option names (e.g.
 * ["Color", "Couleur", "Plating"]) from personalizer_settings.
 * Falls back to the same defaults the frontend uses so behavior stays
 * consistent if the settings row hasn't been initialized yet.
 */
const DEFAULT_COLOR_OPTION_NAMES = [
  'color', 'couleur', 'colour', 'metal', 'métal', 'material', 'matière',
];
async function loadColorOptionNames(db) {
  try {
    const row = await db
      .prepare(`SELECT color_option_names_json FROM personalizer_settings WHERE id = 1`)
      .first();
    if (row?.color_option_names_json) {
      const parsed = JSON.parse(row.color_option_names_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((s) => String(s || '').toLowerCase()).filter(Boolean);
      }
    }
  } catch {
    /* settings table missing or malformed — fall through to defaults */
  }
  return DEFAULT_COLOR_OPTION_NAMES.slice();
}

/** FIX 35 — extract distinct color values from the normalized Shopify
 * variants list, matching option_names against the merchant's color
 * option names list (case-insensitive). Order = first-seen. */
function extractShopifyColors(items, colorOptionNames) {
  const skip = new Set(colorOptionNames.map((s) => String(s).toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const v of items || []) {
    for (let i = 0; i < (v.option_names || []).length; i++) {
      const name = String(v.option_names[i] || '');
      const value = String(v.options[i] || '');
      if (!name || !value) continue;
      if (!skip.has(name.toLowerCase())) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/** FIX 36 — pick the first Shopify variant image for each color
 * value. Used as a fallback when the CRM's product_variants didn't
 * have an image_id assigned for the color but Shopify does. */
function extractShopifyColorImages(items, colorOptionNames) {
  const skip = new Set(colorOptionNames.map((s) => String(s).toLowerCase()));
  const out = {};
  for (const v of items || []) {
    if (!v.featured_image_url) continue;
    for (let i = 0; i < (v.option_names || []).length; i++) {
      const name = String(v.option_names[i] || '');
      const value = String(v.options[i] || '');
      if (!name || !value) continue;
      if (!skip.has(name.toLowerCase())) continue;
      // First-write wins — preserve the canonical casing of color.
      if (!out[value]) out[value] = v.featured_image_url;
      break;
    }
  }
  return out;
}

/** FIX 35 — case-insensitive dedupe merge. Shopify values come first
 * (those are the actual storefront strings the customer's variant
 * selector will emit). CRM-only values are appended so the integrator
 * never loses access to a color they configured. */
function mergeColorValues(shopify, crm) {
  const seen = new Set();
  const out = [];
  for (const v of [...(shopify || []), ...(crm || [])]) {
    const s = String(v || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
