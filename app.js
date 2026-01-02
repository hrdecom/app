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
    adStyles: [{ name: "Cadeau", prompt: "Gifting emotion." }],
    imgStyles: [], // [{ name, category, prompt, refImage }]
    imgCategories: ["Packaging", "Ambiance", "Mannequin"] // Catégories par défaut
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
    hlPage: 1, adPage: 1,
    // ETATS IMAGES
    inputImages: [], 
    sessionGeneratedImages: [], 
    savedGeneratedImages: [], 
    selectedSessionImagesIdx: [],
    // ETATS UI STUDIO
    currentImgCategory: "Tout", 
    selectedImgStyles: [], // Array d'objets styles sélectionnés (MULTI-SELECT)
    // ETAT EDITION
    editingImgStyleIndex: null // Index du style en cours de modification (null si ajout)
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
    if (saved) {
      const parsed = JSON.parse(saved.value);
      state.config = { ...DEFAULTS, ...parsed }; // Merge
      if (!state.config.imgStyles) state.config.imgStyles = [];
      if (!state.config.imgCategories) state.config.imgCategories = DEFAULTS.imgCategories;
    }
    renderConfigUI();
  }

  function renderConfigUI() {
    ["promptSystem", "promptTitles", "promptDesc", "promptHeadlines", "promptAdCopys", "promptTranslate"].forEach(id => { 
      if($(id)) $(id).value = state.config[id] || DEFAULTS[id]; 
    });
    if($("configBlacklist")) $("configBlacklist").value = state.config.blacklist || "";
    $("collectionsList").innerHTML = (state.config.collections || []).map((c, i) => `<div class="config-row collections-item" style="display:flex; gap:10px; margin-bottom:10px;"><input type="text" value="${c.name}" class="col-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="col-meaning" style="flex:2; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${c.meaning}</textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none;">×</button></div>`).join("");
    $("styleButtonsEditor").innerHTML = (state.config.headlineStyles || []).map((s, i) => `<div class="config-row headline-style-item" style="display:flex; gap:10px; margin-bottom:10px;"><input type="text" value="${s.name}" class="style-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="style-prompt" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${s.prompt}</textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none;">×</button></div>`).join("");
    $("adStyleButtonsEditor").innerHTML = (state.config.adStyles || []).map((s, i) => `<div class="config-row ad-style-item" style="display:flex; gap:10px; margin-bottom:10px;"><input type="text" value="${s.name}" class="ad-style-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="ad-style-prompt" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${s.prompt}</textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none;">×</button></div>`).join("");
    
    // --- GESTION CATÉGORIES (SETTINGS) ---
    $("imgCategoriesList").innerHTML = (state.config.imgCategories || []).map((cat, i) => `
       <div class="style-tag" style="background:#eee; border:1px solid #ccc; padding:4px 10px; display:flex; gap:5px; align-items:center;">
          ${cat} <span onclick="window.removeImgCategory(${i})" style="cursor:pointer; color:red; font-weight:bold;">×</span>
       </div>
    `).join("");

    // Update Select pour création style
    const catSelect = $("newImgStyleCategory");
    const currentVal = catSelect.value;
    catSelect.innerHTML = `<option value="">Général</option>` + (state.config.imgCategories || []).map(c => `<option value="${c}">${c}</option>`).join("");
    if(currentVal) catSelect.value = currentVal;

    // --- LISTE STYLES (SETTINGS) ---
    $("imgStyleEditorList").innerHTML = (state.config.imgStyles || []).map((s, i) => `
        <div style="display:flex; gap:10px; margin-bottom:10px; align-items:flex-start; background:#fff; padding:10px; border-radius:8px; border:1px solid #eee;">
            <div style="width:50px; height:50px; background:#eee; border-radius:6px; overflow:hidden; flex-shrink:0;">
                ${s.refImage ? `<img src="data:image/jpeg;base64,${s.refImage}" style="width:100%; height:100%; object-fit:cover;">` : '<span style="display:flex;justify-content:center;align-items:center;height:100%;font-size:10px;">No Img</span>'}
            </div>
            <div style="flex:1;">
                <div style="display:flex; justify-content:space-between;">
                    <div style="font-weight:bold; font-size:12px;">${s.name}</div>
                    <div style="font-size:10px; background:#f0f0f0; padding:2px 6px; border-radius:4px;">${s.category || 'Général'}</div>
                </div>
                <div style="font-size:11px; color:#666; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:300px;">${s.prompt}</div>
            </div>
            <div style="display:flex; flex-direction:column; gap:5px;">
                <button onclick="window.editImgStyle(${i})" style="color:var(--apple-blue); border:none; background:none; font-size:14px;">✏️</button>
                <button onclick="window.removeImgStyle(${i})" style="color:red; border:none; background:none; font-size:14px;">×</button>
            </div>
        </div>
    `).join("");

    $("collectionSelect").innerHTML = (state.config.collections || []).map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    renderStyleSelectors();
    renderStudioCategories();
    renderImgStylesButtons();
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

  /* --- GESTION PARAMÈTRES IMAGES (CRUD & EDIT) --- */
  window.removeImgCategory = (i) => {
      state.config.imgCategories.splice(i, 1);
      renderConfigUI();
  };
  $("addImgCategoryBtn").onclick = () => {
      const val = $("newImgCategoryInput").value.trim();
      if(val && !state.config.imgCategories.includes(val)) {
          state.config.imgCategories.push(val);
          $("newImgCategoryInput").value = "";
          renderConfigUI();
      }
  };

  window.removeImgStyle = (i) => {
      if(!confirm("Supprimer ce style ?")) return;
      state.config.imgStyles.splice(i, 1);
      if(state.editingImgStyleIndex === i) window.cancelImgStyleEdit();
      renderConfigUI();
  };

  // NOUVEAU : Fonction pour éditer
  window.editImgStyle = (i) => {
      const style = state.config.imgStyles[i];
      if(!style) return;
      
      state.editingImgStyleIndex = i;
      
      // Remplir le formulaire
      $("newImgStyleName").value = style.name;
      $("newImgStyleCategory").value = style.category || "";
      $("newImgStylePrompt").value = style.prompt;
      $("newImgStyleFile").value = ""; // Reset input file
      
      // UI Mode Edition
      $("imgStyleFormTitle").textContent = "MODIFIER LE STYLE";
      $("addImgStyleBtn").textContent = "Mettre à jour le Style";
      $("cancelImgStyleEditBtn").classList.remove("hidden");
      
      if(style.refImage) $("currentRefImgPreview").classList.remove("hidden");
      else $("currentRefImgPreview").classList.add("hidden");
      
      // Scroll vers le formulaire
      $("imgStyleEditorForm").scrollIntoView({ behavior: 'smooth' });
  };

  window.cancelImgStyleEdit = () => {
      state.editingImgStyleIndex = null;
      $("newImgStyleName").value = "";
      $("newImgStyleCategory").value = "";
      $("newImgStylePrompt").value = "";
      $("newImgStyleFile").value = "";
      
      $("imgStyleFormTitle").textContent = "AJOUTER UN STYLE";
      $("addImgStyleBtn").textContent = "+ Enregistrer le Style";
      $("cancelImgStyleEditBtn").classList.add("hidden");
      $("currentRefImgPreview").classList.add("hidden");
  };
  $("cancelImgStyleEditBtn").onclick = window.cancelImgStyleEdit;

  // Ajout OU Mise à jour
  $("addImgStyleBtn").onclick = () => {
      const name = $("newImgStyleName").value;
      const category = $("newImgStyleCategory").value;
      const prompt = $("newImgStylePrompt").value;
      const fileInput = $("newImgStyleFile");
      
      if(!name || !prompt) return alert("Nom et Prompt requis.");

      const saveStyle = (imgBase64) => {
          const styleData = { name, category, prompt };
          
          if(state.editingImgStyleIndex !== null) {
              // UPDATE : On garde l'ancienne image si pas de nouvelle
              const oldStyle = state.config.imgStyles[state.editingImgStyleIndex];
              styleData.refImage = imgBase64 || oldStyle.refImage;
              state.config.imgStyles[state.editingImgStyleIndex] = styleData;
              window.cancelImgStyleEdit(); // Reset mode
          } else {
              // CREATE
              styleData.refImage = imgBase64;
              if(!state.config.imgStyles) state.config.imgStyles = [];
              state.config.imgStyles.push(styleData);
              // Reset champs
              $("newImgStyleName").value = ""; $("newImgStylePrompt").value = ""; fileInput.value = "";
          }
          renderConfigUI();
      };

      if (fileInput.files && fileInput.files[0]) {
          const r = new FileReader();
          r.onload = (e) => saveStyle(e.target.result.split(",")[1]);
          r.readAsDataURL(fileInput.files[0]);
      } else {
          saveStyle(null);
      }
  };

  /* --- STUDIO UI LOGIC --- */
  
  function renderStudioCategories() {
      const container = $("imgGenCategoriesBar");
      if(!container) return;
      const cats = ["Tout", ...(state.config.imgCategories || [])];
      
      container.innerHTML = cats.map(c => `
         <div class="style-tag ${state.currentImgCategory === c ? 'selected' : ''}" 
              onclick="window.setImgCategory('${c}')"
              style="font-size:10px; padding:4px 10px; border-radius:12px;">
            ${c.toUpperCase()}
         </div>
      `).join("");
  }

  window.setImgCategory = (c) => {
      state.currentImgCategory = c;
      renderStudioCategories();
      renderImgStylesButtons();
  };

  function renderImgStylesButtons() {
      const container = $("imgGenStylesContainer");
      if(!container) return;
      
      const filtered = (state.config.imgStyles || []).filter(s => {
          if (state.currentImgCategory === "Tout") return true;
          return (s.category || "") === state.currentImgCategory;
      });

      container.innerHTML = filtered.map((s) => {
          // Vérifie si le style est dans la liste des sélectionnés
          const isActive = state.selectedImgStyles.some(sel => sel.name === s.name);
          
          return `
         <button class="style-tag ${isActive ? 'selected' : ''}" onclick="window.toggleImgStyle('${s.name}')" style="display:flex; align-items:center; gap:5px; flex-shrink:0; border:1px solid #ddd; ${isActive ? 'background:var(--apple-blue); color:white; border-color:var(--apple-blue);' : 'background:#fff;'}">
            ${s.refImage ? '<span style="width:12px; height:12px; background:#ccc; border-radius:50%; display:inline-block; overflow:hidden;"><img src="data:image/jpeg;base64,'+s.refImage+'" style="width:100%;height:100%;object-fit:cover;"></span>' : ''}
            ${s.name}
         </button>
      `}).join("");
  }

  // Toggle Multiple
  window.toggleImgStyle = (styleName) => {
      const style = state.config.imgStyles.find(s => s.name === styleName);
      if(!style) return;

      const idx = state.selectedImgStyles.findIndex(s => s.name === styleName);
      if (idx > -1) {
          // Désélection
          state.selectedImgStyles.splice(idx, 1);
      } else {
          // Sélection (Ajout)
          state.selectedImgStyles.push(style);
      }
      renderImgStylesButtons();
  };

  /* --- COMMON API --- */
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
          // Reset Image Gen States
          state.savedGeneratedImages = []; state.sessionGeneratedImages = []; state.inputImages = [state.imageBase64]; renderInputImages(); renderGenImages();
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

  /* --- LOGIQUE GENERATION IMAGES --- */
  
  function renderInputImages() {
    const container = $("inputImagesPreview");
    if (state.inputImages.length === 0) { container.classList.add("hidden"); return; }
    container.classList.remove("hidden");
    container.innerHTML = state.inputImages.map((img, i) => `
        <div class="input-img-wrapper">
            <img src="data:image/jpeg;base64,${img}" class="input-img-thumb">
            <div class="remove-input-img" onclick="window.removeInputImg(${i})">×</div>
        </div>
    `).join("");
  }
  
  window.removeInputImg = (i) => { state.inputImages.splice(i, 1); renderInputImages(); };
  
  // --- NOUVELLE LOGIQUE BATCH MULTIPLE ---
  async function callGeminiImageGen() {
      const userPrompt = $("imgGenPrompt").value;
      if (!userPrompt && state.selectedImgStyles.length === 0) return alert("Veuillez entrer une description ou sélectionner un style.");
      
      const count = parseInt($("imgCount").value) || 1;
      const aspectRatio = $("imgAspectRatio").value;
      const resolution = $("imgResolution").value;

      // Création des paquets de requêtes
      const batches = [];

      // SCENARIO 1 : Un ou plusieurs styles sélectionnés
      if (state.selectedImgStyles.length > 0) {
          state.selectedImgStyles.forEach(style => {
              // 1. Fusion des images (User input + Style Ref)
              let batchImages = [...state.inputImages];
              if(style.refImage) batchImages.push(style.refImage);

              // 2. Fusion du prompt (User + Style)
              let batchPrompt = userPrompt ? (userPrompt + " " + style.prompt) : style.prompt;

              // 3. Multiplication par le nombre demandé
              for (let i = 0; i < count; i++) {
                  batches.push({
                      prompt: batchPrompt,
                      images: batchImages,
                      aspectRatio: aspectRatio,
                      resolution: resolution,
                      styleName: style.name
                  });
              }
          });
      } 
      // SCENARIO 2 : Aucun style, juste le prompt utilisateur
      else {
          for (let i = 0; i < count; i++) {
              batches.push({
                  prompt: userPrompt,
                  images: [...state.inputImages],
                  aspectRatio: aspectRatio,
                  resolution: resolution,
                  styleName: null
              });
          }
      }

      // -- MISE A JOUR UI AVANT ENVOI --
      
      // 1. Création placeholders
      const newItems = batches.map(b => ({
          id: Date.now() + Math.random(), 
          loading: true, 
          prompt: b.prompt,
          aspectRatio: b.aspectRatio
      }));
      state.sessionGeneratedImages.unshift(...newItems);
      renderGenImages();

      // 2. Nettoyage Interface (Comme demandé)
      state.selectedImgStyles = []; // On désélectionne tout
      renderImgStylesButtons(); // On met à jour l'affichage des boutons
      // $("imgGenPrompt").value = ""; // Optionnel, je laisse si besoin de réutiliser

      // -- ENVOI DES REQUÊTES (PARALLÈLE) --
      
      newItems.forEach(async (item, index) => {
          const batchData = batches[index];
          try {
              const res = await fetch("/api/gemini", { 
                  method: "POST", 
                  body: JSON.stringify({ 
                      prompt: batchData.prompt,
                      images: batchData.images, 
                      aspectRatio: batchData.aspectRatio,
                      resolution: batchData.resolution
                  }) 
              });
              
              const data = await res.json();
              
              const targetItem = state.sessionGeneratedImages.find(x => x.id === item.id);
              if (targetItem) {
                  if (data.error) {
                      targetItem.loading = false;
                      targetItem.error = data.error;
                  } else {
                      targetItem.loading = false;
                      targetItem.image = data.image;
                  }
                  renderGenImages();
              }
          } catch(e) {
              const targetItem = state.sessionGeneratedImages.find(x => x.id === item.id);
              if (targetItem) {
                  targetItem.loading = false;
                  targetItem.error = e.message;
                  renderGenImages();
              }
          }
      });
  }

  function renderGenImages() {
      const sessionContainer = $("imgGenSessionResults");
      sessionContainer.innerHTML = state.sessionGeneratedImages.map((item, i) => {
        if (item.loading) {
            return `
            <div class="gen-image-card" style="display:flex; align-items:center; justify-content:center; background:#eee; height:150px; flex-direction:column; gap:10px;">
               <div class="spinner" style="width:20px; height:20px; border-width:2px;"></div>
               <span style="font-size:10px; color:#666;">Génération...</span>
               <div class="gen-image-overlay">${item.prompt}</div>
            </div>`;
        }
        if (item.error) {
            return `
            <div class="gen-image-card" style="display:flex; align-items:center; justify-content:center; background:#ffebeb; height:150px; flex-direction:column; gap:5px; padding:10px; text-align:center;">
               <span style="font-size:20px;">⚠️</span>
               <span style="font-size:10px; color:red;">Erreur</span>
               <div class="gen-image-overlay" style="color:red;">${item.error}</div>
            </div>`;
        }
        return `
        <div class="gen-image-card ${state.selectedSessionImagesIdx.includes(item) ? 'selected' : ''}" onclick="window.toggleSessionImg('${item.id}')">
           <img src="data:image/jpeg;base64,${item.image}">
           <div class="gen-image-overlay">${item.prompt}</div>
        </div>
      `}).join("");

      const savedContainer = $("imgGenSavedResults");
      savedContainer.innerHTML = state.savedGeneratedImages.map((item, i) => `
        <div class="gen-image-card" onclick="window.viewImage('${item.image}')">
           <img src="data:image/jpeg;base64,${item.image}">
           <div class="gen-image-overlay">${item.prompt}</div>
           <button class="icon-btn-small" style="position:absolute; top:5px; right:5px; background:rgba(255,255,255,0.8); color:red; border:none;" onclick="event.stopPropagation(); window.deleteSavedImage(${i})">×</button>
        </div>
      `).join("");
  }

  window.toggleSessionImg = (id) => {
      const item = state.sessionGeneratedImages.find(x => x.id == id);
      if(!item) return;
      const idx = state.selectedSessionImagesIdx.indexOf(item);
      if (idx > -1) state.selectedSessionImagesIdx.splice(idx, 1);
      else state.selectedSessionImagesIdx.push(item);
      renderGenImages();
  };

  window.viewImage = (b64) => {
      const w = window.open("");
      w.document.write(`<img src="data:image/jpeg;base64,${b64}" style="max-width:100%">`);
  };

  window.saveImgSelection = async () => {
      if (!state.currentHistoryId) return alert("Veuillez d'abord générer/charger un produit.");
      if (state.selectedSessionImagesIdx.length === 0) return alert("Aucune image sélectionnée.");

      const newImages = state.selectedSessionImagesIdx.map(item => ({ 
          image: item.image, 
          prompt: item.prompt, 
          aspectRatio: item.aspectRatio 
      }));
      
      state.savedGeneratedImages = [...newImages, ...state.savedGeneratedImages];
      state.selectedSessionImagesIdx = [];
      
      startLoading();
      try {
          const payload = { 
              id: state.currentHistoryId, 
              generated_images: JSON.stringify(state.savedGeneratedImages) 
          };
          await fetch("/api/history", { method: "PATCH", body: JSON.stringify(payload) });
          const histItem = state.historyCache.find(h => h.id === state.currentHistoryId);
          if (histItem) histItem.generated_images = payload.generated_images;
          alert("Images enregistrées !");
          renderGenImages();
          document.querySelector('button[data-tab="tab-img-saved"]').click();
      } catch(e) {
          alert("Erreur sauvegarde: " + e.message);
      } finally {
          stopLoading();
      }
  };

  window.deleteSavedImage = async (index) => {
      if(!confirm("Supprimer cette image ?")) return;
      state.savedGeneratedImages.splice(index, 1);
      startLoading();
      try {
          const payload = { id: state.currentHistoryId, generated_images: JSON.stringify(state.savedGeneratedImages) };
          await fetch("/api/history", { method: "PATCH", body: JSON.stringify(payload) });
          const histItem = state.historyCache.find(h => h.id === state.currentHistoryId);
          if (histItem) histItem.generated_images = payload.generated_images;
          renderGenImages();
      } catch(e) { alert(e.message); } finally { stopLoading(); }
  };
  
  /* --- FIN LOGIQUE IMAGES --- */

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

  window.deleteItem = async (id) => { if(!confirm("Supprimer ?")) return; await fetch(`/api/history?id=${id}`, { method: "DELETE" }); if(state.currentHistoryId == id) state.currentHistoryId = null; loadHistory(); };
  window.copyToClip = (t) => { navigator.clipboard.writeText(t); alert("Copié !"); };

  init();
})();
