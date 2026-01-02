export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;

  if (request.method === "GET") {
    const { results } = await db.prepare("SELECT * FROM history ORDER BY id DESC").all();
    return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
  }

  if (request.method === "POST") {
    const { title, description, image, product_name, product_url } = await request.json();
    const result = await db.prepare(
      "INSERT INTO history (title, description, image, product_name, headlines, product_url, ad_copys, headlines_trans, ads_trans, generated_images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      title || "", description || "", image || "", product_name || "", "[]", product_url || "", "[]", "{}", "{}", "[]"
    ).run();
    return new Response(JSON.stringify({ id: result.meta.last_row_id }), { headers: { "content-type": "application/json" } });
  }

  if (request.method === "PATCH") {
    const body = await request.json();
    const { id } = body;
    if (body.title !== undefined) await db.prepare("UPDATE history SET title = ? WHERE id = ?").bind(body.title, id).run();
    if (body.description !== undefined) await db.prepare("UPDATE history SET description = ? WHERE id = ?").bind(body.description, id).run();
    if (body.headlines !== undefined) await db.prepare("UPDATE history SET headlines = ? WHERE id = ?").bind(body.headlines, id).run();
    if (body.product_url !== undefined) await db.prepare("UPDATE history SET product_url = ? WHERE id = ?").bind(body.product_url, id).run();
    if (body.ad_copys !== undefined) await db.prepare("UPDATE history SET ad_copys = ? WHERE id = ?").bind(body.ad_copys, id).run();
    if (body.headlines_trans !== undefined) await db.prepare("UPDATE history SET headlines_trans = ? WHERE id = ?").bind(body.headlines_trans, id).run();
    if (body.ads_trans !== undefined) await db.prepare("UPDATE history SET ads_trans = ? WHERE id = ?").bind(body.ads_trans, id).run();
    if (body.generated_images !== undefined) await db.prepare("UPDATE history SET generated_images = ? WHERE id = ?").bind(body.generated_images, id).run();
    return new Response(JSON.stringify({ success: true }));
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    await db.prepare("DELETE FROM history WHERE id = ?").bind(id).run();
    return new Response(JSON.stringify({ success: true }));
  }
}
