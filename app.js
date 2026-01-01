(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    loading: $("loading"),
    timer: $("timer"),
    drop: $("drop"),
    imageInput: $("imageInput"),
    preview: $("preview"),
    previewImg: $("previewImg"),
    dropPlaceholder: $("dropPlaceholder"),
    generateBtn: $("generateBtn"),
    regenTitleBtn: $("regenTitleBtn"),
    regenDescBtn: $("regenDescBtn"),
    titleText: $("titleText"),
    descText: $("descText"),
    copyTitle: $("copyTitle"),
    copyDesc: $("copyDesc"),
    collectionSelect: $("collectionSelect"),
    historyList: $("historyList"),
    refreshHistory: $("refreshHistory")
  };

  let state = {
    imageBase64: null,
    imageMime: null,
    last: { title: "", description: "" },
    currentHistoryId: null, // Pour le badge "Actuel"
    historyCache: [], // Pour restaurer sans re-fetch
    timerInterval: null
  };

  /* UI HELPERS */
  const show = (el) => el?.classList.remove("hidden");
  const hide = (el) => el?.classList.add("hidden");

  function startLoading() {
    show(els.loading);
    let s = 0; els.timer.textContent = "00:00";
    state.timerInterval = setInterval(() => {
      s++;
      els.timer.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    }, 1000);
  }

  function stopLoading() {
    clearInterval(state.timerInterval);
    hide(els.loading);
  }

  // Met à jour les blocs Titre / Description et l'image principale
  function setMainUI(title, desc, imageB64 = null) {
    state.last.title = title || "";
    state.last.description = desc || "";
    
    if(els.titleText) els.titleText.textContent = state.last.title;
    if(els.descText) els.descText.textContent = state.last.description;
    
    if(imageB64) {
        state.imageBase64 = imageB64;
        els.previewImg.src = `data:image/jpeg;base64,${imageB64}`;
        show(els.preview);
        els.dropPlaceholder.style.display = "none";
        els.generateBtn.disabled = false;
    }

    els.regenTitleBtn.disabled = !state.last.title;
    els.regenDescBtn.disabled = !state.last.description;
  }

  /* API CALLS */
  async function onGenerate() {
    if(!state.imageBase64) return alert("Image manquante");
    try {
      startLoading();
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          image: state.imageBase64,
          media_type: state.imageMime || "image/jpeg",
          collection: els.collectionSelect.value
        })
      });
      const data = await res.json();
      setMainUI(data.title, data.description);
      
      // Sauvegarde DB
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          image: state.imageBase64
        })
      });
      
      state.currentHistoryId = null; // C'est une nouvelle génération
      loadHistory();
    } catch (e) { alert("Erreur: " + e.message); }
    finally { stopLoading(); }
  }

  async function loadHistory() {
    try {
      const res = await fetch("/api/history");
      const items = await res.json();
      state.historyCache = items;
      renderHistoryUI(items);
    } catch (e) { els.historyList.innerHTML = "Erreur chargement historique."; }
  }

  function renderHistoryUI(items) {
    if(!items.length) {
        els.historyList.innerHTML = "<p class='hint'>Aucun historique.</p>";
        return;
    }

    els.historyList.innerHTML = items.map(item => {
        const isCurrent = state.currentHistoryId === item.id;
        return `
        <div class="history-item ${isCurrent ? 'is-current' : ''}" onclick="restoreFromHistory(${item.id})">
          ${isCurrent ? '<span class="badge-actuel">ACTUEL</span>' : ''}
          <img src="data:image/jpeg;base64,${item.image}" class="history-img">
          <div class="history-info">
            <h4>${item.title || "Sans titre"}</h4>
            <p>${item.description || "Sans description"}</p>
            <div class="history-date">${item.timestamp}</div>
          </div>
          <div class="history-btns">
            <button onclick="event.stopPropagation(); copyText(this, \`${(item.title || "").replace(/`/g, "'")}\`)">Titre</button>
            <button onclick="event.stopPropagation(); copyText(this, \`${(item.description || "").replace(/`/g, "'")}\`)">Desc</button>
          </div>
        </div>
      `}).join("");
  }

  /* FONCTIONS GLOBALES (Accessibles via onclick) */

  // Restaure un produit de l'historique vers le bloc principal
  window.restoreFromHistory = (id) => {
    const item = state.historyCache.find(i => i.id === id);
    if(!item) return;

    state.currentHistoryId = id;
    setMainUI(item.title, item.description, item.image);
    renderHistoryUI(state.historyCache); // Refresh pour le badge
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Système de copie robuste
  window.copyText = (btn, txt) => {
    if(!txt) return;
    navigator.clipboard.writeText(txt).then(() => {
        const oldText = btn.textContent;
        btn.textContent = "Copié !";
        btn.style.background = "#e6ffed";
        setTimeout(() => {
            btn.textContent = oldText;
            btn.style.background = "";
        }, 1500);
    });
  };

  /* INITIALIZATION */
  function init() {
    els.generateBtn.addEventListener("click", onGenerate);
    
    els.drop.addEventListener("click", () => els.imageInput.click());
    
    els.imageInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const b64 = ev.target.result;
            state.imageBase64 = b64.split(",")[1];
            state.imageMime = b64.split(";")[0].split(":")[1];
            setMainUI("", "", state.imageBase64);
            state.currentHistoryId = null;
            renderHistoryUI(state.historyCache);
        };
        reader.readAsDataURL(file);
    });

    els.copyTitle.addEventListener("click", () => window.copyText(els.copyTitle, state.last.title));
    els.copyDesc.addEventListener("click", () => window.copyText(els.copyDesc, state.last.description));
    els.refreshHistory.addEventListener("click", loadHistory);
    
    loadHistory();
  }

  init();
})();
