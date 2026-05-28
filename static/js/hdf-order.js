const STORAGE_KEY = "kitchenHdfOrder_v1";

const customerNameInput = document.getElementById("customerName");
const orderNotesInput = document.getElementById("orderNotes");
const doorsBody = document.getElementById("doorsBody");
const addDoorRowBtn = document.getElementById("addDoorRowBtn");
const clearDoorRowsBtn = document.getElementById("clearDoorRowsBtn");
const doorsCountPill = document.getElementById("doorsCountPill");
const doorsAreaPill = document.getElementById("doorsAreaPill");
const hdfTitle = document.getElementById("hdfTitle");
const hdfSummary = document.getElementById("hdfSummary");
const hdfPreview = document.getElementById("hdfPreview");
const saveHdfPdfBtn = document.getElementById("saveHdfPdfBtn");

function uid() {
  return `d_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

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

function defaultState() {
  return {
    customerName: "",
    notes: "",
    doors: [
      { id: uid(), name: "باب 1", w: 450, h: 720, qty: 2, engraved: false, note: "" }
    ]
  };
}

function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw) return defaultState();
    return {
      ...defaultState(),
      ...raw,
      doors: Array.isArray(raw.doors) && raw.doors.length ? raw.doors : defaultState().doors
    };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeDoor(d) {
  return {
    id: String(d.id || uid()),
    name: String(d.name || "باب").trim() || "باب",
    w: Math.round(clampNumber(d.w, 450, 1)),
    h: Math.round(clampNumber(d.h, 720, 1)),
    qty: Math.round(clampNumber(d.qty, 1, 1, 999)),
    engraved: Boolean(d.engraved),
    note: String(d.note || "")
  };
}

function renderDoorRow(door) {
  const d = normalizeDoor(door);
  const row = document.createElement("div");
  row.className = "mdf-row";
  row.dataset.doorId = d.id;

  row.innerHTML = `
    <input data-field="name" type="text" value="${escapeHtml(d.name)}" placeholder="مثال: باب علوي">
    <input data-field="w" type="number" min="1" step="1" value="${d.w}" inputmode="numeric">
    <input data-field="h" type="number" min="1" step="1" value="${d.h}" inputmode="numeric">
    <input data-field="qty" type="number" min="1" step="1" value="${d.qty}" inputmode="numeric">
    <label class="switch-card switch-card--compact" style="justify-content:space-between">
      <input data-field="engraved" type="checkbox" ${d.engraved ? "checked" : ""}>
      <span>${d.engraved ? "نقش" : "بدون"}</span>
    </label>
    <button type="button" class="icon-btn" data-action="delete" aria-label="حذف">×</button>
  `;

  const engravedInput = row.querySelector("[data-field='engraved']");
  const engravedLabel = row.querySelector(".switch-card span");
  engravedInput.addEventListener("change", () => {
    engravedLabel.textContent = engravedInput.checked ? "نقش" : "بدون";
    persistFromUi();
    updateTotals();
  });

  row.querySelector("[data-action='delete']").addEventListener("click", () => {
    row.remove();
    persistFromUi();
    updateTotals();
  });

  row.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      persistFromUi();
      updateTotals();
    });
    input.addEventListener("change", () => {
      persistFromUi();
      updateTotals();
    });
  });

  return row;
}

function renderDoorsTable(doors) {
  doorsBody.innerHTML = "";
  doors.forEach((d) => doorsBody.appendChild(renderDoorRow(d)));
}

function readFormState() {
  const doors = [...doorsBody.querySelectorAll("[data-door-id]")].map((row) => {
    const id = row.dataset.doorId;
    const name = row.querySelector("[data-field='name']").value;
    const w = row.querySelector("[data-field='w']").value;
    const h = row.querySelector("[data-field='h']").value;
    const qty = row.querySelector("[data-field='qty']").value;
    const engraved = row.querySelector("[data-field='engraved']").checked;
    return normalizeDoor({ id, name, w, h, qty, engraved, note: "" });
  });
  return {
    customerName: String(customerNameInput.value || "").trim(),
    notes: String(orderNotesInput.value || "").trim(),
    doors
  };
}

function setFormFromState(state) {
  customerNameInput.value = state.customerName || "";
  orderNotesInput.value = state.notes || "";
  renderDoorsTable(state.doors || []);
  updateTotals();
}

function persistFromUi() {
  const state = readFormState();
  saveState(state);
  const name = state.customerName ? `أوردر HDF — ${state.customerName}` : "أوردر أبواب HDF";
  hdfTitle.textContent = name;
}

function totalAreaM2(doors) {
  let area = 0;
  doors.forEach((d) => {
    const w = clampNumber(d.w, 0, 0);
    const h = clampNumber(d.h, 0, 0);
    const qty = clampNumber(d.qty, 0, 0);
    area += (w * h * qty) / 1_000_000;
  });
  return area;
}

function totalQty(doors) {
  return doors.reduce((sum, d) => sum + clampNumber(d.qty, 0, 0), 0);
}

function updateTotals() {
  const state = readFormState();
  const qty = totalQty(state.doors);
  const area = totalAreaM2(state.doors);
  doorsCountPill.textContent = `عدد الأبواب: ${qty}`;
  doorsAreaPill.textContent = `المساحة: ${area.toFixed(2)} م²`;
  hdfSummary.textContent = state.customerName
    ? `الزبون: ${state.customerName} — عدد الأبواب: ${qty} — المساحة: ${area.toFixed(2)} م²`
    : `عدد الأبواب: ${qty} — المساحة: ${area.toFixed(2)} م²`;
  hdfPreview.textContent = state.notes
    ? `ملاحظات: ${state.notes}`
    : "أضف ملاحظات عامة (اختياري).";
}

function fmtDate(d) {
  try {
    return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(d);
  } catch {
    return d.toLocaleString();
  }
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

function drawTablePageCanvas({ customerName, notes, doors, totals }) {
  // A4 portrait @ ~150dpi
  const W = 1240;
  const H = 1754;
  const pad = 54;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Page border (A4 framing)
  ctx.strokeStyle = "rgba(15,23,42,0.55)";
  ctx.lineWidth = 3;
  ctx.strokeRect(pad - 18, pad - 18, W - (pad - 18) * 2, H - (pad - 18) * 2);

  // Header
  ctx.fillStyle = "#0f172a";
  ctx.font = "900 40px Tahoma, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("أوردر أبواب HDF", W - pad, pad);

  ctx.fillStyle = "#d6a354";
  ctx.font = "900 28px Tahoma, Arial, sans-serif";
  ctx.fillText(customerName ? `الزبون: ${customerName}` : "الزبون: ________", W - pad, pad + 56);

  ctx.fillStyle = "#334155";
  ctx.font = "18px Tahoma, Arial, sans-serif";
  ctx.fillText(`تاريخ: ${fmtDate(new Date())}`, W - pad, pad + 92);

  // Totals pills
  const pillY = pad + 130;
  const pillH = 44;
  const pillGap = 10;
  const pill1W = 320;
  const pill2W = 340;

  const pill = (x, text, accent = false) => {
    ctx.fillStyle = accent ? "rgba(214,163,84,0.18)" : "rgba(15,23,42,0.06)";
    ctx.strokeStyle = accent ? "rgba(214,163,84,0.55)" : "rgba(15,23,42,0.18)";
    ctx.lineWidth = 2;
    roundRect(ctx, x, pillY, accent ? pill2W : pill1W, pillH, 22);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.font = "900 20px Tahoma, Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(text, x + (accent ? pill2W : pill1W) - 18, pillY + 12);
  };

  const rightStart = W - pad - pill1W;
  pill(rightStart, `عدد الأبواب: ${totals.qty}`);
  pill(rightStart - pill2W - pillGap, `المساحة الإجمالية: ${totals.area.toFixed(2)} م²`, true);

  // Notes box
  const notesY = pillY + pillH + 14;
  const notesH = 78;
  ctx.fillStyle = "rgba(15,23,42,0.04)";
  ctx.strokeStyle = "rgba(15,23,42,0.18)";
  ctx.lineWidth = 2;
  roundRect(ctx, pad, notesY, W - pad * 2, notesH, 16);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#334155";
  ctx.font = "18px Tahoma, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`ملاحظات عامة: ${notes || "—"}`, W - pad - 16, notesY + 16);

  // Table
  const tableY = notesY + notesH + 18;
  const tableX = pad;
  const tableW = W - pad * 2;
  const rowH = 52;

  const cols = [
    { key: "name", title: "اسم الباب", w: 360, align: "right" },
    { key: "w", title: "العرض (mm)", w: 160, align: "center" },
    { key: "h", title: "الطول (mm)", w: 160, align: "center" },
    { key: "qty", title: "العدد", w: 120, align: "center" },
    { key: "engraved", title: "نقش", w: 120, align: "center" },
    { key: "note", title: "ملاحظات", w: tableW - (360 + 160 + 160 + 120 + 120), align: "right" }
  ];

  // Outer table frame
  ctx.strokeStyle = "rgba(15,23,42,0.25)";
  ctx.lineWidth = 2;
  roundRect(ctx, tableX, tableY, tableW, rowH * (Math.max(1, doors.length) + 1) + 2, 14);
  ctx.stroke();

  // Header row background
  ctx.fillStyle = "rgba(15,23,42,0.08)";
  ctx.fillRect(tableX, tableY, tableW, rowH);

  // Grid lines + headers
  let x = tableX;
  ctx.fillStyle = "#0f172a";
  ctx.font = "900 18px Tahoma, Arial, sans-serif";
  cols.forEach((c) => {
    // vertical grid
    ctx.strokeStyle = "rgba(15,23,42,0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, tableY);
    ctx.lineTo(x, tableY + rowH * (Math.max(1, doors.length) + 1));
    ctx.stroke();

    // header text
    ctx.textAlign = c.align === "right" ? "right" : "center";
    const tx = c.align === "right" ? x + c.w - 14 : x + c.w / 2;
    ctx.fillText(c.title, tx, tableY + 16);
    x += c.w;
  });
  // right border line
  ctx.beginPath();
  ctx.moveTo(tableX + tableW, tableY);
  ctx.lineTo(tableX + tableW, tableY + rowH * (Math.max(1, doors.length) + 1));
  ctx.stroke();

  // horizontal lines
  const rowsCount = Math.max(1, doors.length);
  for (let i = 0; i <= rowsCount; i += 1) {
    const y = tableY + rowH * (i + 1);
    ctx.strokeStyle = "rgba(15,23,42,0.18)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tableX, y);
    ctx.lineTo(tableX + tableW, y);
    ctx.stroke();
  }

  // Data rows
  ctx.font = "18px Tahoma, Arial, sans-serif";
  for (let i = 0; i < rowsCount; i += 1) {
    const d = doors[i] || { name: "", w: "", h: "", qty: "", engraved: "", note: "" };
    const rowY = tableY + rowH * (i + 1);
    if (i % 2 === 0) {
      ctx.fillStyle = "rgba(0,0,0,0.015)";
      ctx.fillRect(tableX, rowY, tableW, rowH);
    }
    x = tableX;
    cols.forEach((c) => {
      ctx.fillStyle = "#0f172a";
      ctx.textAlign = c.align === "right" ? "right" : "center";
      const tx = c.align === "right" ? x + c.w - 14 : x + c.w / 2;
      const ty = rowY + 16;
      let val = d[c.key];
      if (c.key === "engraved") val = d.engraved ? "نقش" : "بدون";
      ctx.fillText(String(val ?? ""), tx, ty);
      x += c.w;
    });
  }

  // Footer
  ctx.fillStyle = "#334155";
  ctx.font = "16px Tahoma, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("ملاحظة: المساحة = (العرض×الطول×العدد) ÷ 1,000,000", W - pad, H - pad + 4);

  return canvas;
}

async function saveHdfPdfA4() {
  const jsPDF = globalThis.jspdf?.jsPDF;
  if (!jsPDF) {
    alert("تعذر تحميل مكتبة PDF. تأكد من الإنترنت ثم أعد المحاولة.");
    return;
  }
  const state = readFormState();
  const totals = { qty: totalQty(state.doors), area: totalAreaM2(state.doors) };

  // Prepare clean door list (no delete column)
  const doors = state.doors.map((d) => ({
    name: d.name,
    w: d.w,
    h: d.h,
    qty: d.qty,
    engraved: d.engraved,
    note: ""
  }));

  const pageCanvas = drawTablePageCanvas({
    customerName: state.customerName,
    notes: state.notes,
    doors,
    totals
  });

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const img = pageCanvas.toDataURL("image/jpeg", 0.92);
  doc.addImage(img, "JPEG", 0, 0, pageW, pageH, undefined, "FAST");
  const safeName = (state.customerName || "hdf-order").replace(/[\\/:*?"<>|]/g, "-").trim() || "hdf-order";
  doc.save(`hdf-order-${safeName}-${Date.now()}.pdf`);
}

addDoorRowBtn.addEventListener("click", () => {
  const row = renderDoorRow({ id: uid(), name: `باب ${doorsBody.children.length + 1}`, w: 450, h: 720, qty: 1, engraved: false });
  doorsBody.appendChild(row);
  persistFromUi();
  updateTotals();
});

saveHdfPdfBtn?.addEventListener("click", () => {
  saveHdfPdfA4().catch((e) => {
    console.error(e);
    alert("تعذر حفظ PDF. جرّب مرة أخرى.");
  });
});

clearDoorRowsBtn.addEventListener("click", () => {
  doorsBody.innerHTML = "";
  persistFromUi();
  updateTotals();
});

[customerNameInput, orderNotesInput].forEach((el) => {
  el.addEventListener("input", () => {
    persistFromUi();
    updateTotals();
  });
  el.addEventListener("change", () => {
    persistFromUi();
    updateTotals();
  });
});

// Boot
const initial = readState();
setFormFromState(initial);
persistFromUi();

