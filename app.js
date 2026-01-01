const $ = id => document.getElementById(id);

const state = {
  imageBase64: null,
  title: "",
  description: ""
};

const els = {
  drop: $("drop"),
  imageInput: $("imageInput"),
  preview: $("preview"),
  previewImg: $("previewImg"),
  removeImage: $("removeImage"),
  titleText: $("titleText"),
  descText: $("descText"),
  generateBtn: $("generateBtn"),
  regenTitleBtn: $("regenTitleBtn"),
  regenDescBtn: $("regenDescBtn"),
  copyTitle: $("copyTitle"),
  copyDesc: $("copyDesc")
};

/* CLICK UPLOAD */
els.drop.addEventListener("click", e => {
  if (e.target === els.removeImage) return;
  els.imageInput.click();
});

/* IMAGE LOAD */
els.imageInput.addEventListener("change", () => {
  const file = els.imageInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    state.imageBase64 = reader.result.split(",")[1];
    els.previewImg.src = reader.result;
    els.preview.classList.remove("hidden");
    $("dropPlaceholder").style.display = "none";
  };
  reader.readAsDataURL(file);
});

els.removeImage.addEventListener("click", () => {
  state.imageBase64 = null;
  els.preview.classList.add("hidden");
  els.imageInput.value = "";
  $("dropPlaceholder").style.display = "";
});

/* API */
async function callAPI(action) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, image: state.imageBase64 })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* GENERATE */
els.generateBtn.onclick = async () => {
  if (!state.imageBase64) return alert("Ajoute une image");

  const data = await callAPI("generate");
  state.title = data.title;
  state.description = data.description;

  els.titleText.textContent = state.title;
  els.descText.textContent = state.description;

  els.regenTitleBtn.disabled = false;
  els.regenDescBtn.disabled = false;
};

els.regenTitleBtn.onclick = async () => {
  const data = await callAPI("regen_title");
  els.titleText.textContent = data.title;
};

els.regenDescBtn.onclick = async () => {
  const data = await callAPI("regen_desc");
  els.descText.textContent = data.description;
};

els.copyTitle.onclick = () => navigator.clipboard.writeText(els.titleText.textContent);
els.copyDesc.onclick = () => navigator.clipboard.writeText(els.descText.textContent);
