export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { images, prompt, aspectRatio, resolution } = body; 
    // resolution attendu : "1k", "2k", "4k"

    if (!env.GEMINI_API_KEY) return new Response(JSON.stringify({ error: "Clé API Google manquante" }), { status: 500 });

    // --- CONFIGURATION DU MODÈLE ---
    // Utilisation du modèle demandé
    const modelName = "gemini-3-pro-image"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${env.GEMINI_API_KEY}`;

    // --- CALCUL DE LA RÉSOLUTION ---
    // Base : 1k = 1024px, 2k = 2048px, 4k = 4096px
    let baseSize = 1024; 
    if (resolution === "2k") baseSize = 2048;
    if (resolution === "4k") baseSize = 4096;

    let width = baseSize;
    let height = baseSize;

    // Ajustement selon l'Aspect Ratio
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

    // --- CONSTRUCTION DU PAYLOAD ---
    const payload = {
      instances: [
        {
          prompt: prompt
        }
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: aspectRatio || "1:1",
        width: width,
        height: height,
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
        throw new Error(data.error.message || "Erreur API Google Gemini Image");
    }

    if (!data.predictions || !data.predictions[0].bytesBase64Encoded) {
        throw new Error("Aucune image générée. Vérifiez le prompt ou les paramètres.");
    }

    const generatedBase64 = data.predictions[0].bytesBase64Encoded;
    return new Response(JSON.stringify({ image: generatedBase64 }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
