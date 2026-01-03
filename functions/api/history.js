export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);

  // --- GET ---
  if (request.method === "GET") {
    const id = url.searchParams.get("id");

    if (id) {
        // 1. Charger l'info produit
        const item = await db.prepare("SELECT * FROM history WHERE id = ?").bind(id).first();
        if (!item) return new Response("Not found", { status: 404 });

        // 2. Charger les images depuis la table dédiée
        // On récupère le base64 (image), le prompt et l'aspect ratio
        const imagesResults = await db.prepare("SELECT image, prompt, aspect_ratio as aspectRatio FROM history_images WHERE history_id = ?").bind(id).all();
        
        // 3. Injecter dans l'objet pour le frontend
        // Le frontend attend "generated_images" comme une chaine JSON
        item.generated_images = JSON.stringify(imagesResults.results || []);

        return new Response(JSON.stringify(item), { headers: { "content-type": "application/json" } });
    } else {
        // Liste légère (Sidebar)
        const { results } = await db.prepare("SELECT id, title, description, image, product_name FROM history ORDER BY id DESC").all();
        return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
    }
  }

  // --- POST ---
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

  // --- PATCH (Le correctif est ici) ---
  if (request.method === "PATCH") {
    try {
        const body = await request.json();
        const { id, generated_images } = body; // On extrait les images à part

        if (!id) return new Response(JSON.stringify({ error: "ID manquant" }), { status: 400 });

        // 1. Mise à jour de la table HISTORY (Textes uniquement)
        // IMPORTANT : On a retiré 'generated_images' de cette liste pour éviter l'erreur SQLITE_TOOBIG
        const fields = ['title', 'description', 'headlines', 'product_url', 'ad_copys', 'headlines_trans', 'ads_trans'];
        const updates = [];
        const values = [];

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

        // 2. Mise à jour de la table HISTORY_IMAGES (Images lourdes)
        if (generated_images) {
            const imagesArray = JSON.parse(generated_images);
            
            // A. On nettoie les anciennes images de ce produit
            await db.prepare("DELETE FROM history_images WHERE history_id = ?").bind(id).run();

            // B. On insère les nouvelles une par une
            // Note: D1 supporte mal les batchs massifs de base64, on boucle proprement
            if (imagesArray.length > 0) {
                const stmt = db.prepare("INSERT INTO history_images (history_id, image, prompt, aspect_ratio) VALUES (?, ?, ?, ?)");
                
                // Exécution séquentielle pour éviter de surcharger la requête
                for (const img of imagesArray) {
                    await stmt.bind(id, img.image, img.prompt, img.aspectRatio || "").run();
                }
            }
        }

        return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
    } catch (e) {
        return new Response(JSON.stringify({ error: "D1 Error: " + e.message }), { status: 500 });
    }
  }

  // --- DELETE ---
  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    await db.batch([
        db.prepare("DELETE FROM history WHERE id = ?").bind(id),
        db.prepare("DELETE FROM history_images WHERE history_id = ?").bind(id)
    ]);
    return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
  }
}
