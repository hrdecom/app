(() => {
  const $ = (id) => document.getElementById(id);
  
  let state = {
    imageBase64: null,
    historyCache: [],
    config: {
      prompt: "You are a luxury jewelry copywriter...",
      collections: [{name: "Luxe", meaning: "Focus on gold and diamonds"}],
      blacklist: ""
    },
    currentPage: 1,
    pageSize: 5
  };

  /* GESTION CONFIGURATION */
  async function loadConfig() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    data.forEach(item => {
        if(item.id === 'main_config') state.config = JSON.parse(item.value);
    });
    renderConfigUI();
  }

  function renderConfigUI() {
    $("configPrompt").value = state.config.prompt;
    $("configBlacklist").value = state.config.blacklist;
    
    // Menu déroulant collection
    const select = $("collectionSelect");
    select.innerHTML = state.config.collections.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    
    // Liste éditable dans les paramètres
    $("collectionsList").innerHTML = state.config.collections.map((c, i) => `
        <div class="collection-row">
            <input type="text" value="${c.name}" onchange="updateCol(${i}, 'name', this.value)">
            <textarea onchange="updateCol(${i}, 'meaning', this.value)">${c.meaning}</textarea>
            <button onclick="removeCol(${i})">×</button>
        </div>
    `).join("");
  }

  window.updateCol = (i, field, val) => state.config.collections[i][field] = val;
  window.removeCol = (i) => { state.config.collections.splice(i,1); renderConfigUI(); };
  $("addCollection").onclick = () => { state.config.collections.push({name:"", meaning:""}); renderConfigUI(); };

  $("saveConfig").onclick = async () => {
    state.config.prompt = $("configPrompt").value;
    state.config.blacklist = $("configBlacklist").value;
    await fetch("/api/settings", {
        method: "POST",
        body: JSON.stringify({ id: 'main_config', value: JSON.stringify(state.config) })
    });
    alert("Configuration enregistrée !");
    $("settingsModal").classList.add("hidden");
  };

  /* ACTIONS IA */
  async function apiCall(action) {
    if(!state.imageBase64) return;
    show($("loading"));
    try {
        const res = await fetch("/api/generate", {
            method: "POST",
            body: JSON.stringify({
                action,
                image: state.imageBase64,
                collection: $("collectionSelect").value,
                config: state.config,
                currentTitle: $("titleText").textContent,
                historyNames: state.historyCache.slice(0,20).map(h => ({n: h.product_name, t: h.title}))
            })
        });
        const data = await res.json();
        if(action === 'generate') {
            $("titleText").textContent = data.title;
            $("descText").textContent = data.description;
            // Sauvegarde auto
            await fetch("/api/history", {
                method: "POST",
                body: JSON.stringify({ title: data.title, description: data.description, image: state.imageBase64, product_name: data.product_name })
            });
            loadHistory();
        } else if(action === 'regen_title') {
            $("titleText").textContent = data.title;
        } else if(action === 'regen_desc') {
            $("descText").textContent = data.description;
        }
        $("regenTitleBtn").disabled = false;
        $("regenDescBtn").disabled = false;
    } finally { hide($("loading")); }
  }

  /* INITIALISATION & EVENTS */
  function init() {
    loadConfig();
    loadHistory();

    $("generateBtn").onclick = () => apiCall('generate');
    $("regenTitleBtn").onclick = () => apiCall('regen_title');
    $("regenDescBtn").onclick = () => apiCall('regen_desc');

    $("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
    $("closeSettings").onclick = () => $("settingsModal").classList.add("hidden");

    // Gestion des onglets
    document.querySelectorAll(".tab-link").forEach(link => {
        link.onclick = () => {
            document.querySelectorAll(".tab-link").forEach(l => l.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
            link.classList.add("active");
            $(link.dataset.tab).classList.remove("hidden");
        };
    });

    $("imageInput").onchange = (e) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            state.imageBase64 = ev.target.result.split(",")[1];
            $("previewImg").src = ev.target.result;
            show($("preview"));
            $("dropPlaceholder").style.display = "none";
        };
        reader.readAsDataURL(e.target.files[0]);
    };
  }

  init();
})();
