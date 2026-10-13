const config = window.SIGN_CONFIG || {};
const BUILDINGS = ["1", "3", "5", "7", "9"];

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
const coverageEl = document.querySelector("#coverage-rows");

let strokes = [];
let currentItems = [];
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

function buildingRank(building) {
  const index = BUILDINGS.indexOf(String(building));
  return index === -1 ? BUILDINGS.length : index;
}

function sortedItems(items) {
  return [...items].sort((a, b) => {
    const byBuilding = buildingRank(a.building) - buildingRank(b.building);
    if (byBuilding) return byBuilding;
    const byApartment = String(a.apartment).localeCompare(String(b.apartment), "he", { numeric: true });
    if (byApartment) return byApartment;
    return String(a.signedAt).localeCompare(String(b.signedAt));
  });
}

function coverageRows(items) {
  const groups = new Map(BUILDINGS.map((building) => [building, []]));
  items.forEach((item) => {
    const building = String(item.building);
    if (!groups.has(building)) groups.set(building, []);
    groups.get(building).push(String(item.apartment));
  });
  return [...groups.entries()].map(([building, apartments]) => {
    const unique = [...new Set(apartments)].sort((a, b) => a.localeCompare(b, "he", { numeric: true }));
    return { building, apartments: unique, count: unique.length };
  });
}

