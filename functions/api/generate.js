export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, image, media_type, collection, config, historyNames, currentTitle, currentDesc, product_url, style, selectedForSimilar, itemsToTranslate, infoToTranslate, targetLang } = body;

    if (!env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "Clé API manquante" }), { status: 500 });

    const jsonSafeRule = "IMPORTANT: Return valid JSON. Escape double quotes with backslash (\\\"). Output ONLY JSON.";
    const baseInstructions = `${config.promptSystem}\n${jsonSafeRule}\nCONTEXT: ${collection}\nTITLES: ${config.promptTitles}\nDESC: ${config.promptDesc}`;

    let prompt = "";
    
    if (action === "generate") {
      prompt = `${baseInstructions}\nBLACKLIST: ${config.blacklist}\nHISTORY: ${JSON.stringify(historyNames)}\nTASK: Analyze image and output JSON: { "product_name": "...", "title": "...", "description": "..." }`;
    } else if (action === "regen_title") {
      prompt = `${baseInstructions}\nTASK: New product_name/title. Different from: "${currentTitle}". JSON: { "product_name": "...", "title": "..." }`;
    } else if (action === "regen_desc") {
      prompt = `${baseInstructions}\nTASK: New description. JSON: { "description": "..." }`;
    } else if (action === "headlines") {
      prompt = `${config.promptHeadlines}\n${jsonSafeRule}\nLANGUAGE: English.\nCONTEXT: Title: ${currentTitle}\nSTYLE: ${style}\nTASK: 5 hooks. JSON: { "headlines": ["...", "..."] }`;
    } else if (action === "ad_copys") {
      prompt = `${config.promptAdCopys}\n${jsonSafeRule}\nDEFAULT LANGUAGE: English.\nPRODUCT: ${currentTitle}\nSTYLE: ${style}\nTASK: Generate 3 variations following the structure. JSON: { "ad_copys": ["...", "..."] }`;
    } else if (action === "headlines_similar") {
      prompt = `Viral Copywriting Expert. Based on: ${JSON.stringify(selectedForSimilar)}. Task: 5 improved varied versions. English. JSON: { "headlines": ["...", "..."] }`;
    } else if (action === "ad_copys_similar") {
      prompt = `Facebook Ads Expert. Based on: ${JSON.stringify(selectedForSimilar)}. Task: 3 improved variations following structure. English. JSON: { "ad_copys": ["...", "..."] }`;
    } 
    // TRADUCTION AMELIORÉE
    else if (action === "translate") {
      prompt = `You are a professional luxury translator. 
      TASK: Translate these items into ${targetLang}.
      - Maintain premium tone.
      - Keep emojis and line breaks exactly as provided.
      
      ITEMS TO TRANSLATE: ${JSON.stringify(itemsToTranslate)}
      ${infoToTranslate ? `INFO BLOCK TO TRANSLATE: ${JSON.stringify(infoToTranslate)}` : ''}
      
      Output ONLY JSON: { "translated_items": [...], "translated_info": { "title1": "...", "title2": "...", "title3": "...", "title4": "...", "sub": "..." } }`;
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
    const text = data.content[0].text;
    return new Response(text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
