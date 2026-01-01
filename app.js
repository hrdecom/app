(() => {
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    collections: [
      { name: "Initial", meaning: "Jewelry featuring 26 letter variants. Titles must contain 'Initial'." },
      { name: "Angel", meaning: "Jewelry with angelic shapes (wings, feathers)." }
    ],
    promptSystem: "You are a senior luxury jewelry copywriter. Analyze the image and return a valid JSON object.",
    promptTitles: "TITLE FORMAT: Ring: Adjustable {Collection} Ring \"{Name}\". Others: {Collection} {Type} \"{Name}\". Symbolic name must be 1-2 words. NO hyphens.",
    promptDesc: "DESCRIPTION: Exactly TWO paragraphs. Each paragraph MUST be 180 characters or LESS. NO ellipses \"...\". Tone: Luxury.",
    promptHeadlines: "You are a viral marketing expert for luxury jewelry hooks.",
    headlineStyles: [
        { name: "Symbolique", prompt: "Use a deep symbolic and emotional tone related to the product concept." },
        { name: "POV", prompt: "Write from the perspective of someone receiving this as a perfect gift." },
        { name: "Généraliste", prompt: "Broad, catchy hooks to appeal to the widest possible audience." }
    ]
  };

  let state = {
    imageBase64: null, imageMime: "image/jpeg", historyCache: [],
    config: { ...DEFAULTS, blacklist: "" },
    currentPage: 1, pageSize: 5, searchQuery: "", currentHistoryId: null,
    currentGeneratedHeadlines: [], selectedHeadlines: [],
    selectedStyleButtons: [] // Noms des styles sélectionnés
  };

  /* TIMER */
  function startLoading() {
    let s = 0; $("timer").textContent = "00:00";
    state.timerInterval = setInterval(() => {
      s++; const mm = String(Math.floor(s/60)).padStart(2,"0"); const ss = String(s%60).padStart(2,"0");
      $("timer").textContent = `${mm}:${ss}`;
    }, 1000);
    $("loading").classList.remove("hidden");
  }
  function stopLoading() { clearInterval(state.timerInterval); $("loading").classList.add("hidden"); }

  /* CONFIG */
  async function loadConfig() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const saved = data.find(i => i.id === 'full_config');
    if (saved) state.config = JSON.parse(saved.value);
    renderConfigUI();
    renderStyleSelector();
  }

  function renderConfigUI() {
    $("promptSystem").value = state.config.promptSystem || DEFAULTS.promptSystem;
    $("promptTitles").value = state.config.promptTitles || DEFAULTS.promptTitles;
    $("promptDesc").value = state.config.promptDesc || DEFAULTS.promptDesc;
    $("promptHeadlines").value = state.config.promptHeadlines || DEFAULTS.promptHeadlines;
    $("configBlacklist").value = state.config.blacklist || "";
    
    $("collectionSelect").innerHTML = state.config.collections.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    $("collectionsList").innerHTML = state.config.collections.map((c, i) => `
      <div style="display:flex; gap:5px; margin-bottom:10px;">
        <input type="text" value="${c.name}" onchange="updateCol(${i}, 'name', this.value)" style="flex:1">
        <textarea onchange="updateCol(${i}, 'meaning', this.value)" style="flex:2; height:40px;">${c.meaning}</textarea>
        <button onclick="removeCol(${i})">×</button>
      </div>`).join("");

    $("styleButtonsEditor").innerHTML = (state.config.headlineStyles || DEFAULTS.headlineStyles).map((s, i) => `
      <div style="display:flex; gap:5px; margin-bottom:10px;">
        <input type="text" value="${s.name}" onchange="updateStyleBtn(${i}, 'name', this.value)" style="flex:1">
        <input type="text" value="${s.prompt}" onchange="updateStyleBtn(${i}, 'prompt', this.value)" style="flex:3">
        <button onclick="removeStyleBtn(${i})">×</button>
      </div>`).join("");
  }

  window.updateCol = (i, f, v) => state.config.collections[i][f] = v;
  window.removeCol = (i) => { state.config.collections.splice(i, 1); renderConfigUI(); };
  $("addCollection").onclick = () => { state.config.collections.push({name:"", meaning:""}); renderConfigUI(); };

  window.updateStyleBtn = (i, f, v) => state.config.headlineStyles[i][f] = v;
  window.removeStyleBtn = (i) => { state.config.headlineStyles.splice(i, 1); renderConfigUI(); };
  $("addStyleBtn").onclick = () => { state.config.headlineStyles.push({name:"", prompt:""}); renderConfigUI(); };

  /* HEADLINES UI */
  function renderStyleSelector() {
    const container = $("styleSelectorContainer");
    container.innerHTML = (state.config.headlineStyles || DEFAULTS.headlineStyles).map(s => `
        <div class="style-tag ${state.selectedStyleButtons.includes(s.name) ? 'selected' : ''}" 
             onclick="toggleStyleButton('${s.name}', this)">${s.name}</div>
    `).join("");
  }

  window.toggleStyleButton = (name, el) => {
    if (state.selectedStyleButtons.includes(name)) {
        state.selectedStyleButtons = state.selectedStyleButtons.filter(n => n !== name);
    } else {
        state.selectedStyleButtons.push(name);
    }
    el.classList.toggle('selected');
  };

  /* API */
  async function apiCall(action, extra = {}) {
    if (!state.imageBase64) return;
    startLoading();
    try {
      const historyNames = state.historyCache.map(h => h.product_name).filter(Boolean);
      const res = await fetch("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          action, image: state.imageBase64, media_type: state.imageMime,
          collection: $("collectionSelect").value, config: state.config,
          historyNames, currentTitle: $("titleText").textContent, 
          currentDesc: $("descText").textContent, ...extra
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
        state.selectedHeadlines = [];
        loadHistory();
      } else if (action === 'regen_title' || action === 'regen_desc') {
        if (action === 'regen_title') $("titleText").textContent = data.title;
        else $("descText").textContent = data.description;
        if (state.currentHistoryId) {
          await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, title: $("titleText").textContent, description: $("descText").textContent }) });
          loadHistory();
        }
      } else if (action === 'headlines' || action === 'headlines_similar') {
        state.currentGeneratedHeadlines = data.headlines || [];
        renderHeadlinesResults();
        $("similarActions").classList.add("hidden"); // Reset sim btn
      }
    } catch(e) { alert(e.message); }
    finally { stopLoading(); }
  }

  function renderHeadlinesResults() {
    $("headlinesResults").innerHTML = state.currentGeneratedHeadlines.map((h, i) => `
        <div class="headline-item" onclick="toggleHlSelect(${i}, this)">
            <input type="checkbox" id="chk-${i}">
            <span class="headline-text">${h}</span>
        </div>`).join("");
  }

  window.toggleHlSelect = (idx, el) => {
    const cb = el.querySelector('input');
    cb.checked = !cb.checked;
    el.classList.toggle('selected', cb.checked);
    // Afficher bouton sim si au moins 1 coché
    const anyChecked = Array.from(document.querySelectorAll('.headline-item input')).some(c => c.checked);
    $("similarActions").classList.toggle('hidden', !anyChecked);
  };

  async function saveSelectedHeadlines() {
    if (!state.currentHistoryId) return;
    const selected = state.currentGeneratedHeadlines.filter((_, i) => $("chk-"+i).checked);
    state.selectedHeadlines = [...new Set([...state.selectedHeadlines, ...selected])];
    await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, headlines: JSON.stringify(state.selectedHeadlines) }) });
    renderSavedHeadlines();
    alert("Enregistré !");
  }

  function renderSavedHeadlines() {
    $("headlinesSavedList").innerHTML = state.selectedHeadlines.map(h => `
        <div class="headline-item">
            <span class="headline-text">${h}</span>
            <button onclick="copyHl('${h.replace(/'/g,"\\'")}')">📋</button>
        </div>`).join("");
  }
  window.copyHl = (t) => { navigator.clipboard.writeText(t); alert("Copié"); };

  function init() {
    $("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
    $("closeSettings").onclick = () => $("settingsModal").classList.add("hidden");
    $("openHeadlinesBtn").onclick = () => {
        if(!state.currentHistoryId) return alert("Générez un produit d'abord.");
        $("headlinesModal").classList.remove("hidden");
        renderSavedHeadlines();
    };
    $("closeHeadlines").onclick = () => $("headlinesModal").classList.add("hidden");

    document.querySelectorAll(".tab-link").forEach(btn => {
      btn.onclick = (e) => {
        const modal = e.target.closest('.modal-content');
        modal.querySelectorAll(".tab-link").forEach(b => b.classList.remove("active"));
        modal.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
        btn.classList.add("active"); $(btn.dataset.tab).classList.remove("hidden");
      };
    });

    $("sendHeadlineChat").onclick = () => {
        const stylePrompts = (state.config.headlineStyles || DEFAULTS.headlineStyles)
            .filter(s => state.selectedStyleButtons.includes(s.name))
            .map(s => s.prompt).join(" ");
        apiCall('headlines', { style: stylePrompts + " " + $("headlineStyleInput").value });
    };

    $("genSimilarBtn").onclick = () => {
        const selected = state.currentGeneratedHeadlines.filter((_, i) => $("chk-"+i).checked);
        apiCall('headlines_similar', { selectedForSimilar: selected });
    };

    $("saveHeadlinesBtn").onclick = saveSelectedHeadlines;
    $("generateBtn").onclick = () => apiCall('generate');
    $("regenTitleBtn").onclick = () => apiCall('regen_title');
    $("regenDescBtn").onclick = () => apiCall('regen_desc');

    $("drop").onclick = () => $("imageInput").click();
    $("imageInput").onchange = (e) => {
      const file = e.target.files[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.imageMime = ev.target.result.split(";")[0].split(":")[1];
        state.imageBase64 = ev.target.result.split(",")[1];
        $("previewImg").src = ev.target.result; $("preview").classList.remove("hidden");
        $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false;
        state.currentHistoryId = null; state.selectedHeadlines = []; renderHistoryUI();
      };
      reader.readAsDataURL(file);
    };

    $("removeImage").onclick = (e) => {
      e.stopPropagation(); state.imageBase64 = null; state.currentHistoryId = null;
      $("preview").classList.add("hidden"); $("dropPlaceholder").style.display = "block";
      $("generateBtn").disabled = true;
    };

    $("saveConfig").onclick = async () => {
      state.config.promptSystem = $("promptSystem").value;
      state.config.promptTitles = $("promptTitles").value;
      state.config.promptDesc = $("promptDesc").value;
      state.config.promptHeadlines = $("promptHeadlines").value;
      state.config.blacklist = $("configBlacklist").value;
      await fetch("/api/settings", { method: "POST", body: JSON.stringify({ id: 'full_config', value: JSON.stringify(state.config) }) });
      alert("Enregistré"); $("settingsModal").classList.add("hidden");
      renderStyleSelector();
    };

    $("historySearch").oninput = (e) => { state.searchQuery = e.target.value; state.currentPage = 1; renderHistoryUI(); };
    loadConfig(); loadHistory();
  }

  async function loadHistory() {
    const res = await fetch("/api/history"); state.historyCache = await res.json(); renderHistoryUI();
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
      </div>`).join("");
    renderPagination(Math.ceil(filtered.length / state.pageSize));
  }

  function renderPagination(total) {
    const p = $("pagination"); p.innerHTML = ""; if(total <= 1) return;
    for(let i=1; i<=total; i++) {
      const b = document.createElement("button"); b.textContent = i;
      if(i === state.currentPage) b.className = "active";
      b.onclick = () => { state.currentPage = i; renderHistoryUI(); }; p.appendChild(b);
    }
  }

  window.restore = (id) => {
    const item = state.historyCache.find(i => i.id === id); if(!item) return;
    state.currentHistoryId = id; state.selectedHeadlines = item.headlines ? JSON.parse(item.headlines) : [];
    $("titleText").textContent = item.title; $("descText").textContent = item.description;
    $("previewImg").src = `data:image/jpeg;base64,${item.image}`;
    state.imageBase64 = item.image; $("preview").classList.remove("hidden");
    $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false;
    renderHistoryUI(); window.scrollTo({top:0, behavior:'smooth'});
  };

  window.deleteItem = async (id) => {
    if(!confirm("Supprimer ?")) return;
    await fetch(`/api/history?id=${id}`, { method: "DELETE" });
    if(state.currentHistoryId == id) state.currentHistoryId = null;
    loadHistory();
  };

  init();
})();
