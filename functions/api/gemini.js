{
type: uploaded file
fileName: hrdecom/app/app-27d76271ad2791fefb3fedb97f6611dbe58d43b2/functions/api/gemini.js
fullContent:
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { images, prompt, aspectRatio, resolution } = body; 
    // resolution attendu : "1k", "2k", "4k"
    // images : array de base64 (contexte optionnel selon capacités du modèle)

    if (!env.GEMINI_API_KEY) return new Response(JSON.stringify({ error: "Clé API Google manquante" }), { status: 500 });

    // 1. CHANGEMENT DU MODÈLE SELON DEMANDE SPÉCIFIQUE
    const modelName = "gemini-3-pro-image-preview"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${env.GEMINI_API_KEY}`;

    // 2. LOGIQUE DE CALCUL DE LA RÉSOLUTION (1k, 2k, 4k)
    // L'API attend souvent width/height si on sort du standard 1024x1024.
    // Base 1k = 1024, 2k = 2048, 4k = 4096 (approximatif selon ratio)
    
    let baseSize = 1024; // Défaut 1k
    if (resolution === "2k") baseSize = 2048;
    if (resolution === "4k") baseSize = 4096;

    let width = baseSize;
    let height = baseSize;

    // Calcul des dimensions selon l'Aspect Ratio
    // Note : Le modèle peut rejeter des dimensions trop élevées (ex: 4k natif), 
    // mais c'est la méthode correcte pour demander cette résolution via l'API.
    switch (aspectRatio) {
        case "16:9":
            width = baseSize;
            height = Math.round(baseSize * (9 / 16));
            break;
        case "9:16":
            width = Math.round(baseSize * (9 / 16));
            height = baseSize;
            break;
        case "4:3":
            width = baseSize;
            height = Math.round(baseSize * (3 / 4));
            break;
        case "3:4":
            width = Math.round(baseSize * (3 / 4));
            height = baseSize;
            break;
        case "1:1":
        default:
            width = baseSize;
            height = baseSize;
            break;
    }

    // 3. CONSTRUCTION DU PAYLOAD
    // Pour les modèles "gemini-..." image preview, la structure ressemble à celle d'Imagen
    const payload = {
      instances: [
        {
          prompt: prompt
          // Si le modèle supporte l'img2img (image input), décommenter ci-dessous :
          // image: images && images.length > 0 ? { bytesBase64Encoded: images[0] } : undefined
        }
      ],
      parameters: {
        sampleCount: 1,
        // On envoie le ratio textuel standard
        aspectRatio: aspectRatio || "1:1",
        // On force les dimensions calculées pour tenter d'atteindre la résolution cible
        // Note: Si le modèle ne supporte pas "width/height" explicites, il ignorera ou erreur.
        // Dans ce cas, il faudra s'en tenir à l'aspectRatio seul.
        // width: width,  <-- Décommenter si le modèle accepte les dimensions explicites (souvent restreint sur les previews)
        // height: height,
        
        // Certains modèles preview utilisent "sampleImageSize" ou "outputOptions"
        // Ici on passe le paramètre de format de sortie standard
        outputMimeType: "image/jpeg"
      }
    };

    // Ajout spécifique pour 2k/4k si supporté via paramètre de qualité ou upscale implicite
    // (À ajuster selon la doc exacte de ce modèle preview qui évolue vite)
    if (resolution === "2k" || resolution === "4k") {
        // payload.parameters.upscale = true; // Exemple hypothétique
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (data.error) {
        throw new Error(data.error.message || "Erreur API Google Gemini Image");
    }

    if (!data.predictions || !data.predictions[0].bytesBase64Encoded) {
        throw new Error("Aucune image retournée par l'API (vérifiez si le prompt n'a pas déclenché le filtre de sécurité).");
    }

    const generatedBase64 = data.predictions[0].bytesBase64Encoded;
    return new Response(JSON.stringify({ image: generatedBase64 }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
}
