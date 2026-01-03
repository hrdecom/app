export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);

  // --- GET: RECUPERATION ---
  if (request.method === "GET") {
    const id = url.searchParams.get("id");

    if (id) {
        // 1. Récupérer le produit principal
        const item = await db.prepare("SELECT * FROM history WHERE id = ?").bind(id).first();
        
        if (!item) return new Response("Not found", { status: 404 });

        // 2. Récupérer les images associées dans la table séparée
        const imagesResults = await db.prepare("SELECT image, prompt, aspect_ratio as aspectRatio FROM history_images WHERE history_id = ?").bind(id).all();
        
        // 3. Reconstituer le format attendu par le frontend
        // Note: imagesResults.results contient les lignes
        item.generated_images = JSON.stringify(imagesResults.results || []);

        return new Response(JSON.stringify(item), { headers: { "content-type": "application/json" } });
    } else {
        // Liste légère (Sidebar)
        const { results } = await db.prepare("SELECT id, title, description, image, product_name FROM history ORDER BY id DESC").all();
        return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
    }
  }

  // --- POST: CREATION NOUVEAU PRODUIT ---
  if (request.method === "POST") {
    const { title, description, image, product_name, headlines, product_url, ad_copys } = await request.json();
    const result = await db.prepare(
      "INSERT INTO history (title, description, image, product_name, headlines, product_url, ad_copys, headlines_trans, ads_trans) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      title || "", 
      description || "", 
      image || "", 
      product_name || "", 
      headlines || "[]", 
      product_url || "", 
      ad_copys || "[]", 
      "{}", 
      "{}"
    ).run();
    return new Response(JSON.stringify({ id: result.meta.last_row_id }), { headers: { "content-type": "application/json" } });
  }

  // --- PATCH: SAUVEGARDE & MISE A JOUR ---
  if (request.method === "PATCH") {
    try {
        const body = await request.json();
        const { id, generated_images } = body;

        if (!id) return new Response(JSON.stringify({ error: "ID manquant" }), { status: 400 });

        // 1. Mise à jour des champs textes classiques (sauf generated_images)
        const updates = [];
        const values = [];
        const fields = ['title', 'description', 'headlines', 'product_url', 'ad_copys', 'headlines_trans', 'ads_trans'];

        for (const field of fields) {
            if (body[field] !== undefined) {
                updates.push(`${field} = ?`);
                values.push(body[field]);
            }
        }

        if (updates.length > 0) {
            values.push(id);
            await db.prepare(`UPDATE history SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
        }

        // 2. GESTION DES IMAGES (Table Séparée)
        if (generated_images) {
            const imagesArray = JSON.parse(generated_images);
            
            // A. Supprimer les anciennes images pour cet ID (Méthode brutale mais sûre pour la synchro)
            await db.prepare("DELETE FROM history_images WHERE history_id = ?").bind(id).run();

            // B. Insérer les nouvelles images une par une (Batch)
            if (imagesArray.length > 0) {
                const stmt = db.prepare("INSERT INTO history_images (history_id, image, prompt, aspect_ratio) VALUES (?, ?, ?, ?)");
                const batch = imagesArray.map(img => stmt.bind(id, img.image, img.prompt, img.aspectRatio || ""));
                await db.batch(batch);
            }
        }

        return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // --- DELETE: SUPPRESSION ---
  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    // Supprimer l'historique ET les images associées
    await db.batch([
        db.prepare("DELETE FROM history WHERE id = ?").bind(id),
        db.prepare("DELETE FROM history_images WHERE history_id = ?").bind(id)
    ]);
    return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
  }
}
