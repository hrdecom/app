export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);

  // --- GET: RÉCUPÉRATION ---
  if (request.method === "GET") {
    const id = url.searchParams.get("id");

    if (id) {
        // 1. Récupérer le produit principal
        const item = await db.prepare("SELECT * FROM history WHERE id = ?").bind(id).first();
        
        if (!item) return new Response("Not found", { status: 404 });

        // 2. Récupérer les images associées dans la table séparée
        // On va chercher les images 4K stockées ligne par ligne
        try {
            const imagesResults = await db.prepare("SELECT image, prompt, aspect_ratio as aspectRatio FROM history_images WHERE history_id = ?").bind(id).all();
            
            // 3. Reconstituer le format attendu par le frontend (JSON)
            item.generated_images = JSON.stringify(imagesResults.results || []);
        } catch (e) {
            // Fallback si la table n'existe pas encore ou erreur
            item.generated_images = "[]";
        }

        return new Response(JSON.stringify(item), { headers: { "content-type": "application/json" } });
    } else {
        // CHARGEMENT LISTE (Menu de gauche)
        // Optimisation : On ne charge QUE les textes légers
        const { results } = await db.prepare("SELECT id, title, description, image, product_name FROM history ORDER BY id DESC").all();
        return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
    }
  }

  // --- POST: CRÉATION ---
  if (request.method === "POST") {
    const { title, description, image, product_name, headlines, product_url, ad_copys } = await request.json();
    
    // On insère l'historique sans les images générées (elles sont vides au début)
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
      "[]" // On laisse le champ vide/array vide pour la compatibilité
    ).run();
    
    return new Response(JSON.stringify({ id: result.meta.last_row_id }), { headers: { "content-type": "application/json" } });
  }

  // --- PATCH: SAUVEGARDE & MISE À JOUR ---
  if (request.method === "PATCH") {
    try {
        const body = await request.json();
        const { id, generated_images } = body; // On isole les images

        if (!id) return new Response(JSON.stringify({ error: "ID manquant" }), { status: 400 });

        // 1. Mise à jour de la table HISTORY (Textes uniquement)
        const updates = [];
        const values = [];
        // IMPORTANT: 'generated_images' est RETIRÉ de cette liste pour éviter l'erreur TOOBIG
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
            let imagesArray;
            try {
                imagesArray = JSON.parse(generated_images);
            } catch (e) {
                imagesArray = [];
            }
            
            // A. Supprimer les anciennes images pour cet ID (Reset)
            // Cela permet de gérer les suppressions ou réorganisations faites dans le frontend
            await db.prepare("DELETE FROM history_images WHERE history_id = ?").bind(id).run();

            // B. Insérer les nouvelles images une par une
            // Cette boucle permet d'éviter l'erreur de taille car chaque image est une requête séparée ou un petit batch
            if (imagesArray.length > 0) {
                const stmt = db.prepare("INSERT INTO history_images (history_id, image, prompt, aspect_ratio) VALUES (?, ?, ?, ?)");
                
                // On boucle pour insérer
                for (const img of imagesArray) {
                    // On s'assure que les données existent
                    await stmt.bind(id, img.image || "", img.prompt || "", img.aspectRatio || "").run();
                }
            }
        }

        return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
    } catch (e) {
        return new Response(JSON.stringify({ error: "D1 Error: " + e.message }), { status: 500 });
    }
  }

  // --- DELETE: SUPPRESSION ---
  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    // Suppression en cascade (Historique + Images liées)
    await db.batch([
        db.prepare("DELETE FROM history WHERE id = ?").bind(id),
        db.prepare("DELETE FROM history_images WHERE history_id = ?").bind(id)
    ]);
    return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
  }
}
