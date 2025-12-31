export async function onRequestPost({ request, env }) {
  try {
    const { prompt } = await request.json();

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return new Response(JSON.stringify({ error: "Prompt manquant." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ⚠️ Mets ta clé Anthropic dans Cloudflare (étape 3), pas ici.
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Clé API manquante côté serveur." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const model = env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `Erreur Anthropic (${anthropicRes.status})`, details: errText }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await anthropicRes.json();

    // Anthropic renvoie souvent le texte dans data.content[0].text
    const text = data?.content?.[0]?.text ?? "";

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Erreur serveur.", details: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
