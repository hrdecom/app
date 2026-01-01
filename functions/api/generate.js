export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { action, image, media_type, collection, config, historyNames } = body;

    const apiKey = env.ANTHROPIC_API_KEY;
    const model = env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620";

    // Récupération des réglages personnalisés ou par défaut
    const customPrompt = config.prompt || "You are a luxury jewelry copywriter...";
    const collectionDetail = config.collections?.find(c => c.name === collection)?.meaning || "";
    const blacklist = config.blacklist || "";

    let systemInstruction = "";

    if (action === "generate") {
      systemInstruction = `${customPrompt}
      
      CONTEXTE COLLECTION: ${collectionDetail}
      NOMS INTERDITS (Blacklist manuelle): ${blacklist}
      DÉJÀ UTILISÉS (Historique récent): ${JSON.stringify(historyNames)}
      
      RÈGLE ANTI-DOUBLON STRICTE: 
      Ne réutilise JAMAIS un nom (ex: "Unity") si celui-ci a déjà été associé à un titre identique dans l'historique fourni.
      
      Retourne UNIQUEMENT un JSON:
      { "product_name": "Nom Symbolique", "title": "Titre Complet", "description": "Description..." }`;
    } 
    else if (action === "regen_title") {
      systemInstruction = `Génère uniquement un NOUVEAU titre et un NOUVEAU nom symbolique pour ce bijou. Différent de: ${body.currentTitle}. JSON: { "product_name": "...", "title": "..." }`;
    } 
    else if (action === "regen_desc") {
      systemInstruction = `Génère uniquement une NOUVELLE description pour ce bijou. JSON: { "description": "..." }`;
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1000,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: image } },
          { type: "text", text: systemInstruction }
        ]}]
      })
    });

    const data = await anthropicRes.json();
    const text = data.content[0].text;
    return new Response(text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
