export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, image, media_type, collection, config, historyNames, currentTitle, style } = body;

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "Clé API manquante" }), { status: 500 });
    }

    const collectionInfo = (config.collections || []).find(c => c.name === collection)?.meaning || "No specific context.";
    const jsonSafeRule = "IMPORTANT: Return valid JSON. If a string contains double quotes, escape them with a backslash (\\\").";

    const baseInstructions = `
      ${config.promptSystem}
      ${jsonSafeRule}
      SPECIFIC COLLECTION CONTEXT (MANDATORY): ${collectionInfo}
      TITLE FORMATTING RULES: ${config.promptTitles}
      DESCRIPTION FORMATTING RULES: ${config.promptDesc}
    `;

    let prompt = "";
    if (action === "generate") {
      prompt = `${baseInstructions}
        BLACKLIST: ${config.blacklist}
        HISTORY: ${JSON.stringify(historyNames)}
        TASK: Analyze image and output ONLY a valid JSON object: 
        { "product_name": "...", "title": "...", "description": "..." }`;
    } else if (action === "regen_title") {
      prompt = `${baseInstructions}
        TASK: Regenerate ONLY the "product_name" and the "title" for this jewelry.
        - Respect the COLLECTION CONTEXT and TITLE FORMATTING RULES.
        - Different from: "${currentTitle}". 
        Output ONLY JSON: { "product_name": "...", "title": "..." }`;
    } else if (action === "regen_desc") {
      prompt = `${baseInstructions}
        TASK: Regenerate ONLY the "description". Respect 180 chars limit.
        Output ONLY JSON: { "description": "..." }`;
    } else if (action === "headlines") {
      prompt = `You are a viral marketing expert for luxury jewelry. 
        Analyze the jewelry image and its title: "${currentTitle}".
        TASK: Generate 5 catchy video headlines (hooks) based on this style: "${style}".
        RULES:
        - Hooky, short, and optimized for social media (TikTok/Reels).
        - French or English (matching the requested style).
        Output ONLY a JSON object: { "headlines": ["hook 1", "hook 2", "hook 3", "hook 4", "hook 5"] }`;
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
    return new Response(text.substring(start, end + 1), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
