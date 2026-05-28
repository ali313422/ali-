const STORAGE_KEY = "kitchenAiSource";
const STORAGE_AT = "kitchenAiSourceAt";

const aiSourceImage = document.getElementById("aiSourceImage");
const aiSourcePlaceholder = document.getElementById("aiSourcePlaceholder");
const aiImageUpload = document.getElementById("aiImageUpload");
const aiDownloadSource = document.getElementById("aiDownloadSource");

const mnmlConfigNote = document.getElementById("mnmlConfigNote");
const mnmlPrompt = document.getElementById("mnmlPrompt");
const mnmlMode = document.getElementById("mnmlMode");
const mnmlRun = document.getElementById("mnmlRun");
const mnmlStatus = document.getElementById("mnmlStatus");
const mnmlResultWrap = document.getElementById("mnmlResultWrap");
const mnmlResultImage = document.getElementById("mnmlResultImage");
const mnmlDownload = document.getElementById("mnmlDownload");
const renderQuotaNote = document.getElementById("renderQuotaNote");

const lookxFrame = document.getElementById("lookxFrame");
const verasFrame = document.getElementById("verasFrame");

let currentDataUrl = "";
let aiConfig = null;

function setSourceImage(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith("data:image/")) return;
  currentDataUrl = dataUrl;
  aiSourceImage.src = dataUrl;
  aiSourceImage.hidden = false;
  aiSourcePlaceholder.hidden = true;
  aiDownloadSource.disabled = false;
}

function loadStoredSource() {
  const saved = sessionStorage.getItem(STORAGE_KEY);
  const savedAt = Number(sessionStorage.getItem(STORAGE_AT) || "0");
  const maxAgeMs = 1000 * 60 * 60 * 6;
  if (saved && saved.startsWith("data:image/") && Date.now() - savedAt < maxAgeMs) {
    setSourceImage(saved);
    return;
  }
  aiDownloadSource.disabled = true;
}

