const STORAGE_KEY = "kitchenMdfCut_v1";

const sheetWInput = document.getElementById("sheetW");
const sheetHInput = document.getElementById("sheetH");
const kerfInput = document.getElementById("kerf");
const marginInput = document.getElementById("margin");
const piecesBody = document.getElementById("piecesBody");
const addRowBtn = document.getElementById("addRowBtn");
const clearRowsBtn = document.getElementById("clearRowsBtn");
const packBtn = document.getElementById("packBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const savePdfBtn = document.getElementById("savePdfBtn");
const printBtn = document.getElementById("printBtn");
const sheetsEl = document.getElementById("sheets");
const summaryText = document.getElementById("summaryText");

function clampNumber(value, fallback, min = null, max = null) {
  const n = Number(value);
  const v = Number.isFinite(n) ? n : fallback;
  let out = v;
  if (min != null) out = Math.max(out, min);
  if (max != null) out = Math.min(out, max);
  return out;
}

function uid() {
  return `p_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function defaultState() {
  return {
    sheetW: 1220,
    sheetH: 2440,
    kerf: 3,
    margin: 8,
    pieces: [
      { id: uid(), name: "قطعة 1", w: 600, h: 720, qty: 2, rotate: true },
      { id: uid(), name: "قطعة 2", w: 300, h: 720, qty: 2, rotate: true }
    ]
  };
}

function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw) return defaultState();
    const next = { ...defaultState(), ...raw };
    next.pieces = Array.isArray(raw.pieces) && raw.pieces.length ? raw.pieces : defaultState().pieces;
    return next;
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizePiece(p) {
  return {
    id: String(p.id || uid()),
    name: String(p.name || "قطعة").trim() || "قطعة",
    w: Math.round(clampNumber(p.w, 100, 1)),
    h: Math.round(clampNumber(p.h, 100, 1)),
    qty: Math.round(clampNumber(p.qty, 1, 1, 999)),
    rotate: Boolean(p.rotate)
  };
}

function readFormState() {
  const pieces = [...piecesBody.querySelectorAll("[data-piece-id]")].map((row) => {
    const id = row.dataset.pieceId;
    const name = row.querySelector("[data-field='name']").value;
    const w = row.querySelector("[data-field='w']").value;
    const h = row.querySelector("[data-field='h']").value;
    const qty = row.querySelector("[data-field='qty']").value;
    const rotate = row.querySelector("[data-field='rotate']").checked;
    return normalizePiece({ id, name, w, h, qty, rotate });
  });
  return {
    sheetW: Math.round(clampNumber(sheetWInput.value, 1220, 50)),
    sheetH: Math.round(clampNumber(sheetHInput.value, 2440, 50)),
    kerf: clampNumber(kerfInput.value, 3, 0, 20),
    margin: Math.round(clampNumber(marginInput.value, 8, 0, 200)),
    pieces
  };
}

function setFormFromState(state) {
  sheetWInput.value = String(state.sheetW);
  sheetHInput.value = String(state.sheetH);
  kerfInput.value = String(state.kerf);
  marginInput.value = String(state.margin);
  renderPiecesTable(state.pieces);
}

function renderPiecesTable(pieces) {
  piecesBody.innerHTML = "";
  pieces.forEach((p) => piecesBody.appendChild(renderPieceRow(p)));
}

function renderPieceRow(piece) {
  const p = normalizePiece(piece);
  const row = document.createElement("div");
  row.className = "mdf-row";
  row.dataset.pieceId = p.id;
  row.innerHTML = `
    <input data-field="name" type="text" value="${escapeHtml(p.name)}" placeholder="مثال: جنب دولاب">
    <input data-field="w" type="number" min="1" step="1" value="${p.w}" inputmode="numeric">
    <input data-field="h" type="number" min="1" step="1" value="${p.h}" inputmode="numeric">
    <input data-field="qty" type="number" min="1" step="1" value="${p.qty}" inputmode="numeric">
    <label class="switch-card switch-card--compact" style="justify-content:space-between">
      <input data-field="rotate" type="checkbox" ${p.rotate ? "checked" : ""}>
      <span>يسمح</span>
    </label>
    <button type="button" class="icon-btn" data-action="delete" aria-label="حذف">×</button>
  `;
  row.querySelector("[data-action='delete']").addEventListener("click", () => {
    row.remove();
    persistFromUi();
  });
  row.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", persistFromUi);
    input.addEventListener("change", persistFromUi);
  });
  return row;
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

function persistFromUi() {
  const state = readFormState();
  saveState(state);
}

function expandPieces(pieces) {
  const expanded = [];
  pieces.forEach((p) => {
    const pp = normalizePiece(p);
    for (let i = 0; i < pp.qty; i += 1) {
      expanded.push({
        id: `${pp.id}_${i + 1}`,
        baseId: pp.id,
        name: pp.name,
        w: pp.w,
        h: pp.h,
        rotate: pp.rotate
      });
    }
  });
  return expanded;
}

function shelfPack({ sheetW, sheetH, margin, kerf, pieces }) {
  const usableW = sheetW - margin * 2;
  const usableH = sheetH - margin * 2;
  if (usableW <= 0 || usableH <= 0) {
    return { ok: false, error: "bad_sheet", sheets: [] };
  }

  const items = expandPieces(pieces)
    .filter((p) => p.w > 0 && p.h > 0)
    .sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));

  const sheets = [];
  let sheetIndex = -1;

  const newSheet = () => {
    sheetIndex += 1;
    sheets.push({
      index: sheetIndex,
      placed: [],
      shelves: []
    });
    return sheets[sheetIndex];
  };

  let sheet = newSheet();
  let x = 0;
  let y = 0;
  let shelfH = 0;

  const nextShelf = () => {
    y += shelfH + kerf;
    x = 0;
    shelfH = 0;
  };

  const nextSheet = () => {
    sheet = newSheet();
    x = 0;
    y = 0;
    shelfH = 0;
  };

  const tryPlaceInCurrentShelf = (item) => {
    const candidates = [];
    candidates.push({ w: item.w, h: item.h, rotated: false });
    if (item.rotate && item.w !== item.h) candidates.push({ w: item.h, h: item.w, rotated: true });

    for (const c of candidates) {
      const fitsW = x + c.w <= usableW;
      const fitsH = y + c.h <= usableH;
      if (!fitsW || !fitsH) continue;
      return c;
    }
    return null;
  };

  for (const item of items) {
    // Validate impossible part early
    const minSide = Math.min(item.w, item.h);
    const maxSide = Math.max(item.w, item.h);
    const canFit = item.rotate
      ? (minSide <= usableW && maxSide <= usableH) || (minSide <= usableH && maxSide <= usableW)
      : (item.w <= usableW && item.h <= usableH);
    if (!canFit) {
      return { ok: false, error: `piece_too_large:${item.name}`, sheets };
    }

    let chosen = tryPlaceInCurrentShelf(item);
    if (!chosen) {
      // Try a new shelf
      nextShelf();
      chosen = tryPlaceInCurrentShelf(item);
    }
    if (!chosen) {
      // Try a new sheet
      nextSheet();
      chosen = tryPlaceInCurrentShelf(item);
    }
    if (!chosen) {
      return { ok: false, error: "pack_failed", sheets };
    }

    const placed = {
      id: item.id,
      name: item.name,
      w: chosen.w,
      h: chosen.h,
      rotated: chosen.rotated,
      x: margin + x,
      y: margin + y
    };
    sheet.placed.push(placed);

    x += chosen.w + kerf;
    shelfH = Math.max(shelfH, chosen.h);
  }

  return { ok: true, sheets, meta: { usableW, usableH } };
}

function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < String(name).length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 72% 60% / 0.35)`;
}

function sortPlacementsReadingOrder(placements) {
  return [...placements].sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

function withStrokeText(ctx, text, x, y, { stroke = "rgba(0,0,0,0.62)", fill = "rgba(255,255,255,0.98)", lineWidth = 3 } = {}) {
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawFittedLabel(ctx, placement, { scale = 1, pad = 10 } = {}) {
  const p = placement;
  const inset = Math.max(6, pad / scale);
  const rectX = p.x;
  const rectY = p.y;
  const rectW = p.w;
  const rectH = p.h;

  // Clip to keep text strictly inside the piece.
  ctx.save();
  ctx.beginPath();
  ctx.rect(rectX + 1 / scale, rectY + 1 / scale, rectW - 2 / scale, rectH - 2 / scale);
  ctx.clip();

  const lines = [
    `${p.labelIndex != null ? `${p.labelIndex}. ` : ""}${p.name}`.trim(),
    `${p.w}×${p.h}${p.rotated ? " (R)" : ""}`
  ];

  // Try orientations: normal then rotated -90 if it doesn't fit.
  const attempts = [
    { rotate: 0, maxW: rectW - inset * 2, maxH: rectH - inset * 2 },
    { rotate: -Math.PI / 2, maxW: rectH - inset * 2, maxH: rectW - inset * 2 }
  ];

  const minFont = Math.max(10, 14 / scale);
  const maxFont = Math.max(16, 40 / scale);

  const tryDraw = (attempt) => {
    const lineGap = Math.max(2, 6 / scale);
    for (let font = maxFont; font >= minFont; font -= Math.max(1, 3 / scale)) {
      ctx.font = `900 ${font}px Tahoma, Arial, sans-serif`;
      const w0 = ctx.measureText(lines[0]).width;
      const w1 = ctx.measureText(lines[1]).width;
      const blockW = Math.max(w0, w1);
      const blockH = font * 2 + lineGap;
      if (blockW <= attempt.maxW && blockH <= attempt.maxH) {
        // Draw (top-right aligned in RTL)
        const lw = Math.max(2, (font * 0.26) / scale);
        if (attempt.rotate === 0) {
          ctx.textAlign = "right";
          ctx.textBaseline = "top";
          const x = rectX + rectW - inset;
          const y = rectY + inset;
          withStrokeText(ctx, lines[0], x, y, { lineWidth: lw });
          withStrokeText(ctx, lines[1], x, y + font + lineGap, { lineWidth: lw });
        } else {
          // Rotate around a point inside the rectangle.
          // We want the block to appear along the long axis.
          ctx.save();
          ctx.translate(rectX + inset, rectY + rectH - inset);
          ctx.rotate(attempt.rotate);
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          withStrokeText(ctx, lines[0], 0, 0, { lineWidth: lw });
          withStrokeText(ctx, lines[1], 0, font + lineGap, { lineWidth: lw });
          ctx.restore();
        }
        return true;
      }
    }
    return false;
  };

  const ok = attempts.some(tryDraw);

  // If still too small: draw only index badge (always inside).
  if (!ok && p.labelIndex != null) {
    const badge = String(p.labelIndex);
    const font = Math.max(12, 26 / scale);
    ctx.font = `900 ${font}px Tahoma, Arial, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    const bx = rectX + rectW - inset;
    const by = rectY + inset;
    const tw = ctx.measureText(badge).width;
    const bw = tw + 16 / scale;
    const bh = font + 12 / scale;
    ctx.fillStyle = "rgba(15,23,42,0.55)";
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = Math.max(2, 3 / scale);
    roundRect(ctx, bx - bw, by - 2 / scale, bw, bh, 10 / scale);
    ctx.fill();
    ctx.stroke();
    withStrokeText(ctx, badge, bx - 8 / scale, by + 4 / scale, { lineWidth: Math.max(2, 3 / scale) });
  }

  ctx.restore();
}

function drawSheet(canvas, { sheetW, sheetH, kerf, margin, placements }, { maxCanvasW = 900 } = {}) {
  const pad = 14;
  const scale = Math.min((maxCanvasW - pad * 2) / sheetW, 1);
  const w = Math.max(320, Math.round(sheetW * scale) + pad * 2);
  const h = Math.max(240, Math.round(sheetH * scale) + pad * 2);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(pad, pad);
  ctx.scale(scale, scale);

  // board
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  // Strong board frame: make it clearly visible in print/PDF.
  ctx.strokeStyle = "rgba(255,255,255,0.52)";
  ctx.lineWidth = 3 / scale;
  ctx.fillRect(0, 0, sheetW, sheetH);
  ctx.strokeRect(0, 0, sheetW, sheetH);

  // margin guide
  if (margin > 0) {
    ctx.strokeStyle = "rgba(246, 198, 107, 0.25)";
    ctx.setLineDash([10 / scale, 10 / scale]);
    ctx.strokeRect(margin, margin, sheetW - margin * 2, sheetH - margin * 2);
    ctx.setLineDash([]);
  }

  // pieces
  const ordered = sortPlacementsReadingOrder(placements).map((p, idx) => ({ ...p, labelIndex: idx + 1 }));
  ordered.forEach((p) => {
    ctx.fillStyle = colorForName(p.name);
    ctx.strokeStyle = "rgba(255,255,255,0.34)";
    ctx.lineWidth = 1.5 / scale;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeRect(p.x, p.y, p.w, p.h);

    drawFittedLabel(ctx, p, { scale, pad: 12 });
  });

  // kerf note
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `${Math.max(10, 16 / scale)}px Tahoma, Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(`Kerf: ${kerf}mm`, 8, sheetH - 8);

  ctx.restore();
}

function renderResult({ sheetW, sheetH, kerf, margin }, packed) {
  sheetsEl.innerHTML = "";

  if (!packed.ok) {
    summaryText.textContent = packed.error?.startsWith("piece_too_large:")
      ? `قطعة أكبر من مساحة اللوح: ${packed.error.split(":", 2)[1]}`
      : "تعذر التصفيط. راجع المقاسات أو زِد عدد الألواح.";
    return;
  }

  const totalPieces = packed.sheets.reduce((sum, s) => sum + s.placed.length, 0);
  summaryText.textContent = `عدد الألواح: ${packed.sheets.length} — مجموع القطع: ${totalPieces}`;

  packed.sheets.forEach((sheet, i) => {
    const wrapper = document.createElement("article");
    wrapper.className = "mdf-sheet";

    const head = document.createElement("div");
    head.className = "mdf-sheet-head";
    head.innerHTML = `
      <strong>لوح رقم ${i + 1}</strong>
      <span class="mdf-sheet-meta">قطع داخل اللوح: ${sheet.placed.length}</span>
    `;

    const canvasWrap = document.createElement("div");
    canvasWrap.className = "mdf-canvas-wrap";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `رسم اللوح ${i + 1}`);
    canvasWrap.appendChild(canvas);

    wrapper.appendChild(head);
    wrapper.appendChild(canvasWrap);
    sheetsEl.appendChild(wrapper);

    drawSheet(canvas, {
      sheetW,
      sheetH,
      kerf,
      margin,
      placements: sheet.placed
    });
  });
}

function toCsv({ sheetW, sheetH, kerf, margin }, packed) {
  if (!packed?.ok) return "";
  const rows = [
    ["sheet_index", "piece_name", "x_mm", "y_mm", "w_mm", "h_mm", "rotated", "sheetW", "sheetH", "kerf", "margin"].join(",")
  ];
  packed.sheets.forEach((sheet, si) => {
    sheet.placed.forEach((p) => {
      rows.push([
        si + 1,
        csvCell(p.name),
        Math.round(p.x),
        Math.round(p.y),
        Math.round(p.w),
        Math.round(p.h),
        p.rotated ? "1" : "0",
        sheetW,
        sheetH,
        kerf,
        margin
      ].join(","));
    });
  });
  return rows.join("\n");
}

function csvCell(value) {
  const s = String(value ?? "");
  if (/[,"\n]/.test(s)) return `"${s.replaceAll("\"", "\"\"")}"`;
  return s;
}

function downloadText(name, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function printPacked({ sheetW, sheetH, kerf, margin }, packed) {
  if (!packed?.ok) return;
  const win = window.open("", "_blank");
  if (!win) return;

  const images = [...sheetsEl.querySelectorAll("canvas")].map((c) => c.toDataURL("image/png", 1.0));
  const totalPieces = packed.sheets.reduce((sum, s) => sum + s.placed.length, 0);

  win.document.open();
  win.document.write(`<!doctype html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>طباعة تقطيع MDF</title>
    <style>
      body{font-family:Tahoma,Arial,sans-serif;margin:18px;color:#111}
      h1{margin:0 0 6px}
      .meta{margin:0 0 14px;color:#444}
      .sheet{break-inside:avoid;margin:0 0 16px;padding:12px;border:1px solid #ddd;border-radius:12px}
      .sheet h2{margin:0 0 8px;font-size:16px}
      img{width:100%;height:auto;border:1px solid #eee;border-radius:10px}
      @media print{body{margin:0}.sheet{border:0;border-bottom:1px solid #ccc;border-radius:0;padding:10px}}
    </style>
  </head>
  <body>
    <h1>تقطيع ألواح MDF</h1>
    <p class="meta">لوح: ${sheetW}×${sheetH}mm — Kerf: ${kerf}mm — Margin: ${margin}mm — عدد الألواح: ${packed.sheets.length} — مجموع القطع: ${totalPieces}</p>
    ${images.map((src, idx) => `
      <section class="sheet">
        <h2>لوح رقم ${idx + 1} (قطع: ${packed.sheets[idx].placed.length})</h2>
        <img src="${src}" alt="Sheet ${idx + 1}">
      </section>`).join("")}
    <script>window.onload=()=>setTimeout(()=>window.print(),250)</script>
  </body>
  </html>`);
  win.document.close();
}

async function savePackedPdf({ sheetW, sheetH, kerf, margin }, packed) {
  if (!packed?.ok) return;
  const jsPDF = globalThis.jspdf?.jsPDF;
  if (!jsPDF) {
    alert("تعذر تحميل مكتبة PDF. تأكد من الإنترنت ثم أعد المحاولة.");
    return;
  }

  const canvases = [...sheetsEl.querySelectorAll("canvas")];
  const usable = packed.sheets
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => (s.placed?.length || 0) > 0);
  if (!usable.length || !canvases.length) {
    alert("لا توجد ألواح محفوظة بعد. اضغط «تصفيط القطع» أولًا.");
    return;
  }

  const totalPieces = packed.sheets.reduce((sum, s) => sum + (s.placed?.length || 0), 0);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const reportMeta = {
    sheetW,
    sheetH,
    kerf,
    margin,
    usedSheets: usable.length,
    totalPieces,
    createdAt: new Date()
  };

  // Build each page as a single high-res image so Arabic text is always clear.
  usable.forEach(({ s, i }, idx) => {
    if (idx > 0) doc.addPage();
    // Re-render a high-res sheet canvas for PDF to keep the main MDF board frame sharp on A4.
    const sheetCanvas = document.createElement("canvas");
    drawSheet(
      sheetCanvas,
      {
        sheetW: reportMeta.sheetW,
        sheetH: reportMeta.sheetH,
        kerf: reportMeta.kerf,
        margin: reportMeta.margin,
        placements: s.placed || []
      },
      { maxCanvasW: 2200 }
    );
    const pageCanvas = buildPdfPageCanvas({
      reportMeta,
      sheetIndex: i + 1,
      placements: s.placed || [],
      sheetCanvas
    });
    const img = pageCanvas.toDataURL("image/jpeg", 0.92);
    doc.addImage(img, "JPEG", 0, 0, pageW, pageH, undefined, "FAST");
  });

  doc.save(`mdf-sheets-${Date.now()}.pdf`);
}

function groupPlacements(placements) {
  const map = new Map();
  placements.forEach((p) => {
    const key = `${p.name}__${p.w}x${p.h}__${p.rotated ? 1 : 0}`;
    const prev = map.get(key) || { name: p.name, w: p.w, h: p.h, rotated: p.rotated, qty: 0 };
    prev.qty += 1;
    map.set(key, prev);
  });
  return [...map.values()].sort((a, b) => {
    const an = String(a.name || "");
    const bn = String(b.name || "");
    if (an !== bn) return an.localeCompare(bn, "ar");
    const aa = a.w * a.h;
    const ba = b.w * b.h;
    return ba - aa;
  });
}

function fmtDate(d) {
  try {
    return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

function buildPdfPageCanvas({ reportMeta, sheetIndex, placements, sheetCanvas }) {
  // A4 landscape @ ~150dpi
  const W = 1754;
  const H = 1240;
  const pad = 36;
  const headerH = 140;
  const sidebarW = 520;
  const contentTop = pad + headerH;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header bar
  const brand = "#d6a354";
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, W, headerH + pad);
  ctx.fillStyle = "rgba(214,163,84,0.18)";
  ctx.fillRect(0, headerH + pad - 10, W, 10);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.font = "bold 38px Tahoma, Arial, sans-serif";
  ctx.fillText("تقرير تقطيع ألواح MDF", W - pad, pad);

  ctx.font = "bold 28px Tahoma, Arial, sans-serif";
  ctx.fillStyle = brand;
  ctx.fillText(`لوح رقم ${sheetIndex}`, W - pad, pad + 54);

  ctx.font = "bold 20px Tahoma, Arial, sans-serif";
  ctx.fillStyle = "#e2e8f0";
  const metaLine = `مقاس اللوح: ${reportMeta.sheetW}×${reportMeta.sheetH}mm   |   Kerf: ${reportMeta.kerf}mm   |   Margin: ${reportMeta.margin}mm`;
  ctx.fillText(metaLine, W - pad, pad + 94);

  ctx.font = "16px Tahoma, Arial, sans-serif";
  ctx.fillStyle = "rgba(226,232,240,0.92)";
  ctx.fillText(`تاريخ الإنشاء: ${fmtDate(reportMeta.createdAt)}`, W - pad, pad + 118);

  // Layout boxes
  const sidebarX = W - pad - sidebarW;
  const sidebarY = contentTop;
  const sidebarH = H - contentTop - pad;

  const drawingX = pad;
  const drawingY = contentTop;
  const drawingW = sidebarX - pad - 18;
  const drawingH = H - contentTop - pad;

  // Drawing panel
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(15,23,42,0.16)";
  ctx.lineWidth = 2;
  roundRect(ctx, drawingX, drawingY, drawingW, drawingH, 18);
  ctx.fill();
  ctx.stroke();

  // Place drawing image scaled
  const dwPad = 18;
  const targetW = drawingW - dwPad * 2;
  const targetH = drawingH - dwPad * 2;
  const scale = Math.min(targetW / sheetCanvas.width, targetH / sheetCanvas.height);
  const imgW = Math.round(sheetCanvas.width * scale);
  const imgH = Math.round(sheetCanvas.height * scale);
  const imgX = drawingX + dwPad + Math.round((targetW - imgW) / 2);
  const imgY = drawingY + dwPad + Math.round((targetH - imgH) / 2);
  ctx.drawImage(sheetCanvas, imgX, imgY, imgW, imgH);

  // A4-friendly: add a clear outer frame + dimensions for the main MDF board.
  ctx.strokeStyle = "rgba(15,23,42,0.55)";
  ctx.lineWidth = 4;
  ctx.strokeRect(imgX + 2, imgY + 2, imgW - 4, imgH - 4);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 18px Tahoma, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`لوح MDF: ${reportMeta.sheetW}×${reportMeta.sheetH} mm`, drawingX + 18, drawingY + 14);

  // Dimension labels (top and left) to help the technician.
  ctx.fillStyle = "#334155";
  ctx.font = "bold 16px Tahoma, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${reportMeta.sheetW} mm`, imgX + imgW / 2, imgY - 22);
  ctx.save();
  ctx.translate(imgX - 20, imgY + imgH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${reportMeta.sheetH} mm`, 0, 0);
  ctx.restore();

  // Sidebar panel
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(15,23,42,0.16)";
  ctx.lineWidth = 2;
  roundRect(ctx, sidebarX, sidebarY, sidebarW, sidebarH, 18);
  ctx.fill();
  ctx.stroke();

  // Sidebar title
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 24px Tahoma, Arial, sans-serif";
  ctx.fillText("قائمة القطع داخل هذا اللوح", sidebarX + sidebarW - 18, sidebarY + 18);

  // Stats
  const usedArea = placements.reduce((sum, p) => sum + (p.w * p.h), 0);
  const sheetArea = reportMeta.sheetW * reportMeta.sheetH;
  const usage = sheetArea ? Math.round((usedArea / sheetArea) * 100) : 0;

  ctx.font = "bold 18px Tahoma, Arial, sans-serif";
  ctx.fillStyle = "#334155";
  ctx.fillText(`عدد القطع: ${placements.length}   |   نسبة الاستغلال: ${usage}%`, sidebarX + sidebarW - 18, sidebarY + 52);

  // Table header
  const tableX = sidebarX + 18;
  let y = sidebarY + 86;
  const rowH = 32;

  ctx.fillStyle = "rgba(15,23,42,0.06)";
  roundRect(ctx, tableX, y, sidebarW - 36, rowH + 10, 12);
  ctx.fill();

  ctx.fillStyle = "#475569";
  ctx.font = "bold 17px Tahoma, Arial, sans-serif";
  ctx.fillText("القطعة", sidebarX + sidebarW - 28, y + 8);
  ctx.textAlign = "center";
  ctx.fillText("المقاس", sidebarX + 220, y + 8);
  ctx.fillText("العدد", sidebarX + 88, y + 8);

  // Table rows
  const rows = groupPlacements(placements);
  ctx.textAlign = "right";
  ctx.font = "17px Tahoma, Arial, sans-serif";
  y += rowH + 18;

  const maxRows = Math.floor((sidebarY + sidebarH - y - 70) / rowH);
  const clipped = rows.slice(0, Math.max(0, maxRows));

  clipped.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? "rgba(15,23,42,0.03)" : "rgba(255,255,255,0)";
    if (bg.includes("0.03")) {
      ctx.fillStyle = bg;
      ctx.fillRect(tableX, y + 2, sidebarW - 36, rowH);
    }
    ctx.fillStyle = "#0f172a";
    ctx.textAlign = "right";
    ctx.fillText(trimText(ctx, r.name, 220), sidebarX + sidebarW - 28, y + 8);
    ctx.textAlign = "center";
    ctx.fillStyle = "#334155";
    ctx.fillText(`${r.w}×${r.h}${r.rotated ? " (R)" : ""}`, sidebarX + 220, y + 8);
    ctx.fillStyle = "#0f172a";
    ctx.fillText(String(r.qty), sidebarX + 88, y + 8);
    y += rowH;
  });

  if (rows.length > clipped.length) {
    ctx.textAlign = "right";
    ctx.fillStyle = "#64748b";
    ctx.font = "14px Tahoma, Arial, sans-serif";
    ctx.fillText(`... عناصر إضافية: ${rows.length - clipped.length}`, sidebarX + sidebarW - 28, y + 10);
  }

  // Footer tips
  ctx.textAlign = "right";
  ctx.font = "bold 14px Tahoma, Arial, sans-serif";
  ctx.fillStyle = "#0f172a";
  ctx.fillText("ملاحظات للفني:", sidebarX + sidebarW - 18, sidebarY + sidebarH - 58);

  ctx.font = "13px Tahoma, Arial, sans-serif";
  ctx.fillStyle = "#334155";
  ctx.fillText("• اترك مسافة Kerf بين القطع حسب المنشار/الـ CNC.", sidebarX + sidebarW - 18, sidebarY + sidebarH - 36);
  ctx.fillText("• راعي اتجاه القشرة/الألياف قبل القص إن لزم.", sidebarX + sidebarW - 18, sidebarY + sidebarH - 16);

  return canvas;
}

function trimText(ctx, text, maxWidth) {
  const s = String(text || "");
  if (ctx.measureText(s).width <= maxWidth) return s;
  let out = s;
  while (out.length > 3 && ctx.measureText(out + "…").width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + "…";
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

let lastPacked = null;

function runPack() {
  const state = readFormState();
  saveState(state);
  const packed = shelfPack({
    sheetW: state.sheetW,
    sheetH: state.sheetH,
    kerf: state.kerf,
    margin: state.margin,
    pieces: state.pieces
  });
  lastPacked = { state, packed };
  renderResult(
    { sheetW: state.sheetW, sheetH: state.sheetH, kerf: state.kerf, margin: state.margin },
    packed
  );
}

addRowBtn.addEventListener("click", () => {
  const row = renderPieceRow({ id: uid(), name: `قطعة ${piecesBody.children.length + 1}`, w: 600, h: 720, qty: 1, rotate: true });
  piecesBody.appendChild(row);
  persistFromUi();
});

clearRowsBtn.addEventListener("click", () => {
  piecesBody.innerHTML = "";
  persistFromUi();
  sheetsEl.innerHTML = "";
  summaryText.textContent = "لم يتم التصفيط بعد.";
});

packBtn.addEventListener("click", runPack);
exportCsvBtn.addEventListener("click", () => {
  if (!lastPacked?.packed?.ok) runPack();
  const packed = lastPacked?.packed;
  const state = lastPacked?.state;
  if (!packed?.ok || !state) return;
  const csv = toCsv({ sheetW: state.sheetW, sheetH: state.sheetH, kerf: state.kerf, margin: state.margin }, packed);
  downloadText(`mdf-cut-${Date.now()}.csv`, csv, "text/csv");
});
savePdfBtn?.addEventListener("click", async () => {
  if (!lastPacked?.packed?.ok) runPack();
  const packed = lastPacked?.packed;
  const state = lastPacked?.state;
  if (!packed?.ok || !state) return;
  await savePackedPdf({ sheetW: state.sheetW, sheetH: state.sheetH, kerf: state.kerf, margin: state.margin }, packed);
});
printBtn.addEventListener("click", () => {
  if (!lastPacked?.packed?.ok) runPack();
  const packed = lastPacked?.packed;
  const state = lastPacked?.state;
  if (!packed?.ok || !state) return;
  printPacked({ sheetW: state.sheetW, sheetH: state.sheetH, kerf: state.kerf, margin: state.margin }, packed);
});

[sheetWInput, sheetHInput, kerfInput, marginInput].forEach((el) => {
  el.addEventListener("input", persistFromUi);
  el.addEventListener("change", persistFromUi);
});

// Boot
const initial = readState();
setFormFromState(initial);
persistFromUi();