function renderRows(items) {
  const sorted = sortedItems(items);
  rowsEl.replaceChildren();
  if (!sorted.length) {
    rowsEl.innerHTML = `<tr><td class="empty" colspan="6">עדיין אין חתימות</td></tr>`;
    countEl.textContent = "0 חתימות";
    return;
  }
  sorted.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${index + 1}</td><td></td><td></td><td></td><td></td><td></td>`;
    const cells = tr.children;
    cells[1].textContent = item.building;
    cells[2].textContent = item.apartment;
    cells[3].textContent = item.name;
    cells[4].textContent = formatDate(item.date);
    const canvas = document.createElement("canvas");
    cells[5].replaceChildren(canvas);
    drawStrokes(canvas, item.strokes || []);
    rowsEl.append(tr);
  });
  countEl.textContent = `${sorted.length} חתימות`;
}

function renderCoverage(items) {
  const rows = coverageRows(items);
  coverageEl.replaceChildren();
  let total = 0;
  rows.forEach((row) => {
    total += row.count;
    const tr = document.createElement("tr");
    [row.building, row.apartments.length ? row.apartments.join(", ") : "—", String(row.count)].forEach(
      (value) => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      },
    );
    coverageEl.append(tr);
  });
  const totalRow = document.createElement("tr");
  totalRow.className = "total-row";
  ["סה״כ", "", String(total)].forEach((value) => {
    const td = document.createElement("td");
    td.textContent = value;
    totalRow.append(td);
  });
  coverageEl.append(totalRow);
}

async function refresh() {
  loadError.hidden = true;
  try {
    const { items } = await loadRecord();
    currentItems = items;
    renderRows(items);
    renderCoverage(items);
  } catch (error) {
    currentItems = [];
    rowsEl.innerHTML = `<tr><td class="empty" colspan="6">לא ניתן לטעון את החתימות.</td></tr>`;
    renderCoverage([]);
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

const PDF_W = 1190;
const PDF_H = 1684;
const PDF_MARGIN = 56;
const PDF_COLUMNS = [
  { title: "מס'", width: 70, key: "n" },
  { title: "מספר בניין", width: 130, key: "building" },
  { title: "מספר דירה", width: 130, key: "apartment" },
  { title: "שם מלא", width: 304, key: "name" },
  { title: "תאריך", width: 150, key: "date" },
  { title: "חתימה", width: 294, key: "sign" },
];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image"));
    image.src = src;
  });
}

function newPdfPage() {
  const canvas = document.createElement("canvas");
  canvas.width = PDF_W;
  canvas.height = PDF_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PDF_W, PDF_H);
  ctx.fillStyle = "#1a2744";
  ctx.textBaseline = "middle";
  return { canvas, ctx, y: PDF_MARGIN };
}

function columnBoxes(y, height) {
  let x = PDF_W - PDF_MARGIN;
  return PDF_COLUMNS.map((column) => {
    x -= column.width;
    return { ...column, x, y, height };
  });
}

function drawPdfText(ctx, text, x, y, align, direction) {
  ctx.save();
  ctx.direction = direction;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawCellBorders(ctx, boxes) {
  ctx.save();
  ctx.strokeStyle = "#d5dde8";
  ctx.lineWidth = 1;
  boxes.forEach((box) => ctx.strokeRect(box.x, box.y, box.width, box.height));
  ctx.restore();
}

function drawSignature(ctx, strokes, box) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x + 8, box.y + 8, box.width - 16, box.height - 16);
  ctx.clip();
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1a2744";
  ctx.fillStyle = "#1a2744";
  const width = box.width - 20;
  const height = box.height - 20;
  const left = box.x + 10;
  const top = box.y + 10;
  (strokes || []).forEach((stroke) => {
    if (!stroke.length) return;
    if (stroke.length === 1) {
      ctx.beginPath();
      ctx.arc(left + stroke[0][0] * width, top + stroke[0][1] * height, 1.4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    stroke.forEach(([px, py], index) => {
      const x = left + px * width;
      const y = top + py * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  ctx.restore();
}

function drawTableHeader(ctx, y) {
  const boxes = columnBoxes(y, 52);
  ctx.save();
  ctx.fillStyle = "#f4f7fb";
  boxes.forEach((box) => ctx.fillRect(box.x, box.y, box.width, box.height));
  ctx.restore();
  drawCellBorders(ctx, boxes);
  ctx.save();
  ctx.fillStyle = "#1e3a5f";
  ctx.font = "700 22px Heebo, Arial Hebrew, sans-serif";
  boxes.forEach((box) => {
    drawPdfText(ctx, box.title, box.x + box.width / 2, box.y + box.height / 2, "center", "rtl");
  });
  ctx.restore();
  return y + 52;
}

function buildPdfCanvases(items) {
  const pages = [];
  let state = newPdfPage();
  const sorted = sortedItems(items);

  state.ctx.font = "700 36px Heebo, Arial Hebrew, sans-serif";
  state.ctx.fillStyle = "#1e3a5f";
  drawPdfText(state.ctx, "טבלת חתימות ואישור בעלי הדירות", PDF_W - PDF_MARGIN, state.y + 18, "right", "rtl");
  state.y += 64;
  state.y = drawTableHeader(state.ctx, state.y);

  if (!sorted.length) {
    state.ctx.font = "400 24px Heebo, Arial Hebrew, sans-serif";
    state.ctx.fillStyle = "#52627a";
    drawPdfText(state.ctx, "עדיין אין חתימות", PDF_W - PDF_MARGIN, state.y + 36, "right", "rtl");
    state.y += 72;
  }

  sorted.forEach((item, index) => {
    if (state.y + 84 > PDF_H - PDF_MARGIN) {
      pages.push(state.canvas);
      state = newPdfPage();
      state.y = drawTableHeader(state.ctx, state.y);
    }
    const boxes = columnBoxes(state.y, 84);
    drawCellBorders(state.ctx, boxes);
    state.ctx.font = "400 24px Heebo, Arial Hebrew, sans-serif";
    state.ctx.fillStyle = "#1a2744";
    const values = {
      n: String(index + 1),
      building: String(item.building),
      apartment: String(item.apartment),
      name: String(item.name),
      date: formatDate(item.date),
    };
    boxes.forEach((box) => {
      if (box.key === "sign") {
        drawSignature(state.ctx, item.strokes, box);
        return;
      }
      const align = box.key === "name" ? "right" : "center";
      const x = box.key === "name" ? box.x + box.width - 12 : box.x + box.width / 2;
      drawPdfText(state.ctx, values[box.key], x, box.y + box.height / 2, align, "rtl");
    });
    state.y += 84;
  });

  state.y += 48;
  if (state.y + 80 > PDF_H - PDF_MARGIN) {
    pages.push(state.canvas);
    state = newPdfPage();
  }
  state.ctx.font = "700 36px Heebo, Arial Hebrew, sans-serif";
  state.ctx.fillStyle = "#1e3a5f";
  drawPdfText(state.ctx, "דירות שחתמו", PDF_W - PDF_MARGIN, state.y + 18, "right", "rtl");
  state.y += 56;

  const summaryColumns = [
    { title: "מספר בניין", width: 220 },
    { title: "דירות שחתמו", width: 638 },
    { title: "כמות", width: 220 },
  ];
  const drawSummaryHeader = () => {
    let x = PDF_W - PDF_MARGIN;
    const boxes = summaryColumns.map((column) => {
      x -= column.width;
      return { ...column, x, y: state.y, height: 52 };
    });
    state.ctx.save();
    state.ctx.fillStyle = "#f4f7fb";
    boxes.forEach((box) => state.ctx.fillRect(box.x, box.y, box.width, box.height));
    state.ctx.restore();
    drawCellBorders(state.ctx, boxes);
    state.ctx.font = "700 22px Heebo, Arial Hebrew, sans-serif";
    state.ctx.fillStyle = "#1e3a5f";
    boxes.forEach((box) => {
      drawPdfText(state.ctx, box.title, box.x + box.width / 2, box.y + 26, "center", "rtl");
    });
    state.y += 52;
    return boxes;
  };
  drawSummaryHeader();

  const rows = coverageRows(sorted);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  [...rows, { building: "סה״כ", apartments: [], count: total, total: true }].forEach((row) => {
    const text = row.total ? "" : row.apartments.length ? row.apartments.join(", ") : "—";
    const lines = [];
    state.ctx.font = row.total ? "700 24px Heebo, Arial Hebrew, sans-serif" : "400 24px Heebo, Arial Hebrew, sans-serif";
    if (!text) lines.push("");
    else {
      let line = "";
      text.split(", ").forEach((part, partIndex) => {
        const next = line ? `${line}, ${part}` : part;
        if (state.ctx.measureText(next).width > 600 && line) {
          lines.push(line);
          line = part;
        } else if (partIndex === 0) line = part;
        else line = next;
      });
      if (line) lines.push(line);
    }
    const height = Math.max(52, lines.length * 32 + 16);
    if (state.y + height > PDF_H - PDF_MARGIN) {
      pages.push(state.canvas);
      state = newPdfPage();
      drawSummaryHeader();
    }
    let x = PDF_W - PDF_MARGIN;
    const boxes = summaryColumns.map((column) => {
      x -= column.width;
      return { ...column, x, y: state.y, height };
    });
    if (row.total) {
      state.ctx.save();
      state.ctx.fillStyle = "#f4f7fb";
      boxes.forEach((box) => state.ctx.fillRect(box.x, box.y, box.width, box.height));
      state.ctx.restore();
    }
    drawCellBorders(state.ctx, boxes);
    state.ctx.fillStyle = "#1a2744";
    state.ctx.font = row.total ? "700 24px Heebo, Arial Hebrew, sans-serif" : "400 24px Heebo, Arial Hebrew, sans-serif";
    drawPdfText(state.ctx, row.building, boxes[0].x + boxes[0].width / 2, boxes[0].y + height / 2, "center", "rtl");
    lines.forEach((line, lineIndex) => {
      drawPdfText(
        state.ctx,
        line,
        boxes[1].x + boxes[1].width - 16,
        boxes[1].y + 24 + lineIndex * 32,
        "right",
        "rtl",
      );
    });
    drawPdfText(state.ctx, String(row.count), boxes[2].x + boxes[2].width / 2, boxes[2].y + height / 2, "center", "ltr");
    state.y += height;
  });

  pages.push(state.canvas);
  return pages;
}

async function downloadPdf() {
  const buttons = [...document.querySelectorAll("[data-download-pdf]")];
  buttons.forEach((button) => {
    button.disabled = true;
    button.textContent = "מכין PDF…";
  });
  try {
    if (!window.jspdf) throw new Error("library");
    await Promise.all([
      document.fonts.load("400 24px Heebo"),
      document.fonts.load("700 22px Heebo"),
      document.fonts.load("700 36px Heebo"),
    ]).catch(() => {});
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const image = await loadImage("page-1.png");
    const margin = 28;
    let width = pageWidth - margin * 2;
    let height = width * (image.height / image.width);
    if (height > pageHeight - margin * 2) {
      height = pageHeight - margin * 2;
      width = height * (image.width / image.height);
    }
    pdf.addImage(image, "PNG", (pageWidth - width) / 2, margin, width, height);
    buildPdfCanvases(currentItems).forEach((canvas) => {
      pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageWidth, pageHeight);
    });
    pdf.save("אישור-דיירים.pdf");
  } catch (error) {
    loadError.hidden = false;
    loadError.textContent = "לא ניתן להכין את קובץ ה-PDF. נסו לרענן את הדף.";
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
      button.textContent = "הורדת PDF";
    });
  }
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
document.querySelectorAll("[data-download-pdf]").forEach((button) => {
  button.addEventListener("click", downloadPdf);
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
  if (!BUILDINGS.includes(record.building)) {
    showError("בחרו בניין.");
    return;
  }

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
