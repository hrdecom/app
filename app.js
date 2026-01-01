/* app.js — Portage WEB de l'extension (sans Ads Copy)
   - Remplace chrome.* par localStorage
   - Remplace background messaging par fetch('/api/generate')
   - Conserve: upload image, génération, régénération titre/desc, collections, historique,
     export/import, blocklist CSV, modal traduction/HTML FR, copier.
*/

/* -------------------- Helpers -------------------- */
const $ = (id) => document.getElementById(id);
const nowISO = () => new Date().toISOString();

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
}

function safeJSONParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function downloadText(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function formatTimer(ms) {
  const sec = Math.floor(ms / 1000);
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/* -------------------- State -------------------- */
let persistKey = "hrdecom_app_v1"; // can be changed in settings
const state = {
  imageDataUrl: null,
  imageBase64: null,
  imageMediaType: null,
  title: "",
  description: "",
  selectedCollection: null, // {name, desc}
  collections: [],
  history: [], // [{id, ts, title, description, imageThumb}]
  usedSet: new Set(), // from CSV or exports
  modelOverride: ""
};

/* -------------------- Elements -------------------- */
const els = {
  settingsBtn: $("settingsBtn"),
  settings: $("settings"),
  apiKey: $("apiKey"),
  modelName: $("modelName"),
  persistKey: $("persistKey"),
  saveSettings: $("saveSettings"),
  clearUsed: $("clearUsed"),
  csvFile: $("csvFile"),
  csvInfo: $("csvInfo"),
  exportTemplate: $("exportTemplate"),
  exportBlocklist: $("exportBlocklist"),
  drop: $("drop"),
  dropPlaceholder: $("dropPlaceholder"),
  imageInput: $("imageInput"),
  preview: $("preview"),
  previewImg: $("previewImg"),
  removeImage: $("removeImage"),
  generateBtn: $("generateBtn"),
  regenTitleBtn: $("regenTitleBtn"),
  regenDescBtn: $("regenDescBtn"),
  copyTitle: $("copyTitle"),
  copyDesc: $("copyDesc"),
  infoDesc: $("infoDesc"),
  titleText: $("titleText"),
  descText: $("descText"),
  historyList: $("historyList"),
  loading: $("loading"),
  timer: $("timer"),
  toast: $("toast"),
  collectionSelect: $("collectionSelect"),
  applyCollection: $("applyCollection"),
  collectionsEditor: $("collectionsEditor"),
  newCollection: $("newCollection"),
  newCollectionDesc: $("newCollectionDesc"),
  addCollection: $("addCollection"),
  resetCollections: $("resetCollections"),
  saveCollections: $("saveCollections"),
  exportAll: $("exportAll"),
  importAll: $("importAll"),
  importAllFile: $("importAllFile"),
  modal: $("modal"),
  modalBody: $("modalBody"),
  modalClose: $("modalClose")
};

/* -------------------- Storage -------------------- */
function k(suffix) { return `${persistKey}:${suffix}`; }

function loadAll() {
  // persistKey itself
  const savedKey = localStorage.getItem("hrdecom:persistKey");
  if (savedKey) persistKey = savedKey;

  state.modelOverride = localStorage.getItem(k("modelOverride")) || "";
  state.history = safeJSONParse(localStorage.getItem(k("history")) || "[]", []);
  state.collections = safeJSONParse(localStorage.getItem(k("collections")) || "[]", defaultCollections());
  const usedArr = safeJSONParse(localStorage.getItem(k("used")) || "[]", []);
  state.usedSet = new Set(usedArr);

  // reflect UI
  els.persistKey.value = persistKey;
  els.modelName.value = state.modelOverride;
}

function saveAll() {
  localStorage.setItem("hrdecom:persistKey", persistKey);
  localStorage.setItem(k("modelOverride"), state.modelOverride || "");
  localStorage.setItem(k("history"), JSON.stringify(state.history.slice(0, 50)));
  localStorage.setItem(k("collections"), JSON.stringify(state.collections));
  localStorage.setItem(k("used"), JSON.stringify(Array.from(state.usedSet)));
}

/* -------------------- Defaults -------------------- */
function defaultCollections() {
  return [
    { name: "Name", desc: "Personalized / engraved jewelry, emotional, gift-oriented tone." },
    { name: "Minimal", desc: "Minimalist modern jewelry, clean design, understated luxury." },
    { name: "Bold", desc: "Statement jewelry, confident, fashion-forward tone." }
  ];
}

/* -------------------- UI Rendering -------------------- */
function renderCollections() {
  els.collectionSelect.innerHTML = "";
  state.collections.forEach((c, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = c.name || `Collection ${idx+1}`;
    els.collectionSelect.appendChild(opt);
  });

  // editor
  els.collectionsEditor.value = state.collections
    .map(c => `${c.name} | ${c.desc}`)
    .join("\n");
}

function renderHistory() {
  els.historyList.innerHTML = "";
  if (!state.history.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "Aucun élément pour le moment.";
    els.historyList.appendChild(empty);
    return;
  }

  state.history.slice(0, 20).forEach(item => {
    const row = document.createElement("button");
    row.className = "history-item";
    row.type = "button";
    row.title = "Recharger cette génération";

    const thumb = document.createElement("img");
    thumb.className = "history-thumb";
    thumb.src = item.imageThumb || "";

    const meta = document.createElement("div");
    meta.className = "history-meta";

    const t = document.createElement("div");
    t.className = "history-title";
    t.textContent = item.title || "(Sans titre)";

    const d = document.createElement("div");
    d.className = "history-desc";
    d.textContent = (item.description || "").slice(0, 80);

    meta.appendChild(t);
    meta.appendChild(d);

    row.appendChild(thumb);
    row.appendChild(meta);

    row.addEventListener("click", () => {
      state.title = item.title || "";
      state.description = item.description || "";
      els.titleText.textContent = state.title;
      els.descText.textContent = state.description;
      els.regenTitleBtn.disabled = !state.imageBase64;
      els.regenDescBtn.disabled = !state.imageBase64;
      toast("Chargé depuis l'historique");
    });

    els.historyList.appendChild(row);
  });
}

function setOutput(title, desc) {
  state.title = title || "";
  state.description = desc || "";
  els.titleText.textContent = state.title;
  els.descText.textContent = state.description;
  els.regenTitleBtn.disabled = !state.imageBase64;
  els.regenDescBtn.disabled = !state.imageBase64;
}

function setLoading(isLoading) {
  els.loading.classList.toggle("hidden", !isLoading);
  els.timer.classList.toggle("hidden", !isLoading);
  els.generateBtn.disabled = isLoading;
  els.regenTitleBtn.disabled = isLoading || !state.imageBase64;
  els.regenDescBtn.disabled = isLoading || !state.imageBase64;
}

/* -------------------- Image handling -------------------- */
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function guessMediaType(dataUrl) {
  const m = /^data:(.*?);base64,/.exec(dataUrl || "");
  return m ? m[1] : "image/jpeg";
}

async function setImageFromFile(file) {
  const dataUrl = await fileToDataURL(file);
  state.imageDataUrl = dataUrl;
  state.imageBase64 = String(dataUrl).split(",")[1] || null;
  state.imageMediaType = guessMediaType(dataUrl);

  els.previewImg.src = dataUrl;
  els.preview.classList.remove("hidden");
  els.dropPlaceholder.style.display = "none";
  els.regenTitleBtn.disabled = false;
  els.regenDescBtn.disabled = false;
}

/* Drag & drop */
els.drop.addEventListener("dragover", (e) => { e.preventDefault(); els.drop.classList.add("drag"); });
els.drop.addEventListener("dragleave", () => els.drop.classList.remove("drag"));
els.drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  els.drop.classList.remove("drag");
  const file = e.dataTransfer.files?.[0];
  if (file) await setImageFromFile(file);
});

