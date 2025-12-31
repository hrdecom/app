export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, image } = body;

    const apiKey = env.ANTHROPIC_API_KEY;
    const model = env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Clé API manquante côté serveur." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!image) {
      return new Response(JSON.stringify({ error: "Image manquante." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    let instruction = "";

    if (action === "generate") {
      instruction = `
You are an expert luxury jewelry copywriter.

From the product image:
- Generate ONE concise English product title (max 8 words)
- Generate ONE refined English product description (80–140 words)

Return ONLY valid JSON:
{ "title": "...", "description": "..." }
      `;
    } else if (action === "regen_title") {
      instruction = `
Regenerate ONLY a new improved English product title based on the image.

Return ONLY JSON:
{ "title": "..." }
      `;
    } else if (action === "regen_desc") {
      instruction = `
Regenerate ONLY a new improved English product description based on the image.

Return ONLY JSON:
{ "description": "..." }
      `;
    } else {
      return new Response(JSON.stringify({ error: "Action inconnue." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: image,
                },
              },
              {
                type: "text",
                text: instruction,
              },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `Erreur Anthropic (${anthropicRes.status})`, details: errText }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await anthropicRes.json();
    const text = data?.content?.[0]?.text || "";

    const json = JSON.parse(
      text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
    );

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Erreur serveur.", details: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
