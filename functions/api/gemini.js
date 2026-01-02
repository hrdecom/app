export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { image, prompt, aspect_ratio, resolution } = body;

    if (!env.GEMINI_API_KEY) return new Response(JSON.stringify({ error: "Clé Gemini manquante" }), { status: 500 });

    // Note: On utilise ici l'endpoint Imagen via Gemini 1.5/2.0 Pro
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: `TASK: Generate a new image based on the provided image. 
                     PROMPT: ${prompt}. 
                     SETTINGS: Aspect Ratio: ${aspect_ratio}, Resolution: ${resolution}. 
                     OUTPUT: Return the generated image data.` },
            { inline_data: { mime_type: "image/jpeg", data: image } }
          ]
        }]
      })
    });

    const data = await res.json();
    // Le modèle renvoie soit du texte (description) soit l'image si configuré avec Imagen
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
