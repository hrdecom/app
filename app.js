(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    loading: $("loading"),
    timer: $("timer"),
    drop: $("drop"),
    imageInput: $("imageInput"),
    preview: $("preview"),
    previewImg: $("previewImg"),
    removeImage: $("removeImage"),
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
    historySearch: $("historySearch"),
    historyTotal: $("historyTotal"),
    pagination: $("pagination")
  };

  let state = {
    imageBase64: null,
    imageMime: null,
    last: { title: "", description: "" },
    currentHistoryId: null,
    historyCache: [],
    currentPage: 1,
    pageSize: 5,
    searchQuery: "",
    timerInterval: null
  };

  const show = (el) => el?.classList.remove("hidden");
  const hide = (el) => el?.classList.add("hidden");

  function startLoading() {
    show(els.loading);
    let s = 0;
    state.timerInterval = setInterval(() => {
      s++;
      els.timer.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    }, 1000);
  }

  function stopLoading() {
    clearInterval(state.timerInterval);
    hide(els.loading);
  }

  function setMainUI(title, desc, imageB64 = null) {
    state.last.title = title || "";
    state.last.description = desc || "";
    els.titleText.textContent = state.last.title;
    els.descText.textContent = state.last.description;
    
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

  function clearSelection() {
    state.imageBase64 = null;
    state.currentHistoryId = null;
    state.last = { title: "", description: "" };
    els.previewImg.src = "";
    hide(els.preview);
    els.dropPlaceholder.style.display = "flex";
    els.generateBtn.disabled = true;
    setMainUI("", "");
    renderHistoryUI();
  }

  /* API */
  async function onGenerate() {
    if(!state.imageBase64) return;
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
      
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: data.title, description: data.description, image: state.imageBase64 })
      });
      loadHistory();
    } catch (e) { alert(e.message); }
    finally { stopLoading(); }
  }

  async function loadHistory() {
    try {
      const res = await fetch("/api/history");
      state.historyCache = await res.json();
      renderHistoryUI();
    } catch (e) { console.error(e); }
  }

  window.deleteItem = async (e, id) => {
    e.stopPropagation();
    if(!confirm("Supprimer définitivement ce produit de l'historique ?")) return;
    try {
        await fetch(`/api/history?id=${id}`, { method: "DELETE" });
        if(state.currentHistoryId === id) clearSelection();
        loadHistory();
    } catch (e) { alert("Erreur suppression"); }
  };

  /* RENDU HISTORIQUE + FILTRE + PAGINATION */
  function renderHistoryUI() {
    const filtered = state.historyCache.filter(item => 
        (item.title || "").toLowerCase().includes(state.searchQuery.toLowerCase())
    );
    
    els.historyTotal.textContent = `Total: ${filtered.length}`;
    
    const totalPages = Math.ceil(filtered.length / state.pageSize);
    if(state.currentPage > totalPages) state.currentPage = totalPages || 1;

    const start = (state.currentPage - 1) * state.pageSize;
    const paginated = filtered.slice(start, start + state.pageSize);

    els.historyList.innerHTML = paginated.map(item => `
        <div class="history-item ${state.currentHistoryId === item.id ? 'is-current' : ''}" onclick="restoreFromHistory(${item.id})">
          ${state.currentHistoryId === item.id ? '<span class="badge-actuel">ACTUEL</span>' : ''}
          <img src="data:image/jpeg;base64,${item.image}" class="history-img">
          <div class="history-info">
            <h4>${item.title || "Sans titre"}</h4>
            <div class="history-date">${item.timestamp}</div>
          </div>
          <button class="delete-hist-btn" onclick="deleteItem(event, ${item.id})">🗑</button>
        </div>
    `).join("");

    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    els.pagination.innerHTML = "";
    if(totalPages <= 1) return;

    for(let i = 1; i <= totalPages; i++) {
        const btn = document.createElement("button");
        btn.textContent = i;
        if(i === state.currentPage) btn.className = "active";
        btn.onclick = () => { state.currentPage = i; renderHistoryUI(); };
        els.pagination.appendChild(btn);
    }
  }

  window.restoreFromHistory = (id) => {
    const item = state.historyCache.find(i => i.id === id);
    if(!item) return;
    state.currentHistoryId = id;
    setMainUI(item.title, item.description, item.image);
    renderHistoryUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function init() {
    els.generateBtn.addEventListener("click", onGenerate);
    els.removeImage.addEventListener("click", (e) => { e.stopPropagation(); clearSelection(); });
    els.drop.addEventListener("click", () => els.imageInput.click());
    els.imageInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const b64 = ev.target.result;
            state.imageBase64 = b64.split(",")[1];
            setMainUI("", "", state.imageBase64);
            state.currentHistoryId = null;
            renderHistoryUI();
        };
        reader.readAsDataURL(file);
    });

    els.historySearch.addEventListener("input", (e) => {
        state.searchQuery = e.target.value;
        state.currentPage = 1;
        renderHistoryUI();
    });

    els.copyTitle.addEventListener("click", () => {
        navigator.clipboard.writeText(state.last.title);
        alert("Titre copié");
    });
    els.copyDesc.addEventListener("click", () => {
        navigator.clipboard.writeText(state.last.description);
        alert("Description copiée");
    });

    loadHistory();
  }

  init();
})();
