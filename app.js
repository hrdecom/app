(() => {
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    collections: [{ name: "Initial", meaning: "Letter jewelry." }],
    promptSystem: "Senior luxury jewelry copywriter.",
    promptTitles: "TITLE: Adjustable {Collection} Ring \"{Name}\". NO hyphens.",
    promptDesc: "DESCRIPTION: 2 paras, <=180 chars. Tone: Luxury.",
    promptHeadlines: "Viral TikTok hooks expert.",
    promptAdCopys: "Facebook Ads expert. Structure: Hook, Bullets, CTA+URL.",
    promptTranslate: "Professional luxury translator. TASK: Translate into {targetLang}. URL: {product_url}",
    headlineStyles: [{ name: "POV", prompt: "POV perspective." }],
    adStyles: [{ name: "Cadeau", prompt: "Gifting emotion." }]
  };

  const LANGUAGES = { "Danish": "dn.", "Dutch": "du.", "German": "de.", "Italian": "it.", "Polish": "pl.", "Portuguese (Brazil)": "pt-br.", "Portuguese (Portugal)": "pt.", "Spanish": "es." };

  let state = {
    imageBase64: null, imageMime: "image/jpeg", historyCache: [],
    config: JSON.parse(JSON.stringify(DEFAULTS)),
    currentPage: 1, pageSize: 5, searchQuery: "", currentHistoryId: null,
    timerInterval: null, sessionHeadlines: [], sessionAds: [],
    selectedHeadlines: [], selectedAds: [],
    headlinesTrans: {}, adsTrans: {},
    selHlStyles: [], selAdStyles: [],
    hlPage: 1, adPage: 1,
    generatedImages: [] // Carousel d'images générées
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

  // --- GESTION GEMINI (IMAGEN 3) ---
  window.openGeminiModal = () => {
    if (!state.imageBase64) return alert("Uploadez une image d'abord.");
    $("geminiModal").classList.remove("hidden");
  };

  window.generateGeminiImage = async () => {
    const prompt = $("geminiPrompt").value;
    if (!prompt) return alert("Entrez une consigne.");
    startLoading();
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        body: JSON.stringify({
          image: state.imageBase64,
          prompt: prompt,
          aspectRatio: $("geminiAspect").value
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      $("geminiPreview").innerHTML = `<img src="data:image/jpeg;base64,${data.image}" id="tempGenImage" style="max-width:100%; border-radius:12px;"/>`;
      $("saveGeminiBtn").classList.remove("hidden");
    } catch (e) { alert("Erreur: " + e.message); }
    finally { stopLoading(); }
  };

  window.saveGeneratedImage = async () => {
    const imgData = $("tempGenImage").src.split(",")[1];
    state.generatedImages.push(imgData);
    if (state.currentHistoryId) {
      await fetch("/api/history", {
        method: "PATCH",
        body: JSON.stringify({ id: state.currentHistoryId, generated_images: JSON.stringify(state.generatedImages) })
      });
    }
    renderImageCarousel();
    $("geminiModal").classList.add("hidden");
  };

  const renderImageCarousel = () => {
    const container = $("imageCarousel");
    // L'image d'origine est toujours en position 0
    const allImgs = [state.imageBase64, ...state.generatedImages];
    container.innerHTML = allImgs.map((img, i) => `
      <div class="carousel-item" onclick="window.selectCarouselImg('${img}', this)">
        <img src="data:image/jpeg;base64,${img}" />
        ${i > 0 ? `<button class="del-img" onclick="event.stopPropagation(); window.deleteGenImage(${i-1})">×</button>` : ''}
      </div>
    `).join("");
  };

  window.selectCarouselImg = (base64, el) => {
    state.imageBase64 = base64;
    $("previewImg").src = `data:image/jpeg;base64,${base64}`;
    document.querySelectorAll('.carousel-item').forEach(item => item.classList.remove('active-thumb'));
    el.classList.add('active-thumb');
  };

  window.deleteGenImage = async (idx) => {
    if (!confirm("Supprimer cette image générée ?")) return;
    state.generatedImages.splice(idx, 1);
    if (state.currentHistoryId) {
      await fetch("/api/history", {
        method: "PATCH",
        body: JSON.stringify({ id: state.currentHistoryId, generated_images: JSON.stringify(state.generatedImages) })
      });
    }
    renderImageCarousel();
  };

  // --- LOGIQUE COPYWRITING ---
  async function apiCall(action, extra = {}) {
    if (!state.imageBase64) return;
    startLoading();
    try {
      const productUrl = formatLangUrl($("productUrlInput").value, "en.");
      const common = { image: state.imageBase64, media_type: state.imageMime, collection: $("collectionSelect").value, config: state.config, historyNames: state.historyCache.map(h => h.product_name), currentTitle: $("titleText").textContent, currentDesc: $("descText").textContent, product_url: productUrl };
      
      const res = await fetch("/api/generate", { method: "POST", body: JSON.stringify({ ...common, action, ...extra }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur serveur");

      if (action === 'generate') {
        $("titleText").textContent = data.title; $("descText").textContent = data.description;
        const hRes = await fetch("/api/history", { method: "POST", body: JSON.stringify({ title: data.title, description: data.description, image: state.imageBase64, product_name: data.product_name, product_url: productUrl }) });
        const hData = await hRes.json();
        state.currentHistoryId = hData.id;
        state.sessionHeadlines = []; state.sessionAds = []; state.selectedHeadlines = []; state.selectedAds = []; state.headlinesTrans = {}; state.adsTrans = {}; state.generatedImages = [];
        renderImageCarousel(); await loadHistory();
      } else if (action.includes('headlines')) {
        state.sessionHeadlines = [...(data.headlines || []), ...state.sessionHeadlines]; renderHeadlines();
      } else if (action.includes('ad_copys')) {
        state.sessionAds = [...(data.ad_copys || []).map(t => ({ text: t, style: 'Style' })), ...state.sessionAds]; renderAds();
      }
    } catch(e) { alert(e.message); } finally { stopLoading(); }
  }

  // --- TRADUCTION GROUPÉE ---
  window.runBatchTranslation = async (type) => {
    const selected = Array.from(document.querySelectorAll(`.lang-cb-${type}:checked`)).map(cb => cb.value);
    if (!selected.length) return alert("Sélectionnez au moins une langue.");
    document.querySelectorAll('.dropdown-content').forEach(d => d.classList.remove('show'));
    startLoading();
    try {
      for (const lang of selected) { await window.processTranslation(type, lang, false); }
      alert("Traductions terminées !"); renderTranslationTabs(type);
    } catch(e) { alert(e.message); } finally { stopLoading(); }
  };

  window.processTranslation = async (type, lang, singleCall = true) => {
    const itemsToTranslate = type === 'hl' ? state.selectedHeadlines : state.selectedAds;
    const targetUrl = formatLangUrl($("productUrlInput").value, LANGUAGES[lang]);
    if (singleCall) startLoading();
    try {
      const res = await fetch("/api/generate", { method: "POST", body: JSON.stringify({ action: "translate", itemsToTranslate, targetLang: lang, config: state.config, image: state.imageBase64, product_url: targetUrl }) });
      const data = await res.json();
      if (type === 'hl') state.headlinesTrans[lang] = { items: data.translated_items };
      else state.adsTrans[lang] = { items: data.translated_items, info: data.translated_info };
      
      const payload = { id: state.currentHistoryId, [type==='hl'?'headlines_trans':'ads_trans']: JSON.stringify(type==='hl' ? state.headlinesTrans : state.adsTrans) };
      await fetch("/api/history", { method: "PATCH", body: JSON.stringify(payload) });
      const histItem = state.historyCache.find(h => h.id === state.currentHistoryId);
      if (histItem) histItem[type==='hl'?'headlines_trans':'ads_trans'] = payload[type==='hl'?'headlines_trans':'ads_trans'];

      if (singleCall) renderTranslationTabs(type);
    } catch(e) { if (singleCall) alert(e.message); } finally { if (singleCall) stopLoading(); }
  };

  // --- ÉDITION AU CRAYON ---
  window.editSavedItem = (index, type) => {
    const el = document.querySelector(type === 'hl' ? `#hl-text-${index}` : `#ad-text-${index}`);
    el.contentEditable = true; el.classList.add('editing-field'); el.focus();
    el.onblur = async () => {
      el.contentEditable = false; el.classList.remove('editing-field');
      const newText = el.innerText.trim();
      if (type === 'hl') state.selectedHeadlines[index] = newText; else state.selectedAds[index] = newText;
      const val = JSON.stringify(type === 'hl' ? state.selectedHeadlines : state.selectedAds);
      await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, [type==='hl'?'headlines':'ad_copys']: val }) });
    };
  };

  // --- RENDU UI ---
  const renderHeadlines = () => {
    const pag = (state.sessionHeadlines || []).slice((state.hlPage-1)*12, state.hlPage*12);
    $("headlinesResults").innerHTML = pag.map((text, i) => `<div class="headline-item" onclick="window.toggleItemSelect('hl', this)"><input type="checkbox"><span class="headline-text">${text}</span></div>`).join("");
  };

  const renderAds = () => {
    const pag = (state.sessionAds || []).slice((state.adPage-1)*12, state.adPage*12);
    $("adsResults").innerHTML = pag.map((item, i) => `<div class="headline-item" onclick="window.toggleItemSelect('ad', this)"><input type="checkbox"><div class="headline-text" style="white-space:pre-wrap;">${item.text}</div></div>`).join("");
  };

  function renderTranslationTabs(type) {
    const tabs = type === 'hl' ? $("headlinesTabs") : $("adsTabs");
    const container = type === 'hl' ? $("headlinesTabContainer") : $("adsTabContainer");
    let transData = type === 'hl' ? state.headlinesTrans : state.adsTrans;

    // Suppression auto des onglets vides
    Object.keys(transData).forEach(lang => {
      if (!transData[lang].items || transData[lang].items.length === 0) delete transData[lang];
    });

    tabs.querySelectorAll(".lang-tab").forEach(t => t.remove());
    container.querySelectorAll(".lang-tab-content").forEach(c => c.remove());

    Object.keys(transData).forEach(lang => {
      const tabId = `tab-${type}-${lang.replace(/\s/g,'')}`;
      const btn = document.createElement("button"); btn.className = "tab-link lang-tab"; btn.textContent = lang; btn.dataset.tab = tabId; btn.onclick = (e) => switchTab(e); tabs.appendChild(btn);
      const content = document.createElement("div"); content.id = tabId; content.className = "tab-content hidden lang-tab-content";
      content.innerHTML = `<div class="headlines-results">` + (transData[lang].items || []).map(t => `<div class="headline-item no-hover"><span class="headline-text">${t}</span></div>`).join("") + `</div>`;
      container.appendChild(content);
    });
  }

  function switchTab(e) {
    const m = e.target.closest('.modal-content');
    m.querySelectorAll(".tab-link").forEach(b => b.classList.remove("active"));
    m.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
    e.target.classList.add("active"); $(e.target.dataset.tab).classList.remove("hidden");
  }

  window.toggleItemSelect = (type, el) => {
    const cb = el.querySelector('input'); cb.checked = !cb.checked; el.classList.toggle('selected', cb.checked);
  };

  window.saveSelections = async (type) => {
    if (!state.currentHistoryId) return;
    const items = document.querySelectorAll(`#${type === 'hl' ? 'headlinesResults' : 'adsResults'} .selected .headline-text`);
    const sel = Array.from(items).map(it => it.innerText.trim());
    if (type === 'hl') state.selectedHeadlines = [...new Set([...state.selectedHeadlines, ...sel])];
    else state.selectedAds = [...new Set([...state.selectedAds, ...sel])];
    const val = JSON.stringify(type === 'hl' ? state.selectedHeadlines : state.selectedAds);
    await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, [type==='hl'?'headlines':'ad_copys']: val }) });
    type === 'hl' ? renderSavedHl() : renderSavedAds();
  };

  const renderSavedHl = () => {
    $("headlinesSavedList").innerHTML = (state.selectedHeadlines || []).map((h, i) => `<div class="headline-item no-hover"><span class="headline-text" id="hl-text-${i}">${h}</span><div style="display:flex; gap:5px;"><button class="icon-btn-small" onclick="window.editSavedItem(${i}, 'hl')">✏️</button><button class="icon-btn-small" style="color:red" onclick="window.deleteSaved('hl',${i})">×</button></div></div>`).join("");
  };

  const renderSavedAds = () => {
    $("adsSavedList").innerHTML = (state.selectedAds || []).map((h, i) => `<div class="headline-item no-hover"><span class="headline-text" id="ad-text-${i}">${h}</span><div style="display:flex; gap:5px;"><button class="icon-btn-small" onclick="window.editSavedItem(${i}, 'ad')">✏️</button><button class="icon-btn-small" style="color:red" onclick="window.deleteSaved('ad',${i})">×</button></div></div>`).join("");
  };

  window.deleteSaved = async (type, i) => {
    if(!confirm("Supprimer ?")) return;
    let list = type === 'hl' ? state.selectedHeadlines : state.selectedAds;
    list.splice(i, 1);
    await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, [type==='hl'?'headlines':'ad_copys']: JSON.stringify(list) }) });
    type === 'hl' ? renderSavedHl() : renderSavedAds(); renderTranslationTabs(type);
  };

  function init() {
    $("loading").classList.add("hidden");
    $("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
    $("closeSettings").onclick = () => $("settingsModal").classList.add("hidden");
    $("saveConfig").onclick = async () => {
      ["promptSystem", "promptTitles", "promptDesc", "promptHeadlines", "promptAdCopys", "promptTranslate"].forEach(id => state.config[id] = $(id).value);
      await fetch("/api/settings", { method: "POST", body: JSON.stringify({ id: 'full_config', value: JSON.stringify(state.config) }) });
      $("settingsModal").classList.add("hidden");
    };
    $("openHeadlinesBtn").onclick = () => { $("headlinesModal").classList.remove("hidden"); renderSavedHl(); renderTranslationTabs('hl'); };
    $("openAdsBtn").onclick = () => { $("adsModal").classList.remove("hidden"); renderSavedAds(); renderTranslationTabs('ad'); };
    $("generateBtn").onclick = () => apiCall('generate');
    $("openGeminiBtn").onclick = () => window.openGeminiModal();
    $("imageInput").onchange = (e) => {
      const f = e.target.files[0]; const r = new FileReader();
      r.onload = (ev) => { state.imageBase64 = ev.target.result.split(",")[1]; $("previewImg").src = ev.target.result; $("preview").classList.remove("hidden"); state.generatedImages = []; renderImageCarousel(); $("generateBtn").disabled = false; };
      r.readAsDataURL(f);
    };
    document.querySelectorAll(".tab-link").forEach(btn => btn.onclick = (e) => switchTab(e));
    loadConfig(); loadHistory();
  }

  async function loadHistory() { const r = await fetch("/api/history"); state.historyCache = await r.json(); renderHistoryUI(); }
  function renderHistoryUI() {
    $("historyList").innerHTML = (state.historyCache || []).slice(0, 5).map(item => `<div class="history-item" onclick="window.restore(${item.id})"><img src="data:image/jpeg;base64,${item.image}"><h4>${item.title}</h4></div>`).join("");
  }

  window.restore = (id) => {
    const item = state.historyCache.find(i => i.id === id); if(!item) return;
    state.currentHistoryId = id; state.imageBase64 = item.image;
    state.selectedHeadlines = item.headlines ? JSON.parse(item.headlines) : [];
    state.selectedAds = item.ad_copys ? JSON.parse(item.ad_copys) : [];
    state.headlinesTrans = item.headlines_trans ? JSON.parse(item.headlines_trans) : {};
    state.adsTrans = item.ads_trans ? JSON.parse(item.ads_trans) : {};
    state.generatedImages = item.generated_images ? JSON.parse(item.generated_images) : [];
    $("previewImg").src = `data:image/jpeg;base64,${item.image}`; $("preview").classList.remove("hidden"); renderImageCarousel();
  };

  init();
})();
