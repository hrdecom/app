export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { images, prompt, aspectRatio, resolution } = body; 
    // "images" est un array de base64 envoyé par le frontend (image principale + ajouts)

    if (!env.GEMINI_API_KEY) return new Response(JSON.stringify({ error: "Clé API Google manquante" }), { status: 500 });

    // Modèle Imagen 3 (standard pour la génération d'image sur AI Studio)
    // Si vous avez un accès spécifique "gemini-3-pro-image-preview", remplacez le nom du modèle ici.
    const modelName = "imagen-3.0-generate-001"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${env.GEMINI_API_KEY}`;

    // Construction du payload
    // Imagen 3 standard prend "prompt". Si on veut faire du Img2Img, cela dépend des capacités spécifiques du endpoint.
    // Ici on envoie le prompt textuel.
    
    // Note: Pour "resolution", Imagen 3 gère ça souvent via aspect ratio ou upscale, on map ici simplement.
    let finalAspectRatio = aspectRatio || "1:1";

    const payload = {
      instances: [
        {
          prompt: prompt
          // Note: L'API publique REST Imagen ne supporte pas toujours directement "image" en entrée (Img2Img) 
          // sauf via Vertex AI. Si votre clé supporte l'input image ici, décommentez la ligne suivante :
          // image: images && images.length > 0 ? { bytesBase64Encoded: images[0] } : undefined
        }
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: finalAspectRatio,
        outputMimeType: "image/jpeg"
      }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (data.error) {
        // Fallback ou erreur explicite
        throw new Error(data.error.message || "Erreur lors de la génération Gemini/Imagen");
    }

    if (!data.predictions || !data.predictions[0].bytesBase64Encoded) {
        throw new Error("Aucune image retournée par l'API.");
    }

    const generatedBase64 = data.predictions[0].bytesBase64Encoded;
    return new Response(JSON.stringify({ image: generatedBase64 }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
