// Cloudflare Pages Function — Claude Vision (image → copywriting)

export async function onRequestPost({ request, env }) {
  try {
    const { action, imageBase64, imageType } = await request.json();

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "Image manquante." }), { status: 400 });
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    const model = env.ANTHROPIC_MODEL;

    if (!apiKey || !model) {
      return new Response(JSON.stringify({ error: "Configuration serveur manquante." }), { status: 500 });
    }

    let instruction = "";
    if (action === "generate") {
      instruction = `You are an expert jewelry copywriter.
From the image, generate:
- ONE product title (max 70 characters)
- ONE product description (120–180 characters, one paragraph)
Tone: premium, emotional, elegant.
Return STRICT JSON:
{ "title": "...", "description": "..." }`;
    } else if (action === "regen_title") {
      instruction = `Generate ONE alternative product title (max 70 characters).
Return STRICT JSON: { "title": "..." }`;
    } else if (action === "regen_desc") {
      instruction = `Generate ONE alternative product description (120–180 characters).
Return STRICT JSON: { "description": "..." }`;
    } else {
      return new Response(JSON.stringify({ error: "Action invalide." }), { status: 400 });
    }

    const messages = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: imageType || "image/jpeg",
              data: imageBase64
            }
          },
          { type: "text", text: instruction }
        ]
      }
    ];

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        temperature: 0.6,
        messages
      })
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return new Response(JSON.stringify({ error: "Erreur Anthropic", details: data }), { status: 500 });
    }

    const text = data.content.map(c => c.text || "").join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

    return new Response(JSON.stringify(json), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
