(() => {
  const $ = (id) => document.getElementById(id);

  let state = {
    imageBase64: null,
    historyCache: [],
    config: {
      prompt: "You are a luxury jewelry copywriter...",
      collections: [{name: "Luxe", meaning: "Focus on diamonds"}],
      blacklist: ""
    },
    currentPage: 1,
    pageSize: 5,
    searchQuery: ""
  };

  /* CONFIGURATION */
  async function loadConfig() {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      const saved = data.find(i => i.id === 'main_config');
      if (saved) state.config = JSON.parse(saved.value);
      renderConfigUI();
    } catch(e) { console.error("Erreur config", e); }
  }

  function renderConfigUI() {
    if ($("configPrompt")) $("configPrompt").value = state.config.prompt;
    if ($("configBlacklist")) $("configBlacklist").value = state.config.blacklist;
    
    const select = $("collectionSelect");
    if (select) select.innerHTML = state.config.collections.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    
    const list = $("collectionsList");
    if (list) {
      list.innerHTML = state.config.collections.map((c, i) => `
        <div class="collection-row">
            <input type="text" placeholder="Nom" value="${c.name}" onchange="updateCol(${i}, 'name', this.value)">
            <textarea placeholder="Signification" onchange="updateCol(${i}, 'meaning', this.value)">${c.meaning}</textarea>
            <button onclick="removeCol(${i})">×</button>
        </div>
      `).join("");
    }
  }

  window.updateCol = (i, field, val) => { state.config.collections[i][field] = val; };
  window.removeCol = (i) => { state.config.collections.splice(i, 1); renderConfigUI(); };

  /* IA ACTIONS */
  async function apiCall(action) {
    if (!state.imageBase64) return alert("Image manquante");
    $("loading").classList.remove("hidden");
    
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          action,
          image: state.imageBase64,
          collection: $("collectionSelect").value,
          config: state.config,
          currentTitle: $("titleText").textContent,
          // Envoi de l'historique pour l'anti-doublon
          historyNames: state.historyCache.slice(0, 30).map(h => h.product_name)
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
    } catch(e) { alert("Erreur IA"); }
    finally { $("loading").classList.add("hidden"); }
  }

  /* HISTORIQUE */
  async function loadHistory() {
    try {
      const res = await fetch("/api/history");
      state.historyCache = await res.json();
      renderHistoryUI();
    } catch(e) { console.error(e); }
  }

  function renderHistoryUI() {
    const filtered = state.historyCache.filter(i => (i.title||"").toLowerCase().includes(state.searchQuery.toLowerCase()));
    $("historyTotal").textContent = `Total: ${filtered.length}`;
    
    const start = (state.currentPage - 1) * state.pageSize;
    const paginated = filtered.slice(start, start + state.pageSize);

    $("historyList").innerHTML = paginated.map(item => `
      <div class="history-item" onclick="restoreFromHistory(${item.id})">
        <img src="data:image/jpeg;base64,${item.image}" class="history-img">
        <div class="history-info">
          <h4>${item.title}</h4>
          <div class="history-date">${item.timestamp} [${item.product_name || 'N/A'}]</div>
        </div>
        <button class="delete-hist-btn" onclick="deleteItem(event, ${item.id})">🗑</button>
      </div>
    `).join("");

    renderPagination(Math.ceil(filtered.length / state.pageSize));
  }

  function renderPagination(total) {
    const p = $("pagination"); p.innerHTML = "";
    for(let i=1; i<=total; i++) {
      const b = document.createElement("button");
      b.textContent = i;
      if(i === state.currentPage) b.className = "active";
      b.onclick = () => { state.currentPage = i; renderHistoryUI(); };
      p.appendChild(b);
    }
  }

  window.restoreFromHistory = (id) => {
    const item = state.historyCache.find(i => i.id === id);
    if (!item) return;
    $("titleText").textContent = item.title;
    $("descText").textContent = item.description;
    $("previewImg").src = `data:image/jpeg;base64,${item.image}`;
    state.imageBase64 = item.image;
    $("preview").classList.remove("hidden");
    $("dropPlaceholder").style.display = "none";
    $("regenTitleBtn").disabled = false;
    $("regenDescBtn").disabled = false;
    window.scrollTo({top:0, behavior:'smooth'});
  };

  window.deleteItem = async (e, id) => {
    e.stopPropagation();
    if (!confirm("Supprimer ?")) return;
    await fetch(`/api/history?id=${id}`, { method: "DELETE" });
    loadHistory();
  };

  /* INITIALISATION SÉCURISÉE */
  function init() {
    if ($("settingsBtn")) $("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
    if ($("closeSettings")) $("closeSettings").onclick = () => $("settingsModal").classList.add("hidden");
    
    if ($("addCollection")) $("addCollection").onclick = () => {
      state.config.collections.push({name: "", meaning: ""});
      renderConfigUI();
    };

    if ($("saveConfig")) $("saveConfig").onclick = async () => {
      state.config.prompt = $("configPrompt").value;
      state.config.blacklist = $("configBlacklist").value;
      await fetch("/api/settings", {
        method: "POST",
        body: JSON.stringify({ id: 'main_config', value: JSON.stringify(state.config) })
      });
      alert("Enregistré !");
      $("settingsModal").classList.add("hidden");
    };

    if ($("generateBtn")) $("generateBtn").onclick = () => apiCall('generate');
    if ($("regenTitleBtn")) $("regenTitleBtn").onclick = () => apiCall('regen_title');
    if ($("regenDescBtn")) $("regenDescBtn").onclick = () => apiCall('regen_desc');

    if ($("imageInput")) $("imageInput").onchange = (e) => {
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

    if ($("removeImage")) $("removeImage").onclick = () => {
        state.imageBase64 = null;
        $("preview").classList.add("hidden");
        $("dropPlaceholder").style.display = "flex";
        $("titleText").textContent = "";
        $("descText").textContent = "";
    };

    if ($("historySearch")) $("historySearch").oninput = (e) => {
        state.searchQuery = e.target.value;
        state.currentPage = 1;
        renderHistoryUI();
    };

    // Onglets
    document.querySelectorAll(".tab-link").forEach(t => {
      t.onclick = () => {
        document.querySelectorAll(".tab-link").forEach(l => l.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
        t.classList.add("active");
        $(t.dataset.tab).classList.remove("hidden");
      };
    });

    loadConfig();
    loadHistory();
  }

  // Lancement
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
