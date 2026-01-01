(() => {
  const $ = (id) => document.getElementById(id);

  // COLLECTIONS PAR DÉFAUT (Originales)
  const ORIG_COLLECTIONS = [
    { name: "Initial", meaning: "Jewelry featuring 26 letter variants. Titles must contain 'Initial'." },
    { name: "Projection", meaning: "Jewelry with a pendant holding a customizable image." },
    { name: "Name", meaning: "Personalized jewelry with raised names (laser-cut plate)." },
    { name: "Engraved", meaning: "Jewelry with customizable engraving." },
    { name: "Angel", meaning: "Jewelry with angelic shapes (wings, feathers)." }
  ];

  const ORIG_PROMPT = `Analyze a jewelry image and produce a SINGLE JSON object.
- "type": Ring|Bracelet|Necklace|Earrings
- "collection": one from allowed list
- "name": a symbolic English name (1–2 words)
- "title": Ring: Adjustable {Collection} Ring "{Name}". Others: {Collection} {Type} "{Name}". NO hyphens.
- "description": English plain text. EXACTLY TWO paragraphs, each <=180 characters (including spaces). NO ellipses. Then bullet list starting with '- '.

Required bullets:
- Materials: Stainless steel
- Hypoallergenic
- Water and oxidation resistant
Plus: Ring (Size: Adjustable, No green fingers), Bracelet (Size: 16+5cm), Necklace (Length: 46 cm + 5 cm).`;

  let state = {
    imageBase64: null,
    imageMime: "image/jpeg",
    historyCache: [],
    config: { promptSystem: ORIG_PROMPT, collections: ORIG_COLLECTIONS, blacklist: "" },
    currentPage: 1,
    pageSize: 5
  };

  async function loadConfig() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const saved = data.find(i => i.id === 'full_config');
    if (saved) state.config = JSON.parse(saved.value);
    renderConfigUI();
  }

  function renderConfigUI() {
    $("promptSystem").value = state.config.promptSystem;
    $("configBlacklist").value = state.config.blacklist;
    $("collectionSelect").innerHTML = state.config.collections.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    $("collectionsList").innerHTML = state.config.collections.map((c, i) => `
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" value="${c.name}" onchange="updateCol(${i}, 'name', this.value)" style="flex:1">
        <textarea onchange="updateCol(${i}, 'meaning', this.value)" style="flex:2; height:40px;">${c.meaning}</textarea>
        <button onclick="removeCol(${i})">×</button>
      </div>
    `).join("");
  }

  window.updateCol = (i, f, v) => state.config.collections[i][f] = v;
  window.removeCol = (i) => { state.config.collections.splice(i, 1); renderConfigUI(); };
  $("addCollection").onclick = () => { state.config.collections.push({name:"", meaning:""}); renderConfigUI(); };

  /* CSV IMPORT LOGIC (From popup.js) */
  $("csvImport").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const rows = text.split(/\r?\n/);
    let names = [];
    rows.forEach(row => {
      const match = row.match(/"([^"]+)"/); // Cherche le texte entre guillemets
      if (match) names.push(match[1]);
      else {
        const parts = row.split(",");
        if (parts[0]) names.push(parts[0].trim());
      }
    });
    const currentList = state.config.blacklist.split(",").map(n => n.trim());
    state.config.blacklist = [...new Set([...currentList, ...names])].filter(n => n.length > 2).join(", ");
    $("configBlacklist").value = state.config.blacklist;
  };

  /* ACTIONS IA */
  async function apiCall(action) {
    if (!state.imageBase64) return;
    $("loading").classList.remove("hidden");
    const historyNames = state.historyCache.slice(0, 50).map(h => h.product_name);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          action,
          image: state.imageBase64,
          media_type: state.imageMime,
          collection: $("collectionSelect").value,
          config: state.config,
          historyNames,
          currentTitle: $("titleText").textContent
        })
      });
      const data = await res.json();
      if (action === 'generate') {
        $("titleText").textContent = data.title;
        $("descText").textContent = data.description;
        await fetch("/api/history", { method: "POST", body: JSON.stringify({ title: data.title, description: data.description, image: state.imageBase64, product_name: data.product_name }) });
        loadHistory();
      } else if (action === 'regen_title') $("titleText").textContent = data.title;
      else if (action === 'regen_desc') $("descText").textContent = data.description;
      
      $("regenTitleBtn").disabled = false;
      $("regenDescBtn").disabled = false;
    } catch(e) { alert("Erreur génération"); }
    finally { $("loading").classList.add("hidden"); }
  }

  function init() {
    $("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
    $("closeSettings").onclick = () => $("settingsModal").classList.add("hidden");
    window.onclick = (e) => { if (e.target == $("settingsModal")) $("settingsModal").classList.add("hidden"); };

    document.querySelectorAll(".tab-link").forEach(t => {
      t.onclick = () => {
        document.querySelectorAll(".tab-link").forEach(l => l.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
        t.classList.add("active");
        $(t.dataset.tab).classList.remove("hidden");
      };
    });

    $("imageInput").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const b64 = ev.target.result;
        state.imageMime = b64.split(";")[0].split(":")[1] || "image/jpeg";
        state.imageBase64 = b64.split(",")[1];
        $("previewImg").src = b64;
        $("preview").classList.remove("hidden");
        $("dropPlaceholder").style.display = "none";
        $("generateBtn").disabled = false;
      };
      reader.readAsDataURL(file);
    };

    $("removeImage").onclick = () => {
      state.imageBase64 = null;
      $("preview").classList.add("hidden");
      $("dropPlaceholder").style.display = "flex";
      $("titleText").textContent = ""; $("descText").textContent = "";
    };

    $("generateBtn").onclick = () => apiCall('generate');
    $("regenTitleBtn").onclick = () => apiCall('regen_title');
    $("regenDescBtn").onclick = () => apiCall('regen_desc');
    $("saveConfig").onclick = async () => {
      state.config.promptSystem = $("promptSystem").value;
      state.config.blacklist = $("configBlacklist").value;
      await fetch("/api/settings", { method: "POST", body: JSON.stringify({ id: 'full_config', value: JSON.stringify(state.config) }) });
      alert("Enregistré"); $("settingsModal").classList.add("hidden");
    };

    loadConfig(); loadHistory();
  }

  async function loadHistory() {
    const res = await fetch("/api/history");
    state.historyCache = await res.json();
    renderHistoryUI();
  }

  function renderHistoryUI() {
    const start = (state.currentPage - 1) * state.pageSize;
    const paginated = state.historyCache.slice(start, start + state.pageSize);
    $("historyList").innerHTML = paginated.map(item => `
      <div class="history-item" onclick="restore(${item.id})">
        <img src="data:image/jpeg;base64,${item.image}" class="history-img">
        <div style="flex:1"><h4>${item.title}</h4></div>
        <button onclick="event.stopPropagation(); deleteItem(${item.id})">🗑</button>
      </div>
    `).join("");
  }

  window.restore = (id) => {
    const item = state.historyCache.find(i => i.id === id);
    if (!item) return;
    $("titleText").textContent = item.title;
    $("descText").textContent = item.description;
    $("previewImg").src = `data:image/jpeg;base64,${item.image}`;
    state.imageBase64 = item.image;
    $("preview").classList.remove("hidden");
    $("dropPlaceholder").style.display = "none";
  };

  init();
})();
