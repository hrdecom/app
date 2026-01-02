export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { images, prompt, aspectRatio, resolution } = body; 
    // resolution : "1k", "2k", "4k"

    if (!env.GEMINI_API_KEY) return new Response(JSON.stringify({ error: "Clé API Google manquante" }), { status: 500 });

    // 1. DÉFINITION DU MODÈLE
    const modelName = "gemini-3-pro-image-preview"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${env.GEMINI_API_KEY}`;

    // 2. ENRICHISSEMENT DU PROMPT (POUR LA QUALITÉ VISUELLE)
    // On force le modèle à "penser" en haute résolution via le prompt
    let qualityInstruction = "";
    if (resolution === "2k") qualityInstruction = " High resolution (2k), highly detailed, sharp focus, high fidelity texture.";
    if (resolution === "4k") qualityInstruction = " Ultra-high resolution (4k), masterpiece, intricate details, photorealistic, 8k textures.";
    
    // Ajout d'une instruction de style photoréaliste par défaut si non précisée
    const finalPrompt = `Generate an image: ${prompt}.${qualityInstruction} ensure strict adherence to the requested aspect ratio.`;

    // 3. CONFIGURATION TECHNIQUE (POUR LE FORMAT)
    // C'est ici que se joue la dimension de l'image (Aspect Ratio)
    const genConfig = {
      responseModalities: ["IMAGE"],
      temperature: 0.9,
      // IMPORTANT: Transmettre l'aspectRatio ici force le modèle à changer le format du canevas
      // Valeurs acceptées généralement: "1:1", "16:9", "4:3", etc.
      aspectRatio: aspectRatio || "1:1" 
    };

    const payload = {
      contents: [
        {
          parts: [
            { text: finalPrompt }
          ]
        }
      ],
      generationConfig: genConfig
    };

    // Gestion Image Input (Img2Img)
    if (images && images.length > 0) {
        payload.contents[0].parts.unshift({
            inlineData: {
                mimeType: "image/jpeg",
                data: images[0]
            }
        });
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (data.error) {
        throw new Error(`Erreur Gemini (${data.error.code}): ${data.error.message}`);
    }

    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error("Aucune réponse du modèle.");

    // Extraction image
    const imagePart = candidate.content?.parts?.find(p => p.inlineData);
    if (!imagePart) {
        const textPart = candidate.content?.parts?.find(p => p.text);
        throw new Error(textPart ? `Refus du modèle : ${textPart.text}` : "Aucune image générée.");
    }

    const generatedBase64 = imagePart.inlineData.data;
    
    return new Response(JSON.stringify({ image: generatedBase64 }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
