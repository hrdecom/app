export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);

  // --- RÉCUPÉRATION (GET) ---
  if (request.method === "GET") {
    const id = url.searchParams.get("id");

    if (id) {
        // CAS 1 : Charger UN SEUL produit complet (avec les images lourdes)
        // C'est ce qui est appelé quand on clique sur un historique ou qu'on restaure la session
        const item = await db.prepare("SELECT * FROM history WHERE id = ?").bind(id).first();
        return new Response(JSON.stringify(item), { headers: { "content-type": "application/json" } });
    } else {
        // CAS 2 : Charger la LISTE latérale (Version légère)
        // On EXCLUT 'generated_images' pour que l'appli reste fluide
        const { results } = await db.prepare("SELECT id, title, description, image, product_name FROM history ORDER BY id DESC").all();
        return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
    }
  }

  // --- CRÉATION (POST) ---
  if (request.method === "POST") {
    const { title, description, image, product_name, headlines, product_url, ad_copys } = await request.json();
    const result = await db.prepare(
      "INSERT INTO history (title, description, image, product_name, headlines, product_url, ad_copys, headlines_trans, ads_trans, generated_images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      title || "", 
      description || "", 
      image || "", 
      product_name || "", 
      headlines || "[]", 
      product_url || "", 
      ad_copys || "[]", 
      "{}", 
      "{}",
      "[]" // Initialisation du tableau d'images vide
    ).run();
    return new Response(JSON.stringify({ id: result.meta.last_row_id }), { headers: { "content-type": "application/json" } });
  }

  // --- MISE À JOUR (PATCH) ---
  if (request.method === "PATCH") {
    const body = await request.json();
    const { id } = body;

    if (!id) return new Response("Missing ID", { status: 400 });

    const updates = [];
    const values = [];
    // On autorise la sauvegarde de generated_images
    const fields = ['title', 'description', 'headlines', 'product_url', 'ad_copys', 'headlines_trans', 'ads_trans', 'generated_images'];

    for (const field of fields) {
        if (body[field] !== undefined) {
            updates.push(`${field} = ?`);
            values.push(body[field]);
        }
    }

    if (updates.length === 0) return new Response("No fields to update", { status: 400 });

    values.push(id); 
    const query = `UPDATE history SET ${updates.join(", ")} WHERE id = ?`;

    await db.prepare(query).bind(...values).run();

    return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
  }

  // --- SUPPRESSION (DELETE) ---
  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    await db.prepare("DELETE FROM history WHERE id = ?").bind(id).run();
    return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
  }
}
