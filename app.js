(() => {
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    collections: [{ name: "Initial", meaning: "Letter jewelry." }],
    promptSystem: "Senior luxury jewelry copywriter.",
    promptTitles: "TITLE: Adjustable {Collection} Ring \"{Name}\". NO hyphens.",
    promptDesc: "DESCRIPTION: 2 paras, <=180 chars. Tone: Luxury.",
    promptHeadlines: "Viral TikTok hooks expert.",
    promptAdCopys: "Facebook Ads expert. Structure: Hook, Bullets, CTA+URL.",
    headlineStyles: [{ name: "POV", prompt: "POV perspective." }],
    adStyles: [{ name: "Cadeau", prompt: "Gifting emotion." }]
  };

  const LANGUAGES = { 
    "Danish": "dn.", "Dutch": "du.", "German": "de.", "Italian": "it.", 
    "Polish": "pl.", "Portuguese (Brazil)": "pt-br.", "Portuguese (Portugal)": "pt.", "Spanish": "es." 
  };

  let state = {
    imageBase64: null, imageMime: "image/jpeg", historyCache: [],
    config: JSON.parse(JSON.stringify(DEFAULTS)),
    currentPage: 1, pageSize: 5, searchQuery: "", currentHistoryId: null,
    timerInterval: null, sessionHeadlines: [], sessionAds: [],
    selectedHeadlines: [], selectedAds: [],
    headlinesTrans: {}, adsTrans: {},
    selHlStyles: [], selAdStyles: [],
    hlPage: 1, adPage: 1
  };

  const startLoading = () => {
    let s = 0; $("timer").textContent = "00:00";
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => { s++; const mm = String(Math.floor(s/60)).padStart(2,"0"); const ss = String(s%60).padStart(2,"0"); $("timer").textContent = `${mm}:${ss}`; }, 1000);
    $("loading").classList.remove("hidden");
  };
  const stopLoading = () => { clearInterval(state.timerInterval); $("loading").classList.add("hidden"); };

  const formatLangUrl = (url, sub = "en.") => {
    if (!url) return "";
    let cleanUrl = url.replace(/https:\/\/(en\.|dn\.|du\.|de\.|it\.|pl\.|pt-br\.|pt\.|es\.)/, "https://");
    return cleanUrl.replace("https://", `https://${sub}`);
  };

  async function loadConfig() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const saved = data.find(i => i.id === 'full_config');
    if (saved) state.config = JSON.parse(saved.value);
    renderConfigUI();
  }

  function renderConfigUI() {
    ["promptSystem", "promptTitles", "promptDesc", "promptHeadlines", "promptAdCopys"].forEach(id => { if($(id)) $(id).value = state.config[id] || DEFAULTS[id]; });
    if($("configBlacklist")) $("configBlacklist").value = state.config.blacklist || "";
    $("collectionsList").innerHTML = (state.config.collections || []).map((c, i) => `<div class="config-row collections-item" style="display:flex; gap:10px; margin-bottom:10px;"><input type="text" value="${c.name}" class="col-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="col-meaning" style="flex:2; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${c.meaning}</textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none;">×</button></div>`).join("");
    $("styleButtonsEditor").innerHTML = (state.config.headlineStyles || []).map((s, i) => `<div class="config-row headline-style-item" style="display:flex; gap:10px; margin-bottom:10px;"><input type="text" value="${s.name}" class="style-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="style-prompt" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${s.prompt}</textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none;">×</button></div>`).join("");
    $("adStyleButtonsEditor").innerHTML = (state.config.adStyles || []).map((s, i) => `<div class="config-row ad-style-item" style="display:flex; gap:10px; margin-bottom:10px;"><input type="text" value="${s.name}" class="ad-style-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="ad-style-prompt" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${s.prompt}</textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none;">×</button></div>`).join("");
    $("collectionSelect").innerHTML = (state.config.collections || []).map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    renderStyleSelectors();
  }

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
      const productUrl = formatLangUrl($("productUrlInput").value, "en.");
      const common = { image: state.imageBase64, media_type: state.imageMime, collection: $("collectionSelect").value, config: state.config, historyNames: state.historyCache.map(h => h.product_name), currentTitle: $("titleText").textContent, currentDesc: $("descText").textContent, product_url: productUrl };
      
      if (action === 'ad_copys' && state.selAdStyles.length > 0) {
        const results = await Promise.all(state.selAdStyles.map(sName => {
          const sPrompt = state.config.adStyles.find(x => x.name === sName)?.prompt;
          return fetch("/api/generate", { method: "POST", body: JSON.stringify({ ...common, action, style: sPrompt + " " + (extra.userText || ""), styleLabel: sName }) }).then(r => r.json().then(d => ({ ...d, label: sName })));
        }));
        results.forEach(res => { state.sessionAds = [...(res.ad_copys || []).map(t => ({ text: t, style: res.label })), ...state.sessionAds]; });
        state.adPage = 1; renderAds();
      } else {
        if (action === 'headlines' && state.selHlStyles.length > 0) extra.style = state.selHlStyles.map(n => state.config.headlineStyles.find(s => s.name === n)?.prompt).join(" ") + " " + (extra.userText || "");
        const res = await fetch("/api/generate", { method: "POST", body: JSON.stringify({ ...common, action, ...extra }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erreur IA");

        if (action === 'generate') {
          $("titleText").textContent = data.title; $("descText").textContent = data.description;
          const hRes = await fetch("/api/history", { method: "POST", body: JSON.stringify({ title: data.title, description: data.description, image: state.imageBase64, product_name: data.product_name, product_url: productUrl }) });
          const hData = await hRes.json();
          state.currentHistoryId = hData.id;
          state.sessionHeadlines = []; state.sessionAds = []; state.selectedHeadlines = []; state.selectedAds = []; state.headlinesTrans = {}; state.adsTrans = {}; 
          await loadHistory();
        } else if (action === 'regen_title' || action === 'regen_desc') {
          if (action === 'regen_title') $("titleText").textContent = data.title; else $("descText").textContent = data.description;
          if (state.currentHistoryId) await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, title: $("titleText").textContent, description: $("descText").textContent }) });
          await loadHistory();
        } else if (action.includes('headlines')) {
          state.sessionHeadlines = [...(data.headlines || []), ...state.sessionHeadlines];
          state.hlPage = 1; renderHeadlines();
        } else if (action.includes('ad_copys')) {
          state.sessionAds = [...(data.ad_copys || []).map(t => ({ text: t, style: action.includes('similar') ? 'Variante' : 'Chat' })), ...state.sessionAds];
          state.adPage = 1; renderAds();
        }
      }
      $("regenTitleBtn").disabled = $("regenDescBtn").disabled = false;
    } catch(e) { alert("Erreur: " + e.message); }
    finally { stopLoading(); }
  }

  const renderHeadlines = () => {
    const list = state.sessionHeadlines || [];
    const pag = list.slice((state.hlPage-1)*12, state.hlPage*12);
    $("headlinesResults").innerHTML = pag.map((text, i) => `<div class="headline-item" onclick="toggleItemSelect('hl', this)"><input type="checkbox"><span class="headline-text">${text}</span></div>`).join("");
    renderPaginationLoc('hl');
  };
  const renderAds = () => {
    const list = state.sessionAds || [];
    const pag = list.slice((state.adPage-1)*12, state.adPage*12);
    let html = "", lastStyle = "";
    pag.forEach((item, i) => {
      if (item.style !== lastStyle) { html += `<div style="margin: 10px 0 5px; font-size:11px; font-weight:bold; color:var(--apple-blue); border-bottom:1px solid #eee; padding-bottom:3px;">${item.style.toUpperCase()}</div>`; lastStyle = item.style; }
      html += `<div class="headline-item" onclick="toggleItemSelect('ad', this)"><input type="checkbox"><div class="headline-text" style="white-space:pre-wrap;">${item.text}</div></div>`;
    });
    $("adsResults").innerHTML = html;
    renderPaginationLoc('ad');
  };

  window.toggleItemSelect = (type, el) => {
    const cb = el.querySelector('input'); cb.checked = !cb.checked; el.classList.toggle('selected', cb.checked);
    const containerId = type === 'hl' ? 'headlinesResults' : 'adsResults';
    const hasSelected = document.querySelectorAll(`#${containerId} .headline-item.selected`).length > 0;
    if(type === 'hl') $("similarActions").classList.toggle('hidden', !hasSelected); else $("similarAdsActions").classList.toggle('hidden', !hasSelected);
  };

  function renderPaginationLoc(type) {
    const list = type === 'hl' ? state.sessionHeadlines : state.sessionAds;
    const container = type === 'hl' ? $("headlinesLocalPagination") : $("adsLocalPagination");
    const total = Math.ceil((list || []).length / 12); container.innerHTML = ""; if (total <= 1) return;
    for (let i = 1; i <= total; i++) {
      const b = document.createElement("button"); b.textContent = i; if (i === (type === 'hl' ? state.hlPage : state.adPage)) b.className = "active";
      b.onclick = () => { if(type === 'hl') state.hlPage = i; else state.adPage = i; type === 'hl' ? renderHeadlines() : renderAds(); }; container.appendChild(b);
    }
  }

  const toggleMenu = (id) => $(id).classList.toggle('show');

  function renderLangList(type, containerId) {
    $(containerId).innerHTML = `
      <div style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:11px; font-weight:bold;">SÉLECTION MULTIPLE</span>
        <button class="primary-btn" style="padding:4px 8px; font-size:10px;" onclick="window.runBatchTranslation('${type}')">Traduire</button>
      </div>
      <div style="max-height:300px; overflow-y:auto;">
        ${Object.keys(LANGUAGES).map(l => `
          <div class="lang-opt" style="display:flex; align-items:center; gap:10px;" onclick="event.stopPropagation();">
            <input type="checkbox" class="lang-cb-${type}" value="${l}" id="cb-${type}-${l}">
            <label for="cb-${type}-${l}" style="flex:1; cursor:pointer;">${l} (${LANGUAGES[l]})</label>
          </div>
        `).join("")}
      </div>`;
  }

  $("translateHlMenuBtn").onclick = (e) => { e.stopPropagation(); if (!state.selectedHeadlines.length) return alert("Enregistrez d'abord."); renderLangList("hl", "hlLangList"); toggleMenu("hlLangList"); };
  $("translateAdMenuBtn").onclick = (e) => { e.stopPropagation(); if (!state.selectedAds.length) return alert("Enregistrez d'abord."); renderLangList("ad", "adLangList"); toggleMenu("adLangList"); };

  window.runBatchTranslation = async (type) => {
    const selected = Array.from(document.querySelectorAll(`.lang-cb-${type}:checked`)).map(cb => cb.value);
    if (!selected.length) return alert("Sélectionnez au moins une langue.");
    document.querySelectorAll('.dropdown-content').forEach(d => d.classList.remove('show'));
    startLoading();
    try {
      for (const lang of selected) { await processTranslation(type, lang, false); }
      alert("Traductions terminées !"); renderTranslationTabs(type);
    } catch(e) { alert("Erreur: " + e.message); } finally { stopLoading(); }
  };

  window.processTranslation = async (type, lang, singleCall = true) => {
    const itemsToTranslate = type === 'hl' ? state.selectedHeadlines : state.selectedAds;
    if (!(itemsToTranslate || []).length) return;
    const targetUrl = formatLangUrl($("productUrlInput").value, LANGUAGES[lang]);

    if (singleCall) startLoading();
    let infoToTranslate = (type === 'ad') ? { title1: $("titleText").textContent, title2: $("titleText").textContent + " - Special Offer", title3: "Gift Idea - " + $("titleText").textContent, title4: $("titleText").textContent + " - Valentine's Day Gift Idea", sub: "Free Shipping Worldwide Today" } : null;

    try {
      const res = await fetch("/api/generate", { 
        method: "POST", 
        body: JSON.stringify({ 
          action: "translate", itemsToTranslate, infoToTranslate, targetLang: lang, config: state.config, 
          image: state.imageBase64, media_type: state.imageMime, collection: $("collectionSelect").value, 
          product_url: targetUrl 
        }) 
      });
      const data = await res.json();
      if (type === 'hl') { state.headlinesTrans[lang] = { items: data.translated_items }; } 
      else { state.adsTrans[lang] = { items: data.translated_items, info: data.translated_info }; }

      const payload = { id: state.currentHistoryId, [type==='hl'?'headlines_trans':'ads_trans']: JSON.stringify(type==='hl' ? state.headlinesTrans : state.adsTrans) };
      await fetch("/api/history", { method: "PATCH", body: JSON.stringify(payload) });
      const histItem = state.historyCache.find(h => h.id === state.currentHistoryId);
      if (histItem) histItem[type==='hl'?'headlines_trans':'ads_trans'] = payload[type==='hl'?'headlines_trans':'ads_trans'];

      if (singleCall) { renderTranslationTabs(type); const tabBtn = document.querySelector(`button[data-tab="tab-${type}-${lang.replace(/\s/g,'')}"]`); if(tabBtn) tabBtn.click(); }
    } catch(e) { if (singleCall) alert("Erreur Trad: " + e.message); else throw e; } 
    finally { if (singleCall) stopLoading(); }
  };

  // --- SUPPRESSION AUTO ONGLETS VIDES ---
  function renderTranslationTabs(type) {
    const tabs = type === 'hl' ? $("headlinesTabs") : $("adsTabs");
    const container = type === 'hl' ? $("headlinesTabContainer") : $("adsTabContainer");
    let transData = type === 'hl' ? state.headlinesTrans : state.adsTrans;

    let hasChanges = false;
    Object.keys(transData).forEach(lang => {
      if (!transData[lang].items || transData[lang].items.length === 0) {
        delete transData[lang];
        hasChanges = true;
      }
    });

    if (hasChanges) {
        const payload = { id: state.currentHistoryId, [type==='hl'?'headlines_trans':'ads_trans']: JSON.stringify(transData) };
        fetch("/api/history", { method: "PATCH", body: JSON.stringify(payload) });
    }

    tabs.querySelectorAll(".lang-tab").forEach(t => t.remove());
    container.querySelectorAll(".lang-tab-content").forEach(c => c.remove());

    Object.keys(transData || {}).forEach(lang => {
      const tabId = `tab-${type}-${lang.replace(/\s/g,'')}`;
      const btn = document.createElement("button"); btn.className = "tab-link lang-tab"; btn.textContent = lang; btn.dataset.tab = tabId; btn.onclick = (e) => switchTab(e); tabs.appendChild(btn);
      const content = document.createElement("div"); content.id = tabId; content.className = "tab-content hidden lang-tab-content";
      
      let html = `<div class="headlines-results">` + (transData[lang].items || []).map(t => `<div class="headline-item no-hover"><span class="headline-text" style="white-space:pre-wrap;">${t}</span><button class="icon-btn-small" onclick="window.copyToClip(\`${t.replace(/\n/g,"\\n").replace(/'/g,"\\'")}\`)">📋</button></div>`).join("") + `</div>`;

      if (type === 'ad' && transData[lang].info) {
          const info = transData[lang].info; 
          const langUrl = formatLangUrl($("productUrlInput").value, LANGUAGES[lang]);
          html += `<div class="ads-info-block">` + [`TITRE 1|${info.title1}`, `TITRE 2|${info.title2}`, `TITRE 3|${info.title3}`, `TITRE 4|${info.title4}`, `SUB|${info.sub}`, `URL|${langUrl}`].map(x => `<div class="ads-info-row"><span><span class="ads-info-label">${x.split('|')[0]}</span>${x.split('|')[1]}</span><button class="icon-btn-small" onclick="window.copyToClip(\`${x.split('|')[1].replace(/'/g,"\\'")}\`)">📋</button></div>`).join("") + `</div>`;
      }
      content.innerHTML = html; container.appendChild(content);
    });
  }

  function switchTab(e) {
    const m = e.target.closest('.modal-content');
    m.querySelectorAll(".tab-link").forEach(b => b.classList.remove("active"));
    m.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
    e.target.classList.add("active"); $(e.target.dataset.tab).classList.remove("hidden");
  }

  window.saveSelections = async (type) => {
    if (!state.currentHistoryId) return;
    const containerId = type === 'hl' ? 'headlinesResults' : 'adsResults';
    const items = document.querySelectorAll(`#${containerId} .headline-item.selected .headline-text`);
    const sel = Array.from(items).map(it => it.innerText.trim());
    if (sel.length === 0) return alert("Sélectionnez des éléments.");
    if (type === 'hl') { state.selectedHeadlines = [...new Set([...(state.selectedHeadlines || []), ...sel])]; } 
    else { state.selectedAds = [...new Set([...(state.selectedAds || []), ...sel])]; }
    startLoading();
    try {
      const val = JSON.stringify(type === 'hl' ? state.selectedHeadlines : state.selectedAds);
      await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, [type==='hl'?'headlines':'ad_copys']: val }) });
      const histItem = state.historyCache.find(h => h.id === state.currentHistoryId);
      if (histItem) histItem[type==='hl'?'headlines':'ad_copys'] = val;
      type === 'hl' ? renderSavedHl() : renderSavedAds();
      alert("Enregistré");
    } catch(e) { alert(e.message); } finally { stopLoading(); }
  };

  // --- ÉDITION MANUELLE AVEC CRAYON ---
  window.editSavedItem = (index, type) => {
      const selector = type === 'hl' ? `#hl-text-${index}` : `#ad-text-${index}`;
      const el = document.querySelector(selector);
      el.contentEditable = true; el.classList.add('editing-field'); el.focus();
      
      el.onblur = async () => {
          el.contentEditable = false; el.classList.remove('editing-field');
          const newText = el.innerText.trim();
          if (type === 'hl') state.selectedHeadlines[index] = newText;
          else state.selectedAds[index] = newText;

          const val = JSON.stringify(type === 'hl' ? state.selectedHeadlines : state.selectedAds);
          await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, [type==='hl'?'headlines':'ad_copys']: val }) });
          
          // Mettre à jour le cache
          const histItem = state.historyCache.find(h => h.id === state.currentHistoryId);
          if (histItem) histItem[type==='hl'?'headlines':'ad_copys'] = val;
      };
  };

  const renderSavedHl = () => {
    const list = state.selectedHeadlines || [];
    $("headlinesSavedList").innerHTML = list.map((h, i) => `
      <div class="headline-item no-hover">
        <span class="headline-text" id="hl-text-${i}">${h}</span>
        <div style="display:flex;gap:5px;">
          <button class="icon-btn-small" onclick="window.editSavedItem(${i}, 'hl')">✏️</button>
          <button class="icon-btn-small" onclick="window.copyToClip(\`${h.replace(/'/g,"\\'")}\`)">📋</button>
          <button class="icon-btn-small" style="color:red" onclick="deleteSaved('hl',${i})">×</button>
        </div>
      </div>`).join("");
  };

  const renderSavedAds = () => {
    const list = state.selectedAds || [];
    $("adsSavedList").innerHTML = list.map((h, i) => `
      <div class="headline-item no-hover" style="flex-direction:column;align-items:flex-start;">
        <div style="display:flex;justify-content:space-between;width:100%">
          <strong style="font-size:10px;color:var(--apple-blue)">PRIMARY ${i+1}</strong>
          <div style="display:flex;gap:5px;">
            <button class="icon-btn-small" onclick="window.editSavedItem(${i}, 'ad')">✏️</button>
            <button class="icon-btn-small" onclick="window.copyToClip(\`${h.replace(/\n/g,"\\n").replace(/'/g,"\\'")}\`)">📋</button>
            <button class="icon-btn-small" style="color:red" onclick="deleteSaved('ad',${i})">×</button>
          </div>
        </div>
        <span class="headline-text" id="ad-text-${i}" style="white-space:pre-wrap;">${h}</span>
      </div>`).join("");
    const n = $("titleText").textContent;
    const u = formatLangUrl($("productUrlInput").value, "en.");
    $("adsDefaultInfoBlock").innerHTML = [`TITRE 1|${n}`, `TITRE 2|${n} - Special Offer`, `TITRE 3|Gift Idea - ${n}`, `TITRE 4|${n} - Valentine's Day Gift Idea`, `SUB|Free Shipping Worldwide Today`, `URL|${u}`].map(x => `<div class="ads-info-row"><span><span class="ads-info-label">${x.split('|')[0]}</span>${x.split('|')[1]}</span><button class="icon-btn-small" onclick="window.copyToClip(\`${x.split('|')[1].replace(/'/g,"\\'")}\`)">📋</button></div>`).join("");
  };

  window.deleteSaved = async (type, i) => {
    if(!confirm("Supprimer ?")) return;
    let list = type === 'hl' ? state.selectedHeadlines : state.selectedAds;
    let trans = type === 'hl' ? state.headlinesTrans : state.adsTrans;
    if (!list) return;
    list.splice(i, 1);
    Object.keys(trans || {}).forEach(lang => { if (trans[lang].items && trans[lang].items[i] !== undefined) trans[lang].items.splice(i, 1); });
    startLoading();
    try {
      const payload = { id: state.currentHistoryId, [type==='hl'?'headlines':'ad_copys']: JSON.stringify(list), [type==='hl'?'headlines_trans':'ads_trans']: JSON.stringify(trans) };
      await fetch("/api/history", { method: "PATCH", body: JSON.stringify(payload) });
      const histItem = state.historyCache.find(h => h.id === state.currentHistoryId);
      if (histItem) { histItem[type === 'hl' ? 'headlines' : 'ad_copys'] = payload[type === 'hl' ? 'headlines' : 'ad_copys']; histItem[type === 'hl' ? 'headlines_trans' : 'ads_trans'] = payload[type === 'hl' ? 'headlines_trans' : 'ads_trans']; }
      if (type === 'hl') { state.selectedHeadlines = list; renderSavedHl(); } else { state.selectedAds = list; renderSavedAds(); }
      renderTranslationTabs(type);
    } catch(e) { alert("Erreur suppression: " + e.message); } finally { stopLoading(); }
  };

  function init() {
    $("loading").classList.add("hidden");
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
    $("openHeadlinesBtn").onclick = () => { if(!state.currentHistoryId) return; $("headlinesModal").classList.remove("hidden"); renderSavedHl(); renderTranslationTabs('hl'); };
    $("openAdsBtn").onclick = () => { if(!state.currentHistoryId) return; $("adsModal").classList.remove("hidden"); renderSavedAds(); renderTranslationTabs('ad'); };
    $("closeHeadlines").onclick = () => $("headlinesModal").classList.add("hidden");
    $("closeAds").onclick = () => $("adsModal").classList.add("hidden");
    window.onclick = (e) => { if (e.target.classList.contains('modal')) e.target.classList.add("hidden"); document.querySelectorAll('.dropdown-content').forEach(d => d.classList.remove('show')); };
    document.querySelectorAll(".tab-link").forEach(btn => btn.onclick = (e) => switchTab(e));
    $("sendHeadlineChat").onclick = () => apiCall('headlines', { userText: $("headlineStyleInput").value });
    $("sendAdChat").onclick = () => apiCall('ad_copys', { userText: $("adStyleInput").value });
    $("genSimilarBtn").onclick = () => { const sel = Array.from(document.querySelectorAll('#headlinesResults .selected .headline-text')).map(it => it.innerText); apiCall('headlines_similar', { selectedForSimilar: sel }); };
    $("genSimilarAdsBtn").onclick = () => { const sel = Array.from(document.querySelectorAll('#adsResults .selected .headline-text')).map(it => it.innerText.split('\n').pop()); apiCall('ad_copys_similar', { selectedForSimilar: sel }); };
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
        $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false; state.currentHistoryId = null;
      }; r.readAsDataURL(f);
    };
    $("removeImage").onclick = (e) => { e.stopPropagation(); state.imageBase64 = null; state.currentHistoryId = null; $("preview").classList.add("hidden"); $("dropPlaceholder").style.display = "block"; $("generateBtn").disabled = true; };
    $("historySearch").oninput = (e) => { state.searchQuery = e.target.value; state.currentPage = 1; renderHistoryUI(); };
    loadConfig(); loadHistory();
  }

  async function loadHistory() { try { const r = await fetch("/api/history"); state.historyCache = await r.json(); renderHistoryUI(); } catch(e){} }
  function renderHistoryUI() {
    const filtered = (state.historyCache || []).filter(i => (i.title||"").toLowerCase().includes(state.searchQuery.toLowerCase()));
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
    const item = (state.historyCache || []).find(i => i.id === id); if(!item) return;
    state.currentHistoryId = id; state.sessionHeadlines = []; state.sessionAds = [];
    state.selectedHeadlines = item.headlines ? JSON.parse(item.headlines) : []; state.selectedAds = item.ad_copys ? JSON.parse(item.ad_copys) : [];
    state.headlinesTrans = item.headlines_trans ? JSON.parse(item.headlines_trans) : {}; state.adsTrans = item.ads_trans ? JSON.parse(item.ads_trans) : {};
    $("titleText").textContent = item.title; $("descText").textContent = item.description; $("productUrlInput").value = item.product_url || "";
    $("previewImg").src = `data:image/jpeg;base64,${item.image}`; state.imageBase64 = item.image; $("preview").classList.remove("hidden");
    $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false; renderHistoryUI();
  };

  window.deleteItem = async (id) => { if(!confirm("Supprimer ?")) return; await fetch(`/api/history?id=${id}`, { method: "DELETE" }); if(state.currentHistoryId == id) state.currentHistoryId = null; loadHistory(); };
  window.copyToClip = (t) => { navigator.clipboard.writeText(t); alert("Copié !"); };

  init();
})();
