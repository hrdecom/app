// functions/api/generate.js — Web app backend (no client API key)
// Supports: generate, regen_title, regen_desc, translate_fr
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, image, media_type, collection, used, model, current } = body || {};

    const apiKey = env.ANTHROPIC_API_KEY;
    const defaultModel = env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
    const allowOverride = env.ALLOW_MODEL_OVERRIDE === "1";
    const chosenModel = (allowOverride && typeof model === "string" && model.trim()) ? model.trim() : defaultModel;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing ANTHROPIC_API_KEY" }), { status: 500 });
    }

    if (!image) {
      return new Response(JSON.stringify({ error: "Image manquante." }), { status: 400 });
    }

    const mt = (typeof media_type === "string" && media_type) ? media_type : "image/jpeg";

    const colText = collection?.name
      ? `Collection context:\n- Name: ${collection.name}\n- Description: ${collection.desc || ""}\n`
      : "";

    const usedText = Array.isArray(used) && used.length
      ? `Avoid repeating these phrases/titles if possible:\n- ${used.slice(0, 80).join("\n- ")}\n`
      : "";

    let instruction = "";
    if (action === "generate") {
      instruction = `You are an expert luxury jewelry copywriter.\n\n${colText}${usedText}
From the product image, generate:
1) ONE concise English product title (max 8 words)
2) ONE refined English product description (80–160 words)
- Use persuasive but premium tone.
- Prefer concrete details you can infer from the image (material, shape, style).
Return ONLY valid JSON:
{ "title": "...", "description": "..." }`;
    } else if (action === "regen_title") {
      instruction = `You are an expert luxury jewelry copywriter.\n\n${colText}${usedText}
Regenerate ONLY a new improved English product title based on the image.
Return ONLY JSON: { "title": "..." }`;
    } else if (action === "regen_desc") {
      instruction = `You are an expert luxury jewelry copywriter.\n\n${colText}${usedText}
Regenerate ONLY a new improved English product description (80–160 words) based on the image.
Return ONLY JSON: { "description": "..." }`;
    } else if (action === "translate_fr") {
      const t = current?.title || "";
      const d = current?.description || "";
      instruction = `You are an expert French e-commerce copywriter.\n
Task: produce a French translation and a Shopify-ready HTML block.\n
Input English title: ${t}\n
Input English description:\n${d}\n
Also look at the image to ensure consistency.\n
Return ONLY valid JSON with an 'html' field that contains HTML (no markdown):\n
{ "html": "<h4>...</h4><p>...</p><ul><li>...</li></ul>" }`;
    } else {
      return new Response(JSON.stringify({ error: "Action inconnue." }), { status: 400 });
    }

    const payload = {
      model: chosenModel,
      max_tokens: 900,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mt, data: image } },
            { type: "text", text: instruction }
          ]
        }
      ]
    };

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(payload)
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return new Response(JSON.stringify({ error: `Erreur Anthropic (${anthropicRes.status})`, details: data }), { status: 500 });
    }

    const text = data?.content?.[0]?.text || "";
    // Extract JSON from model response safely
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < 0) {
      return new Response(JSON.stringify({ error: "Réponse non-JSON", raw: text }), { status: 500 });
    }
    const json = JSON.parse(text.slice(start, end + 1));

    return new Response(JSON.stringify(json), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Erreur serveur.", details: String(e) }), { status: 500 });
  }
}
