export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { images, prompt, aspectRatio, resolution } = body; 
    // resolution : "1k", "2k", "4k"

    if (!env.GEMINI_API_KEY) return new Response(JSON.stringify({ error: "Clé API Google manquante" }), { status: 500 });

    // 1. DÉFINITION DU MODÈLE
    // On garde l'ID spécifique demandé
    const modelName = "gemini-3-pro-image-preview"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${env.GEMINI_API_KEY}`;

    // 2. CONSTRUCTION DU PROMPT (Ratio & Qualité)
    // L'API rejetant le paramètre technique, on doit être impératif dans le texte.
    
    // Gestion Qualité / Résolution
    let qualityInstruction = "";
    if (resolution === "2k") qualityInstruction = "High resolution (2k), highly detailed, sharp focus, high fidelity texture.";
    if (resolution === "4k") qualityInstruction = "Ultra-high resolution (4k), masterpiece, intricate details, photorealistic, 8k textures.";
    
    // Gestion Aspect Ratio (Crucial : au début du prompt pour priorisation)
    const ratioText = aspectRatio ? aspectRatio : "1:1";
    let ratioInstruction = `Aspect Ratio ${ratioText}.`;
    
    // On combine le tout : Format + Prompt Utilisateur + Qualité
    const finalPrompt = `${ratioInstruction} Generate an image: ${prompt}. ${qualityInstruction}`;

    // 3. CONFIGURATION TECHNIQUE (CORRIGÉE)
    // On retire "aspectRatio" qui causait l'erreur 400.
    const genConfig = {
      responseModalities: ["IMAGE"], // Force la sortie image
      temperature: 0.9
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
        // Renvoie l'erreur brute pour faciliter le débogage si une autre survient
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
