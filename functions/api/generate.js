export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, image, media_type, collection, config, historyNames, currentTitle } = body;

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "Clé API manquante" }), { status: 500 });
    }

    // On récupère le contexte spécifique de la collection choisie
    const collectionInfo = (config.collections || []).find(c => c.name === collection)?.meaning || "No specific context.";
    
    // Règle de sécurité JSON pour éviter l'erreur de parsing
    const jsonSafeRule = "IMPORTANT: Return valid JSON. If a string contains double quotes, escape them with a backslash (\\\").";

    // Base commune d'instructions (utilisée pour TOUTES les actions)
    const baseInstructions = `
      ${config.promptSystem}
      ${jsonSafeRule}
      
      SPECIFIC COLLECTION CONTEXT (MANDATORY): ${collectionInfo}
      TITLE FORMATTING RULES: ${config.promptTitles}
      DESCRIPTION FORMATTING RULES: ${config.promptDesc}
    `;

    let prompt = "";
    if (action === "generate") {
      prompt = `
        ${baseInstructions}
        
        BLACKLIST: ${config.blacklist}
        HISTORY: ${JSON.stringify(historyNames)}
        
        TASK: Analyze image and output ONLY a valid JSON object: 
        { "product_name": "...", "title": "...", "description": "..." }
      `;
    } else if (action === "regen_title") {
      prompt = `
        ${baseInstructions}
        
        TASK: Regenerate ONLY the "product_name" and the "title" for this jewelry.
        - You MUST respect the COLLECTION CONTEXT and TITLE FORMATTING RULES provided above.
        - Different from current title: "${currentTitle}". 
        - Avoid names in history: ${JSON.stringify(historyNames)}.
        
        Output ONLY JSON: { "product_name": "...", "title": "..." }
      `;
    } else if (action === "regen_desc") {
      prompt = `
        ${baseInstructions}
        
        TASK: Regenerate ONLY the "description" for this jewelry.
        - You MUST respect the DESCRIPTION FORMATTING RULES (180 chars limit, etc.).
        
        Output ONLY JSON: { "description": "..." }
      `;
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
    if (!anthropicRes.ok) return new Response(JSON.stringify({ error: data.error?.message }), { status: 500 });

    const text = data.content[0].text;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const jsonString = text.substring(start, end + 1);
    
    return new Response(jsonString, { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
