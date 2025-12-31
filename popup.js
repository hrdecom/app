// popup.js — Web app (copywriting depuis image)

const $ = (id) => document.getElementById(id);

const state = {
  imageBase64: null,
  imageType: null,
  title: "",
  description: ""
};

const imageInput = $("imageInput");
const preview = $("preview");
const previewImg = $("previewImg");
const drop = $("drop");
const removeImage = $("removeImage");

const generateBtn = $("generateBtn");
const regenTitleBtn = $("regenTitleBtn");
const regenDescBtn = $("regenDescBtn");

const titleText = $("titleText");
const descText = $("descText");

const loading = $("loading");
const timerEl = $("timer");
let timerId = null;

function startLoading() {
  loading.classList.remove("hidden");
  const start = Date.now();
  timerEl.textContent = "00:00";
  timerId = setInterval(() => {
    const s = Math.floor((Date.now() - start) / 1000);
    timerEl.textContent =
      String(Math.floor(s / 60)).padStart(2, "0") +
      ":" +
      String(s % 60).padStart(2, "0");
  }, 1000);
}

function stopLoading() {
  loading.classList.add("hidden");
  if (timerId) clearInterval(timerId);
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Upload image
imageInput.addEventListener("change", async () => {
  const file = imageInput.files[0];
  if (!file) return;

  state.imageType = file.type || "image/jpeg";
  state.imageBase64 = await toBase64(file);

  preview.classList.remove("hidden");
  drop.classList.add("has-image");
  previewImg.src = URL.createObjectURL(file);

  regenTitleBtn.disabled = true;
  regenDescBtn.disabled = true;
});

removeImage.addEventListener("click", () => {
  state.imageBase64 = null;
  state.imageType = null;
  preview.classList.add("hidden");
  drop.classList.remove("has-image");
  imageInput.value = "";
});

async function callGenerate(action) {
  if (!state.imageBase64) {
    alert("Veuillez d’abord téléverser une image.");
    return;
  }

  startLoading();

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        imageBase64: state.imageBase64,
        imageType: state.imageType,
        title: state.title,
        description: state.description
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur API");

    if (data.title) {
      state.title = data.title;
      titleText.textContent = data.title;
    }
    if (data.description) {
      state.description = data.description;
      descText.textContent = data.description;
    }

    regenTitleBtn.disabled = false;
    regenDescBtn.disabled = false;
  } catch (e) {
    alert(e.message);
  } finally {
    stopLoading();
  }
}

generateBtn.addEventListener("click", () => callGenerate("generate"));
regenTitleBtn.addEventListener("click", () => callGenerate("regen_title"));
regenDescBtn.addEventListener("click", () => callGenerate("regen_desc"));
