export async function onRequestPost({ request, env }) {
  try {
    const { action, image, media_type, collection, config, historyNames, currentTitle } = await request.json();

    const collectionInfo = config.collections.find(c => c.name === collection)?.meaning || "";
    
    let prompt = "";
    if (action === "generate") {
      prompt = `${config.promptSystem}
      
      COLLECTION CONTEXT: ${collectionDetail}
      RULES FOR TITLES: ${config.promptTitles}
      RULES FOR DESCRIPTIONS: ${config.promptDesc}
      
      BLACKLIST (Never use these names): ${config.blacklist}
      ALREADY USED (History): ${JSON.stringify(historyNames)}
      
      Return valid JSON object: { "product_name": "...", "title": "...", "description": "..." }`;
    } else if (action === "regen_title") {
      prompt = `${config.promptSystem}
      Regenerate ONLY product_name and title. 
      Rules: ${config.promptTitles}. 
      Different from: "${currentTitle}". 
      JSON: { "product_name": "...", "title": "..." }`;
    } else if (action === "regen_desc") {
      prompt = `${config.promptSystem}
      Regenerate ONLY the description. 
      Rules: ${config.promptDesc}. 
      JSON: { "description": "..." }`;
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
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    
    return new Response(text.substring(start, end + 1), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
