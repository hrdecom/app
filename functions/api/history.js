export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;

  // GET : Récupérer les 50 dernières entrées
  if (request.method === "GET") {
    const { results } = await db.prepare(
      "SELECT * FROM history ORDER BY id DESC LIMIT 50"
    ).all();
    return new Response(JSON.stringify(results), {
      headers: { "content-type": "application/json" }
    });
  }

  // POST : Sauvegarder une nouvelle entrée
  if (request.method === "POST") {
    const { title, description, image } = await request.json();
    
    // On compresse légèrement l'image pour D1 (limite 1MB par ligne)
    // Ici on part du principe que l'image base64 est déjà raisonnable
    await db.prepare(
      "INSERT INTO history (title, description, image) VALUES (?, ?, ?)"
    ).bind(title, description, image).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { "content-type": "application/json" }
    });
  }

  return new Response("Method not allowed", { status: 405 });
}
