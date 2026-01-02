export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;

  if (request.method === "GET") {
    const { results } = await db.prepare("SELECT * FROM history ORDER BY id DESC").all();
    return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
  }

  if (request.method === "POST") {
    const { title, description, image, product_name, headlines, product_url, ad_copys } = await request.json();
    const result = await db.prepare(
      "INSERT INTO history (title, description, image, product_name, headlines, product_url, ad_copys, headlines_trans, ads_trans) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(title || "", description || "", image || "", product_name || "", headlines || "[]", product_url || "", ad_copys || "[]", "{}", "{}").run();
    return new Response(JSON.stringify({ id: result.meta.last_row_id }), { headers: { "content-type": "application/json" } });
  }

  if (request.method === "PATCH") {
    const { id, title, description, headlines, product_url, ad_copys, headlines_trans, ads_trans } = await request.json();
    if (title) await db.prepare("UPDATE history SET title = ? WHERE id = ?").bind(title, id).run();
    if (description) await db.prepare("UPDATE history SET description = ? WHERE id = ?").bind(description, id).run();
    if (headlines) await db.prepare("UPDATE history SET headlines = ? WHERE id = ?").bind(headlines, id).run();
    if (product_url !== undefined) await db.prepare("UPDATE history SET product_url = ? WHERE id = ?").bind(product_url, id).run();
    if (ad_copys) await db.prepare("UPDATE history SET ad_copys = ? WHERE id = ?").bind(ad_copys, id).run();
    if (headlines_trans) await db.prepare("UPDATE history SET headlines_trans = ? WHERE id = ?").bind(headlines_trans, id).run();
    if (ads_trans) await db.prepare("UPDATE history SET ads_trans = ? WHERE id = ?").bind(ads_trans, id).run();
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