els.imageInput.addEventListener("change", async () => {
  const file = els.imageInput.files?.[0];
  if (file) await setImageFromFile(file);
});

els.removeImage.addEventListener("click", () => {
  state.imageDataUrl = null;
  state.imageBase64 = null;
  state.imageMediaType = null;
  els.previewImg.src = "";
  els.preview.classList.add("hidden");
  els.dropPlaceholder.style.display = "";
  els.imageInput.value = "";
  toast("Image retirée");
});

/* -------------------- CSV blocklist -------------------- */
function parseCSVText(text) {
  // very simple: split lines; take first column if commas
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];
  for (const l of lines) {
    const first = l.split(",")[0].trim();
    if (first) items.push(first);
  }
  return items;
}

els.csvFile.addEventListener("change", async () => {
  const file = els.csvFile.files?.[0];
  if (!file) return;
  const text = await file.text();
  const items = parseCSVText(text);
  items.forEach(x => state.usedSet.add(x));
  els.csvInfo.textContent = `${items.length} lignes importées.`;
  saveAll();
  toast("CSV importé");
});

els.clearUsed.addEventListener("click", () => {
  state.usedSet = new Set();
  els.csvInfo.textContent = "Aucun CSV importé.";
  saveAll();
  toast("Blocklist vidée");
});

