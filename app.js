(() => {
  const $ = (id) => document.getElementById(id);

  // Petit helper pour éviter que tout casse si un élément manque
  function must(id) {
    const el = $(id);
    if (!el) {
      console.warn(`[app.js] Element missing: #${id}`);
    }
    return el;
  }

  const state = {
    imageBase64: null,
    imageDataUrl: null,
    title: "",
    description: "",
    persistKey: "hrdecom_app_v1"
  };

  // Elements (tolérants)
  const els = {
    settingsBtn: must("settingsBtn"),
    settings: must("settings"),

    persistKey: must("persistKey"),
    csvFile: must("csvFile"),
    csvInfo: must("csvInfo"),

    saveSettings: must("saveSettings"),
    clearUsed: must("clearUsed"),
    exportTemplate: must("exportTemplate"),
    exportBlocklist: must("exportBlocklist"),

    collectionsEditor: must("collectionsEditor"),
    newCollection: must("newCollection"),
    newCollectionDesc: must("newCollectionDesc"),
    addCollection: must("addCollection"),
    resetCollections: must("resetCollections"),
    saveCollections: must("saveCollections"),

    drop: must("drop"),
    imageInput: must("imageInput"),
    preview: must("preview"),
    previewImg: must("previewImg"),
    removeImage: must("removeImage"),
    dropPlaceholder: must("dropPlaceholder"),

    historyList: must("historyList"),

    collectionSelect: must("collectionSelect"),
    applyCollection: must("applyCollection"),

    generateBtn: must("generateBtn"),
    regenTitleBtn: must("regenTitleBtn"),
    regenDescBtn: must("regenDescBtn"),

    titleText: must("titleText"),
    descText: must("descText"),

    copyTitle: must("copyTitle"),
    copyDesc: must("copyDesc")
  };

  // Storage helpers
  function k(suffix) {
    return `${state.persistKey}:${suffix}`;
  }
  function loadUsed() {
    try {
      return new Set(JSON.parse(localStorage.getItem(k("used")) || "[]"));
    } catch {
      return new Set();
    }
  }
  function saveUsed(set) {
    localStorage.setItem(k("used"), JSON.stringify([...set]));
  }
  function loadCollections() {
    try {
      const v = JSON.parse(localStorage.getItem(k("collections")) || "null");
      if (Array.isArray(v) && v.length) return v;
    } catch {}
    return [
      { name: "Name", desc: "Personalized / engraved jewelry, emotional, gift-oriented tone." },
      { name: "Minimal", desc: "Minimalist modern jewelry, clean design, understated luxury." },
      { name: "Bold", desc: "Statement jewelry, confident, fashion-forward tone." }
    ];
  }
  function saveCollections(cols) {
    localStorage.setItem(k("collections"), JSON.stringify(cols));
  }
  function loadHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(k("history")) || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  function saveHistory(history) {
    localStorage.setItem(k("history"), JSON.stringify(history.slice(0, 50)));
  }

  let usedSet = new Set();
  let collections = [];
  let history = [];
  let selectedCollection = null;

  function renderCollections() {
    if (!els.collectionSelect) return;
    els.collectionSelect.innerHTML = "";
    collections.forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = c.name || `Collection ${i + 1}`;
      els.collectionSelect.appendChild(opt);
    });
    if (els.collectionsEditor) {
      els.collectionsEditor.value = collections.map(c => `${c.name} | ${c.desc}`).join("\n");
    }
  }

  function renderHistory() {
    if (!els.historyList) return;
    els.historyList.innerHTML = "";
    if (!history.length) {
      els.historyList.textContent = "Aucun élément pour le moment.";
      els.historyList.style.color = "#666";
      els.historyList.style.fontSize = "13px";
      return;
    }
    history.slice(0, 20).forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.display = "block";
      btn.style.width = "100%";
      btn.style.textAlign = "left";
      btn.style.margin = "8px 0";
      btn.style.padding = "10px";
      btn.style.borderRadius = "10px";
      btn.style.border = "1px solid #e5e5e5";
      btn.style.background = "#fff";
      btn.style.cursor = "pointer";
      btn.innerHTML = `<strong>${escapeHTML(item.title || "(Sans titre)")}</strong><div style="opacity:.7;margin-top:4px">${escapeHTML((item.description||"").slice(0,90))}</div>`;
      btn.addEventListener("click", () => {
        state.title = item.title || "";
        state.description = item.description || "";
        if (els.titleText) els.titleText.textContent = state.title;
        if (els.descText) els.descText.textContent = state.description;
      });
      els.historyList.appendChild(btn);
    });
  }

  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  // Image handling
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function setImage(file) {
    const dataUrl = await fileToDataURL(file);
    state.imageDataUrl = dataUrl;
    state.imageBase64 = String(dataUrl).split(",")[1] || null;

    if (els.previewImg) els.previewImg.src = dataUrl;
    if (els.preview) els.preview.classList.remove("hidden");
    if (els.dropPlaceholder) els.dropPlaceholder.style.display = "none";

    if (els.regenTitleBtn) els.regenTitleBtn.disabled = false;
    if (els.regenDescBtn) els.regenDescBtn.disabled = false;
  }

  // Wire UI safely
  function wire() {
    // Settings toggle
    if (els.settingsBtn && els.settings) {
      els.settingsBtn.addEventListener("click", () => {
        els.settings.classList.toggle("hidden");
      });
    }

    // PersistKey + save
    if (els.persistKey) els.persistKey.value = state.persistKey;

    if (els.saveSettings && els.persistKey) {
      els.saveSettings.addEventListener("click", () => {
        state.persistKey = (els.persistKey.value || "hrdecom_app_v1").trim() || "hrdecom_app_v1";
        localStorage.setItem("hrdecom:persistKey", state.persistKey);
        // reload sets based on new key
        usedSet = loadUsed();
        collections = loadCollections();
        history = loadHistory();
        renderCollections();
        renderHistory();
        alert("Paramètres sauvegardés ✅");
      });
    }

    // CSV import
    if (els.csvFile) {
      els.csvFile.addEventListener("change", async () => {
        const file = els.csvFile.files?.[0];
        if (!file) return;
        const text = await file.text();
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        let count = 0;
        for (const line of lines) {
          const first = line.split(",")[0].trim();
          if (first) {
            usedSet.add(first);
            count++;
          }
        }
        saveUsed(usedSet);
        if (els.csvInfo) els.csvInfo.textContent = `${count} lignes importées.`;
        alert("CSV importé ✅");
      });
    }

    if (els.clearUsed) {
      els.clearUsed.addEventListener("click", () => {
        usedSet = new Set();
        saveUsed(usedSet);
        if (els.csvInfo) els.csvInfo.textContent = "Aucun CSV importé.";
        alert("“Déjà utilisé” vidé ✅");
      });
    }

    // Collections edit/save
    if (els.saveCollections && els.collectionsEditor) {
      els.saveCollections.addEventListener("click", () => {
        const lines = (els.collectionsEditor.value || "")
          .split(/\r?\n/).map(l => l.trim()).filter(Boolean);

        const cols = [];
        for (const line of lines) {
          const parts = line.split("|");
          if (parts.length >= 2) {
            cols.push({ name: parts[0].trim(), desc: parts.slice(1).join("|").trim() });
          }
        }
        if (cols.length) collections = cols;
        saveCollections(collections);
        renderCollections();
        alert("Collections sauvegardées ✅");
      });
    }

    if (els.resetCollections) {
      els.resetCollections.addEventListener("click", () => {
        collections = [
          { name: "Name", desc: "Personalized / engraved jewelry, emotional, gift-oriented tone." },
          { name: "Minimal", desc: "Minimalist modern jewelry, clean design, understated luxury." },
          { name: "Bold", desc: "Statement jewelry, confident, fashion-forward tone." }
        ];
        saveCollections(collections);
        renderCollections();
        alert("Collections réinitialisées ✅");
      });
    }

    if (els.addCollection && els.newCollection && els.newCollectionDesc) {
      els.addCollection.addEventListener("click", () => {
        const name = (els.newCollection.value || "").trim();
        const desc = (els.newCollectionDesc.value || "").trim();
        if (!name || !desc) return alert("Nom + description requis");
        collections.push({ name, desc });
        saveCollections(collections);
        els.newCollection.value = "";
        els.newCollectionDesc.value = "";
        renderCollections();
        alert("Collection ajoutée ✅");
      });
    }

    if (els.applyCollection && els.collectionSelect) {
      els.applyCollection.addEventListener("click", () => {
        const idx = Number(els.collectionSelect.value || 0);
        selectedCollection = collections[idx] || null;
        alert(selectedCollection ? `Collection appliquée: ${selectedCollection.name}` : "Collection retirée");
      });
    }

    // Upload click on drop
    if (els.drop && els.imageInput) {
      els.drop.addEventListener("click", (e) => {
        // ne pas ouvrir si clic sur le bouton remove
        if (els.removeImage && (e.target === els.removeImage)) return;
        els.imageInput.click();
      });
    }

    if (els.imageInput) {
      els.imageInput.addEventListener("change", async () => {
        const file = els.imageInput.files?.[0];
        if (file) await setImage(file);
      });
    }

    // Drag & drop
    if (els.drop) {
      els.drop.addEventListener("dragover", (e) => e.preventDefault());
      els.drop.addEventListener("drop", async (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) await setImage(file);
      });
    }

    if (els.removeImage) {
      els.removeImage.addEventListener("click", () => {
        state.imageBase64 = null;
        state.imageDataUrl = null;
        if (els.preview) els.preview.classList.add("hidden");
        if (els.previewImg) els.previewImg.src = "";
        if (els.dropPlaceholder) els.dropPlaceholder.style.display = "";
        if (els.imageInput) els.imageInput.value = "";
        if (els.regenTitleBtn) els.regenTitleBtn.disabled = true;
        if (els.regenDescBtn) els.regenDescBtn.disabled = true;
      });
    }

    // Export
    if (els.exportTemplate) {
      els.exportTemplate.addEventListener("click", () => {
        const content = `TITLE:\n${state.title}\n\nDESCRIPTION:\n${state.description}\n`;
        download("template.txt", content, "text/plain");
      });
    }

    if (els.exportBlocklist) {
      els.exportBlocklist.addEventListener("click", () => {
        download("blocklist.json", JSON.stringify([...usedSet], null, 2), "application/json");
      });
    }

    // Copy
    if (els.copyTitle) {
      els.copyTitle.addEventListener("click", async () => {
        await navigator.clipboard.writeText(state.title || "");
        alert("Titre copié ✅");
      });
    }
    if (els.copyDesc) {
      els.copyDesc.addEventListener("click", async () => {
        await navigator.clipboard.writeText(state.description || "");
        alert("Description copiée ✅");
      });
    }

    // Generate
    if (els.generateBtn) {
      els.generateBtn.addEventListener("click", async () => {
        try {
          if (!state.imageBase64) return alert("Ajoute une image d'abord.");

          const data = await post("/api/generate", {
            action: "generate",
            image: state.imageBase64,
            collection: selectedCollection,
            used: [...usedSet].slice(0, 200)
          });

          state.title = data.title || "";
          state.description = data.description || "";

          if (els.titleText) els.titleText.textContent = state.title;
          if (els.descText) els.descText.textContent = state.description;

          if (els.regenTitleBtn) els.regenTitleBtn.disabled = false;
          if (els.regenDescBtn) els.regenDescBtn.disabled = false;

          // history
          const item = {
            ts: new Date().toISOString(),
            title: state.title,
            description: state.description
          };
          history.unshift(item);
          saveHistory(history);
          renderHistory();
        } catch (e) {
          console.error(e);
          alert("Erreur génération: " + String(e.message || e));
        }
      });
    }

    if (els.regenTitleBtn) {
      els.regenTitleBtn.addEventListener("click", async () => {
        try {
          if (!state.imageBase64) return alert("Ajoute une image d'abord.");
          const data = await post("/api/generate", {
            action: "regen_title",
            image: state.imageBase64,
            collection: selectedCollection,
            used: [...usedSet].slice(0, 200)
          });
          state.title = data.title || "";
          if (els.titleText) els.titleText.textContent = state.title;
        } catch (e) {
          console.error(e);
          alert("Erreur: " + String(e.message || e));
        }
      });
    }

    if (els.regenDescBtn) {
      els.regenDescBtn.addEventListener("click", async () => {
        try {
          if (!state.imageBase64) return alert("Ajoute une image d'abord.");
          const data = await post("/api/generate", {
            action: "regen_desc",
            image: state.imageBase64,
            collection: selectedCollection,
            used: [...usedSet].slice(0, 200)
          });
          state.description = data.description || "";
          if (els.descText) els.descText.textContent = state.description;
        } catch (e) {
          console.error(e);
          alert("Erreur: " + String(e.message || e));
        }
      });
    }
  }

  async function post(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text);
    try { return JSON.parse(text); } catch { return {}; }
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Init
  function init() {
    const savedKey = localStorage.getItem("hrdecom:persistKey");
    if (savedKey) state.persistKey = savedKey;

    usedSet = loadUsed();
    collections = loadCollections();
    history = loadHistory();

    renderCollections();
    renderHistory();

    if (els.regenTitleBtn) els.regenTitleBtn.disabled = true;
    if (els.regenDescBtn) els.regenDescBtn.disabled = true;

    wire();
    console.log("[app.js] Loaded OK ✅");
  }

  // Assure que tout le DOM est prêt
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
