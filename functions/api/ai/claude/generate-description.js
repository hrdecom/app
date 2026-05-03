/**
 * POST /api/ai/claude/generate-description — Real Claude API + mock fallback.
 */

import { requireAuth, json, errorJson } from '../../../lib/auth-middleware.js';

async function buildImageContent(imageUrl, env) {
  if (imageUrl.startsWith('data:')) {
    const [header, base64data] = imageUrl.split(',');
    const mediaType = (header.match(/data:(.*);base64/) || [])[1] || 'image/png';
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64data } };
  }
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

export async function onRequest(context) {
  const { request } = context;
  try {
    if (request.method !== 'POST') return errorJson('Method not allowed', 405);
    return await handlePost(context);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Generate description API error:', error);
    return errorJson('Internal server error', 500);
  }
}

const MOCK_PARAGRAPHS = [
  ['A delicate piece crafted to carry meaning close to your heart, designed with timeless elegance for everyday wear.',
   'The perfect gift for someone special, combining modern style with a personal touch that lasts a lifetime.'],
  ['Effortlessly chic, this piece blends understated luxury with everyday wearability for those who value both form and function.',
   'Whether you are treating yourself or gifting a loved one, this design captures a timeless spirit that transcends trends.'],
  ['A refined accessory that elevates any look, meticulously finished with attention to every detail.',
   'Designed for the modern individual who appreciates craftsmanship, comfort, and lasting beauty.'],
];

