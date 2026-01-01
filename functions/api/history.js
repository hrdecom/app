export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;

  if (!db) return new Response("DB Binding missing", { status: 500 });

  // GET : Récupérer tout l'historique (le filtrage se fera côté client pour plus de fluidité)
  if (request.method === "GET") {
    const { results } = await db.prepare("SELECT * FROM history ORDER BY id DESC").all();
    return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
  }

  // POST : Sauvegarder
  if (request.method === "POST") {
    const { title, description, image } = await request.json();
    let safeImage = (image && image.length > 800000) ? "IMAGE_TOO_LARGE" : image;
    await db.prepare("INSERT INTO history (title, description, image) VALUES (?, ?, ?)")
            .bind(title || "", description || "", safeImage || "").run();
    return new Response(JSON.stringify({ success: true }));
  }

  // DELETE : Supprimer un produit spécifique
  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return new Response("ID manquant", { status: 400 });
    await db.prepare("DELETE FROM history WHERE id = ?").bind(id).run();
    return new Response(JSON.stringify({ success: true }));
  }

  return new Response("Method not allowed", { status: 405 });
}
