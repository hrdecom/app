/* popup.js — FR UI v1.6.0: Apple style restore + strict 180c paragraphs (no ellipsis), repair step if needed */
const els = {
  settingsBtn: document.getElementById("settingsBtn"),
  settings: document.getElementById("settings"),
  apiKey: document.getElementById("apiKey"),
  modelName: document.getElementById("modelName"),
  persistKey: document.getElementById("persistKey"),
  saveSettings: document.getElementById("saveSettings"),
  clearUsed: document.getElementById("clearUsed"),
  csvFile: document.getElementById("csvFile"),
  csvInfo: document.getElementById("csvInfo"),
  exportTemplate: document.getElementById("exportTemplate"),
  exportBlocklist: document.getElementById("exportBlocklist"),
  drop: document.getElementById("drop"),
  dropPlaceholder: document.getElementById("dropPlaceholder"),
  imageInput: document.getElementById("imageInput"),
  preview: document.getElementById("preview"),
  previewImg: document.getElementById("previewImg"),
  removeImage: document.getElementById("removeImage"),
  generateBtn: document.getElementById("generateBtn"),
  regenTitleBtn: document.getElementById("regenTitleBtn"),
  regenDescBtn: document.getElementById("regenDescBtn"),
  copyTitle: document.getElementById("copyTitle"),
  copyDesc: document.getElementById("copyDesc"),
  infoDesc: document.getElementById("infoDesc"),
  titleText: document.getElementById("titleText"),
  descText: document.getElementById("descText"),
  historyList: document.getElementById("historyList"),
  loading: document.getElementById("loading"),
  timer: document.getElementById("timer"),
  toast: document.getElementById("toast"),
  collectionSelect: document.getElementById("collectionSelect"),
  applyCollection: document.getElementById("applyCollection"),
  collectionsEditor: document.getElementById("collectionsEditor"),
  newCollection: document.getElementById("newCollection"),
  newCollectionDesc: document.getElementById("newCollectionDesc"),
  addCollection: document.getElementById("addCollection"),
  resetCollections: document.getElementById("resetCollections"),
  saveCollections: document.getElementById("saveCollections"),
  exportAll: document.getElementById("exportAll"),
  importAll: document.getElementById("importAll"),
  importAllFile: document.getElementById("importAllFile"),
  modal: document.getElementById("modal"),
  modalBody: document.getElementById("modalBody"),
  modalClose: document.getElementById("modalClose")
};

const store = {
  get: (keys) => new Promise((resolve, reject) => chrome.storage.local.get(keys, (data)=>{
    if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve(data);
  })),
  set: (obj) => new Promise((resolve, reject) => chrome.storage.local.set(obj, ()=>{
    if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve();
  })),
  remove: (keys) => new Promise((resolve, reject) => chrome.storage.local.remove(keys, ()=>{
    if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve();
  }))
};

let currentImage = null;
let currentResult = null;
let timerInterval = null;
let suggestedCollection = null;
let sessionBannedNames = new Set();
let sessionRecentDescriptions = new Set();
let lastTranslationHtml = "";
let currentId = null;

const DEFAULT_COLLECTIONS_V2 = [
  { name: "Initial", desc: "Jewelry featuring 26 letter variants of the alphabet (single or multiple letters). Titles must contain 'Initial'. Designs may include two interlaced initials, one per ring side, or three on a bracelet, etc." },
  { name: "Projection", desc: "Jewelry with a pendant that holds a customizable image visible by looking into the lens or by projecting onto a wall when shining a phone flashlight through it." },
  { name: "Name", desc: "Personalized jewelry with raised names (not engraving). Typically a laser-cut plate shaped in the form of the name, in relief." },
  { name: "Engraved", desc: "Jewelry with customizable engraving on the surface." },
  { name: "Angel", desc: "Jewelry with angelic shapes (wings, feathers, etc.), optionally with customizable engraving." }
];

function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }
function toast(msg, ms=2200){ els.toast.textContent = msg; show(els.toast); setTimeout(() => hide(els.toast), ms); }
function setLoading(on){ if (on){ show(els.loading); startTimer(); } else { stopTimer(); hide(els.loading);} }
function startTimer(){ const start = Date.now(); stopTimer(); timerInterval = setInterval(() => { const s = Math.floor((Date.now()-start)/1000); const mm = String(Math.floor(s/60)).padStart(2,"0"); const ss = String(s%60).toString().padStart(2,"0"); els.timer.textContent = `${mm}:${ss}`; }, 200); }
function stopTimer(){ if (timerInterval) clearInterval(timerInterval); timerInterval=null; els.timer.textContent = "00:00"; }

