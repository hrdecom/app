export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, image, media_type, collection, config, historyNames, currentTitle, currentDesc, product_url, style, selectedForSimilar, textsToTranslate, targetLang } = body;

    if (!env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "Clé API manquante" }), { status: 500 });
    const jsonSafeRule = "IMPORTANT: Return valid JSON. Escape double quotes with backslash (\\\"). Output ONLY JSON.";

    let prompt = "";
    
    // LOGIQUE DE TRADUCTION
    if (action === "translate") {
      prompt = `You are a professional native translator specialized in luxury jewelry marketing.
        TASK: Translate the following list of marketing texts into ${targetLang}.
        
        STRICT RULES:
        - Maintain the EXACT same tone (luxury, emotional, punchy).
        - Keep all emojis (like ✅, ✨, 🎬) exactly where they are.
        - Preserve all line breaks and structure.
        - Ensure the translation feels natural and high-end in ${targetLang}, not a literal word-for-word translation.
        
        TEXTS TO TRANSLATE:
        ${JSON.stringify(textsToTranslate)}
        
        Output ONLY a JSON object: { "translations": ["translated text 1", "translated text 2", ...] }`;
    } 
    // RESTE DES ACTIONS... (inchangé pour la stabilité)
    else if (action === "generate") {
      const collectionInfo = (config.collections || []).find(c => c.name === collection)?.meaning || "";
      prompt = `${config.promptSystem}\n${jsonSafeRule}\nCONTEXT: ${collectionInfo}\nTITLES: ${config.promptTitles}\nDESC: ${config.promptDesc}\nBLACKLIST: ${config.blacklist}\nHISTORY: ${JSON.stringify(historyNames)}\nTASK: Analyze image and output JSON: { "product_name": "...", "title": "...", "description": "..." }`;
    } else if (action === "headlines") {
      prompt = `${config.promptHeadlines}\n${jsonSafeRule}\nCONTEXT: Title: ${currentTitle}, Desc: ${currentDesc}\nSTYLE: ${style}\nTASK: Generate 5 hooks. JSON: { "headlines": ["...", "..."] }`;
    } else if (action === "ad_copys") {
      prompt = `${config.promptAdCopys}\n${jsonSafeRule}\nPRODUCT: ${currentTitle}, URL: ${product_url}\nSTYLE: ${style}\nOutput ONLY JSON: { "ad_copys": ["...", "..."] }`;
    } else if (action === "headlines_similar") {
      prompt = `Viral Expert. Based on: ${JSON.stringify(selectedForSimilar)}. Product: ${currentTitle}. 5 punchy variations. English. JSON: { "headlines": ["...", "..."] }`;
    } else if (action === "ad_copys_similar") {
      prompt = `Ads Expert. Based on: ${JSON.stringify(selectedForSimilar)}. Product: ${currentTitle}. 3 variations. Keep structure (Bullets + URL). English. JSON: { "ad_copys": ["...", "..."] }`;
    } else if (action === "regen_title") {
      prompt = `New product_name/title. Different from: "${currentTitle}". JSON: { "product_name": "...", "title": "..." }`;
    } else if (action === "regen_desc") {
      prompt = `New description. JSON: { "description": "..." }`;
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