async function loadAiConfig() {
  try {
    const response = await fetch("/api/ai/config", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    aiConfig = await response.json();
  } catch {
    aiConfig = null;
  }

  const mnmlReady = Boolean(aiConfig?.mnml?.configured);
  mnmlConfigNote.textContent = mnmlReady
    ? "mnml.ai متصل من السيرفر — يمكنك التشغيل مباشرة."
    : "لتشغيل mnml داخل الموقع: أنشئ حسابًا في mnml.ai ثم ضع المفتاح في متغير البيئة MNML_API_KEY وأعد تشغيل السيرفر.";
  mnmlConfigNote.style.color = mnmlReady ? "#86efac" : "#fbbf24";
  mnmlRun.disabled = !mnmlReady;

  const quota = aiConfig?.renderQuota;
  if (renderQuotaNote) {
    if (!quota) {
      renderQuotaNote.textContent = "";
    } else if (quota.unlimited) {
      renderQuotaNote.textContent = "رندر الاشتراك: غير محدود";
    } else {
      renderQuotaNote.textContent = `رندر الاشتراك: ${quota.used}/${quota.limit} — متبقي ${quota.remaining}`;
      if ((quota.remaining ?? 0) <= 0) {
        renderQuotaNote.style.color = "#fca5a5";
        mnmlRun.disabled = true;
      }
    }
  }
}

function switchTab(tabId) {
  document.querySelectorAll(".ai-tab").forEach((btn) => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".ai-panel").forEach((panel) => {
    const show = panel.id === `panel-${tabId}`;
    panel.classList.toggle("active", show);
    panel.hidden = !show;
  });

  if (tabId === "lookx" && lookxFrame.src === "about:blank" && aiConfig?.lookx?.webUrl) {
    lookxFrame.src = aiConfig.lookx.webUrl;
  }
  if (tabId === "veras" && verasFrame.src === "about:blank" && aiConfig?.veras?.webUrl) {
    verasFrame.src = aiConfig.veras.webUrl;
  }
}

async function runMnml() {
  if (!currentDataUrl) {
    mnmlStatus.textContent = "ارفع صورة أو ارجع للمصمم واضغط «رندر AI».";
    return;
  }

  mnmlRun.disabled = true;
  mnmlStatus.textContent = "جاري الإرسال إلى mnml.ai — قد يستغرق 1–3 دقائق...";
  mnmlResultWrap.hidden = true;

  try {
    const response = await fetch("/api/ai/mnml", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        imageDataUrl: currentDataUrl,
        prompt: mnmlPrompt.value.trim(),
        mode: mnmlMode.value
      })
    });
    const data = await response.json();
    if (!data.ok || !data.imageUrl) {
      const err = data.message || data.error || "فشل الطلب";
      mnmlStatus.textContent =
        data.error === "render_limit" ? err : `تعذر mnml.ai: ${err}`;
      if (data.error === "render_limit" && renderQuotaNote) {
        renderQuotaNote.textContent = err;
        renderQuotaNote.style.color = "#fca5a5";
      }
      return;
    }

    if (data.renderQuota && renderQuotaNote) {
      const q = data.renderQuota;
      if (q.unlimited) {
        renderQuotaNote.textContent = "رندر الاشتراك: غير محدود";
      } else {
        renderQuotaNote.textContent = `رندر الاشتراك: ${q.used}/${q.limit} — متبقي ${q.remaining}`;
        renderQuotaNote.style.color = (q.remaining ?? 0) <= 0 ? "#fca5a5" : "";
        if ((q.remaining ?? 0) <= 0) mnmlRun.disabled = true;
      }
    }

    mnmlResultImage.src = data.imageUrl;
    mnmlDownload.href = data.imageUrl;
    mnmlResultWrap.hidden = false;
    mnmlStatus.textContent = "تم — هذه نتيجة mnml.ai (فوتو واقعي).";
  } catch (error) {
    console.error(error);
    mnmlStatus.textContent = "خطأ في الاتصال بالسيرفر.";
  } finally {
    mnmlRun.disabled = !aiConfig?.mnml?.configured;
  }
}

function copySteps(text) {
  navigator.clipboard?.writeText(text).then(
    () => {
      mnmlStatus.textContent = "تم نسخ الخطوات.";
    },
    () => {
      mnmlStatus.textContent = "انسخ الخطوات يدويًا من القائمة.";
    }
  );
}

const lookxSteps = `LookX — خطوات رندر المطبخ:
1) نزّل صورة التصميم من صفحة الرندر AI
2) افتح https://www.lookx.ai/
3) Start Creations → Render Mode → Interior
4) ارفع الصورة واكتب وصف المطبخ
5) Generate ثم Download`;

const verasSteps = `Veras — خطوات رندر المطبخ:
1) نزّل صورة التصميم
2) افتح https://veras.evolvelab.io/
3) Upload image
4) اختر Photorealistic وقلل Creativity للحفاظ على التصميم
5) Export النتيجة`;

document.querySelectorAll(".ai-tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

aiImageUpload?.addEventListener("change", () => {
  const file = aiImageUpload.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      setSourceImage(reader.result);
      sessionStorage.setItem(STORAGE_KEY, reader.result);
      sessionStorage.setItem(STORAGE_AT, String(Date.now()));
    }
  };
  reader.readAsDataURL(file);
});

aiDownloadSource?.addEventListener("click", () => {
  if (!currentDataUrl) return;
  const link = document.createElement("a");
  link.href = currentDataUrl;
  link.download = `kitchen-source-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
});

mnmlRun?.addEventListener("click", runMnml);
document.getElementById("lookxCopySteps")?.addEventListener("click", () => copySteps(lookxSteps));
document.getElementById("verasCopySteps")?.addEventListener("click", () => copySteps(verasSteps));

loadStoredSource();
loadAiConfig();
switchTab("mnml");
