export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { images, prompt, aspectRatio, resolution } = body; 
    // resolution reçu du front : "1k", "2k", "4k"

    if (!env.GEMINI_API_KEY) return new Response(JSON.stringify({ error: "Clé API Google manquante" }), { status: 500 });

    const modelName = "gemini-3-pro-image-preview"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${env.GEMINI_API_KEY}`;

    // --- 1. GESTION FORMAT ET RÉSOLUTION ---
    // Conversion des valeurs pour correspondre aux Enums de l'API Gemini 3
    let targetSize = "1K"; // Défaut
    if (resolution === "2k") targetSize = "2K";
    if (resolution === "4k") targetSize = "4K";

    // --- 2. CONFIGURATION TECHNIQUE CORRECTE ---
    // Pour Gemini 3 Pro Image, les paramètres d'image doivent être dans 'imageConfig'
    // et NON à la racine de generationConfig.
    const genConfig = {
      responseModalities: ["IMAGE"],
      temperature: 0.9,
      imageConfig: {
        aspectRatio: aspectRatio || "1:1", // ex: "16:9", "3:4"
        imageSize: targetSize              // "1K", "2K" ou "4K"
      }
    };

    // --- 3. ENRICHISSEMENT DU PROMPT ---
    // On garde quand même l'instruction textuelle par sécurité pour la qualité des détails
    let qualitySuffix = "";
    if (resolution === "4k") qualitySuffix = ", masterpiece, 4k, ultra detailed, photorealistic.";
    
    const finalPrompt = `Generate an image: ${prompt}${qualitySuffix}`;

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
        // Log détaillé pour vous aider à débugger si le format change encore
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
