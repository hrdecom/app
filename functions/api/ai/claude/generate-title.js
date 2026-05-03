/**
 * POST /api/ai/claude/generate-title — Real Claude API + mock fallback.
 */

import { requireAuth, json, errorJson } from '../../../lib/auth-middleware.js';

async function buildImageContent(imageUrl, env) {
  if (imageUrl.startsWith('data:')) {
    const [header, base64data] = imageUrl.split(',');
    const mediaType = (header.match(/data:(.*);base64/) || [])[1] || 'image/png';
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64data } };
  }
  // R2 URLs — fetch from bucket and convert to base64
  if (imageUrl.startsWith('/api/images/r2/') && env?.IMAGES) {
    const key = imageUrl.replace('/api/images/r2/', '');
    const obj = await env.IMAGES.get(key);
    if (obj) {
      const buf = await obj.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);
      const mime = obj.httpMetadata?.contentType || 'image/png';
      return { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };
    }
  }
  return { type: 'image', source: { type: 'url', url: imageUrl } };
}

const MOCK_NAMES = [
  'Luna', 'Nova', 'Aria', 'Seraph', 'Celeste', 'Stella', 'Lyra', 'Aurora',
  'Eden', 'Iris', 'Maya', 'Jade', 'Cleo', 'Nyx', 'Vega', 'Pearl', 'Opal',
  'Wren', 'Ivy', 'Zara', 'Sage', 'Nia', 'Alma', 'Bea', 'Dara', 'Enya',
];

export async function onRequest(context) {
  const { request } = context;
  try {
    if (request.method !== 'POST') return errorJson('Method not allowed', 405);
    return await handlePost(context);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Generate title API error:', error);
    return errorJson('Internal server error', 500);
  }
}

