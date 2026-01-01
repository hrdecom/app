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
    promptHeadlines: "Viral TikTok hooks expert.",
    promptAdCopys: "Facebook Ads expert. Structure: Desc, Bullets (Hypo, Water, Made to last), CTA + URL.",
    headlineStyles: [{ name: "POV", prompt: "Write from a POV perspective." }],
    adStyles: [{ name: "Cadeau", prompt: "Focus on gifting emotion." }]
  };

  let state = {
    imageBase64: null, imageMime: "image/jpeg", historyCache: [],
    config: JSON.parse(JSON.stringify(DEFAULTS)),
    currentPage: 1, pageSize: 5, searchQuery: "", currentHistoryId: null,
    timerInterval: null,
    sessionHeadlines: [], sessionAds: [],
    selectedHeadlines: [], selectedAds: [],
    selHlStyles: [], selAdStyles: [],
    hlPage: 1, adPage: 1
  };

  function startLoading() {
    let s = 0; $("timer").textContent = "00:00";
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      s++; const mm = String(Math.floor(s/60)).padStart(2,"0"); const ss = String(s%60).padStart(2,"0");
      $("timer").textContent = `${mm}:${ss}`;
    }, 1000);
    $("loading").classList.remove("hidden");
  }
  function stopLoading() { clearInterval(state.timerInterval); $("loading").classList.add("hidden"); }

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
    $("promptHeadlines").value = state.config.promptHeadlines || DEFAULTS.promptHeadlines;
    $("promptAdCopys").value = state.config.promptAdCopys || DEFAULTS.promptAdCopys;
    $("configBlacklist").value = state.config.blacklist || "";
    
    $("collectionsList").innerHTML = (state.config.collections || []).map((c, i) => `
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" value="${c.name}" onchange="updateCol(${i}, 'name', this.value)" style="flex:1; padding:8px; border-radius:8px; border:1px solid #ddd;">
        <textarea onchange="updateCol(${i}, 'meaning', this.value)" style="flex:2; height:45px; padding:8px; border-radius:8px; border:1px solid #ddd; font-size:12px;">${c.meaning}</textarea>
        <button onclick="removeCol(${i})" style="color:red; border:none; background:none;">×</button>
      </div>`).join("");

    $("styleButtonsEditor").innerHTML = (state.config.headlineStyles || []).map((s, i) => `
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" value="${s.name}" onchange="updateStyleBtn(${i}, 'name', this.value)" style="flex:1; padding:8px; border-radius:8px; border:1px solid #ddd;">
        <input type="text" value="${s.prompt}" onchange="updateStyleBtn(${i}, 'prompt', this.value)" style="flex:3; padding:8px; border-radius:8px; border:1px solid #ddd;">
        <button onclick="removeStyleBtn(${i})" style="color:red; border:none; background:none;">×</button>
      </div>`).join("");

    $("adStyleButtonsEditor").innerHTML = (state.config.adStyles || []).map((s, i) => `
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" value="${s.name}" onchange="updateAdStyleBtn(${i}, 'name', this.value)" style="flex:1; padding:8px; border-radius:8px; border:1px solid #ddd;">
        <input type="text" value="${s.prompt}" onchange="updateAdStyleBtn(${i}, 'prompt', this.value)" style="flex:3; padding:8px; border-radius:8px; border:1px solid #ddd;">
        <button onclick="removeAdStyleBtn(${i})" style="color:red; border:none; background:none;">×</button>
      </div>`).join("");
    
    $("collectionSelect").innerHTML = (state.config.collections || []).map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    renderStyleSelectors();
  }

  window.updateCol = (i, f, v) => state.config.collections[i][f] = v;
  window.removeCol = (i) => { state.config.collections.splice(i, 1); renderConfigUI(); };
  $("addCollection").onclick = () => { state.config.collections.push({name:"", meaning:""}); renderConfigUI(); };
  window.updateStyleBtn = (i, f, v) => state.config.headlineStyles[i][f] = v;
  window.removeStyleBtn = (i) => { state.config.headlineStyles.splice(i, 1); renderConfigUI(); };
  $("addStyleBtn").onclick = () => { state.config.headlineStyles.push({name:"", prompt:""}); renderConfigUI(); };
  window.updateAdStyleBtn = (i, f, v) => state.config.adStyles[i][f] = v;
  window.removeAdStyleBtn = (i) => { state.config.adStyles.splice(i, 1); renderConfigUI(); };
  $("addAdStyleBtn").onclick = () => { state.config.adStyles.push({name:"", prompt:""}); renderConfigUI(); };

  function renderStyleSelectors() {
    $("styleSelectorContainer").innerHTML = (state.config.headlineStyles || []).map(s => `<div class="style-tag ${state.selHlStyles.includes(s.name) ? 'selected' : ''}" onclick="toggleStyle('hl', '${s.name}', this)">${s.name}</div>`).join("");
    $("adStyleSelectorContainer").innerHTML = (state.config.adStyles || []).map(s => `<div class="style-tag ${state.selAdStyles.includes(s.name) ? 'selected' : ''}" onclick="toggleStyle('ad', '${s.name}', this)">${s.name}</div>`).join("");
  }
  window.toggleStyle = (type, name, el) => {
    let list = (type === 'hl') ? state.selHlStyles : state.selAdStyles;
    if (list.includes(name)) list.splice(list.indexOf(name), 1); else list.push(name);
    el.classList.toggle('selected');
  };

  async function apiCall(action, extra = {}) {
    if (!state.imageBase64) return;
    startLoading();
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          action, image: state.imageBase64, media_type: state.imageMime,
          collection: $("collectionSelect").value, config: state.config,
          historyNames: state.historyCache.map(h => h.product_name),
          currentTitle: $("titleText").textContent, currentDesc: $("descText").textContent,
          product_url: $("productUrlInput").value, ...extra
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "IA Error");

      if (action === 'generate') {
        $("titleText").textContent = data.title;
        $("descText").textContent = data.description;
        const hRes = await fetch("/api/history", { method: "POST", body: JSON.stringify({ title: data.title, description: data.description, image: state.imageBase64, product_name: data.product_name, product_url: $("productUrlInput").value }) });
        const hData = await hRes.json();
        state.currentHistoryId = hData.id;
        state.selectedHeadlines = []; state.selectedAds = []; state.sessionHeadlines = []; state.sessionAds = [];
        $("regenTitleBtn").disabled = false; $("regenDescBtn").disabled = false;
        await loadHistory();
      } else if (action === 'regen_title' || action === 'regen_desc') {
        if (action === 'regen_title') $("titleText").textContent = data.title;
        else $("descText").textContent = data.description;
        if (state.currentHistoryId) await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, title: $("titleText").textContent, description: $("descText").textContent }) });
        await loadHistory();
      } else if (action === 'headlines' || action === 'headlines_similar') {
        state.sessionHeadlines = [...(data.headlines || []), ...state.sessionHeadlines];
        state.hlPage = 1; renderHeadlines();
      } else if (action === 'ad_copys') {
        state.sessionAds = [...(data.ad_copys || []), ...state.sessionAds];
        state.adPage = 1; renderAds();
      }
    } catch(e) { alert(e.message); }
    finally { stopLoading(); }
  }

  function renderHeadlines() {
    const start = (state.hlPage - 1) * 5;
    const paginated = state.sessionHeadlines.slice(start, start + 5);
    $("headlinesResults").innerHTML = paginated.map((h, i) => `<div class="headline-item" onclick="toggleItemSelect('hl', ${start+i}, this)"><input type="checkbox" id="chk-hl-${start+i}"><span class="headline-text">${h}</span></div>`).join("");
    renderLocalPagination('hl');
  }
  function renderAds() {
    const start = (state.adPage - 1) * 5;
    const paginated = state.sessionAds.slice(start, start + 5);
    $("adsResults").innerHTML = paginated.map((h, i) => `<div class="headline-item" onclick="toggleItemSelect('ad', ${start+i}, this)"><input type="checkbox" id="chk-ad-${start+i}"><span class="headline-text">${h}</span></div>`).join("");
    renderLocalPagination('ad');
  }
  window.toggleItemSelect = (type, idx, el) => {
    const cb = el.querySelector('input'); cb.checked = !cb.checked; el.classList.toggle('selected', cb.checked);
    if(type === 'hl') $("headlinesActionsGroup").classList.toggle('hidden', !document.querySelectorAll('#headlinesResults .selected').length);
  };

  function renderLocalPagination(type) {
    const list = (type === 'hl') ? state.sessionHeadlines : state.sessionAds;
    const container = (type === 'hl') ? $("headlinesLocalPagination") : $("adsLocalPagination");
    const total = Math.ceil(list.length / 5); container.innerHTML = "";
    if (total <= 1) return;
    for (let i = 1; i <= total; i++) {
        const btn = document.createElement("button"); btn.textContent = i;
        if (i === (type === 'hl' ? state.hlPage : state.adPage)) btn.className = "active";
        btn.onclick = () => { if(type === 'hl') state.hlPage = i; else state.adPage = i; type === 'hl' ? renderHeadlines() : renderAds(); };
        container.appendChild(btn);
    }
  }

  async function saveSelections(type) {
    if (!state.currentHistoryId) return;
    const isHl = type === 'hl';
    const containerId = isHl ? 'headlinesResults' : 'adsResults';
    const selected = []; document.querySelectorAll(`#${containerId} .selected .headline-text`).forEach(it => selected.push(it.textContent));
    if (isHl) {
        state.selectedHeadlines = [...new Set([...state.selectedHeadlines, ...selected])];
        await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, headlines: JSON.stringify(state.selectedHeadlines) }) });
        renderSavedHeadlines();
    } else {
        state.selectedAds = [...new Set([...state.selectedAds, ...selected])];
        await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, ad_copys: JSON.stringify(state.selectedAds) }) });
        renderSavedAds();
    }
    alert("Enregistré !");
  }

  function renderSavedHeadlines() {
    $("headlinesSavedList").innerHTML = state.selectedHeadlines.map((h, i) => `<div class="headline-item no-hover"><span class="headline-text">${h}</span><button class="icon-btn-small delete-hl" onclick="deleteSaved('hl', ${i})">×</button></div>`).join("");
  }
  function renderSavedAds() {
    $("adsSavedList").innerHTML = state.selectedAds.map((h, i) => `<div class="headline-item no-hover" style="flex-direction:column; align-items:flex-start;"><div style="display:flex; justify-content:space-between; width:100%; margin-bottom:5px;"><strong style="font-size:10px; color:var(--apple-blue);">PRIMARY TEXT ${i+1}</strong><div style="display:flex; gap:10px;"><button class="icon-btn-small" onclick="copyHl('${h.replace(/\n/g,"\\n").replace(/'/g,"\\'")}')">📋</button><button class="icon-btn-small delete-hl" onclick="deleteSaved('ad', ${i})">×</button></div></div><span class="headline-text" style="white-space:pre-wrap;">${h}</span></div>`).join("");
    const name = $("titleText").textContent; const url = $("productUrlInput").value;
    $("adsDefaultInfoBlock").innerHTML = `
        <div class="ads-info-row"><span style="flex:1"><span class="ads-info-label">TITRE 1</span>${name}</span><button onclick="copyHl('${name.replace(/'/g,"\\'")}')">📋</button></div>
        <div class="ads-info-row"><span style="flex:1"><span class="ads-info-label">TITRE 2</span>${name} - Special Offer</span><button onclick="copyHl('${name.replace(/'/g,"\\'") + ' - Special Offer'}')">📋</button></div>
        <div class="ads-info-row"><span style="flex:1"><span class="ads-info-label">TITRE 3</span>Gift Idea - ${name}</span><button onclick="copyHl('${'Gift Idea - ' + name.replace(/'/g,"\\'")}')">📋</button></div>
        <div class="ads-info-row"><span style="flex:1"><span class="ads-info-label">TITRE 4</span>${name} - Valentine's Day Gift Idea</span><button onclick="copyHl('${name.replace(/'/g,"\\'") + " - Valentine's Day Gift Idea"}')">📋</button></div>
        <div class="ads-info-row"><span style="flex:1"><span class="ads-info-label">SUB</span>Free Shipping Worldwide Today</span><button onclick="copyHl('Free Shipping Worldwide Today')">📋</button></div>
        <div class="ads-info-row"><span style="flex:1"><span class="ads-info-label">URL</span>${url}</span><button onclick="copyHl('${url}')">📋</button></div>`;
  }

  window.deleteSaved = async (type, index) => {
    if(!confirm("Supprimer ?")) return;
    if(type === 'hl') state.selectedHeadlines.splice(index, 1); else state.selectedAds.splice(index, 1);
    await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, headlines: JSON.stringify(state.selectedHeadlines), ad_copys: JSON.stringify(state.selectedAds) }) });
    type === 'hl' ? renderSavedHeadlines() : renderSavedAds();
  };

  window.copyHl = (t) => { navigator.clipboard.writeText(t); alert("Copié"); };

  function init() {
    $("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
    $("closeSettings").onclick = () => $("settingsModal").classList.add("hidden");
    $("openHeadlinesBtn").onclick = () => { if(!state.currentHistoryId) return alert("Générez un produit d'abord."); $("headlinesModal").classList.remove("hidden"); renderSavedHeadlines(); };
    $("closeHeadlines").onclick = () => $("headlinesModal").classList.add("hidden");
    $("openAdsBtn").onclick = () => { if(!state.currentHistoryId) return alert("Générez un produit d'abord."); $("adsModal").classList.remove("hidden"); renderSavedAds(); };
    $("closeAds").onclick = () => $("adsModal").classList.add("hidden");
    window.onclick = (e) => { if (e.target.classList.contains('modal')) e.target.classList.add("hidden"); };

    document.querySelectorAll(".tab-link").forEach(btn => {
      btn.onclick = (e) => {
        const modal = e.target.closest('.modal-content');
        modal.querySelectorAll(".tab-link").forEach(b => b.classList.remove("active"));
        modal.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
        btn.classList.add("active"); $(btn.dataset.tab).classList.remove("hidden");
      };
    });

    $("sendHeadlineChat").onclick = () => {
        const style = state.selHlStyles.map(n => state.config.headlineStyles.find(s => s.name === n)?.prompt).join(" ");
        apiCall('headlines', { style: style + " " + $("headlineStyleInput").value });
    };
    $("sendAdChat").onclick = () => {
        const style = state.selAdStyles.map(n => state.config.adStyles.find(s => s.name === n)?.prompt).join(" ");
        apiCall('ad_copys', { style: style + " " + $("adStyleInput").value });
    };
    $("genSimilarBtn").onclick = () => {
        const selected = []; document.querySelectorAll('#headlinesResults .selected .headline-text').forEach(it => selected.push(it.textContent));
        apiCall('headlines_similar', { selectedForSimilar: selected });
    };

    $("saveHeadlinesBtn").onclick = () => saveSelections('hl');
    $("saveAdsBtn").onclick = () => saveSelections('ad');
    $("productUrlInput").onchange = async () => { if(state.currentHistoryId) await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, product_url: $("productUrlInput").value }) }); };

    $("generateBtn").onclick = () => apiCall('generate');
    $("regenTitleBtn").onclick = () => apiCall('regen_title');
    $("regenDescBtn").onclick = () => apiCall('regen_desc');

    $("imageInput").onchange = (e) => {
      const file = e.target.files[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.imageMime = ev.target.result.split(";")[0].split(":")[1]; state.imageBase64 = ev.target.result.split(",")[1];
        $("previewImg").src = ev.target.result; $("preview").classList.remove("hidden");
        $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false;
        state.currentHistoryId = null; state.sessionHeadlines = []; state.sessionAds = []; $("productUrlInput").value = ""; renderHistoryUI();
      };
      reader.readAsDataURL(file);
    };

    $("removeImage").onclick = (e) => {
      e.stopPropagation(); state.imageBase64 = null; state.currentHistoryId = null;
      $("preview").classList.add("hidden"); $("dropPlaceholder").style.display = "block";
      $("generateBtn").disabled = true; $("regenTitleBtn").disabled = true; $("regenDescBtn").disabled = true;
      renderHistoryUI();
    };

    $("saveConfig").onclick = async () => {
      state.config.promptSystem = $("promptSystem").value; state.config.promptTitles = $("promptTitles").value;
      state.config.promptDesc = $("promptDesc").value; state.config.promptHeadlines = $("promptHeadlines").value;
      state.config.promptAdCopys = $("promptAdCopys").value; state.config.blacklist = $("configBlacklist").value;
      await fetch("/api/settings", { method: "POST", body: JSON.stringify({ id: 'full_config', value: JSON.stringify(state.config) }) });
      alert("Enregistré"); $("settingsModal").classList.add("hidden"); renderConfigUI();
    };

    $("historySearch").oninput = (e) => { state.searchQuery = e.target.value; state.currentPage = 1; renderHistoryUI(); };
    loadConfig(); loadHistory();
  }

  async function loadHistory() {
    const res = await fetch("/api/history"); state.historyCache = await res.json(); renderHistoryUI();
  }

  function renderHistoryUI() {
    const filtered = state.historyCache.filter(i => (i.title||"").toLowerCase().includes(state.searchQuery.toLowerCase()));
    const start = (state.currentPage - 1) * 5; const paginated = filtered.slice(start, start + 5);
    $("historyList").innerHTML = paginated.map(item => `<div class="history-item ${state.currentHistoryId == item.id ? 'active-history' : ''}" onclick="restore(${item.id})"><img src="data:image/jpeg;base64,${item.image}" class="history-img"><div style="flex:1"><h4>${item.title || "Sans titre"}</h4></div><button onclick="event.stopPropagation(); deleteItem(${item.id})">🗑</button></div>`).join("");
    renderPagination(Math.ceil(filtered.length / 5));
  }

  function renderPagination(total) {
    const p = $("pagination"); p.innerHTML = ""; if(total <= 1) return;
    for(let i=1; i<=total; i++) {
      const b = document.createElement("button"); b.textContent = i; if(i === state.currentPage) b.className = "active";
      b.onclick = () => { state.currentPage = i; renderHistoryUI(); }; p.appendChild(b);
    }
  }

  window.restore = (id) => {
    const item = state.historyCache.find(i => i.id === id); if(!item) return;
    state.currentHistoryId = id; 
    state.selectedHeadlines = item.headlines ? JSON.parse(item.headlines) : [];
    state.selectedAds = item.ad_copys ? JSON.parse(item.ad_copys) : [];
    $("titleText").textContent = item.title; $("descText").textContent = item.description;
    $("productUrlInput").value = item.product_url || "";
    $("previewImg").src = `data:image/jpeg;base64,${item.image}`;
    state.imageBase64 = item.image; $("preview").classList.remove("hidden");
    $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false;
    $("regenTitleBtn").disabled = false; $("regenDescBtn").disabled = false;
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
