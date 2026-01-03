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
    imgStyles: [], 
    imgFolders: [], // { id, name, category, group } -> "Boutons Choix Multiple"
    imgGroups: ["Couleurs", "Matériaux"], 
    imgCategories: ["Packaging", "Ambiance", "Mannequin"]
  };

  const LANGUAGES = { "Danish": "dn.", "Dutch": "du.", "German": "de.", "Italian": "it.", "Polish": "pl.", "Portuguese (Brazil)": "pt-br.", "Portuguese (Portugal)": "pt.", "Spanish": "es." };

  let state = {
    imageBase64: null, imageMime: "image/jpeg", historyCache: [],
    config: JSON.parse(JSON.stringify(DEFAULTS)),
    currentPage: 1, pageSize: 5, searchQuery: "", currentHistoryId: null,
    timerInterval: null, sessionHeadlines: [], sessionAds: [],
    selectedHeadlines: [], selectedAds: [], headlinesTrans: {}, adsTrans: {},
    selHlStyles: [], selAdStyles: [], hlPage: 1, adPage: 1,
    inputImages: [], sessionGeneratedImages: [], savedGeneratedImages: [], selectedSessionImagesIdx: [],
    currentImgCategory: "", selectedImgStyles: [], manualImgStyles: [],
    expandedGroups: [], 
    activeMultiChoiceId: null,
    draggedConfigItem: null, editingItem: null
  };

  // --- UTILS ---
  const startLoading = () => { let s = 0; $("timer").textContent = "00:00"; if (state.timerInterval) clearInterval(state.timerInterval); state.timerInterval = setInterval(() => { s++; const mm = String(Math.floor(s/60)).padStart(2,"0"); const ss = String(s%60).padStart(2,"0"); $("timer").textContent = `${mm}:${ss}`; }, 1000); $("loading").classList.remove("hidden"); };
  const stopLoading = () => { clearInterval(state.timerInterval); $("loading").classList.add("hidden"); };
  const formatLangUrl = (url, sub = "en.") => { if (!url) return ""; let cleanUrl = url.replace(/https:\/\/(en\.|dn\.|du\.|de\.|it\.|pl\.|pt-br\.|pt\.|es\.)/, "https://"); return cleanUrl.replace("https://", `https://${sub}`); };

  // --- LOAD CONFIG ---
  async function loadConfig() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const saved = data.find(i => i.id === 'full_config');
    if (saved) {
      const parsed = JSON.parse(saved.value);
      state.config = { ...DEFAULTS, ...parsed };
      if (!state.config.imgStyles) state.config.imgStyles = [];
      if (!state.config.imgFolders) state.config.imgFolders = [];
      if (!state.config.imgGroups) state.config.imgGroups = DEFAULTS.imgGroups;
      if (!state.config.imgCategories) state.config.imgCategories = DEFAULTS.imgCategories;
    }
    // Default select
    if (state.config.imgCategories.length > 0) state.currentImgCategory = state.config.imgCategories[0];
    if (state.config.imgGroups.length > 0) state.expandedGroups = [state.config.imgGroups[0]]; 
    renderConfigUI();
  }

  // --- CONFIG UI ---
  function renderConfigUI() {
    // TEXT
    ["promptSystem", "promptTitles", "promptDesc", "promptHeadlines", "promptAdCopys", "promptTranslate"].forEach(id => { if($(id)) $(id).value = state.config[id] || DEFAULTS[id]; });
    if($("configBlacklist")) $("configBlacklist").value = state.config.blacklist || "";
    $("collectionsList").innerHTML = (state.config.collections || []).map((c, i) => `<div class="config-row"><input type="text" value="${c.name}" class="col-name modern-input"><textarea class="col-meaning modern-textarea">${c.meaning}</textarea><button onclick="this.parentElement.remove()" class="delete-icon">×</button></div>`).join("");
    $("styleButtonsEditor").innerHTML = (state.config.headlineStyles || []).map((s, i) => `<div class="config-row"><input type="text" value="${s.name}" class="modern-input"><textarea class="modern-textarea">${s.prompt}</textarea><button onclick="this.parentElement.remove()" class="delete-icon">×</button></div>`).join("");
    $("adStyleButtonsEditor").innerHTML = (state.config.adStyles || []).map((s, i) => `<div class="config-row"><input type="text" value="${s.name}" class="modern-input"><textarea class="modern-textarea">${s.prompt}</textarea><button onclick="this.parentElement.remove()" class="delete-icon">×</button></div>`).join("");

    // IMAGES
    $("imgCategoriesList").innerHTML = (state.config.imgCategories || []).map((cat, i) => `<div class="style-tag">${cat} <span onclick="window.removeImgCategory(${i})" class="tag-close">×</span></div>`).join("");
    $("imgGroupsList").innerHTML = (state.config.imgGroups || []).map((g, i) => `<div class="style-tag">${g} <span onclick="window.removeImgGroup(${i})" class="tag-close">×</span></div>`).join("");

    renderOrganizer();
  }

  function renderOrganizer() {
      // ORPHANS
      const orphans = state.config.imgStyles.filter(s => !s.folderId);
      const orphanZone = $("orphansList");
      orphanZone.innerHTML = "";
      orphans.forEach(s => orphanZone.appendChild(createDraggableStyle(s)));

      // FOLDERS
      const folderZone = $("organizerFolders");
      folderZone.innerHTML = "";
      const sortedFolders = [...state.config.imgFolders].sort((a,b) => (a.category+a.group).localeCompare(b.category+b.group));
      
      sortedFolders.forEach(f => {
          const div = document.createElement("div");
          div.className = "org-folder-card";
          div.innerHTML = `
             <div class="org-folder-head">
                 <span class="folder-name">📁 ${f.name}</span>
                 <div class="folder-meta">${f.category} > ${f.group}</div>
                 <div class="folder-actions">
                    <button onclick="window.editFolder('${f.id}')">✏️</button>
                    <button onclick="window.deleteFolder('${f.id}')" class="danger">×</button>
                 </div>
             </div>
             <div class="org-folder-body" data-folder-id="${f.id}"></div>
          `;
          const dropBody = div.querySelector(".org-folder-body");
          const stylesInFolder = state.config.imgStyles.filter(s => s.folderId === f.id);
          stylesInFolder.forEach(s => dropBody.appendChild(createDraggableStyle(s)));

          dropBody.ondragover = (e) => { e.preventDefault(); dropBody.classList.add("drag-hover"); };
          dropBody.ondragleave = () => dropBody.classList.remove("drag-hover");
          dropBody.ondrop = (e) => { 
              e.preventDefault(); dropBody.classList.remove("drag-hover");
              if(state.draggedConfigItem) { state.draggedConfigItem.folderId = f.id; renderOrganizer(); }
          };
          folderZone.appendChild(div);
      });

      orphanZone.ondragover = (e) => { e.preventDefault(); orphanZone.classList.add("drag-hover"); };
      orphanZone.ondragleave = () => orphanZone.classList.remove("drag-hover");
      orphanZone.ondrop = (e) => { e.preventDefault(); orphanZone.classList.remove("drag-hover"); if(state.draggedConfigItem) { state.draggedConfigItem.folderId = null; renderOrganizer(); } };
  }

  function createDraggableStyle(s) {
      const el = document.createElement("div");
      el.className = "org-style-tag";
      el.draggable = true;
      el.innerHTML = `<span>${s.name}</span><button onclick="window.editStyle('${s.name}')">✏️</button>`;
      el.ondragstart = () => { state.draggedConfigItem = s; el.style.opacity = "0.5"; };
      el.ondragend = () => { state.draggedConfigItem = null; el.style.opacity = "1"; };
      return el;
  }

  /* --- CRUD ACTIONS --- */
  window.removeImgCategory = (i) => { state.config.imgCategories.splice(i, 1); renderConfigUI(); };
  $("addImgCategoryBtn").onclick = () => { const v=$("newImgCategoryInput").value.trim(); if(v && !state.config.imgCategories.includes(v)) { state.config.imgCategories.push(v); $("newImgCategoryInput").value=""; renderConfigUI(); }};
  window.removeImgGroup = (i) => { state.config.imgGroups.splice(i, 1); renderConfigUI(); };
  $("addImgGroupBtn").onclick = () => { const v=$("newImgGroupInput").value.trim(); if(v && !state.config.imgGroups.includes(v)) { state.config.imgGroups.push(v); $("newImgGroupInput").value=""; renderConfigUI(); }};

  // EDITOR
  const openEditor = (title) => { 
      $("itemEditorModal").classList.remove("hidden"); 
      $("editorTitle").textContent = title;
      $("editorFolderFields").classList.add("hidden");
      $("editorStyleFields").classList.add("hidden");
      $("editorPositionFields").classList.add("hidden");
      populateSelects();
  };
  $("closeEditorBtn").onclick = () => { $("itemEditorModal").classList.add("hidden"); state.editingItem = null; };

  function populateSelects() {
      const cats = state.config.imgCategories.map(c => `<option value="${c}">${c}</option>`).join("");
      const grps = ["ALL", ...state.config.imgGroups].map(g => `<option value="${g}">${g}</option>`).join("");
      $("editorCategory").innerHTML = cats;
      $("editorGroup").innerHTML = grps;
  }

  $("createNewFolderBtn").onclick = () => {
      openEditor("Nouveau Choix Multiple");
      $("editorFolderFields").classList.remove("hidden");
      $("editorPositionFields").classList.remove("hidden");
      $("editorName").value = "";
      state.editingItem = { type: 'folder', id: null };
  };

  $("createNewStyleBtn").onclick = () => {
      openEditor("Nouveau Bouton Simple");
      $("editorStyleFields").classList.remove("hidden");
      $("editorPositionFields").classList.remove("hidden");
      $("editorName").value = "";
      $("editorPrompt").value = "";
      $("editorMode").value = "auto";
      $("editorFile").value = "";
      state.editingItem = { type: 'style', id: null };
  };

  window.editFolder = (id) => {
      const f = state.config.imgFolders.find(x => x.id === id);
      if(!f) return;
      openEditor("Éditer Dossier");
      $("editorFolderFields").classList.remove("hidden");
      $("editorPositionFields").classList.remove("hidden");
      $("editorName").value = f.name;
      $("editorCategory").value = f.category;
      $("editorGroup").value = f.group;
      state.editingItem = { type: 'folder', id: id };
  };

  window.editStyle = (name) => {
      const s = state.config.imgStyles.find(x => x.name === name);
      if(!s) return;
      openEditor("Éditer Bouton");
      $("editorStyleFields").classList.remove("hidden");
      $("editorName").value = s.name;
      $("editorPrompt").value = s.prompt;
      $("editorMode").value = s.mode || "auto";
      if(!s.folderId) {
          $("editorPositionFields").classList.remove("hidden");
          $("editorCategory").value = s.category || "";
          $("editorGroup").value = s.group || "";
      }
      state.editingItem = { type: 'style', id: name }; 
  };

  $("editorSaveBtn").onclick = () => {
      const name = $("editorName").value;
      if(!name) return alert("Nom requis");
      
      const cat = $("editorCategory").value;
      const grp = $("editorGroup").value;

      if(state.editingItem.type === 'folder') {
          if(state.editingItem.id) {
              const f = state.config.imgFolders.find(x => x.id === state.editingItem.id);
              if(f) { f.name = name; f.category = cat; f.group = grp; }
          } else {
              state.config.imgFolders.push({ id: "f_"+Date.now(), name, category: cat, group: grp });
          }
      } else {
          const prompt = $("editorPrompt").value;
          const mode = $("editorMode").value;
          const fileInput = $("editorFile");
          const finish = (img64) => {
              if(state.editingItem.id) {
                  const s = state.config.imgStyles.find(x => x.name === state.editingItem.id);
                  if(s) { s.name = name; s.prompt = prompt; s.mode = mode; if(img64) s.refImage = img64; if(!$("editorPositionFields").classList.contains("hidden")){s.category=cat; s.group=grp;} }
              } else {
                  state.config.imgStyles.push({ name, prompt, mode, refImage: img64, folderId: null, category: cat, group: grp });
              }
              $("itemEditorModal").classList.add("hidden");
              renderConfigUI();
          };
          if(fileInput.files[0]) {
              const r = new FileReader();
              r.onload = e => finish(e.target.result.split(",")[1]);
              r.readAsDataURL(fileInput.files[0]);
              return;
          } else finish(null);
          return;
      }
      $("itemEditorModal").classList.add("hidden");
      renderConfigUI();
  };

  window.deleteFolder = (id) => {
      if(!confirm("Supprimer ?")) return;
      state.config.imgStyles.forEach(s => { if(s.folderId === id) s.folderId = null; });
      state.config.imgFolders = state.config.imgFolders.filter(f => f.id !== id);
      renderConfigUI();
  };
  $("editorDeleteBtn").onclick = () => {
      if(!confirm("Supprimer ?")) return;
      if(state.editingItem.type === 'folder') window.deleteFolder(state.editingItem.id);
      else state.config.imgStyles = state.config.imgStyles.filter(s => s.name !== state.editingItem.id);
      $("itemEditorModal").classList.add("hidden");
      renderConfigUI();
  };

  /* --- STUDIO UI --- */
  window.setImgCategory = (c) => { state.currentImgCategory = c; state.activeMultiChoiceId = null; renderStudioCategories(); renderImgStylesButtons(); };

  function renderStudioCategories() {
      const container = $("imgGenCategoriesBar");
      if(!container) return;
      container.innerHTML = (state.config.imgCategories || []).map(c => `
         <div class="studio-cat-pill ${state.currentImgCategory === c ? 'active' : ''}" onclick="window.setImgCategory('${c}')">${c}</div>
      `).join("");
  }

  function renderImgStylesButtons() {
      const container = $("imgGenStylesContainer");
      if(!container) return;
      
      // Items match Category OR Group=ALL
      const activeOrphans = state.config.imgStyles.filter(s => !s.folderId && (s.category === state.currentImgCategory || s.group === 'ALL'));
      const activeFolders = state.config.imgFolders.filter(f => f.category === state.currentImgCategory || f.group === 'ALL');

      const groupsMap = {};
      state.config.imgGroups.forEach(g => groupsMap[g] = []);
      if(!groupsMap['ALL']) groupsMap['ALL'] = [];

      activeOrphans.forEach(s => { const g = s.group || "Autres"; if(!groupsMap[g]) groupsMap[g] = []; groupsMap[g].push({ type: 'style', data: s }); });
      activeFolders.forEach(f => { const g = f.group || "Autres"; if(!groupsMap[g]) groupsMap[g] = []; groupsMap[g].push({ type: 'folder', data: f }); });

      let html = "";
      Object.keys(groupsMap).forEach(gName => {
          const items = groupsMap[gName];
          if (items && items.length > 0) {
              const isExpanded = state.expandedGroups.includes(gName) || gName === 'ALL';
              const chevron = isExpanded ? '▼' : '▶';
              html += `<div class="studio-group-section">
                  <div class="studio-group-header" onclick="window.toggleGroup('${gName}')"><span>${gName}</span><span style="font-size:10px;color:#888;">${chevron}</span></div>`;
              if (isExpanded) {
                  html += `<div class="studio-group-content"><div class="studio-row-buttons">`;
                  items.forEach(item => {
                      if (item.type === 'folder') {
                          const f = item.data;
                          const isActive = state.activeMultiChoiceId === f.id;
                          const children = state.config.imgStyles.filter(s => s.folderId === f.id);
                          const hasSel = children.some(s => isStyleSelected(s));
                          html += `<button class="multi-choice-btn ${isActive?'active':''} ${hasSel?'has-selection':''}" onclick="window.toggleMultiChoice('${f.id}')">${f.name} ${hasSel?'•':''}</button>`;
                      } else {
                          html += renderStyleBtn(item.data);
                      }
                  });
                  html += `</div>`;
                  // Show content of open folder
                  const openFolder = items.find(item => item.type === 'folder' && item.data.id === state.activeMultiChoiceId);
                  if (openFolder) {
                      const f = openFolder.data;
                      const kids = state.config.imgStyles.filter(s => s.folderId === f.id);
                      html += `<div class="studio-sub-options-container"><div class="sub-arrow"></div><div class="sub-options-grid">${kids.map(s=>renderStyleBtn(s)).join("")}</div></div>`;
                  }
                  html += `</div>`;
              }
              html += `</div>`;
          }
      });
      container.innerHTML = html;
  }

  function isStyleSelected(s) {
      if (s.mode === 'manual') return state.manualImgStyles.includes(s.name);
      return state.selectedImgStyles.some(sel => sel.name === s.name);
  }

  function renderStyleBtn(s) {
      const isActive = isStyleSelected(s);
      const modeIcon = s.mode === 'manual' ? '📝' : '';
      return `<button class="style-tag style-btn-click ${isActive?'selected':''}" data-name="${s.name.replace(/"/g, '&quot;')}">${s.refImage ? `<img src="data:image/jpeg;base64,${s.refImage}" class="btn-thumb">` : ''} ${s.name} ${modeIcon}</button>`;
  }

  window.toggleGroup = (g) => { const i = state.expandedGroups.indexOf(g); if(i>-1) state.expandedGroups.splice(i,1); else state.expandedGroups.push(g); renderImgStylesButtons(); };
  window.toggleMultiChoice = (id) => { state.activeMultiChoiceId = (state.activeMultiChoiceId === id) ? null : id; renderImgStylesButtons(); };

  document.addEventListener('click', e => {
      const sBtn = e.target.closest('.style-btn-click');
      if(sBtn) { e.stopPropagation(); window.toggleImgStyle(sBtn.getAttribute('data-name')); }
  });

  window.toggleImgStyle = (styleName) => {
      const style = state.config.imgStyles.find(s => s.name === styleName);
      if(!style) return;
      const promptClean = style.prompt.trim();
      if (style.mode === 'manual') {
          const idx = state.manualImgStyles.indexOf(styleName);
          let txt = $("imgGenPrompt").value.trim();
          if (idx > -1) {
              state.manualImgStyles.splice(idx, 1);
              if (txt.includes(promptClean)) $("imgGenPrompt").value = txt.replace(promptClean, "").replace(/\s\s+/g, ' ').trim();
              if (style.refImage) { const i = state.inputImages.indexOf(style.refImage); if(i>-1) state.inputImages.splice(i,1); }
          } else {
              state.manualImgStyles.push(styleName);
              if (!txt.includes(promptClean)) $("imgGenPrompt").value = (txt + " " + promptClean).trim();
              if (style.refImage && !state.inputImages.includes(style.refImage)) state.inputImages.push(style.refImage);
          }
          renderInputImages();
      } else {
          const idx = state.selectedImgStyles.findIndex(s => s.name === styleName);
          if (idx > -1) state.selectedImgStyles.splice(idx, 1); else state.selectedImgStyles.push(style);
      }
      renderImgStylesButtons();
  };

  function renderInputImages() { const c=$("inputImagesPreview"); if(state.inputImages.length===0){c.classList.add("hidden");return;} c.classList.remove("hidden"); c.innerHTML=state.inputImages.map((img,i)=>`<div class="input-img-wrapper"><img src="data:image/jpeg;base64,${img}" class="input-img-thumb"><div class="remove-input-img" onclick="window.removeInputImg(${i})">×</div></div>`).join(""); }
  window.removeInputImg = (i) => { state.inputImages.splice(i,1); renderInputImages(); };

  async function callGeminiImageGen() {
      const userPrompt = $("imgGenPrompt").value;
      if (!userPrompt && state.selectedImgStyles.length === 0) return alert("Prompt requis.");
      const count = parseInt($("imgCount").value) || 1;
      const aspectRatio = $("imgAspectRatio").value;
      const resolution = $("imgResolution").value;
      if (state.inputImages.length === 0 && state.imageBase64) { state.inputImages = [state.imageBase64]; renderInputImages(); }
      const batches = [];
      const inputs = state.inputImages.length > 0 ? state.inputImages : [null];
      inputs.forEach(inputImg => {
          let tasks = state.selectedImgStyles.length > 0 ? state.selectedImgStyles.map(s => ({ type: 'style', prompt: userPrompt ? (userPrompt + " " + s.prompt) : s.prompt, refImage: s.refImage, label: s.name })) : [{ type: 'manual', prompt: userPrompt, refImage: null, label: userPrompt }];
          tasks.forEach(task => {
              let ctx = []; if(inputImg) ctx.push(inputImg); if(task.refImage) ctx.push(task.refImage);
              for(let i=0; i<count; i++) batches.push({ prompt: task.prompt, images: ctx, aspectRatio, resolution, label: task.label });
          });
      });
      const newItems = batches.map(b => ({ id: Date.now()+Math.random(), loading: true, prompt: b.label }));
      state.sessionGeneratedImages.unshift(...newItems); renderGenImages();
      state.selectedImgStyles = []; state.manualImgStyles = []; $("imgGenPrompt").value = ""; renderImgStylesButtons();
      newItems.forEach(async (item, idx) => {
          try {
              const res = await fetch("/api/gemini", { method: "POST", body: JSON.stringify({ prompt: batches[idx].prompt, images: batches[idx].images, aspectRatio, resolution: batches[idx].resolution }) });
              const data = await res.json();
              const target = state.sessionGeneratedImages.find(x => x.id === item.id);
              if(target) { target.loading = false; if(data.error) target.error = data.error; else target.image = data.image; renderGenImages(); }
          } catch(e) { const target = state.sessionGeneratedImages.find(x => x.id === item.id); if(target) { target.loading = false; target.error = e.message; renderGenImages(); } }
      });
  }

  function renderGenImages() {
      const sess = $("imgGenSessionResults");
      sess.innerHTML = state.sessionGeneratedImages.map(item => {
          if(item.loading) return `<div class="gen-image-card loading-card"><div class="spinner-apple"></div><span>...</span></div>`;
          if(item.error) return `<div class="gen-image-card error-card"><span>⚠️</span></div>`;
          return `<div class="gen-image-card" onclick="window.toggleSessionImg('${item.id}')"><img src="data:image/jpeg;base64,${item.image}"><div class="gen-image-overlay">${item.prompt}</div><button class="zoom-btn" onclick="event.stopPropagation(); window.viewImage('${item.image}')">🔍</button></div>`;
      }).join("");
      
      let savedHtml = "";
      if(state.imageBase64) savedHtml += `<div class="gen-image-card no-drag"><img src="data:image/jpeg;base64,${state.imageBase64}"><div class="gen-image-overlay">ORIGINAL</div><button class="add-btn" onclick="event.stopPropagation(); window.addSavedToInputOrig()">＋</button></div>`;
      savedHtml += state.savedGeneratedImages.map((item, i) => {
          const isSel = state.inputImages.includes(item.image);
          return `<div class="gen-image-card ${isSel?'selected-border':''}" draggable="true" ondragstart="dragStart(event, ${i})" ondrop="drop(event, ${i})" ondragenter="dragEnter(event, ${i})" ondragover="allowDrop(event)" onclick="window.toggleSavedImg(${i})"><img src="data:image/jpeg;base64,${item.image}"><div class="gen-image-overlay">${item.prompt}</div><button class="zoom-btn" onclick="event.stopPropagation(); window.viewImage('${item.image}')">🔍</button><button class="del-btn" onclick="event.stopPropagation(); window.deleteSavedImage(${i})">×</button><button class="add-btn" style="right:55px" onclick="event.stopPropagation(); window.addSavedToInput(${i})">＋</button></div>`;
      }).join("");
      $("imgGenSavedResults").innerHTML = savedHtml;
  }

  window.toggleSavedImg = (i) => { const item = state.savedGeneratedImages[i]; if(!item) return; const idx = state.inputImages.indexOf(item.image); if(idx>-1) state.inputImages.splice(idx,1); else state.inputImages.push(item.image); renderInputImages(); renderGenImages(); };
  window.toggleSessionImg = (id) => { const item = state.sessionGeneratedImages.find(x=>x.id==id); if(!item) return; const idx = state.selectedSessionImagesIdx.indexOf(item); if(idx>-1) { state.selectedSessionImagesIdx.splice(idx,1); const i = state.inputImages.indexOf(item.image); if(i>-1) state.inputImages.splice(i,1); } else { state.selectedSessionImagesIdx.push(item); if(!state.inputImages.includes(item.image)) state.inputImages.push(item.image); } renderInputImages(); renderGenImages(); };
  window.addSavedToInput = (i) => { const item=state.savedGeneratedImages[i]; if(item && !state.inputImages.includes(item.image)) { state.inputImages.push(item.image); renderInputImages(); $("settingsModal").classList.add("hidden"); document.querySelector('button[data-tab="tab-img-chat"]').click(); }};
  window.addSavedToInputOrig = () => { if(state.imageBase64 && !state.inputImages.includes(state.imageBase64)) { state.inputImages.push(state.imageBase64); renderInputImages(); $("settingsModal").classList.add("hidden"); document.querySelector('button[data-tab="tab-img-chat"]').click(); }};
  window.viewImage = (b64) => { const w=window.open(""); w.document.write(`<img src="data:image/jpeg;base64,${b64}" style="max-width:100%">`); };
  
  window.saveImgSelection = async () => { if (!state.currentHistoryId) return alert("Pas de produit."); const newImgs = state.selectedSessionImagesIdx.map(i => ({ image: i.image, prompt: i.prompt, aspectRatio: i.aspectRatio })); if(newImgs.length===0) return alert("Rien sélectionné."); state.savedGeneratedImages.push(...newImgs); state.selectedSessionImagesIdx = []; try { await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, generated_images: JSON.stringify(state.savedGeneratedImages) }) }); alert("Sauvegardé"); renderGenImages(); document.querySelector('button[data-tab="tab-img-saved"]').click(); } catch(e){ alert(e); } };
  window.deleteSavedImage = async (i) => { if(!confirm("Supprimer ?")) return; state.savedGeneratedImages.splice(i,1); try { await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, generated_images: JSON.stringify(state.savedGeneratedImages) }) }); renderGenImages(); } catch(e){ alert(e); } };
  
  let dragSrcIndex = null;
  window.dragStart = (e, i) => { dragSrcIndex = i; e.dataTransfer.effectAllowed = 'move'; e.target.style.opacity = '0.4'; };
  window.allowDrop = (e) => { e.preventDefault(); };
  window.dragEnter = (e, targetIndex) => { if (dragSrcIndex === null || dragSrcIndex === targetIndex) return; const item = state.savedGeneratedImages.splice(dragSrcIndex, 1)[0]; state.savedGeneratedImages.splice(targetIndex, 0, item); dragSrcIndex = targetIndex; renderGenImages(); };
  window.drop = async (e, i) => { e.preventDefault(); document.querySelectorAll('.gen-image-card').forEach(c => c.style.opacity = '1'); dragSrcIndex = null; if (state.currentHistoryId) { try { await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, generated_images: JSON.stringify(state.savedGeneratedImages) }) }); } catch(err) {} } };

  async function apiCall(action, extra={}) { if (!state.imageBase64) return; startLoading(); try { const productUrl = formatLangUrl($("productUrlInput").value, "en."); const common = { image: state.imageBase64, media_type: state.imageMime, collection: $("collectionSelect").value, config: state.config, historyNames: state.historyCache.map(h => h.product_name), currentTitle: $("titleText").textContent, currentDesc: $("descText").textContent, product_url: productUrl }; if (action === 'ad_copys' && state.selAdStyles.length > 0) { const results = await Promise.all(state.selAdStyles.map(sName => { const sPrompt = state.config.adStyles.find(x => x.name === sName)?.prompt; return fetch("/api/generate", { method: "POST", body: JSON.stringify({ ...common, action, style: sPrompt + " " + (extra.userText || ""), styleLabel: sName }) }).then(r => r.json().then(d => ({ ...d, label: sName }))); })); results.forEach(res => { state.sessionAds = [...(res.ad_copys || []).map(t => ({ text: t, style: res.label })), ...state.sessionAds]; }); state.adPage = 1; renderAds(); } else { if (action === 'headlines' && state.selHlStyles.length > 0) extra.style = state.selHlStyles.map(n => state.config.headlineStyles.find(s => s.name === n)?.prompt).join(" ") + " " + (extra.userText || ""); const res = await fetch("/api/generate", { method: "POST", body: JSON.stringify({ ...common, action, ...extra }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error || "Erreur IA"); if (action === 'generate') { $("titleText").textContent = data.title; $("descText").textContent = data.description; const hRes = await fetch("/api/history", { method: "POST", body: JSON.stringify({ title: data.title, description: data.description, image: state.imageBase64, product_name: data.product_name, product_url: productUrl }) }); const hData = await hRes.json(); state.currentHistoryId = hData.id; localStorage.setItem('lastHistoryId', hData.id); state.sessionHeadlines = []; state.sessionAds = []; state.selectedHeadlines = []; state.selectedAds = []; state.headlinesTrans = {}; state.adsTrans = {}; state.savedGeneratedImages = []; state.sessionGeneratedImages = []; state.inputImages = [state.imageBase64]; renderInputImages(); renderGenImages(); await loadHistory(); } else if (action === 'regen_title' || action === 'regen_desc') { if (action === 'regen_title') $("titleText").textContent = data.title; else $("descText").textContent = data.description; if (state.currentHistoryId) await fetch("/api/history", { method: "PATCH", body: JSON.stringify({ id: state.currentHistoryId, title: $("titleText").textContent, description: $("descText").textContent }) }); await loadHistory(); } else if (action.includes('headlines')) { state.sessionHeadlines = [...(data.headlines || []), ...state.sessionHeadlines]; state.hlPage = 1; renderHeadlines(); } else if (action.includes('ad_copys')) { state.sessionAds = [...(data.ad_copys || []).map(t => ({ text: t, style: action.includes('similar') ? 'Variante' : 'Chat' })), ...state.sessionAds]; state.adPage = 1; renderAds(); } } $("regenTitleBtn").disabled = $("regenDescBtn").disabled = false; } catch(e) { alert("Erreur: " + e.message); } finally { stopLoading(); } }
  
  const renderHeadlines = () => { const list = state.sessionHeadlines || []; const pag = list.slice((state.hlPage-1)*12, state.hlPage*12); $("headlinesResults").innerHTML = pag.map((text, i) => `<div class="headline-item" onclick="toggleItemSelect('hl', this)"><input type="checkbox"><span class="headline-text">${text}</span></div>`).join(""); renderPaginationLoc('hl'); };
  const renderAds = () => { const list = state.sessionAds || []; const pag = list.slice((state.adPage-1)*12, state.adPage*12); let html = "", lastStyle = ""; pag.forEach((item, i) => { if (item.style !== lastStyle) { html += `<div style="margin: 10px 0 5px; font-size:11px; font-weight:bold; color:var(--apple-blue); border-bottom:1px solid #eee; padding-bottom:3px;">${item.style.toUpperCase()}</div>`; lastStyle = item.style; } html += `<div class="headline-item" onclick="toggleItemSelect('ad', this)"><input type="checkbox"><div class="headline-text" style="white-space:pre-wrap;">${item.text}</div></div>`; }); $("adsResults").innerHTML = html; renderPaginationLoc('ad'); };
  window.toggleItemSelect = (type, el) => { const cb = el.querySelector('input'); cb.checked = !cb.checked; el.classList.toggle('selected', cb.checked); };
  function renderPaginationLoc(type) { const list = type === 'hl' ? state.sessionHeadlines : state.sessionAds; const container = type === 'hl' ? $("headlinesLocalPagination") : $("adsLocalPagination"); const total = Math.ceil((list || []).length / 12); container.innerHTML = ""; if (total <= 1) return; for (let i = 1; i <= total; i++) { const b = document.createElement("button"); b.textContent = i; if (i === (type === 'hl' ? state.hlPage : state.adPage)) b.className = "active"; b.onclick = () => { if(type === 'hl') state.hlPage = i; else state.adPage = i; type === 'hl' ? renderHeadlines() : renderAds(); }; container.appendChild(b); } }

  async function loadHistory() { try { const r = await fetch("/api/history"); state.historyCache = await r.json(); renderHistoryUI(); } catch(e){} }
  function renderHistoryUI() { const filtered = (state.historyCache || []).filter(i => (i.title||"").toLowerCase().includes(state.searchQuery.toLowerCase())); const start = (state.currentPage - 1) * 5; const pag = filtered.slice(start, start + 5); $("historyList").innerHTML = pag.map(item => `<div class="history-item ${state.currentHistoryId == item.id ? 'active-history' : ''}" onclick="restore(${item.id})"><img src="data:image/jpeg;base64,${item.image}" class="history-img"><div style="flex:1"><h4>${item.title || "Sans titre"}</h4></div><button onclick="event.stopPropagation(); deleteItem(${item.id})">🗑</button></div>`).join(""); renderPagination(Math.ceil(filtered.length / 5)); }
  function renderPagination(total) { const p = $("pagination"); p.innerHTML = ""; if(total <= 1) return; for(let i=1; i<=total; i++) { const b = document.createElement("button"); b.textContent = i; if(i === state.currentPage) b.className = "active"; b.onclick = () => { state.currentPage = i; renderHistoryUI(); }; p.appendChild(b); } }
  
  window.restore = async (id) => { state.currentHistoryId = id; localStorage.setItem('lastHistoryId', id); renderHistoryUI(); startLoading(); try { const res = await fetch(`/api/history?id=${id}`); const item = await res.json(); state.sessionHeadlines = []; state.sessionAds = []; state.savedGeneratedImages = item.generated_images ? JSON.parse(item.generated_images) : []; state.sessionGeneratedImages = []; $("titleText").textContent = item.title; $("descText").textContent = item.description; $("productUrlInput").value = item.product_url || ""; $("previewImg").src = `data:image/jpeg;base64,${item.image}`; state.imageBase64 = item.image; $("preview").classList.remove("hidden"); $("dropPlaceholder").style.display = "none"; $("generateBtn").disabled = false; state.inputImages = [item.image]; renderInputImages(); renderGenImages(); } catch(e) { alert("Erreur chargement: " + e.message); } finally { stopLoading(); } };
  window.deleteItem = async (id) => { if(!confirm("Supprimer ?")) return; await fetch(`/api/history?id=${id}`, { method: "DELETE" }); if(state.currentHistoryId == id) { state.currentHistoryId = null; localStorage.removeItem('lastHistoryId'); } loadHistory(); };
  window.copyToClip = (t) => { navigator.clipboard.writeText(t); alert("Copié !"); };

  function init() {
    $("loading").classList.add("hidden");
    $("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
    $("closeSettings").onclick = () => { $("settingsModal").classList.add("hidden"); if(window.cancelImgStyleEdit) window.cancelImgStyleEdit(); };
    $("saveConfig").onclick = async () => { await fetch("/api/settings", { method: "POST", body: JSON.stringify({ id: 'full_config', value: JSON.stringify(state.config) }) }); alert("Enregistré"); $("settingsModal").classList.add("hidden"); renderConfigUI(); };
    document.querySelectorAll(".tab-link").forEach(btn => btn.onclick = (e) => { const m=e.target.closest('.modal-content'); m.querySelectorAll(".tab-link").forEach(b=>b.classList.remove("active")); m.querySelectorAll(".tab-content").forEach(c=>c.classList.add("hidden")); e.target.classList.add("active"); $(e.target.dataset.tab).classList.remove("hidden"); });
    $("openImgGenBtn").onclick = () => { if(!state.imageBase64) return alert("Veuillez d'abord uploader une image principale."); if(state.inputImages.length===0) state.inputImages=[state.imageBase64]; renderInputImages(); $("imgGenModal").classList.remove("hidden"); renderStudioCategories(); renderImgStylesButtons(); renderGenImages(); };
    $("closeImgGen").onclick = () => $("imgGenModal").classList.add("hidden");
    $("sendImgGen").onclick = callGeminiImageGen;
    $("addInputImgBtn").onclick = () => $("extraImgInput").click();
    $("extraImgInput").onchange = (e) => { const files = Array.from(e.target.files); files.forEach(f => { const r = new FileReader(); r.onload = (ev) => { state.inputImages.push(ev.target.result.split(",")[1]); renderInputImages(); }; r.readAsDataURL(f); }); };
    $("saveImgSelectionBtn").onclick = window.saveImgSelection;
    window.onclick = (e) => { if (e.target.classList.contains('modal')) e.target.classList.add("hidden"); };
    $("sendHeadlineChat").onclick = () => apiCall('headlines', { userText: $("headlineStyleInput").value });
    $("sendAdChat").onclick = () => apiCall('ad_copys', { userText: $("adStyleInput").value });
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
