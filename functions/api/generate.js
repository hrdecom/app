export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, image, media_type, collection, config, historyNames, currentTitle, currentDesc, product_url, style, selectedForSimilar, itemsToTranslate, targetLang } = body;

    if (!env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "Clé API manquante" }), { status: 500 });

    const collectionInfo = (config.collections || []).find(c => c.name === collection)?.meaning || "";
    const jsonSafeRule = "IMPORTANT: Return valid JSON. Escape double quotes with backslash (\\\"). Output ONLY JSON.";
    const baseInstructions = `${config.promptSystem}\n${jsonSafeRule}\nCONTEXT: ${collectionInfo}\nTITLES: ${config.promptTitles}\nDESC: ${config.promptDesc}`;

    let prompt = "";
    
    if (action === "generate") {
      prompt = `${baseInstructions}\nBLACKLIST: ${config.blacklist}\nHISTORY: ${JSON.stringify(historyNames)}\nTASK: Analyze image and output JSON: { "product_name": "...", "title": "...", "description": "..." }`;
    } else if (action === "regen_title") {
      prompt = `${baseInstructions}\nTASK: New product_name/title. Different from: "${currentTitle}". JSON: { "product_name": "...", "title": "..." }`;
    } else if (action === "regen_desc") {
      prompt = `${baseInstructions}\nTASK: New description. JSON: { "description": "..." }`;
    } else if (action === "headlines") {
      prompt = `${config.promptHeadlines}\n${jsonSafeRule}\nLANGUAGE: English.\nCONTEXT: Title: ${currentTitle}, Desc: ${currentDesc}\nSTYLE: ${style}\nTASK: Generate 5 hooks. JSON: { "headlines": ["...", "..."] }`;
    } else if (action === "ad_copys") {
      prompt = `${config.promptAdCopys}\n${jsonSafeRule}\nDEFAULT LANGUAGE: English.\nPRODUCT CONTEXT:\n- Title: ${currentTitle}\n- Description: ${currentDesc}\n- Product URL: ${product_url || "(no url provided)"}\nSTYLE REQUEST: ${style}\n\nOutput ONLY JSON: { "ad_cop_ys": ["...", "..."] }`;
    } else if (action === "headlines_similar" || action === "ad_copys_similar") {
        const type = action.includes('headlines') ? "Headlines" : "Ad Copys";
        prompt = `You are a Luxury Jewelry Marketing Expert. Based on these selected ${type}: ${JSON.stringify(selectedForSimilar)}.
        TASK: Generate 5 NEW improved variations. Keep the same structure. 
        Output ONLY JSON: { "${action.includes('headlines') ? 'headlines' : 'ad_copys'}": ["...", "..."] }`;
    } 
    // ACTION TRADUCTION
    else if (action === "translate") {
      prompt = `You are a professional luxury translator. 
      TASK: Translate the following list of jewelry marketing texts into ${targetLang}.
      - Maintain the premium, intimate, and persuasive tone.
      - Keep EXACTLY the same structure, line breaks, and emojis (especially for Ad Copies).
      - If there are URLs, do NOT translate or change them.
      
      TEXTS TO TRANSLATE:
      ${JSON.stringify(itemsToTranslate)}
      
      Output ONLY JSON: { "translated_items": ["...", "..."] }`;
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1500,
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
    return new Response(text.substring(start, end + 1), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
