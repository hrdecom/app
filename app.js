(() => {
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    collections: [
      { name: "Initial", meaning: "Jewelry featuring 26 letter variants." },
      { name: "Angel", meaning: "Jewelry with angelic shapes." }
    ],
    promptSystem: "Senior luxury jewelry copywriter.",
    promptTitles: "TITLE: Adjustable {Collection} Ring \"{Name}\". NO hyphens.",
    promptDesc: "DESCRIPTION: 2 paras, <=180 chars. Tone: Luxury.",
    promptHeadlines: "Viral TikTok hooks expert.",
    promptAdCopys: "Facebook Ads expert. Structure: Hook, Bullets, CTA+URL.",
    headlineStyles: [{ name: "POV", prompt: "Write from a POV perspective." }],
    adStyles: [{ name: "Cadeau", prompt: "Focus on gifting emotion." }]
  };

  let state = {
    imageBase64: null, imageMime: "image/jpeg", historyCache: [],
    config: JSON.parse(JSON.stringify(DEFAULTS)),
    currentPage: 1, pageSize: 5, searchQuery: "", currentHistoryId: null,
    timerInterval: null,
    sessionHeadlines: [], sessionAds: [], // sessionAds stores {text, style}
    hlPage: 1, adPage: 1, hlPageSize: 12, adPageSize: 12,
    selHlStyles: [], selAdStyles: []
  };

  const startLoading = () => {
    let s = 0; $("timer").textContent = "00:00";
    state.timerInterval = setInterval(() => {
      s++; const mm = String(Math.floor(s/60)).padStart(2,"0"); const ss = String(s%60).padStart(2,"0");
      $("timer").textContent = `${mm}:${ss}`;
    }, 1000);
    $("loading").classList.remove("hidden");
  };
  const stopLoading = () => { clearInterval(state.timerInterval); $("loading").classList.add("hidden"); };

  async function loadConfig() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const saved = data.find(i => i.id === 'full_config');
    if (saved) {
      state.config = JSON.parse(saved.value);
      if (!state.config.headlineStyles) state.config.headlineStyles = [...DEFAULTS.headlineStyles];
      if (!state.config.adStyles) state.config.adStyles = [...DEFAULTS.adStyles];
    }
    renderConfigUI();
  }

  function renderConfigUI() {
    ["promptSystem", "promptTitles", "promptDesc", "promptHeadlines", "promptAdCopys"].forEach(id => {
      $(id).value = state.config[id] || DEFAULTS[id];
    });
    $("configBlacklist").value = state.config.blacklist || "";
    
    $("collectionsList").innerHTML = (state.config.collections || []).map((c, i) => `
      <div class="config-row collections-item" style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" value="${c.name}" class="col-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;">
        <textarea class="col-meaning" style="flex:2; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${c.meaning}</textarea>
        <button onclick="this.parentElement.remove()" style="color:red; border:none; background:none; cursor:pointer;">×</button>
      </div>`).join("");

    $("styleButtonsEditor").innerHTML = (state.config.headlineStyles || []).map((s, i) => `
      <div class="config-row headline-style-item" style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" value="${s.name}" class="style-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;">
        <textarea class="style-prompt" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${s.prompt}</textarea>
        <button onclick="this.parentElement.remove()" style="color:red; border:none; background:none; cursor:pointer;">×</button>
      </div>`).join("");

    $("adStyleButtonsEditor").innerHTML = (state.config.adStyles || []).map((s, i) => `
      <div class="config-row ad-style-item" style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" value="${s.name}" class="ad-style-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;">
        <textarea class="ad-style-prompt" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${s.prompt}</textarea>
        <button onclick="this.parentElement.remove()" style="color:red; border:none; background:none; cursor:pointer;">×</button>
      </div>`).join("");

    $("collectionSelect").innerHTML = (state.config.collections || []).map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    renderStyleSelectors();
  }

  $("addCollection").onclick = () => { renderConfigUI(); /* Triggers redraw and captures current */ const div = document.createElement('div'); div.className="config-row collections-item"; div.style="display:flex; gap:10px; margin-bottom:10px;"; div.innerHTML=`<input type="text" class="col-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="col-meaning" style="flex:2; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;"></textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none; cursor:pointer;">×</button>`; $("collectionsList").appendChild(div); };
  $("addStyleBtn").onclick = () => { const div = document.createElement('div'); div.className="config-row headline-style-item"; div.style="display:flex; gap:10px; margin-bottom:10px;"; div.innerHTML=`<input type="text" class="style-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="style-prompt" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;"></textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none; cursor:pointer;">×</button>`; $("styleButtonsEditor").appendChild(div); };
  $("addAdStyleBtn").onclick = () => { const div = document.createElement('div'); div.className="config-row ad-style-item"; div.style="display:flex; gap:10px; margin-bottom:10px;"; div.innerHTML=`<input type="text" class="ad-style-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="ad-style-prompt" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;"></textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none; cursor:pointer;">×</button>`; $("adStyleButtonsEditor").appendChild(div); };

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
      const common = { 
        image: state.imageBase64, media_type: state.imageMime, 
        collection: $("collectionSelect").value, config: state.config,
        historyNames: state.historyCache.map(h => h.product_name),
        currentTitle: $("titleText").textContent, currentDesc: $("descText").textContent,
        product_url: $("productUrlInput").value 
      };

      // ADS: Parallel Simultaneous Generation
      if (action === 'ad_copys' && state.selAdStyles.length > 0) {
        const results = await Promise.all(state.selAdStyles.map(sName => {
          const sPrompt = state.config.adStyles.find(x => x.name === sName)?.prompt;
          return fetch("/api/generate", { method: "POST", body: JSON.stringify({ ...common, action, style: sPrompt + " " + (extra.userText || ""), styleLabel: sName }) }).then(r => r.json().then(d => ({ ...d, label: sName })));
        }));
        results.forEach(res => {
          state.sessionAds = [...(res.ad_copys || []).map(t => ({ text: t, style: res.label })), ...state.sessionAds];
        });
        state.adPage = 1; renderAds();
      } 
      // HEADLINES: Single request with combined style (Original Request)
      else {
        if (action === 'headlines' && state.selHlStyles.length > 0) {
            extra.style = state.selHlStyles.map(n => state.config.headlineStyles.find(s => s.name === n)?.prompt).join(" ") + " " + (extra.userText || "");
        }
        const res = await fetch("/api/generate", { method: "POST", body: JSON.stringify({ ...common, action, ...extra }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erreur IA");

        if (action === 'generate') {
          $("titleText").textContent = data.title; $("descText").textContent = data.description;
          const hRes = await fetch("/api/history", { method: "POST", body: JSON.stringify({ title: data.title, description: data.description, image: state.imageBase64, product_name: data.product_name, product_url: $("productUrlInput").value }) });
          const hData = await hRes.json();
          state.currentHistoryId = hData.id;
          state.sessionHeadlines = []; state.sessionAds = []; await loadHistory();
        } else if (action === 'regen_title' || action === 'regen_desc') {
          if (action === 'regen_title') $("titleText").textContent = data.title; else $("descText").textContent = data.description;
          if (state.currentHistoryId) await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, title: $("titleText").textContent, description: $("descText").textContent }) });
          await loadHistory();
        } else if (action.includes('headlines')) {
          state.sessionHeadlines = [...(data.headlines || []), ...state.sessionHeadlines];
          state.hlPage = 1; renderHeadlines();
        } else if (action.includes('ad_copys')) {
          state.sessionAds = [...(data.ad_copys || []).map(t => ({ text: t, style: 'Variante' })), ...state.sessionAds];
          state.adPage = 1; renderAds();
        }
      }
      $("regenTitleBtn").disabled = $("regenDescBtn").disabled = false;
    } catch(e) { alert("Erreur: " + e.message); }
    finally { stopLoading(); }
  }

  const renderHeadlines = () => {
    const pag = state.sessionHeadlines.slice((state.hlPage-1)*12, state.hlPage*12);
    $("headlinesResults").innerHTML = pag.map((text, i) => `<div class="headline-item" onclick="toggleItemSelect('hl', i, this)"><input type="checkbox"><span class="headline-text">${text}</span></div>`).join("");
    renderPaginationLoc('hl');
  };

  const renderAds = () => {
    const pag = state.sessionAds.slice((state.adPage-1)*12, state.adPage*12);
    let html = "", lastStyle = "";
    pag.forEach((item, i) => {
      if (item.style !== lastStyle) {
        html += `<div style="margin: 10px 0 5px; font-size:11px; font-weight:bold; color:var(--apple-blue); border-bottom:1px solid #eee; padding-bottom:3px;">${item.style.toUpperCase()}</div>`;
        lastStyle = item.style;
      }
      html += `<div class="headline-item" onclick="toggleItemSelect('ad', i, this)"><input type="checkbox"><div class="headline-text" style="white-space:pre-wrap;">${item.text}</div></div>`;
    });
    $("adsResults").innerHTML = html;
    renderPaginationLoc('ad');
  };

  window.toggleItemSelect = (type, idx, el) => {
    const cb = el.querySelector('input'); cb.checked = !cb.checked; el.classList.toggle('selected', cb.checked);
    const has = document.querySelectorAll(type === 'hl' ? '#headlinesResults .selected' : '#adsResults .selected').length > 0;
    $(type === 'hl' ? 'similarActions' : 'similarAdsActions').classList.toggle('hidden', !has);
  };

  function renderPaginationLoc(type) {
    const list = type === 'hl' ? state.sessionHeadlines : state.sessionAds;
    const container = type === 'hl' ? $("headlinesLocalPagination") : $("adsLocalPagination");
    const total = Math.ceil(list.length / 12);
    container.innerHTML = ""; if (total <= 1) return;
    for (let i = 1; i <= total; i++) {
      const b = document.createElement("button"); b.textContent = i;
      if (i === (type === 'hl' ? state.hlPage : state.adPage)) b.className = "active";
      b.onclick = () => { if(type === 'hl') state.hlPage = i; else state.adPage = i; type === 'hl' ? renderHeadlines() : renderAds(); };
      container.appendChild(b);
    }
  }

  async function saveSelections(type) {
    if (!state.currentHistoryId) return;
    const selected = []; 
    document.querySelectorAll(`#${type === 'hl' ? 'headlinesResults' : 'adsResults'} .selected .headline-text`).forEach(it => selected.push(it.innerText));
    const key = type === 'hl' ? 'headlines' : 'ad_copys';
    const targetState = type === 'hl' ? 'selectedHeadlines' : 'selectedAds';
    state[targetState] = [...new Set([...state[targetState], ...selected])];
    await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, [key]: JSON.stringify(state[targetState]) }) });
    type === 'hl' ? renderSavedHl() : renderSavedAds();
    alert("Enregistré");
  }

  const renderSavedHl = () => {
    $("headlinesSavedList").innerHTML = (state.selectedHeadlines || []).map((h, i) => `
      <div class="headline-item no-hover">
        <span class="headline-text">${h}</span>
        <div style="display:flex;gap:5px;">
            <button class="icon-btn-small" onclick="window.copyToClip(\`${h.replace(/'/g,"\\'")}\`)">📋</button>
            <button class="icon-btn-small" style="color:red" onclick="deleteSaved('hl',${i})">×</button>
        </div>
      </div>`).join("");
  };

  const renderSavedAds = () => {
    $("adsSavedList").innerHTML = (state.selectedAds || []).map((h, i) => `
      <div class="headline-item no-hover" style="flex-direction:column;align-items:flex-start;">
        <div style="display:flex;justify-content:space-between;width:100%"><strong style="font-size:10px;color:var(--apple-blue)">PRIMARY ${i+1}</strong>
            <div style="display:flex;gap:5px;">
                <button class="icon-btn-small" onclick="window.copyToClip(\`${h.replace(/\n/g,"\\n").replace(/'/g,"\\'")}\`)">📋</button>
                <button class="icon-btn-small" style="color:red" onclick="deleteSaved('ad',${i})">×</button>
            </div>
        </div>
        <span class="headline-text" style="white-space:pre-wrap;">${h}</span>
      </div>`).join("");
    const n = $("titleText").textContent, u = $("productUrlInput").value;
    $("adsDefaultInfoBlock").innerHTML = [`TITRE 1|${n}`, `TITRE 2|${n} - Special Offer`, `TITRE 3|Gift Idea - ${n}`, `SUB|Free Shipping Worldwide Today`, `URL|${u}`].map(x => {
      const [l,v] = x.split('|'); return `<div class="ads-info-row"><span><span class="ads-info-label">${l}</span>${v}</span><button class="icon-btn-small" onclick="window.copyToClip(\`${v.replace(/'/g,"\\'")}\`)">📋</button></div>`;
    }).join("");
  };

  window.copyToClip = (t) => { navigator.clipboard.writeText(t); alert("Copié !"); };

  window.deleteSaved = async (type, i) => {
    const list = type === 'hl' ? state.selectedHeadlines : state.selectedAds; list.splice(i, 1);
    await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, [type === 'hl' ? 'headlines' : 'ad_copys']: JSON.stringify(list) }) });
    type === 'hl' ? renderSavedHl() : renderSavedAds();
  };

  function init() {
    $("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
    $("closeSettings").onclick = () => $("settingsModal").classList.add("hidden");
    $("saveConfig").onclick = async () => {
      ["promptSystem", "promptTitles", "promptDesc", "promptHeadlines", "promptAdCopys"].forEach(id => state.config[id] = $(id).value);
      state.config.blacklist = $("configBlacklist").value;
      state.config.collections = Array.from(document.querySelectorAll('.collections-item')).map(r => ({ name: r.querySelector('.col-name').value, meaning: r.querySelector('.col-meaning').value }));
      state.config.headlineStyles = Array.from(document.querySelectorAll('.headline-style-item')).map(r => ({ name: r.querySelector('.style-name').value, prompt: r.querySelector('.style-prompt').value }));
      state.config.adStyles = Array.from(document.querySelectorAll('.ad-style-item')).map(r => ({ name: r.querySelector('.ad-style-name').value, prompt: r.querySelector('.ad-style-prompt').value }));
      await fetch("/api/settings", { method: "POST", body: JSON.stringify({ id: 'full_config', value: JSON.stringify(state.config) }) });
      alert("Enregistré"); $("settingsModal").classList.add("hidden"); renderConfigUI();
    };

    $("openHeadlinesBtn").onclick = () => { if(!state.currentHistoryId) return; $("headlinesModal").classList.remove("hidden"); renderSavedHl(); };
    $("openAdsBtn").onclick = () => { if(!state.currentHistoryId) return; $("adsModal").classList.remove("hidden"); renderSavedAds(); };
    $("closeHeadlines").onclick = () => $("headlinesModal").classList.add("hidden");
    $("closeAds").onclick = () => $("adsModal").classList.add("hidden");

    document.querySelectorAll(".tab-link").forEach(btn => {
      btn.onclick = (e) => {
        const m = e.target.closest('.modal-content');
        m.querySelectorAll(".tab-link").forEach(b => b.classList.remove("active"));
        m.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
        btn.classList.add("active"); $(btn.dataset.tab).classList.remove("hidden");
      };
    });

    $("sendHeadlineChat").onclick = () => apiCall('headlines', { userText: $("headlineStyleInput").value });
    $("sendAdChat").onclick = () => apiCall('ad_copys', { userText: $("adStyleInput").value });
    
    $("genSimilarBtn").onclick = () => {
        const sel = []; document.querySelectorAll('#headlinesResults .selected .headline-text').forEach(it => sel.push(it.innerText));
        apiCall('headlines_similar', { selectedForSimilar: sel });
    };
    $("genSimilarAdsBtn").onclick = () => {
        const sel = []; document.querySelectorAll('#adsResults .selected .headline-text').forEach(it => sel.push(it.innerText));
        apiCall('ad_copys_similar', { selectedForSimilar: sel });
    };

    $("saveHeadlinesBtn").onclick = () => saveSelections('hl');
    $("saveAdsBtn").onclick = () => saveSelections('ad');
    $("productUrlInput").onchange = async () => { if(state.currentHistoryId) await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, product_url: $("productUrlInput").value }) }); };

    $("generateBtn").onclick = () => apiCall('generate');
    $("regenTitleBtn").onclick = () => apiCall('regen_title');
    $("regenDescBtn").onclick = () => apiCall('regen_desc');

    $("drop").onclick = () => $("imageInput").click();
    $("imageInput").onchange = (e) => {
      const f = e.target.files[0]; if(!f) return;
      const r = new FileReader(); r.onload = (ev) => {
        state.imageMime = ev.target.result.split(";")[0].split(":")[1]; state.imageBase64 = ev.target.result.split(",")[1];
        $("previewImg").src = ev.target.result; $("preview").classList.remove("hidden");
        $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false;
        state.currentHistoryId = null; state.sessionHeadlines = []; state.sessionAds = []; $("productUrlInput").value = "";
      }; r.readAsDataURL(f);
    };

    $("removeImage").onclick = (e) => {
      e.stopPropagation(); state.imageBase64 = null; state.currentHistoryId = null;
      $("preview").classList.add("hidden"); $("dropPlaceholder").style.display = "block";
      $("generateBtn").disabled = true; $("regenTitleBtn").disabled = true; $("regenDescBtn").disabled = true;
    };

    $("historySearch").oninput = (e) => { state.searchQuery = e.target.value; state.currentPage = 1; renderHistoryUI(); };
    loadConfig(); loadHistory();
  }

  async function loadHistory() { const r = await fetch("/api/history"); state.historyCache = await r.json(); renderHistoryUI(); }
  function renderHistoryUI() {
    const filtered = state.historyCache.filter(i => (i.title||"").toLowerCase().includes(state.searchQuery.toLowerCase()));
    const start = (state.currentPage - 1) * 5; const pag = filtered.slice(start, start + 5);
    $("historyList").innerHTML = pag.map(item => `<div class="history-item ${state.currentHistoryId == item.id ? 'active-history' : ''}" onclick="restore(${item.id})"><img src="data:image/jpeg;base64,${item.image}" class="history-img"><div style="flex:1"><h4>${item.title || "Sans titre"}</h4></div><button onclick="event.stopPropagation(); deleteItem(${item.id})">🗑</button></div>`).join("");
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
    state.currentHistoryId = id; state.selectedHeadlines = item.headlines ? JSON.parse(item.headlines) : []; state.selectedAds = item.ad_copys ? JSON.parse(item.ad_copys) : [];
    $("titleText").textContent = item.title; $("descText").textContent = item.description; $("productUrlInput").value = item.product_url || "";
    $("previewImg").src = `data:image/jpeg;base64,${item.image}`; state.imageBase64 = item.image; $("preview").classList.remove("hidden");
    $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false; renderHistoryUI(); window.scrollTo({top:0, behavior:'smooth'});
  };

  window.deleteItem = async (id) => { if(!confirm("Supprimer ?")) return; await fetch(`/api/history?id=${id}`, { method: "DELETE" }); if(state.currentHistoryId == id) state.currentHistoryId = null; loadHistory(); };

  init();
})();
