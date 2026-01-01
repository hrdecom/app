/* app.js — WEB FINAL (no Chrome APIs)
   - Safe bindings (never crashes if an element is missing)
   - Upload click + drag/drop
   - Real loader + timer
   - Calls /api/generate with action: generate | regen_title | regen_desc | translate_fr
   - Sends real media_type for webp/png/jpeg
*/

(() => {
  const $ = (id) => document.getElementById(id);

  // Safe getter (no crash)
  function get(id) {
    const el = $(id);
    if (!el) console.warn(`[app.js] Missing element #${id}`);
    return el;
  }

  const els = {
    settingsBtn: get("settingsBtn"),
    settings: get("settings"),

    loading: get("loading"),
    timer: get("timer"),

    drop: get("drop"),
    imageInput: get("imageInput"),
    preview: get("preview"),
    previewImg: get("previewImg"),
    removeImage: get("removeImage"),
    dropPlaceholder: get("dropPlaceholder"),

    generateBtn: get("generateBtn"),
    regenTitleBtn: get("regenTitleBtn"),
    regenDescBtn: get("regenDescBtn"),

    titleText: get("titleText"),
    descText: get("descText"),

    copyTitle: get("copyTitle"),
    copyDesc: get("copyDesc"),

    collectionSelect: get("collectionSelect"),
    applyCollection: get("applyCollection")
  };

  const state = {
    imageDataUrl: null,
    imageBase64: null,
    imageMime: null,

    last: {
      title: "",
      description: "",
      html_fr: ""
    },

    timerStart: 0,
    timerInterval: null
  };

  /* =========================
     UI helpers
  ========================= */
  function show(el) { if (el) el.classList.remove("hidden"); }
  function hide(el) { if (el) el.classList.add("hidden"); }

  function setButtonsEnabled(isEnabled) {
    if (els.generateBtn) els.generateBtn.disabled = !isEnabled;
    if (els.regenTitleBtn) els.regenTitleBtn.disabled = !isEnabled || !state.last.title;
    if (els.regenDescBtn) els.regenDescBtn.disabled = !isEnabled || !state.last.description;
  }

  function startLoading() {
    if (!els.loading || !els.timer) return; // even if missing, don't crash
    show(els.loading);
    state.timerStart = Date.now();

    // reset
    els.timer.textContent = "00:00";
    if (state.timerInterval) clearInterval(state.timerInterval);

    state.timerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - state.timerStart) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      els.timer.textContent = `${mm}:${ss}`;
    }, 200);

    // disable actions while loading
    if (els.generateBtn) els.generateBtn.disabled = true;
    if (els.regenTitleBtn) els.regenTitleBtn.disabled = true;
    if (els.regenDescBtn) els.regenDescBtn.disabled = true;
  }

  function stopLoading() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = null;
    hide(els.loading);
    // re-enable
    if (els.generateBtn) els.generateBtn.disabled = !state.imageBase64;
    if (els.regenTitleBtn) els.regenTitleBtn.disabled = !state.imageBase64 || !state.last.title;
    if (els.regenDescBtn) els.regenDescBtn.disabled = !state.imageBase64 || !state.last.description;
  }

  function setOutput({ title, description, html }) {
    if (typeof title === "string") state.last.title = title;
    if (typeof description === "string") state.last.description = description;
    if (typeof html === "string") state.last.html_fr = html;

    if (els.titleText) els.titleText.textContent = state.last.title || "";
    if (els.descText) els.descText.textContent = state.last.description || "";
    if (els.regenTitleBtn) els.regenTitleBtn.disabled = !state.imageBase64 || !state.last.title;
    if (els.regenDescBtn) els.regenDescBtn.disabled = !state.imageBase64 || !state.last.description;
  }

  /* =========================
     Image helpers
  ========================= */
  function dataUrlMime(dataUrl) {
    try {
      const head = String(dataUrl).split(";")[0]; // "data:image/webp"
      return head.replace("data:", "");
    } catch {
      return "image/jpeg";
    }
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function setImageFromFile(file) {
    const dataUrl = await fileToDataURL(file);
    state.imageDataUrl = dataUrl;
    state.imageMime = dataUrlMime(dataUrl);
    state.imageBase64 = String(dataUrl).split(",")[1] || null;

    // UI
    if (els.previewImg) els.previewImg.src = dataUrl;
    show(els.preview);
    if (els.dropPlaceholder) els.dropPlaceholder.style.display = "none";

    // clear outputs for new image
    setOutput({ title: "", description: "", html: "" });

    // enable generate
    if (els.generateBtn) els.generateBtn.disabled = false;
  }

  function clearImage() {
    state.imageDataUrl = null;
    state.imageBase64 = null;
    state.imageMime = null;

    if (els.previewImg) els.previewImg.src = "";
    hide(els.preview);
    if (els.dropPlaceholder) els.dropPlaceholder.style.display = "";

    if (els.imageInput) els.imageInput.value = "";
    setOutput({ title: "", description: "", html: "" });

    if (els.generateBtn) els.generateBtn.disabled = true;
    if (els.regenTitleBtn) els.regenTitleBtn.disabled = true;
    if (els.regenDescBtn) els.regenDescBtn.disabled = true;
  }

  /* =========================
     API
  ========================= */
  async function apiCall(action, extra = {}) {
    if (!state.imageBase64) throw new Error("Image manquante.");

    const payload = {
      action,
      image: state.imageBase64,
      media_type: state.imageMime || "image/jpeg",
      // For the backend prompt: you can pass selected collection suggestion
      collection: (els.collectionSelect && els.collectionSelect.value) ? els.collectionSelect.value : null,
      ...extra
    };

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    if (!res.ok) {
      // keep raw for easier debugging
      throw new Error(text);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Réponse serveur non-JSON: " + text);
    }
  }

  /* =========================
     Actions
  ========================= */
  async function onGenerate() {
    if (!state.imageBase64) return alert("Ajoute une image d’abord.");
    try {
      startLoading();
      const data = await apiCall("generate");
      setOutput({ title: data.title || "", description: data.description || "" });
    } catch (e) {
      console.error(e);
      alert("Erreur génération:\n" + String(e.message || e));
    } finally {
      stopLoading();
    }
  }

  async function onRegenTitle() {
    if (!state.imageBase64) return alert("Ajoute une image d’abord.");
    try {
      startLoading();
      const data = await apiCall("regen_title");
      // some backends return {name, title}, we only display title
      setOutput({ title: data.title || state.last.title });
    } catch (e) {
      console.error(e);
      alert("Erreur régénération titre:\n" + String(e.message || e));
    } finally {
      stopLoading();
    }
  }

  async function onRegenDesc() {
    if (!state.imageBase64) return alert("Ajoute une image d’abord.");
    try {
      startLoading();
      const data = await apiCall("regen_desc");
      setOutput({ description: data.description || state.last.description });
    } catch (e) {
      console.error(e);
      alert("Erreur régénération description:\n" + String(e.message || e));
    } finally {
      stopLoading();
    }
  }

  async function onCopyTitle() {
    const t = (state.last.title || "").trim();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    alert("Titre copié ✅");
  }

  async function onCopyDesc() {
    const d = (state.last.description || "").trim();
    if (!d) return;
    try {
      await navigator.clipboard.writeText(d);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = d;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    alert("Description copiée ✅");
  }

  /* =========================
     Bindings (SAFE)
  ========================= */
  function bind() {
    // Settings toggle
    if (els.settingsBtn && els.settings) {
      els.settingsBtn.addEventListener("click", () => {
        els.settings.classList.toggle("hidden");
      });
    }

    // Upload click
    if (els.drop && els.imageInput) {
      els.drop.addEventListener("click", () => els.imageInput.click());
    }

    // Drag and drop
    if (els.drop) {
      els.drop.addEventListener("dragover", (e) => e.preventDefault());
      els.drop.addEventListener("drop", async (e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files?.[0];
        if (file) await setImageFromFile(file);
      });
    }

    // File input
    if (els.imageInput) {
      els.imageInput.addEventListener("change", async () => {
        const file = els.imageInput.files?.[0];
        if (file) await setImageFromFile(file);
      });
    }

    // Remove
    if (els.removeImage) {
      els.removeImage.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearImage();
      });
    }

    // Buttons
    if (els.generateBtn) els.generateBtn.addEventListener("click", onGenerate);
    if (els.regenTitleBtn) els.regenTitleBtn.addEventListener("click", onRegenTitle);
    if (els.regenDescBtn) els.regenDescBtn.addEventListener("click", onRegenDesc);

    // Copy
    if (els.copyTitle) els.copyTitle.addEventListener("click", onCopyTitle);
    if (els.copyDesc) els.copyDesc.addEventListener("click", onCopyDesc);

    // Apply collection (optional – just feedback; backend reads the select anyway)
    if (els.applyCollection && els.collectionSelect) {
      els.applyCollection.addEventListener("click", () => {
        alert("Collection appliquée: " + els.collectionSelect.value);
      });
    }
  }

  /* =========================
     INIT
  ========================= */
  function init() {
    // default disabled until image
    if (els.generateBtn) els.generateBtn.disabled = true;
    if (els.regenTitleBtn) els.regenTitleBtn.disabled = true;
    if (els.regenDescBtn) els.regenDescBtn.disabled = true;

    bind();
    console.log("[app.js] WEB FINAL loaded ✅");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
