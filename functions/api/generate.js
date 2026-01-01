export async function onRequestPost({ request, env }) {
  try {
    const { action, image, media_type, collection, config, historyNames, currentTitle } = await request.json();

    const collectionInfo = config.collections.find(c => c.name === collection)?.meaning || "";
    
    let prompt = "";
    if (action === "generate") {
      prompt = `${config.promptSystem}
      
      ALLOWED COLLECTION CONTEXT: ${collectionInfo}
      BLACKLIST (Never use these names): ${config.blacklist}
      HISTORY (Names already used): ${JSON.stringify(historyNames)}
      
      STRICT RULES:
      - Title must not have hyphens.
      - Description MUST have EXACTLY two paragraphs.
      - EACH paragraph MUST be 180 characters or LESS.
      - NO ellipsis "..." in paragraphs. Rewrite to be concise.
      - Mandatory bullets: Materials, Hypoallergenic, Water resistant.
      
      Output only valid JSON: { "product_name": "...", "title": "...", "description": "..." }`;
    } else if (action === "regen_title") {
      prompt = `Generate a NEW symbolic name and title. Different from: ${currentTitle}. Avoid history: ${JSON.stringify(historyNames)}. JSON: { "product_name": "...", "title": "..." }`;
    } else if (action === "regen_desc") {
      prompt = `Regenerate ONLY the description. Strict 180 chars per paragraph. JSON: { "description": "..." }`;
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620",
        max_tokens: 1200,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: image } },
          { type: "text", text: prompt }
        ]}]
      })
    });

    const data = await res.json();
    const text = data.content[0].text;
    return new Response(text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
