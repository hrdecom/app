export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, image, media_type, collection, config, historyNames, currentTitle, currentDesc, product_url, style, selectedForSimilar } = body;

    if (!env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "Clé API manquante" }), { status: 500 });

    const collectionInfo = (config.collections || []).find(c => c.name === collection)?.meaning || "";
    const jsonSafeRule = "IMPORTANT: Return valid JSON. Escape double quotes with backslash (\\\"). Output ONLY JSON.";

    const baseInstructions = `${config.promptSystem}\n${jsonSafeRule}\nSPECIFIC COLLECTION CONTEXT: ${collectionInfo}\nTITLE RULES: ${config.promptTitles}\nDESC RULES: ${config.promptDesc}`;

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
      prompt = `${config.promptAdCopys}
        ${jsonSafeRule}
        DEFAULT LANGUAGE: English.
        PRODUCT CONTEXT:
        - Title: ${currentTitle}
        - Description: ${currentDesc}
        - Product URL: ${product_url || "(no url provided)"}
        STYLE REQUEST: ${style}
        
        STRUCTURE REQUIREMENT:
        1. Short engaging description based on style.
        2. A newline.
        3. EXACTLY these bullet points:
           ✅ Hypoallergenic
           ✅ Water and oxidation resistant
           ✅ Made to last
        4. A newline.
        5. Call to action including the Product URL.
        
        TASK: Generate 3 variations of Ad Copys.
        Output ONLY JSON: { "ad_copys": ["copy 1", "copy 2", "copy 3"] }`;
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
    return new Response(text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
