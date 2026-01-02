export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);

  // --- RECUPERATION (GET) ---
  if (request.method === "GET") {
    const id = url.searchParams.get("id");

    if (id) {
        // CAS 1 : On demande un produit précis (pour le restaurer)
        // Là on renvoie TOUT (y compris les images générées lourdes)
        const item = await db.prepare("SELECT * FROM history WHERE id = ?").bind(id).first();
        return new Response(JSON.stringify(item), { headers: { "content-type": "application/json" } });
    } else {
        // CAS 2 : On demande la liste pour la sidebar
        // OPTIMISATION : On NE sélectionne PAS 'generated_images' ni les textes longs pour éviter de faire ramer l'appli
        const { results } = await db.prepare("SELECT id, title, description, image, product_name FROM history ORDER BY id DESC").all();
        return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
    }
  }

  // --- CREATION (POST) ---
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
      "[]" 
    ).run();
    return new Response(JSON.stringify({ id: result.meta.last_row_id }), { headers: { "content-type": "application/json" } });
  }

  // --- MISE A JOUR (PATCH) ---
  if (request.method === "PATCH") {
    const body = await request.json();
    const { id } = body;

    if (!id) return new Response("Missing ID", { status: 400 });

    // Construction dynamique de la requête SQL
    const updates = [];
    const values = [];

    // Liste des champs autorisés à être mis à jour
    const fields = ['title', 'description', 'headlines', 'product_url', 'ad_copys', 'headlines_trans', 'ads_trans', 'generated_images'];

    for (const field of fields) {
        if (body[field] !== undefined) {
            updates.push(`${field} = ?`);
            values.push(body[field]);
        }
    }

    if (updates.length === 0) return new Response("No fields to update", { status: 400 });

    values.push(id); // Pour le WHERE id = ?
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
