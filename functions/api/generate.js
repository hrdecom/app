export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, image, media_type, collection, config, historyNames, currentTitle } = body;

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "Clé API manquante dans Cloudflare." }), { status: 500 });
    }

    const collectionInfo = (config.collections || []).find(c => c.name === collection)?.meaning || "No specific context.";
    
    let prompt = "";
    if (action === "generate") {
      prompt = `${config.promptSystem}
      
      COLLECTION CONTEXT: ${collectionInfo}
      RULES FOR TITLES: ${config.promptTitles}
      RULES FOR DESCRIPTIONS: ${config.promptDesc}
      
      BLACKLIST: ${config.blacklist}
      HISTORY: ${JSON.stringify(historyNames)}
      
      Output ONLY a valid JSON object: { "product_name": "...", "title": "...", "description": "..." }`;
    } else if (action === "regen_title") {
      prompt = `${config.promptSystem}
      Regenerate ONLY product_name and title. Rules: ${config.promptTitles}. Different from: "${currentTitle}". 
      JSON: { "product_name": "...", "title": "..." }`;
    } else if (action === "regen_desc") {
      prompt = `${config.promptSystem}
      Regenerate ONLY the description. Rules: ${config.promptDesc}. 
      JSON: { "description": "..." }`;
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1200,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: image } },
          { type: "text", text: prompt }
        ]}]
      })
    });

    const data = await anthropicRes.json();
    
    if (!anthropicRes.ok) {
      return new Response(JSON.stringify({ error: data.error?.message || "Erreur Anthropic" }), { status: 500 });
    }

    const text = data.content[0].text;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return new Response(text.substring(start, end + 1), { headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
