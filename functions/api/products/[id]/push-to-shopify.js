/**
 * POST /api/products/:id/push-to-shopify
 * Creates product on Shopify with variants, images, metafields, and collection assignment
 * Body: { price?, compare_at_price?, variant_prices?, collection_ids?, exclude_collection_ids?, tags?, product_type?, template_suffix?, vendor?, status? }
 */

import { requireAuth, json, errorJson } from '../../../lib/auth-middleware.js';
import { shopifyAdminFetch } from '../../../lib/shopify-auth.js';

export async function onRequest(context) {
  const { request } = context;

  try {
    if (request.method === 'POST') {
      return await handlePush(context);
    } else {
      return errorJson('Method not allowed', 405);
    }
  } catch (error) {
    if (error instanceof Response) { return error; }
    console.error('[push] API error:', error);
    return errorJson('Internal server error', 500);
  }
}

async function handlePush(context) {
  try {
  const { env, params, request } = context;
  const user = await requireAuth(context);
  const productId = parseInt(params.id);

  if (isNaN(productId)) {
    return errorJson('Invalid product ID', 400);
  }

  // Parse body (all fields optional)
  let body = {};
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await request.json();
    }
  } catch (e) {
    console.log('[push] No body or invalid JSON, using defaults');
  }

  // Validate price early — REQUIRED
  const hasPrice = body.price !== undefined && body.price !== null;
  const hasVariantPrices = body.variant_prices && typeof body.variant_prices === 'object';

  if (!hasPrice && !hasVariantPrices) {
    return json(
      { error: 'Price is required and must be greater than 0', code: 'preflight_failed', missing: ['price'] },
      400
    );
  }

  if (hasPrice) {
    const priceNum = typeof body.price === 'string' ? parseFloat(body.price) : body.price;
    if (isNaN(priceNum) || priceNum <= 0) {
      return json(
        { error: 'Price is required and must be greater than 0', code: 'preflight_failed', missing: ['price'] },
        400
      );
    }
  }

  if (hasVariantPrices) {
    for (const [color, price] of Object.entries(body.variant_prices)) {
      const priceNum = typeof price === 'string' ? parseFloat(price) : price;
      if (isNaN(priceNum) || priceNum <= 0) {
        return json(
          { error: 'Price is required and must be greater than 0', code: 'preflight_failed', missing: ['price'] },
          400
        );
      }
    }
  }

  // Load product
  const product = await env.DB
    .prepare('SELECT * FROM products WHERE id = ?')
    .bind(productId)
    .first();

  if (!product) {
    return errorJson('Product not found', 404);
  }

  // Permission: admin OR (assigned integrator AND status = 'in_progress')
  const isAdmin = user.role === 'admin';
  const isAssignedIntegrator =
    user.role === 'product-integrator' &&
    product.assigned_to === user.id &&
    product.status === 'in_progress';

  if (!isAdmin && !isAssignedIntegrator) {
    return errorJson('Access denied', 403);
  }

  // Preflight checks — ONLY title + description are blocking
  const missing = [];
  if (!product.title || !product.title.trim()) {
    missing.push('title');
  }
  if (!product.description || !product.description.trim()) {
    missing.push('description');
  }
  if (missing.length > 0) {
    return json(
      { error: 'Preflight validation failed', code: 'preflight_failed', missing },
      400
    );
  }

  console.log('[push] Starting push for product:', { productId, title: product.title });

  // Load product type configuration — try slug first, then fall back to name match
  // (handles legacy rows where product_type_slug was accidentally set to a name).
  let productType = null;
  if (product.product_type_slug) {
    productType = await env.DB
      .prepare('SELECT * FROM product_types WHERE slug = ?')
      .bind(product.product_type_slug)
      .first();
    if (!productType) {
      productType = await env.DB
        .prepare('SELECT * FROM product_types WHERE name = ?')
        .bind(product.product_type_slug)
        .first();
      if (productType) {
        console.log('[push] matched product type by NAME fallback:', productType.slug);
      }
    }
  }
  console.log('[push] productType resolved:', {
    slug: product.product_type_slug,
    shopify_product_type: productType?.shopify_product_type,
    shopify_tags: productType?.shopify_tags,
    default_tags: productType?.default_tags,
  });
  // Load collection row for tag inheritance — BEFORE any log that references it.
  let collectionRow = null;
  if (product.collection) {
    collectionRow = await env.DB
      .prepare('SELECT * FROM product_collections WHERE name = ?')
      .bind(product.collection)
      .first();
  }

  console.log('[push] product type data:', JSON.stringify(productType));
  console.log('[push] collection row data:', JSON.stringify(collectionRow));
  console.log('[push] product row (D1):', JSON.stringify({
    id: product.id,
    title: product.title,
    product_type_slug: product.product_type_slug,
    collection: product.collection,
    variant_template_slug: product.variant_template_slug,
  }));

  // Load global defaults
  const defaults = await env.DB
    .prepare('SELECT * FROM shopify_defaults WHERE id = 1')
    .first();

  if (!defaults) {
    console.error('[push] shopify_defaults row missing — applying fallback defaults');
  }

  // Load color metadata map
  const { results: colorMap = [] } = await env.DB
    .prepare('SELECT * FROM color_metadata_map')
    .all();

  const colorMapByName = {};
  for (const cm of colorMap) {
    colorMapByName[cm.color_name.toLowerCase()] = cm;
    if (cm.shopify_color_key) {
      colorMapByName[cm.shopify_color_key.toLowerCase()] = cm;
    }
  }
  console.log('[color] colorMapByName keys:', Object.keys(colorMapByName));
  console.log('[color] colorMap rows from D1:', JSON.stringify(colorMap));

  // Load variants
  const { results: variants = [] } = await env.DB
    .prepare(`
      SELECT
        pv.id,
        pv.initial,
        pv.color,
        pv.label,
        pv.image_id,
        pv.options_json,
        pi.url_or_key AS image_url
      FROM product_variants pv
      LEFT JOIN product_images pi ON pv.image_id = pi.id
      WHERE pv.product_id = ?
      ORDER BY pv.color, pv.initial
    `)
    .bind(productId)
    .all();

  const { results: productImages = [] } = await env.DB
    .prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id')
    .bind(productId)
    .all();

  // Load template only if product has one AND has variants
  let template = null;
  let colorMetafieldValues = {}; // { "Gold": "Gold", "Silver": "Silver", "Rose Gold": "Rose Gold" }
  if (product.variant_template_slug && variants.length > 0) {
    template = await env.DB
      .prepare('SELECT * FROM variant_templates WHERE slug = ?')
      .bind(product.variant_template_slug)
      .first();
    if (template?.color_metafield_values) {
      try { colorMetafieldValues = JSON.parse(template.color_metafield_values); } catch {}
    }
  }
  // Load template options (metafield-linked + custom)
  let templateOptions = [];
  if (template) {
    const { results: optRows = [] } = await env.DB.prepare(
      'SELECT * FROM variant_template_options WHERE template_id = ? ORDER BY sort_order, id',
    ).bind(template.id).all();
    templateOptions = optRows.map((r) => {
      let values = [];
      try { values = JSON.parse(r.values_json || '[]'); } catch {}
      return { ...r, values };
    });
  }
  console.log('[push] templateOptions:', templateOptions.length, templateOptions.map((o) => o.option_name));
  console.log('[push] color_metafield_values from template:', JSON.stringify(colorMetafieldValues));

  // Resolve final configuration values
  const final = {};

  final.product_type =
    body.product_type ?? productType?.shopify_product_type ?? product.product_type_slug ?? 'Jewelry';

  final.template_suffix = body.template_suffix ?? productType?.shopify_template_suffix ?? null;

  // Tags: union of body.tags + productType.shopify_tags + collectionRow.shopify_tags + productType.default_tags
  const tagsSet = new Set();
  if (body.tags && Array.isArray(body.tags)) {
    body.tags.forEach(t => tagsSet.add(String(t).trim()));
  }
  if (productType?.shopify_tags) {
    productType.shopify_tags.split(',').forEach(t => {
      const trimmed = t.trim();
      if (trimmed) tagsSet.add(trimmed);
    });
  }
  if (collectionRow?.shopify_tags) {
    collectionRow.shopify_tags.split(',').forEach(t => {
      const trimmed = t.trim();
      if (trimmed) tagsSet.add(trimmed);
    });
  }
  if (productType?.default_tags) {
    productType.default_tags.split(',').forEach(t => {
      const trimmed = t.trim();
      if (trimmed) tagsSet.add(trimmed);
    });
  }
  final.tags = Array.from(tagsSet).filter(Boolean);
  const tagsString = final.tags.join(', ');
  console.log('[push] tags built:', tagsString);
  console.log('[push] tags sources:', JSON.stringify({
    body_tags: body.tags || [],
    productType_shopify_tags: productType?.shopify_tags || null,
    productType_default_tags: productType?.default_tags || null,
    collection_shopify_tags: collectionRow?.shopify_tags || null,
    final: final.tags,
  }));

  final.vendor = body.vendor ?? defaults?.default_vendor ?? 'Riccardi';
  final.status = body.status ?? defaults?.default_status ?? 'draft';

  final.inventory_tracked = defaults?.inventory_tracked ?? 0;
  final.inventory_management = final.inventory_tracked ? 'shopify' : null;
  final.inventory_policy = 'deny';
  final.requires_shipping = defaults?.requires_shipping ?? 1;
  final.taxable = defaults?.taxable ?? 1;

  console.log('[push] Resolved config:', final);

  // Build body_html
  let bodyHtml = '';
  const paragraphs = product.description.split('\n\n').filter(p => p.trim());
  bodyHtml = paragraphs.map(p => `<p>${p.trim()}</p>`).join('\n');

  if (product.bullet_list) {
    let bullets = [];
    try {
      bullets = JSON.parse(product.bullet_list);
    } catch (e) {
      console.error('[push] bullet_list parse error:', e);
    }
    if (bullets.length > 0) {
      bodyHtml += '\n<ul>\n' + bullets.map(b => `<li>${b}</li>`).join('\n') + '\n</ul>';
    }
  }

  // Prepare variant data for post-creation GraphQL steps.
  const hasTemplateVariants = variants.length > 0;
  const capColor = (c) => (c || '').charAt(0).toUpperCase() + (c || '').slice(1).replace(/-/g, ' ');

  // ── Generic option extraction ────────────────────────────────────────────
  // Each D1 variant row carries `options_json` — a JSON-encoded
  // [{name, value}, ...] list authored by the integrator (any names allowed,
  // not just Color/Initial). The legacy `color` and `initial` columns are
  // only used as a fallback for older rows where options_json is null/empty.
  // We derive Shopify's three option slots (option1/option2/option3) from
  // a unified, deduplicated name list — NOT from the obsolete uniqueInitials
  // shape that hardcoded a [Color, Initial] layout and silently dropped any
  // third user-defined option.
  function extractOptionsFromVariant(row) {
    if (row.options_json) {
      try {
        const parsed = JSON.parse(row.options_json);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const out = [];
          for (const o of parsed) {
            if (o && typeof o.name === 'string' && o.value != null && o.value !== '') {
              out.push({ name: String(o.name), value: String(o.value) });
            }
          }
          if (out.length > 0) return out;
        }
      } catch {
        /* fall through to legacy column reconstruction */
      }
    }
    // Legacy fallback: rebuild from color + initial columns
    const out = [];
    if (row.color) out.push({ name: 'Color', value: capColor(row.color) });
    if (row.initial) out.push({ name: 'Initial', value: row.initial });
    return out;
  }

  // Build the deduplicated, ordered option-name list across ALL variants.
  // Order = first-seen order in the (color-sorted) variants list.
  // Capped at 3 — Shopify rejects products with more than 3 options.
  function unifyOptionNames(allVariants) {
    const seen = new Set();
    const order = [];
    for (const v of allVariants) {
      for (const { name } of extractOptionsFromVariant(v)) {
        if (!seen.has(name)) {
          seen.add(name);
          order.push(name);
          if (order.length >= 3) return order;
        }
      }
    }
    return order;
  }

  const optionNames = unifyOptionNames(variants);
  const uniqueColors = hasTemplateVariants ? [...new Set(variants.map((v) => v.color).filter(Boolean))] : [];

  console.log('[variants] D1 variants sample:', JSON.stringify(variants.slice(0, 3)));
  console.log('[variants] unified optionNames:', JSON.stringify(optionNames));
  console.log('[variants] uniqueColors (legacy):', JSON.stringify(uniqueColors));

  // FIX 29 — resolve images for Shopify with PREFERENCE for src URLs over
  // base64 attachments. The previous code base64-encoded every R2 image
  // into the create-product payload; with 10+ generated images this
  // easily blew past Shopify's ~20MB request cap and the API responded
  // 413 Payload Too Large (HTTP 502 from our worker because we wrap
  // upstream errors).
  //
  // Strategy: for R2 images, build the absolute public URL of our own
  // /api/images/r2/<key> proxy (it's unauthenticated — see r2/[[path]].js)
  // and hand THAT to Shopify as `src`. Shopify pulls the image from our
  // CDN-fronted Pages domain on its own time, no payload cost. Falls
  // back to base64 only if we somehow can't compute a public origin
  // (shouldn't happen in production).
  const warnings = [];
  // Compute the absolute origin of THIS request so Shopify can call
  // back into us. Cloudflare Pages always serves over https, so even
  // if request.url sneaks in http we coerce it.
  let publicOrigin = '';
  try {
    const u = new URL(request.url);
    publicOrigin = `https://${u.host}`;
  } catch { /* leave blank — we'll fall back to base64 */ }

  async function resolveImageForShopify(url) {
    if (!url || typeof url !== 'string') return null;
    const u = url.trim();

    // R2 URL — prefer public proxy URL (avoids base64 payload bloat).
    if (u.startsWith('/api/images/r2/')) {
      if (publicOrigin) {
        return { src: `${publicOrigin}${u}` };
      }
      // Fallback: base64 attachment (only if we couldn't determine
      // our own origin, which should never happen in production).
      if (env.IMAGES) {
        const key = u.replace('/api/images/r2/', '');
        const obj = await env.IMAGES.get(key);
        if (obj) {
          const buf = await obj.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          return { attachment: btoa(binary), filename: key.split('/').pop() || 'image.jpg' };
        }
      }
      return null;
    }

    // Data URL — extract base64. There's no public src equivalent so
    // we have to embed it; if the merchant has many of these the
    // 413 risk comes back, but uploaded images normally land in R2
    // so this branch is rare.
    if (u.startsWith('data:image/')) {
      const [, b64] = u.split(',');
      if (b64) return { attachment: b64, filename: 'image.jpg' };
      return null;
    }

    // Public HTTPS URL — Shopify can fetch it directly
    if (/^https:\/\//i.test(u) && !/localhost|127\.0\.0\.1|picsum/i.test(u)) {
      return { src: u };
    }

    return null;
  }

  // Collect ALL unique image URLs (product images first as general gallery, then variant-specific)
  const allImageUrls = [];
  const seenUrls = new Set();
  const pushUrl = url => { if (url && !seenUrls.has(url)) { allImageUrls.push(url); seenUrls.add(url); } };

  // Product images first (gallery)
  for (const img of productImages) pushUrl(img.url_or_key);
  // Then variant-assigned images that aren't already in the gallery
  for (const v of variants) pushUrl(v.image_url);

  const shopifyImages = [];
  // Map: original URL → index in shopifyImages array (for variant-image linking later)
  const urlToShopifyIndex = new Map();
  let skipped = 0;

  for (const url of allImageUrls) {
    const resolved = await resolveImageForShopify(url);
    if (resolved) {
      urlToShopifyIndex.set(url, shopifyImages.length);
      shopifyImages.push(resolved);
    } else {
      skipped++;
    }
  }

  if (skipped > 0 && shopifyImages.length === 0) {
    warnings.push('Some images could not be resolved for Shopify upload.');
  }
  console.log(`[push] images: ${shopifyImages.length} resolved, ${skipped} skipped from ${allImageUrls.length} total`);

  // Build Shopify product payload
  const shopifyProduct = {
    title: product.title,
    body_html: bodyHtml,
    vendor: final.vendor,
    product_type: final.product_type,
    status: final.status,
    tags: final.tags.join(', '),
  };
  console.log('[push] final payload top-level:', {
    product_type: shopifyProduct.product_type,
    tags: shopifyProduct.tags,
    vendor: shopifyProduct.vendor,
    status: shopifyProduct.status,
  });

  if (final.template_suffix) {
    shopifyProduct.template_suffix = final.template_suffix;
  }

  // STEP 1: Create product WITHOUT options/variants. Options added via GraphQL after.
  // Only include a default variant with price so Shopify accepts the product.
  shopifyProduct.variants = [{
    price: formatPrice(body.price || defaults?.default_variant_price || '29'),
    taxable: !!final.taxable,
    requires_shipping: !!final.requires_shipping,
    inventory_management: final.inventory_management,
    inventory_policy: final.inventory_policy,
  }];
  if (body.compare_at_price !== undefined) {
    shopifyProduct.variants[0].compare_at_price = formatPrice(body.compare_at_price);
  }
  if (shopifyImages.length > 0) {
    shopifyProduct.images = shopifyImages.map((img, idx) => ({
      ...img,
      position: idx + 1,
    }));
  }

  console.log('[push] Payload summary (no options — added via GraphQL after):', {
    imageCount: shopifyImages.length,
    tags: final.tags.join(', '),
  });

  console.log('[push] Creating Shopify product:', {
    productId,
    title: product.title,
    hasTemplateVariants,
    imageCount: shopifyImages.length,
  });

  // Call Shopify Admin API
  let response;
  try {
    response = await shopifyAdminFetch(env, '/products.json', {
      method: 'POST',
      body: JSON.stringify({ product: shopifyProduct })
    });
  } catch (e) {
    console.error('[push] Shopify fetch error:', e);
    return errorJson('Shopify request failed: ' + e.message, 502);
  }

  console.log('[push] shopify response status:', response.status);

  // Capture the raw body once, log it, then re-parse below.
  const rawBodyText = await response.text();
  console.log('[push] shopify response body:', rawBodyText);

  if (!response.ok) {
    console.error('[push] Shopify error:', response.status, rawBodyText);
    return json(
      {
        error: 'Shopify push failed',
        code: 'shopify_push_failed',
        upstream_status: response.status,
        upstream_body: rawBodyText,
      },
      502,
    );
  }

  let created;
  try {
    created = JSON.parse(rawBodyText);
  } catch (e) {
    console.error('[push] Shopify response parse error:', e);
    return errorJson('Failed to parse Shopify response', 502);
  }

  const shopifyProductData = created.product;
  if (!shopifyProductData || !shopifyProductData.id) {
    console.error('[push] Missing product data in Shopify response:', created);
    return errorJson('Invalid Shopify response', 502);
  }

  console.log('[push] Product created on Shopify:', {
    shopify_product_id: shopifyProductData.id,
    imageCount: shopifyProductData.images?.length,
  });

  // Save shopify_image_id back to D1 product_images (for future updates)
  const shopifyCreatedImages = shopifyProductData.images || [];
  if (shopifyCreatedImages.length > 0) {
    // allImageUrls was built in the same order as shopifyImages → shopifyCreatedImages
    const allUrls = [...new Set([...productImages.map(i => i.url_or_key), ...variants.map(v => v.image_url).filter(Boolean)])];
    for (let i = 0; i < allUrls.length && i < shopifyCreatedImages.length; i++) {
      const url = allUrls[i];
      const shopifyImgId = shopifyCreatedImages[i]?.id;
      if (!shopifyImgId || !url) continue;
      const d1Img = productImages.find(img => img.url_or_key === url);
      if (d1Img) {
        await env.DB.prepare('UPDATE product_images SET shopify_image_id = ? WHERE id = ?')
          .bind(String(shopifyImgId), d1Img.id).run();
      }
    }
    console.log('[push] saved shopify_image_id for', Math.min(allUrls.length, shopifyCreatedImages.length), 'images');
  }

  let metafieldsSet = 0;
  let collectionsAdded = 0;
  const updateStatements = [];
  const productGidFull = `gid://shopify/Product/${shopifyProductData.id}`;

  // STEP 1.5: Set taxonomy category BEFORE adding options/variants (required for metafield-linked options).
  if (productType?.shopify_category_gid) {
    try {
      console.log('[push] setting taxonomy category BEFORE variants:', productType.shopify_category_gid);
      const catRes = await shopifyAdminFetch(env, '/graphql.json', {
        method: 'POST',
        body: JSON.stringify({
          query: `mutation productUpdate($id: ID!, $cat: ID!) {
            productUpdate(input: {id: $id, category: $cat}) {
              product { id category { name } }
              userErrors { field message }
            }
          }`,
          variables: { id: productGidFull, cat: productType.shopify_category_gid },
        }),
      });
      const catJson = await catRes.json().catch(() => null);
      const ue = catJson?.data?.productUpdate?.userErrors || [];
      if (ue.length > 0) {
        console.warn('[push] taxonomy category failed:', ue.map((e) => e.message).join('; '));
      } else {
        console.log('[push] ✅ taxonomy category set:', catJson?.data?.productUpdate?.product?.category?.name);
      }
    } catch (e) {
      console.warn('[push] taxonomy category error:', e?.message);
    }
  }

  // STEP 4: REST PUT to create ALL options + variants in one call.
  let createdShopifyVariants = shopifyProductData.variants || [];

  if (hasTemplateVariants) {
    try {
      // ── STEP 3: Delete default variant ──
      const defaultVar = shopifyProductData.variants?.[0];
      if (defaultVar) {
        console.log('[variants] deleting default variant:', defaultVar.id);
        await shopifyAdminFetch(env, `/variants/${defaultVar.id}.json`, { method: 'DELETE' }).catch(() => {});
        await new Promise((r) => setTimeout(r, 500));
      }

      // ── STEP 4: REST PUT — create ALL options + variants in one call ──
      // Option layout is now derived from each variant's options_json (see
      // extractOptionsFromVariant above), not hardcoded as [Color, Initial].
      // This unblocks 3-option products like "Color × Initial × Number of pendants"
      // and any other user-defined dimension. The Color metafield linkage
      // (STEP 5 below) keys off the literal name "Color" in optionNames.
      //
      // Edge cases handled:
      //   - empty options_json (legacy row)  → falls back to color + initial
      //     columns inside extractOptionsFromVariant
      //   - >3 option names total            → unifyOptionNames caps at 3
      //   - missing value for an option name → falls back to capColor(v.color)
      //     for the Color column, otherwise '' (Shopify will reject; see
      //     validation just before the PUT)
      //   - no options_json AND no color    → variant skipped at validation
      //
      // We deliberately drop the uniqueInitials code path: "Initial" is just
      // one possible name in optionNames now, treated identically to any other
      // custom option.
      const restOptions = optionNames.length > 0
        ? optionNames.map((name) => ({ name }))
        : [{ name: 'Color' }]; // safety net for the legacy single-color flow

      const valueForOption = (variantRow, optName) => {
        const opts = extractOptionsFromVariant(variantRow);
        const hit = opts.find((o) => o.name === optName);
        if (hit) return hit.value;
        // Fallback by convention: Color option uses the column when missing
        if (optName.toLowerCase() === 'color' && variantRow.color) return capColor(variantRow.color);
        if (/^(initial|letter)$/i.test(optName) && variantRow.initial) return variantRow.initial;
        return '';
      };

      // Pre-validate every variant has a value for every declared option.
      // Shopify rejects empty option values and collapses duplicates, which
      // is exactly the silent-fail mode the old code triggered.
      const invalidRows = [];
      for (const v of variants) {
        for (const name of restOptions.map((o) => o.name)) {
          if (!valueForOption(v, name)) {
            invalidRows.push({ id: v.id, missing: name });
            break;
          }
        }
      }
      if (invalidRows.length > 0) {
        console.warn('[variants] rows missing option values:', JSON.stringify(invalidRows.slice(0, 10)));
        warnings.push(`${invalidRows.length} variant row(s) missing option values; Shopify may reject.`);
      }

      const restVariants = variants.map((v) => {
        let price = formatPrice(body.price || defaults?.default_variant_price || '29');
        if (body.variant_prices?.[v.color]) price = formatPrice(body.variant_prices[v.color]);

        const variant = {
          price,
          taxable: !!final.taxable,
          requires_shipping: !!final.requires_shipping,
          inventory_management: final.inventory_management,
          inventory_policy: final.inventory_policy,
          weight: 0,
          weight_unit: 'g',
        };
        if (body.compare_at_price !== undefined) variant.compare_at_price = formatPrice(body.compare_at_price);

        // Map declared option names → option1/option2/option3 in the same order.
        const names = restOptions.map((o) => o.name);
        if (names[0]) variant.option1 = valueForOption(v, names[0]);
        if (names[1]) variant.option2 = valueForOption(v, names[1]);
        if (names[2]) variant.option3 = valueForOption(v, names[2]);
        return variant;
      });

      console.log('[variants] REST PUT:', restVariants.length, 'variants,', restOptions.length, 'options');
      console.log('[variants] sample:', JSON.stringify(restVariants[0]));

      const putRes = await shopifyAdminFetch(env, `/products/${shopifyProductData.id}.json`, {
        method: 'PUT',
        body: JSON.stringify({
          product: { id: shopifyProductData.id, options: restOptions, variants: restVariants },
        }),
      });
      const putText = await putRes.text();
      console.log('[variants] REST PUT status:', putRes.status);

      if (putRes.ok) {
        const putJson = JSON.parse(putText);
        createdShopifyVariants = putJson?.product?.variants || [];
        console.log('[variants] ✅ created', createdShopifyVariants.length, 'variants via REST');

        // Map back to D1
        for (let i = 0; i < variants.length && i < createdShopifyVariants.length; i++) {
          updateStatements.push(
            env.DB.prepare('UPDATE product_variants SET shopify_variant_id = ? WHERE id = ?')
              .bind(String(createdShopifyVariants[i].id), variants[i].id),
          );
        }

        // ── STEP 4.5: Link images to variants ──
        let shopifyProductImages = putJson?.product?.images || shopifyProductData.images || [];
        // If PUT didn't return images, fetch them explicitly
        if (shopifyProductImages.length === 0 && shopifyImages.length > 0) {
          try {
            const imgRes = await shopifyAdminFetch(env, `/products/${shopifyProductData.id}/images.json`);
            const imgJson = await imgRes.json();
            shopifyProductImages = imgJson?.images || [];
          } catch (e) { console.warn('[images] failed to fetch images:', e?.message); }
        }
        console.log('[images] shopify images available:', shopifyProductImages.length);

        if (shopifyProductImages.length > 0) {
          let imageLinked = 0;
          for (let i = 0; i < variants.length && i < createdShopifyVariants.length; i++) {
            const v = variants[i];
            if (!v.image_url) continue;
            const imgIdx = urlToShopifyIndex.get(v.image_url);
            if (imgIdx === undefined || imgIdx >= shopifyProductImages.length) continue;
            const shopifyImageId = shopifyProductImages[imgIdx]?.id;
            if (!shopifyImageId) continue;

            try {
              const linkRes = await shopifyAdminFetch(env, `/variants/${createdShopifyVariants[i].id}.json`, {
                method: 'PUT',
                body: JSON.stringify({ variant: { id: createdShopifyVariants[i].id, image_id: shopifyImageId } }),
              });
              if (linkRes.ok) {
                imageLinked++;
              } else {
                const errText = await linkRes.text();
                console.warn('[images] variant image link failed:', createdShopifyVariants[i].id, errText.slice(0, 200));
              }
            } catch (e) {
              console.warn('[images] variant image link error:', e?.message);
            }
          }
          console.log(`[images] ✅ linked ${imageLinked} variant images`);
        }

        // ── STEP 5: Link Color option to metafield via GraphQL ──
        // Trigger: option literally named "Color" (case-insensitive) is present
        // in the unified optionNames list. The old gate (isMultiOption) was
        // removed — it conflated "has more than one option" with "has Color",
        // which broke for products whose only option was Color.
        const hasColorOption = optionNames.some((n) => n.toLowerCase() === 'color')
          || (optionNames.length === 0 && uniqueColors.length > 0); // legacy safety net
        await new Promise((r) => setTimeout(r, 1000));
        if (hasColorOption) {
        try {
          // Query Shopify metaobjects LIVE for color swatches
          const moMap = {};
          try {
            const moRes = await shopifyAdminFetch(env, '/graphql.json', {
              method: 'POST',
              body: JSON.stringify({
                query: `{ metaobjects(type: "shopify--color-pattern", first: 50) { nodes { id displayName fields { key value } } } }`,
              }),
            });
            const moJson = await moRes.json();
            for (const n of moJson?.data?.metaobjects?.nodes || []) {
              const label = n.fields?.find(f => f.key === 'label')?.value || n.displayName;
              moMap[label] = n.id;
              moMap[n.displayName] = n.id;
            }
          } catch {
            const { results: moRows = [] } = await env.DB.prepare('SELECT color_name, metaobject_gid FROM shopify_color_metaobjects').all();
            for (const r of moRows) moMap[r.color_name] = r.metaobject_gid;
          }
          const findGid = (name) => {
            if (moMap[name]) return moMap[name];
            for (const [k, v] of Object.entries(moMap)) { if (k.toLowerCase() === name.toLowerCase()) return v; }
            return null;
          };

          if (Object.keys(moMap).length > 0) {
            const ovRes = await shopifyAdminFetch(env, '/graphql.json', {
              method: 'POST',
              body: JSON.stringify({
                query: `{ product(id: "${productGidFull}") { options { id name optionValues { id name } } } }`,
              }),
            });
            const ovJson = await ovRes.json().catch(() => null);
            const colorOpt = (ovJson?.data?.product?.options || []).find((o) => o.name === 'Color');
            const realVals = (colorOpt?.optionValues || []).filter((v) => v.name !== 'Default Title');

            if (colorOpt?.id && realVals.length > 0) {
              const mapped = realVals.map((ov) => {
                const gid = findGid(ov.name);
                return gid ? { id: ov.id, linkedMetafieldValue: gid } : null;
              }).filter(Boolean);

              if (mapped.length > 0) {
                console.log('[options] linking', mapped.length, 'color values to metafield');
                const linkRes = await shopifyAdminFetch(env, '/graphql.json', {
                  method: 'POST',
                  body: JSON.stringify({
                    query: `mutation up($pid: ID!, $opt: OptionUpdateInput!, $vals: [OptionValueUpdateInput!]) {
                      productOptionUpdate(productId: $pid, option: $opt, optionValuesToUpdate: $vals) {
                        product { options { id name linkedMetafield { namespace key } } }
                        userErrors { field message }
                      }
                    }`,
                    variables: {
                      pid: productGidFull,
                      opt: { id: colorOpt.id, linkedMetafield: { namespace: 'shopify', key: 'color-pattern' } },
                      vals: mapped,
                    },
                  }),
                });
                const linkText = await linkRes.text();
                console.log('[options] link result:', linkText.slice(0, 800));
                const linkUe = JSON.parse(linkText)?.data?.productOptionUpdate?.userErrors || [];
                if (linkUe.length > 0) {
                  warnings.push('Color link: ' + linkUe.map((e) => e.message).join('; '));
                } else {
                  console.log('[options] ✅ Color linked to shopify.color-pattern');
                }
              }
            }
          }
        } catch (e) {
          console.warn('[options] link error (non-fatal):', e?.message);
        }
        } // end if (hasColorOption)
      } else {
        console.error('[variants] REST PUT failed:', putText.slice(0, 500));
        warnings.push('Variant creation failed: HTTP ' + putRes.status);
      }
    } catch (e) {
      console.error('[variants] fatal error:', e?.message, e?.stack?.slice(0, 500));
      warnings.push('Failed to create variants: ' + (e?.message || 'unknown'));
    }
  }

  // Taxonomy category already set in STEP 1.5 above.

  // Collection assignment
  // Compute: (body.collection_ids ∪ productType.include_collection_ids) − (body.exclude_collection_ids ∪ productType.exclude_collection_ids ∪ defaults.exclude_collection_ids)
  const includeSet = new Set();
  const excludeSet = new Set();

  if (body.collection_ids && Array.isArray(body.collection_ids)) {
    body.collection_ids.forEach(id => includeSet.add(String(id)));
  }

  if (productType?.include_collection_ids) {
    try {
      const arr = JSON.parse(productType.include_collection_ids);
      arr.forEach(id => includeSet.add(String(id)));
    } catch (e) {
      console.error('[push] Failed to parse productType.include_collection_ids:', e);
    }
  }

  if (body.exclude_collection_ids && Array.isArray(body.exclude_collection_ids)) {
    body.exclude_collection_ids.forEach(id => excludeSet.add(String(id)));
  }

  if (productType?.exclude_collection_ids) {
    try {
      const arr = JSON.parse(productType.exclude_collection_ids);
      arr.forEach(id => excludeSet.add(String(id)));
    } catch (e) {
      console.error('[push] Failed to parse productType.exclude_collection_ids:', e);
    }
  }

  if (defaults?.exclude_collection_ids) {
    try {
      const arr = JSON.parse(defaults.exclude_collection_ids);
      arr.forEach(id => excludeSet.add(String(id)));
    } catch (e) {
      console.error('[push] Failed to parse defaults.exclude_collection_ids:', e);
    }
  }

  const finalCollectionIds = [...includeSet].filter(id => !excludeSet.has(id));

  console.log('[push] Collection IDs to assign:', finalCollectionIds);

  for (const collectionId of finalCollectionIds) {
    try {
      const collectRes = await shopifyAdminFetch(env, '/collects.json', {
        method: 'POST',
        body: JSON.stringify({
          collect: {
            product_id: shopifyProductData.id,
            collection_id: collectionId
          }
        })
      });

      if (collectRes.ok) {
        collectionsAdded++;
      } else {
        const errText = await collectRes.text();
        console.error('[push] Collect creation failed:', errText);
        warnings.push(`Failed to add collection ${collectionId}`);
      }
    } catch (e) {
      console.error('[push] Collect error:', e);
      warnings.push(`Error adding collection ${collectionId}`);
    }
  }

  // FIX 25c — explicitly publish the new product to the Online Store
  // sales channel. The premise of the old "Shopify auto-publishes new
  // products everywhere" comment below is no longer true under the
  // 2024-10+ Admin API: products created via REST POST /products.json
  // are NOT auto-published to the Online Store publication. Without
  // this block the product appears in the admin but is invisible on
  // the storefront (the merchant sees "Online Store" greyed out on
  // the product's Sales Channels list).
  let onlineStorePublished = false;
  try {
    const onlineStoreGqlRes = await shopifyAdminFetch(env, '/graphql.json', {
      method: 'POST',
      body: JSON.stringify({
        query: `{ publications(first: 100) { edges { node { id name } } } }`,
      }),
    });
    const osGql = await onlineStoreGqlRes.json().catch(() => null);
    const allPubs = (osGql?.data?.publications?.edges || []).map((e) => e?.node).filter(Boolean);
    // Match by exact name (Shopify always names this publication
    // "Online Store" in English admins; we accept the localized
    // French label "Boutique en ligne" too just in case the merchant
    // is on a fr-FR admin).
    const onlineStorePub = allPubs.find(
      (p) => p?.name === 'Online Store' || p?.name === 'Boutique en ligne',
    );
    if (!onlineStorePub) {
      console.warn('[publish] Online Store publication not found in publications list');
      warnings.push('Online Store publication not found — product was not published to storefront. Check Sales Channels on the product page.');
    } else {
      const productGid = `gid://shopify/Product/${shopifyProductData.id}`;
      const pubRes = await shopifyAdminFetch(env, '/graphql.json', {
        method: 'POST',
        body: JSON.stringify({
          query: `mutation {
            publishablePublish(
              id: "${productGid}",
              input: { publicationId: "${onlineStorePub.id}" }
            ) {
              publishable { ... on Product { id } }
              userErrors { field message }
            }
          }`,
        }),
      });
      const pubText = await pubRes.text();
      const pubJson = JSON.parse(pubText);
      const pubErrs = pubJson?.data?.publishablePublish?.userErrors || [];
      if (pubErrs.length === 0) {
        onlineStorePublished = true;
        console.log('[publish] ✅ published to Online Store:', onlineStorePub.id);
      } else {
        const msg = pubErrs.map((e) => e.message).join('; ');
        console.error('[publish] Online Store publish failed:', msg);
        warnings.push(`Online Store publish failed: ${msg}`);
      }
    }
  } catch (e) {
    console.error('[publish] Online Store publish error:', e?.message || e);
    warnings.push('Online Store publish error — check logs.');
  }

  // UNPUBLISH from excluded markets via GraphQL publishableUnpublish.
  // We use publishableUnpublish with publicationIds (plural array) to remove from excluded markets.
  let marketsUnpublished = 0;
  try {
    const { results: marketSettings = [] } = await env.DB
      .prepare('SELECT market_id, market_name, excluded, publication_id FROM shopify_market_settings')
      .all();
    console.log('[market] D1 rows:', JSON.stringify(marketSettings));

    const excludedRows = marketSettings.filter((r) => r.excluded);

    if (excludedRows.length === 0) {
      console.log('[market] no excluded markets — product stays published everywhere');
    } else {
      // Collect publication GIDs for excluded markets.
      // D1 stores numeric IDs; we need full GIDs for GraphQL.
      const pubGids = [];
      const pubGidMap = {}; // market_id → full GID

      // First use whatever is stored in D1
      for (const r of excludedRows) {
        if (r.publication_id) {
          const gid = String(r.publication_id).startsWith('gid://')
            ? r.publication_id
            : `gid://shopify/Publication/${r.publication_id}`;
          pubGids.push(gid);
          pubGidMap[r.market_id] = gid;
        }
      }

      // For markets missing publication_id, fetch from GraphQL and persist
      const missingPub = excludedRows.filter((r) => !r.publication_id);
      if (missingPub.length > 0) {
        console.log('[market] fetching publication GIDs from GraphQL for', missingPub.length, 'market(s)');
        try {
          const gqlRes = await shopifyAdminFetch(env, '/graphql.json', {
            method: 'POST',
            body: JSON.stringify({
              query: `{ markets(first: 50) { nodes { id name catalogs(first: 5) { nodes { publication { id } } } } } }`,
            }),
          });
          const gql = await gqlRes.json().catch(() => null);
          const mktNodes = gql?.data?.markets?.nodes || [];
          const updateStmts = [];
          for (const mk of mktNodes) {
            const numId = String((mk.id || '').split('/').pop());
            const pubFullGid = mk.catalogs?.nodes?.[0]?.publication?.id || null;
            if (pubFullGid && excludedRows.some((r) => String(r.market_id) === numId) && !pubGidMap[numId]) {
              pubGids.push(pubFullGid);
              pubGidMap[numId] = pubFullGid;
              const numPub = String(pubFullGid.split('/').pop());
              updateStmts.push(
                env.DB.prepare('UPDATE shopify_market_settings SET publication_id = ? WHERE market_id = ?')
                  .bind(numPub, numId),
              );
            }
          }
          if (updateStmts.length > 0) {
            await env.DB.batch(updateStmts);
            console.log('[market] saved', updateStmts.length, 'publication_id(s) to D1');
          }
        } catch (e) {
          console.warn('[market] GraphQL market fetch failed:', e?.message);
        }
      }

      console.log('[market] excluded publication GIDs to unpublish:', pubGids);

      if (pubGids.length === 0) {
        console.log('[market] ⚠️ no publication GIDs found for excluded markets');
        warnings.push('Excluded markets have no publication IDs — cannot unpublish. Save market settings in admin first.');
      } else {
        // Call publishableUnpublish ONCE PER publication (singular publicationId).
        const productGid = `gid://shopify/Product/${shopifyProductData.id}`;
        console.log('[market] unpublishing product', productGid, 'from', pubGids.length, 'publication(s)');

        for (const pubGid of pubGids) {
          try {
            console.log('[market] unpublishing from publication:', pubGid);
            const mutRes = await shopifyAdminFetch(env, '/graphql.json', {
              method: 'POST',
              body: JSON.stringify({
                query: `mutation {
                  publishableUnpublish(
                    id: "${productGid}",
                    input: { publicationId: "${pubGid}" }
                  ) {
                    publishable { ... on Product { id } }
                    userErrors { field message }
                  }
                }`,
              }),
            });
            const mutText = await mutRes.text();
            console.log('[market] unpublish result:', mutText.slice(0, 500));
            const mutJson = JSON.parse(mutText);
            const ue = mutJson?.data?.publishableUnpublish?.userErrors || [];
            if (ue.length === 0) {
              marketsUnpublished++;
              console.log('[market] ✅ unpublished from:', pubGid);
            } else {
              const msg = ue.map((e) => e.message).join('; ');
              console.error('[market] unpublish failed for', pubGid, ':', msg);
              warnings.push(`Unpublish from ${pubGid}: ${msg}`);
            }
          } catch (e) {
            console.error('[market] unpublish error for', pubGid, ':', e?.message);
            warnings.push(`Error unpublishing from ${pubGid}`);
          }
        }

        console.log('[market] summary — unpublished from', marketsUnpublished, 'of', pubGids.length, 'publication(s)');
      }
    }
  } catch (e) {
    console.error('[market] block error:', e);
  }

  // Build URLs:
  //  - shopifyUrl      → storefront link (used in Preview tab + ads brief)
  //  - shopifyAdminUrl → admin editor at https://admin.shopify.com/store/<shop-handle>/products/<id>
  const shopDomain = env.SHOPIFY_SHOP?.replace(/^https?:\/\//, '').replace(/\/+$/, '') || '';
  const shopHandle = shopDomain.replace(/\.myshopify\.com$/, '');
  const shopifyAdminUrl = shopHandle
    ? `https://admin.shopify.com/store/${shopHandle}/products/${shopifyProductData.id}`
    : `https://${shopDomain}/admin/products/${shopifyProductData.id}`;

  let shopifyUrl = shopifyAdminUrl;
  if (defaults?.shopify_primary_domain) {
    const primaryDomain = String(defaults.shopify_primary_domain).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const handle = shopifyProductData.handle;
    if (primaryDomain && handle) {
      shopifyUrl = `https://${primaryDomain}/products/${handle}`;
    }
  }

  // Persist changes
  const previousStatus = product.status;

  const persistStatements = [
    ...updateStatements,
    env.DB
      .prepare(`
        UPDATE products
        SET shopify_product_id = ?, shopify_url = ?, shopify_admin_url = ?, shopify_price = ?, status = 'pushed_to_shopify', updated_at = datetime('now')
        WHERE id = ?
      `)
      .bind(String(shopifyProductData.id), shopifyUrl, shopifyAdminUrl, formatPrice(body.price || defaults?.default_variant_price || '29'), productId),
    env.DB
      .prepare(`
        INSERT INTO workflow_events (product_id, actor_user_id, from_status, to_status, note)
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(productId, user.id, previousStatus, 'pushed_to_shopify', 'Pushed to Shopify')
  ];

  await env.DB.batch(persistStatements);

  console.log('[push] Success:', {
    productId,
    shopify_product_id: shopifyProductData.id,
    metafieldsSet,
    collectionsAdded
  });

  return json({
    ok: true,
    shopify_product_id: String(shopifyProductData.id),
    shopify_url: shopifyUrl,
    shopify_admin_url: shopifyAdminUrl,
    admin_url: shopifyAdminUrl,
    variants: createdShopifyVariants,
    warnings,
    collections_added: collectionsAdded,
    markets_unpublished: marketsUnpublished,
    // FIX 25c — let the UI confirm the storefront is reachable
    online_store_published: onlineStorePublished,
  });

  } catch (err) {
    console.error('[push] FATAL ERROR:', err?.message, err?.stack);
    return json(
      {
        error: 'push_failed',
        message: String(err?.message || 'Unknown error'),
        stack: String(err?.stack || '').slice(0, 2000),
      },
      500,
    );
  }
}

/**
 * Format price as string with 2 decimals
 */
function formatPrice(value) {
  if (value === null || value === undefined) return '0.00';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0.00';
  return num.toFixed(2);
}
