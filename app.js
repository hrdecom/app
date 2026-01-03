(() => {
  const $ = (id) => document.getElementById(id);

  /* --- ICONS SVG --- */
  const ICONS = {
      category: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
      group: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>`,
      folder: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
      style: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>`,
      chevronDown: `<svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>`,
      chevronRight: `<svg width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4-4 4"/></svg>`
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
    
    // STRUCTURE HIERARCHIQUE
    imgCategories: [ { id: "cat_1", name: "Collier" } ],
    imgGroups: [ { id: "grp_1", name: "Petit collier", categoryId: "cat_1" } ],
    imgFolders: [ { id: "fol_1", name: "Photo portée", parentId: "grp_1", parentType: "group" } ],
    imgStyles: [ { id: "sty_1", name: "Sur cou", prompt: "On neck.", parentId: "fol_1", parentType: "folder" } ]
  };

  let state = {
    imageBase64: null, imageMime: "image/jpeg", historyCache: [],
    config: JSON.parse(JSON.stringify(DEFAULTS)),
    currentPage: 1, pageSize: 5, searchQuery: "", currentHistoryId: null,
    timerInterval: null, sessionHeadlines: [], sessionAds: [],
    selectedHeadlines: [], selectedAds: [], selHlStyles: [], selAdStyles: [],
    hlPage: 1, adPage: 1,
    
    // STATES IMAGES
    inputImages: [], sessionGeneratedImages: [], savedGeneratedImages: [], selectedSessionImagesIdx: [],
    
    // STATES UI STUDIO
    currentImgCategory: "",
    expandedGroups: [], // Liste des IDs de groupes ouverts
    activeFolderId: null, // ID du bouton multiple ouvert
    selectedImgStyles: [], 
    manualImgStyles: [],   
    
    // DRAG & DROP
    draggedItem: null
  };

  /* --- UTILS --- */
  const startLoading = () => { let s = 0; $("timer").textContent = "00:00"; if(state.timerInterval) clearInterval(state.timerInterval); state.timerInterval = setInterval(() => { s++; $("timer").textContent = `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`; }, 1000); $("loading").classList.remove("hidden"); };
  const stopLoading = () => { clearInterval(state.timerInterval); $("loading").classList.add("hidden"); };
  const formatLangUrl = (url, sub="en.") => url ? url.replace(/https:\/\/(en\.|dn\.|du\.|de\.|it\.|pl\.|pt-br\.|pt\.|es\.)/, "https://").replace("https://", `https://${sub}`) : "";

  /* --- CONFIG LOAD --- */
  async function loadConfig() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const saved = data.find(i => i.id === 'full_config');
    if (saved) {
      const parsed = JSON.parse(saved.value);
      state.config = { ...DEFAULTS, ...parsed }; 
      
      // AUTO MIGRATION (Fix bugs old structure)
      if (Array.isArray(state.config.imgCategories) && state.config.imgCategories.length > 0 && typeof state.config.imgCategories[0] === 'string') {
          state.config.imgCategories = state.config.imgCategories.map((c, i) => ({ id: "cat_" + i, name: c }));
          if (Array.isArray(state.config.imgGroups) && typeof state.config.imgGroups[0] === 'string') {
               const defaultCatId = state.config.imgCategories[0].id;
               state.config.imgGroups = state.config.imgGroups.map((g, i) => ({ id: "grp_" + i, name: g, categoryId: defaultCatId }));
          }
          if (!state.config.imgFolders) state.config.imgFolders = [];
          if (!state.config.imgStyles) state.config.imgStyles = [];
      }
    }
    
    if (state.config.imgCategories.length > 0) state.currentImgCategory = state.config.imgCategories[0].id;
    renderConfigUI();
  }

  function renderConfigUI() {
    ["promptSystem", "promptTitles", "promptDesc", "promptHeadlines", "promptAdCopys", "promptTranslate"].forEach(id => { if($(id)) $(id).value = state.config[id] || DEFAULTS[id]; });
    if($("configBlacklist")) $("configBlacklist").value = state.config.blacklist || "";
    
    // Listes simples
    $("collectionsList").innerHTML = (state.config.collections || []).map(c => `<div class="config-row collections-item" style="display:flex; gap:10px; margin-bottom:10px;"><input type="text" value="${c.name}" class="col-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="col-meaning" style="flex:2; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${c.meaning}</textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none;">×</button></div>`).join("");
    $("styleButtonsEditor").innerHTML = (state.config.headlineStyles || []).map(s => `<div class="config-row headline-style-item" style="display:flex; gap:10px; margin-bottom:10px;"><input type="text" value="${s.name}" class="style-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="style-prompt" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${s.prompt}</textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none;">×</button></div>`).join("");
    $("adStyleButtonsEditor").innerHTML = (state.config.adStyles || []).map(s => `<div class="config-row ad-style-item" style="display:flex; gap:10px; margin-bottom:10px;"><input type="text" value="${s.name}" class="ad-style-name" style="flex:1; border-radius:8px; border:1px solid #ddd; padding:8px;"><textarea class="ad-style-prompt" style="flex:3; height:45px; border-radius:8px; border:1px solid #ddd; padding:8px; font-size:12px;">${s.prompt}</textarea><button onclick="this.parentElement.remove()" style="color:red; border:none; background:none;">×</button></div>`).join("");
    $("collectionSelect").innerHTML = (state.config.collections || []).map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    
    renderStyleSelectors();
    renderImgConfigTree(); // L'arbre
    renderStudioCategories(); // La barre de navigation du studio
    renderImgStylesButtons(); // Le contenu du studio
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
     TREE EDITOR (HIERARCHY)
     ========================================= */

  function renderImgConfigTree() {
      const container = $("treeEditor");
      if(!container) return;
      container.innerHTML = "";

      state.config.imgCategories.forEach(cat => {
          const catNode = createTreeNode("category", cat, null);
          container.appendChild(catNode);
          const childrenContainer = catNode.querySelector('.tree-children');

          // A. Contenu GLOBAL (Directement dans Catégorie)
          const globalFolders = (state.config.imgFolders||[]).filter(f => f.parentType === 'category' && f.parentId === cat.id);
          const globalStyles = (state.config.imgStyles||[]).filter(s => s.parentType === 'category' && s.parentId === cat.id);
          [...globalFolders, ...globalStyles].forEach(item => childrenContainer.appendChild(createRecursiveNode(item.prompt!==undefined?'style':'folder', item)));

          // B. GROUPES
          const groups = (state.config.imgGroups||[]).filter(g => g.categoryId === cat.id);
          groups.forEach(grp => {
              const grpNode = createTreeNode("group", grp, cat.id);
              childrenContainer.appendChild(grpNode);
              const grpChildren = grpNode.querySelector('.tree-children');

              // C. Contenu du GROUPE
              const grpFolders = (state.config.imgFolders||[]).filter(f => f.parentType === 'group' && f.parentId === grp.id);
              const grpStyles = (state.config.imgStyles||[]).filter(s => s.parentType === 'group' && s.parentId === grp.id);
              [...grpFolders, ...grpStyles].forEach(item => grpChildren.appendChild(createRecursiveNode(item.prompt!==undefined?'style':'folder', item)));
          });
      });
  }

  function createRecursiveNode(type, item) {
      const node = createTreeNode(type, item, item.parentId);
      if (type === 'folder') {
          const childrenContainer = node.querySelector('.tree-children');
          const styles = (state.config.imgStyles||[]).filter(s => s.parentType === 'folder' && s.parentId === item.id);
          styles.forEach(s => childrenContainer.appendChild(createRecursiveNode('style', s)));
      }
      return node;
  }

  function createTreeNode(type, data, parentId) {
      const el = document.createElement('div');
      el.className = `tree-node type-${type}`;
      el.setAttribute('draggable', 'true');
      el.setAttribute('data-id', data.id);
      el.setAttribute('data-type', type);
      
      let icon = ICONS[type] || ICONS.style;
      let label = data.name;
      if (type === 'folder') label = data.name; // "Bouton Multi" dans l'UI tree ? non on garde le nom

      // Boutons d'ajout contextuels
      let addBtns = "";
      if (type === "category") addBtns = `<button class="small-action-btn" onclick="window.addNode('group', '${data.id}')">+ Groupe</button> <button class="small-action-btn" onclick="window.addNode('folder', '${data.id}', 'category')">+ Bouton Multi</button> <button class="small-action-btn" onclick="window.addNode('style', '${data.id}', 'category')">+ Style</button>`;
      if (type === "group") addBtns = `<button class="small-action-btn" onclick="window.addNode('folder', '${data.id}', 'group')">+ Bouton Multi</button> <button class="small-action-btn" onclick="window.addNode('style', '${data.id}', 'group')">+ Style</button>`;
      if (type === "folder") addBtns = `<button class="small-action-btn" onclick="window.addNode('style', '${data.id}', 'folder')">+ Style</button>`;

      el.innerHTML = `
        <div class="tree-header">
            <span class="node-icon">${icon}</span>
            <span class="node-label">${label}</span>
            <div class="node-actions">
                ${addBtns}
                <button class="small-action-btn" onclick="window.editNode('${type}', '${data.id}')">✏️</button>
            </div>
        </div>
        <div class="tree-children"></div>
      `;

      // DRAG & DROP LOGIC
      const header = el.querySelector('.tree-header');
      
      el.addEventListener('dragstart', (e) => {
          state.draggedItem = { id: data.id, type: type };
          e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; el.style.opacity = '0.5';
      });
      el.addEventListener('dragend', (e) => {
          el.style.opacity = '1'; state.draggedItem = null;
          document.querySelectorAll('.drag-over-center').forEach(x => x.classList.remove('drag-over-center'));
      });
      header.addEventListener('dragover', (e) => {
          e.preventDefault(); e.stopPropagation();
          if(!state.draggedItem || state.draggedItem.id === data.id) return;
          // Rules
          const src = state.draggedItem.type; const dest = type;
          let allow = false;
          if (src === 'group' && dest === 'category') allow = true;
          if (src === 'folder' && (dest === 'category' || dest === 'group')) allow = true;
          if (src === 'style' && (dest === 'category' || dest === 'group' || dest === 'folder')) allow = true;
          if (allow) header.classList.add('drag-over-center');
      });
      header.addEventListener('dragleave', (e) => header.classList.remove('drag-over-center'));
      header.addEventListener('drop', (e) => {
          e.preventDefault(); e.stopPropagation(); header.classList.remove('drag-over-center');
          if(state.draggedItem && state.draggedItem.id !== data.id) window.moveNode(state.draggedItem, { id: data.id, type: type });
      });

      return el;
  }

  /* --- CRUD ACTIONS --- */
  window.addCategoryBtn = $("addCategoryBtn");
  if(window.addCategoryBtn) window.addCategoryBtn.onclick = () => {
      const name = $("newCatName").value; if(!name) return;
      state.config.imgCategories.push({ id: "cat_" + Date.now(), name: name });
      $("newCatName").value = ""; renderConfigUI();
  };

  window.addNode = (newType, parentId, parentTypeContext) => openNodeEditor(null, newType, parentId, parentTypeContext);
  window.editNode = (type, id) => openNodeEditor(id, type, null, null);

  function openNodeEditor(id, type, parentId, parentTypeContext) {
      $("nodeEditorOverlay").classList.remove("hidden");
      $("editNodeId").value = id || ""; $("editNodeType").value = type;
      state.tempParentId = parentId; state.tempParentType = parentTypeContext;
      
      // Reset
      $("editNodeName").value = ""; $("editNodePrompt").value = ""; $("editNodeFile").value = "";
      $("editNodeImgPreview").innerHTML = "Aucune"; $("editPromptContainer").classList.add("hidden");
      
      let title = id ? "Modifier " : "Créer ";
      let placeholder = "Nom...";
      
      if (type === 'category') { title += "Catégorie"; }
      else if (type === 'group') { title += "Groupe"; placeholder = "Ex: Matières, Couleurs..."; }
      else if (type === 'folder') { title += "Bouton Multiple"; placeholder = "Nom du bouton (Ex: Photo Portée)"; }
      else if (type === 'style') { 
          title += "Style (Action)"; 
          $("editPromptContainer").classList.remove("hidden"); 
      }
      
      $("nodeEditorTitle").textContent = title;
      $("editNodeName").placeholder = placeholder;

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
  }

  $("saveNodeBtn").onclick = () => {
      const id = $("editNodeId").value; const type = $("editNodeType").value; const name = $("editNodeName").value;
      if (!name) return alert("Nom requis");

      // Helper save
      const saveToState = (newItem) => {
          if (!id) {
              if(type === 'category') state.config.imgCategories.push(newItem);
              else if(type === 'group') state.config.imgGroups.push(newItem);
              else if(type === 'folder') state.config.imgFolders.push(newItem);
              else state.config.imgStyles.push(newItem);
          } else {
              // Update existing references are handled because objects are ref types, but simplistic approach:
              // We find the object again and update props
              let list = (type === 'category') ? state.config.imgCategories : (type === 'group') ? state.config.imgGroups : (type === 'folder') ? state.config.imgFolders : state.config.imgStyles;
              const found = list.find(x => x.id === id);
              if(found) Object.assign(found, newItem);
          }
          closeNodeEditor(); renderConfigUI();
      };

      const newItem = id ? { id } : { id: (type === 'group' ? 'grp_' : (type === 'folder' ? 'fol_' : 'sty_')) + Date.now() };
      newItem.name = name;
      
      if (!id) {
          if (type === 'group') newItem.categoryId = state.tempParentId;
          else if (type === 'folder' || type === 'style') { newItem.parentId = state.tempParentId; newItem.parentType = state.tempParentType; }
      }

      if (type === 'style') {
          newItem.prompt = $("editNodePrompt").value; newItem.mode = $("editNodeMode").value;
          const file = $("editNodeFile").files[0];
          if (file) {
              const r = new FileReader();
              r.onload = (e) => { newItem.refImage = e.target.result.split(",")[1]; saveToState(newItem); };
              r.readAsDataURL(file);
              return;
          }
      }
      saveToState(newItem);
  };

  $("deleteNodeBtn").onclick = () => {
      const id = $("editNodeId").value; const type = $("editNodeType").value;
      if(!id) return closeNodeEditor();
      if(!confirm("Supprimer cet élément et tout son contenu ?")) return;
      
      // Cascade delete simple
      const removeChildren = (parentId, parentType) => {
          // Folders children of this parent
          const folders = state.config.imgFolders.filter(f => f.parentId === parentId && f.parentType === parentType);
          folders.forEach(f => removeChildren(f.id, 'folder')); // Recurse
          state.config.imgFolders = state.config.imgFolders.filter(f => !(f.parentId === parentId && f.parentType === parentType));
          
          // Styles children of this parent
          state.config.imgStyles = state.config.imgStyles.filter(s => !(s.parentId === parentId && s.parentType === parentType));
      };

      if (type === 'category') {
          state.config.imgCategories = state.config.imgCategories.filter(x => x.id !== id);
          const groups = state.config.imgGroups.filter(g => g.categoryId === id);
          groups.forEach(g => removeChildren(g.id, 'group'));
          state.config.imgGroups = state.config.imgGroups.filter(x => x.categoryId !== id);
          removeChildren(id, 'category'); // Global items
      } else if (type === 'group') {
          state.config.imgGroups = state.config.imgGroups.filter(x => x.id !== id);
          removeChildren(id, 'group');
      } else if (type === 'folder') {
          state.config.imgFolders = state.config.imgFolders.filter(x => x.id !== id);
          removeChildren(id, 'folder');
      } else if (type === 'style') {
          state.config.imgStyles = state.config.imgStyles.filter(x => x.id !== id);
      }
      closeNodeEditor(); renderConfigUI();
  };

  $("cancelNodeBtn").onclick = closeNodeEditor;
  function closeNodeEditor() { $("nodeEditorOverlay").classList.add("hidden"); }

  window.moveNode = (src, dest) => {
      // Basic Drop logic: Update Parent
      const itemList = (src.type === 'group') ? state.config.imgGroups : (src.type === 'folder') ? state.config.imgFolders : state.config.imgStyles;
      const item = itemList.find(x => x.id === src.id);
      if(!item) return;

      if (src.type === 'group') item.categoryId = dest.id;
      else { item.parentId = dest.id; item.parentType = dest.type; }
      renderConfigUI();
  };


  /* =========================================
     STUDIO UI (NEW APPLE DESIGN)
     ========================================= */
  
  function renderStudioCategories() {
      const container = $("imgGenCategoriesBar");
      if(!container) return;
      
      const cats = state.config.imgCategories || [];
      // Auto select
      if (!state.currentImgCategory && cats.length > 0) state.currentImgCategory = cats[0].id;

      container.className = "studio-cat-bar";
      container.innerHTML = cats.map(c => `
         <div class="studio-cat-pill ${state.currentImgCategory === c.id ? 'selected' : ''}" 
              onclick="window.setImgCategory('${c.id}')">
            ${c.name}
         </div>
      `).join("");
  }

  window.setImgCategory = (cId) => {
      state.currentImgCategory = cId;
      state.expandedGroups = []; // Reset accordions
      state.activeFolderId = null; // Close folders
      renderStudioCategories();
      renderImgStylesButtons();
  };

  function renderImgStylesButtons() {
      const container = $("imgGenStylesContainer");
      if(!container) return;
      container.innerHTML = "";

      if (!state.currentImgCategory) {
          container.innerHTML = `<div style="padding:20px; color:#999; text-align:center;">Veuillez configurer des catégories.</div>`;
          return;
      }

      const content = document.createElement('div');
      content.className = "studio-content";

      // 1. GLOBAL ITEMS (Top of the page)
      const globalFolders = (state.config.imgFolders||[]).filter(f => f.parentType === 'category' && f.parentId === state.currentImgCategory);
      const globalStyles = (state.config.imgStyles||[]).filter(s => s.parentType === 'category' && s.parentId === state.currentImgCategory);

      if (globalFolders.length > 0 || globalStyles.length > 0) {
          const globalSection = document.createElement('div');
          globalSection.className = "studio-global-section";
          
          globalFolders.forEach(f => globalSection.appendChild(renderFolderBtn(f)));
          globalStyles.forEach(s => globalSection.appendChild(renderStyleBtn(s)));
          
          content.appendChild(globalSection);
          
          // Render Content of opened Global Folder immediately below
          if (state.activeFolderId && globalFolders.find(f => f.id === state.activeFolderId)) {
              content.appendChild(renderFolderContent(state.activeFolderId));
          }
      }

      // 2. GROUPS (Accordions)
      const groups = (state.config.imgGroups||[]).filter(g => g.categoryId === state.currentImgCategory);
      
      groups.forEach(grp => {
          const groupEl = document.createElement('div');
          groupEl.className = "accordion-group";
          
          const isOpen = state.expandedGroups.includes(grp.id);
          
          // Header
          const header = document.createElement('div');
          header.className = `accordion-header ${isOpen ? 'active' : ''}`;
          header.innerHTML = `<span>${grp.name}</span> <span style="color:#999">${isOpen ? ICONS.chevronDown : ICONS.chevronRight}</span>`;
          header.onclick = () => window.toggleGroup(grp.id);
          groupEl.appendChild(header);

          // Body
          if (isOpen) {
              const body = document.createElement('div');
              body.className = "accordion-body";
              
              const grpFolders = (state.config.imgFolders||[]).filter(f => f.parentType === 'group' && f.parentId === grp.id);
              const grpStyles = (state.config.imgStyles||[]).filter(s => s.parentType === 'group' && s.parentId === grp.id);
              
              grpFolders.forEach(f => body.appendChild(renderFolderBtn(f)));
              grpStyles.forEach(s => body.appendChild(renderStyleBtn(s)));
              
              groupEl.appendChild(body);

              // If a folder inside THIS group is open, render its content inside the group body or below it?
              // User said "affochent les boutons associés en dessous". 
              // We'll put it inside the body for visual grouping.
              if (state.activeFolderId && grpFolders.find(f => f.id === state.activeFolderId)) {
                  const folderContent = renderFolderContent(state.activeFolderId);
                  folderContent.style.marginTop = "0"; // adjust spacing
                  folderContent.style.borderTop = "1px solid #eee";
                  folderContent.style.background = "#fafafa";
                  groupEl.appendChild(folderContent);
              }
          }
          
          content.appendChild(groupEl);
      });

      container.appendChild(content);
  }

  window.toggleGroup = (grpId) => {
      const idx = state.expandedGroups.indexOf(grpId);
      if (idx > -1) state.expandedGroups.splice(idx, 1);
      else state.expandedGroups.push(grpId);
      renderImgStylesButtons();
  };

  window.toggleFolder = (fId) => {
      state.activeFolderId = (state.activeFolderId === fId) ? null : fId;
      renderImgStylesButtons();
  };

  function renderFolderBtn(f) {
      const btn = document.createElement('button');
      const isActive = state.activeFolderId === f.id;
      btn.className = `studio-btn multi-btn ${isActive ? 'active' : ''}`;
      // Note: "folder" icon inside button
      btn.innerHTML = `<span>${ICONS.folder} ${f.name}</span> <span style="font-size:10px">${isActive ? '▼' : '▶'}</span>`;
      btn.onclick = () => window.toggleFolder(f.id);
      return btn;
  }

  function renderFolderContent(folderId) {
      const box = document.createElement('div');
      box.className = "multi-content-box";
      
      const children = (state.config.imgStyles||[]).filter(s => s.parentType === 'folder' && s.parentId === folderId);
      if (children.length === 0) {
          box.innerHTML = `<span style="font-size:11px; color:#999;">Vide.</span>`;
      } else {
          children.forEach(s => box.appendChild(renderStyleBtn(s)));
      }
      return box;
  }

  function renderStyleBtn(s) {
      const btn = document.createElement('button');
      const isManual = s.mode === 'manual';
      const isSelected = isManual ? state.manualImgStyles.includes(s.name) : state.selectedImgStyles.some(sel => sel.name === s.name);
      
      btn.className = `studio-btn ${isManual ? 'manual' : ''} ${isSelected ? 'selected' : ''}`;
      
      let iconHTML = "";
      if (s.refImage) iconHTML = `<img src="data:image/jpeg;base64,${s.refImage}" class="studio-btn-icon">`;
      
      btn.innerHTML = `${iconHTML} ${s.name} ${isManual ? '<span style="font-size:9px">📝</span>' : ''}`;
      
      btn.onclick = () => window.toggleImgStyle(s.name);
      return btn;
  }

  // --- LOGIC TOGGLE STYLE ---
  window.toggleImgStyle = (styleName) => {
      const style = state.config.imgStyles.find(s => s.name === styleName);
      if(!style) return;
      const promptClean = style.prompt.trim();

      if (style.mode === 'manual') {
          const idx = state.manualImgStyles.indexOf(styleName);
          let currentText = $("imgGenPrompt").value.trim();
          if (idx > -1) {
              state.manualImgStyles.splice(idx, 1);
              if (currentText.includes(promptClean)) {
                  const parts = currentText.split(promptClean);
                  currentText = parts.map(p => p.trim()).filter(p => p).join(" ");
                  $("imgGenPrompt").value = currentText;
              }
              if (style.refImage) { const imgIdx = state.inputImages.indexOf(style.refImage); if (imgIdx > -1) state.inputImages.splice(imgIdx, 1); renderInputImages(); }
          } else {
              state.manualImgStyles.push(styleName);
              if (!currentText.includes(promptClean)) $("imgGenPrompt").value = (currentText + " " + promptClean).trim();
              if (style.refImage && !state.inputImages.includes(style.refImage)) { state.inputImages.push(style.refImage); renderInputImages(); }
          }
      } else {
          const idx = state.selectedImgStyles.findIndex(s => s.name === styleName);
          if (idx > -1) state.selectedImgStyles.splice(idx, 1); else state.selectedImgStyles.push(style);
      }
      renderImgStylesButtons();
  };

  /* --- Reste du code API (inchangé) --- */
  
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
          localStorage.setItem('lastHistoryId', hData.id);
          state.sessionHeadlines = []; state.sessionAds = []; state.selectedHeadlines = []; state.selectedAds = []; state.headlinesTrans = {}; state.adsTrans = {}; 
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

  function renderInputImages() {
    const container = $("inputImagesPreview");
    if (state.inputImages.length === 0) { container.classList.add("hidden"); return; }
    container.classList.remove("hidden");
    container.innerHTML = state.inputImages.map((img, i) => `
        <div class="input-img-wrapper"><img src="data:image/jpeg;base64,${img}" class="input-img-thumb"><div class="remove-input-img" onclick="window.removeInputImg(${i})">×</div></div>`).join("");
  }
  
  window.removeInputImg = (i) => { state.inputImages.splice(i, 1); renderInputImages(); };
  
  async function callGeminiImageGen() {
      const userPrompt = $("imgGenPrompt").value;
      if (!userPrompt && state.selectedImgStyles.length === 0) return alert("Veuillez entrer une description ou sélectionner un style.");
      const count = parseInt($("imgCount").value) || 1;
      const aspectRatio = $("imgAspectRatio").value;
      const resolution = $("imgResolution").value;

      if (state.inputImages.length === 0 && state.imageBase64) { state.inputImages = [state.imageBase64]; renderInputImages(); }

      const batches = [];
      const inputsToProcess = state.inputImages.length > 0 ? state.inputImages : [null];

      inputsToProcess.forEach(inputImg => {
          let tasks = [];
          if (state.selectedImgStyles.length > 0) {
              tasks = state.selectedImgStyles.map(s => ({ type: 'style', styleObj: s, prompt: userPrompt ? (userPrompt + " " + s.prompt) : s.prompt, refImage: s.refImage, label: s.name }));
          } else { tasks = [{ type: 'manual', prompt: userPrompt, refImage: null, label: userPrompt }]; }

          tasks.forEach(task => {
              let contextImages = [];
              if (inputImg) contextImages.push(inputImg); 
              if (task.refImage) contextImages.push(task.refImage); 
              for (let i = 0; i < count; i++) { batches.push({ prompt: task.prompt, images: contextImages, aspectRatio: aspectRatio, resolution: resolution, label: task.label }); }
          });
      });

      const newItems = batches.map(b => ({ id: Date.now() + Math.random(), loading: true, prompt: b.label, aspectRatio: b.aspectRatio }));
      state.sessionGeneratedImages.unshift(...newItems);
      renderGenImages();

      state.selectedImgStyles = []; state.manualImgStyles = []; $("imgGenPrompt").value = ""; renderImgStylesButtons(); 

      newItems.forEach(async (item, index) => {
          const batchData = batches[index];
          try {
              const res = await fetch("/api/gemini", { method: "POST", body: JSON.stringify({ prompt: batchData.prompt, images: batchData.images, aspectRatio: batchData.aspectRatio, resolution: batchData.resolution }) });
              const data = await res.json();
              const targetItem = state.sessionGeneratedImages.find(x => x.id === item.id);
              if (targetItem) {
                  if (data.error) { targetItem.loading = false; targetItem.error = data.error; } 
                  else { targetItem.loading = false; targetItem.image = data.image; }
                  renderGenImages();
              }
          } catch(e) {
              const targetItem = state.sessionGeneratedImages.find(x => x.id === item.id);
              if (targetItem) { targetItem.loading = false; targetItem.error = e.message; renderGenImages(); }
          }
      });
  }

  function renderGenImages() {
      const sessionContainer = $("imgGenSessionResults");
      sessionContainer.innerHTML = state.sessionGeneratedImages.map((item, i) => {
        if (item.loading) { return `<div class="gen-image-card" style="display:flex; align-items:center; justify-content:center; background:#eee; height:150px; flex-direction:column; gap:10px;"><div class="spinner" style="width:20px; height:20px; border-width:2px;"></div><span style="font-size:10px; color:#666;">Génération...</span><div class="gen-image-overlay">${item.prompt}</div></div>`; }
        if (item.error) { return `<div class="gen-image-card" style="display:flex; align-items:center; justify-content:center; background:#ffebeb; height:150px; flex-direction:column; gap:5px; padding:10px; text-align:center;"><span style="font-size:20px;">⚠️</span><span style="font-size:10px; color:red;">Erreur</span><div class="gen-image-overlay" style="color:red;">${item.error}</div></div>`; }
        return `<div class="gen-image-card ${state.selectedSessionImagesIdx.includes(item) ? 'selected' : ''}" onclick="window.toggleSessionImg('${item.id}')"><img src="data:image/jpeg;base64,${item.image}"><div class="gen-image-overlay">${item.prompt}</div><button class="icon-btn-small" style="position:absolute; top:5px; right:5px; width:20px; height:20px; font-size:10px; display:flex; justify-content:center; align-items:center; background:rgba(255,255,255,0.9); color:#333; border:1px solid #ccc;" onclick="event.stopPropagation(); window.viewImage('${item.image}')">🔍</button></div>`;
      }).join("");

      let savedHtml = "";
      if(state.imageBase64) { savedHtml += `<div class="gen-image-card no-drag" style="border:2px solid var(--text-main); cursor:default;"><img src="data:image/jpeg;base64,${state.imageBase64}"><div class="gen-image-overlay" style="background:var(--text-main); color:white; font-weight:bold;">ORIGINAL</div><button class="icon-btn-small" style="position:absolute; top:5px; right:5px; width:20px; height:20px; font-size:12px; display:flex; justify-content:center; align-items:center; background:var(--apple-blue); color:white; border:none;" onclick="event.stopPropagation(); window.addSavedToInputOrig()" title="Utiliser">＋</button></div>`; }

      savedHtml += state.savedGeneratedImages.map((item, i) => {
          const isSelected = state.inputImages.includes(item.image);
          const borderStyle = isSelected ? 'border:3px solid var(--apple-blue); box-shadow:0 0 10px rgba(0,122,255,0.3);' : '';
          return `<div class="gen-image-card" style="${borderStyle}" draggable="true" ondragstart="dragStart(event, ${i})" ondrop="drop(event, ${i})" ondragenter="dragEnter(event, ${i})" ondragover="allowDrop(event)" onclick="window.toggleSavedImg(${i})"><img src="data:image/jpeg;base64,${item.image}" style="pointer-events:none;"><div class="gen-image-overlay">${item.prompt}</div><button class="icon-btn-small" style="position:absolute; top:5px; right:30px; width:20px; height:20px; font-size:10px; display:flex; justify-content:center; align-items:center; background:rgba(255,255,255,0.9); color:#333; border:1px solid #ccc;" onclick="event.stopPropagation(); window.viewImage('${item.image}')">🔍</button><button class="icon-btn-small" style="position:absolute; top:5px; right:5px; width:20px; height:20px; font-size:10px; display:flex; justify-content:center; align-items:center; background:rgba(255,255,255,0.9); color:red; border:1px solid #ccc;" onclick="event.stopPropagation(); window.deleteSavedImage(${i})">×</button></div>`;
      }).join("");
      $("imgGenSavedResults").innerHTML = savedHtml;
  }

  window.toggleSavedImg = (index) => {
      const item = state.savedGeneratedImages[index]; if(!item) return;
      const idx = state.inputImages.indexOf(item.image); if(idx > -1) state.inputImages.splice(idx, 1); else state.inputImages.push(item.image);
      renderInputImages(); renderGenImages();
  };

  let dragSrcIndex = null;
  window.dragStart = (e, i) => { dragSrcIndex = i; e.dataTransfer.effectAllowed = 'move'; e.target.style.opacity = '0.4'; };
  window.allowDrop = (e) => { e.preventDefault(); };
  window.dragEnter = (e, targetIndex) => {
      if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;
      const item = state.savedGeneratedImages.splice(dragSrcIndex, 1)[0]; state.savedGeneratedImages.splice(targetIndex, 0, item);
      dragSrcIndex = targetIndex; renderGenImages();
      const cards = document.querySelectorAll('#imgGenSavedResults .gen-image-card'); if(cards[dragSrcIndex]) cards[dragSrcIndex].style.opacity = '0.4';
  };
  window.drop = async (e, i) => {
      e.preventDefault(); document.querySelectorAll('.gen-image-card').forEach(c => c.style.opacity = '1'); dragSrcIndex = null;
      if (state.currentHistoryId) { try { await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, generated_images: JSON.stringify(state.savedGeneratedImages) }) }); } catch(err) {} }
  };

  window.addSavedToInput = (index) => {
      const item = state.savedGeneratedImages[index]; if(item && !state.inputImages.includes(item.image)) { state.inputImages.push(item.image); renderInputImages(); document.querySelector('button[data-tab="tab-img-chat"]').click(); }
  };

  window.addSavedToInputOrig = () => {
      if(state.imageBase64 && !state.inputImages.includes(state.imageBase64)) { state.inputImages.push(state.imageBase64); renderInputImages(); document.querySelector('button[data-tab="tab-img-chat"]').click(); }
  };

  window.toggleSessionImg = (id) => {
      const item = state.sessionGeneratedImages.find(x => x.id == id); if(!item) return;
      const idx = state.selectedSessionImagesIdx.indexOf(item);
      if (idx > -1) { state.selectedSessionImagesIdx.splice(idx, 1); const imgToRemove = item.image; const inputIdx = state.inputImages.indexOf(imgToRemove); if (inputIdx > -1) state.inputImages.splice(inputIdx, 1); }
      else { state.selectedSessionImagesIdx.push(item); if (!state.inputImages.includes(item.image)) state.inputImages.push(item.image); }
      renderInputImages(); renderGenImages();
  };

  window.viewImage = (b64) => {
      const byteCharacters = atob(b64); const byteNumbers = new Array(byteCharacters.length); for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers); const blob = new Blob([byteArray], {type: 'image/jpeg'}); const blobUrl = URL.createObjectURL(blob); window.open(blobUrl, '_blank');
  };

  window.saveImgSelection = async () => {
      if (!state.currentHistoryId) return alert("Veuillez d'abord générer/charger un produit.");
      if (state.selectedSessionImagesIdx.length === 0) return alert("Aucune image sélectionnée.");
      const newImages = state.selectedSessionImagesIdx.map(item => ({ image: item.image, prompt: item.prompt, aspectRatio: item.aspectRatio }));
      state.savedGeneratedImages = [...newImages, ...state.savedGeneratedImages]; state.selectedSessionImagesIdx = [];
      startLoading();
      try {
          const res = await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, generated_images: JSON.stringify(state.savedGeneratedImages) }) });
          if (!res.ok) throw new Error("Erreur serveur");
          alert("Images enregistrées !"); renderGenImages(); document.querySelector('button[data-tab="tab-img-saved"]').click();
      } catch(e) { alert("Erreur sauvegarde: " + e.message); } finally { stopLoading(); }
  };

  window.deleteSavedImage = async (index) => {
      if(!confirm("Supprimer cette image ?")) return;
      state.savedGeneratedImages.splice(index, 1); startLoading();
      try { await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, generated_images: JSON.stringify(state.savedGeneratedImages) }) }); renderGenImages(); } catch(e) { alert(e.message); } finally { stopLoading(); }
  };

  async function loadHistory() { try { const r = await fetch("/api/history"); state.historyCache = await r.json(); renderHistoryUI(); } catch(e){} }

  function renderHistoryUI() {
    const filtered = (state.historyCache || []).filter(i => (i.title||"").toLowerCase().includes(state.searchQuery.toLowerCase()));
    const start = (state.currentPage - 1) * 5; const pag = filtered.slice(start, start + 5);
    $("historyList").innerHTML = pag.map(item => `<div class="history-item ${state.currentHistoryId == item.id ? 'active-history' : ''}" onclick="restore(${item.id})"><img src="data:image/jpeg;base64,${item.image}" class="history-img"><div style="flex:1"><h4>${item.title || "Sans titre"}</h4></div><button onclick="event.stopPropagation(); deleteItem(${item.id})">🗑</button></div>`).join("");
    renderPagination(Math.ceil(filtered.length / 5));
  }

  function renderPagination(total) {
    const p = $("pagination"); p.innerHTML = ""; if(total <= 1) return;
    for(let i=1; i<=total; i++) { const b = document.createElement("button"); b.textContent = i; if(i === state.currentPage) b.className = "active"; b.onclick = () => { state.currentPage = i; renderHistoryUI(); }; p.appendChild(b); }
  }

  window.restore = async (id) => {
    state.currentHistoryId = id; localStorage.setItem('lastHistoryId', id); renderHistoryUI(); startLoading();
    try {
        const res = await fetch(`/api/history?id=${id}`); const item = await res.json();
        state.sessionHeadlines = []; state.sessionAds = [];
        state.selectedHeadlines = item.headlines ? JSON.parse(item.headlines) : []; state.selectedAds = item.ad_copys ? JSON.parse(item.ad_copys) : [];
        state.headlinesTrans = item.headlines_trans ? JSON.parse(item.headlines_trans) : {}; state.adsTrans = item.ads_trans ? JSON.parse(item.ads_trans) : {};
        state.savedGeneratedImages = item.generated_images ? JSON.parse(item.generated_images) : [];
        state.sessionGeneratedImages = []; $("titleText").textContent = item.title; $("descText").textContent = item.description; 
        $("productUrlInput").value = item.product_url || ""; $("previewImg").src = `data:image/jpeg;base64,${item.image}`; state.imageBase64 = item.image; 
        $("preview").classList.remove("hidden"); $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false;
        state.inputImages = [item.image]; renderInputImages(); renderGenImages();
    } catch(e) { alert("Erreur chargement: " + e.message); } finally { stopLoading(); }
  };

  window.deleteItem = async (id) => { if(!confirm("Supprimer ?")) return; await fetch(`/api/history?id=${id}`, { method: "DELETE" }); if(state.currentHistoryId == id) { state.currentHistoryId = null; localStorage.removeItem('lastHistoryId'); } loadHistory(); };
  
  window.copyToClip = (t) => { navigator.clipboard.writeText(t); alert("Copié !"); };

  function switchTab(e) {
    const m = e.target.closest('.modal-content'); if (!m) return;
    m.querySelectorAll(".tab-link").forEach(b => b.classList.remove("active")); m.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
    e.target.classList.add("active"); const target = $(e.target.dataset.tab); if(target) target.classList.remove("hidden");
  }

  function init() {
    $("loading").classList.add("hidden");
    $("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
    $("closeSettings").onclick = () => { $("settingsModal").classList.add("hidden"); if(window.cancelImgStyleEdit) window.cancelImgStyleEdit(); };
    $("saveConfig").onclick = async () => {
      ["promptSystem", "promptTitles", "promptDesc", "promptHeadlines", "promptAdCopys", "promptTranslate"].forEach(id => state.config[id] = $(id).value);
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
    
    $("openImgGenBtn").onclick = () => {
        if (!state.imageBase64) return alert("Veuillez d'abord uploader une image principale.");
        if (state.inputImages.length === 0) state.inputImages = [state.imageBase64];
        renderInputImages();
        $("imgGenModal").classList.remove("hidden");
        renderStudioCategories();
        renderImgStylesButtons();
        renderGenImages();
    };
    $("closeImgGen").onclick = () => $("imgGenModal").classList.add("hidden");
    $("sendImgGen").onclick = callGeminiImageGen;
    $("addInputImgBtn").onclick = () => $("extraImgInput").click();
    $("extraImgInput").onchange = (e) => {
        const files = Array.from(e.target.files);
        files.forEach(f => { const r = new FileReader(); r.onload = (ev) => { const b64 = ev.target.result.split(",")[1]; state.inputImages.push(b64); renderInputImages(); }; r.readAsDataURL(f); });
    };
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
    $("imageInput").onchange = (e) => {
      const f = e.target.files[0]; if(!f) return;
      const r = new FileReader(); r.onload = (ev) => {
        state.imageMime = ev.target.result.split(";")[0].split(":")[1]; state.imageBase64 = ev.target.result.split(",")[1];
        $("previewImg").src = ev.target.result; $("preview").classList.remove("hidden");
        $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false; state.currentHistoryId = null;
        state.inputImages = [state.imageBase64]; renderInputImages();
      }; r.readAsDataURL(f);
    };
    $("removeImage").onclick = (e) => { e.stopPropagation(); state.imageBase64 = null; state.currentHistoryId = null; $("preview").classList.add("hidden"); $("dropPlaceholder").style.display = "block"; $("generateBtn").disabled = true; };
    $("historySearch").oninput = (e) => { state.searchQuery = e.target.value; state.currentPage = 1; renderHistoryUI(); };
    loadConfig(); 
    
    const lastId = localStorage.getItem('lastHistoryId');
    loadHistory().then(() => { if(lastId) window.restore(lastId); });
  }

  init();
})();
