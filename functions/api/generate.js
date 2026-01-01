// functions/api/generate.js
// Cloudflare Pages Function
// Source de vérité des prompts (aligné extension v1.6.x)

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
      return new Response(JSON.stringify({ error: "Missing ANTHROPIC_API_KEY" }), { status: 500 });
    }

    const defaultModel = env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
    const allowOverride = env.ALLOW_MODEL_OVERRIDE === "1";
    const chosenModel =
      allowOverride && typeof model === "string" && model.trim()
        ? model.trim()
        : defaultModel;

    if (!image) {
      return new Response(JSON.stringify({ error: "Image manquante." }), { status: 400 });
    }

    const mt =
      typeof media_type === "string" && media_type
        ? media_type
        : "image/jpeg";

    /* ===============================
       CONTEXT
    =============================== */

    const colText = collection
      ? `USER_SUGGESTED_COLLECTION=${collection}`
      : "USER_SUGGESTED_COLLECTION=(none)";

    const usedText =
      Array.isArray(used) && used.length
        ? `Avoid repeating these names or phrases (case-insensitive):
${used.slice(0, 100).join(", ")}`
        : "";

    /* ===============================
       CORE PROMPTS (IDENTIQUES EXTENSION)
    =============================== */

    let instruction = "";

    if (action === "generate") {
      instruction = `
You are a senior luxury jewelry copywriter and vision-language expert.

Analyze the jewelry image and return ONE SINGLE JSON object with EXACTLY these keys:
- "type": one of Ring | Bracelet | Necklace | Earrings
- "collection": a short collection name (1–2 words)
- "name": a symbolic English name (1–2 words, NO generic product words)
- "title": formatted EXACTLY as specified
- "description": English plain text

${colText}
${usedText}

TITLE FORMAT (NO hyphens):
- Ring: Adjustable {Collection} Ring "{Name}"
- Bracelet / Necklace / Earrings: {Collection} {Type} "{Name}"

DESCRIPTION FORMAT (STRICT):
- EXACTLY two paragraphs
- Each paragraph MUST be ≤180 characters (including spaces)
- NO ellipses "..."
- Clear line break between paragraphs
- Then bullet list, each line starting with "- "

MANDATORY BULLETS (always include):
- Materials: Stainless steel
- Hypoallergenic
- Water and oxidation resistant

TYPE-SPECIFIC BULLETS:
- Ring:
  - Size: Adjustable
  - No green fingers
- Bracelet:
  - Bracelet Size: 16+5cm (adjustable) / (6.3 in x 2in)
- Necklace:
  - Clasp: Lobster clasp
  - Length: 46 cm + 5 cm adjustable (18.1 in + 2in)

IMPORTANT RULES:
- Do NOT mention letters, initials, or names visible in the image.
- Use expressions like "initial motif" or "your chosen name".
- Premium but accessible tone.
- If a paragraph exceeds 180 characters, rewrite it until compliant BEFORE responding.

Return ONLY valid JSON (no markdown, no commentary).
`;
    }

    else if (action === "regen_title") {
      instruction = `
Generate a DIFFERENT symbolic English NAME and a TITLE for the SAME jewelry.

Rules:
- Name: 1–2 words, symbolic, NO generic jewelry terms
- Keep same type and collection
- NO hyphens
- Premium tone

Return ONLY JSON:
{ "name": "...", "title": "..." }
`;
    }

    else if (action === "regen_desc") {
      instruction = `
Regenerate ONLY the DESCRIPTION for the SAME jewelry.

Rules:
- EXACTLY two paragraphs
- Each paragraph ≤180 characters
- NO ellipses
- Then bullet list EXACTLY as specified previously
- Keep tone and meaning but vary wording

Return ONLY JSON:
{ "description": "..." }
`;
    }

    else if (action === "translate_fr") {
      const t = current?.title || "";
      const d = current?.description || "";

      instruction = `
You are an expert French luxury e-commerce copywriter.

Translate the following English product content into French.

INPUT TITLE:
${t}

INPUT DESCRIPTION:
${d}

Rules:
- Natural premium French (not literal)
- Keep EXACT same structure
- Paragraphs → <p>
- Bullets → <ul><li>
- NO markdown

Return ONLY valid JSON:
{ "html": "<p>...</p><p>...</p><ul><li>...</li></ul>" }
`;
    }

    else {
      return new Response(JSON.stringify({ error: "Action inconnue." }), { status: 400 });
    }

    /* ===============================
       ANTHROPIC CALL
    =============================== */

    const payload = {
      model: chosenModel,
      max_tokens: 1200,
      temperature: 0.4,
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
        JSON.stringify({ error: "Réponse non-JSON du modèle", raw: text }),
        { status: 500 }
      );
    }

    const json = JSON.parse(text.slice(start, end + 1));

    return new Response(JSON.stringify(json), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Erreur serveur.", details: String(e) }),
      { status: 500 }
    );
  }
}
