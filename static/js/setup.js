const STORAGE_KEY = "kitchenRoomConfig";

const defaults = {
  width: 5,
  depth: 4,
  height: 2.8,
  walls: 4,
  wallColor: "#f1eadc",
  floorColor: "#7c5a3a",
  ceilingColor: "#f8fafc",
  hasCeiling: true,
  showGrid: true
};

const form = document.getElementById("roomForm");
const resetButton = document.getElementById("resetDefaults");
const preset = document.getElementById("roomPreset");

function readSavedConfig() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { ...defaults };
  }
}

function setFormValues(config) {
  document.getElementById("roomWidth").value = config.width;
  document.getElementById("roomDepth").value = config.depth;
  document.getElementById("roomHeight").value = config.height;
  document.getElementById("wallCount").value = config.walls;
  document.getElementById("wallColor").value = config.wallColor;
  document.getElementById("floorColor").value = config.floorColor;
  document.getElementById("ceilingColor").value = config.ceilingColor;
  document.getElementById("hasCeiling").checked = config.hasCeiling;
  document.getElementById("showGrid").checked = config.showGrid;
}

function collectConfig() {
  return {
    width: Number(document.getElementById("roomWidth").value) || defaults.width,
    depth: Number(document.getElementById("roomDepth").value) || defaults.depth,
    height: Number(document.getElementById("roomHeight").value) || defaults.height,
    walls: Number(document.getElementById("wallCount").value) || defaults.walls,
    wallColor: document.getElementById("wallColor").value || defaults.wallColor,
    floorColor: document.getElementById("floorColor").value || defaults.floorColor,
    ceilingColor: document.getElementById("ceilingColor").value || defaults.ceilingColor,
    hasCeiling: document.getElementById("hasCeiling").checked,
    showGrid: document.getElementById("showGrid").checked
  };
}

preset?.addEventListener("change", () => {
  if (preset.value === "open-front") {
    document.getElementById("wallCount").value = 3;
  } else if (preset.value === "corner") {
    document.getElementById("wallCount").value = 2;
  } else {
    document.getElementById("wallCount").value = 4;
  }
});

resetButton?.addEventListener("click", () => {
  setFormValues(defaults);
  preset.value = "empty";
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collectConfig()));
  window.location.href = "/designer";
});

setFormValues(readSavedConfig());
