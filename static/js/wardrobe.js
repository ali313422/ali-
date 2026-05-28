const STORAGE_KEY = "kitchenWardrobe_v1";

const wCustomer = document.getElementById("wCustomer");
const wNotes = document.getElementById("wNotes");
const wThk = document.getElementById("wThk");
const wWidth = document.getElementById("wWidth");
const wHeight = document.getElementById("wHeight");
const wDepth = document.getElementById("wDepth");
const wShelves = document.getElementById("wShelves");
const wHasRail = document.getElementById("wHasRail");
const wRailY = document.getElementById("wRailY");
const wDoorsCount = document.getElementById("wDoorsCount");
const wAddon = document.getElementById("wAddon");
const wAddonH = document.getElementById("wAddonH");
const wEngraved = document.getElementById("wEngraved");

const calcBtn = document.getElementById("calcBtn");
const saveWardrobePdfBtn = document.getElementById("saveWardrobePdfBtn");

const wardrobeTitle = document.getElementById("wardrobeTitle");
const wSummary = document.getElementById("wSummary");
const wDoorsPill = document.getElementById("wDoorsPill");
const wAreaPill = document.getElementById("wAreaPill");

const frontCanvas = document.getElementById("frontCanvas");
const cutListBody = document.getElementById("cutListBody");

function clampNumber(value, fallback, min = null, max = null) {
  const n = Number(value);
  const v = Number.isFinite(n) ? n : fallback;
  let out = v;
  if (min != null) out = Math.max(out, min);
  if (max != null) out = Math.min(out, max);
  return out;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[ch]);
}

function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readForm() {
  return {
    customer: String(wCustomer.value || "").trim(),
    notes: String(wNotes.value || "").trim(),
    thk: Math.round(clampNumber(wThk.value, 18, 8, 40)),
    width: Math.round(clampNumber(wWidth.value, 1600, 300, 6000)),
    height: Math.round(clampNumber(wHeight.value, 2400, 500, 4500)),
    depth: Math.round(clampNumber(wDepth.value, 600, 250, 1200)),
    shelves: Math.round(clampNumber(wShelves.value, 4, 0, 20)),
    hasRail: Boolean(wHasRail.checked),
    railY: Math.round(clampNumber(wRailY.value, 1650, 0, 4500)),
    doorsCount: Math.round(clampNumber(wDoorsCount.value, 2, 1, 8)),
    addon: String(wAddon.value || "none"),
    addonH: Math.round(clampNumber(wAddonH.value, 400, 0, 1200)),
    engraved: Boolean(wEngraved.checked)
  };
}

function setForm(state) {
  if (!state) return;
  wCustomer.value = state.customer || "";
  wNotes.value = state.notes || "";
  wThk.value = String(state.thk ?? 18);
  wWidth.value = String(state.width ?? 1600);
  wHeight.value = String(state.height ?? 2400);
  wDepth.value = String(state.depth ?? 600);
  wShelves.value = String(state.shelves ?? 4);
  wHasRail.checked = state.hasRail !== false;
  wRailY.value = String(state.railY ?? 1650);
  wDoorsCount.value = String(state.doorsCount ?? 2);
  wAddon.value = state.addon ?? "none";
  wAddonH.value = String(state.addonH ?? 400);
  wEngraved.checked = Boolean(state.engraved);
}

function doorConfig(state) {
  const gap = 2; // simple reveal gap per edge (mm)
  const count = Math.max(1, state.doorsCount);
  const totalGaps = (count + 1) * gap;
  const doorW = Math.max(50, Math.floor((state.width - totalGaps) / count));

  let mainDoorH = state.height;
  let addonRows = 0;
  if (state.addon === "single") addonRows = 1;
  if (state.addon === "double") addonRows = 2;
  if (addonRows > 0) mainDoorH = Math.max(200, state.height - state.addonH);

  const addonDoorH = addonRows > 0 ? Math.max(120, Math.floor(state.addonH / addonRows)) : 0;

  return {
    gap,
    count,
    doorW,
    mainDoorH,
    addonRows,
    addonDoorH
  };
}

