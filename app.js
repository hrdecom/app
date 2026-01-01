(() => {
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    collections: [
      { name: "Initial", meaning: "Jewelry featuring 26 letter variants. Titles must contain 'Initial'." },
      { name: "Angel", meaning: "Jewelry with angelic shapes (wings, feathers)." }
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
    sessionHeadlines: [], sessionAds: [],
    hlPage: 1, adPage: 1, hlPageSize: 12, adPageSize: 12,
    selHlStyles: [], selAdStyles: []
  };

  function startLoading() {
    let s = 0; $("timer").textContent = "00:00";
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
    if (saved) {
        state.config = JSON.parse(saved.value);
        // SECURITE : Initialiser les tableaux s'ils manquent dans l'ancienne config
        if (!state.config.headlineStyles) state.config.headlineStyles = [...DEFAULTS.headlineStyles];
        if (!state.config.adStyles) state.config.adStyles = [...DEFAULTS.adStyles];
    }
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
        <input type="text" value="${c.name}" onchange="updateCol(${i}, 'name', this.value)" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:5px;">
        <textarea onchange="updateCol(${i}, 'meaning', this.value)" style="flex:2; height:45px; border-radius:8px; border:1px solid #ddd; padding:5px; font-size:12px;">${c.meaning}</textarea>
        <button onclick="removeCol(${i})" style="color:red; border:none; background:none; cursor:pointer;">×</button>
      </div>`).join("");

    $("styleButtonsEditor").innerHTML = (state.config.headlineStyles || []).map((s, i) => `
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" value="${s.name}" onchange="updateStyleBtn(${i}, 'name', this.value)" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:5px;">
        <textarea onchange="updateStyleBtn(${i}, 'prompt', this.value)" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:5px; font-size:12px;">${s.prompt}</textarea>
        <button onclick="removeStyleBtn(${i})" style="color:red; border:none; background:none; cursor:pointer;">×</button>
      </div>`).join("");

    $("adStyleButtonsEditor").innerHTML = (state.config.adStyles || []).map((s, i) => `
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" value="${s.name}" onchange="updateAdStyleBtn(${i}, 'name', this.value)" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:5px;">
        <textarea onchange="updateAdStyleBtn(${i}, 'prompt', this.value)" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:5px; font-size:12px;">${s.prompt}</textarea>
        <button onclick="removeAdStyleBtn(${i})" style="color:red; border:none; background:none; cursor:pointer;">×</button>
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
  // LE BOUTON FIXÉ ICI :
  $("addAdStyleBtn").onclick = () => { 
    if(!state.config.adStyles) state.config.adStyles = [];
    state.config.adStyles.push({name:"", prompt:""}); 
    renderConfigUI(); 
  };

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
      const historyNames = state.historyCache.map(h => h.product_name);
      const commonBody = { 
          image: state.imageBase64, media_type: state.imageMime,
          collection: $("collectionSelect").value, config: state.config,
          historyNames, currentTitle: $("titleText").textContent, currentDesc: $("descText").textContent,
          product_url: $("productUrlInput").value 
      };

      if (action === 'ad_copys' && state.selAdStyles.length > 0) {
        const promises = state.selAdStyles.map(styleName => {
           const stylePrompt = state.config.adStyles.find(s => s.name === styleName)?.prompt;
           return fetch("/api/generate", { method: "POST", body: JSON.stringify({ ...commonBody, action, style: stylePrompt + " " + (extra.userText || ""), styleLabel: styleName }) }).then(r => r.json().then(data => ({ ...data, label: styleName })));
        });
        const results = await Promise.all(promises);
        results.forEach(res => {
            const newItems = (res.ad_copys || []).map(text => ({ text, style: res.label }));
            state.sessionAds = [...newItems, ...state.sessionAds];
        });
        state.adPage = 1; renderAds();
      } 
      else if (action === 'headlines' && state.selHlStyles.length > 0) {
        const promises = state.selHlStyles.map(styleName => {
           const stylePrompt = state.config.headlineStyles.find(s => s.name === styleName)?.prompt;
           return fetch("/api/generate", { method: "POST", body: JSON.stringify({ ...commonBody, action, style: stylePrompt + " " + (extra.userText || ""), styleLabel: styleName }) }).then(r => r.json().then(data => ({ ...data, label: styleName })));
        });
        const results = await Promise.all(promises);
        results.forEach(res => {
            const newItems = (res.headlines || []).map(text => ({ text, style: res.label }));
            state.sessionHeadlines = [...newItems, ...state.sessionHeadlines];
        });
        state.hlPage = 1; renderHeadlines();
      }
      else {
        const res = await fetch("/api/generate", { method: "POST", body: JSON.stringify({ ...commonBody, action, ...extra }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "IA Error");

        if (action === 'generate') {
          $("titleText").textContent = data.title; $("descText").textContent = data.description;
          const hRes = await fetch("/api/history", { method: "POST", body: JSON.stringify({ title: data.title, description: data.description, image: state.imageBase64, product_name: data.product_name, product_url: $("productUrlInput").value }) });
          const hData = await hRes.json();
          state.currentHistoryId = hData.id;
          state.sessionHeadlines = []; state.sessionAds = []; await loadHistory();
        } else if (action === 'regen_title' || action === 'regen_desc') {
          if (action === 'regen_title') $("titleText").textContent = data.title
