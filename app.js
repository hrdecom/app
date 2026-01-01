(() => {
  const $ = (id) => document.getElementById(id);
  const get = (id) => $(id);

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
    historyList: get("historyList"),
    refreshHistory: get("refreshHistory")
  };

  const state = {
    imageBase64: null,
    imageMime: null,
    last: { title: "", description: "" },
    timerInterval: null
  };

  /* UI HELPERS */
  const show = (el) => el?.classList.remove("hidden");
  const hide = (el) => el?.classList.add("hidden");

  function startLoading() {
    show(els.loading);
    let s = 0;
    els.timer.textContent = "00:00";
    state.timerInterval = setInterval(() => {
      s++;
      els.timer.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    }, 1000);
  }

  function stopLoading() {
    clearInterval(state.timerInterval);
    hide(els.loading);
  }

  function setOutput(title, desc) {
    state.last.title = title || state.last.title;
    state.last.description = desc || state.last.description;
    if(els.titleText) els.titleText.textContent = state.last.title;
    if(els.descText) els.descText.textContent = state.last.description;
    els.regenTitleBtn.disabled = !state.last.title;
    els.regenDescBtn.disabled = !state.last.description;
  }

  /* IMAGE HANDLING */
  async function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const b64 = e.target.result;
      state.imageBase64 = b64.split(",")[1];
      state.imageMime = b64.split(";")[0].split(":")[1];
      els.previewImg.src = b64;
      show(els.preview);
      els.dropPlaceholder.style.display = "none";
      els.generateBtn.disabled = false;
    };
    reader.readAsDataURL(file);
  }

  /* API CALLS */
  async function onGenerate() {
    try {
      startLoading();
      const res = await fetch("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          action: "generate",
          image: state.imageBase64,
          media_type: state.imageMime,
          collection: els.collectionSelect.value
        })
      });
      const data = await res.json();
      setOutput(data.title, data.description);
      
      // SAUVEGARDE AUTO DANS D1
      await fetch("/api/history", {
        method: "POST",
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          image: state.imageBase64
        })
      });
      loadHistory();
    } catch (e) { alert("Erreur: " + e.message); }
    finally { stopLoading(); }
  }

  async function loadHistory() {
    try {
      const res = await fetch("/api/history");
      const items = await res.json();
      if(!items.length) {
        els.historyList.innerHTML = "<p class='hint'>Aucun historique.</p>";
        return;
      }
      els.historyList.innerHTML = items.map(item => `
        <div class="history-item">
          <img src="data:image/jpeg;base64,${item.image}" class="history-img">
          <div class="history-info">
            <h4>${item.title}</h4>
            <p>${item.description}</p>
            <div class="history-date">${item.timestamp}</div>
          </div>
          <div class="history-btns">
            <button onclick="copyRaw(\`${item.title.replace(/`/g,"'")}\`)">Titre</button>
            <button onclick="copyRaw(\`${item.description.replace(/`/g,"'")}\`)">Desc</button>
          </div>
        </div>
      `).join("");
    } catch (e) { els.historyList.innerHTML = "Erreur chargement historique."; }
  }

  window.copyRaw = (txt) => {
    navigator.clipboard.writeText(txt);
    alert("Copié !");
  };

  /* INITIALIZATION */
  function init() {
    els.generateBtn.addEventListener("click", onGenerate);
    els.drop.addEventListener("click", () => els.imageInput.click());
    els.imageInput.addEventListener("change", (e) => e.target.files[0] && handleFile(e.target.files[0]));
    els.copyTitle.addEventListener("click", () => window.copyRaw(state.last.title));
    els.copyDesc.addEventListener("click", () => window.copyRaw(state.last.description));
    els.refreshHistory.addEventListener("click", loadHistory);
    els.settingsBtn.addEventListener("click", () => els.settings.classList.toggle("hidden"));
    
    loadHistory();
  }

  init();
})();