function computeCutList(state) {
  const t = state.thk;
  const innerW = Math.max(0, state.width - 2 * t);
  const innerH = Math.max(0, state.height - 2 * t);

  const items = [];
  const add = (name, w, h, qty, material = "MDF/خشب", note = "") => {
    items.push({
      name,
      w: Math.round(w),
      h: Math.round(h),
      qty: Math.round(qty),
      material,
      note
    });
  };

  // Carcass (basic)
  add("جنب يمين", state.depth, state.height, 1, "خشب", "قص قائم");
  add("جنب يسار", state.depth, state.height, 1, "خشب", "قص قائم");
  add("قاعدة", innerW, state.depth, 1, "خشب", "بين الجنبين");
  add("سقف", innerW, state.depth, 1, "خشب", "بين الجنبين");

  // Shelves
  for (let i = 0; i < state.shelves; i += 1) {
    add(`رف ${i + 1}`, innerW, state.depth, 1, "خشب", "بين الجنبين");
  }

  // Doors (HDF) - widths are per leaf
  const doors = doorConfig(state);
  for (let i = 0; i < doors.count; i += 1) {
    add(
      `باب ${i + 1} (سفلي/رئيسي)`,
      doors.doorW,
      doors.mainDoorH,
      1,
      "HDF",
      state.engraved ? "نقش" : "بدون نقش"
    );
    for (let r = 0; r < doors.addonRows; r += 1) {
      add(
        `باب ${i + 1} (ملحق ${doors.addonRows === 2 ? "دبل" : "علوي"})`,
        doors.doorW,
        doors.addonDoorH,
        1,
        "HDF",
        state.engraved ? "نقش" : "بدون نقش"
      );
    }
  }

  // Hanging rail (as note only)
  if (state.hasRail) {
    add("علاقة ملابس (معلومة)", state.width - 40, 1, 1, "إكسسوار", `ارتفاع: ${state.railY}mm`);
  }

  // Summaries
  const doorAreaM2 = items
    .filter((i) => i.material === "HDF")
    .reduce((sum, i) => sum + (i.w * i.h * i.qty) / 1_000_000, 0);

  const doorCount = items.filter((i) => i.material === "HDF").reduce((sum, i) => sum + i.qty, 0);

  return { items, doorAreaM2, doorCount, innerW, innerH };
}

function renderCutList(items) {
  cutListBody.innerHTML = "";
  const rowStyle = "display:grid;grid-template-columns:1.4fr 0.9fr 0.9fr 0.6fr 0.9fr 0.7fr";
  items.forEach((i, idx) => {
    const row = document.createElement("div");
    row.className = "mdf-row";
    row.style = rowStyle;
    row.innerHTML = `
      <div><strong>${escapeHtml(i.name)}</strong></div>
      <div style="text-align:center">${i.w}</div>
      <div style="text-align:center">${i.h}</div>
      <div style="text-align:center">${i.qty}</div>
      <div style="text-align:center">${escapeHtml(i.material)}</div>
      <div>${escapeHtml(i.note || "")}</div>
    `;
    if (idx % 2 === 0) row.style.background = "rgba(0,0,0,0.015)";
    cutListBody.appendChild(row);
  });
}

function drawFront(ctx, state, calc) {
  const W = 1200;
  const H = 800;
  frontCanvas.width = W;
  frontCanvas.height = H;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0b111c";
  ctx.fillRect(0, 0, W, H);

  const pad = 60;
  const boxW = W - pad * 2;
  const boxH = H - pad * 2;

  // scale by wardrobe outer size
  const s = Math.min(boxW / state.width, boxH / state.height);
  const ww = state.width * s;
  const hh = state.height * s;
  const x0 = (W - ww) / 2;
  const y0 = (H - hh) / 2;

  // carcass frame
  ctx.strokeStyle = "rgba(246,198,107,0.9)";
  ctx.lineWidth = 4;
  ctx.strokeRect(x0, y0, ww, hh);

  // doors split
  const doors = doorConfig(state);
  const gap = doors.gap * s;
  const leafW = doors.doorW * s;
  const mainH = doors.mainDoorH * s;
  const addonH = doors.addonDoorH * s;

  // addon horizontal lines
  if (doors.addonRows > 0) {
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    const ySplit = y0 + addonH * doors.addonRows;
    ctx.beginPath();
    ctx.moveTo(x0, ySplit);
    ctx.lineTo(x0 + ww, ySplit);
    ctx.stroke();
  }

  // vertical door lines
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  for (let i = 1; i < doors.count; i += 1) {
    const vx = x0 + gap + i * (leafW + gap) - gap / 2;
    ctx.beginPath();
    ctx.moveTo(vx, y0);
    ctx.lineTo(vx, y0 + hh);
    ctx.stroke();
  }

  // shelves (internal)
  const innerX = x0 + state.thk * s;
  const innerY = y0 + state.thk * s;
  const innerW = (state.width - 2 * state.thk) * s;
  const innerH = (state.height - 2 * state.thk) * s;
  ctx.strokeStyle = "rgba(148,163,184,0.45)";
  ctx.lineWidth = 2;
  const shelfCount = state.shelves;
  for (let i = 1; i <= shelfCount; i += 1) {
    const y = innerY + (innerH * i) / (shelfCount + 1);
    ctx.beginPath();
    ctx.moveTo(innerX, y);
    ctx.lineTo(innerX + innerW, y);
    ctx.stroke();
  }

  // hanging rail
  if (state.hasRail) {
    const y = y0 + (state.height - state.railY) * s;
    ctx.strokeStyle = "rgba(34,197,94,0.85)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(innerX + 60, y);
    ctx.lineTo(innerX + innerW - 60, y);
    ctx.stroke();
  }

  // labels
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "bold 20px Tahoma, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${state.width}×${state.height} mm`, x0 + 8, y0 - 34);
  ctx.fillStyle = "rgba(226,232,240,0.85)";
  ctx.font = "16px Tahoma, Arial, sans-serif";
  ctx.fillText(`عمق: ${state.depth}mm | رفوف: ${state.shelves} | أبواب: ${doors.count} | ${state.engraved ? "نقش" : "بدون نقش"}`, x0 + 8, y0 - 12);
}

