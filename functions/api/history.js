// functions/api/history.js

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;

  if (!db) {
    return new Response(JSON.stringify({ error: "Lien DB manquant dans Cloudflare" }), { status: 500 });
  }

  // GET : Récupérer l'historique
  if (request.method === "GET") {
    try {
      const { results } = await db.prepare(
        "SELECT * FROM history ORDER BY id DESC LIMIT 50"
      ).all();
      return new Response(JSON.stringify(results), {
        headers: { "content-type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // POST : Sauvegarder
  if (request.method === "POST") {
    try {
      const { title, description, image } = await request.json();
      
      // Vérification de la taille (D1 limite à 1MB par ligne environ)
      // Si l'image est trop grande, on stocke une chaîne vide pour éviter le crash 500
      let safeImage = image;
      if (image && image.length > 700000) { // ~700kb en base64
        console.warn("Image trop lourde pour D1, stockage annulé pour cette image");
        safeImage = "IMAGE_TOO_LARGE"; 
      }

      await db.prepare(
        "INSERT INTO history (title, description, image) VALUES (?, ?, ?)"
      ).bind(title || "Sans titre", description || "", safeImage || "").run();

      return new Response(JSON.stringify({ success: true }), {
        headers: { "content-type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}