// Compression to save quota
function compressDataUrl(dataUrl, maxW=520, q=0.8){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", q));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function safeSetHistory(history){
  let list = history.slice(-80);
  while (true){
    try{ await store.set({ history: list }); break; }
    catch(err){
      if (list.length <= 1) break;
      list = list.slice(1);
    }
  }
}
async function saveLastSession(){
  if (!currentResult || !currentImage){ await store.remove(["lastSession","currentId"]); return; }
  try{
    const small = await compressDataUrl(currentImage.dataUrl, 520, 0.8);
    await store.set({ lastSession: { currentResult, currentImage: { ...currentImage, dataUrl: small, base64: small.split(",")[1], mime: "image/jpeg" } }, currentId });
  }catch(err){
    await store.set({ lastSession: { currentResult }, currentId });
  }
}
async function restoreLastSession(){
  try{
    const { lastSession = null, currentId: cid = null } = await store.get(["lastSession","currentId"]);
    currentId = cid;
    if (lastSession && lastSession.currentResult){
      currentResult = lastSession.currentResult || null;
      currentImage = lastSession.currentImage || null;
      if (currentImage?.dataUrl){ els.previewImg.src = currentImage.dataUrl; show(els.preview); els.drop.classList.add("has-image"); }
      els.titleText.textContent = currentResult?.title || "";
      els.descText.textContent = currentResult?.description || "";
      els.regenTitleBtn.disabled = !currentResult?.title;
      els.regenDescBtn.disabled = !currentResult?.description;
      if (currentResult?.collection) await populateCollectionSelect(currentResult.collection);
      suggestedCollection = currentResult?.collection || null;
    }
  }catch(e){}
}

// Collections helpers (same as before)...
async function loadCollectionsV2(){ try{ const { collectionsV2, collections } = await store.get(["collectionsV2","collections"]); let data = collectionsV2; if(!data){ if(Array.isArray(collections)&&collections.length) data=collections.map(n=>({name:n,desc:""})); else data=DEFAULT_COLLECTIONS_V2.slice(); await store.set({collectionsV2:data}); } return data; }catch(e){ return DEFAULT_COLLECTIONS_V2.slice(); } }
async function saveCollectionsV2(data){ await store.set({ collectionsV2: data }); }
function renderCollectionsEditor(list){
  els.collectionsEditor.innerHTML = "";
  list.forEach((row, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "collection-row";
    wrap.innerHTML = `
      <input class="col-name" data-idx="${idx}" type="text" value="${row.name}"/>
      <textarea class="col-desc" data-idx="${idx}">${row.desc}</textarea>
      <button class="col-del" data-idx="${idx}">Supprimer</button>`;
    wrap.querySelector(".col-del").addEventListener("click", async (e) => {
      const i = +e.target.dataset.idx; const data = await loadCollectionsV2();
      data.splice(i,1); await saveCollectionsV2(data); renderCollectionsEditor(data); populateCollectionSelect(); toast("Collection supprimée");
    });
    wrap.querySelector(".col-name").addEventListener("input", async (e) => {
      const i = +e.target.dataset.idx; const data = await loadCollectionsV2(); data[i].name = e.target.value; await saveCollectionsV2(data); populateCollectionSelect();
    });
    wrap.querySelector(".col-desc").addEventListener("input", async (e) => {
      const i = +e.target.dataset.idx; const data = await loadCollectionsV2(); data[i].desc = e.target.value; await saveCollectionsV2(data);
    });
    els.collectionsEditor.appendChild(wrap);
  });
}
async function addCollection(){ const name=(els.newCollection.value||"").trim(); const desc=(els.newCollectionDesc.value||"").trim(); if(!name) return; const data=await loadCollectionsV2(); if(!data.find(x=>x.name.toLowerCase()===name.toLowerCase())){ data.push({name,desc}); await saveCollectionsV2(data); renderCollectionsEditor(data); populateCollectionSelect(); els.newCollection.value=""; els.newCollectionDesc.value=""; toast("Collection ajoutée"); } else toast("Déjà présente"); }
async function resetCollections(){ await saveCollectionsV2(DEFAULT_COLLECTIONS_V2.slice()); renderCollectionsEditor(DEFAULT_COLLECTIONS_V2); populateCollectionSelect(); toast("Collections réinitialisées"); }
async function populateCollectionSelect(selected){ const data=await loadCollectionsV2(); els.collectionSelect.innerHTML=""; data.forEach(({name})=>{ const opt=document.createElement("option"); opt.value=name; opt.textContent=name; if(selected&&name.toLowerCase()===selected.toLowerCase()) opt.selected=true; els.collectionSelect.appendChild(opt); }); }

