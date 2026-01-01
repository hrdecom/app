// popup.js — Web version (Cloudflare compatible)

const state = {
  imageBase64: null,
  title: "",
  description: ""
};

const imageInput = document.getElementById("imageInput");
const preview = document.getElementById("preview");
const previewImg = document.getElementById("previewImg");
const dropPlaceholder = document.getElementById("dropPlaceholder");
const removeImage = document.getElementById("removeImage");

const generateBtn = document.getElementById("generateBtn");
const regenTitleBtn = document.getElementById("regenTitleBtn");
const regenDescBtn = document.getElementById("regenDescBtn");

const titleText = document.getElementById("titleText");
const descText = document.getElementById("descText");

const copyTitle = document.getElementById("copyTitle");
const copyDesc = document.getElementById("copyDesc");

/* IMAGE UPLOAD */
imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    state.imageBase64 = reader.result.split(",")[1];
    previewImg.src = reader.result;
    preview.classList.remove("hidden");
    dropPlaceholder.style.display = "none";
  };
  reader.readAsDataURL(file);
});

removeImage.addEventListener("click", () => {
  state.imageBase64 = null;
  previewImg.src = "";
  preview.classList.add("hidden");
  dropPlaceholder.style.display = "";
  imageInput.value = "";
});

/* API */
async function callGenerate(action) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      image: state.imageBase64
    })
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* BUTTONS */
generateBtn.addEventListener("click", async () => {
  if (!state.imageBase64) return alert("Importe une image.");

  const data = await callGenerate("generate");
  state.title = data.title;
  state.description = data.description;

  titleText.textContent = state.title;
  descText.textContent = state.description;

  regenTitleBtn.disabled = false;
  regenDescBtn.disabled = false;
});

regenTitleBtn.addEventListener("click", async () => {
  const data = await callGenerate("regen_title");
  state.title = data.title;
  titleText.textContent = state.title;
});

regenDescBtn.addEventListener("click", async () => {
  const data = await callGenerate("regen_desc");
  state.description = data.description;
  descText.textContent = state.description;
});

/* COPY */
copyTitle.addEventListener("click", () => {
  navigator.clipboard.writeText(state.title);
});

copyDesc.addEventListener("click", () => {
  navigator.clipboard.writeText(state.description);
});
