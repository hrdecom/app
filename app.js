(() => {
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    collections: [
      { name: "Initial", meaning: "Jewelry featuring 26 letter variants. Titles must contain 'Initial'." },
      { name: "Projection", meaning: "Jewelry with a pendant holding a customizable image." },
      { name: "Name", meaning: "Personalized jewelry with raised names (laser-cut plate)." },
      { name: "Engraved", meaning: "Jewelry with customizable engraving." },
      { name: "Angel", meaning: "Jewelry with angelic shapes (wings, feathers)." }
    ],
    promptSystem: "You are a senior luxury jewelry copywriter. Analyze the image and return a valid JSON object.",
    promptTitles: "TITLE FORMAT: Ring: Adjustable {Collection} Ring \"{Name}\". Others: {Collection} {Type} \"{Name}\". Symbolic name must be 1-2 words. NO hyphens.",
    promptDesc: "DESCRIPTION: Exactly TWO paragraphs. Each paragraph MUST be 180 characters or LESS. NO ellipses \"...\". Tone: Luxury. Bullet list: Materials: Stainless steel, Hypoallergenic, Water resistant. Ring: Adjustable. Bracelet: 16+5cm. Necklace: 46+5cm."
  };

  let state = {
    imageBase64: null,
    imageMime: "image/jpeg",
    historyCache: [],
    config: { ...DEFAULTS, blacklist: "" },
    currentPage: 1,
    pageSize: 5,
    searchQuery: "",
    currentHistoryId: null,
    timerInterval: null,
    currentGeneratedHeadlines: [],
    selectedHeadlines: []
  };

  /* TIMER */
  function startLoading() {
    let s = 0; $("timer").textContent = "00:00";
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      s++; const mm = String(Math.floor(s/60)).padStart(2,"0"); const ss = String(s%60).padStart(2,"0");
      $("timer").textContent = `${mm}:${ss}`;
    }, 1000);
    $("loading").classList.remove("hidden");
  }
  function stopLoading() { clearInterval(state.timerInterval); state.timerInterval = null; $("loading").classList.add("hidden"); }

  /* CONFIG */
  async function loadConfig() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const saved = data.find(i => i.id === 'full_config');
    if (saved) state.config = JSON.parse(saved.value);
    renderConfigUI();
  }

  function renderConfigUI() {
    $("promptSystem").value = state.config.promptSystem || DEFAULTS.promptSystem;
    $("promptTitles").value = state.config.promptTitles || DEFAULTS.promptTitles;
    $("promptDesc").value = state.config.promptDesc || DEFAULTS.promptDesc;
    $("configBlacklist").value = state.config.blacklist || "";
    $("collectionSelect").innerHTML = state.config.collections.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    $("collectionsList").innerHTML = state.config.collections.map((c, i) => `
      <div style="display:flex; gap:10px; margin-bottom:10px; align-items:center;">
        <input type="text" value="${c.name}" onchange="updateCol(${i}, 'name', this.value)" style="flex:1">
        <textarea onchange="updateCol(${i}, 'meaning', this.value)" style="flex:2; height:40px;">${c.meaning}</textarea>
        <button onclick="removeCol(${i})">×</button>
      </div>
    `).join("");
  }

  window.updateCol = (i, f, v) => state.config.collections[i][f] = v;
  window.removeCol = (i) => { state.config.collections.splice(i, 1); renderConfigUI(); };
  $("addCollection").onclick = () => { state.config.collections.push({name:"", meaning:""}); renderConfigUI(); };

  /* API CALLS */
  async function apiCall(action, extra = {}) {
    if (!state.imageBase64) return;
    startLoading();
    const historyNames = state.historyCache.map(h => h.product_name).filter(Boolean);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          action, image: state.imageBase64, media_type: state.imageMime,
          collection: $("collectionSelect").value, config: state.config,
          historyNames, currentTitle: $("titleText").textContent, ...extra
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur IA");

      if (action === 'generate') {
        $("titleText").textContent = data.title;
        $("descText").textContent = data.description;
        const hRes = await fetch("/api/history", { method: "POST", body: JSON.stringify({ 
          title: data.title, description: data.description, image: state.imageBase64, product_name: data.product_name 
        }) });
        const hData = await hRes.json();
        state.currentHistoryId = hData.id;
        state.selectedHeadlines = []; // Reset pour nouveau produit

        if (data.product_name) {
          let bList = state.config.blacklist.split(",").map(n => n.trim()).filter(n => n);
          if (!bList.includes(data.product_name)) {
            bList.push(data.product_name);
            state.config.blacklist = bList.join(", ");
            $("configBlacklist").value = state.config.blacklist;
            await fetch("/api/settings", { method: "POST", body: JSON.stringify({ id: 'full_config', value: JSON.stringify(state.config) }) });
          }
        }
        await loadHistory();
      } else if (action === 'regen_title' || action === 'regen_desc') {
        if (action === 'regen_title') $("titleText").textContent = data.title;
        else $("descText").textContent = data.description;

        if (state.currentHistoryId) {
          await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ 
            id: state.currentHistoryId, title: $("titleText").textContent, description: $("descText").textContent 
          }) });
          await loadHistory();
        }
      } else if (action === 'headlines') {
        state.currentGeneratedHeadlines = data.headlines || [];
        renderHeadlinesResults();
      }
      $("regenTitleBtn").disabled = false;
      $("regenDescBtn").disabled = false;
    } catch(e) { alert("Erreur: " + e.message); }
    finally { stopLoading(); }
  }

  /* HEADLINES LOGIC */
  function renderHeadlinesResults() {
    const container = $("headlinesResults");
    if (state.currentGeneratedHeadlines.length === 0) {
        container.innerHTML = '<p class="hint">Aucun résultat. Tapez un style et envoyez.</p>';
        return;
    }
    container.innerHTML = state.currentGeneratedHeadlines.map((h, i) => `
        <div class="headline-item" onclick="toggleHeadlineSelection(${i}, this)">
            <input type="checkbox" id="hl-${i}">
            <span class="headline-text">${h}</span>
        </div>
    `).join("");
  }

  window.toggleHeadlineSelection = (index, el) => {
    const cb = el.querySelector('input');
    cb.checked = !cb.checked;
    el.classList.toggle('selected', cb.checked);
  };

  async function saveHeadlines() {
    if (!state.currentHistoryId) return alert("Veuillez d'abord générer un produit.");
    const selected = [];
    const items = document.querySelectorAll('.headline-item');
    items.forEach((item, i) => {
        if (item.querySelector('input').checked) {
            selected.push(state.currentGeneratedHeadlines[i]);
        }
    });

    if (selected.length === 0) return alert("Sélectionnez au moins une headline.");

    state.selectedHeadlines = [...new Set([...state.selectedHeadlines, ...selected])];
    
    await fetch("/api/history", {
        method: "PATCH",
        body: JSON.stringify({ 
            id: state.currentHistoryId, 
            headlines: JSON.stringify(state.selectedHeadlines) 
        })
    });

    renderSavedHeadlines();
    alert("Headlines enregistrées dans l'historique !");
    // Switch to saved tab
    document.querySelector('[data-tab="tab-saved-headlines"]').click();
  }

  function renderSavedHeadlines() {
    const container = $("headlinesSavedList");
    if (!state.selectedHeadlines || state.selectedHeadlines.length === 0) {
        container.innerHTML = '<p class="hint">Aucune headline enregistrée pour ce produit.</p>';
        return;
    }
    container.innerHTML = state.selectedHeadlines.map(h => `
        <div class="headline-item no-hover">
            <span class="headline-text">${h}</span>
            <button class="secondary-btn" onclick="copyText('${h.replace(/'/g, "\\'")}')">📋</button>
        </div>
    `).join("");
  }

  window.copyText = (text) => {
    navigator.clipboard.writeText(text);
    alert("Copié !");
  }

  /* INIT */
  function init() {
    $("loading").classList.add("hidden");
    $("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
    $("closeSettings").onclick = () => $("settingsModal").classList.add("hidden");
    $("openHeadlinesBtn").onclick = () => {
        if(!state.currentHistoryId) return alert("Générez d'abord un produit pour lui associer des headlines.");
        $("headlinesModal").classList.remove("hidden");
        renderSavedHeadlines();
    };
    $("closeHeadlines").onclick = () => $("headlinesModal").classList.add("hidden");

    window.onclick = (e) => { 
        if (e.target == $("settingsModal")) $("settingsModal").classList.add("hidden");
        if (e.target == $("headlinesModal")) $("headlinesModal").classList.add("hidden");
    };

    document.querySelectorAll(".tab-link").forEach(btn => {
      btn.onclick = (e) => {
        const parent = e.target.closest('.modal-content');
        parent.querySelectorAll(".tab-link").forEach(b => b.classList.remove("active"));
        parent.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
        btn.classList.add("active");
        $(btn.dataset.tab).classList.remove("hidden");
      };
    });

    $("sendHeadlineChat").onclick = () => {
        const style = $("headlineStyleInput").value;
        if (!style) return;
        apiCall('headlines', { style });
    };

    $("saveHeadlinesBtn").onclick = saveHeadlines;

    $("drop").onclick = () => $("imageInput").click();
    $("imageInput").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.imageMime = ev.target.result.split(";")[0].split(":")[1] || "image/jpeg";
        state.imageBase64 = ev.target.result.split(",")[1];
        $("previewImg").src = ev.target.result; $("preview").classList.remove("hidden");
        $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false;
        state.currentHistoryId = null; 
        state.selectedHeadlines = [];
        $("titleText").textContent = ""; $("descText").textContent = "";
        renderHistoryUI();
      };
      reader.readAsDataURL(file);
    };

    $("removeImage").onclick = (e) => {
      e.stopPropagation(); state.imageBase64 = null; state.currentHistoryId = null;
      $("preview").classList.add("hidden"); $("dropPlaceholder").style.display = "block";
      $("titleText").textContent = ""; $("descText").textContent = "";
      $("generateBtn").disabled = true; $("regenTitleBtn").disabled = true; $("regenDescBtn").disabled = true;
      renderHistoryUI();
    };

    $("generateBtn").onclick = () => apiCall('generate');
    $("regenTitleBtn").onclick = () => apiCall('regen_title');
    $("regenDescBtn").onclick = () => apiCall('regen_desc');

    $("saveConfig").onclick = async () => {
      state.config.promptSystem = $("promptSystem").value;
      state.config.promptTitles = $("promptTitles").value;
      state.config.promptDesc = $("promptDesc").value;
      state.config.blacklist = $("configBlacklist").value;
      await fetch("/api/settings", { method: "POST", body: JSON.stringify({ id: 'full_config', value: JSON.stringify(state.config) }) });
      alert("Enregistré"); $("settingsModal").classList.add("hidden");
    };

    $("copyTitle").onclick = () => { navigator.clipboard.writeText($("titleText").textContent); alert("Titre copié"); };
    $("copyDesc").onclick = () => { navigator.clipboard.writeText($("descText").textContent); alert("Description copiée"); };
    $("historySearch").oninput = (e) => { state.searchQuery = e.target.value; state.currentPage = 1; renderHistoryUI(); };

    loadConfig(); loadHistory();
  }

  async function loadHistory() {
    const res = await fetch("/api/history");
    state.historyCache = await res.json();
    renderHistoryUI();
  }

  function renderHistoryUI() {
    const filtered = state.historyCache.filter(i => (i.title||"").toLowerCase().includes(state.searchQuery.toLowerCase()));
    const start = (state.currentPage - 1) * state.pageSize;
    const paginated = filtered.slice(start, start + state.pageSize);
    $("historyList").innerHTML = paginated.map(item => `
      <div class="history-item ${state.currentHistoryId == item.id ? 'active-history' : ''}" onclick="restore(${item.id})">
        <img src="data:image/jpeg;base64,${item.image}" class="history-img">
        <div style="flex:1"><h4>${item.title || "Sans titre"}</h4></div>
        <button onclick="event.stopPropagation(); deleteItem(${item.id})">🗑</button>
      </div>
    `).join("");
    renderPagination(Math.ceil(filtered.length / state.pageSize));
  }

  function renderPagination(total) {
    const p = $("pagination"); p.innerHTML = "";
    if (total <= 1) return;
    for(let i=1; i<=total; i++) {
      const b = document.createElement("button");
      b.textContent = i; if(i === state.currentPage) b.className = "active";
      b.onclick = () => { state.currentPage = i; renderHistoryUI(); }; p.appendChild(b);
    }
  }

  window.restore = (id) => {
    const item = state.historyCache.find(i => i.id === id);
    if (!item) return;
    state.currentHistoryId = id;
    state.selectedHeadlines = item.headlines ? JSON.parse(item.headlines) : [];
    $("titleText").textContent = item.title; $("descText").textContent = item.description;
    $("previewImg").src = `data:image/jpeg;base64,${item.image}`;
    state.imageBase64 = item.image; $("preview").classList.remove("hidden");
    $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false;
    $("regenTitleBtn").disabled = false; $("regenDescBtn").disabled = false;
    renderHistoryUI(); window.scrollTo({top:0, behavior:'smooth'});
  };

  window.deleteItem = async (id) => {
    if (!confirm("Supprimer ?")) return;
    await fetch(`/api/history?id=${id}`, { method: "DELETE" });
    if (state.currentHistoryId == id) state.currentHistoryId = null;
    loadHistory();
  };

  init();
})();
