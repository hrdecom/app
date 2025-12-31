/* popup.js — Web App (Cloudflare Pages)
   - Compatible avec index.html (prompt, generate, result)
   - Sans chrome.* (plus une extension)
   - Prépare le terrain pour une API Cloudflare (endpoint /api/generate)
*/

const $ = (id) => document.getElementById(id);

const ui = {
  prompt: $("prompt"),
  generate: $("generate"),
  result: $("result"),
};

function setResult(text, { isError = false } = {}) {
  ui.result.innerHTML = "";
  const pre = document.createElement("div");
  pre.textContent = text;
  if (isError) pre.style.color = "crimson";
  ui.result.appendChild(pre);
}

function setLoading(isLoading) {
  ui.generate.disabled = isLoading;
  ui.generate.textContent = isLoading ? "Génération..." : "Générer";
}

// Petite persistence locale (pratique, et simple)
const LS_KEY = "hrdecom_copy_prompt_v1";
try {
  const saved = localStorage.getItem(LS_KEY);
  if (saved && !ui.prompt.value) ui.prompt.value = saved;
} catch {}

// Sauvegarde quand tu tapes
ui.prompt?.addEventListener("input", () => {
  try { localStorage.setItem(LS_KEY, ui.prompt.value); } catch {}
});

async function callGenerateAPI(prompt) {
  // Endpoint que nous créerons à l’étape suivante dans Cloudflare (Pages Functions/Workers)
  // Attendu: POST /api/generate { prompt: "..." } -> { text: "..." }
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Erreur API (${res.status}). ${msg}`.trim());
  }

  const data = await res.json();
  if (!data || typeof data.text !== "string") {
    throw new Error("Réponse API inattendue (il manque le champ 'text').");
  }
  return data.text;
}

ui.generate?.addEventListener("click", async () => {
  const prompt = (ui.prompt?.value || "").trim();
  if (!prompt) {
    setResult("Écris d’abord un prompt dans le champ ci-dessus.", { isError: true });
    ui.prompt?.focus();
    return;
  }

  setLoading(true);
  setResult("Connexion au serveur…");

  try {
    // Tentative d'appel serveur (à créer). Si pas encore en place, on affiche un message clair.
    const text = await callGenerateAPI(prompt);
    setResult(text);
  } catch (err) {
    // Mode “fallback” : explique quoi faire ensuite.
    const msg = String(err?.message || err);
    setResult(
      [
        "✅ L’interface web fonctionne.",
        "",
        "⚠️ La partie “génération” n’est pas encore branchée (normal à cette étape).",
        "Détail : " + msg,
        "",
        "➡️ Prochaine étape : on crée l’API /api/generate sur Cloudflare (Workers/Pages Functions)",
        "pour appeler le modèle côté serveur et renvoyer le texte ici, sans exposer de clé dans le navigateur.",
      ].join("\n"),
      { isError: true }
    );
  } finally {
    setLoading(false);
  }
});
