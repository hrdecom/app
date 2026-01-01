// functions/api/generate.js
// Web app backend (Cloudflare Pages Function)
// Supports: generate, regen_title, regen_desc, translate_fr

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const {
      action,
      image,
      media_type,
      collection,
      used,
      model,
      current
    } = body || {};

    /* ===============================
       ENV / MODEL
    =============================== */

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing ANTHROPIC_API_KEY" }),
        { status: 500 }
      );
    }

    const defaultModel = env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
    const allowOverride = env.ALLOW_MODEL_OVERRIDE === "1";
    const chosenModel =
      allowOverride && typeof model === "string" && model.trim()
        ? model.trim()
        : defaultModel;

    if (!image) {
      return new Response(
        JSON.stringify({ error: "Image manquante." }),
        { status: 400 }
      );
    }

    const mt =
      typeof media_type === "string" && media_type
        ? media_type
        : "image/jpeg";

    /* ===============================
       CONTEXT (COLLECTION / USED)
    =============================== */

    const colText = collection?.name
      ? `Collection context:
- Name: ${collection.name}
- Description: ${collection.desc || ""}
`
      : "";

    const usedText =
      Array.isArray(used) && used.length
        ? `Avoid repeating these phrases or titles if possible:
- ${used.slice(0, 80).join("\n- ")}
`
        : "";

    /* ===============================
       PROMPTS
    =============================== */

    let instruction = "";

    if (action === "generate") {
      instruction = `
You are an expert luxury jewelry copywriter.

${colText}
${usedText}

From the product image, generate content with the EXACT following structure:

1) First paragraph:
   - 2–3 sentences describing the design, materials, and emotional meaning.

2) Second paragraph:
   - 1–2 sentences about usage, gifting, or lifestyle context.

3) Then a bullet list:
   - 4–6 bullet points
   - Each bullet MUST start with "- "
   - Short, clear product features (materials, comfort, resistance, size, etc.)

Rules:
- Premium but accessible tone.
- Clear line breaks between paragraphs.
- Do NOT add headings or titles in the description.

Also generate:
- ONE concise English product title (max 8 words).

Return ONLY valid JSON (no markdown, no commentary):
{
  "title": "...",
  "description": "..."
}
`;
    } else if (action === "regen_title") {
      instruction = `
You are an expert luxury jewelry copywriter.

${colText}
${usedText}

Regenerate ONLY a new improved English product title based on the image.

Rules:
- Max 8 words
- Premium, elegant tone

Return ONLY valid JSON:
{ "title": "..." }
`;
    } else if (action === "regen_desc") {
      instruction = `
You are an expert luxury jewelry copywriter.

${colText}
${usedText}

Regenerate ONLY a new improved English product description based on the image.

Use the EXACT structure:
- Paragraph 1: design & emotion (2–3 sentences)
- Paragraph 2: usage / gifting (1–2 sentences)
- Bullet list (4–6 items, starting with "- ")

Return ONLY valid JSON:
{ "description": "..." }
`;
    } else if (action === "translate_fr") {
      const t = current?.title || "";
      const d = current?.description || "";

      instruction = `
You are an expert French e-commerce copywriter.

Task:
- Translate the following English product content into French.
- Produce a Shopify-ready HTML block.

Input English title:
${t}

Input English description:
${d}

Rules:
- Natural, premium French (not literal).
- Keep the same structure.
- Output valid HTML ONLY (no markdown).

Return ONLY valid JSON:
{
  "html": "<h4>...</h4><p>...</p><p>...</p><ul><li>...</li></ul>"
}
`;
    } else {
      return new Response(
        JSON.stringify({ error: "Action inconnue." }),
        { status: 400 }
      );
    }

    /* ===============================
       ANTHROPIC API CALL
    =============================== */

    const payload = {
      model: chosenModel,
      max_tokens: 900,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mt,
                data: image
              }
            },
            {
              type: "text",
              text: instruction
            }
          ]
        }
      ]
    };

    const anthropicRes = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      return new Response(
        JSON.stringify({
          error: `Erreur Anthropic (${anthropicRes.status})`,
          details: data
        }),
        { status: 500 }
      );
    }

    /* ===============================
       SAFE JSON EXTRACTION
    =============================== */

    const text = data?.content?.[0]?.text || "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start < 0 || end < 0) {
      return new Response(
        JSON.stringify({
          error: "Réponse non-JSON du modèle",
          raw: text
        }),
        { status: 500 }
      );
    }

    const json = JSON.parse(text.slice(start, end + 1));

    return new Response(JSON.stringify(json), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "Erreur serveur.",
        details: String(e)
      }),
      { status: 500 }
    );
  }
}
