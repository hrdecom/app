export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);

  // --- GET (LECTURE) ---
  if (request.method === "GET") {
    const id = url.searchParams.get("id");

    if (id) {
        // 1. Récupérer l'historique principal
        const item = await db.prepare("SELECT * FROM history WHERE id = ?").bind(id).first();
        if (!item) return new Response("Not found", { status: 404 });

        // 2. Récupérer les images (Méta-données)
        const imagesMeta = await db.prepare("SELECT id, prompt, aspect_ratio as aspectRatio FROM history_images WHERE history_id = ?").bind(id).all();

        const reconstructedImages = [];

        // 3. Réassembler les morceaux (Chunks) pour chaque image
        if (imagesMeta.results && imagesMeta.results.length > 0) {
            for (const img of imagesMeta.results) {
                // On récupère les morceaux dans l'ordre
                const chunks = await db.prepare("SELECT chunk_data FROM history_image_chunks WHERE history_image_id = ? ORDER BY chunk_index ASC").bind(img.id).all();

                // On recolle les morceaux
                const fullBase64 = chunks.results.map(c => c.chunk_data).join('');

                // Vérifier si c'est l'image MAIN (marquée avec prompt spécial)
                if (img.prompt === "__MAIN__") {
                    item.image = fullBase64;
                } else {
                    reconstructedImages.push({
                        image: fullBase64,
                        prompt: img.prompt,
                        aspectRatio: img.aspectRatio
                    });
                }
            }
        }

        item.generated_images = JSON.stringify(reconstructedImages);
        return new Response(JSON.stringify(item), { headers: { "content-type": "application/json" } });

    } else {
        // LISTE LEGERE (Sidebar)
        const { results } = await db.prepare("SELECT id, title, description, image, product_name FROM history ORDER BY id DESC").all();
        return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
    }
  }

  // --- POST (CREATION) ---
  if (request.method === "POST") {
    const { title, description, image, product_name, headlines, product_url, ad_copys } = await request.json();
    const result = await db.prepare(
      "INSERT INTO history (title, description, image, product_name, headlines, product_url, ad_copys, headlines_trans, ads_trans, generated_images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      title || "", description || "", image || "", product_name || "", 
      headlines || "[]", product_url || "", ad_copys || "[]", "{}", "{}", "[]"
    ).run();
    return new Response(JSON.stringify({ id: result.meta.last_row_id }), { headers: { "content-type": "application/json" } });
  }

  // --- PATCH (SAUVEGARDE INTELLIGENTE) ---
  if (request.method === "PATCH") {
    try {
        const bodyText = await request.text();
        console.log("PATCH raw body length:", bodyText.length);

        const body = JSON.parse(bodyText);
        const { id, generated_images } = body;

        if (!id) return new Response(JSON.stringify({ error: "ID manquant" }), { status: 400 });

        const CHUNK_SIZE = 100 * 1024; // 100 KB par morceau

        // 1. Mise à jour textes (Table History)
        // Note: 'image' est géré séparément via chunking pour éviter les limites D1
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

        // 2. Gestion de l'image MAIN (Chunking pour éviter les limites D1)
        if (body.image !== undefined) {
            console.log("Saving MAIN image with chunking - length:", body.image?.length || 0);

            // A. Supprimer l'ancien chunk MAIN s'il existe
            const oldMainImage = await db.prepare("SELECT id FROM history_images WHERE history_id = ? AND prompt = '__MAIN__'").bind(id).first();
            if (oldMainImage) {
                await db.prepare("DELETE FROM history_image_chunks WHERE history_image_id = ?").bind(oldMainImage.id).run();
                await db.prepare("DELETE FROM history_images WHERE id = ?").bind(oldMainImage.id).run();
            }

            // B. Insérer le nouveau MAIN image avec chunking
            if (body.image && body.image.length > 0) {
                const res = await db.prepare("INSERT INTO history_images (history_id, prompt, aspect_ratio, image) VALUES (?, '__MAIN__', '', '')").bind(id).run();
                const mainImgId = res.meta.last_row_id;

                // Découper le base64
                const b64 = body.image;
                const chunks = [];
                for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
                    chunks.push(b64.slice(i, i + CHUNK_SIZE));
                }

                // Insérer les morceaux
                if (chunks.length > 0) {
                    const stmt = db.prepare("INSERT INTO history_image_chunks (history_image_id, chunk_index, chunk_data) VALUES (?, ?, ?)");
                    const batch = chunks.map((c, idx) => stmt.bind(mainImgId, idx, c));
                    await db.batch(batch);
                }
                console.log("MAIN image saved in", chunks.length, "chunks");
            }
        }

        // 3. Gestion des Images générées (Découpage)
        if (generated_images) {
            const imagesArray = JSON.parse(generated_images);

            // A. Nettoyage des anciennes images (sauf MAIN) et leurs chunks
            const oldImages = await db.prepare("SELECT id FROM history_images WHERE history_id = ? AND prompt != '__MAIN__'").bind(id).all();
            if (oldImages.results.length > 0) {
                const idsToDelete = oldImages.results.map(r => r.id).join(',');
                await db.prepare(`DELETE FROM history_image_chunks WHERE history_image_id IN (${idsToDelete})`).run();
            }
            await db.prepare("DELETE FROM history_images WHERE history_id = ? AND prompt != '__MAIN__'").bind(id).run();

            // B. Insertion des nouvelles images avec découpage
            if (imagesArray.length > 0) {
                for (const img of imagesArray) {
                    // 1. Créer l'entrée image (Méta)
                    const res = await db.prepare("INSERT INTO history_images (history_id, prompt, aspect_ratio, image) VALUES (?, ?, ?, ?)").bind(id, img.prompt || "", img.aspectRatio || "", "").run();
                    const imgId = res.meta.last_row_id;

                    // 2. Découper le base64
                    const b64 = img.image || "";
                    const chunks = [];
                    for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
                        chunks.push(b64.slice(i, i + CHUNK_SIZE));
                    }

                    // 3. Insérer les morceaux (Batch)
                    if (chunks.length > 0) {
                        const stmt = db.prepare("INSERT INTO history_image_chunks (history_image_id, chunk_index, chunk_data) VALUES (?, ?, ?)");
                        const batch = chunks.map((c, idx) => stmt.bind(imgId, idx, c));
                        await db.batch(batch);
                    }
                }
            }
        }

        return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
    } catch (e) {
        console.error("D1 PATCH Error:", e);
        return new Response(JSON.stringify({ error: "D1 Error: " + e.message, details: e.stack }), { status: 500, headers: { "content-type": "application/json" } });
    }
  }

  // --- DELETE ---
  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    // Nettoyage en cascade (Chunks -> Images -> History)
    // Note: D1 ne gère pas toujours bien les sous-requêtes complexes dans un batch, on fait séquentiel pour être sûr
    const oldImages = await db.prepare("SELECT id FROM history_images WHERE history_id = ?").bind(id).all();
    if (oldImages.results.length > 0) {
        const idsToDelete = oldImages.results.map(r => r.id).join(',');
        await db.prepare(`DELETE FROM history_image_chunks WHERE history_image_id IN (${idsToDelete})`).run();
    }
    await db.batch([
        db.prepare("DELETE FROM history_images WHERE history_id = ?").bind(id),
        db.prepare("DELETE FROM history WHERE id = ?").bind(id)
    ]);
    return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
  }
}
