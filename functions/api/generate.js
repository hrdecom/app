export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, image, collection, config, historyNames, currentTitle } = body;

    const collectionInfo = config.collections.find(c => c.name === collection);
    const blacklist = config.blacklist;

    let prompt = "";
    if (action === "generate") {
      prompt = `${config.prompt}
      COLLECTION context: ${collectionInfo ? collectionInfo.meaning : ''}
      BLACKLIST (Never use): ${blacklist}
      ALREADY USED NAMES in history: ${JSON.stringify(historyNames)}
      
      RULE: You must create a unique "product_name" (1-2 words). 
      DO NOT use a name from the ALREADY USED NAMES list.
      
      Return JSON: { "product_name": "...", "title": "...", "description": "..." }`;
    } else if (action === "regen_title") {
      prompt = `Generate a new "product_name" and "title" for this jewelry. 
      It must be different from: "${currentTitle}". 
      Check this history to avoid duplicates: ${JSON.stringify(historyNames)}.
      Return JSON: { "product_name": "...", "title": "..." }`;
    } else if (action === "regen_desc") {
      prompt = `Generate a new luxury description for this jewelry.
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
        model: env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620",
        max_tokens: 1000,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
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