async function handlePost(context) {
  const { request, env } = context;
  await requireAuth(context);
  console.log('[gen-desc] ANTHROPIC_API_KEY present:', !!env.ANTHROPIC_API_KEY, 'length:', env.ANTHROPIC_API_KEY?.length);

  let body;
  try { body = await request.json(); } catch { return errorJson('Invalid JSON body', 400); }

  // FIX 26c — extra_prompt lets the integrator inject per-request
  // context (e.g. "this ring has 2 customizable initials") so Claude
  // tailors the copy to product specifics that aren't visible in the
  // image. Optional. Trimmed and capped to 1000 chars to keep the
  // prompt budget sane.
  const { product_id, product_type_slug, extra_prompt } = body;
  if (!product_id) return errorJson('product_id is required', 400);
  const productId = parseInt(product_id);
  if (isNaN(productId)) return errorJson('Invalid product_id', 400);
  const cleanExtraPrompt = typeof extra_prompt === 'string'
    ? extra_prompt.trim().slice(0, 1000)
    : '';

  const image = await env.DB
    .prepare('SELECT url_or_key as url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1')
    .bind(productId).first();
  if (!image) return errorJson('Please add at least one image before generating a description', 400);

  // Resolve product type + bullet template
  const product = await env.DB.prepare('SELECT product_type_slug, title FROM products WHERE id = ?').bind(productId).first();
  const resolvedSlug = product_type_slug || product?.product_type_slug || null;

  let bullets = '';
  let typeClaudePrompt = '';
  let productTypeName = resolvedSlug || 'jewelry';
  if (resolvedSlug) {
    let typeRow = await env.DB.prepare('SELECT name, bullet_template, claude_prompt FROM product_types WHERE slug = ?').bind(resolvedSlug).first();
    if (!typeRow) typeRow = await env.DB.prepare('SELECT name, bullet_template, claude_prompt FROM product_types WHERE name = ?').bind(resolvedSlug).first();
    if (typeRow) {
      productTypeName = typeRow.name || resolvedSlug;
      if (typeRow.claude_prompt) typeClaudePrompt = typeRow.claude_prompt;
      if (typeRow.bullet_template) {
        try {
          const parsed = JSON.parse(typeRow.bullet_template);
          if (Array.isArray(parsed) && parsed.length > 0) bullets = parsed.map((b) => `- ${b}`).join('\n');
        } catch {}
      }
    }
  }
  if (!bullets) bullets = '- Materials: Stainless steel\n- Hypoallergenic\n- Water and oxidation resistant';

  // Load settings
  const maxCharsRow = await env.DB.prepare("SELECT content FROM ai_prompts WHERE key = 'claude.description.max_chars'").first();
  const maxChars = parseInt(maxCharsRow?.content || '180') || 180;

  const templateRow = await env.DB.prepare("SELECT content FROM ai_prompts WHERE key = 'claude.description.template'").first();
  const descTemplate = templateRow?.content || '';

  // FIX 26a — bullet_template is no longer interpolated into Claude's
  // prompt. Bullets must come from the merchant's product_types library
  // verbatim, so we don't expose them to Claude at all. Claude only
  // generates the two paragraphs; the server appends the bullets
  // unmodified after the API call (see `result.bullets = bullets`
  // below).
  let prompt = descTemplate
    .replace('{{title}}', product?.title || '')
    .replace('{{product_type}}', productTypeName)
    .replace('{{collection}}', '')
    .replace('{{max_chars}}', String(maxChars))
    // Backwards-compatibility: any old template that still contains
    // {{bullet_template}} gets it replaced with an empty string instead
    // of leaving the literal placeholder visible to Claude.
    .replace('{{bullet_template}}', '');

  if (typeClaudePrompt) {
    prompt += `\n\n--- PRODUCT TYPE SPECIFIC INSTRUCTIONS ---\n${typeClaudePrompt}`;
  }

  // FIX 26c — surface the integrator's per-request guidance LAST so
  // Claude weights it most. Wrapped in a clearly-labelled block so it
  // doesn't get confused with the global / type-level instructions
  // above.
  if (cleanExtraPrompt) {
    prompt += `\n\n--- ADDITIONAL CONTEXT FROM THE PRODUCT TEAM ---\n${cleanExtraPrompt}`;
  }

  // FIX 26a/b — Claude now ONLY produces the two paragraphs. Bullets
  // come from product_types.bullet_template verbatim and are appended
  // server-side. The length guidance is min 150 / max 180 chars, set
  // in the prompt template (see new luxury-tone seed in migration
  // 0156); we still pass max_chars here for legacy templates that
  // reference it.
  prompt += `\n\nReturn ONLY valid JSON: {"paragraph1":"...","paragraph2":"..."}` +
    `\nEach paragraph must be between 150 and ${maxChars} characters. Do NOT include bullets — they are managed separately.`;

  let result = null;

  // Try real Claude API
  if (env.ANTHROPIC_API_KEY) {
    try {
      console.log('[gen-desc] calling Claude API');
      const imageContent = await buildImageContent(image.url, env);
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: [
              imageContent,
              { type: 'text', text: prompt },
            ],
          }],
        }),
      });

      if (claudeRes.ok) {
        const claudeData = await claudeRes.json();
        const textContent = claudeData.content?.find((c) => c.type === 'text')?.text || '';
        console.log('[gen-desc] Claude raw:', textContent.slice(0, 500));

        const jsonMatch = textContent.match(/```json\s*([\s\S]*?)\s*```/) || textContent.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : textContent;
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.paragraph1 || parsed.paragraph2) {
            // FIX 26a — bullets are pinned to product_types.bullet_template
            // and never sourced from Claude. Even if Claude returns a
            // `bullets` field (e.g. legacy template still asks for it),
            // we discard it.
            result = {
              paragraph1: String(parsed.paragraph1 || '').slice(0, maxChars + 50),
              paragraph2: String(parsed.paragraph2 || '').slice(0, maxChars + 50),
              bullets,
            };
          }
        } catch (e) {
          console.warn('[gen-desc] JSON parse failed:', e?.message);
        }
      } else {
        const errText = await claudeRes.text();
        console.error('[gen-desc] Claude API error:', claudeRes.status, errText.slice(0, 300));
      }
    } catch (e) {
      console.error('[gen-desc] Claude call failed:', e?.message);
    }
  }

  // Mock fallback
  if (!result) {
    console.log('[gen-desc] using mock fallback');
    const { results: descHistory = [] } = await env.DB
      .prepare('SELECT id FROM description_generation_history WHERE product_id = ?').bind(productId).all();
    const pair = MOCK_PARAGRAPHS[descHistory.length % MOCK_PARAGRAPHS.length];
    result = { paragraph1: pair[0], paragraph2: pair[1], bullets };
  }

  // Save history
  try {
    await env.DB.prepare('INSERT INTO description_generation_history (product_id, paragraph1, paragraph2, bullets) VALUES (?, ?, ?, ?)')
      .bind(productId, result.paragraph1, result.paragraph2, result.bullets).run();
  } catch {}

  return json({
    ...result,
    product_type_slug: resolvedSlug,
    ai: !!env.ANTHROPIC_API_KEY,
  });
}