/* -------------------- Collections -------------------- */
els.applyCollection.addEventListener("click", () => {
  const idx = Number(els.collectionSelect.value || 0);
  state.selectedCollection = state.collections[idx] || null;
  toast(state.selectedCollection ? `Collection: ${state.selectedCollection.name}` : "Collection retirée");
});

els.addCollection.addEventListener("click", () => {
  const name = (els.newCollection.value || "").trim();
  const desc = (els.newCollectionDesc.value || "").trim();
  if (!name || !desc) return toast("Nom + description requis");
  state.collections.push({ name, desc });
  els.newCollection.value = "";
  els.newCollectionDesc.value = "";
  renderCollections();
  saveAll();
  toast("Collection ajoutée");
});

els.resetCollections.addEventListener("click", () => {
  state.collections = defaultCollections();
  renderCollections();
  saveAll();
  toast("Collections réinitialisées");
});

els.saveCollections.addEventListener("click", () => {
  // editor format: Name | Desc
  const lines = (els.collectionsEditor.value || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const cols = [];
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length >= 2) {
      cols.push({ name: parts[0].trim(), desc: parts.slice(1).join("|").trim() });
    }
  }
  if (cols.length) state.collections = cols;
  renderCollections();
  saveAll();
  toast("Collections sauvegardées");
});

/* -------------------- Settings -------------------- */
els.settingsBtn.addEventListener("click", () => {
  els.settings.classList.toggle("hidden");
});

els.saveSettings.addEventListener("click", () => {
  persistKey = (els.persistKey.value || "hrdecom_app_v1").trim() || "hrdecom_app_v1";
  localStorage.setItem("hrdecom:persistKey", persistKey);
  state.modelOverride = (els.modelName.value || "").trim();
  saveAll();
  toast("Paramètres sauvegardés");
});

/* -------------------- Export / Import -------------------- */
els.exportTemplate.addEventListener("click", () => {
  const t = state.title || "";
  const d = state.description || "";
  downloadText("template.txt", `TITLE:\n${t}\n\nDESCRIPTION:\n${d}\n`);
});

els.exportBlocklist.addEventListener("click", () => {
  downloadText("blocklist.json", JSON.stringify(Array.from(state.usedSet), null, 2), "application/json");
});

els.exportAll.addEventListener("click", () => {
  const payload = {
    persistKey,
    modelOverride: state.modelOverride || "",
    collections: state.collections,
    history: state.history,
    used: Array.from(state.usedSet)
  };
  downloadText("hrdecom-export.json", JSON.stringify(payload, null, 2), "application/json");
});

els.importAll.addEventListener("click", () => els.importAllFile.click());

