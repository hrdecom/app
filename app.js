(() => {
  const $ = (id) => document.getElementById(id);

  /* ===============================
     STATE
  =============================== */
  const state = {
    imageBase64: null,
    imageDataUrl: null,
    imageMime: null,
    title: "",
    description: "",
    persistKey: "hrdecom_app_v1",
    timer: null,
    seconds: 0
  };

  /* ===============================
     ELEMENTS
  =============================== */
  const els = {
    settingsBtn: $("settingsBtn"),
    settings: $("settings"),

    loading: $("loading"),
    timer: $("timer"),

    persistKey: $("persistKey"),
    csvFile: $("csvFile"),
    csvInfo: $("csvInfo"),

    saveSettings: $("saveSettings"),
    clearUsed: $("clearUsed"),
    exportTemplate: $("exportTemplate"),
    exportBlocklist: $("exportBlocklist"),

    drop: $("drop"),
    imageInput: $("imageInput"),
    preview: $("preview"),
    previewImg: $("previewImg"),
    removeImage: $("removeImage"),
    dropPlaceholder: $("dropPlaceholder"),

    collectionSelect: $("collectionSelect"),
    applyCollection: $("applyCollection"),

    generateBtn: $("generateBtn"),
    regenTitleBtn: $("regenTitleBtn"),
    regenDescBtn: $("regenDescBtn"),

    titleText: $("titleText"),
    descText: $("descText"),

    copyTitle: $("copyTitle"),
    copyDesc: $("copyDesc")
  };

  /* ===============================
     HELPERS
  =============================== */

  function getMimeFromDataUrl(dataUrl) {
    return dataUrl.split(";")[0].replace("data:", "");
  }

  function startLoading() {
    state.seconds = 0;
    els.loading.classList.remove("hidden");
    els.timer.textContent = "00:00";
    state.timer = setInterval(() => {
      state.seconds++;
      const m = String(Math.floor(state.seconds / 60)).padStart(2, "0");
      const s = String(state.seconds % 60).padStart(2, "0");
      els.timer.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopLoading() {
    clearInterval(state.timer);
    els.loading.classList.add("hidden");
  }

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
    state.imageBase64 = dataUrl.split(",")[1];
    state.imageMime = getMimeFromDataUrl(dataUrl);

    els.previewImg.src = dataUrl;
    els.preview.classList.remove("hidden");
    els.dropPlaceholder.style.display = "none";

    els.regenTitleBtn.disabled = false;
    els.regenDescBtn.disabled = false;
  }

  async function post(action, extra = {}) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        image: state.imageBase64,
        media_type: state.imageMime,
        ...extra
      })
    });

    const text = await res.text();
    if (!res.ok) throw new Error(text);
    return JSON.parse(text);
  }

  /* ===============================
     EVENTS
  =============================== */

  // Settings
  els.settingsBtn.addEventListener("click", () => {
    els.settings.classList.toggle("hidden");
  });

  // Upload click
  els.drop.addEventListener("click", (e) => {
    if (e.target === els.removeImage) return;
    els.imageInput.click();
  });

  // Upload change
  els.imageInput.addEventListener("change", async () => {
    const file = els.imageInput.files[0];
    if (file) await setImage(file);
  });

  // Drag & drop
  els.drop.addEventListener("dragover", (e) => e.preventDefault());
  els.drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) await setImage(file);
  });

  // Remove image
  els.removeImage.addEventListener("click", () => {
    state.imageBase64 = null;
    state.imageDataUrl = null;
    state.imageMime = null;
    els.preview.classList.add("hidden");
    els.previewImg.src = "";
    els.imageInput.value = "";
    els.dropPlaceholder.style.display = "";
    els.regenTitleBtn.disabled = true;
    els.regenDescBtn.disabled = true;
  });

  /* ===============================
     GENERATION
  =============================== */

  els.generateBtn.addEventListener("click", async () => {
    if (!state.imageBase64) {
      alert("Ajoute une image d’abord.");
      return;
    }

    try {
      startLoading();

      const data = await post("generate");

      state.title = data.title || "";
      state.description = data.description || "";

      els.titleText.textContent = state.title;
      els.descText.textContent = state.description;

      els.regenTitleBtn.disabled = false;
      els.regenDescBtn.disabled = false;
    } catch (e) {
      alert("Erreur génération : " + e.message);
    } finally {
      stopLoading();
    }
  });

  els.regenTitleBtn.addEventListener("click", async () => {
    try {
      startLoading();
      const data = await post("regen_title");
      state.title = data.title || "";
      els.titleText.textContent = state.title;
    } catch (e) {
      alert("Erreur : " + e.message);
    } finally {
      stopLoading();
    }
  });

  els.regenDescBtn.addEventListener("click", async () => {
    try {
      startLoading();
      const data = await post("regen_desc");
      state.description = data.description || "";
      els.descText.textContent = state.description;
    } catch (e) {
      alert("Erreur : " + e.message);
    } finally {
      stopLoading();
    }
  });

  /* ===============================
     COPY
  =============================== */

  els.copyTitle.addEventListener("click", async () => {
    await navigator.clipboard.writeText(state.title);
    alert("Titre copié ✅");
  });

  els.copyDesc.addEventListener("click", async () => {
    await navigator.clipboard.writeText(state.description);
    alert("Description copiée ✅");
  });

  /* ===============================
     INIT
  =============================== */

  els.regenTitleBtn.disabled = true;
  els.regenDescBtn.disabled = true;

  console.log("[app.js] Loaded OK ✅");
})();
