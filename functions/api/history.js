export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;

  if (request.method === "GET") {
    const { results } = await db.prepare("SELECT * FROM history ORDER BY id DESC").all();
    return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
  }

  if (request.method === "POST") {
    const { title, description, image, product_name } = await request.json();
    const result = await db.prepare(
      "INSERT INTO history (title, description, image, product_name) VALUES (?, ?, ?, ?)"
    ).bind(title || "", description || "", image || "", product_name || "").run();
    
    // On renvoie l'ID de la ligne insérée
    return new Response(JSON.stringify({ id: result.meta.last_row_id }), {
      headers: { "content-type": "application/json" }
    });
  }

  if (request.method === "PATCH") {
    const { id, title, description } = await request.json();
    if (title) {
      await db.prepare("UPDATE history SET title = ? WHERE id = ?").bind(title, id).run();
    }
    if (description) {
      await db.prepare("UPDATE history SET description = ? WHERE id = ?").bind(description, id).run();
    }
    return new Response(JSON.stringify({ success: true }));
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    await db.prepare("DELETE FROM history WHERE id = ?").bind(id).run();
    return new Response(JSON.stringify({ success: true }));
  }

  return new Response("Method not allowed", { status: 405 });
}