// CSV/blocklist helpers (same as previous version)...
function keyFor(collection, type, name){ return [collection||"", type||"", name||""].map(x => String(x).trim().toLowerCase()).join("||"); }
function parseTitleToComponents(title){ const q=title.match(/"([^"]+)"/); const name=q?q[1].trim():""; const before=title.replace(/"[^"]+"$/,"").trim(); let m=before.match(/^adjustable\s+(.+?)\s+ring$/i); if(m){ return {collection:m[1].trim(), type:"Ring", name}; } m=before.match(/^(.+?)\s+(bracelet|necklace|earrings)$/i); if(m){ return {collection:m[1].trim(), type:m[2][0].toUpperCase()+m[2].slice(1), name}; } const parts=before.split(" - ").map(s=>s.trim()); if(parts.length>=3 && /^adjustable$/i.test(parts[0])) return {collection:parts[1], type:parts[2], name}; if(parts.length>=2) return {collection:parts[0], type:parts[1], name}; return {collection:"", type:"", name}; }
function parseCSV(text){ const rows=[]; let i=0, field="", row=[], inQuotes=false; while(i<text.length){ const ch=text[i]; if(inQuotes){ if(ch=='"'){ if(text[i+1]=='"'){field+='"'; i++;} else inQuotes=false;} else field+=ch; } else { if(ch=='"'){inQuotes=true;} else if(ch==','){row.push(field); field="";} else if(ch=='\n'||ch=='\r'){ if(field.length||row.length){row.push(field); rows.push(row); row=[]; field="";} if(ch=='\r'&&text[i+1]=='\n') i++; } else field+=ch; } i++; } if(field.length||row.length){row.push(field); rows.push(row);} return rows; }
async function getBlockedKeys(){ const { usedTitlesIndex = {}, importedBlocklist = { keys: [] } } = await store.get(["usedTitlesIndex","importedBlocklist"]); const set = new Set(Object.keys(usedTitlesIndex)); for (const k of (importedBlocklist.keys || [])) set.add(k); return set; }
async function isNameBlocked(collection, type, name){ const set = await getBlockedKeys(); return set.has(keyFor(collection, type, name)); }
async function addUsedName(collection, type, name){ const k = keyFor(collection, type, name); const { usedTitlesIndex = {} } = await store.get(["usedTitlesIndex"]); usedTitlesIndex[k] = true; await store.set({ usedTitlesIndex }); }
async function importCSVToBlocklist(file){ const text=await file.text(); const rows=parseCSV(text); if(!rows.length){ els.csvInfo.textContent="CSV vide."; return; } const header=rows[0].map(h=>h.trim().toLowerCase()); let titleIdx=header.findIndex(h=>["title","titre","product title","name","designation"].includes(h)); if(titleIdx===-1) titleIdx=0; let parsed=0, added=0; const { importedBlocklist = { keys: [] } } = await store.get(["importedBlocklist"]); const set = new Set(importedBlocklist.keys || []); for(let r=1; r<rows.length; r++){ const row=rows[r]; const t=(row[titleIdx]||"").trim(); if(!t) continue; parsed++; const { collection, type, name } = parseTitleToComponents(t); if(!collection||!type||!name) continue; const k=keyFor(collection,type,name); if(!set.has(k)){ set.add(k); added++; } } await store.set({ importedBlocklist: { keys: Array.from(set), importedAt: Date.now() } }); els.csvInfo.textContent = `Import terminé — nouveaux noms: ${added} (lignes lues: ${parsed}).`; toast("Blocklist mise à jour"); }
function downloadBlob(filename, content, mime="text/plain"){ const url = URL.createObjectURL(new Blob([content], { type: mime })); const a=document.createElement("a"); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
async function exportTemplate(){ downloadBlob(`blocklist_template.csv`, "title\nAngel Necklace \"My Angel\"\nInitial Necklace \"Twinkle\"\n", "text/csv"); }
async function exportBlocklist(){ const set=await getBlockedKeys(); const rows=["title"]; for(const k of set){ const [collection,type,name]=k.split("||"); rows.push(ensureTitleFormat({ type, collection, name })); } downloadBlob(`blocklist_export.csv`, rows.join("\n"), "text/csv"); }

// Import/Export ALL data merge
async function exportAllData(){ const data=await store.get(["settings","collectionsV2","importedBlocklist","usedTitlesIndex","history","suggestedCollectionStored","currentId"]); const out={ version:"1.6.0", exportedAt:Date.now(), settings:{...(data.settings||{}), apiKey:""}, collectionsV2:data.collectionsV2||[], importedBlocklist:data.importedBlocklist||{keys:[]}, usedTitlesIndex:data.usedTitlesIndex||{}, history:data.history||[], suggestedCollectionStored:data.suggestedCollectionStored||"", currentId:data.currentId||"" }; downloadBlob("jewelry_extension_data.json", JSON.stringify(out,null,2), "application/json"); }
async function importAllData(file){ const text=await file.text(); let incoming; try{ incoming=JSON.parse(text); }catch(e){ toast("Fichier JSON invalide"); return; } const data=await store.get(["settings","collectionsV2","importedBlocklist","usedTitlesIndex","history","suggestedCollectionStored","currentId"]); const currentCols=(data.collectionsV2||[]).slice(); const mapCols=new Map(currentCols.map(c=>[c.name.toLowerCase(), c])); (incoming.collectionsV2||[]).forEach(c=>{ const key=(c.name||"").toLowerCase(); if(!key) return; if(!mapCols.has(key)) mapCols.set(key,{name:c.name,desc:c.desc||""}); else { const cur=mapCols.get(key); if(!cur.desc && c.desc) cur.desc=c.desc; } }); await store.set({ collectionsV2:Array.from(mapCols.values()) }); const setKeys=new Set(((data.importedBlocklist||{}).keys||[])); ((incoming.importedBlocklist||{}).keys||[]).forEach(k=>setKeys.add(k)); await store.set({ importedBlocklist:{ keys:Array.from(setKeys), importedAt:Date.now() } }); const uti={...(data.usedTitlesIndex||{})}; Object.keys(incoming.usedTitlesIndex||{}).forEach(k=>uti[k]=true); await store.set({ usedTitlesIndex: uti }); const curHist=(data.history||[]).slice(); const ids=new Set(curHist.map(h=>h.id)); const toAdd=[]; (incoming.history||[]).forEach(h=>{ if(h&&h.id&&!ids.has(h.id)) toAdd.push(h); }); const merged=curHist.concat(toAdd); await safeSetHistory(merged); renderHistory(merged); toast("Import terminé (fusion sans doublons)"); }

// Validation/format + paragraph length enforcement (no ellipsis)
function isSymbolicName(name){ const bad=["necklace","bracelet","ring","earrings","earring","pendant","chain","jewelry","jewel","personalized","custom","letter","letters","initial","initials","name"]; const words=name.trim().split(/\s+/); if(words.length>2||words.length===0) return false; const lower=name.toLowerCase(); return !bad.some(b=>lower.includes(b)); }
function ensureTitleFormat({ type, collection, name }){ const n=String(name).trim().replace(/"/g,""); const t=String(type).trim(); const c=String(collection).trim(); if(/^ring$/i.test(t)) return `Adjustable ${c} Ring "${n}"`; const proper=t.charAt(0).toUpperCase()+t.slice(1).toLowerCase(); return `${c} ${proper} "${n}"`; }
function splitDescParts(text){ const parts=String(text||"").trim().split(/\n\s*\n/); let p1=parts[0]||""; let p2=parts[1]||""; let rest=parts.slice(2).join("\n\n")||""; return { p1,p2,rest }; }
function clamp180NoDots(s){ return s.length<=180 ? s : s.slice(0,180).replace(/\s+\S*$/,""); } // no ellipsis
function enforceParagraphLimits(desc){ let {p1,p2,rest}=splitDescParts(desc); p1=clamp180NoDots(p1); p2=clamp180NoDots(p2); let out=p1+"\n\n"+p2; if(rest) out+="\n\n"+rest; return out.trim(); }

// Sanitize personalization (paragraphs only)
function sanitizeParagraph(s){ if(!s) return s; s=s.replace(/\b(letter|initial)\s*["“”']?[A-Za-z]["“”']?\b/gi,'an initial motif'); s=s.replace(/["“”']([A-Za-z]{2,})["“”']/g,'your chosen name'); return s; }
function sanitizePersonalizedMentions(text){ const {p1,p2,rest}=splitDescParts(text); const p1s=sanitizeParagraph(p1); const p2s=sanitizeParagraph(p2); return [p1s,p2s,rest].filter(Boolean).join("\n\n"); }

// HTML copy helpers
function escapeHtml(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function textToHtml(desc){ const {p1,p2,rest}=splitDescParts(desc); const paras=[]; if(p1) paras.push(`<p>${escapeHtml(p1)}</p>`); if(p2) paras.push(`<p>${escapeHtml(p2)}</p>`); const bullets=[]; rest.split(/\n/).forEach(line=>{ const m=line.trim().match(/^[-•]\s?(.*)$/); if(m&&m[1]) bullets.push(m[1]); }); let ul=""; if(bullets.length){ ul="<ul>"+bullets.map(x=>`<li>${escapeHtml(x)}</li>`).join("")+"</ul>"; } return paras.join("")+ul; }
async function copyHtml(html, plain){ try{ await navigator.clipboard.write([ new ClipboardItem({ "text/html": new Blob([html],{type:"text/html"}), "text/plain": new Blob([plain],{type:"text/plain"}) }) ]); return true; }catch(e){ return new Promise((resolve)=>{ const div=document.createElement("div"); div.contentEditable="true"; div.style.position="fixed"; div.style.left="-9999px"; div.innerHTML=html; document.body.appendChild(div); const range=document.createRange(); range.selectNodeContents(div); const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range); function oncopy(ev){ ev.preventDefault(); ev.clipboardData.setData("text/html", html); ev.clipboardData.setData("text/plain", plain);} document.addEventListener("copy", oncopy, {once:true}); const ok=document.execCommand("copy"); document.removeEventListener("copy", oncopy); sel.removeAllRanges(); document.body.removeChild(div); resolve(ok); }); } }

// Prompts (hard limit + self-check, no ellipsis)
async function loadCollectionsV2List(){ const d=await loadCollectionsV2(); return d.map(x=>`${x.name}: ${x.desc||""}`).join(" | "); }
function normalizeModelName(input){ const raw=String(input||"").trim().toLowerCase(); const map=new Map([["claude sonnet 4.5","claude-sonnet-4-5"],["claude-4.5-sonnet","claude-sonnet-4-5"],["claude 4.5 sonnet","claude-sonnet-4-5"],["claude-3.5-sonnet","claude-sonnet-4-5"],["claude 3.5 sonnet","claude-sonnet-4-5"]]); return map.get(raw)||input||"claude-sonnet-4-5"; }
async function buildInstruction(){
  const list = await loadCollectionsV2List();
  const suggested = suggestedCollection ? `USER_SUGGESTED_COLLECTION=${suggestedCollection}` : "USER_SUGGESTED_COLLECTION=(none)";
  return `You are a senior product copywriter and vision-language expert.
Analyze a jewelry image and produce a SINGLE JSON object with keys:
- "type": one of Ring|Bracelet|Necklace|Earrings
- "collection": one from the allowed list
- "name": a symbolic English name (1–2 words; no generic product terms)
- "title": formatted as specified, no hyphens
- "description": EN plain text with exactly TWO paragraphs (<=180 characters each) followed by bullets starting with '- '
- "description_fr_html": the French translation of the FINAL "description", formatted in valid HTML (<p>...<p><ul><li>...)

STRICT HARD LIMITS for the two paragraphs:
- Each paragraph MUST be <=180 characters (including spaces).
- Do NOT use ellipses "..." to shorten. Write concisely instead.
- If any paragraph exceeds 180, REWRITE until both are within limit before responding.

Allowed collections (choose ONLY from this list; name: description): ${list}.
${suggested}. If USER_SUGGESTED_COLLECTION is not (none), use it unless it blatantly contradicts the visual.

TITLE formats:
- Ring: "Adjustable {Collection} Ring \\"{Name}\\""
- Bracelet/Necklace/Earrings: "{Collection} {Type} \\"{Name}\\""

IMPORTANT: Do NOT mention specific letters or names seen in the photo. Prefer "initial motif" or "your chosen name".

Required bullets:
- Materials: Stainless steel
- Hypoallergenic
- Water and oxidation resistant
Plus per type:
- Bracelet: Bracelet Size: 16+5cm (adjustable) / (6.3 in x 2in)
- Necklace: Clasp: Lobster clasp
- Necklace: Length: 46 cm + 5 cm adjustable (18.1 in + 2in)
- Ring: Size: Adjustable
- Ring: No green fingers`;
}
function regenTitleInstructionFixed({ type, collection, bannedNames, recentNames }){
  return `Generate a DIFFERENT symbolic NAME and a TITLE (no hyphens) for the same jewelry.
Keep type and collection:
- type: ${type}
- collection: ${collection}
Avoid these names (case-insensitive): ${[...(bannedNames||[]), ...(recentNames||[])].join(", ") || "(none)"}.
Name must be 1–2 words and symbolic (no generic product words).
Return JSON with { "name": "...", "title": "..." }.`;
}
function regenDescInstructionFixed({ type, collection, name, title, previous }){
  return `Regenerate an English DESCRIPTION for the same jewelry with this exact title:
- title: ${title}
- type: ${type}
- collection: ${collection}
- name: ${name}
Write TWO paragraphs, each <=180 characters (no ellipses). If longer, rewrite until within the limit. Then add the bullet list as specified.
Return JSON with { "description": "..." }.
[PREVIOUS]
${previous}
[/PREVIOUS]`;
}

// API call
async function callClaude(apiKey, modelName, pieces){ const payload={ type:"ANTHROPIC_CALL", payload:{ apiKey, model: normalizeModelName(modelName)||"claude-sonnet-4-5", max_tokens: 1200, temperature: 0.4, messages:[{ role:"user", content: pieces }] } }; const res=await chrome.runtime.sendMessage(payload); if(!res?.ok) throw new Error(res?.error || "Appel Anthropic échoué"); return res.data; }
function extractAssistantText(resp){ try{ return (resp?.content||[]).map(b=>b?.text||"").filter(Boolean).join("\n"); }catch{ return ""; } }
function extractFirstJson(text){ try{ return JSON.parse(text); }catch{} const fence=text.match(/```json([\s\S]*?)```/i); if(fence){ try{ return JSON.parse(fence[1]); }catch{} } const i=text.indexOf("{"); const j=text.lastIndexOf("}"); if(i!==-1 && j!==-1 && j>i){ try{ return JSON.parse(text.slice(i, j+1)); }catch{} } throw new Error("Impossible de parser la sortie du modèle"); }

// Repair step if any paragraph >180 (no ellipsis)
function paragraphsWithinLimit(desc){ const {p1,p2}=splitDescParts(desc); return p1.length<=180 && p2.length<=180; }
async function ensureDescWithinLimit(desc, apiKey, modelName){
  if (paragraphsWithinLimit(desc)) return { fixed: desc, changed: false };
  const { p1, p2, rest } = splitDescParts(desc);
  const prompt = `Rewrite the two paragraphs below into EXACTLY two English paragraphs, each <=180 characters (including spaces). No ellipses. Keep meaning and tone concise.\nReturn JSON {"p1":"","p2":""}.\n[PARA1]\n${p1}\n[/PARA1]\n[PARA2]\n${p2}\n[/PARA2]`;
  const resp = await callClaude(apiKey, modelName, [{type:"text", text: prompt}]);
  const obj = extractFirstJson(extractAssistantText(resp));
  let np1 = String(obj.p1||"").trim();
  let np2 = String(obj.p2||"").trim();
  if (np1.length>180) np1 = clamp180NoDots(np1);
  if (np2.length>180) np2 = clamp180NoDots(np2);
  return { fixed: np1 + "\n\n" + np2 + (rest? "\n\n"+rest : ""), changed: true };
}

// Translate FR HTML when needed (only if we had to repair)
async function translateToFrenchFromPlain(plain, apiKey, modelName){
  const prompt = `Translate the following English product description to French. Return valid HTML using <p> for each paragraph and <ul><li> for bullet lines that start with '- '.\n[TEXT]\n${plain}\n[/TEXT]`;
  const resp = await callClaude(apiKey, modelName, [{type:"text", text: prompt}]);
  return extractAssistantText(resp).trim();
}

// Generate flow
let generationCounter = 0;
async function generateAll(){
  const { settings = {}, history = [], suggestedCollectionStored } = await store.get(["settings","history","suggestedCollectionStored"]).catch(()=>({}));
  const apiKey = (settings?.persistKey ? settings.apiKey : els.apiKey.value.trim()) || els.apiKey.value.trim();
  const modelName = settings?.modelName || els.modelName.value.trim() || "claude-sonnet-4-5";
  if (!apiKey) throw new Error("Clé API manquante.");
  if (!currentImage) throw new Error("Merci d’importer une image.");
  suggestedCollection = suggestedCollectionStored || suggestedCollection;
  const instruction = await buildInstruction();
  const pieces = [{ type:"image", source:{ type:"base64", media_type: currentImage.mime, data: currentImage.base64 } }, { type:"text", text: instruction }];

  const resp1 = await callClaude(apiKey, modelName, pieces);
  const text1 = extractAssistantText(resp1);
  let obj = extractFirstJson(text1);

  obj.type = String(obj.type || "").trim();
  obj.collection = String(obj.collection || "Classic").trim();
  obj.name = String(obj.name || "").trim().replace(/"/g, "");
  if (!isSymbolicName(obj.name)){ const fixed = await forceSymbolicName(apiKey, modelName, obj); obj.name = fixed || obj.name; }
  obj.title = ensureTitleFormat({ type: obj.type, collection: obj.collection, name: obj.name });

  // paragraphs -> sanitize -> hard-limit repair (no ellipsis)
  let desc = String(obj.description || "").trim();
  desc = sanitizePersonalizedMentions(desc);
  // ensure within 180c
  const ensured = await ensureDescWithinLimit(desc, apiKey, modelName);
  desc = ensured.fixed;
  // final guard (no dots)
  desc = enforceParagraphLimits(desc);
  obj.description = desc;

  // FR HTML (direct from obj if provided; else regenerate if we repaired)
  lastTranslationHtml = String(obj.description_fr_html || "").trim();
  if (ensured.changed || !lastTranslationHtml){
    lastTranslationHtml = await translateToFrenchFromPlain(obj.description, apiKey, modelName);
  }

  currentResult = { type: obj.type, collection: obj.collection, name: obj.name, title: obj.title, description: obj.description };
  sessionBannedNames = new Set([obj.name.toLowerCase()]);
  sessionRecentDescriptions = new Set([obj.description]);

  els.titleText.textContent = obj.title;
  els.descText.textContent = obj.description;
  els.regenTitleBtn.disabled = false;
  els.regenDescBtn.disabled = false;

  const thumb = await compressDataUrl(currentImage.dataUrl, 280, 0.75);
  const item = { id: crypto.randomUUID(), timestamp: Date.now(), imageThumb: thumb, imageFull: null, ...currentResult, gen: ++generationCounter };
  const newHistory = (history || []).concat(item);
  currentId = item.id;
  await safeSetHistory(newHistory);
  await store.set({ currentId }).catch(()=>{});
  renderHistory(newHistory);
  await saveLastSession();
}
async function forceSymbolicName(apiKey, modelName, obj){ try{ const prompt=`Propose a short symbolic English NAME (1–2 words) for this jewelry; avoid any generic product words (necklace, bracelet, ring, earrings, pendant, chain, personalized, custom, letter, initial, name). Return plain text only.`; const resp=await callClaude(apiKey, modelName, [{type:"text", text:prompt}]); const txt=extractAssistantText(resp).trim().replace(/["]/g,""); if(txt && isSymbolicName(txt)) return txt; }catch{} return null; }

async function regenerateTitle(){
  if (!currentResult) throw new Error("Rien à régénérer.");
  const { settings = {} } = await store.get(["settings"]).catch(()=>({}));
  const apiKey = (settings?.persistKey ? settings.apiKey : els.apiKey.value.trim()) || els.apiKey.value.trim();
  const modelName = settings?.modelName || els.modelName.value.trim() || "claude-sonnet-4-5";
  const blockedSet = await getBlockedKeys();
  const bannedNames = Array.from(blockedSet).map(k => k.split("||")).filter(parts => parts[0] === currentResult.collection.toLowerCase() && parts[1] === currentResult.type.toLowerCase()).map(parts => parts[2].toLowerCase());
  let attempts = 0; let newName = currentResult.name;
  while (attempts < 5){
    attempts++;
    const resp = await callClaude(apiKey, modelName, [{ type:"text", text: regenTitleInstructionFixed({ type: currentResult.type, collection: currentResult.collection, bannedNames, recentNames: Array.from(sessionBannedNames) }) }]);
    const obj = extractFirstJson(extractAssistantText(resp));
    const candidate = String(obj.name||"").trim().replace(/"/g,"");
    if (candidate && isSymbolicName(candidate) && !sessionBannedNames.has(candidate.toLowerCase()) && !(await isNameBlocked(currentResult.collection, currentResult.type, candidate))){ newName=candidate; break; }
  }
  if (newName && newName !== currentResult.name){
    sessionBannedNames.add(newName.toLowerCase());
    currentResult.name = newName;
    currentResult.title = ensureTitleFormat({ type: currentResult.type, collection: currentResult.collection, name: currentResult.name });
    els.titleText.textContent = currentResult.title;
    await saveLastSession();
    toast("Nouveau titre prêt");
  } else toast("Aucune alternative trouvée (réessayez)");
}

async function regenerateDescription(){
  if (!currentResult) throw new Error("Rien à régénérer.");
  const { settings = {} } = await store.get(["settings"]).catch(()=>({}));
  const apiKey = (settings?.persistKey ? settings.apiKey : els.apiKey.value.trim()) || els.apiKey.value.trim();
  const modelName = settings?.modelName || els.modelName.value.trim() || "claude-sonnet-4-5";
  let attempts = 0; let newDesc = currentResult.description;
  while (attempts < 3){
    attempts++;
    const resp = await callClaude(apiKey, modelName, [{ type:"text", text: regenDescInstructionFixed({ type: currentResult.type, collection: currentResult.collection, name: currentResult.name, title: currentResult.title, previous: currentResult.description }) }]);
    const obj = extractFirstJson(extractAssistantText(resp));
    if (obj?.description){
      let d = String(obj.description).trim();
      // repair -> sanitize -> enforce (no ellipsis)
      const ensured = await ensureDescWithinLimit(d, apiKey, modelName);
      d = ensured.fixed;
      d = sanitizePersonalizedMentions(d);
      d = enforceParagraphLimits(d);
      if (!sessionRecentDescriptions.has(d)){ newDesc = d; if(ensured.changed){ lastTranslationHtml = await translateToFrenchFromPlain(newDesc, apiKey, modelName); } break; }
    }
  }
  if (newDesc && newDesc !== currentResult.description){
    sessionRecentDescriptions.add(newDesc);
    currentResult.description = newDesc;
    els.descText.textContent = currentResult.description;
    await saveLastSession();
    toast("Nouvelle description prête");
  } else toast("Aucune alternative trouvée (réessayez)");
}

// Suggestion de collection, copy, modal ...
async function applySuggested(){ suggestedCollection = els.collectionSelect.value; await store.set({ suggestedCollectionStored: suggestedCollection }).catch(()=>{}); toast(`Collection suggérée: ${suggestedCollection}`); if (currentResult){ currentResult.collection = suggestedCollection; currentResult.title = ensureTitleFormat({ type: currentResult.type, collection: currentResult.collection, name: currentResult.name }); els.titleText.textContent = currentResult.title; await regenerateDescription(); await saveLastSession(); } }
async function copyTitle(){ const t=els.titleText.textContent.trim(); if(!t) return; await navigator.clipboard.writeText(t); const comp=parseTitleToComponents(t); if(comp.collection&&comp.type&&comp.name) await addUsedName(comp.collection, comp.type, comp.name); toast("Titre copié & enregistré"); }
async function copyDescHtml(){ const t=els.descText.textContent.trim(); if(!t) return; const html=textToHtml(t); const ok=await copyHtml(html, t); toast(ok?"Description copiée (HTML)":"Copie HTML indisponible — texte copié"); }
function openModal(html){ els.modalBody.innerHTML = html || "<p>(Indisponible)</p>"; show(els.modal); } function closeModal(){ hide(els.modal); }

function renderHistory(items){ els.historyList.innerHTML=""; const cid=currentId; (items||[]).slice().reverse().forEach(it=>{ const div=document.createElement("div"); div.className="history-card card"; if(cid&&it.id===cid){ div.classList.add("current"); const badge=document.createElement("div"); badge.className="badge-current"; badge.textContent="Actuel"; div.appendChild(badge); } div.dataset.historyId=it.id; div.innerHTML += `<img src="${it.imageThumb}" alt="aperçu" /><div><div class="history-title">${it.title}</div><div class="history-meta">${it.collection} • ${it.type} • “${it.name}”</div><div class="history-meta">${new Date(it.timestamp).toLocaleString()}</div></div>`; div.addEventListener("click", async()=>{ const { history=[] } = await store.get(["history"]).catch(()=>({})); const found=history.find(h=>h.id===it.id); if(found){ currentResult={ type:found.type, collection:found.collection, name:found.name, title:found.title, description:found.description }; els.previewImg.src = it.imageThumb; show(els.preview); els.drop.classList.add("has-image"); els.titleText.textContent = found.title; els.descText.textContent = found.description; els.regenTitleBtn.disabled=false; els.regenDescBtn.disabled=false; await populateCollectionSelect(found.collection); suggestedCollection = found.collection; currentId = found.id; await store.set({ currentId }).catch(()=>{}); renderHistory(history); await saveLastSession(); toast("Produit chargé depuis l'historique"); } }); els.historyList.appendChild(div); }); }

async function loadSettings(){ try{ const { settings={}, usedTitlesIndex={}, importedBlocklist={keys:[]}, history=[], suggestedCollectionStored, currentId:cid } = await store.get(["settings","usedTitlesIndex","importedBlocklist","history","suggestedCollectionStored","currentId"]); currentId = cid || null; if(settings.apiKey) els.apiKey.value=settings.apiKey; if(settings.modelName) els.modelName.value=settings.modelName; if(settings.persistKey===false) els.persistKey.checked=false; renderHistory(history); const data=await loadCollectionsV2(); renderCollectionsEditor(data); await populateCollectionSelect(suggestedCollectionStored||data[0]?.name||""); suggestedCollection = suggestedCollectionStored || null; await restoreLastSession(); }catch(e){ console.warn("loadSettings error", e); } }

function clearOutputs(){ currentResult=null; currentId=null; els.titleText.textContent=""; els.descText.textContent=""; els.regenTitleBtn.disabled=true; els.regenDescBtn.disabled=true; store.remove(["lastSession","currentId"]).catch(()=>{}); }
function fileToDataUrl(file){ return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); }); }
async function loadImage(file){ const dataUrl=await fileToDataUrl(file); const mime=(dataUrl.split(";")[0]||"data:image/jpeg").replace("data:",""); const base64=dataUrl.split(",")[1]; currentImage={ dataUrl, mime, base64 }; els.previewImg.src=dataUrl; show(els.preview); els.drop.classList.add("has-image"); clearOutputs(); toast("Image chargée"); }
els.removeImage.addEventListener("click", ()=>{ currentImage=null; els.previewImg.src=""; hide(els.preview); els.drop.classList.remove("has-image"); clearOutputs(); toast("Image supprimée"); });

// Bindings
els.settingsBtn.addEventListener("click", ()=> els.settings.classList.toggle("hidden"));
els.saveSettings.addEventListener("click", async ()=>{ const s={ apiKey: els.apiKey.value.trim(), modelName: els.modelName.value.trim() || "claude-sonnet-4-5", persistKey: !!els.persistKey.checked }; const toSave={ settings: s }; if(!s.persistKey) toSave.settings.apiKey=""; try{ await store.set(toSave); toast("Paramètres enregistrés"); }catch(e){ toast("Erreur de sauvegarde des paramètres"); } });
els.clearUsed.addEventListener("click", async ()=>{ try{ await store.set({ usedTitlesIndex: {} }); toast("Noms enregistrés vidés"); }catch(e){} loadSettings(); });
els.csvFile.addEventListener("change", async (e)=>{ const f=e.target.files?.[0]; if(f) await importCSVToBlocklist(f); });
els.exportTemplate.addEventListener("click", exportTemplate);
els.exportBlocklist.addEventListener("click", exportBlocklist);
els.exportAll.addEventListener("click", exportAllData);
els.importAll.addEventListener("click", ()=> els.importAllFile.click());
els.importAllFile.addEventListener("change", async (e)=>{ const f=e.target.files?.[0]; if(f) await importAllData(f); });

els.addCollection.addEventListener("click", addCollection);
els.resetCollections.addEventListener("click", resetCollections);
els.saveCollections.addEventListener("click", async ()=>{ toast("Descriptions sauvegardées"); });

els.applyCollection.addEventListener("click", applySuggested);

els.drop.addEventListener("click", ()=> els.imageInput.click());
els.drop.addEventListener("dragover", (e)=>{ e.preventDefault(); });
els.drop.addEventListener("drop", (e)=>{ e.preventDefault(); const file=e.dataTransfer.files?.[0]; if(file) loadImage(file); });
els.imageInput.addEventListener("change", (e)=>{ const file=e.target.files?.[0]; if(file) loadImage(file); });

els.generateBtn.addEventListener("click", async ()=>{ try{ setLoading(true); await generateAll(); }catch(err){ console.error(err); toast(String(err?.message||err)); }finally{ setLoading(false);} });
els.regenTitleBtn.addEventListener("click", async ()=>{ try{ setLoading(true); await regenerateTitle(); }catch(err){ console.error(err); toast(String(err?.message||err)); }finally{ setLoading(false);} });
els.regenDescBtn.addEventListener("click", async ()=>{ try{ setLoading(true); await regenerateDescription(); }catch(err){ console.error(err); toast(String(err?.message||err)); }finally{ setLoading(false);} });

els.copyTitle.addEventListener("click", copyTitle);
els.copyDesc.addEventListener("click", copyDescHtml);

els.infoDesc.addEventListener("click", ()=> openModal(lastTranslationHtml || "<p>(Traduction indisponible)</p>") );
els.modalClose.addEventListener("click", closeModal);
els.modal.addEventListener("click", (e)=>{ if(e.target===els.modal) closeModal(); });

// Start
loadSettings();

/* === Ads Copy modal opener from popup === */
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("rp-open-ads");
  if (!btn) return;
  btn.addEventListener("click", () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs)=>{
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) { alert("No active tab."); return; }
      chrome.tabs.sendMessage(tab.id, { type: "RP_OPEN_ADS_MODAL" }, (resp) => {
        if (chrome.runtime.lastError){ alert("Open a product page on en.riccardiparis.com first."); return; }
        window.close();
      });
    });
  });
});
