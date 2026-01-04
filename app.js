(() => {
  const $ = (id) => document.getElementById(id);

  // SVG ICONS (Vectoriels & Complets)
  const ICONS = {
    folder: `<svg viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>`,
    group: `<svg viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>`,
    style: `<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`
  };

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
    imgCategories: [ { id: "cat_1", name: "Collier", order: 0 }, { id: "cat_2", name: "Bague", order: 1 } ],
    imgGroups: [ { id: "grp_1", name: "Petit collier", categoryId: "cat_1", order: 0 } ],
    imgFolders: [ { id: "fol_1", name: "Photo portée", parentId: "grp_1", parentType: "group", order: 0 } ],
    imgStyles: [ { id: "sty_1", name: "Sur cou", prompt: "On neck.", parentId: "fol_1", parentType: "folder", order: 0 } ]
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
    inputImages: [], sessionGeneratedImages: [], savedGeneratedImages: [], selectedSessionImagesIdx: [],
    currentImgCategory: "", activeFolderId: null, selectedImgStyles: [], manualImgStyles: [], expandedGroups: [], 
    draggedItem: null,
    treeExpandedIds: [] // Pour les accordéons
  };

  const startLoading = () => { let s = 0; $("timer").textContent = "00:00"; if (state.timerInterval) clearInterval(state.timerInterval); state.timerInterval = setInterval(() => { s++; const mm = String(Math.floor(s/60)).padStart(2,"0"); const ss = String(s%60).padStart(2,"0"); $("timer").textContent = `${mm}:${ss}`; }, 1000); $("loading").classList.remove("hidden"); };
  const stopLoading = () => { clearInterval(state.timerInterval); $("loading").classList.add("hidden"); };

  const formatLangUrl = (url, sub = "en.") => { if (!url) return ""; let cleanUrl = url.replace(/https:\/\/(en\.|dn\.|du\.|de\.|it\.|pl\.|pt-br\.|pt\.|es\.)/, "https://"); return cleanUrl.replace("https://", `https://${sub}`); };

  // --- SAUVEGARDE AUTOMATIQUE ---
  async function saveConfigToApi() {
      try {
          await fetch("/api/settings", { 
              method: "POST", 
              body: JSON.stringify({ id: 'full_config', value: JSON.stringify(state.config) }) 
          });
      } catch(e) { console.error("Erreur save auto", e); }
  }

  async function loadConfig() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const saved = data.find(i => i.id === 'full_config');
    if (saved) {
      const parsed = JSON.parse(saved.value);
      state.config = { ...DEFAULTS, ...parsed }; 
      if (Array.isArray(state.config.imgCategories) && typeof state.config.imgCategories[0] === 'string') {
          state.config.imgCategories = state.config.imgCategories.map((c, i) => ({ id: "cat_" + i, name: c, order: i }));
          if (Array.isArray(state.config.imgGroups) && typeof state.config.imgGroups[0] === 'string') {
               const defaultCatId = state.config.imgCategories[0].id;
               state.config.imgGroups = state.config.imgGroups.map((g, i) => ({ id: "grp_" + i, name: g, categoryId: defaultCatId, order: i }));
          }
          if (!state.config.imgFolders) state.config.imgFolders = [];
          if (!state.config.imgStyles) state.config.imgStyles = [];
      }
      const initOrder = (list) => { list.forEach((x, i) => { if(x.order === undefined) x.order = i; }); };
      initOrder(state.config.imgCategories || []); initOrder(state.config.imgGroups || []); initOrder(state.config.imgFolders || []); initOrder(state.config.imgStyles || []);
    }
    if (state.config.imgCategories.length > 0) state.currentImgCategory = state.config.imgCategories[0].id;
    renderConfigUI();
  }

  function renderConfigUI() {
    ["promptSystem", "promptTitles", "promptDesc", "promptHeadlines", "promptAdCopys", "promptTranslate"].forEach(id => { if($(id)) $(id).value = state.config[id] || DEFAULTS[id]; });
    if($("configBlacklist")) $("configBlacklist").value = state.config.blacklist || "";
    $("collectionsList").innerHTML = (state.config.collections || []).map((c, i) => `<div class="config-row collections-item" style="display:flex; gap:10px; margin-bottom:10px;"><input type="text" value="${c.name}" class="col-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="col-meaning" style="flex:2; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${c.meaning}</textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none;">×</button></div>`).join("");
    $("styleButtonsEditor").innerHTML = (state.config.headlineStyles || []).map((s, i) => `<div class="config-row headline-style-item" style="display:flex; gap:10px; margin-bottom:10px;"><input type="text" value="${s.name}" class="style-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="style-prompt" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${s.prompt}</textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none;">×</button></div>`).join("");
    $("adStyleButtonsEditor").innerHTML = (state.config.adStyles || []).map((s, i) => `<div class="config-row ad-style-item" style="display:flex; gap:10px; margin-bottom:10px;"><input type="text" value="${s.name}" class="ad-style-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="ad-style-prompt" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${s.prompt}</textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none;">×</button></div>`).join("");
    $("collectionSelect").innerHTML = (state.config.collections || []).map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    
    renderStyleSelectors(); renderImgConfigTree(); renderStudioCategories(); renderImgStylesButtons();
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

  /* =========================================
     TREE EDITOR (MIXTE + ACCORDEONS GROUPES & FOLDERS)
     ========================================= */

  window.toggleTreeFolder = (id) => {
      const idx = state.treeExpandedIds.indexOf(id);
      if(idx > -1) state.treeExpandedIds.splice(idx, 1);
      else state.treeExpandedIds.push(id);
      renderImgConfigTree();
  };

  function renderImgConfigTree() {
      const container = $("treeEditor");
      if(!container) return;
      container.innerHTML = "";

      const sortedCats = [...(state.config.imgCategories || [])].sort((a,b) => (a.order||0) - (b.order||0));

      sortedCats.forEach(cat => {
          const catNode = createTreeNode("category", cat, null);
          container.appendChild(catNode);
          const childrenContainer = catNode.querySelector('.tree-children');

          const groups = (state.config.imgGroups||[]).filter(g => g.categoryId === cat.id);
          const folders = (state.config.imgFolders||[]).filter(f => f.parentType === 'category' && f.parentId === cat.id);
          const styles = (state.config.imgStyles||[]).filter(s => s.parentType === 'category' && s.parentId === cat.id);

          const mixedContent = [
              ...groups.map(g => ({...g, dataType: 'group'})),
              ...folders.map(f => ({...f, dataType: 'folder'})),
              ...styles.map(s => ({...s, dataType: 'style'}))
          ].sort((a,b) => (a.order||0) - (b.order||0));
          
          mixedContent.forEach(item => {
             if(item.dataType === 'group') {
                 const grpNode = createTreeNode("group", item, cat.id);
                 childrenContainer.appendChild(grpNode);
                 const grpChildren = grpNode.querySelector('.tree-children');
                 
                 const gFolders = (state.config.imgFolders||[]).filter(f => f.parentType === 'group' && f.parentId === item.id);
                 const gStyles = (state.config.imgStyles||[]).filter(s => s.parentType === 'group' && s.parentId === item.id);
                 const gMixed = [
                     ...gFolders.map(f => ({...f, dataType: 'folder'})),
                     ...gStyles.map(s => ({...s, dataType: 'style'}))
                 ].sort((a,b) => (a.order||0) - (b.order||0));

                 gMixed.forEach(subItem => {
                     const node = createRecursiveNode(subItem.dataType, subItem);
                     grpChildren.appendChild(node);
                 });

             } else {
                 const node = createRecursiveNode(item.dataType, item);
                 childrenContainer.appendChild(node);
             }
          });
      });
  }

  function createRecursiveNode(type, item) {
      const node = createTreeNode(type, item, item.parentId);
      if (type === 'folder') {
          const childrenContainer = node.querySelector('.tree-children');
          const styles = (state.config.imgStyles||[]).filter(s => s.parentType === 'folder' && s.parentId === item.id).sort((a,b) => (a.order||0) - (b.order||0));
          styles.forEach(s => {
              const sNode = createRecursiveNode('style', s);
              childrenContainer.appendChild(sNode);
          });
      }
      return node;
  }

  function createTreeNode(type, data, parentId) {
      const el = document.createElement('div');
      el.className = `tree-node type-${type}`;
      el.setAttribute('draggable', 'true');
      el.setAttribute('data-id', data.id);
      el.setAttribute('data-type', type);
      
      let icon = "";
      if (type === "group") icon = ICONS.group;
      if (type === "folder") icon = ICONS.folder;
      if (type === "style") icon = ICONS.style;
      
      let addBtns = "";
      if (type === "category") addBtns = `<button class="action-btn-text" onclick="window.addNode('group', '${data.id}')">+ Groupe</button> <button class="action-btn-text" onclick="window.addNode('folder', '${data.id}', 'category')">+ Multiple</button> <button class="action-btn-text" onclick="window.addNode('style', '${data.id}', 'category')">+ Bouton</button>`;
      if (type === "group") addBtns = `<button class="action-btn-text" onclick="window.addNode('folder', '${data.id}', 'group')">+ Multiple</button> <button class="action-btn-text" onclick="window.addNode('style', '${data.id}', 'group')">+ Bouton</button>`;
      if (type === "folder") addBtns = `<button class="action-btn-text" onclick="window.addNode('style', '${data.id}', 'folder')">+ Bouton</button>`;

      // LOGIQUE ACCORDEON POUR FOLDER ET GROUP
      let chevron = "";
      let childrenClass = "tree-children";
      
      if (type === 'folder' || type === 'group') {
          const isExpanded = state.treeExpandedIds.includes(data.id);
          chevron = `<span class="tree-chevron" onclick="event.stopPropagation(); window.toggleTreeFolder('${data.id}')">${isExpanded ? '▼' : '▶'}</span>`;
          if(!isExpanded) childrenClass += " hidden";
      }

      el.innerHTML = `
        <div class="tree-header">
            ${chevron}
            ${icon ? `<span class="t-icon">${icon}</span>` : ''}
            <span class="t-label">${data.name}</span>
            <div class="t-actions">
                ${addBtns}
                <button class="action-btn-text" onclick="window.editNode('${type}', '${data.id}')">Modifier</button>
                <button class="action-btn-text btn-delete" onclick="window.deleteNodeDirect('${type}', '${data.id}')">Suppr.</button>
            </div>
        </div>
        <div class="${childrenClass}"></div>
      `;

      // --- DRAG & DROP ---
      const header = el.querySelector('.tree-header');
      el.addEventListener('dragstart', (e) => {
          state.draggedItem = { id: data.id, type: type, parentId: parentId };
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'move';
          el.style.opacity = '0.5';
      });
      el.addEventListener('dragend', (e) => {
          el.style.opacity = '1';
          document.querySelectorAll('.drag-over-center, .drag-over-top, .drag-over-bottom').forEach(x => {
              x.classList.remove('drag-over-center', 'drag-over-top', 'drag-over-bottom');
          });
          state.draggedItem = null;
      });
      header.addEventListener('dragover', (e) => {
          e.preventDefault(); e.stopPropagation();
          if(!state.draggedItem || state.draggedItem.id === data.id) return;
          const rect = header.getBoundingClientRect();
          const y = e.clientY - rect.top;
          const height = rect.height;
          
          header.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-center');
          const src = state.draggedItem.type; const dest = type;

          let canNest = false;
          if (dest === 'category') canNest = true;
          if (dest === 'group' && (src === 'folder' || src === 'style')) canNest = true;
          if (dest === 'folder' && src === 'style') canNest = true;

          if (y < height * 0.3) {
              if (dest === 'category' && src !== 'category') return; 
              header.classList.add('drag-over-top');
          } else if (y > height * 0.7) {
              if (dest === 'category' && src !== 'category') return; 
              header.classList.add('drag-over-bottom');
          } else {
              if (canNest) header.classList.add('drag-over-center');
              else {
                  if (dest === 'category' && src !== 'category') return;
                  if (y < height * 0.5) header.classList.add('drag-over-top');
                  else header.classList.add('drag-over-bottom');
              }
          }
      });
      header.addEventListener('dragleave', (e) => header.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-center'));
      header.addEventListener('drop', (e) => {
          e.preventDefault(); e.stopPropagation();
          let action = 'nest';
          if (header.classList.contains('drag-over-top')) action = 'before';
          if (header.classList.contains('drag-over-bottom')) action = 'after';
          
          if (!header.classList.contains('drag-over-top') && !header.classList.contains('drag-over-bottom') && !header.classList.contains('drag-over-center')) return;

          header.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-center');
          if(state.draggedItem && state.draggedItem.id !== data.id) window.moveNode(state.draggedItem, { id: data.id, type: type, parentId: parentId }, action);
      });
      return el;
  }

  window.moveNode = (src, dest, action) => {
      const getList = (t) => {
          if (t === 'category') return state.config.imgCategories;
          if (t === 'group') return state.config.imgGroups;
          if (t === 'folder') return state.config.imgFolders;
          if (t === 'style') return state.config.imgStyles;
          return [];
      };
      
      const srcList = getList(src.type);
      const srcItem = srcList.find(x => x.id === src.id);
      if (!srcItem) return;

      const destItem = getList(dest.type).find(x => x.id === dest.id);
      let targetParentId = null, targetParentType = null, targetCategoryId = null;

      if (action === 'nest') {
          if (dest.type === 'category') { targetCategoryId = dest.id; targetParentType = 'category'; targetParentId = dest.id; }
          else if (dest.type === 'group') { targetParentId = dest.id; targetParentType = 'group'; }
          else if (dest.type === 'folder') { targetParentId = dest.id; targetParentType = 'folder'; }
      } else {
          if (dest.type === 'category') { targetParentType = 'root'; } 
          else {
              targetCategoryId = destItem.categoryId || null;
              targetParentId = destItem.parentId;
              targetParentType = destItem.parentType || 'category'; 
              if (dest.type === 'group') { targetCategoryId = destItem.categoryId; targetParentId = destItem.categoryId; targetParentType = 'category'; }
          }
      }

      if (src.type === 'group') {
          if (targetCategoryId) srcItem.categoryId = targetCategoryId;
          else if (targetParentType === 'category') srcItem.categoryId = targetParentId;
      } else {
          if (action === 'nest') { srcItem.parentId = dest.id; srcItem.parentType = dest.type; } 
          else {
             srcItem.parentId = destItem.parentId; srcItem.parentType = destItem.parentType;
             if(dest.type === 'group') { srcItem.parentId = destItem.categoryId; srcItem.parentType = 'category'; }
          }
      }

      let siblings = [];
      if (dest.type === 'category' && action !== 'nest') { siblings = state.config.imgCategories; } 
      else {
          let contextId, contextType;
          if (action === 'nest') { contextId = dest.id; contextType = dest.type; }
          else { 
             if (dest.type === 'group') { contextId = destItem.categoryId; contextType = 'category'; }
             else { contextId = destItem.parentId; contextType = destItem.parentType; }
          }
          const gr = state.config.imgGroups.filter(g => g.categoryId === contextId);
          const fo = state.config.imgFolders.filter(f => f.parentId === contextId && f.parentType === contextType);
          const st = state.config.imgStyles.filter(s => s.parentId === contextId && s.parentType === contextType);
          if (contextType === 'category') siblings = [...gr, ...fo, ...st]; else siblings = [...fo, ...st];
      }

      siblings.sort((a,b) => (a.order||0) - (b.order||0));
      siblings = siblings.filter(x => x.id !== srcItem.id);

      if (action === 'nest') { 
          siblings.push(srcItem); 
          // Auto-expand target if nesting
          if (!state.treeExpandedIds.includes(dest.id)) state.treeExpandedIds.push(dest.id);
      } 
      else {
          const destIndex = siblings.findIndex(x => x.id === dest.id);
          if (destIndex !== -1) {
              if (action === 'before') siblings.splice(destIndex, 0, srcItem);
              else siblings.splice(destIndex + 1, 0, srcItem);
          } else { siblings.push(srcItem); }
      }
      siblings.forEach((item, index) => item.order = index);
      saveConfigToApi(); // AUTO SAVE
      renderConfigUI();
  };

  window.deleteNodeDirect = (type, id) => {
      if(!confirm("Confirmer la suppression ?")) return;
      if (type === 'category') {
          state.config.imgCategories = state.config.imgCategories.filter(x => x.id !== id);
          state.config.imgGroups = state.config.imgGroups.filter(x => x.categoryId !== id);
          state.config.imgFolders = state.config.imgFolders.filter(x => !(x.parentType === 'category' && x.parentId === id));
          state.config.imgStyles = state.config.imgStyles.filter(x => !(x.parentType === 'category' && x.parentId === id));
      } else if (type === 'group') {
          state.config.imgGroups = state.config.imgGroups.filter(x => x.id !== id);
          state.config.imgFolders = state.config.imgFolders.filter(x => !(x.parentType === 'group' && x.parentId === id));
          state.config.imgStyles = state.config.imgStyles.filter(x => !(x.parentType === 'group' && x.parentId === id));
      } else if (type === 'folder') {
          state.config.imgFolders = state.config.imgFolders.filter(x => x.id !== id);
          state.config.imgStyles = state.config.imgStyles.filter(x => !(x.parentType === 'folder' && x.parentId === id));
      } else if (type === 'style') { state.config.imgStyles = state.config.imgStyles.filter(x => x.id !== id); }
      saveConfigToApi(); // AUTO SAVE
      renderConfigUI();
  };

  window.addNode = (newType, parentId, parentTypeContext) => openNodeEditor(null, newType, parentId, parentTypeContext);
  window.editNode = (type, id) => openNodeEditor(id, type, null, null);

  function openNodeEditor(id, type, parentId, parentTypeContext) {
      $("nodeEditorOverlay").classList.remove("hidden");
      $("editNodeId").value = id || ""; $("editNodeType").value = type;
      state.tempParentId = parentId; state.tempParentType = parentTypeContext;
      $("editNodeName").value = ""; $("editNodePrompt").value = ""; $("editNodeFile").value = "";
      $("editNodeImgPreview").innerHTML = ""; $("editPromptContainer").classList.add("hidden");
      
      let title = id ? "Modifier" : "Créer";
      if (type === 'style') $("editPromptContainer").classList.remove("hidden");
      if (id) {
          let item = null;
          if (type === 'category') item = state.config.imgCategories.find(x => x.id === id);
          if (type === 'group') item = state.config.imgGroups.find(x => x.id === id);
          if (type === 'folder') item = state.config.imgFolders.find(x => x.id === id);
          if (type === 'style') item = state.config.imgStyles.find(x => x.id === id);
          if (item) {
              $("editNodeName").value = item.name;
              if (item.prompt) $("editNodePrompt").value = item.prompt;
              if (item.mode) $("editNodeMode").value = item.mode;
              if (item.refImage) $("editNodeImgPreview").innerHTML = `<img src="data:image/jpeg;base64,${item.refImage}" style="width:100%;height:100%;object-fit:cover;">`;
          }
      }
      $("nodeEditorTitle").textContent = title;
  }

  function closeNodeEditor() { $("nodeEditorOverlay").classList.add("hidden"); }

  // --- STUDIO UI ---
  function renderStudioCategories() {
      const container = $("imgGenCategoriesBar");
      if(!container) return;
      const cats = (state.config.imgCategories || []).sort((a,b) => (a.order||0) - (b.order||0));
      if (!state.currentImgCategory && cats.length > 0) state.currentImgCategory = cats[0].id;
      container.innerHTML = cats.map(c => `<div class="style-tag ${state.currentImgCategory === c.id ? 'selected' : ''}" onclick="window.setImgCategory('${c.id}')" style="font-size:10px; padding:4px 10px; border-radius:12px;">${c.name.toUpperCase()}</div>`).join("");
  }

  window.setImgCategory = (cId) => { state.currentImgCategory = cId; state.activeFolderId = null; state.expandedGroups = []; renderStudioCategories(); renderImgStylesButtons(); };

  function renderImgStylesButtons() {
      const container = $("imgGenStylesContainer");
      if(!container) return;
      if (!state.currentImgCategory) { container.innerHTML = `<div style="padding:20px; color:#999; text-align:center; font-size:12px;">Créez une catégorie dans les paramètres.</div>`; return; }

      let html = "";
      const globalFolders = (state.config.imgFolders||[]).filter(f => f.parentType === 'category' && f.parentId === state.currentImgCategory);
      const globalStyles = (state.config.imgStyles||[]).filter(s => s.parentType === 'category' && s.parentId === state.currentImgCategory);
      const globalMixed = [...globalFolders, ...globalStyles].sort((a,b) => (a.order||0) - (b.order||0));

      if (globalMixed.length > 0) {
          html += `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:15px; padding-bottom:10px;">`;
          globalMixed.forEach(item => { if (item.prompt !== undefined) html += renderStyleBtn(item); else html += renderFolderButton(item); });
          html += `</div>`;
          if (state.activeFolderId && globalFolders.find(f => f.id === state.activeFolderId)) html += renderFolderContent(state.activeFolderId);
      }

      const catGroups = (state.config.imgGroups||[]).filter(g => g.categoryId === state.currentImgCategory).sort((a,b) => (a.order||0) - (b.order||0));
      if (catGroups.length > 0) {
          catGroups.forEach(grp => {
              const isExpanded = state.expandedGroups.includes(grp.id);
              const chevron = isExpanded ? '▼' : '▶';
              const grpFolders = (state.config.imgFolders||[]).filter(f => f.parentType === 'group' && f.parentId === grp.id);
              const grpStyles = (state.config.imgStyles||[]).filter(s => s.parentType === 'group' && s.parentId === grp.id);
              const grpMixed = [...grpFolders, ...grpStyles].sort((a,b) => (a.order||0) - (b.order||0));
              const hasActiveItems = grpStyles.some(s => state.selectedImgStyles.some(sel => sel.name === s.name)) || (state.activeFolderId && grpFolders.some(f => f.id === state.activeFolderId));
              const headerStyle = hasActiveItems ? 'background:#E1F0FF; color:#007AFF;' : '';

              html += `<div class="studio-group-block"><div class="studio-group-header" onclick="window.toggleGroupAccordion('${grp.id}')" style="${headerStyle}"><span>${grp.name}</span><span style="color:#bbb; font-size:10px;">${chevron}</span></div><div class="studio-group-content ${isExpanded ? '' : 'hidden'}">`;
              if (isExpanded) {
                  if (grpMixed.length === 0) html += `<div style="width:100%; text-align:center; color:#ccc; font-size:11px;">Vide</div>`;
                  else grpMixed.forEach(item => { if (item.prompt !== undefined) html += renderStyleBtn(item); else html += renderFolderButton(item); });
                  if (state.activeFolderId && grpFolders.find(f => f.id === state.activeFolderId)) html += `</div><div style="padding:10px; background:#f9f9f9; border-top:1px dashed #eee;">${renderFolderContent(state.activeFolderId, true)}</div>`; else html += `</div>`;
              } else html += `</div>`;
              html += `</div>`;
          });
      }
      container.innerHTML = html;
  }

  window.toggleGroupAccordion = (grpId) => { const idx = state.expandedGroups.indexOf(grpId); if (idx > -1) state.expandedGroups.splice(idx, 1); else state.expandedGroups.push(grpId); renderImgStylesButtons(); };
  window.setStudioFolder = (fId) => { state.activeFolderId = (state.activeFolderId === fId) ? null : fId; renderImgStylesButtons(); };

  function renderFolderButton(f) { const isActive = state.activeFolderId === f.id; return `<button onclick="window.setStudioFolder('${f.id}')" class="style-tag ${isActive ? 'selected' : ''}" style="font-weight:600; padding:6px 12px; font-size:11px; border:1px solid #ddd; background:${isActive ? '#007AFF' : '#fff'}; color:${isActive ? '#fff' : '#007AFF'}; display:inline-flex; align-items:center; gap:5px;">${ICONS.folder} ${f.name}</button>`; }
  function renderFolderContent(folderId, isInline = false) {
      const children = (state.config.imgStyles||[]).filter(s => s.parentType === 'folder' && s.parentId === folderId).sort((a,b) => (a.order||0) - (b.order||0));
      let html = isInline ? `<div style="display:flex; flex-wrap:wrap; gap:8px;">` : `<div style="background:#f9f9f9; border:1px solid #eee; border-radius:12px; padding:12px; margin-bottom:15px; box-shadow:inset 0 1px 4px rgba(0,0,0,0.02);"><div style="display:flex; flex-wrap:wrap; gap:8px;">`;
      if (children.length === 0) html += `<span style="font-size:11px; color:#999;">Aucun prompt.</span>`; else children.forEach(s => html += renderStyleBtn(s));
      html += `</div>`; if (!isInline) html += `</div>`; return html;
  }
  function renderStyleBtn(s) {
      let isActive = false; if (s.mode === 'manual') isActive = state.manualImgStyles.includes(s.name); else isActive = state.selectedImgStyles.some(sel => sel.name === s.name);
      const borderStyle = s.mode === 'manual' ? 'border:1px dashed #007AFF;' : 'border:1px solid #e5e5e5;'; const bgColor = isActive ? '#007AFF' : '#fff'; const color = isActive ? '#fff' : '#1d1d1f'; const shadow = isActive ? 'box-shadow: 0 2px 5px rgba(0,122,255,0.3);' : 'box-shadow: 0 1px 2px rgba(0,0,0,0.05);';
      return `<button class="style-tag style-btn-click" data-name="${s.name.replace(/"/g, '&quot;')}" style="display:inline-flex; align-items:center; gap:5px; flex-shrink:0; ${borderStyle} background:${bgColor}; color:${color}; ${shadow} padding:5px 12px; border-radius:18px; transition: all 0.2s; font-weight:500; font-size:11px;">${s.refImage ? '<span style="width:14px; height:14px; background:#f0f0f0; border-radius:50%; display:inline-block; overflow:hidden; border:1px solid rgba(0,0,0,0.1);"><img src="data:image/jpeg;base64,'+s.refImage+'" style="width:100%;height:100%;object-fit:cover;"></span>' : ''}<span>${s.name}</span>${s.mode === 'manual' ? '<span style="font-size:9px; opacity:0.7;">📝</span>' : ''}</button>`;
  }
  document.addEventListener('click', function(e) { const btn = e.target.closest('.style-btn-click'); if (btn) { const name = btn.getAttribute('data-name'); if (name) window.toggleImgStyle(name); } });
  window.toggleImgStyle = (styleName) => {
      const style = state.config.imgStyles.find(s => s.name === styleName); if(!style) return;
      const promptClean = style.prompt.trim();
      if (style.mode === 'manual') {
          const idx = state.manualImgStyles.indexOf(styleName); let currentText = $("imgGenPrompt").value.trim();
          if (idx > -1) { state.manualImgStyles.splice(idx, 1); if (currentText.includes(promptClean)) { const parts = currentText.split(promptClean); currentText = parts.map(p => p.trim()).filter(p => p).join(" "); $("imgGenPrompt").value = currentText; } if (style.refImage) { const imgIdx = state.inputImages.indexOf(style.refImage); if (imgIdx > -1) state.inputImages.splice(imgIdx, 1); renderInputImages(); } }
          else { state.manualImgStyles.push(styleName); if (!currentText.includes(promptClean)) $("imgGenPrompt").value = (currentText + " " + promptClean).trim(); if (style.refImage && !state.inputImages.includes(style.refImage)) { state.inputImages.push(style.refImage); renderInputImages(); } }
      } else { const idx = state.selectedImgStyles.findIndex(s => s.name === styleName); if (idx > -1) state.selectedImgStyles.splice(idx, 1); else state.selectedImgStyles.push(style); }
      renderImgStylesButtons();
  };

  async function apiCall(action, extra = {}) { if (!state.imageBase64) return; startLoading(); try { const productUrl = formatLangUrl($("productUrlInput").value, "en."); const common = { image: state.imageBase64, media_type: state.imageMime, collection: $("collectionSelect").value, config: state.config, historyNames: state.historyCache.map(h => h.product_name), currentTitle: $("titleText").textContent, currentDesc: $("descText").textContent, product_url: productUrl }; if (action === 'ad_copys' && state.selAdStyles.length > 0) { const results = await Promise.all(state.selAdStyles.map(sName => { const sPrompt = state.config.adStyles.find(x => x.name === sName)?.prompt; return fetch("/api/generate", { method: "POST", body: JSON.stringify({ ...common, action, style: sPrompt + " " + (extra.userText || ""), styleLabel: sName }) }).then(r => r.json().then(d => ({ ...d, label: sName }))); })); results.forEach(res => { state.sessionAds = [...(res.ad_copys || []).map(t => ({ text: t, style: res.label })), ...state.sessionAds]; }); state.adPage = 1; renderAds(); } else { if (action === 'headlines' && state.selHlStyles.length > 0) extra.style = state.selHlStyles.map(n => state.config.headlineStyles.find(s => s.name === n)?.prompt).join(" ") + " " + (extra.userText || ""); const res = await fetch("/api/generate", { method: "POST", body: JSON.stringify({ ...common, action, ...extra }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error || "Erreur IA"); if (action === 'generate') { $("titleText").textContent = data.title; $("descText").textContent = data.description; const hRes = await fetch("/api/history", { method: "POST", body: JSON.stringify({ title: data.title, description: data.description, image: state.imageBase64, product_name: data.product_name, product_url: productUrl }) }); const hData = await hRes.json(); state.currentHistoryId = hData.id; localStorage.setItem('lastHistoryId', hData.id); state.sessionHeadlines = []; state.sessionAds = []; state.selectedHeadlines = []; state.selectedAds = []; state.headlinesTrans = {}; state.adsTrans = {}; state.savedGeneratedImages = []; state.sessionGeneratedImages = []; state.inputImages = [state.imageBase64]; renderInputImages(); renderGenImages(); await loadHistory(); } else if (action === 'regen_title' || action === 'regen_desc') { if (action === 'regen_title') $("titleText").textContent = data.title; else $("descText").textContent = data.description; if (state.currentHistoryId) await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, title: $("titleText").textContent, description: $("descText").textContent }) }); await loadHistory(); } else if (action.includes('headlines')) { state.sessionHeadlines = [...(data.headlines || []), ...state.sessionHeadlines]; state.hlPage = 1; renderHeadlines(); } else if (action.includes('ad_copys')) { state.sessionAds = [...(data.ad_copys || []).map(t => ({ text: t, style: action.includes('similar') ? 'Variante' : 'Chat' })), ...state.sessionAds]; state.adPage = 1; renderAds(); } } $("regenTitleBtn").disabled = $("regenDescBtn").disabled = false; } catch(e) { alert("Erreur: " + e.message); } finally { stopLoading(); } }
  function renderInputImages() { const container = $("inputImagesPreview"); if (state.inputImages.length === 0) { container.classList.add("hidden"); return; } container.classList.remove("hidden"); container.innerHTML = state.inputImages.map((img, i) => `<div class="input-img-wrapper"><img src="data:image/jpeg;base64,${img}" class="input-img-thumb"><div class="remove-input-img" onclick="window.removeInputImg(${i})">×</div></div>`).join(""); }
  window.removeInputImg = (i) => { state.inputImages.splice(i, 1); renderInputImages(); };
  async function callGeminiImageGen() { const userPrompt = $("imgGenPrompt").value; if (!userPrompt && state.selectedImgStyles.length === 0) return alert("Veuillez entrer une description ou sélectionner un style."); const count = parseInt($("imgCount").value) || 1; const aspectRatio = $("imgAspectRatio").value; const resolution = $("imgResolution").value; if (state.inputImages.length === 0 && state.imageBase64) { state.inputImages = [state.imageBase64]; renderInputImages(); } const batches = []; const inputsToProcess = state.inputImages.length > 0 ? state.inputImages : [null]; inputsToProcess.forEach(inputImg => { let tasks = []; if (state.selectedImgStyles.length > 0) { tasks = state.selectedImgStyles.map(s => ({ type: 'style', styleObj: s, prompt: userPrompt ? (userPrompt + " " + s.prompt) : s.prompt, refImage: s.refImage, label: s.name })); } else { tasks = [{ type: 'manual', prompt: userPrompt, refImage: null, label: userPrompt }]; } tasks.forEach(task => { let contextImages = []; if (inputImg) contextImages.push(inputImg); if (task.refImage) contextImages.push(task.refImage); for (let i = 0; i < count; i++) { batches.push({ prompt: task.prompt, images: contextImages, aspectRatio: aspectRatio, resolution: resolution, label: task.label }); } }); }); const newItems = batches.map(b => ({ id: Date.now() + Math.random(), loading: true, prompt: b.label, aspectRatio: b.aspectRatio })); state.sessionGeneratedImages.unshift(...newItems); renderGenImages(); state.selectedImgStyles = []; state.manualImgStyles = []; $("imgGenPrompt").value = ""; renderImgStylesButtons(); newItems.forEach(async (item, index) => { const batchData = batches[index]; try { const res = await fetch("/api/gemini", { method: "POST", body: JSON.stringify({ prompt: batchData.prompt, images: batchData.images, aspectRatio: batchData.aspectRatio, resolution: batchData.resolution }) }); const data = await res.json(); const targetItem = state.sessionGeneratedImages.find(x => x.id === item.id); if (targetItem) { if (data.error) { targetItem.loading = false; targetItem.error = data.error; } else { targetItem.loading = false; targetItem.image = data.image; } renderGenImages(); } } catch(e) { const targetItem = state.sessionGeneratedImages.find(x => x.id === item.id); if (targetItem) { targetItem.loading = false; targetItem.error = e.message; renderGenImages(); } } }); }
  function renderGenImages() { const sessionContainer = $("imgGenSessionResults"); sessionContainer.innerHTML = state.sessionGeneratedImages.map((item, i) => { if (item.loading) { return `<div class="gen-image-card" style="display:flex; align-items:center; justify-content:center; background:#eee; height:150px; flex-direction:column; gap:10px;"><div class="spinner" style="width:20px; height:20px; border-width:2px;"></div><span style="font-size:10px; color:#666;">Génération...</span><div class="gen-image-overlay">${item.prompt}</div></div>`; } if (item.error) { return `<div class="gen-image-card" style="display:flex; align-items:center; justify-content:center; background:#ffebeb; height:150px; flex-direction:column; gap:5px; padding:10px; text-align:center;"><span style="font-size:20px;">⚠️</span><span style="font-size:10px; color:red;">Erreur</span><div class="gen-image-overlay" style="color:red;">${item.error}</div></div>`; } return `<div class="gen-image-card ${state.selectedSessionImagesIdx.includes(item) ? 'selected' : ''}" onclick="window.toggleSessionImg('${item.id}')"><img src="data:image/jpeg;base64,${item.image}"><div class="gen-image-overlay">${item.prompt}</div><button class="icon-btn-small" style="position:absolute; top:5px; right:5px; width:20px; height:20px; font-size:10px; display:flex; justify-content:center; align-items:center; background:rgba(255,255,255,0.9); color:#333; border:1px solid #ccc;" onclick="event.stopPropagation(); window.viewImage('${item.image}')">🔍</button></div>`; }).join(""); let savedHtml = ""; if(state.imageBase64) { savedHtml += `<div class="gen-image-card no-drag" style="border:2px solid var(--text-main); cursor:default;"><img src="data:image/jpeg;base64,${state.imageBase64}"><div class="gen-image-overlay" style="background:var(--text-main); color:white; font-weight:bold;">ORIGINAL</div><button class="icon-btn-small" style="position:absolute; top:5px; right:5px; width:20px; height:20px; font-size:12px; display:flex; justify-content:center; align-items:center; background:var(--apple-blue); color:white; border:none;" onclick="event.stopPropagation(); window.addSavedToInputOrig()" title="Utiliser">＋</button></div>`; } savedHtml += state.savedGeneratedImages.map((item, i) => { const isSelected = state.inputImages.includes(item.image); const borderStyle = isSelected ? 'border:3px solid var(--apple-blue); box-shadow:0 0 10px rgba(0,122,255,0.3);' : ''; return `<div class="gen-image-card" style="${borderStyle}" draggable="true" ondragstart="dragStart(event, ${i})" ondrop="drop(event, ${i})" ondragenter="dragEnter(event, ${i})" ondragover="allowDrop(event)" onclick="window.toggleSavedImg(${i})"><img src="data:image/jpeg;base64,${item.image}" style="pointer-events:none;"><div class="gen-image-overlay">${item.prompt}</div><button class="icon-btn-small" style="position:absolute; top:5px; right:30px; width:20px; height:20px; font-size:10px; display:flex; justify-content:center; align-items:center; background:rgba(255,255,255,0.9); color:#333; border:1px solid #ccc;" onclick="event.stopPropagation(); window.viewImage('${item.image}')">🔍</button><button class="icon-btn-small" style="position:absolute; top:5px; right:5px; width:20px; height:20px; font-size:10px; display:flex; justify-content:center; align-items:center; background:rgba(255,255,255,0.9); color:red; border:1px solid #ccc;" onclick="event.stopPropagation(); window.deleteSavedImage(${i})">×</button></div>`; }).join(""); $("imgGenSavedResults").innerHTML = savedHtml; }
  window.toggleSavedImg = (index) => { const item = state.savedGeneratedImages[index]; if(!item) return; const idx = state.inputImages.indexOf(item.image); if(idx > -1) state.inputImages.splice(idx, 1); else state.inputImages.push(item.image); renderInputImages(); renderGenImages(); };
  let dragSrcIndex = null; window.dragStart = (e, i) => { dragSrcIndex = i; e.dataTransfer.effectAllowed = 'move'; e.target.style.opacity = '0.4'; }; window.allowDrop = (e) => { e.preventDefault(); }; window.dragEnter = (e, targetIndex) => { if (dragSrcIndex === null || dragSrcIndex === targetIndex) return; const item = state.savedGeneratedImages.splice(dragSrcIndex, 1)[0]; state.savedGeneratedImages.splice(targetIndex, 0, item); dragSrcIndex = targetIndex; renderGenImages(); const cards = document.querySelectorAll('#imgGenSavedResults .gen-image-card'); if(cards[dragSrcIndex]) cards[dragSrcIndex].style.opacity = '0.4'; }; window.drop = async (e, i) => { e.preventDefault(); document.querySelectorAll('.gen-image-card').forEach(c => c.style.opacity = '1'); dragSrcIndex = null; if (state.currentHistoryId) { try { await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, generated_images: JSON.stringify(state.savedGeneratedImages) }) }); } catch(err) {} } };
  window.addSavedToInput = (index) => { const item = state.savedGeneratedImages[index]; if(item && !state.inputImages.includes(item.image)) { state.inputImages.push(item.image); renderInputImages(); document.querySelector('button[data-tab="tab-img-chat"]').click(); } };
  window.addSavedToInputOrig = () => { if(state.imageBase64 && !state.inputImages.includes(state.imageBase64)) { state.inputImages.push(state.imageBase64); renderInputImages(); document.querySelector('button[data-tab="tab-img-chat"]').click(); } };
  window.toggleSessionImg = (id) => { const item = state.sessionGeneratedImages.find(x => x.id == id); if(!item) return; const idx = state.selectedSessionImagesIdx.indexOf(item); if (idx > -1) { state.selectedSessionImagesIdx.splice(idx, 1); const imgToRemove = item.image; const inputIdx = state.inputImages.indexOf(imgToRemove); if (inputIdx > -1) state.inputImages.splice(inputIdx, 1); } else { state.selectedSessionImagesIdx.push(item); if (!state.inputImages.includes(item.image)) state.inputImages.push(item.image); } renderInputImages(); renderGenImages(); };
  window.viewImage = (b64) => { const byteCharacters = atob(b64); const byteNumbers = new Array(byteCharacters.length); for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i); const byteArray = new Uint8Array(byteNumbers); const blob = new Blob([byteArray], {type: 'image/jpeg'}); const blobUrl = URL.createObjectURL(blob); window.open(blobUrl, '_blank'); };
  window.saveImgSelection = async () => { if (!state.currentHistoryId) return alert("Veuillez d'abord générer/charger un produit."); if (state.selectedSessionImagesIdx.length === 0) return alert("Aucune image sélectionnée."); const newImages = state.selectedSessionImagesIdx.map(item => ({ image: item.image, prompt: item.prompt, aspectRatio: item.aspectRatio })); state.savedGeneratedImages = [...newImages, ...state.savedGeneratedImages]; state.selectedSessionImagesIdx = []; startLoading(); try { const res = await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, generated_images: JSON.stringify(state.savedGeneratedImages) }) }); if (!res.ok) throw new Error("Erreur serveur"); alert("Images enregistrées !"); renderGenImages(); document.querySelector('button[data-tab="tab-img-saved"]').click(); } catch(e) { alert("Erreur sauvegarde: " + e.message); } finally { stopLoading(); } };
  window.deleteSavedImage = async (index) => { if(!confirm("Supprimer cette image ?")) return; state.savedGeneratedImages.splice(index, 1); startLoading(); try { await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, generated_images: JSON.stringify(state.savedGeneratedImages) }) }); renderGenImages(); } catch(e) { alert(e.message); } finally { stopLoading(); } };
  async function loadHistory() { try { const r = await fetch("/api/history"); state.historyCache = await r.json(); renderHistoryUI(); } catch(e){} }
  function renderHistoryUI() { const filtered = (state.historyCache || []).filter(i => (i.title||"").toLowerCase().includes(state.searchQuery.toLowerCase())); const start = (state.currentPage - 1) * 5; const pag = filtered.slice(start, start + 5); $("historyList").innerHTML = pag.map(item => `<div class="history-item ${state.currentHistoryId == item.id ? 'active-history' : ''}" onclick="restore(${item.id})"><img src="data:image/jpeg;base64,${item.image}" class="history-img"><div style="flex:1"><h4>${item.title || "Sans titre"}</h4></div><button onclick="event.stopPropagation(); deleteItem(${item.id})">🗑</button></div>`).join(""); renderPagination(Math.ceil(filtered.length / 5)); }
  function renderPagination(total) { const p = $("pagination"); p.innerHTML = ""; if(total <= 1) return; for(let i=1; i<=total; i++) { const b = document.createElement("button"); b.textContent = i; if(i === state.currentPage) b.className = "active"; b.onclick = () => { state.currentPage = i; renderHistoryUI(); }; p.appendChild(b); } }
  window.restore = async (id) => { state.currentHistoryId = id; localStorage.setItem('lastHistoryId', id); renderHistoryUI(); startLoading(); try { const res = await fetch(`/api/history?id=${id}`); const item = await res.json(); state.sessionHeadlines = []; state.sessionAds = []; state.selectedHeadlines = item.headlines ? JSON.parse(item.headlines) : []; state.selectedAds = item.ad_copys ? JSON.parse(item.ad_copys) : []; state.headlinesTrans = item.headlines_trans ? JSON.parse(item.headlines_trans) : {}; state.adsTrans = item.ads_trans ? JSON.parse(item.ads_trans) : {}; state.savedGeneratedImages = item.generated_images ? JSON.parse(item.generated_images) : []; state.sessionGeneratedImages = []; $("titleText").textContent = item.title; $("descText").textContent = item.description; $("productUrlInput").value = item.product_url || ""; $("previewImg").src = `data:image/jpeg;base64,${item.image}`; state.imageBase64 = item.image; $("preview").classList.remove("hidden"); $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false; state.inputImages = [item.image]; renderInputImages(); renderGenImages(); } catch(e) { alert("Erreur chargement: " + e.message); } finally { stopLoading(); } };
  window.deleteItem = async (id) => { if(!confirm("Supprimer ?")) return; await fetch(`/api/history?id=${id}`, { method: "DELETE" }); if(state.currentHistoryId == id) { state.currentHistoryId = null; localStorage.removeItem('lastHistoryId'); } loadHistory(); };
  window.copyToClip = (t) => { navigator.clipboard.writeText(t); alert("Copié !"); };
  function switchTab(e) { const m = e.target.closest('.modal-content'); if (!m) return; m.querySelectorAll(".tab-link").forEach(b => b.classList.remove("active")); m.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden")); e.target.classList.add("active"); const target = $(e.target.dataset.tab); if(target) target.classList.remove("hidden"); }

  function init() {
    $("loading").classList.add("hidden");
    $("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
    $("closeSettings").onclick = () => { $("settingsModal").classList.add("hidden"); if(window.cancelImgStyleEdit) window.cancelImgStyleEdit(); };
    $("saveConfig").onclick = async () => { ["promptSystem", "promptTitles", "promptDesc", "promptHeadlines", "promptAdCopys", "promptTranslate"].forEach(id => state.config[id] = $(id).value); state.config.blacklist = $("configBlacklist").value; state.config.collections = Array.from(document.querySelectorAll('.collections-item')).map(r => ({ name: r.querySelector('.col-name').value, meaning: r.querySelector('.col-meaning').value })); state.config.headlineStyles = Array.from(document.querySelectorAll('.headline-style-item')).map(r => ({ name: r.querySelector('.style-name').value, prompt: r.querySelector('.style-prompt').value })); state.config.adStyles = Array.from(document.querySelectorAll('.ad-style-item')).map(r => ({ name: r.querySelector('.ad-style-name').value, prompt: r.querySelector('.ad-style-prompt').value })); await fetch("/api/settings", { method: "POST", body: JSON.stringify({ id: 'full_config', value: JSON.stringify(state.config) }) }); alert("Enregistré"); $("settingsModal").classList.add("hidden"); renderConfigUI(); };
    $("openHeadlinesBtn").onclick = () => { if(!state.currentHistoryId) return; $("headlinesModal").classList.remove("hidden"); renderSavedHl(); renderTranslationTabs('hl'); };
    $("openAdsBtn").onclick = () => { if(!state.currentHistoryId) return; $("adsModal").classList.remove("hidden"); renderSavedAds(); renderTranslationTabs('ad'); };
    $("closeHeadlines").onclick = () => $("headlinesModal").classList.add("hidden");
    $("closeAds").onclick = () => $("adsModal").classList.add("hidden");
    
    // --- CORRECTION DU BUG : Initialisation sécurisée des boutons du Tree Editor ---
    const addCatBtn = $("addCategoryBtn"); if(addCatBtn) addCatBtn.onclick = () => { const name = $("newCatName").value; if(!name) return; state.config.imgCategories.push({ id: "cat_" + Date.now(), name: name, order: 999 }); $("newCatName").value = ""; saveConfigToApi(); renderConfigUI(); };
    const saveNodeBtn = $("saveNodeBtn"); if(saveNodeBtn) saveNodeBtn.onclick = () => { const id = $("editNodeId").value; const type = $("editNodeType").value; const name = $("editNodeName").value; if (!name) return alert("Nom requis"); if (!id) { const newId = (type === 'group' ? 'grp_' : (type === 'folder' ? 'fol_' : 'sty_')) + Date.now(); const newItem = { id: newId, name, order: 9999 }; if (type === 'group') { newItem.categoryId = state.tempParentId; state.config.imgGroups.push(newItem); if(!state.treeExpandedIds.includes(state.tempParentId)) state.treeExpandedIds.push(state.tempParentId); } else { newItem.parentId = state.tempParentId; newItem.parentType = state.tempParentType; if(!state.treeExpandedIds.includes(state.tempParentId)) state.treeExpandedIds.push(state.tempParentId); if (type === 'style') { newItem.prompt = $("editNodePrompt").value; newItem.mode = $("editNodeMode").value; const file = $("editNodeFile").files[0]; if (file) { const r = new FileReader(); r.onload = (e) => { newItem.refImage = e.target.result.split(",")[1]; state.config.imgStyles.push(newItem); saveConfigToApi(); closeNodeEditor(); renderConfigUI(); }; r.readAsDataURL(file); return; } state.config.imgStyles.push(newItem); } else { state.config.imgFolders.push(newItem); } } } else { let list = (type === 'category') ? state.config.imgCategories : (type === 'group') ? state.config.imgGroups : (type === 'folder') ? state.config.imgFolders : state.config.imgStyles; const item = list.find(x => x.id === id); if (item) { item.name = name; if (type === 'style') { item.prompt = $("editNodePrompt").value; item.mode = $("editNodeMode").value; const file = $("editNodeFile").files[0]; if (file) { const r = new FileReader(); r.onload = (e) => { item.refImage = e.target.result.split(",")[1]; saveConfigToApi(); closeNodeEditor(); renderConfigUI(); }; r.readAsDataURL(file); return; } } } } saveConfigToApi(); closeNodeEditor(); renderConfigUI(); };
    const delNodeBtn = $("deleteNodeBtn"); if(delNodeBtn) delNodeBtn.onclick = () => { const id = $("editNodeId").value; const type = $("editNodeType").value; window.deleteNodeDirect(type, id); closeNodeEditor(); };
    const cancelNodeBtn = $("cancelNodeBtn"); if(cancelNodeBtn) cancelNodeBtn.onclick = closeNodeEditor;
    // -----------------------------------------------------------------------------

    $("openImgGenBtn").onclick = () => { if (!state.imageBase64) return alert("Veuillez d'abord uploader une image principale."); if (state.inputImages.length === 0) state.inputImages = [state.imageBase64]; renderInputImages(); $("imgGenModal").classList.remove("hidden"); renderStudioCategories(); renderImgStylesButtons(); renderGenImages(); };
    $("closeImgGen").onclick = () => $("imgGenModal").classList.add("hidden");
    $("sendImgGen").onclick = callGeminiImageGen;
    $("addInputImgBtn").onclick = () => $("extraImgInput").click();
    $("extraImgInput").onchange = (e) => { const files = Array.from(e.target.files); files.forEach(f => { const r = new FileReader(); r.onload = (ev) => { const b64 = ev.target.result.split(",")[1]; state.inputImages.push(b64); renderInputImages(); }; r.readAsDataURL(f); }); };
    $("saveImgSelectionBtn").onclick = window.saveImgSelection;
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
    $("imageInput").onchange = (e) => { const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = (ev) => { state.imageMime = ev.target.result.split(";")[0].split(":")[1]; state.imageBase64 = ev.target.result.split(",")[1]; $("previewImg").src = ev.target.result; $("preview").classList.remove("hidden"); $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false; state.currentHistoryId = null; state.inputImages = [state.imageBase64]; renderInputImages(); }; r.readAsDataURL(f); };
    $("removeImage").onclick = (e) => { e.stopPropagation(); state.imageBase64 = null; state.currentHistoryId = null; $("preview").classList.add("hidden"); $("dropPlaceholder").style.display = "block"; $("generateBtn").disabled = true; };
    $("historySearch").oninput = (e) => { state.searchQuery = e.target.value; state.currentPage = 1; renderHistoryUI(); };
    loadConfig(); 
    const lastId = localStorage.getItem('lastHistoryId');
    loadHistory().then(() => { if(lastId) window.restore(lastId); });
  }

  init();
})();