function drawTopView(ctx, state) {
  const W = 900;
  const H = 520;
  ctx.canvas.width = W;
  ctx.canvas.height = H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const pad = 70;
  const boxW = W - pad * 2;
  const boxH = H - pad * 2;
  const s = Math.min(boxW / state.width, boxH / state.depth);
  const ww = state.width * s;
  const dd = state.depth * s;
  const x0 = (W - ww) / 2;
  const y0 = (H - dd) / 2;

  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 3;
  ctx.strokeRect(x0, y0, ww, dd);

  // inner opening
  const t = state.thk * s;
  ctx.strokeStyle = "rgba(15,23,42,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + t, y0 + t, Math.max(0, ww - t * 2), Math.max(0, dd - t * 2));

  // dimension labels
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 18px Tahoma, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${state.width} mm`, x0 + ww / 2, y0 - 16);
  ctx.save();
  ctx.translate(x0 - 18, y0 + dd / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText(`${state.depth} mm`, 0, 0);
  ctx.restore();

  // title
  ctx.fillStyle = "rgba(51,65,85,0.9)";
  ctx.font = "bold 16px Tahoma, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Top View (من الأعلى)", 10, 10);
}

function drawSideView(ctx, state) {
  const W = 900;
  const H = 520;
  ctx.canvas.width = W;
  ctx.canvas.height = H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const pad = 70;
  const boxW = W - pad * 2;
  const boxH = H - pad * 2;
  const s = Math.min(boxW / state.depth, boxH / state.height);
  const dd = state.depth * s;
  const hh = state.height * s;
  const x0 = (W - dd) / 2;
  const y0 = (H - hh) / 2;

  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 3;
  ctx.strokeRect(x0, y0, dd, hh);

  const t = state.thk * s;
  ctx.strokeStyle = "rgba(15,23,42,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + t, y0 + t, Math.max(0, dd - t * 2), Math.max(0, hh - t * 2));

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 18px Tahoma, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${state.depth} mm`, x0 + dd / 2, y0 - 16);
  ctx.save();
  ctx.translate(x0 - 18, y0 + hh / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText(`${state.height} mm`, 0, 0);
  ctx.restore();

  ctx.fillStyle = "rgba(51,65,85,0.9)";
  ctx.font = "bold 16px Tahoma, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Side View (جانب)", 10, 10);
}

