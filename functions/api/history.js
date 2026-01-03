export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);

  // --- GET (Récupération) ---
  if (request.method === "GET") {
    const id = url.searchParams.get("id");

    if (id) {
        // CHARGEMENT COMPLET (Quand on clique sur un produit)
        // On récupère tout, y compris les images générées
        const item = await db.prepare("SELECT * FROM history WHERE id = ?").bind(id).first();
        return new Response(JSON.stringify(item), { headers: { "content-type": "application/json" } });
    } else {
        // CHARGEMENT LISTE (Menu de gauche)
        // ON EXCLUT 'generated_images' pour la performance !
        const { results } = await db.prepare("SELECT id, title, description, image, product_name FROM history ORDER BY id DESC").all();
        return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
    }
  }

  // --- POST (Création) ---
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

  // --- PATCH (Mise à jour / Sauvegarde) ---
  if (request.method === "PATCH") {
    try {
        const body = await request.json();
        const { id } = body;

        if (!id) return new Response(JSON.stringify({ error: "ID manquant" }), { status: 400 });

        const updates = [];
        const values = [];
        // Liste stricte des champs autorisés
        const fields = ['title', 'description', 'headlines', 'product_url', 'ad_copys', 'headlines_trans', 'ads_trans', 'generated_images'];

        for (const field of fields) {
            if (body[field] !== undefined) {
                updates.push(`${field} = ?`);
                values.push(body[field]);
            }
        }

        if (updates.length === 0) return new Response(JSON.stringify({ error: "Aucun champ à mettre à jour" }), { status: 400 });

        values.push(id); 
        const query = `UPDATE history SET ${updates.join(", ")} WHERE id = ?`;

        await db.prepare(query).bind(...values).run();

        return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // --- DELETE (Suppression) ---
  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    await db.prepare("DELETE FROM history WHERE id = ?").bind(id).run();
    return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
  }
}
