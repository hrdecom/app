export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { image, prompt, aspectRatio } = body;

    if (!env.GEMINI_API_KEY) return new Response(JSON.stringify({ error: "Clé API manquante" }), { status: 500 });

    // Endpoint Imagen 3 (Via Google AI Studio API)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [
          {
            prompt: prompt,
            image: { bytesBase64Encoded: image }
          }
        ],
        parameters: {
          sampleCount: 1,
          aspectRatio: aspectRatio || "1:1",
          outputMimeType: "image/jpeg"
        }
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const generatedBase64 = data.predictions[0].bytesBase64Encoded;
    return new Response(JSON.stringify({ image: generatedBase64 }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
