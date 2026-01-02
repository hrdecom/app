// --- CORRECTION : Sauvegarde des sélections (Point 1 & 3) ---
window.saveSelections = async (type) => {
  if (!state.currentHistoryId) return;
  
  // Récupérer les éléments sélectionnés dans le DOM
  const selector = type === 'hl' ? '#headlinesResults .selected .headline-text' : '#adsResults .selected .headline-text';
  const items = document.querySelectorAll(selector);
  
  // Nettoyage : on récupère le texte pur
  const newSelections = Array.from(items).map(it => it.innerText.trim());
  
  if (newSelections.length === 0) return alert("Aucune sélection à enregistrer.");

  if (type === 'hl') {
    state.selectedHeadlines = [...new Set([...state.selectedHeadlines, ...newSelections])];
  } else {
    state.selectedAds = [...new Set([...state.selectedAds, ...newSelections])];
  }

  startLoading();
  try {
    const payload = { 
      id: state.currentHistoryId, 
      [type === 'hl' ? 'headlines' : 'ad_copys']: JSON.stringify(type === 'hl' ? state.selectedHeadlines : state.selectedAds) 
    };
    
    await fetch("/api/history", { method: "PATCH", body: JSON.stringify(payload) });
    
    // Mise à jour du cache local pour éviter que ça revienne au rechargement
    const histItem = state.historyCache.find(h => h.id === state.currentHistoryId);
    if (histItem) {
      histItem[type === 'hl' ? 'headlines' : 'ad_copys'] = payload[type === 'hl' ? 'headlines' : 'ad_copys'];
    }

    type === 'hl' ? renderSavedHl() : renderSavedAds();
    alert("Enregistré avec succès");
  } catch (e) {
    alert("Erreur lors de la sauvegarde: " + e.message);
  } finally {
    stopLoading();
  }
};

// --- CORRECTION : Suppression instantanée et persistante (Point 2) ---
window.deleteSaved = async (type, i) => {
  if(!confirm("Supprimer cet élément ?")) return;
  
  const list = type === 'hl' ? state.selectedHeadlines : state.selectedAds;
  const trans = type === 'hl' ? state.headlinesTrans : state.adsTrans;
  
  // Suppression locale
  list.splice(i, 1);
  // Suppression dans les traductions associées
  Object.keys(trans).forEach(l => { 
    if(trans[l].items && trans[l].items[i]) trans[l].items.splice(i, 1); 
  });

  startLoading();
  try {
    const payload = { 
      id: state.currentHistoryId, 
      [type==='hl'?'headlines':'ad_copys']: JSON.stringify(list), 
      [type==='hl'?'headlines_trans':'ads_trans']: JSON.stringify(trans) 
    };

    await fetch("/api/history", { method: "PATCH", body: JSON.stringify(payload) });
    
    // Mise à jour critique du cache global
    const histItem = state.historyCache.find(h => h.id === state.currentHistoryId);
    if (histItem) {
      histItem[type==='hl'?'headlines':'ad_copys'] = payload[type==='hl'?'headlines':'ad_copys'];
      histItem[type==='hl'?'headlines_trans':'ads_trans'] = payload[type==='hl'?'headlines_trans':'ads_trans'];
    }

    type === 'hl' ? (renderSavedHl(), renderTranslationTabs('hl')) : (renderSavedAds(), renderTranslationTabs('ad'));
  } catch (e) {
    alert("Erreur suppression: " + e.message);
  } finally {
    stopLoading();
  }
};

// --- CORRECTION : Traduction (Point 4) ---
window.processTranslation = async (type, lang) => {
  document.querySelectorAll('.dropdown-content').forEach(d => d.classList.remove('show'));
  const itemsToTranslate = type === 'hl' ? state.selectedHeadlines : state.selectedAds;
  
  if (!itemsToTranslate || itemsToTranslate.length === 0) {
    return alert("Veuillez d'abord enregistrer des éléments avant de traduire.");
  }

  startLoading();
  let infoToTranslate = (type === 'ad') ? { 
    title1: $("titleText").textContent, 
    title2: $("titleText").textContent + " - Special Offer", 
    title3: "Gift Idea - " + $("titleText").textContent, 
    title4: $("titleText").textContent + " - Valentine's Day Gift Idea", 
    sub: "Free Shipping Worldwide Today" 
  } : null;

  try {
    const res = await fetch("/api/generate", { 
      method: "POST", 
      body: JSON.stringify({ 
        action: "translate", 
        itemsToTranslate, 
        infoToTranslate, 
        targetLang: lang, 
        config: state.config, 
        image: state.imageBase64, 
        media_type: state.imageMime, 
        collection: $("collectionSelect").value 
      }) 
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (type === 'hl') { 
      state.headlinesTrans[lang] = { items: data.translated_items }; 
    } else { 
      state.adsTrans[lang] = { items: data.translated_items, info: data.translated_info }; 
    }

    const payload = { 
      id: state.currentHistoryId, 
      [type === 'hl' ? 'headlines_trans' : 'ads_trans']: JSON.stringify(type === 'hl' ? state.headlinesTrans : state.adsTrans) 
    };

    await fetch("/api/history", { method: "PATCH", body: JSON.stringify(payload) });
    
    // Update cache
    const histItem = state.historyCache.find(h => h.id === state.currentHistoryId);
    if (histItem) histItem[type === 'hl' ? 'headlines_trans' : 'ads_trans'] = payload[type === 'hl' ? 'headlines_trans' : 'ads_trans'];

    renderTranslationTabs(type);
    
    // Activer l'onglet de la langue fraîchement générée
    const tabBtn = document.querySelector(`button[data-tab="tab-${type}-${lang.replace(/\s/g,'')}"]`);
    if(tabBtn) tabBtn.click();

  } catch(e) { 
    alert("Erreur Traduction: " + e.message); 
  } finally { 
    stopLoading(); 
  }
};

// --- CORRECTION : Restauration propre par produit (Point 1) ---
window.restore = (id) => {
  const item = state.historyCache.find(i => i.id === id); 
  if(!item) return;

  state.currentHistoryId = id; 
  // On réinitialise les sessions de génération en cours
  state.sessionHeadlines = []; 
  state.sessionAds = [];
  
  // On charge les données propres AU PRODUIT (Point 1)
  state.selectedHeadlines = item.headlines ? JSON.parse(item.headlines) : []; 
  state.selectedAds = item.ad_copys ? JSON.parse(item.ad_copys) : [];
  state.headlinesTrans = item.headlines_trans ? JSON.parse(item.headlines_trans) : {}; 
  state.adsTrans = item.ads_trans ? JSON.parse(item.ads_trans) : {};

  // UI Updates
  $("titleText").textContent = item.title; 
  $("descText").textContent = item.description; 
  $("productUrlInput").value = item.product_url || "";
  $("previewImg").src = `data:image/jpeg;base64,${item.image}`; 
  state.imageBase64 = item.image; 
  $("preview").classList.remove("hidden");
  $("dropPlaceholder").style.display = "none"; 
  $("generateBtn").disabled = false; 
  
  renderHistoryUI();
};