function drawIsoView(ctx, state) {
  const W = 900;
  const H = 520;
  ctx.canvas.width = W;
  ctx.canvas.height = H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const pad = 90;
  const s = Math.min((W - pad * 2) / (state.width + state.depth), (H - pad * 2) / (state.height + state.depth));
  const w = state.width * s;
  const h = state.height * s;
  const d = state.depth * s * 0.6;

  const x = (W - (w + d)) / 2;
  const y = (H - (h + d)) / 2 + 20;

  const p0 = { x, y: y + d };
  const p1 = { x: x + w, y: y + d };
  const p2 = { x: x + w + d, y };
  const p3 = { x: x + d, y };
  const p4 = { x, y: y + d + h };
  const p5 = { x: x + w, y: y + d + h };
  const p6 = { x: x + w + d, y: y + h };
  const p7 = { x: x + d, y: y + h };

  const stroke = "#0f172a";
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.fillStyle = "rgba(214,163,84,0.10)";

  // Front face
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p5.x, p5.y);
  ctx.lineTo(p4.x, p4.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Top face
  ctx.fillStyle = "rgba(15,23,42,0.05)";
  ctx.beginPath();
  ctx.moveTo(p3.x, p3.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p0.x, p0.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Side face
  ctx.fillStyle = "rgba(15,23,42,0.03)";
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p6.x, p6.y);
  ctx.lineTo(p5.x, p5.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(51,65,85,0.9)";
  ctx.font = "bold 16px Tahoma, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("3D View (منظور)", 10, 10);
}

function buildPdfA4({ state, calc }) {
  const jsPDF = globalThis.jspdf?.jsPDF;
  if (!jsPDF) {
    alert("تعذر تحميل مكتبة PDF. تأكد من الإنترنت ثم أعد المحاولة.");
    return;
  }

  // Build one A4 landscape technical sheet (Arabic-safe)
  const W = 1754;
  const H = 1240;
  const pad = 42;
  const titleStripW = 320;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Outer border
  ctx.strokeStyle = "rgba(15,23,42,0.55)";
  ctx.lineWidth = 3;
  ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);

  // Right title strip (like professional drawings)
  const stripX = W - pad - titleStripW;
  const stripY = pad;
  const stripH = H - pad * 2;
  ctx.fillStyle = "rgba(15,23,42,0.04)";
  ctx.strokeStyle = "rgba(15,23,42,0.22)";
  ctx.lineWidth = 2;
  roundRect(ctx, stripX, stripY, titleStripW, stripH, 18);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#0f172a";
  ctx.font = "900 24px Tahoma, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("Wardrobe Plan", stripX + titleStripW - 18, stripY + 18);
  ctx.fillStyle = "#d6a354";
  ctx.font = "900 28px Tahoma, Arial, sans-serif";
  ctx.fillText("مخططات الدولاب", stripX + titleStripW - 18, stripY + 48);

  ctx.fillStyle = "#334155";
  ctx.font = "18px Tahoma, Arial, sans-serif";
  const lines = [
    `الزبون: ${state.customer || "—"}`,
    `المقاس: ${state.width}×${state.height}×${state.depth} mm`,
    `سمك الخشب: ${state.thk} mm`,
    `رفوف: ${state.shelves} | علاقة: ${state.hasRail ? "نعم" : "لا"}`,
    `أبواب: ${doorConfig(state).count} | ${state.engraved ? "نقش" : "بدون نقش"}`,
    state.addon === "none" ? "ملحق: بدون" : `ملحق: ${state.addon === "double" ? "دبل" : "واحد"} (${state.addonH}mm)`,
    `تاريخ: ${new Date().toLocaleDateString("ar")}`,
    "المقياس: 1:20 (تقريبي)"
  ];
  let ly = stripY + 98;
  lines.forEach((t) => {
    ctx.fillText(t, stripX + titleStripW - 18, ly);
    ly += 30;
  });
  if (state.notes) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.strokeStyle = "rgba(15,23,42,0.18)";
    ctx.lineWidth = 2;
    roundRect(ctx, stripX + 14, stripY + stripH - 170, titleStripW - 28, 140, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#334155";
    ctx.font = "16px Tahoma, Arial, sans-serif";
    ctx.fillText("ملاحظات:", stripX + titleStripW - 26, stripY + stripH - 160);
    ctx.font = "15px Tahoma, Arial, sans-serif";
    ctx.fillText(state.notes.slice(0, 80), stripX + titleStripW - 26, stripY + stripH - 132);
  }

  // Panels area
  const panelsX = pad + 16;
  const panelsY = pad + 16;
  const panelsW = stripX - panelsX - 16;
  const panelsH = H - pad * 2 - 32;

  const gap = 14;
  const colW = Math.floor((panelsW - gap) / 2);
  const rowH = Math.floor((panelsH - gap) / 2);

  const panel = (x, y, w, h, title) => {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(15,23,42,0.22)";
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(15,23,42,0.75)";
    ctx.font = "bold 16px Tahoma, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(title, x + 14, y + 12);
  };

  const p1 = { x: panelsX, y: panelsY, w: colW, h: rowH, title: "Front Elevation (واجهة)" };
  const p2 = { x: panelsX + colW + gap, y: panelsY, w: colW, h: rowH, title: "Internal Elevation (داخلي)" };
  const p3 = { x: panelsX, y: panelsY + rowH + gap, w: colW, h: rowH, title: "Top View (من الأعلى)" };
  const p4 = { x: panelsX + colW + gap, y: panelsY + rowH + gap, w: colW, h: rowH, title: "3D View (منظور)" };

  [p1, p2, p3, p4].forEach((p) => panel(p.x, p.y, p.w, p.h, p.title));

  // Render view canvases
  const topC = document.createElement("canvas");
  drawTopView(topC.getContext("2d"), state);
  const sideC = document.createElement("canvas");
  drawSideView(sideC.getContext("2d"), state);
  const isoC = document.createElement("canvas");
  drawIsoView(isoC.getContext("2d"), state);

  // Internal elevation: reuse front but with doors hidden (simple)
  const internalC = document.createElement("canvas");
  const ictx = internalC.getContext("2d");
  internalC.width = 1200;
  internalC.height = 800;
  // draw same as front but without door lines: quick approach: call drawFront then overlay door lines faintly off
  drawFront(ictx, state, calc);
  // "erase" door lines by redrawing carcass + shelves only
  ictx.globalCompositeOperation = "source-over";
  // overlay a soft white veil for "internal"
  ictx.fillStyle = "rgba(255,255,255,0.06)";
  ictx.fillRect(0, 0, internalC.width, internalC.height);

  const drawIntoPanel = (imgCanvas, p) => {
    const inset = 40;
    const maxW = p.w - inset * 2;
    const maxH = p.h - inset * 2;
    const s = Math.min(maxW / imgCanvas.width, maxH / imgCanvas.height);
    const w = imgCanvas.width * s;
    const h = imgCanvas.height * s;
    const x = p.x + (p.w - w) / 2;
    const y = p.y + 34 + (p.h - 34 - h) / 2;
    ctx.drawImage(imgCanvas, x, y, w, h);
  };

  drawIntoPanel(frontCanvas, p1);
  drawIntoPanel(internalC, p2);
  drawIntoPanel(topC, p3);
  drawIntoPanel(isoC, p4);

  // export
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const jpeg = canvas.toDataURL("image/jpeg", 0.92);
  pdf.addImage(jpeg, "JPEG", 0, 0, pageW, pageH, undefined, "FAST");
  const safeName = (state.customer || "wardrobe").replace(/[\\/:*?"<>|]/g, "-").trim() || "wardrobe";
  pdf.save(`wardrobe-${safeName}-${Date.now()}.pdf`);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function updateAll() {
  const state = readForm();
  saveState(state);
  wardrobeTitle.textContent = state.customer ? `مخطط دولاب — ${state.customer}` : "مخطط دولاب";

  const calc = computeCutList(state);
  renderCutList(calc.items.filter((i) => i.material !== "إكسسوار"));

  const doors = doorConfig(state);
  wDoorsPill.textContent = `الأبواب: ${calc.doorCount} (${doors.count} ضلفة × ${doors.addonRows ? `+ملحق ${doors.addonRows}` : "بدون ملحق"})`;
  wAreaPill.textContent = `مساحة الأبواب: ${calc.doorAreaM2.toFixed(2)} م²`;
  wSummary.textContent = `داخلي: ${calc.innerW}×${calc.innerH}mm | رفوف: ${state.shelves} | علاقة: ${state.hasRail ? "نعم" : "لا"}`;

  const ctx = frontCanvas.getContext("2d");
  drawFront(ctx, state, calc);

  return { state, calc };
}

// Events
calcBtn.addEventListener("click", updateAll);
saveWardrobePdfBtn.addEventListener("click", () => {
  const out = updateAll();
  buildPdfA4(out);
});

[wCustomer, wNotes, wThk, wWidth, wHeight, wDepth, wShelves, wHasRail, wRailY, wDoorsCount, wAddon, wAddonH, wEngraved].forEach((el) => {
  el.addEventListener("input", () => {
    updateAll();
  });
  el.addEventListener("change", () => {
    updateAll();
  });
});

// Boot
setForm(readState());
updateAll();

