export async function onRequestPost({ request, env }) {
  try {
    const { action, image, media_type, collection, config, historyNames, currentTitle } = await request.json();

    const collectionInfo = config.collections.find(c => c.name === collection)?.meaning || "";
    
    let prompt = "";
    if (action === "generate") {
      prompt = `${config.promptSystem}
      
      COLLECTION CONTEXT: ${collectionInfo}
      BLACKLIST (Never use): ${config.blacklist}
      HISTORY (Avoid duplicates): ${JSON.stringify(historyNames)}
      
      STRICT RULES:
      - Title MUST NOT contain hyphens.
      - Description MUST HAVE EXACTLY TWO paragraphs.
      - EACH paragraph MUST BE 180 characters or LESS (including spaces).
      - NEVER use ellipses "..." to shorten.
      - Ton: Luxury but accessible.
      
      Return valid JSON: { "product_name": "...", "title": "...", "description": "..." }`;
    } else if (action === "regen_title") {
      prompt = `Generate a new symbolic name and title. Different from: ${currentTitle}. Check history: ${JSON.stringify(historyNames)}. JSON: { "product_name": "...", "title": "..." }`;
    } else if (action === "regen_desc") {
      prompt = `Regenerate the description ONLY. Strict 180 chars limit per paragraph. JSON: { "description": "..." }`;
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
