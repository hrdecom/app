export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { images, prompt, aspectRatio, resolution } = body; 
    // resolution : "1k", "2k", "4k"

    if (!env.GEMINI_API_KEY) return new Response(JSON.stringify({ error: "Clé API Google manquante" }), { status: 500 });

    // 1. DÉFINITION DU MODÈLE GEMINI 3 (PREVIEW)
    // L'ID exact avec le suffixe "-preview" est requis.
    const modelName = "gemini-3-pro-image-preview"; 
    
    // IMPORTANT : On utilise la méthode ':generateContent' (standard Gemini) et non ':predict' (standard Imagen/Vertex)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${env.GEMINI_API_KEY}`;

    // 2. ENRICHISSEMENT DU PROMPT
    // Gemini 3 Pro suit les instructions complexes. On lui indique explicitement le style et la technique.
    let qualityInstruction = "";
    if (resolution === "2k") qualityInstruction = " High resolution (2k), highly detailed, sharp focus.";
    if (resolution === "4k") qualityInstruction = " Ultra-high resolution (4k), masterpiece, intricate details, photorealistic.";
    
    // Conversion de l'aspect ratio (ex: "16:9") en instruction textuelle pour plus de sûreté avec ce modèle preview
    const ratioInstruction = aspectRatio ? ` Aspect Ratio: ${aspectRatio}.` : "";

    const finalPrompt = `Generate an image: ${prompt}.${qualityInstruction}${ratioInstruction}`;

    // 3. CONSTRUCTION DU PAYLOAD (FORMAT GEMINI)
    // Contrairement à Imagen, Gemini prend "contents" et "parts".
    const payload = {
      contents: [
        {
          parts: [
            { text: finalPrompt }
          ]
        }
      ],
      // On force la réponse en image (si le modèle supporte responseModalities, sinon il le déduit du prompt)
      // Note: Pour certains modèles preview, "response_modalities" peut être requis ou "generationConfig"
      generationConfig: {
        responseModalities: ["IMAGE"],
        temperature: 0.9 // Créativité standard
      }
    };

    // Gestion de l'image de référence (Img2Img) si fournie
    if (images && images.length > 0) {
        // Ajout de l'image en entrée avant le texte
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
    
    // 4. GESTION DES ERREURS
    if (data.error) {
        // Si erreur 404, le modèle n'est peut-être pas activé sur votre clé (whitelist preview)
        // Si erreur 400, format de payload incorrect
        throw new Error(`Erreur Gemini (${data.error.code}): ${data.error.message}`);
    }

    // 5. EXTRACTION DE L'IMAGE
    // Structure de réponse Gemini : candidates[0].content.parts[...].inlineData
    const candidate = data.candidates?.[0];
    if (!candidate) {
        throw new Error("Aucune réponse du modèle. Le prompt a peut-être été bloqué.");
    }

    // On cherche la partie qui contient l'image
    const imagePart = candidate.content?.parts?.find(p => p.inlineData);
    
    if (!imagePart) {
        // Parfois le modèle refuse et répond par du texte (ex: "Je ne peux pas générer...")
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
