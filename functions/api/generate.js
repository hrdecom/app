export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, image, media_type, collection, config, historyNames, currentTitle } = body;

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "La clé ANTHROPIC_API_KEY est absente des secrets Cloudflare." }), { status: 500 });
    }

    // Correction du nom de variable : collectionInfo utilisé partout
    const collectionInfo = (config.collections || []).find(c => c.name === collection)?.meaning || "No specific context.";
    
    let prompt = "";
    if (action === "generate") {
      prompt = `${config.promptSystem}
      
      COLLECTION CONTEXT: ${collectionInfo}
      RULES FOR TITLES: ${config.promptTitles}
      RULES FOR DESCRIPTIONS: ${config.promptDesc}
      
      BLACKLIST (Never use these names): ${config.blacklist}
      ALREADY USED (History): ${JSON.stringify(historyNames)}
      
      Output ONLY a valid JSON object: { "product_name": "...", "title": "...", "description": "..." }`;
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

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
        max_tokens: 1200,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: image } },
          { type: "text", text: prompt }
        ]}]
      })
    });

    const data = await anthropicRes.json();
    
    if (!anthropicRes.ok) {
      // On renvoie l'erreur réelle d'Anthropic pour débugger
      return new Response(JSON.stringify({ 
        error: "Erreur Anthropic API", 
        details: data.error?.message || "Erreur inconnue" 
      }), { status: 500 });
    }

    const text = data.content[0].text;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    
    if (start === -1 || end === -1) {
      return new Response(JSON.stringify({ error: "L'IA n'a pas renvoyé de JSON valide.", raw: text }), { status: 500 });
    }

    return new Response(text.substring(start, end + 1), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: "Erreur Serveur Interne", details: e.message }), { status: 500 });
  }
}