els.importAllFile.addEventListener("change", async () => {
  const file = els.importAllFile.files?.[0];
  if (!file) return;
  const text = await file.text();
  const data = safeJSONParse(text, null);
  if (!data) return toast("Fichier invalide");
  if (data.persistKey) persistKey = data.persistKey;
  localStorage.setItem("hrdecom:persistKey", persistKey);
  state.modelOverride = data.modelOverride || "";
  state.collections = Array.isArray(data.collections) ? data.collections : defaultCollections();
  state.history = Array.isArray(data.history) ? data.history : [];
  state.usedSet = new Set(Array.isArray(data.used) ? data.used : []);
  saveAll();
  loadAll();
  renderCollections();
  renderHistory();
  toast("Import OK");
});

/* -------------------- Modal (Traduction/HTML FR) -------------------- */
function openModal(html) {
  els.modalBody.innerHTML = html;
  els.modal.classList.remove("hidden");
}
function closeModal() {
  els.modal.classList.add("hidden");
  els.modalBody.innerHTML = "";
}
els.modalClose.addEventListener("click", closeModal);
els.modal.addEventListener("click", (e) => { if (e.target === els.modal) closeModal(); });

/* -------------------- API Calls -------------------- */
async function callAPI(action) {
  if (!state.imageBase64) throw new Error("Veuillez d'abord importer une image.");

  const started = Date.now();
  setLoading(true);

  const timerTick = setInterval(() => {
    els.timer.textContent = formatTimer(Date.now() - started);
  }, 200);

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        image: state.imageBase64,
        media_type: state.imageMediaType || "image/jpeg",
        collection: state.selectedCollection || null,
        used: Array.from(state.usedSet).slice(0, 500),
        model: state.modelOverride || undefined,
        current: { title: state.title, description: state.description }
      })
    });

    const rawText = await res.text();
    if (!res.ok) throw new Error(rawText);

    return safeJSONParse(rawText, null) || {};
  } finally {
    clearInterval(timerTick);
    setLoading(false);
    els.timer.textContent = "00:00";
  }
}

/* -------------------- Buttons -------------------- */
els.generateBtn.addEventListener("click", async () => {
  try {
    const data = await callAPI("generate");
    if (!data.title || !data.description) throw new Error("Réponse invalide");
    setOutput(data.title, data.description);

    // add to history (thumb = same image)
    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      ts: nowISO(),
      title: data.title,
      description: data.description,
      imageThumb: state.imageDataUrl
    };
    state.history.unshift(item);
    state.history = state.history.slice(0, 50);
    saveAll();
    renderHistory();
    toast("Généré");
  } catch (e) {
    toast("Erreur: " + String(e.message || e));
  }
});

els.regenTitleBtn.addEventListener("click", async () => {
  try {
    const data = await callAPI("regen_title");
    if (!data.title) throw new Error("Réponse invalide");
    setOutput(data.title, state.description);
    toast("Titre régénéré");
  } catch (e) {
    toast("Erreur: " + String(e.message || e));
  }
});

els.regenDescBtn.addEventListener("click", async () => {
  try {
    const data = await callAPI("regen_desc");
    if (!data.description) throw new Error("Réponse invalide");
    setOutput(state.title, data.description);
    toast("Description régénérée");
  } catch (e) {
    toast("Erreur: " + String(e.message || e));
  }
});

els.copyTitle.addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.title || "");
  toast("Titre copié");
});

els.copyDesc.addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.description || "");
  toast("Description copiée");
});

els.infoDesc.addEventListener("click", async () => {
  try {
    const data = await callAPI("translate_fr");
    const html = data?.html || "<p>Réponse vide</p>";
    openModal(html);
  } catch (e) {
    toast("Erreur: " + String(e.message || e));
  }
});

/* -------------------- Init -------------------- */
function init() {
  loadAll();
  renderCollections();
  renderHistory();
  els.regenTitleBtn.disabled = true;
  els.regenDescBtn.disabled = true;
  els.titleText.textContent = "";
  els.descText.textContent = "";
}
init();
