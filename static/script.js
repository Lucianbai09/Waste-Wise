const BIN_INFO = {
    garbage:   { label: "Garbage" },
    recycling: { label: "Blue Bin Recycling" },
    compost:   { label: "Green Bin Compost" },
    hazardous: { label: "Hazardous / Depot" },
};

// downscale photos before upload — phone photos are 5-12 MB and would slow the demo
const MAX_DIMENSION = 1280;

const form = document.getElementById("upload-form");
const cameraBtn = document.getElementById("camera-btn");
const uploadBtn = document.getElementById("upload-btn");
const cameraInput = document.getElementById("camera-input");
const fileInput = document.getElementById("file-input");
const cameraView = document.getElementById("camera-view");
const cameraStream = document.getElementById("camera-stream");
const captureBtn = document.getElementById("capture-btn");
const cancelCameraBtn = document.getElementById("cancel-camera-btn");
const dropZone = document.getElementById("drop-zone");
const dropZoneText = document.getElementById("drop-zone-text");
const preview = document.getElementById("preview");
const classifyBtn = document.getElementById("classify-btn");
const results = document.getElementById("results");
const summaryEl = document.getElementById("overall-summary");
const resultsList = document.getElementById("results-list");
const errorEl = document.getElementById("error");

let processedBlob = null;

function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
}

function hideError() {
    errorEl.hidden = true;
}

function downscale(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
            if (scale === 1 && file.type === "image/jpeg") {
                resolve(file);
                return;
            }
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't process the image."))),
                "image/jpeg",
                0.85
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Couldn't read that file as an image."));
        };
        img.src = url;
    });
}

function usePhoto(blob, label) {
    processedBlob = blob;
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(blob);
    preview.hidden = false;
    dropZoneText.textContent = label;
    classifyBtn.disabled = false;
    results.hidden = true;
}

async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    hideError();
    let blob;
    try {
        blob = await downscale(file);
    } catch (err) {
        showError(err.message);
        return;
    }
    usePhoto(blob, file.name || "photo");
}

let mediaStream = null;

async function acquireCamera() {
    // a just-released camera can stay "in use" (NotReadableError) for a moment
    // while the device tears down — retry briefly before giving up
    for (let attempt = 0; ; attempt++) {
        try {
            return await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" },
            });
        } catch (err) {
            if (err.name !== "NotReadableError" || attempt >= 5) throw err;
            await new Promise((resolve) => setTimeout(resolve, 400));
        }
    }
}

function stopCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
    }
    cameraStream.srcObject = null;
    cameraView.hidden = true;
}

cameraBtn.addEventListener("click", async () => {
    if (mediaStream) return; // camera already open
    // Desktop browsers ignore capture="environment" and open a file picker instead,
    // so use the webcam via getUserMedia; the capture input stays as the fallback
    // where getUserMedia doesn't exist (it opens the native camera app on phones).
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        cameraInput.click();
        return;
    }
    cameraBtn.disabled = true;
    try {
        mediaStream = await acquireCamera();
    } catch (err) {
        showError("Camera unavailable — check the camera permission, or use Upload photo instead.");
        return;
    } finally {
        cameraBtn.disabled = false;
    }
    hideError();
    cameraStream.srcObject = mediaStream;
    cameraView.hidden = false;
});

captureBtn.addEventListener("click", () => {
    const width = cameraStream.videoWidth;
    const height = cameraStream.videoHeight;
    if (!width) return; // stream not ready yet
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d").drawImage(cameraStream, 0, 0, canvas.width, canvas.height);
    stopCamera();
    canvas.toBlob(
        (blob) => (blob ? usePhoto(blob, "camera photo") : showError("Couldn't capture the photo.")),
        "image/jpeg",
        0.85
    );
});

cancelCameraBtn.addEventListener("click", stopCamera);

uploadBtn.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("click", () => fileInput.click());
// reset input values so picking the same file twice still fires "change"
cameraInput.addEventListener("change", () => { handleFile(cameraInput.files[0]); cameraInput.value = ""; });
fileInput.addEventListener("change", () => { handleFile(fileInput.files[0]); fileInput.value = ""; });

dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    handleFile(e.dataTransfer.files[0]);
});

function makeNote(className, text) {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    return p;
}

function renderResults(data) {
    resultsList.innerHTML = "";
    summaryEl.hidden = true;
    if (data.overall_summary && data.items.length > 1) {
        summaryEl.textContent = data.overall_summary;
        summaryEl.hidden = false;
    }
    for (const item of data.items) {
        const info = BIN_INFO[item.bin];
        const card = document.createElement("article");
        card.className = "item-card" + (info ? " " + item.bin : "");

        const header = document.createElement("div");
        header.className = "item-header";
        const name = document.createElement("h3");
        name.textContent = item.name;
        const badge = document.createElement("span");
        badge.className = "bin-badge";
        badge.textContent = info ? info.label : item.bin;
        header.append(name, badge);
        card.append(header);

        if (item.explanation) card.append(makeNote("explanation", item.explanation));
        if (item.prep_required && item.prep_instructions) {
            card.append(makeNote("prep-note", "\u{1F9FC} Prep first: " + item.prep_instructions));
        }
        if (item.warning) card.append(makeNote("warning-box", "⚠️ " + item.warning));

        resultsList.append(card);
    }
    results.hidden = false;
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!processedBlob) return;

    classifyBtn.disabled = true;
    classifyBtn.textContent = "Sorting...";
    hideError();

    try {
        const formData = new FormData();
        formData.append("photo", processedBlob, "photo.jpg");

        const res = await fetch("/classify", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Something went wrong.");
        renderResults(data);
    } catch (err) {
        showError(err.message || "Something went wrong.");
    } finally {
        classifyBtn.disabled = false;
        classifyBtn.textContent = "Sort it";
    }
});
