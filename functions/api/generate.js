export async function onRequestPost({ request, env }) {
  try {
    const { action, image, media_type, collection, config, historyNames, currentTitle } = await request.json();

    const collectionInfo = (config.collections || []).find(c => c.name === collection)?.meaning || "";
    
    let prompt = "";
    if (action === "generate") {
      prompt = `${config.promptSystem}
      
      COLLECTION CONTEXT: ${collectionInfo}
      TITLE RULES: ${config.promptTitles}
      DESCRIPTION RULES: ${config.promptDesc}
      
      BLACKLIST: ${config.blacklist}
      HISTORY (Avoid these names): ${JSON.stringify(historyNames)}
      
      Return JSON: { "product_name": "...", "title": "...", "description": "..." }`;
    } else if (action === "regen_title") {
      prompt = `${config.promptSystem}
      Regenerate TITLE and product_name only. 
      Rules: ${config.promptTitles}. 
      Current Title: ${currentTitle}. 
      History: ${JSON.stringify(historyNames)}.
      Return JSON: { "product_name": "...", "title": "..." }`;
    } else if (action === "regen_desc") {
      prompt = `${config.promptSystem}
      Regenerate DESCRIPTION only. 
      Rules: ${config.promptDesc}. 
      Return JSON: { "description": "..." }`;
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
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

    const data = await res.json();
    if (!res.ok) return new Response(JSON.stringify({ error: data.error?.message }), { status: 500 });

    const text = data.content[0].text;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return new Response(text.substring(start, end + 1), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
