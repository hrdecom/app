export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { images, prompt, aspectRatio, resolution } = body; 
    // resolution reçu du front : "1k", "2k", "4k"
    // images : Array de base64 strings

    if (!env.GEMINI_API_KEY) return new Response(JSON.stringify({ error: "Clé API Google manquante" }), { status: 500 });

    const modelName = "gemini-3-pro-image-preview"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${env.GEMINI_API_KEY}`;

    // --- 1. GESTION FORMAT ET RÉSOLUTION ---
    let targetSize = "1K"; 
    if (resolution === "2k") targetSize = "2K";
    if (resolution === "4k") targetSize = "4K";

    // --- 2. CONFIGURATION TECHNIQUE ---
    const genConfig = {
      responseModalities: ["IMAGE"],
      temperature: 0.9,
      imageConfig: {
        aspectRatio: aspectRatio || "1:1",
        imageSize: targetSize
      }
    };

    // --- 3. ENRICHISSEMENT DU PROMPT ---
    let qualitySuffix = "";
    if (resolution === "4k") qualitySuffix = ", masterpiece, 4k, ultra detailed, photorealistic.";
    
    // On précise au modèle comment gérer les inputs multiples si présents
    let multiImgInstruction = "";
    if (images && images.length > 1) {
        multiImgInstruction = " Use the provided images as context: typically one is the subject and the other is the style/composition reference.";
    }

    const finalPrompt = `Generate an image: ${prompt}${multiImgInstruction}${qualitySuffix}`;

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

    // --- 4. GESTION DES IMAGES MULTIPLES (Sujet + Référence) ---
    if (images && images.length > 0) {
        // On inverse l'ordre pour que les images soient avant le texte dans le tableau parts (recommandation Gemini)
        // Mais on itère sur TOUTES les images fournies
        images.forEach(imgBase64 => {
            payload.contents[0].parts.unshift({
                inlineData: {
                    mimeType: "image/jpeg",
                    data: imgBase64
                }
            });
        });
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (data.error) {
        const msg = data.error.message || "Erreur inconnue";
        throw new Error(`Erreur Gemini (${data.error.code}): ${msg}`);
    }

    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error("Aucune réponse du modèle.");

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
