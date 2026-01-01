(() => {
  const $ = (id) => document.getElementById(id);

  // DONNÉES PAR DÉFAUT (Issues de ton popup.js)
  const DEFAULT_COLLECTIONS = [
    { name: "Initial", meaning: "Jewelry featuring 26 letter variants. Titles must contain 'Initial'." },
    { name: "Projection", meaning: "Jewelry with a pendant that holds a customizable image." },
    { name: "Name", meaning: "Personalized jewelry with raised names (laser-cut plate)." },
    { name: "Engraved", meaning: "Jewelry with customizable engraving on the surface." },
    { name: "Angel", meaning: "Jewelry with angelic shapes (wings, feathers)." }
  ];

  const DEFAULT_PROMPTS = {
    system: "You are a senior luxury jewelry copywriter. Analyze the image and return JSON.",
    titles: "TITLE FORMAT: Ring: Adjustable {Collection} Ring \"{Name}\". Others: {Collection} {Type} \"{Name}\". NO hyphens.",
    desc: "DESCRIPTION: Exactly TWO paragraphs, each max 180 chars. NO ellipses. Then mandatory bullets: Materials: Stainless steel, Hypoallergenic, Water resistant."
  };

  let state = {
    imageBase64: null,
    historyCache: [],
    config: {
      promptSystem: DEFAULT_PROMPTS.system,
      promptTitles: DEFAULT_PROMPTS.titles,
      promptDesc: DEFAULT_PROMPTS.desc,
      collections: DEFAULT_COLLECTIONS,
      blacklist: ""
    },
    currentPage: 1,
    pageSize: 5,
    searchQuery: "",
    currentHistoryId: null
  };

  /* --- INITIALISATION --- */
  async function loadConfig() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const saved = data.find(i => i.id === 'full_config');
    if (saved) state.config = JSON.parse(saved.value);
    renderConfigUI();
  }

  function renderConfigUI() {
    $("promptSystem").value = state.config.promptSystem;
    $("promptTitles").value = state.config.promptTitles;
    $("promptDesc").value = state.config.promptDesc;
    $("configBlacklist").value = state.config.blacklist;
    
    $("collectionSelect").innerHTML = state.config.collections.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    $("collectionsList").innerHTML = state.config.collections.map((c, i) => `
      <div class="collection-row" style="display:flex; gap:5px; margin-bottom:10px;">
        <input type="text" value="${c.name}" onchange="updateCol(${i}, 'name', this.value)" style="flex:1">
        <textarea onchange="updateCol(${i}, 'meaning', this.value)" style="flex:2; height:40px;">${c.meaning}</textarea>
        <button onclick="removeCol(${i})">×</button>
      </div>
    `).join("");
  }

  window.updateCol = (i, field, val) => { state.config.collections[i][field] = val; };
  window.removeCol = (i) => { state.config.collections.splice(i, 1); renderConfigUI(); };
  $("addCollection").onclick = () => { state.config.collections.push({name: "", meaning: ""}); renderConfigUI(); };

  /* --- GESTION CSV (Logique popup.js) --- */
  $("csvImport").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const rows = text.split(/\r?\n/);
    let names = [];
    rows.forEach(row => {
        // On extrait les valeurs entre guillemets ou par virgule
        const match = row.match(/"([^"]+)"/) || row.split(",");
        const name = match[1] || match[0];
        if (name && name.trim().length > 2) names.push(name.trim());
    });
    const uniqueNames = [...new Set([...state.config.blacklist.split(","), ...names])].filter(n => n.length > 0);
    state.config.blacklist = uniqueNames.join(", ");
    $("configBlacklist").value = state.config.blacklist;
    $("csvStatus").textContent = `${names.length} noms extraits du CSV.`;
  };

  /* --- ACTIONS IA --- */
  async function apiCall(action) {
    if (!state.imageBase64) return alert("Image manquante");
    $("loading").classList.remove("hidden");
    
    // Auto-update blacklist from history names
    const historyNames = state.historyCache.slice(0, 50).map(h => h.product_name).filter(Boolean);
    
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          action,
          image: state.imageBase64,
          collection: $("collectionSelect").value,
          config: state.config,
          historyNames: historyNames,
          currentTitle: $("titleText").textContent
        })
      });
      const data = await res.json();
      
      if (action === 'generate') {
        $("titleText").textContent = data.title;
        $("descText").textContent = data.description;
        await fetch("/api/history", {
          method: "POST",
          body: JSON.stringify({ title: data.title, description: data.description, image: state.imageBase64, product_name: data.product_name })
        });
        loadHistory();
      } else if (action === 'regen_title') {
        $("titleText").textContent = data.title;
      } else if (action === 'regen_desc') {
        $("descText").textContent = data.description;
      }
      
      $("regenTitleBtn").disabled = false;
      $("regenDescBtn").disabled = false;
    } catch(e) { alert("Erreur lors de la génération."); }
    finally { $("loading").classList.add("hidden"); }
  }

  /* --- UI & MODAL --- */
  function init() {
    // Modal toggle
    $("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
    $("closeSettings").onclick = () => $("settingsModal").classList.add("hidden");
    window.onclick = (e) => { if(e.target == $("settingsModal")) $("settingsModal").classList.add("hidden"); };

    // Tabs
    document.querySelectorAll(".tab-link").forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll(".tab-link").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
        btn.classList.add("active");
        $(btn.dataset.tab).classList.remove("hidden");
      };
    });

    $("saveConfig").onclick = async () => {
      state.config.promptSystem = $("promptSystem").value;
      state.config.promptTitles = $("promptTitles").value;
      state.config.promptDesc = $("promptDesc").value;
      state.config.blacklist = $("configBlacklist").value;
      await fetch("/api/settings", {
        method: "POST",
        body: JSON.stringify({ id: 'full_config', value: JSON.stringify(state.config) })
      });
      alert("Paramètres sauvegardés !");
      $("settingsModal").classList.add("hidden");
    };

    $("generateBtn").onclick = () => apiCall('generate');
    $("regenTitleBtn").onclick = () => apiCall('regen_title');
    $("regenDescBtn").onclick = () => apiCall('regen_desc');

    $("imageInput").onchange = (e) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            state.imageBase64 = ev.target.result.split(",")[1];
            $("previewImg").src = ev.target.result;
            $("preview").classList.remove("hidden");
            $("dropPlaceholder").style.display = "none";
            $("generateBtn").disabled = false;
        };
        reader.readAsDataURL(e.target.files[0]);
    };

    $("removeImage").onclick = () => {
        state.imageBase64 = null;
        $("preview").classList.add("hidden");
        $("dropPlaceholder").style.display = "flex";
        $("titleText").textContent = "";
        $("descText").textContent = "";
        state.currentHistoryId = null;
        renderHistoryUI();
    };

    $("copyTitle").onclick = () => { navigator.clipboard.writeText($("titleText").textContent); alert("Titre copié"); };
    $("copyDesc").onclick = () => { navigator.clipboard.writeText($("descText").textContent); alert("Description copiée"); };

    loadConfig();
    loadHistory();
  }

  /* --- FONCTIONS HISTORIQUE (PAGINATION) --- */
  async function loadHistory() {
    const res = await fetch("/api/history");
    state.historyCache = await res.json();
    renderHistoryUI();
  }

  function renderHistoryUI() {
    const filtered = state.historyCache.filter(i => (i.title||"").toLowerCase().includes(state.searchQuery.toLowerCase()));
    $("historyTotal").textContent = `Total: ${filtered.length}`;
    const start = (state.currentPage - 1) * state.pageSize;
    const paginated = filtered.slice(start, start + state.pageSize);

    $("historyList").innerHTML = paginated.map(item => `
      <div class="history-item ${state.currentHistoryId === item.id ? 'is-current' : ''}" onclick="restoreItem(${item.id})">
        <img src="data:image/jpeg;base64,${item.image}" class="history-img">
        <div class="history-info">
          <h4>${item.title}</h4>
          <div class="history-date">${item.timestamp}</div>
        </div>
        <button class="delete-hist-btn" onclick="deleteItem(event, ${item.id})">🗑</button>
      </div>
    `).join("");
    renderPagination(Math.ceil(filtered.length / state.pageSize));
  }

  window.restoreItem = (id) => {
    const item = state.historyCache.find(i => i.id === id);
    if (!item) return;
    state.currentHistoryId = id;
    $("titleText").textContent = item.title;
    $("descText").textContent = item.description;
    $("previewImg").src = `data:image/jpeg;base64,${item.image}`;
    state.imageBase64 = item.image;
    $("preview").classList.remove("hidden");
    $("dropPlaceholder").style.display = "none";
    renderHistoryUI();
    window.scrollTo({top: 0, behavior: 'smooth'});
  };

  window.deleteItem = async (e, id) => {
    e.stopPropagation();
    if(!confirm("Supprimer ?")) return;
    await fetch(`/api/history?id=${id}`, { method: "DELETE" });
    loadHistory();
  };

  function renderPagination(total) {
    const p = $("pagination"); p.innerHTML = "";
    for(let i=1; i<=total; i++){
      const b = document.createElement("button");
      b.textContent = i;
      if(i === state.currentPage) b.className = "active";
      b.onclick = () => { state.currentPage = i; renderHistoryUI(); };
      p.appendChild(b);
    }
  }

  init();
})();
