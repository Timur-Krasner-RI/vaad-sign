const config = window.SIGN_CONFIG || {};
const TOTAL_ROWS = 25;

const dialog = document.querySelector("#sign-dialog");
const form = document.querySelector("#sign-form");
const pad = document.querySelector("#pad");
const formError = document.querySelector("#form-error");
const replaceRow = document.querySelector("#replace-row");
const submitButton = document.querySelector("#submit-sign");
const rowsEl = document.querySelector("#sign-rows");
const countEl = document.querySelector("#sign-count");
const loadError = document.querySelector("#load-error");
const setupBanner = document.querySelector("#setup-banner");

let strokes = [];
let activeStroke = null;
let replaceExisting = false;

function todayISO() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function formatDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return iso || "";
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function apiHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  return headers;
}

function contentsUrl(read) {
  const path = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/signatures.json`;
  if (!read) return path;
  return `${path}?ref=${encodeURIComponent(config.branch || "main")}`;
}

function encodeContent(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeContent(b64) {
  const binary = atob(String(b64).replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function loadRecord() {
  const response = await fetch(contentsUrl(true), {
    headers: apiHeaders(),
    cache: "no-store",
  });
  if (response.status === 404) return { sha: null, items: [] };
  if (!response.ok) {
    const error = new Error("load");
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  const items = JSON.parse(decodeContent(data.content));
  if (!Array.isArray(items)) throw new Error("format");
  return { sha: data.sha, items };
}

async function saveRecord(record) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { sha, items } = await loadRecord();
    const index = items.findIndex(
      (item) => item.building === record.building && item.apartment === record.apartment,
    );
    if (index >= 0 && !replaceExisting) {
      const error = new Error("duplicate");
      error.code = "duplicate";
      throw error;
    }
    if (index >= 0) items[index] = record;
    else items.push(record);

    const body = {
      message: `חתימה: בניין ${record.building} דירה ${record.apartment}`,
      content: encodeContent(`${JSON.stringify(items, null, 2)}\n`),
      branch: config.branch || "main",
    };
    if (sha) body.sha = sha;

    const response = await fetch(contentsUrl(false), {
      method: "PUT",
      headers: {
        ...apiHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (response.ok) return;
    if (response.status === 409 || response.status === 422) {
      lastError = new Error("conflict");
      continue;
    }
    const error = new Error("save");
    error.status = response.status;
    throw error;
  }
  throw lastError || new Error("conflict");
}

function drawStrokes(canvas, source) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1a2744";
  ctx.fillStyle = "#1a2744";

  for (const stroke of source) {
    if (!stroke.length) continue;
    if (stroke.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke[0][0] * width, stroke[0][1] * height, 1.2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    stroke.forEach(([x, y], i) => {
      const px = x * width;
      const py = y * height;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
}

function pointFromEvent(event) {
  const rect = pad.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
}

function paintPad() {
  const current = activeStroke ? [...strokes, activeStroke] : strokes;
  drawStrokes(pad, current);
}

function startStroke(event) {
  pad.setPointerCapture(event.pointerId);
  activeStroke = [pointFromEvent(event)];
  paintPad();
}

function moveStroke(event) {
  if (!activeStroke) return;
  const point = pointFromEvent(event);
  const last = activeStroke[activeStroke.length - 1];
  const dx = point[0] - last[0];
  const dy = point[1] - last[1];
  if (dx * dx + dy * dy < 0.00005) return;
  activeStroke.push(point);
  paintPad();
}

function endStroke() {
  if (!activeStroke) return;
  if (activeStroke.length) strokes.push(activeStroke);
  activeStroke = null;
  paintPad();
}

function signaturePointCount() {
  return strokes.reduce((sum, stroke) => sum + stroke.length, 0);
}

function showError(message) {
  formError.hidden = false;
  formError.textContent = message;
}

function clearError() {
  formError.hidden = true;
  formError.textContent = "";
  replaceRow.hidden = true;
}

function renderRows(items) {
  const sorted = [...items].sort((a, b) => String(a.signedAt).localeCompare(String(b.signedAt)));
  rowsEl.replaceChildren();
  const rowCount = Math.max(TOTAL_ROWS, sorted.length);
  for (let i = 0; i < rowCount; i += 1) {
    const item = sorted[i];
    const tr = document.createElement("tr");
    if (!item) {
      tr.innerHTML = `<td>${i + 1}</td><td></td><td></td><td></td><td></td><td></td>`;
      rowsEl.append(tr);
      continue;
    }
    tr.innerHTML = `<td>${i + 1}</td><td></td><td></td><td></td><td></td><td></td>`;
    const cells = tr.children;
    cells[1].textContent = item.building;
    cells[2].textContent = item.apartment;
    cells[3].textContent = item.name;
    cells[4].textContent = formatDate(item.date);
    const canvas = document.createElement("canvas");
    cells[5].replaceChildren(canvas);
    drawStrokes(canvas, item.strokes || []);
    rowsEl.append(tr);
  }
  countEl.textContent = `${sorted.length} חתימות`;
}

async function refresh() {
  loadError.hidden = true;
  try {
    const { items } = await loadRecord();
    renderRows(items);
  } catch (error) {
    rowsEl.innerHTML = `<tr><td class="empty" colspan="6">לא ניתן לטעון את החתימות.</td></tr>`;
    countEl.textContent = "";
    loadError.hidden = false;
    loadError.textContent =
      error.status === 404
        ? "קובץ החתימות עדיין לא קיים בריפו."
        : "לא ניתן לטעון את החתימות. אם הריפו פרטי, הדף צריך מפתח גישה.";
  }
}

function openDialog() {
  replaceExisting = false;
  clearError();
  form.reset();
  form.elements.date.value = todayISO();
  strokes = [];
  activeStroke = null;
  dialog.showModal();
  paintPad();
}

function closeDialog() {
  dialog.close();
}

function errorMessage(error) {
  if (!config.token) return "שמירת החתימות עדיין לא הופעלה.";
  if (error.code === "duplicate") return "לדירה הזו כבר נשמרה חתימה.";
  if (error.status === 401) return "מפתח הגישה לא תקין.";
  if (error.status === 403) return "למפתח אין הרשאה לכתוב לריפו.";
  return "השמירה נכשלה. נסו שוב.";
}

pad.addEventListener("pointerdown", startStroke);
pad.addEventListener("pointermove", moveStroke);
pad.addEventListener("pointerup", endStroke);
pad.addEventListener("pointercancel", endStroke);

document.querySelector("#clear-pad").addEventListener("click", () => {
  strokes = [];
  activeStroke = null;
  paintPad();
});

document.querySelectorAll("[data-open-sign]").forEach((button) => {
  button.addEventListener("click", openDialog);
});
document.querySelector("[data-close-sign]").addEventListener("click", closeDialog);

document.querySelector("#replace-sign").addEventListener("click", () => {
  replaceExisting = true;
  form.requestSubmit();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  if (signaturePointCount() < 8) {
    showError("חתמו בתוך המסגרת.");
    return;
  }

  const data = new FormData(form);
  const record = {
    id: crypto.randomUUID(),
    building: String(data.get("building") || "").trim(),
    apartment: String(data.get("apartment") || "").trim(),
    name: String(data.get("name") || "").trim(),
    date: String(data.get("date") || ""),
    signedAt: new Date().toISOString(),
    strokes,
  };

  submitButton.disabled = true;
  submitButton.textContent = "שומר…";
  try {
    await saveRecord(record);
    closeDialog();
    await refresh();
  } catch (error) {
    if (error.code === "duplicate") replaceRow.hidden = false;
    showError(errorMessage(error));
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "שמירת החתימה";
  }
});

if (!config.token) setupBanner.hidden = false;
refresh();
window.addEventListener("resize", paintPad);