async function handlePost(context) {
  const { request, env } = context;
  await requireAuth(context);
  console.log('[gen-title] ANTHROPIC_API_KEY present:', !!env.ANTHROPIC_API_KEY, 'length:', env.ANTHROPIC_API_KEY?.length);

  let body;
  try { body = await request.json(); } catch { return errorJson('Invalid JSON body', 400); }

  // FIX 26c — extra_prompt is per-request integrator guidance (e.g.
  // "this is a ring with 2 customizable initials"). Optional. Same
  // shape as on /generate-description.
  const { product_id, extra_prompt } = body;
  if (!product_id) return errorJson('product_id is required', 400);
  const productId = parseInt(product_id);
  if (isNaN(productId)) return errorJson('Invalid product_id', 400);
  const cleanExtraPrompt = typeof extra_prompt === 'string'
    ? extra_prompt.trim().slice(0, 1000)
    : '';

  const image = await env.DB
    .prepare('SELECT url_or_key as url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1')
    .bind(productId).first();
  if (!image) return errorJson('Please add at least one image before generating a title', 400);

  // Load previous name_parts to exclude
  const { results: historyRows = [] } = await env.DB
    .prepare('SELECT suggestions FROM title_generation_history WHERE product_id = ? ORDER BY created_at DESC')
    .bind(productId).all();
  const previousNames = new Set();
  for (const row of historyRows) {
    try { const arr = JSON.parse(row.suggestions); if (Array.isArray(arr)) arr.forEach((s) => previousNames.add(String(s.name_part || '').toLowerCase())); } catch {}
  }

  const product = await env.DB.prepare('SELECT product_type_slug, collection FROM products WHERE id = ?').bind(productId).first();

  // Load blacklist for the prompt context (names IA must avoid).
  // FIX 26d (v2) — include both the product type's own blacklist AND
  // the defensive __shopify_unmatched__ bucket (titles imported from
  // Shopify where we couldn't infer the product type — blocked
  // everywhere by design). The safety filter at the bottom of this
  // file uses the same scope, so what we tell IA matches what we
  // actually enforce.
  if (product?.product_type_slug) {
    const { results: bl = [] } = await env.DB
      .prepare(
        `SELECT name FROM title_blacklist
          WHERE product_type_slug = ? OR product_type_slug = '__shopify_unmatched__'`,
      )
      .bind(product.product_type_slug).all();
    bl.forEach((b) => previousNames.add(String(b.name).toLowerCase()));
  } else {
    // No product type yet → still warn IA off the unmatched bucket.
    const { results: bl = [] } = await env.DB
      .prepare("SELECT name FROM title_blacklist WHERE product_type_slug = '__shopify_unmatched__'").all();
    bl.forEach((b) => previousNames.add(String(b.name).toLowerCase()));
  }

  // Load templates + options
  const templateRows = await env.DB
    .prepare("SELECT key, content FROM ai_prompts WHERE tool = 'claude' AND key IN ('claude.title.template', 'claude.format.ring', 'claude.format.other')")
    .all();
  const templates = {};
  (templateRows.results || []).forEach((r) => { templates[r.key] = r.content; });

  const titleTemplate = templates['claude.title.template'] || '';
  const formatWithCollection = templates['claude.format.ring'] || '{{collection}} {{product_type}} "{{name}}"';
  const formatWithoutCollection = templates['claude.format.other'] || '{{product_type}} "{{name}}"';

  const typesResult = await env.DB.prepare('SELECT name, slug FROM product_types WHERE is_active = 1 ORDER BY sort_order ASC').all();
  const productTypes = typesResult.results || [];
  const collectionsResult = await env.DB.prepare('SELECT name FROM product_collections WHERE is_active = 1 ORDER BY sort_order ASC').all();
  const collections = (collectionsResult.results || []).map((c) => c.name);

  const selectedTypeSlug = body.product_type_slug || product?.product_type_slug || null;
  let productTypeName = 'unknown';
  let productTypeRow = null;
  if (selectedTypeSlug) {
    productTypeRow = productTypes.find((t) => t.slug === selectedTypeSlug) || productTypes.find((t) => t.name === selectedTypeSlug);
    if (productTypeRow) productTypeName = productTypeRow.name;
  }

  // Load the product type's custom Claude prompt from DB
  let typeClaudePrompt = '';
  if (productTypeRow?.slug) {
    const ptRow = await env.DB.prepare('SELECT claude_prompt FROM product_types WHERE slug = ?').bind(productTypeRow.slug).first();
    if (ptRow?.claude_prompt) typeClaudePrompt = ptRow.claude_prompt;
  }

  const selectedCollection = body.collection || product?.collection || null;
  const blacklistedNames = Array.from(previousNames).join('\n');

  let prompt = titleTemplate
    .replace('{{product_type}}', productTypeName)
    .replace('{{collection_list}}', JSON.stringify(collections))
    .replace('{{source_links}}', '')
    .replace('{{blacklisted_names}}', blacklistedNames);

  // Inject product-type-specific instructions
  if (typeClaudePrompt) {
    prompt += `\n\n--- PRODUCT TYPE SPECIFIC INSTRUCTIONS ---\n${typeClaudePrompt}`;
  }

  // FIX 26c — per-request integrator context (e.g. "ring with 2
  // customizable initials"). Surfaced last so Claude weights it most.
  if (cleanExtraPrompt) {
    prompt += `\n\n--- ADDITIONAL CONTEXT FROM THE PRODUCT TEAM ---\n${cleanExtraPrompt}`;
  }

  prompt += `\n\nIMPORTANT: The product type is "${productTypeName}". ALL suggestions MUST use this exact product type regardless of what the image looks like. The user has already determined the product type.`;
  if (selectedCollection) {
    prompt += `\nThe product belongs to collection "${selectedCollection}". Use this collection for all suggestions.`;
  }
  prompt += '\n\nCollections are OPTIONAL. Most products have NO collection. Return collection: null unless the product already has one or the image clearly matches one.';
  prompt += '\n\nRespond with ONLY valid JSON array: [{"product_type":"...","collection":null or "...","name_part":"...","is_recommended":true/false}, ...] exactly 5 items.';

  let suggestions = null;

  // Try real Claude API
  if (env.ANTHROPIC_API_KEY) {
    try {
      console.log('[gen-title] calling Claude API with image:', image.url?.slice(0, 80));
      const imageContent = await buildImageContent(image.url, env);
      const claudeBody = {
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            imageContent,
            { type: 'text', text: prompt },
          ],
        }],
      };

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(claudeBody),
      });

      if (claudeRes.ok) {
        const claudeData = await claudeRes.json();
        const textContent = claudeData.content?.find((c) => c.type === 'text')?.text || '';
        console.log('[gen-title] Claude raw response:', textContent.slice(0, 500));

        // Parse JSON from response
        const jsonMatch = textContent.match(/```json\s*([\s\S]*?)\s*```/) || textContent.match(/\[[\s\S]*\]/);
        const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : textContent;
        try {
          const parsed = JSON.parse(jsonStr);
          console.log('[gen-title] parsed JSON type:', Array.isArray(parsed) ? 'array' : typeof parsed, 'length:', parsed?.length);
          console.log('[gen-title] parsed suggestions:', JSON.stringify(parsed).slice(0, 500));
          if (Array.isArray(parsed) && parsed.length > 0) {
            suggestions = parsed.slice(0, 5);
            console.log('[gen-title] ✅ Claude returned', suggestions.length, 'suggestions');
          } else {
            console.warn('[gen-title] parsed result is not an array with items');
          }
        } catch (e) {
          console.warn('[gen-title] JSON parse failed:', e?.message, 'jsonStr:', jsonStr?.slice(0, 200));
        }
      } else {
        const errText = await claudeRes.text();
        console.error('[gen-title] Claude API error:', claudeRes.status, errText.slice(0, 300));
      }
    } catch (e) {
      console.error('[gen-title] Claude API call failed:', e?.message);
    }
  }

  // Fallback to mock if Claude didn't return results
  if (!suggestions) {
    console.log('[gen-title] using mock fallback');
    const available = MOCK_NAMES.filter((n) => !previousNames.has(n.toLowerCase()));
    const picked = available.slice(0, 5);
    let counter = 1;
    while (picked.length < 5) { const f = `Gem${counter++}`; if (!previousNames.has(f.toLowerCase())) picked.push(f); if (counter > 100) break; }
    suggestions = picked.map((name, idx) => ({
      product_type: productTypeName !== 'unknown' ? productTypeName : 'Initial Necklace',
      collection: idx === 3 && collections.length > 0 ? collections[0] : null,
      name_part: name,
      is_recommended: idx === 0,
    }));
  }

  // FIX 26d (v2) — per-type blacklist filter. Was global, which made
  // every name reused on a single product type silently block the same
  // name on EVERY type forever ("Sparkle Gold" on a bracelet
  // shouldn't prevent the same "Sparkle Gold" on a necklace).
  // We now filter against:
  //   - the current product type's blacklist (the merchant's intent)
  //   - the unmatched-Shopify bucket (defensive: titles where we
  //     couldn't infer the product type are blocked everywhere so
  //     they're never accidentally reused).
  // The legacy `__shopify__` slug from v1 imports is intentionally
  // NOT in this scope — those rows are full-title strings that can
  // never match a name_part anyway, and import-shopify v2 deletes
  // them at the start of every run.
  const blacklistSlug = productTypeRow?.slug || selectedTypeSlug || null;
  let blacklistRows = [];
  if (blacklistSlug) {
    const { results = [] } = await env.DB
      .prepare(
        `SELECT name FROM title_blacklist
          WHERE product_type_slug = ? OR product_type_slug = '__shopify_unmatched__'`,
      )
      .bind(blacklistSlug).all();
    blacklistRows = results;
  } else {
    // No type selected (rare) → only the defensive unmatched bucket.
    const { results = [] } = await env.DB
      .prepare("SELECT name FROM title_blacklist WHERE product_type_slug = '__shopify_unmatched__'").all();
    blacklistRows = results;
  }
  const globalBlSet = new Set(blacklistRows.map((b) => String(b.name).toLowerCase()));
  const beforeFilter = suggestions.length;
  suggestions = suggestions.filter((s) => !globalBlSet.has(String(s.name_part).toLowerCase()));
  console.log('[gen-title] blacklist filtered:', beforeFilter, '→', suggestions.length, '(scope:', blacklistSlug || 'unmatched-only', 'size:', globalBlSet.size, ')');

  // Pad if needed — but don't use "Gem" names, just allow shorter list
  if (suggestions.length === 0 && beforeFilter > 0) {
    // All Claude results were blacklisted — return them anyway with a note
    console.warn('[gen-title] all suggestions blacklisted, returning unfiltered');
    suggestions = suggestions.length > 0 ? suggestions : (Array.isArray(body) ? [] : []);
  }
  suggestions = suggestions.slice(0, 5);
  if (suggestions.length > 0 && !suggestions.some((s) => s.is_recommended)) suggestions[0].is_recommended = true;
  console.log('[gen-title] returning:', suggestions.length, 'suggestions, ai:', !!env.ANTHROPIC_API_KEY);

  // Format titles — always use the resolved product type name, never Claude's returned value
  const finalSuggestions = suggestions.map((s) => {
    const hasCollection = !!(s.collection && String(s.collection).trim());
    const format = hasCollection ? formatWithCollection : formatWithoutCollection;
    const title = format
      .replace('{{collection}}', hasCollection ? s.collection : '')
      .replace('{{name}}', s.name_part)
      .replace('{{product_type}}', productTypeName)
      .replace(/\s+/g, ' ').trim();
    return { title, product_type: productTypeName, collection: hasCollection ? s.collection : null, name_part: s.name_part, is_recommended: !!s.is_recommended };
  });

  // Save history
  try {
    await env.DB.prepare('INSERT INTO title_generation_history (product_id, suggestions) VALUES (?, ?)')
      .bind(productId, JSON.stringify(finalSuggestions)).run();
  } catch {}

  let product_type_options = [];
  let collection_options = [];
  try {
    product_type_options = productTypes.map((t) => ({ name: t.name, slug: t.slug }));
    collection_options = collections;
  } catch {}

  return json({
    suggestions: finalSuggestions,
    image_used: image.url,
    product_type_options,
    collection_options,
    ai: !!env.ANTHROPIC_API_KEY,
  });
}
