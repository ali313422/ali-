import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

RectAreaLightUniformsLib.init();

const STORAGE_KEY = "kitchenRoomConfig";
const viewport = document.getElementById("viewport");
const statusBox = document.getElementById("status");
const catalogTabs = document.getElementById("catalogTabs");
const catalogList = document.getElementById("catalogList");
const catalogQuick = document.getElementById("catalogQuick");
const materialsMenuBtn = document.getElementById("materialsMenuBtn");
const objectsMenuBtn = document.getElementById("objectsMenuBtn");
const materialsMenu = document.getElementById("materialsMenu");
const objectsMenu = document.getElementById("objectsMenu");
const drawer = document.getElementById("assetDrawer");
const resizePanel = document.getElementById("resizePanel");
const resizeWidthInput = document.getElementById("resizeWidth");
const resizeHeightInput = document.getElementById("resizeHeight");
const resizeDepthInput = document.getElementById("resizeDepth");
const itemHud = document.getElementById("itemHud");
const hudResize = document.getElementById("hudResize");
const hudCabinetMat = document.getElementById("hudCabinetMat");
const hudRotate45 = document.getElementById("hudRotate45");
const hudRotate90 = document.getElementById("hudRotate90");
const hudDelete = document.getElementById("hudDelete");
const moreMenuBtn = document.getElementById("moreMenuBtn");
const overflowMenu = document.getElementById("overflowMenu");
const menuMaterial = document.getElementById("menuMaterial");
const menuWalls = document.getElementById("menuWalls");
const menuOrder = document.getElementById("menuOrder");
const hdrSelect = document.getElementById("hdrSelect");
const hdrShowBg = document.getElementById("hdrShowBg");
const hdrEnvIntensity = document.getElementById("hdrEnvIntensity");
const hdrBgIntensity = document.getElementById("hdrBgIntensity");
const hdrPreviewLabel = document.getElementById("hdrPreviewLabel");
const materialPanel = document.getElementById("materialPanel");
const cabinetMaterialPanel = document.getElementById("cabinetMaterialPanel");
const cabinetMatClose = document.getElementById("cabinetMatClose");
const cabinetMatRegion = document.getElementById("cabinetMatRegion");
const cabinetUvScale = document.getElementById("cabinetUvScale");
const cabinetUvU = document.getElementById("cabinetUvU");
const cabinetUvV = document.getElementById("cabinetUvV");
const materialTargetSelect = document.getElementById("materialTarget");
const materialGlossInput = document.getElementById("materialGloss");
const materialEnvInput = document.getElementById("materialEnv");
const materialMetalInput = document.getElementById("materialMetal");
const mapPreviews = document.getElementById("mapPreviews");
const renderOverlay = document.getElementById("renderOverlay");
const renderProgress = document.getElementById("renderProgress");
const renderProgressLabel = document.getElementById("renderProgressLabel");
const renderCancelBtn = document.getElementById("renderCancel");
const renderQuotaNote = document.getElementById("renderQuotaNote");
const hudWorld = new THREE.Vector3();

let renderQuota = null;

async function fetchRenderQuota() {
  try {
    const response = await fetch("/api/render/quota", { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (data.ok) renderQuota = data.quota;
    return renderQuota;
  } catch {
    return null;
  }
}

function formatRenderQuota(quota) {
  if (!quota) return "";
  if (quota.unlimited) return "رندر: غير محدود";
  return `رندر: ${quota.used}/${quota.limit} (متبقي ${quota.remaining})`;
}

function updateRenderQuotaUI() {
  if (renderQuotaNote) renderQuotaNote.textContent = formatRenderQuota(renderQuota);
}

async function ensureCanRender() {
  await fetchRenderQuota();
  if (!renderQuota || renderQuota.unlimited) return true;
  if ((renderQuota.remaining ?? 0) <= 0) {
    setStatus(`انتهت مرات الرندر (${renderQuota.used}/${renderQuota.limit}) — تواصل مع الإدارة`);
    return false;
  }
  return true;
}

async function recordRenderUse() {
  try {
    const response = await fetch("/api/render/consume", {
      method: "POST",
      headers: { Accept: "application/json" }
    });
    const data = await response.json();
    if (data.ok) {
      renderQuota = data.quota;
      updateRenderQuotaUI();
      return true;
    }
    if (data.message) setStatus(data.message);
    return false;
  } catch {
    return false;
  }
}

const defaultRoom = {
  width: 5,
  depth: 4,
  height: 2.8,
  walls: 4,
  wallColor: "#f1eadc",
  floorColor: "#7c5a3a",
  ceilingColor: "#f8fafc",
  hasCeiling: true,
  showGrid: true,
  materialProps: {
    floor: { roughness: 0.62, metalness: 0.02, envMapIntensity: 0.55 },
    walls: { roughness: 0.78, metalness: 0.02, envMapIntensity: 0.45 },
    ceiling: { roughness: 0.7, metalness: 0.02, envMapIntensity: 0.35 },
    cabinet: { roughness: 0.48, metalness: 0.04, envMapIntensity: 0.42 },
    metal: { roughness: 0.32, metalness: 0.82, envMapIntensity: 0.75 }
  },
  hdrUrl: "",
  hdrIntensity: 1.2,
  hdrShowBackground: true,
  hdrBackgroundIntensity: 0.45,
  hdrBackgroundBlur: 0.1
};

const builtInMaterialCategories = [
  {
    id: "basic-floor",
    title: "خامات الأرضية",
    kind: "material",
    target: "floor",
    items: [
      { name: "خشب دافئ", type: "color", color: "#8a5a32" },
      { name: "رخام فاتح", type: "color", color: "#e9edf1" },
      { name: "اسمنت ناعم", type: "color", color: "#737373" },
      { name: "بلاط رملي", type: "color", color: "#c9b08d" }
    ]
  },
  {
    id: "basic-walls",
    title: "ألوان الجدران",
    kind: "material",
    target: "walls",
    items: [
      { name: "دهان كريمي", type: "color", color: "#f1eadc" },
      { name: "حجر رمادي", type: "color", color: "#aab2bd" },
      { name: "أبيض فاخر", type: "color", color: "#f8fafc" },
      { name: "غامق مطفي", type: "color", color: "#334155" }
    ]
  },
  {
    id: "basic-ceiling",
    title: "خامات السقف",
    kind: "material",
    target: "ceiling",
    items: [
      { name: "أبيض سقف", type: "color", color: "#f8fafc" },
      { name: "جبس دافئ", type: "color", color: "#eee3d1" },
      { name: "رمادي هادئ", type: "color", color: "#cbd5e1" }
    ]
  }
];

const builtInCabinetColors = [
  { name: "صاجي فاتح", type: "color", color: "#e8dcc8", target: "cabinet" },
  { name: "أبيض مطبخ", type: "color", color: "#f5f5f0", target: "cabinet" },
  { name: "رمادي عصري", type: "color", color: "#9ca3af", target: "cabinet" },
  { name: "خشبي فاتح", type: "color", color: "#c4a574", target: "cabinet" },
  { name: "أسود مطفي", type: "color", color: "#2b2b2b", target: "cabinet"   }
];

const builtInCabinetMaterials = [
  { name: "صاجي فاتح", type: "color", color: "#e8dcc8" },
  { name: "كريمي مطفي", type: "color", color: "#f1eadc" },
  { name: "أبيض مطفي", type: "color", color: "#f8f6f2" },
  { name: "رمادي فاتح", type: "color", color: "#d1d5db" },
  { name: "خشب فاتح", type: "color", color: "#c4a574" },
  { name: "أنثراسايت", type: "color", color: "#3f4654" }
];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b111c);
scene.fog = new THREE.Fog(0x0b111c, 13, 38);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
camera.position.set(5.4, 4.2, 6.4);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.25, 0);

const transform = new TransformControls(camera, renderer.domElement);
transform.setMode("translate");
scene.add(transform);
transform.addEventListener("dragging-changed", (event) => {
  controls.enabled = !event.value;
  if (!event.value && selected && snapEnabled) snapObject(selected);
});

const ambientLight = new THREE.HemisphereLight(0xffffff, 0x273449, 1.25);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
keyLight.position.set(4, 7, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 28;
scene.add(keyLight);

const roomGroup = new THREE.Group();
const itemGroup = new THREE.Group();
const photoLightGroup = new THREE.Group();
photoLightGroup.name = "PhotoRenderLights";
photoLightGroup.visible = false;
scene.add(roomGroup, itemGroup, photoLightGroup);

let photoLightsReady = false;
let photoRenderActive = false;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
const rgbeLoader = new RGBELoader();
let pmremGenerator = null;
let hdrEquirectTexture = null;
let hdrEnvMapTexture = null;
let hdrCatalog = [];
let hdrLoadToken = 0;
const selectableSurfaces = [];
const selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xf6c66b);
selectionBox.visible = false;
scene.add(selectionBox);

const EDGE_SNAP_DISTANCE = 0.16;
const OBJECT_SNAP_DISTANCE = 0.12;
const FACE_ALIGN_DISTANCE = 0.24;
const WALL_THICKNESS = 0.08;
const WALL_CLEARANCE = 0.006;

let room = readRoomConfig();
let selected = null;
let selectedSurface = null;
let snapEnabled = true;
let wallsVisible = true;
let activeCategoryId = "";
let catalogCategories = [];
let activeQuick = "mat-floor";
let activePrimaryMenu = "materials"; // materials | objects
let openingsByWall = { back: [], front: [], left: [], right: [] };
let wallMeshes = { back: null, front: null, left: null, right: null };
let lastTextureForPreview = null;
let pendingCabinetMaterial = null;
let activeBrushMaterial = null;
let pathTraceActive = false;
let pathTraceAbort = false;

// Smooth material application: cache decoded texture sources so applying the same
// material to multiple surfaces doesn't re-download / re-decode every time.
const textureSourceCache = new Map(); // url -> Promise<{source: HTMLCanvasElement, w:number, h:number}>
const texturePromiseCache = new Map(); // url -> Promise<THREE.Texture>

function setStatus(text) {
  statusBox.textContent = text;
}

function readRoomConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const materialProps = { ...defaultRoom.materialProps };
    Object.entries(saved.materialProps || {}).forEach(([key, value]) => {
      materialProps[key] = { ...defaultRoom.materialProps[key], ...value };
    });
    return { ...defaultRoom, ...saved, materialProps };
  } catch {
    return { ...defaultRoom };
  }
}

function surfaceProps(target) {
  const props = room.materialProps?.[target];
  return {
    roughness: THREE.MathUtils.clamp(Number(props?.roughness ?? 0.7), 0, 1),
    metalness: THREE.MathUtils.clamp(Number(props?.metalness ?? 0.02), 0, 1),
    envMapIntensity: THREE.MathUtils.clamp(Number(props?.envMapIntensity ?? 0.35), 0, 2)
  };
}

function colorMaterial(color, target = "walls", roughness = null) {
  const finish = surfaceProps(target);
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: roughness ?? finish.roughness,
    metalness: finish.metalness,
    envMapIntensity: finish.envMapIntensity
  });
}

function configureTextureRepeat(texture, surfaceType, mesh) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (surfaceType === "floor" || surfaceType === "ceiling") {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const span = surfaceType === "floor" ? Math.max(size.x, size.z, 1) : Math.max(size.x, size.z, 1);
    const repeat = THREE.MathUtils.clamp(span * 0.55, 1.2, 6);
    texture.repeat.set(repeat, repeat);
  } else if (surfaceType === "walls") {
    const wallId = mesh.userData.wallId || "back";
    const { width, height } = wallSize(wallId);
    texture.repeat.set(Math.max(width * 0.42, 1), Math.max(height * 0.42, 1));
  } else if (surfaceType === "model" && mesh?.isMesh) {
    mesh.geometry?.computeBoundingBox?.();
    const box = mesh.geometry?.boundingBox;
    if (box) {
      const size = box.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z, 0.15);
      const repeat = THREE.MathUtils.clamp(span * 2.4, 0.8, 5);
      texture.repeat.set(repeat, repeat);
    } else {
      texture.repeat.set(1.6, 1.6);
    }
  } else {
    texture.repeat.set(1.4, 1.4);
  }
  texture.needsUpdate = true;
}

const CABINET_TONE_THRESHOLD = 0.4;
const CABINET_HARDWARE_RE = /handle|knob|hinge|pull|drawer.?pull|hardware|chrome|steel|screw|bolt|leg|feet|مقبض|مفصل|ستانلس|حديد|معدن|يد|سكة/i;
const CABINET_BODY_RE = /door|panel|body|front|cabinet|shutter|frame|facade|صاج|جسم|باب|واجهة|خزان|درج|كابينة/i;
const _uvVertex = new THREE.Vector3();
const _uvSize = new THREE.Vector3();

function geometryHasUsableUv(geometry) {
  const uv = geometry?.attributes?.uv;
  if (!uv || uv.count === 0) return false;
  const arr = uv.array;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < uv.count; i += 1) {
    const u = arr[i * 2];
    const v = arr[i * 2 + 1];
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return maxU - minU > 0.04 && maxV - minV > 0.04;
}

function geometryNeedsProceduralUv(geometry) {
  return !geometryHasUsableUv(geometry);
}

function generateBoxProjectedUv(geometry) {
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  if (!pos) return;

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const min = box.min;
  box.getSize(_uvSize);
  _uvSize.x = Math.max(_uvSize.x, 1e-4);
  _uvSize.y = Math.max(_uvSize.y, 1e-4);
  _uvSize.z = Math.max(_uvSize.z, 1e-4);

  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 1) {
    _uvVertex.fromBufferAttribute(pos, i);
    let u;
    let v;
    if (normal) {
      const ax = Math.abs(normal.getX(i));
      const ay = Math.abs(normal.getY(i));
      const az = Math.abs(normal.getZ(i));
      if (ay >= ax && ay >= az) {
        u = (_uvVertex.x - min.x) / _uvSize.x;
        v = (_uvVertex.z - min.z) / _uvSize.z;
      } else if (ax >= az) {
        u = (_uvVertex.z - min.z) / _uvSize.z;
        v = (_uvVertex.y - min.y) / _uvSize.y;
      } else {
        u = (_uvVertex.x - min.x) / _uvSize.x;
        v = (_uvVertex.y - min.y) / _uvSize.y;
      }
    } else {
      u = (_uvVertex.x - min.x) / _uvSize.x;
      v = (_uvVertex.y - min.y) / _uvSize.y;
    }
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.attributes.uv.needsUpdate = true;
}

function meshLabelText(mesh) {
  const parts = [mesh?.name];
  let parent = mesh?.parent;
  for (let depth = 0; parent && depth < 5; depth += 1) {
    if (parent.name) parts.push(parent.name);
    parent = parent.parent;
  }
  const mats = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material];
  mats.forEach((mat) => {
    if (mat?.name) parts.push(mat.name);
  });
  return parts.filter(Boolean).join(" ");
}

function inferCabinetPartClass(mesh) {
  const text = meshLabelText(mesh).toLowerCase();
  if (CABINET_HARDWARE_RE.test(text)) return "dark";
  if (CABINET_BODY_RE.test(text)) return "light";
  return "";
}

function toneFromVertexColors(geometry) {
  const colorAttr = geometry?.attributes?.color;
  if (!colorAttr?.count) return null;
  let sum = 0;
  let samples = 0;
  const step = Math.max(1, Math.floor(colorAttr.count / 64));
  for (let i = 0; i < colorAttr.count; i += step) {
    sum += 0.2126 * colorAttr.getX(i) + 0.7152 * colorAttr.getY(i) + 0.0722 * colorAttr.getZ(i);
    samples += 1;
  }
  return samples ? sum / samples : null;
}

function ensureCabinetMeshGeometry(mesh, { force = false, stripColors = false } = {}) {
  if (!mesh?.geometry) return;
  if (!mesh.userData.originalGeometry) {
    mesh.userData.originalGeometry = mesh.geometry;
  }
  const base = mesh.userData.originalGeometry;
  const baseHasColors = !!base.attributes?.color;

  if (mesh.userData.cabinetUvGeometry && !force && !stripColors) {
    mesh.geometry = mesh.userData.cabinetUvGeometry;
    return;
  }
  if (!force && !stripColors && geometryHasUsableUv(base) && !baseHasColors) {
    mesh.geometry = base;
    return;
  }

  const prepared = base.clone();
  if (prepared.attributes.color) prepared.deleteAttribute("color");
  if (force || !geometryHasUsableUv(prepared)) {
    generateBoxProjectedUv(prepared);
  }
  if (mesh.userData.cabinetUvGeometry) {
    mesh.userData.cabinetUvGeometry.dispose?.();
  }
  mesh.userData.cabinetUvGeometry = prepared;
  mesh.geometry = prepared;
}

function prepareCabinetMeshForPaint(mesh, { wantsTexture = false } = {}) {
  ensureCabinetMeshGeometry(mesh, {
    force: wantsTexture,
    stripColors: true
  });
}

function allMeshesInObject(root) {
  const meshes = [];
  root?.traverse?.((obj) => {
    if (obj.isMesh) meshes.push(obj);
  });
  return meshes;
}

function materialLuminance(material) {
  if (!material?.color) return 0.5;
  const { r, g, b } = material.color;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function meshLooksLikeHardware(mesh) {
  if (inferCabinetPartClass(mesh) === "dark") return true;
  const label = meshLabelText(mesh).toLowerCase();
  return CABINET_HARDWARE_RE.test(label);
}

function captureMeshSourceTone(mesh) {
  if (mesh.userData.sourceTone != null) return mesh.userData.sourceTone;

  const namedPart = inferCabinetPartClass(mesh);
  if (namedPart === "dark") {
    mesh.userData.cabinetPart = "dark";
    mesh.userData.sourceTone = 0.16;
    return mesh.userData.sourceTone;
  }
  if (namedPart === "light") {
    mesh.userData.cabinetPart = "light";
    mesh.userData.sourceTone = 0.72;
    return mesh.userData.sourceTone;
  }

  const vertexTone = toneFromVertexColors(mesh.userData.originalGeometry || mesh.geometry);
  if (vertexTone != null) {
    mesh.userData.sourceTone = vertexTone;
    mesh.userData.cabinetPart = vertexTone < CABINET_TONE_THRESHOLD ? "dark" : "light";
    return mesh.userData.sourceTone;
  }

  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  let tone = 0.5;
  if (mats.length) {
    tone = mats.reduce((sum, mat) => sum + materialLuminance(mat), 0) / mats.length;
  }
  if (meshLooksLikeHardware(mesh)) tone = Math.min(tone, 0.22);
  mesh.userData.sourceTone = tone;
  mesh.userData.cabinetPart = tone < CABINET_TONE_THRESHOLD ? "dark" : "light";
  return tone;
}

function getCabinetToneThreshold(root) {
  if (!root) return CABINET_TONE_THRESHOLD;
  if (root.userData.cabinetToneThreshold != null) return root.userData.cabinetToneThreshold;
  const tones = [];
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    tones.push(captureMeshSourceTone(obj));
  });
  if (tones.length < 2) {
    root.userData.cabinetToneThreshold = CABINET_TONE_THRESHOLD;
    return CABINET_TONE_THRESHOLD;
  }
  tones.sort((a, b) => a - b);
  const low = tones[Math.floor(tones.length * 0.35)];
  const high = tones[Math.floor(tones.length * 0.65)];
  root.userData.cabinetToneThreshold = THREE.MathUtils.clamp((low + high) / 2, 0.22, 0.72);
  return root.userData.cabinetToneThreshold;
}

function meshMatchesCabinetRegion(mesh, region, centerY, root) {
  if (region === "top" || region === "bottom") {
    const b = new THREE.Box3().setFromObject(mesh);
    const y = (b.min.y + b.max.y) / 2;
    if (region === "top" && y < centerY) return false;
    if (region === "bottom" && y > centerY) return false;
  }
  if (region === "light" || region === "dark") {
    const part = mesh.userData.cabinetPart || inferCabinetPartClass(mesh);
    if (part === "light" || part === "dark") {
      return region === part;
    }
    const threshold = getCabinetToneThreshold(root);
    const tone = captureMeshSourceTone(mesh);
    if (region === "light" && tone < threshold) return false;
    if (region === "dark" && tone >= threshold) return false;
  }
  return true;
}

function cabinetRegionLabel(region) {
  if (region === "top") return "الجزء العلوي";
  if (region === "bottom") return "الجزء السفلي";
  if (region === "light") return "الأجزاء الفاتحة (صاج/جسم)";
  if (region === "dark") return "الأجزاء الداكنة (مقابض/إطار)";
  return "الكابينة";
}

function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

function imageToPowerOfTwoCanvas(img) {
  const w = img?.width || 0;
  const h = img?.height || 0;
  if (!w || !h) return null;
  const potW = isPowerOfTwo(w) ? w : nextPowerOfTwo(w);
  const potH = isPowerOfTwo(h) ? h : nextPowerOfTwo(h);
  const canvas = document.createElement("canvas");
  canvas.width = potW;
  canvas.height = potH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, potW, potH);
  return canvas;
}

async function getCachedTextureSource(url) {
  if (!url) return null;
  if (textureSourceCache.has(url)) return textureSourceCache.get(url);

  const promise = (async () => {
    const img = await loadImage(url);
    const canvas = imageToPowerOfTwoCanvas(img) || img;
    const w = canvas?.width || img?.width || 0;
    const h = canvas?.height || img?.height || 0;
    return { source: canvas, w, h };
  })();

  textureSourceCache.set(url, promise);
  return promise;
}

function createTextureFromSource(source) {
  const texture = (source instanceof HTMLCanvasElement)
    ? new THREE.CanvasTexture(source)
    : new THREE.Texture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy?.() || 1, 8);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function ensurePowerOfTwoTexture(texture) {
  const img = texture.image;
  const w = img?.width || 0;
  const h = img?.height || 0;
  if (!w || !h) return false;
  if (isPowerOfTwo(w) && isPowerOfTwo(h)) return true;

  const canvas = document.createElement("canvas");
  canvas.width = nextPowerOfTwo(w);
  canvas.height = nextPowerOfTwo(h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  texture.image = canvas;
  texture.needsUpdate = true;
  return true;
}

function createTextureMaterial(url, surfaceType = "walls", mesh = null) {
  const finish = surfaceProps(surfaceType === "model" ? "walls" : surfaceType);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    emissive: new THREE.Color(0x0a0a0a),
    emissiveIntensity: 0.12,
    roughness: finish.roughness,
    metalness: finish.metalness,
    envMapIntensity: finish.envMapIntensity
  });
  material.side = THREE.DoubleSide;

  // Use cached decoded source to make applying fast and reliable across multiple surfaces.
  getCachedTextureSource(url).then((info) => {
    if (!info) return;
    const texture = createTextureFromSource(info.source);
    configureTextureRepeat(texture, surfaceType, mesh || { userData: { wallId: "back" } });
    material.map = texture;
    material.needsUpdate = true;
    setStatus(info.w && info.h ? `تم تحميل الخامة (${info.w}×${info.h})` : "تم تحميل الخامة");
  }).catch(() => setStatus("تعذر تحميل الخامة"));

  return material;
}

function cabinetMaterialTarget(asset) {
  return String(asset?.target || "") === "metal" ? "metal" : "cabinet";
}

function buildMaterialForSurface(asset, surfaceType, mesh) {
  if (asset.type === "texture" && asset.url) {
    // Do NOT clone the texture; cloning here can lose the underlying image.
    return createTextureMaterial(asset.url, surfaceType, mesh);
  }
  const colorTarget = surfaceType === "model" ? cabinetMaterialTarget(asset) : surfaceType;
  const mat = colorMaterial(
    asset.color || "#ffffff",
    colorTarget,
    surfaceType === "floor"
      ? room.materialProps?.floor?.roughness ?? 0.62
      : surfaceType === "ceiling"
        ? room.materialProps?.ceiling?.roughness ?? 0.7
        : surfaceType === "model"
          ? room.materialProps?.[colorTarget]?.roughness
          : room.materialProps?.walls?.roughness ?? 0.78
  );
  mat.side = THREE.DoubleSide;
  mat.vertexColors = false;
  mat.transparent = false;
  mat.opacity = 1;
  mat.map = null;
  mat.alphaMap = null;
  mat.needsUpdate = true;
  return mat;
}

function assignMeshMaterial(mesh, material) {
  if (!mesh || !material) return;
  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map(() => material.clone());
  } else {
    mesh.material = material;
  }
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((m) => {
    if (!m) return;
    m.side = THREE.DoubleSide;
    m.vertexColors = false;
    m.needsUpdate = true;
  });
}

function surfacesForMaterialApply(asset, { surfaceMesh = null, applyToCategory = false } = {}) {
  if (surfaceMesh) return [surfaceMesh];
  if (selectedSurface && !applyToCategory) return [selectedSurface];
  const category = asset.target || "walls";
  return selectableSurfaces.filter((surface) => {
    if (category === "walls") return surface.userData.surfaceType === "walls";
    return surface.userData.surfaceType === category;
  });
}

function surfaceLabel(type) {
  if (type === "floor") return "الأرضية";
  if (type === "ceiling") return "السقف";
  if (type === "walls") return "الجدار";
  return type;
}

function openCabinetMaterialPanel() {
  if (!selected) {
    setStatus("اختر كابينة أولًا");
    return;
  }
  closeOverflowMenu();
  materialPanel.classList.remove("open");
  cabinetMaterialPanel.classList.add("open");
  setStatus("اختر خامة كابينات/معادن من الكتالوج لتطبيقها");
}

function closeCabinetMaterialPanel() {
  cabinetMaterialPanel.classList.remove("open");
}

const CABINET_PANEL_POS_KEY = "kitchenCabinetPanelPos";

function clampPanelPosition(left, top, panel) {
  const margin = 8;
  const w = panel.offsetWidth || 280;
  const h = panel.offsetHeight || 200;
  const maxLeft = Math.max(margin, window.innerWidth - w - margin);
  const maxTop = Math.max(margin, window.innerHeight - h - margin);
  return {
    left: THREE.MathUtils.clamp(left, margin, maxLeft),
    top: THREE.MathUtils.clamp(top, margin, maxTop)
  };
}

function applyCabinetPanelPosition(left, top) {
  if (!cabinetMaterialPanel) return;
  const pos = clampPanelPosition(left, top, cabinetMaterialPanel);
  cabinetMaterialPanel.style.left = `${pos.left}px`;
  cabinetMaterialPanel.style.top = `${pos.top}px`;
  cabinetMaterialPanel.style.right = "auto";
  cabinetMaterialPanel.style.bottom = "auto";
}

function initDraggableCabinetPanel() {
  const handle = document.getElementById("cabinetPanelDragHandle");
  if (!handle || !cabinetMaterialPanel) return;

  try {
    const saved = JSON.parse(localStorage.getItem(CABINET_PANEL_POS_KEY) || "null");
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      applyCabinetPanelPosition(saved.left, saved.top);
    }
  } catch {
    /* ignore */
  }

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const onPointerDown = (event) => {
    if (event.target.closest("button")) return;
    dragging = true;
    const rect = cabinetMaterialPanel.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    cabinetMaterialPanel.style.right = "auto";
    cabinetMaterialPanel.style.bottom = "auto";
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    applyCabinetPanelPosition(event.clientX - offsetX, event.clientY - offsetY);
  };

  const onPointerUp = (event) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture(event.pointerId);
    const rect = cabinetMaterialPanel.getBoundingClientRect();
    localStorage.setItem(
      CABINET_PANEL_POS_KEY,
      JSON.stringify({ left: rect.left, top: rect.top })
    );
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);
}

function isCabinetOrModelMaterial(asset) {
  const t = String(asset?.target || "");
  return t === "cabinet" || t === "metal" || t === "model";
}

function resolveRootItemFromHit(object) {
  let root = object;
  while (root?.parent && root.parent !== itemGroup) root = root.parent;
  return root;
}

function pickItemUnderPointer(event) {
  pointerFromEvent(event);
  const hits = raycaster.intersectObjects(itemGroup.children, true);
  if (!hits.length) return null;
  return resolveRootItemFromHit(hits[0].object);
}

function collectSelectedMeshesByRegion(region) {
  if (!selected) return [];
  const bounds = getObjectBounds(selected);
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  const meshes = [];
  selected.traverse((obj) => {
    if (!obj.isMesh) return;
    if (!meshMatchesCabinetRegion(obj, region, centerY, selected)) return;
    meshes.push(obj);
  });

  if (!meshes.length && (region === "light" || region === "dark")) {
    const all = allMeshesInObject(selected);
    if (all.length === 1) {
      return all;
    }
    if (region === "light") {
      return all.filter((mesh) => !meshLooksLikeHardware(mesh));
    }
    if (region === "dark") {
      return all.filter((mesh) => meshLooksLikeHardware(mesh));
    }
  }

  return meshes;
}

function applyUvControlsToMaterial(material) {
  const u = THREE.MathUtils.clamp(Number(cabinetUvU?.value || 120) / 100, 0.1, 4);
  const v = THREE.MathUtils.clamp(Number(cabinetUvV?.value || 120) / 100, 0.1, 4);
  const scale = THREE.MathUtils.clamp(Number(cabinetUvScale?.value || 100) / 100, 0.2, 3);
  const uu = u / scale;
  const vv = v / scale;
  if (material?.map) {
    material.map.wrapS = THREE.RepeatWrapping;
    material.map.wrapT = THREE.RepeatWrapping;
    material.map.repeat.set(uu, vv);
    material.map.needsUpdate = true;
  }
  material.needsUpdate = true;
}

function applyMaterialToCabinetMeshes(targets, asset, region) {
  const wantsTexture = asset.type === "texture" && !!asset.url;
  targets.forEach((mesh) => {
    prepareCabinetMeshForPaint(mesh, { wantsTexture });
    const mat = buildMaterialForSurface(asset, "model", mesh);
    mat.vertexColors = false;
    applyUvControlsToMaterial(mat);
    assignMeshMaterial(mesh, mat);
    mesh.userData.cabinetMaterial = { name: asset.name, region };
  });
}

function applyMaterialToSelectedCabinet(asset) {
  if (!selected) {
    setStatus("اختر كابينة أولًا لتطبيق خامات الكابينات");
    return;
  }
  const region = String(cabinetMatRegion?.value || "light");
  const targets = collectSelectedMeshesByRegion(region);
  if (!targets.length) {
    setStatus("لم يتم العثور على أجزاء داخل الكابينة — جرّب «كل الكابينة» أو سمِّ القطع في Blender (door / handle)");
    return;
  }

  pendingCabinetMaterial = asset;
  applyMaterialToCabinetMeshes(targets, asset, region);

  let status = `تم تطبيق ${asset.name} على ${cabinetRegionLabel(region)}`;
  if (
    (region === "light" || region === "dark") &&
    allMeshesInObject(selected).length === 1 &&
    targets.length === 1
  ) {
    status += " (موديل بقطعة واحدة — للفصل بين الصاج والمقابض قسّم الموديل في Blender)";
  }
  setStatus(status);
}

function reapplyCabinetUv() {
  if (!selected) return;
  const region = String(cabinetMatRegion?.value || "all");
  const targets = collectSelectedMeshesByRegion(region);
  targets.forEach((mesh) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => applyUvControlsToMaterial(m));
  });
}

function createBox(name, size, position, material, surfaceType = "") {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.name = name;
  mesh.position.copy(position);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.surfaceType = surfaceType;
  if (mesh.material) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => {
      if (!m) return;
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
    });
  }
  if (surfaceType) selectableSurfaces.push(mesh);
  return mesh;
}

function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.userData?.cabinetUvGeometry) {
      obj.userData.cabinetUvGeometry.dispose?.();
      delete obj.userData.cabinetUvGeometry;
    }
    if (obj.geometry && obj.geometry !== obj.userData?.cabinetUvGeometry) obj.geometry.dispose();
    if (obj.material) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((material) => material.dispose?.());
    }
  });
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    disposeObject(child);
  }
}

function buildRoom() {
  clearGroup(roomGroup);
  selectableSurfaces.length = 0;
  selectedSurface = null;
  openingsByWall = { back: [], front: [], left: [], right: [] };
  wallMeshes = { back: null, front: null, left: null, right: null };

  const wallThickness = 0.08;
  const floor = createBox(
    "الأرضية",
    new THREE.Vector3(room.width, 0.08, room.depth),
    new THREE.Vector3(0, -0.04, 0),
    colorMaterial(room.floorColor, "floor", room.materialProps?.floor?.roughness ?? 0.62),
    "floor"
  );
  roomGroup.add(floor);

  const wallMat = colorMaterial(room.wallColor, "walls", room.materialProps?.walls?.roughness ?? 0.78);
  roomGroup.add(buildWallMesh("back", "الجدار الخلفي", wallMat.clone()));

  if (room.walls >= 2) {
    roomGroup.add(buildWallMesh("right", "الجدار الأيمن", wallMat.clone()));
  }
  if (room.walls >= 3) {
    roomGroup.add(buildWallMesh("left", "الجدار الأيسر", wallMat.clone()));
  }
  if (room.walls >= 4) {
    roomGroup.add(buildWallMesh("front", "الجدار الأمامي", wallMat.clone()));
  }

  if (room.hasCeiling) {
    const ceiling = createBox(
      "السقف",
      new THREE.Vector3(room.width, 0.08, room.depth),
      new THREE.Vector3(0, room.height + 0.04, 0),
      colorMaterial(room.ceilingColor, "ceiling", room.materialProps?.ceiling?.roughness ?? 0.7),
      "ceiling"
    );
    roomGroup.add(ceiling);
  }

  if (room.showGrid) {
    const grid = new THREE.GridHelper(Math.max(room.width, room.depth), Math.ceil(Math.max(room.width, room.depth)));
    grid.position.y = 0.004;
    grid.material.opacity = 0.16;
    grid.material.transparent = true;
    roomGroup.add(grid);
  }

  controls.maxDistance = Math.max(room.width, room.depth, room.height) * 2.6;
  controls.target.set(0, Math.min(room.height / 2, 1.45), 0);
  setStatus("الغرفة جاهزة بدون عناصر تلقائية");
}

function wallSize(wallId) {
  if (wallId === "left" || wallId === "right") return { width: room.depth, height: room.height };
  return { width: room.width, height: room.height };
}

function buildWallMesh(wallId, label, material) {
  const { width, height } = wallSize(wallId);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();

  (openingsByWall[wallId] || []).forEach((hole) => {
    const path = new THREE.Path();
    const w = Math.max(hole.width, 0.2);
    const h = Math.max(hole.height, 0.2);
    const x0 = hole.centerU - w / 2;
    const x1 = hole.centerU + w / 2;
    const y0 = hole.centerV - h / 2;
    const y1 = hole.centerV + h / 2;
    path.moveTo(x0, y0);
    path.lineTo(x1, y0);
    path.lineTo(x1, y1);
    path.lineTo(x0, y1);
    path.closePath();
    shape.holes.push(path);
  });

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: WALL_THICKNESS, bevelEnabled: false });
  geometry.translate(0, 0, -WALL_THICKNESS / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = label;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.surfaceType = "walls";
  mesh.userData.wallId = wallId;
  if (mesh.material) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => {
      if (!m) return;
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
    });
  }
  selectableSurfaces.push(mesh);

  if (wallId === "back") mesh.position.set(0, 0, -room.depth / 2);
  if (wallId === "front") mesh.position.set(0, 0, room.depth / 2);
  if (wallId === "right") {
    mesh.position.set(room.width / 2, 0, 0);
    mesh.rotation.y = -Math.PI / 2;
  }
  if (wallId === "left") {
    mesh.position.set(-room.width / 2, 0, 0);
    mesh.rotation.y = Math.PI / 2;
  }

  wallMeshes[wallId] = mesh;
  return mesh;
}

function rebuildWall(wallId) {
  const old = wallMeshes[wallId];
  if (!old) return;
  const material = old.material?.clone?.() || old.material;
  const label = old.name;
  roomGroup.remove(old);
  disposeObject(old);
  const next = buildWallMesh(wallId, label, material);
  roomGroup.add(next);
}

function applyMaterialToTarget(asset, options = {}) {
  // Cabinet / metal materials should only apply to selected cabinet (not room surfaces).
  if (isCabinetOrModelMaterial(asset)) {
    openCabinetMaterialPanel();
    applyMaterialToSelectedCabinet(asset);
    return;
  }

  const applyToCategory = options.applyToCategory ?? false;
  const surfaces = surfacesForMaterialApply(asset, {
    surfaceMesh: options.surfaceMesh || null,
    applyToCategory
  });

  if (!surfaces.length) {
    setStatus("اسحب الخامة على الجدار أو الأرضية أو السقف");
    return;
  }

  if (asset.type === "texture" && asset.url) {
    lastTextureForPreview = asset.url;
    generateAndShowPbrPreviews(asset.url).catch(() => {});
  }

  const appliedTypes = new Set();
  surfaces.forEach((surface) => {
    const surfaceType = surface.userData.surfaceType;
    appliedTypes.add(surfaceType);
    surface.material = buildMaterialForSurface(asset, surfaceType, surface);
    if (surface.material) {
      const mats = Array.isArray(surface.material) ? surface.material : [surface.material];
      mats.forEach((m) => {
        if (!m) return;
        m.needsUpdate = true;
        if (m.map) m.map.needsUpdate = true;
      });
    }
    surface.userData.lastMaterial = { name: asset.name, source: asset.category || asset.target };
  });
  renderer.render(scene, camera);

  // "Brush" material: choose once, apply to many surfaces by tapping.
  if (asset?.kind === "material") activeBrushMaterial = asset;

  const typeList = [...appliedTypes].map(surfaceLabel).join("، ");
  const cross = surfaces.length === 1 && asset.target && asset.target !== surfaces[0].userData.surfaceType;
  setStatus(
    cross
      ? `تم تطبيق ${asset.name} على ${typeList} (خامة ${surfaceLabel(asset.target)} → ${typeList})`
      : `تم تطبيق ${asset.name} على ${typeList}`
  );
}

function rotateSelectedByDegrees(deg) {
  if (!selected) {
    setStatus("اختر عنصرًا أولًا");
    return;
  }
  selected.rotation.y += THREE.MathUtils.degToRad(deg);
  if (snapEnabled) snapObject(selected);
  selectionBox.setFromObject(selected);
  setStatus(`تم تدوير العنصر ${deg}°`);
}

function getPmremGenerator() {
  if (!pmremGenerator) {
    pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
  }
  return pmremGenerator;
}

function disposeHdrTextures() {
  if (hdrEquirectTexture) {
    hdrEquirectTexture.dispose();
    hdrEquirectTexture = null;
  }
  if (hdrEnvMapTexture) {
    hdrEnvMapTexture.dispose();
    hdrEnvMapTexture = null;
  }
}

function applyFallbackEnvironment() {
  disposeHdrTextures();
  const pmrem = getPmremGenerator();
  hdrEnvMapTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = hdrEnvMapTexture;
  scene.environmentIntensity = 0.85;
  scene.background = new THREE.Color(0x0b111c);
  scene.fog = new THREE.Fog(0x0b111c, 13, 38);
  syncHdrPreviewLabel("إضاءة افتراضية");
}

function boostSceneMaterialsEnv(intensity = 1.15) {
  const apply = (root) => {
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((material) => {
        material.envMapIntensity = Math.max(material.envMapIntensity || 0, intensity);
        material.needsUpdate = true;
      });
    });
  };
  apply(roomGroup);
  apply(itemGroup);
}

async function applyHdrEnvironment(url, { save = true, forStudio = false } = {}) {
  if (!url) {
    applyFallbackEnvironment();
    return;
  }

  const token = ++hdrLoadToken;
  setStatus("جاري تحميل إضاءة HDR...");

  try {
    const hdr = await rgbeLoader.loadAsync(url);
    if (token !== hdrLoadToken) {
      hdr.dispose();
      return;
    }

    // RGBE/HDR textures are linear.
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    hdr.colorSpace = THREE.LinearSRGBColorSpace;
    hdr.minFilter = THREE.LinearFilter;
    hdr.magFilter = THREE.LinearFilter;
    const pmrem = getPmremGenerator();
    disposeHdrTextures();
    hdrEquirectTexture = hdr;
    hdrEnvMapTexture = pmrem.fromEquirectangular(hdr).texture;
    scene.environment = hdrEnvMapTexture;

    const intensity = forStudio ? Math.max(room.hdrIntensity || 1.2, 1.35) : (room.hdrIntensity || 1.2);
    scene.environmentIntensity = intensity;
    boostSceneMaterialsEnv(forStudio ? 1.35 : 1.1);
    updateHdrSceneVisuals(forStudio);

    if (save) {
      room.hdrUrl = url;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(room));
    }

    const hdrName = hdrCatalog.find((h) => h.url === url)?.name || "HDR";
    syncHdrPreviewLabel(hdrName);
    setStatus(forStudio ? "إضاءة استوديو HDR جاهزة" : `بيئة HDR نشطة: ${hdrName}`);
  } catch (error) {
    console.error(error);
    applyFallbackEnvironment();
    setStatus("تعذر تحميل HDR — تم استخدام إضاءة افتراضية");
  }
}

async function ensureStudioEnvironment() {
  const url = room.hdrUrl || hdrCatalog[0]?.url || "";
  if (url) {
    await applyHdrEnvironment(url, { save: false, forStudio: true });
  } else {
    applyFallbackEnvironment();
    scene.environmentIntensity = 1.1;
    boostSceneMaterialsEnv(1.2);
  }
}

function applyStudioLighting() {
  applyPhotorealLighting();
}

function ensurePhotoWindowLights() {
  if (photoLightsReady) return;
  photoLightGroup.clear();

  const windowW = Math.max(room.width * 0.55, 1.2);
  const windowH = Math.max(room.height * 0.5, 1);
  const kelvin = 0xfff3e0;

  const backWindow = new THREE.RectAreaLight(kelvin, 14, windowW, windowH);
  backWindow.position.set(0, room.height * 0.48, -room.depth / 2 + 0.12);
  backWindow.lookAt(0, room.height * 0.4, 0);

  const sideWindow = new THREE.RectAreaLight(0xfff8f0, 9, windowH * 0.85, windowW * 0.45);
  sideWindow.position.set(room.width / 2 - 0.1, room.height * 0.5, 0);
  sideWindow.lookAt(0, 1.2, 0);

  const ceilingBounce = new THREE.RectAreaLight(0xffffff, 3.5, room.width * 0.9, room.depth * 0.85);
  ceilingBounce.position.set(0, room.height - 0.15, 0);
  ceilingBounce.rotation.x = -Math.PI / 2;

  photoLightGroup.add(backWindow, sideWindow, ceilingBounce);
  photoLightsReady = true;
}

function enhanceMaterialsForPhotoRender() {
  const touch = (root) => {
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((m) => {
        if (!m || (!m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial)) return;
        if (!m.userData.photoBackup) {
          m.userData.photoBackup = {
            roughness: m.roughness,
            metalness: m.metalness,
            envMapIntensity: m.envMapIntensity
          };
        }
        const isMetal = (m.metalness ?? 0) > 0.45;
        if (!isMetal) {
          m.roughness = THREE.MathUtils.clamp((m.roughness ?? 0.55) * 1.02, 0.22, 0.88);
          m.metalness = THREE.MathUtils.clamp(m.metalness ?? 0.04, 0, 0.14);
        }
        m.envMapIntensity = Math.max(m.envMapIntensity || 0, isMetal ? 1.35 : 1.55);
        m.needsUpdate = true;
      });
    });
  };
  touch(roomGroup);
  touch(itemGroup);
}

function restoreMaterialsAfterPhotoRender() {
  const touch = (root) => {
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((m) => {
        const b = m?.userData?.photoBackup;
        if (!b) return;
        m.roughness = b.roughness;
        m.metalness = b.metalness;
        m.envMapIntensity = b.envMapIntensity;
        delete m.userData.photoBackup;
        m.needsUpdate = true;
      });
    });
  };
  touch(roomGroup);
  touch(itemGroup);
}

function applyPhotorealLighting() {
  ensurePhotoWindowLights();
  photoLightGroup.visible = true;
  photoRenderActive = true;

  scene.fog = null;
  ambientLight.intensity = 0.04;
  ambientLight.color.set(0xfff8f2);
  ambientLight.groundColor.set(0x8a9ab0);

  keyLight.intensity = 0.12;
  keyLight.color.set(0xfff5eb);
  keyLight.position.set(3.5, 6.8, 4.2);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(4096, 4096);
  keyLight.shadow.bias = -0.00012;
  keyLight.shadow.radius = 3;

  scene.environmentIntensity = Math.max(room.hdrIntensity || 1.2, 1.62);
  if (hdrEquirectTexture) {
    scene.background = hdrEquirectTexture;
    if ("backgroundIntensity" in scene) scene.backgroundIntensity = 0.62;
    if ("backgroundBlurriness" in scene) scene.backgroundBlurriness = 0.04;
  }

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  boostSceneMaterialsEnv(1.5);
  enhanceMaterialsForPhotoRender();
}

function endPhotorealLighting() {
  photoLightGroup.visible = false;
  photoRenderActive = false;
  restoreMaterialsAfterPhotoRender();
}

function syncHdrPreviewLabel(text) {
  if (hdrPreviewLabel) hdrPreviewLabel.textContent = text ? `البيئة الحالية: ${text}` : "";
}

function syncHdrControlsFromRoom() {
  if (hdrShowBg) hdrShowBg.checked = room.hdrShowBackground !== false;
  if (hdrEnvIntensity) hdrEnvIntensity.value = String(Math.round((room.hdrIntensity || 1.2) * 100));
  if (hdrBgIntensity) hdrBgIntensity.value = String(Math.round((room.hdrBackgroundIntensity ?? 0.45) * 100));
}

function persistRoomConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(room));
}

function updateHdrSceneVisuals(forStudio = false) {
  if (!hdrEquirectTexture) return;

  scene.environmentIntensity = forStudio
    ? Math.max(room.hdrIntensity || 1.2, 1.35)
    : (room.hdrIntensity || 1.2);

  if (room.hdrShowBackground !== false) {
    // Show HDR as a visible "sky" inside the scene.
    // Use the raw equirect texture for maximum compatibility.
    scene.background = hdrEquirectTexture;
    // Ensure background isn't effectively black under tone mapping.
    renderer.toneMappingExposure = Math.max(renderer.toneMappingExposure || 1, 1.05);
    if ("backgroundIntensity" in scene) scene.backgroundIntensity = room.hdrBackgroundIntensity ?? 0.45;
    if ("backgroundBlurriness" in scene) scene.backgroundBlurriness = room.hdrBackgroundBlur ?? 0.1;
    scene.fog = new THREE.Fog(0x121c2a, 16, 48);
  } else {
    scene.background = new THREE.Color(0x0b111c);
    scene.fog = new THREE.Fog(0x0b111c, 13, 38);
  }
}

function applyHdrSettingsFromUi() {
  room.hdrShowBackground = hdrShowBg?.checked !== false;
  room.hdrIntensity = THREE.MathUtils.clamp(Number(hdrEnvIntensity?.value || 120) / 100, 0.4, 2);
  room.hdrBackgroundIntensity = THREE.MathUtils.clamp(Number(hdrBgIntensity?.value || 45) / 100, 0, 1);
  persistRoomConfig();
  updateHdrSceneVisuals(false);
  boostSceneMaterialsEnv(1.05 + room.hdrIntensity * 0.08);
  setStatus("تم تحديث بيئة HDR داخل المشهد");
}

function populateHdrSelect() {
  if (!hdrSelect) return;

  if (!hdrCatalog.length) {
    hdrSelect.innerHTML = `<option value="">ضع ملفات .hdr في models/hdr/</option>`;
    return;
  }

  hdrSelect.innerHTML = hdrCatalog
    .map((item) => `<option value="${escapeHTML(item.url)}">${escapeHTML(item.name)}</option>`)
    .join("");

  const preferred = room.hdrUrl && hdrCatalog.some((h) => h.url === room.hdrUrl)
    ? room.hdrUrl
    : hdrCatalog[0].url;
  hdrSelect.value = preferred;
}

async function loadHdrCatalog() {
  try {
    const response = await fetch("/api/hdr", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    hdrCatalog = data.environments || [];
  } catch (error) {
    console.error(error);
    hdrCatalog = [];
  }

  populateHdrSelect();
  syncHdrControlsFromRoom();
  const url = room.hdrUrl || hdrCatalog[0]?.url || "";
  if (url) await applyHdrEnvironment(url, { save: !room.hdrUrl });
  else applyFallbackEnvironment();
}

async function withHighQualityCapture(callback) {
  const cw = viewport.clientWidth;
  const ch = viewport.clientHeight;
  const prev = {
    ratio: renderer.getPixelRatio(),
    exposure: renderer.toneMappingExposure,
    toneMapping: renderer.toneMapping,
    ambient: ambientLight.intensity,
    ambientColor: ambientLight.color.clone(),
    groundColor: ambientLight.groundColor.clone(),
    key: keyLight.intensity,
    keyColor: keyLight.color.clone(),
    keyPos: keyLight.position.clone(),
    shadowSize: keyLight.shadow.mapSize.clone(),
    shadowRadius: keyLight.shadow.radius,
    fog: scene.fog,
    background: scene.background,
    envIntensity: scene.environmentIntensity,
    bgIntensity: scene.backgroundIntensity,
    bgBlur: scene.backgroundBlurriness,
    transformAttached: selected,
    selectionVisible: selectionBox.visible,
    hudHidden: itemHud.hidden,
    size: renderer.getSize(new THREE.Vector2())
  };

  transform.detach();
  selectionBox.visible = false;
  itemHud.hidden = true;
  scene.fog = null;

  await ensureStudioEnvironment();
  applyPhotorealLighting();

  const scale = Math.min(2.5, 4096 / Math.max(cw, ch, 1));
  const rw = Math.floor(cw * scale);
  const rh = Math.floor(ch * scale);

  renderer.setPixelRatio(1);
  renderer.setSize(rw, rh, false);
  camera.aspect = cw / Math.max(ch, 1);
  camera.updateProjectionMatrix();

  let composer = null;
  try {
    composer = new EffectComposer(renderer);
    composer.setSize(rw, rh);
    composer.addPass(new RenderPass(scene, camera));
    const ssao = new SSAOPass(scene, camera, rw, rh);
    ssao.kernelRadius = 12;
    ssao.minDistance = 0.001;
    ssao.maxDistance = 0.085;
    composer.addPass(ssao);
    composer.addPass(new OutputPass());
    composer.render();
  } catch (composerError) {
    console.warn("SSAO composer failed, direct render", composerError);
    renderer.render(scene, camera);
  }

  const dataUrl = renderer.domElement.toDataURL("image/png", 1.0);
  const result = callback(dataUrl);

  composer?.dispose?.();
  endPhotorealLighting();

  renderer.setPixelRatio(prev.ratio);
  renderer.setSize(prev.size.x, prev.size.y, false);
  camera.aspect = cw / Math.max(ch, 1);
  camera.updateProjectionMatrix();
  renderer.toneMappingExposure = prev.exposure;
  renderer.toneMapping = prev.toneMapping;
  ambientLight.intensity = prev.ambient;
  ambientLight.color.copy(prev.ambientColor);
  ambientLight.groundColor.copy(prev.groundColor);
  keyLight.intensity = prev.key;
  keyLight.color.copy(prev.keyColor);
  keyLight.position.copy(prev.keyPos);
  keyLight.shadow.mapSize.copy(prev.shadowSize);
  keyLight.shadow.radius = prev.shadowRadius;
  scene.fog = prev.fog;
  scene.background = prev.background;
  scene.environmentIntensity = prev.envIntensity;
  if ("backgroundIntensity" in scene) scene.backgroundIntensity = prev.bgIntensity;
  if ("backgroundBlurriness" in scene) scene.backgroundBlurriness = prev.bgBlur;

  if (prev.transformAttached) {
    transform.attach(prev.transformAttached);
    selectionBox.visible = prev.selectionVisible;
    itemHud.hidden = prev.hudHidden;
  }

  const previewUrl = room.hdrUrl || hdrCatalog[0]?.url || "";
  if (previewUrl) await applyHdrEnvironment(previewUrl, { save: false, forStudio: false });
  else applyFallbackEnvironment();

  renderer.render(scene, camera);
  return result;
}

async function generateAndShowPbrPreviews(url) {
  if (!mapPreviews) return;
  mapPreviews.innerHTML = "";

  const img = await loadImage(url);
  const { width, height } = fitPreviewSize(img.width, img.height, 256);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, width, height);
  const src = sctx.getImageData(0, 0, width, height);

  const heightMap = luminanceMap(src);
  const normal = normalMapFromHeight(heightMap, width, height, 2.0);
  const rough = grayscaleImage(heightMap, width, height, { invert: true });
  const ao = grayscaleImage(heightMap, width, height, { invert: false });
  const metal = solidGrayscale(width, height, 0);

  addPreview("Normal (أزرق)", normal, width, height);
  addPreview("Roughness (أبيض/أسود)", rough, width, height);
  addPreview("AO (أبيض/أسود)", ao, width, height);
  addPreview("Metallic (أسود)", metal, width, height);
}

function addPreview(title, imageData, w, h) {
  const card = document.createElement("div");
  card.className = "map-preview";
  const label = document.createElement("strong");
  label.textContent = title;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  card.appendChild(label);
  card.appendChild(canvas);
  mapPreviews.appendChild(card);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function fitPreviewSize(w, h, maxSide) {
  const scale = Math.min(maxSide / Math.max(w, h), 1);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function luminanceMap(imageData) {
  const { data, width, height } = imageData;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    out[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return out;
}

function grayscaleImage(map, w, h, { invert }) {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = THREE.MathUtils.clamp(invert ? 1 - map[i] : map[i], 0, 1);
    const c = Math.round(v * 255);
    const o = i * 4;
    img.data[o] = c;
    img.data[o + 1] = c;
    img.data[o + 2] = c;
    img.data[o + 3] = 255;
  }
  return img;
}

function solidGrayscale(w, h, value0to255) {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    img.data[o] = value0to255;
    img.data[o + 1] = value0to255;
    img.data[o + 2] = value0to255;
    img.data[o + 3] = 255;
  }
  return img;
}

function normalMapFromHeight(heightMap, w, h, strength) {
  const img = new ImageData(w, h);
  const get = (x, y) => heightMap[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (get(x + 1, y) - get(x - 1, y)) * strength;
      const dy = (get(x, y + 1) - get(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const o = (y * w + x) * 4;
      img.data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  return img;
}

function openMaterialPanel() {
  closeOverflowMenu();
  materialPanel.classList.add("open");
  syncMaterialPanelFromRoom(materialTargetSelect.value);
}

function closeMaterialPanel() {
  materialPanel.classList.remove("open");
}

function toggleOverflowMenu() {
  const open = overflowMenu.hasAttribute("hidden");
  if (open) {
    overflowMenu.removeAttribute("hidden");
    moreMenuBtn.setAttribute("aria-expanded", "true");
  } else {
    closeOverflowMenu();
  }
}

function closeOverflowMenu() {
  overflowMenu.setAttribute("hidden", "");
  moreMenuBtn.setAttribute("aria-expanded", "false");
}

function roughnessFromGloss(gloss0to100) {
  const gloss = THREE.MathUtils.clamp(Number(gloss0to100) / 100, 0, 1);
  return THREE.MathUtils.clamp(1 - gloss, 0, 1);
}

function glossFromRoughness(roughness0to1) {
  const rough = THREE.MathUtils.clamp(Number(roughness0to1), 0, 1);
  return Math.round((1 - rough) * 100);
}

function syncMaterialPanelFromRoom(target) {
  const props = surfaceProps(target);
  materialGlossInput.value = String(glossFromRoughness(props.roughness));
  materialMetalInput.value = String(Math.round(props.metalness * 100));
  materialEnvInput.value = String(Math.round(props.envMapIntensity * 100));
}

function applyMaterialProps() {
  const target = materialTargetSelect.value;
  const roughness = roughnessFromGloss(materialGlossInput.value);
  const metalness = THREE.MathUtils.clamp(Number(materialMetalInput.value) / 100, 0, 1);
  const envMapIntensity = THREE.MathUtils.clamp(Number(materialEnvInput.value) / 100, 0, 2);

  room.materialProps = room.materialProps || {};
  room.materialProps[target] = { roughness, metalness, envMapIntensity };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(room));

  selectableSurfaces.forEach((surface) => {
    if (surface.userData.surfaceType !== target) return;
    const mats = Array.isArray(surface.material) ? surface.material : [surface.material];
    mats.forEach((m) => {
      if (!m) return;
      m.roughness = roughness;
      m.metalness = metalness;
      m.envMapIntensity = envMapIntensity;
      m.needsUpdate = true;
    });
  });

  setStatus(`تم تحديث لمعان الخامة: ${target === "walls" ? "الجدران" : target === "floor" ? "الأرضية" : "السقف"}`);
}

function toggleWalls() {
  closeOverflowMenu();
  const wallSurfaces = selectableSurfaces.filter((surface) => surface.userData.surfaceType === "walls");
  if (!wallSurfaces.length) return;

  if (selectedSurface?.userData.surfaceType === "walls") {
    selectedSurface.visible = !selectedSurface.visible;
    setStatus(selectedSurface.visible ? `تم إظهار ${selectedSurface.name}` : `تم إخفاء ${selectedSurface.name}`);
    return;
  }

  wallsVisible = !wallsVisible;
  wallSurfaces.forEach((surface) => {
    surface.visible = wallsVisible;
  });
  setStatus(wallsVisible ? "تم إظهار الجدران" : "تم إخفاء الجدران");
}

function pointerFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function getDropPoint(event) {
  pointerFromEvent(event);
  const hits = raycaster.intersectObjects(selectableSurfaces, false);
  if (hits.length) return { point: hits[0].point, surface: hits[0].object };
  return { point: new THREE.Vector3(0, 0, -room.depth / 2 + 0.42), surface: null };
}

function selectItem(item) {
  selected = item;
  selectedSurface = null;
  if (selected) {
    selected.userData.cabinetToneThreshold = null;
    transform.attach(selected);
    transform.setMode("translate");
    selectionBox.visible = true;
    selectionBox.setFromObject(selected);
    itemHud.hidden = false;
    if (resizePanel.classList.contains("open")) updateResizeInputs();
    setStatus(`محدد: ${selected.name}`);
  } else {
    transform.detach();
    selectionBox.visible = false;
    itemHud.hidden = true;
    resizePanel.classList.remove("open");
  }
}

function selectSurface(surface) {
  selected = null;
  selectedSurface = surface;
  transform.detach();
  selectionBox.visible = false;
  itemHud.hidden = true;
  resizePanel.classList.remove("open");
  setStatus(`سطح: ${surface.name}. اسحب خامة للتطبيق.`);
}

function updateItemHudPosition() {
  if (!selected || itemHud.hidden) return;

  const box = getObjectBounds(selected);
  hudWorld.set((box.min.x + box.max.x) / 2, box.max.y + 0.12, (box.min.z + box.max.z) / 2);
  hudWorld.project(camera);

  const rect = renderer.domElement.getBoundingClientRect();
  const x = rect.left + (hudWorld.x * 0.5 + 0.5) * rect.width;
  const y = rect.top + (-hudWorld.y * 0.5 + 0.5) * rect.height;

  itemHud.style.left = `${x}px`;
  itemHud.style.top = `${Math.max(rect.top + 8, y - 8)}px`;
  itemHud.style.transform = "translate(-50%, -100%)";

  if (resizePanel.classList.contains("open")) {
    positionResizePanel(x, y, rect);
  }
}

function positionResizePanel(hudX, hudY, canvasRect) {
  const panelW = resizePanel.offsetWidth || 280;
  const left = THREE.MathUtils.clamp(hudX, canvasRect.left + panelW / 2 + 8, canvasRect.right - panelW / 2 - 8);
  const top = Math.min(hudY + 12, canvasRect.bottom - resizePanel.offsetHeight - 12);
  resizePanel.style.left = `${left}px`;
  resizePanel.style.top = `${top}px`;
  resizePanel.style.transform = "translate(-50%, 0)";
}

function rememberMeshSettings(root) {
  root.userData.cabinetToneThreshold = null;
  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      delete obj.userData.sourceTone;
      delete obj.userData.cabinetPart;
      captureMeshSourceTone(obj);
    }
  });
}

function normalizeModel(wrapper, asset) {
  const targetSize = asset.size || defaultModelSize(asset.snap);
  let box = new THREE.Box3().setFromObject(wrapper);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxHorizontal = Math.max(size.x, size.z, 0.001);
  const scale = targetSize / maxHorizontal;

  wrapper.children.forEach((child) => child.position.sub(center));
  wrapper.scale.setScalar(scale);

  box = new THREE.Box3().setFromObject(wrapper);
  wrapper.position.y -= box.min.y;
  wrapper.userData.normalizedSize = box.getSize(new THREE.Vector3()).clone();
}

function defaultModelSize(snap) {
  if (snap === "ceiling") return 0.42;
  if (snap === "wall") return 0.78;
  return 0.92;
}

function addModelAsset(asset, dropPoint = null) {
  if (!asset.url || ![".glb", ".gltf"].includes((asset.ext || "").toLowerCase())) {
    setStatus("هذا العنصر يحتاج ملف GLB أو GLTF");
    return;
  }

  setStatus(`جاري تحميل ${asset.name}`);
  gltfLoader.load(
    asset.url,
    (gltf) => {
      const wrapper = new THREE.Group();
      wrapper.name = asset.name;
      wrapper.userData.selectable = true;
      wrapper.userData.isOpening = openingHint(asset);
      wrapper.userData.snap = wrapper.userData.isOpening ? "wall" : (asset.snap || "floorWall");
      wrapper.userData.asset = asset;
      wrapper.add(gltf.scene);
      rememberMeshSettings(wrapper);
      normalizeModel(wrapper, asset);
      wrapper.position.copy(dropPoint || centerDropPoint(wrapper));
      itemGroup.add(wrapper);
      if (snapEnabled && dropPoint) snapObject(wrapper);
      selectItem(wrapper);
      setStatus(`تم إدخال ${asset.name}`);
    },
    undefined,
    (error) => {
      console.error(error);
      setStatus("تعذر تحميل الموديل");
    }
  );
}

function openingHint(asset) {
  const name = String(asset?.name || "");
  const cat = String(asset?.category || "");
  return /باب|شباك/i.test(name) || /door|window/i.test(name) || /doors|windows/i.test(cat);
}

function centerDropPoint(object) {
  const box = new THREE.Box3().setFromObject(object);
  return new THREE.Vector3(0, -box.min.y, 0);
}

function getObjectBounds(object) {
  return new THREE.Box3().setFromObject(object);
}

function moveObjectToBox(object, currentBox, targetBox) {
  const delta = targetBox.getCenter(new THREE.Vector3()).sub(currentBox.getCenter(new THREE.Vector3()));
  object.position.add(delta);
}

function snapObject(object) {
  const snapMode = object.userData.snap || "floorWall";
  let box = getObjectBounds(object);
  const size = box.getSize(new THREE.Vector3());

  if (snapMode === "ceiling") {
    object.position.y += room.height - box.max.y - 0.02;
    clampObjectInsideRoom(object);
    return;
  }

  if (snapMode === "wall") {
    object.position.y = THREE.MathUtils.clamp(object.position.y || room.height * 0.58, 0.35, room.height - size.y * 0.5);
  } else {
    object.position.y += -box.min.y;
  }

  box = getObjectBounds(object);
  const center = box.getCenter(new THREE.Vector3());
  const distances = availableWalls()
    .map((wall) => ({ wall, value: distanceToWall(center, wall) }))
    .sort((a, b) => a.value - b.value);

  const nearest = distances[0].wall;
  object.userData.attachedWall = nearest;
  snapBackToWall(object, nearest);
  snapToWallEnds(object, nearest);
  snapToNearbyObject(object);
  clampObjectInsideRoom(object);

  if (object.userData.isOpening && snapMode === "wall") {
    updateWallOpeningFromObject(object, nearest);
  }
}

function updateWallOpeningFromObject(object, wallId) {
  const bounds = getObjectBounds(object);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const holeId = object.uuid;

  const centerU = (wallId === "back" || wallId === "front") ? center.x : center.z;
  const centerV = center.y;
  const width = (wallId === "back" || wallId === "front") ? size.x : size.z;
  const height = size.y;

  openingsByWall[wallId] = (openingsByWall[wallId] || []).filter((h) => h.id !== holeId);
  openingsByWall[wallId].push({
    id: holeId,
    centerU,
    centerV,
    width: Math.max(0.2, width),
    height: Math.max(0.2, height)
  });
  rebuildWall(wallId);
  setStatus("تم قص فتحة من الجدار حسب قياس الباب/الشباك");
}

function availableWalls() {
  return [
    "back",
    ...(room.walls >= 4 ? ["front"] : []),
    ...(room.walls >= 2 ? ["right"] : []),
    ...(room.walls >= 3 ? ["left"] : [])
  ];
}

function wallInnerPlane(wall) {
  if (wall === "back") return -room.depth / 2 + WALL_THICKNESS / 2;
  if (wall === "front") return room.depth / 2 - WALL_THICKNESS / 2;
  if (wall === "right") return room.width / 2 - WALL_THICKNESS / 2;
  return -room.width / 2 + WALL_THICKNESS / 2;
}

function distanceToWall(point, wall) {
  const plane = wallInnerPlane(wall);
  if (wall === "back" || wall === "front") return Math.abs(point.z - plane);
  return Math.abs(point.x - plane);
}

function snapBackToWall(object, wall) {
  if (wall === "back") object.rotation.y = 0;
  if (wall === "front") object.rotation.y = Math.PI;
  if (wall === "right") object.rotation.y = -Math.PI / 2;
  if (wall === "left") object.rotation.y = Math.PI / 2;

  const plane = wallInnerPlane(wall);
  const box = getObjectBounds(object);
  if (wall === "back") object.position.z += plane + WALL_CLEARANCE - box.min.z;
  if (wall === "front") object.position.z += plane - WALL_CLEARANCE - box.max.z;
  if (wall === "right") object.position.x += plane - WALL_CLEARANCE - box.max.x;
  if (wall === "left") object.position.x += plane + WALL_CLEARANCE - box.min.x;
}

function clampObjectInsideRoom(object) {
  const box = getObjectBounds(object);
  const minX = -room.width / 2 + WALL_THICKNESS / 2;
  const maxX = room.width / 2 - WALL_THICKNESS / 2;
  const minZ = -room.depth / 2 + WALL_THICKNESS / 2;
  const maxZ = room.depth / 2 - WALL_THICKNESS / 2;
  const move = new THREE.Vector3();
  if (box.min.x < minX) move.x = minX - box.min.x;
  if (box.max.x > maxX) move.x = maxX - box.max.x;
  if (box.min.z < minZ) move.z = minZ - box.min.z;
  if (box.max.z > maxZ) move.z = maxZ - box.max.z;
  object.position.add(move);
}

function snapToWallEnds(object, wall) {
  const box = getObjectBounds(object);
  const target = box.clone();
  if (wall === "back" || wall === "front") {
    if (Math.abs(box.min.x + room.width / 2) <= EDGE_SNAP_DISTANCE) {
      target.translate(new THREE.Vector3(-room.width / 2 - box.min.x, 0, 0));
    } else if (Math.abs(room.width / 2 - box.max.x) <= EDGE_SNAP_DISTANCE) {
      target.translate(new THREE.Vector3(room.width / 2 - box.max.x, 0, 0));
    }
  } else if (wall === "left" || wall === "right") {
    if (Math.abs(box.min.z + room.depth / 2) <= EDGE_SNAP_DISTANCE) {
      target.translate(new THREE.Vector3(0, 0, -room.depth / 2 - box.min.z));
    } else if (Math.abs(room.depth / 2 - box.max.z) <= EDGE_SNAP_DISTANCE) {
      target.translate(new THREE.Vector3(0, 0, room.depth / 2 - box.max.z));
    }
  }
  moveObjectToBox(object, box, target);
}

function snapToNearbyObject(object) {
  let box = getObjectBounds(object);
  for (const other of itemGroup.children) {
    if (other === object) continue;
    const otherBox = getObjectBounds(other);
    const xOverlap = box.max.x > otherBox.min.x && box.min.x < otherBox.max.x;
    const zOverlap = box.max.z > otherBox.min.z && box.min.z < otherBox.max.z;
    const candidates = [];

    if (zOverlap) {
      candidates.push({ axis: "x", delta: otherBox.min.x - box.max.x, distance: Math.abs(otherBox.min.x - box.max.x) });
      candidates.push({ axis: "x", delta: otherBox.max.x - box.min.x, distance: Math.abs(otherBox.max.x - box.min.x) });
    }
    if (xOverlap) {
      candidates.push({ axis: "z", delta: otherBox.min.z - box.max.z, distance: Math.abs(otherBox.min.z - box.max.z) });
      candidates.push({ axis: "z", delta: otherBox.max.z - box.min.z, distance: Math.abs(otherBox.max.z - box.min.z) });
    }

    const match = candidates
      .filter((candidate) => candidate.distance <= OBJECT_SNAP_DISTANCE)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!match) continue;

    if (match.axis === "x") object.position.x += match.delta;
    if (match.axis === "z") object.position.z += match.delta;

    box = getObjectBounds(object);
    if (match.axis === "x") {
      if (Math.abs(box.min.z - otherBox.min.z) <= FACE_ALIGN_DISTANCE) object.position.z += otherBox.min.z - box.min.z;
      else if (Math.abs(box.max.z - otherBox.max.z) <= FACE_ALIGN_DISTANCE) object.position.z += otherBox.max.z - box.max.z;
    } else {
      if (Math.abs(box.min.x - otherBox.min.x) <= FACE_ALIGN_DISTANCE) object.position.x += otherBox.min.x - box.min.x;
      else if (Math.abs(box.max.x - otherBox.max.x) <= FACE_ALIGN_DISTANCE) object.position.x += otherBox.max.x - box.max.x;
    }
    setStatus(`تمت مغنطة ${object.name} مع ${other.name}`);
    return;
  }
}

function duplicateSelected() {
  if (!selected) {
    setStatus("اختر عنصرًا أولًا");
    return;
  }
  const clone = selected.clone(true);
  clone.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      obj.material = Array.isArray(obj.material)
        ? obj.material.map((material) => material.clone())
        : obj.material.clone();
    }
  });
  clone.position.x += 0.25;
  clone.position.z += 0.25;
  clone.name = `${selected.name} نسخة`;
  itemGroup.add(clone);
  selectItem(clone);
  setStatus("تم نسخ العنصر");
}

function deleteSelected() {
  if (!selected) {
    setStatus("اختر عنصرًا للحذف");
    return;
  }
  const doomed = selected;
  selectItem(null);
  itemGroup.remove(doomed);
  disposeObject(doomed);
  setStatus("تم حذف العنصر");
}

function dimensionsInCm(object) {
  const size = getObjectBounds(object).getSize(new THREE.Vector3());
  return {
    width: Math.round(size.x * 100),
    height: Math.round(size.y * 100),
    depth: Math.round(size.z * 100)
  };
}

function updateResizeInputs() {
  if (!selected) return;
  const dims = dimensionsInCm(selected);
  resizeWidthInput.value = dims.width;
  resizeHeightInput.value = dims.height;
  resizeDepthInput.value = dims.depth;
}

function openResizePanel() {
  if (!selected) {
    setStatus("اختر كابينة أولًا");
    return;
  }
  materialPanel.classList.remove("open");
  updateResizeInputs();
  resizePanel.classList.add("open");
  updateItemHudPosition();
}

function applySelectedResize() {
  if (!selected) {
    resizePanel.classList.remove("open");
    setStatus("اختر كابينة أو عنصرًا أولًا");
    return;
  }

  const target = {
    x: Math.max(Number(resizeWidthInput.value) || 1, 1) / 100,
    y: Math.max(Number(resizeHeightInput.value) || 1, 1) / 100,
    z: Math.max(Number(resizeDepthInput.value) || 1, 1) / 100
  };
  const before = getObjectBounds(selected);
  const beforeSize = before.getSize(new THREE.Vector3());
  const beforeCenter = before.getCenter(new THREE.Vector3());

  selected.scale.x *= target.x / Math.max(beforeSize.x, 0.001);
  selected.scale.y *= target.y / Math.max(beforeSize.y, 0.001);
  selected.scale.z *= target.z / Math.max(beforeSize.z, 0.001);

  const after = getObjectBounds(selected);
  const afterCenter = after.getCenter(new THREE.Vector3());
  selected.position.x += beforeCenter.x - afterCenter.x;
  selected.position.z += beforeCenter.z - afterCenter.z;
  selected.position.y += before.min.y - after.min.y;

  if (snapEnabled) snapObject(selected);
  selectionBox.setFromObject(selected);
  updateResizeInputs();
  setStatus("تم تغيير مقاس الكابينة المحددة");
}

function clearItems() {
  selectItem(null);
  clearGroup(itemGroup);
  setStatus("تم مسح العناصر فقط");
}

function nudgeSelected(action) {
  if (!selected) {
    setStatus("اختر عنصرًا أولًا");
    return;
  }
  const step = 0.12;
  if (action === "forward") selected.position.z -= step;
  if (action === "backward") selected.position.z += step;
  if (action === "left") selected.position.x -= step;
  if (action === "right") selected.position.x += step;
  if (action === "up") selected.position.y += step;
  if (action === "down") selected.position.y -= step;
  if (snapEnabled && action !== "up" && action !== "down") snapObject(selected);
  selectionBox.setFromObject(selected);
}

function showRenderOverlay(show) {
  if (!renderOverlay) return;
  renderOverlay.hidden = !show;
}

function updateRenderOverlay(samples, total, message) {
  if (renderProgress) {
    renderProgress.value = String(Math.min(100, Math.round((samples / Math.max(total, 1)) * 100)));
  }
  if (renderProgressLabel) renderProgressLabel.textContent = message;
}

async function prepareSceneForPathTrace() {
  transform.detach();
  selectionBox.visible = false;
  itemHud.hidden = true;
  controls.enabled = false;
  await ensureStudioEnvironment();
  applyPhotorealLighting();
  updateHdrSceneVisuals(true);
}

function restoreSceneAfterPathTrace(prev) {
  endPhotorealLighting();
  controls.enabled = true;
  itemHud.hidden = prev.hudHidden;
  if (prev.transformAttached) {
    transform.attach(prev.transformAttached);
    selectionBox.visible = prev.selectionVisible;
  }
  const previewUrl = room.hdrUrl || hdrCatalog[0]?.url || "";
  if (previewUrl) applyHdrEnvironment(previewUrl, { save: false, forStudio: false });
  else applyFallbackEnvironment();
  renderer.render(scene, camera);
}

function downloadRenderPng(dataUrl, prefix = "kitchen-render") {
  if (!dataUrl || !dataUrl.startsWith("data:image")) {
    throw new Error("empty_render");
  }
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${prefix}-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function captureStudioRender() {
  let dataUrl = "";
  await withHighQualityCapture((url) => {
    dataUrl = url;
  });
  return dataUrl;
}

async function capturePathTraceRender() {
  const mod = await import("./path-tracer-render.js");
  return mod.capturePathTracedImage({
    renderer,
    scene,
    camera,
    viewport,
    hideObjects: [transform],
    prepareScene: prepareSceneForPathTrace,
    shouldAbort: () => pathTraceAbort,
    targetSamples: 140,
    maxDimension: 2560,
    onProgress: (samples, total, message) => {
      updateRenderOverlay(samples, total, message);
      setStatus(message);
    }
  });
}

async function exportImageForAiHub() {
  setStatus("جاري تجهيز الصورة لرندر AI...");
  let dataUrl = "";
  try {
    dataUrl = await captureStudioRender();
  } catch (error) {
    console.warn("Studio capture failed, using viewport snapshot", error);
    renderer.render(scene, camera);
    dataUrl = renderer.domElement.toDataURL("image/png", 1.0);
  }

  if (!dataUrl?.startsWith("data:image/")) {
    throw new Error("empty_capture");
  }
  sessionStorage.setItem("kitchenAiSource", dataUrl);
  sessionStorage.setItem("kitchenAiSourceAt", String(Date.now()));
  return dataUrl;
}

async function openAiRenderHub() {
  if (pathTraceActive) return;
  try {
    await exportImageForAiHub();
    window.location.href = "/designer/ai";
  } catch (error) {
    console.error(error);
    setStatus("تعذر تجهيز الصورة — جرّب «رندر فوتوغرافي» أولًا ثم «رندر AI»");
  }
}

async function renderShot() {
  if (pathTraceActive) return;
  if (!(await ensureCanRender())) return;

  const prev = {
    transformAttached: selected,
    selectionVisible: selectionBox.visible,
    hudHidden: itemHud.hidden
  };

  pathTraceActive = true;
  pathTraceAbort = false;
  showRenderOverlay(true);
  updateRenderOverlay(0, 140, "جاري رندر فوتوغرافي...");
  setStatus("جاري الرندر الفوتوغرافي — انتظر حتى يكتمل الشريط");

  const finish = () => {
    pathTraceActive = false;
    showRenderOverlay(false);
    restoreSceneAfterPathTrace(prev);
  };

  let renderMode = "studio";

  try {
    let dataUrl = null;

    if (renderer.capabilities.isWebGL2 && !pathTraceAbort) {
      try {
        updateRenderOverlay(0, 140, "جاري تحميل محرك الرندر الفوتوغرافي...");
        dataUrl = await capturePathTraceRender();
        renderMode = "pathtrace";
      } catch (pathError) {
        console.warn("Path tracing unavailable, using photoreal HDR+SSAO", pathError);
        if (pathTraceAbort) {
          setStatus("تم إلغاء الرندر");
          return;
        }
        updateRenderOverlay(0, 100, "رندر فوتوغرافي (HDR + ظلال ناعمة)...");
        setStatus("محرك الأشعة غير متاح — رندر فوتوغرافي بديل...");
        dataUrl = await captureStudioRender();
        renderMode = "studio";
      }
    } else if (!pathTraceAbort) {
      updateRenderOverlay(0, 100, "رندر فوتوغرافي (HDR)...");
      dataUrl = await captureStudioRender();
    }

    if (pathTraceAbort) {
      setStatus("تم إلغاء الرندر");
      return;
    }

    downloadRenderPng(
      dataUrl,
      renderMode === "pathtrace" ? "kitchen-pathtrace" : "kitchen-studio"
    );
    await recordRenderUse();
    setStatus(
      renderMode === "pathtrace"
        ? "تم حفظ رندر فوتوغرافي (تتبع أشعة)"
        : "تم حفظ رندر فوتوغرافي (HDR + ظلال)"
    );
  } catch (error) {
    console.error(error);
    if (error?.message === "cancelled") {
      setStatus("تم إلغاء الرندر");
    } else {
      try {
        if (!pathTraceAbort) {
          setStatus("محاولة رندر احتياطي...");
          const fallback = await captureStudioRender();
          downloadRenderPng(fallback, "kitchen-studio");
          await recordRenderUse();
          setStatus("تم حفظ رندر استوديو (وضع احتياطي)");
        }
      } catch (fallbackError) {
        console.error(fallbackError);
        setStatus("تعذر إنشاء الرندر — تأكد من الإنترنت لتحميل المكتبات أو حدّث الصفحة");
      }
    }
  } finally {
    finish();
  }
}

function serializeAsset(category, item) {
  return JSON.stringify({
    ...item,
    kind: category.kind,
    target: category.target,
    snap: item.snap || category.snap,
    category: category.id
  });
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function renderCatalog() {
  catalogTabs.innerHTML = "";
  catalogList.innerHTML = "";
  if (!catalogCategories.length) {
    catalogList.innerHTML = `<div class="empty-state">لا توجد أقسام كتالوج متاحة.</div>`;
    return;
  }

  // Quick buttons define which list to show and where to apply materials.
  const quickToTarget = {
    "mat-floor": "floor",
    "mat-walls": "walls",
    "mat-ceiling": "ceiling",
    "mat-cabinets": "cabinet",
    "mat-metals": "metal"
  };

  const showModelCategories = (ids) => catalogCategories.filter((c) => c.kind !== "material" && ids.includes(c.id));
  const allMaterialItems = catalogCategories
    .filter((c) => c.kind === "material")
    .flatMap((c) => (c.items || []).map((i) => ({ ...i, kind: "material" })));

  const filteredMaterialItems = (target) => allMaterialItems.filter((i) => String(i.target || "") === target);

  let view = { title: "", kind: "", items: [] };
  if (activeQuick === "obj-floor") {
    view = {
      title: "كائنات أرضية",
      kind: "model-group",
      items: showModelCategories(["cabinets-lower", "cabinets-tall", "cabinets-corner", "worktops", "appliances", "accessories"])
        .flatMap((c) => (c.items || []).map((i) => ({ ...i, category: c.id, kind: "model" })))
    };
  } else if (activeQuick === "obj-upper") {
    view = {
      title: "كائنات علوية",
      kind: "model-group",
      items: showModelCategories(["cabinets-upper"])
        .flatMap((c) => (c.items || []).map((i) => ({ ...i, category: c.id, kind: "model" })))
    };
  } else if (activeQuick === "obj-double-upper") {
    // Optional group: if you create a folder later (or name items "دبل") it will appear here.
    const upper = showModelCategories(["cabinets-upper"])
      .flatMap((c) => (c.items || []).map((i) => ({ ...i, category: c.id, kind: "model" })))
      .filter((i) => /دبل|double/i.test(String(i.name || "")));
    view = { title: "دبل علوية", kind: "model-group", items: upper };
  } else if (activeQuick === "obj-accessories") {
    view = {
      title: "إكسسوارات",
      kind: "model-group",
      items: showModelCategories(["accessories"]).flatMap((c) => (c.items || []).map((i) => ({ ...i, category: c.id, kind: "model" })))
    };
  } else if (activeQuick === "obj-appliances") {
    view = {
      title: "كهربائيات",
      kind: "model-group",
      items: showModelCategories(["appliances"]).flatMap((c) => (c.items || []).map((i) => ({ ...i, category: c.id, kind: "model" })))
    };
  } else {
    const target = quickToTarget[activeQuick] || "floor";
    view = { title: "خامات", kind: "material", items: filteredMaterialItems(target).map((i) => ({ ...i, kind: "material", target })) };
    if (["floor", "walls", "ceiling", "cabinet", "metal"].includes(target)) {
      renderCustomColorPicker({ target, defaultColor: target === "cabinet" ? "#e8dcc8" : "#b8b8b8" });
    }
  }

  if (!view.items?.length) {
    catalogList.insertAdjacentHTML("beforeend", `<div class="empty-state">لا توجد عناصر هنا بعد.</div>`);
    return;
  }

  view.items.forEach((item) => {
    const card = document.createElement("button");
    const payload = JSON.stringify(item);
    const preview = item.url && item.type === "texture" ? `<img src="${escapeHTML(item.url)}" alt="">` : "";
    card.type = "button";
    card.className = "asset-card";
    card.draggable = true;
    card.innerHTML = `
      <span class="asset-thumb">${preview}</span>
      <span>
        <strong class="asset-name">${escapeHTML(item.name)}</strong>
        <span class="asset-meta">${item.kind === "material" ? "اضغط للتطبيق مباشرة" : "اسحبها إلى المشهد أو اضغط للإضافة"}</span>
      </span>
    `;
    if (item.color) {
      card.querySelector(".asset-thumb").style.background = item.color;
    }
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("application/json", payload);
      event.dataTransfer.effectAllowed = "copy";
    });
    card.addEventListener("click", () => {
      const asset = JSON.parse(payload);
      if (asset.kind === "material") {
        const target = quickToTarget[activeQuick] || asset.target || "floor";
        const finalAsset = { ...asset, kind: "material", target };
        applyMaterialToTarget(finalAsset, { applyToCategory: true });
      } else addModelAsset(asset);
      drawer.classList.remove("open");
    });
    catalogList.appendChild(card);
  });
}

function renderCustomColorPicker(category) {
  const defaultColors = {
    floor: room.floorColor,
    ceiling: room.ceilingColor,
    walls: room.wallColor,
    cabinet: "#e8dcc8",
    metal: "#9ca3af"
  };
  const wrapper = document.createElement("label");
  wrapper.className = "custom-color";
  wrapper.innerHTML = `
    <span>لون مخصص مباشر</span>
    <input type="color" value="${defaultColors[category.target] || "#ffffff"}">
  `;
  const input = wrapper.querySelector("input");
  input.addEventListener("input", () => {
    const asset = {
      name: "لون مخصص",
      type: "color",
      color: input.value,
      target: category.target,
      kind: "material"
    };
    if (category.target === "cabinet" || category.target === "metal") {
      if (!selected) {
        setStatus("اختر كابينة أولًا ثم اختر اللون");
        return;
      }
      openCabinetMaterialPanel();
      applyMaterialToSelectedCabinet(asset);
      return;
    }
    applyMaterialToTarget(asset, { applyToCategory: true });
  });
  catalogList.appendChild(wrapper);
}

async function loadCatalog() {
  try {
    const response = await fetch("/api/assets", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const incoming = data.categories || [];
    const modelCats = incoming.filter((c) => c.kind !== "material");
    const materialCats = incoming.filter((c) => c.kind === "material");
    const roomMaterialCats = materialCats.filter((c) => ["floor", "walls", "ceiling"].includes(String(c.target)));
    const cabinetMatCat = materialCats.find((c) => String(c.target) === "cabinet");
    const metalMatCat = materialCats.find((c) => String(c.target) === "metal");

    const mergedMaterialItems = [];
    roomMaterialCats.forEach((cat) => {
      (cat.items || []).forEach((item) => {
        mergedMaterialItems.push({ ...item, target: cat.target });
      });
    });
    builtInMaterialCategories.forEach((cat) => {
      (cat.items || []).forEach((item) => {
        mergedMaterialItems.push({ ...item, target: cat.target });
      });
    });

    const mergedMaterialsCategory = {
      id: "materials-all",
      title: "الخامات (جدران/أرضية/سقف)",
      kind: "material",
      items: mergedMaterialItems
    };

    const cabinetItems = [
      ...builtInCabinetColors,
      ...(cabinetMatCat?.items || []).map((i) => ({ ...i, target: "cabinet" }))
    ];
    const cabinetCategory = {
      id: cabinetMatCat?.id || "materials-cabinets",
      title: cabinetMatCat?.title || "خامات الكابينات",
      kind: "material",
      target: "cabinet",
      items: cabinetItems
    };
    const metalCategory = metalMatCat
      ? { ...metalMatCat, items: (metalMatCat.items || []).map((i) => ({ ...i, target: "metal" })) }
      : { id: "materials-metals", title: "خامات المعادن", kind: "material", target: "metal", items: [] };

    catalogCategories = [...modelCats, mergedMaterialsCategory, cabinetCategory, metalCategory];
  } catch (error) {
    console.error(error);
    const mergedMaterialItems = [];
    builtInMaterialCategories.forEach((cat) => {
      (cat.items || []).forEach((item) => mergedMaterialItems.push({ ...item, target: cat.target }));
    });
    catalogCategories = [{
      id: "materials-all",
      title: "الخامات (جدران/أرضية/سقف)",
      kind: "material",
      items: mergedMaterialItems
    },
    { id: "materials-cabinets", title: "خامات الكابينات", kind: "material", target: "cabinet", items: [...builtInCabinetColors] },
    { id: "materials-metals", title: "خامات المعادن", kind: "material", target: "metal", items: [] }
    ];
    setStatus("تعذر قراءة ملفات الكتالوج، تم تحميل الخامات الأساسية فقط");
  }
  renderCatalog();
}

function setActiveQuick(key) {
  activeQuick = key;
  // highlight primary menu button
  const isMat = String(key || "").startsWith("mat-");
  materialsMenuBtn?.classList.toggle("active", isMat);
  objectsMenuBtn?.classList.toggle("active", !isMat);
  renderCatalog();
}

async function createOrder() {
  try {
    setStatus("جاري حفظ الأوردر مع رندر استوديو...");
    let snapshotDataUrl = "";
    await withHighQualityCapture((dataUrl) => {
      snapshotDataUrl = dataUrl;
    });

    const items = itemGroup.children.map((obj) => {
      const box = getObjectBounds(obj);
      const size = box.getSize(new THREE.Vector3());
      return {
        name: obj.name,
        asset: obj.userData.asset || {},
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotationY: obj.rotation.y,
        size: { x: size.x, y: size.y, z: size.z },
        isOpening: Boolean(obj.userData.isOpening),
        attachedWall: obj.userData.attachedWall || ""
      };
    });

    const payload = {
      title: `Order ${new Date().toLocaleString("ar")}`,
      createdAt: new Date().toISOString(),
      customer: {},
      room,
      scene: { items, openingsByWall },
      snapshotDataUrl
    };

    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    setStatus("تم إنشاء الأوردر وحفظ الرندر");
  } catch (e) {
    console.error(e);
    setStatus("تعذر حفظ الأوردر");
  }
}

function handleCanvasPointerDown(event) {
  if (event.target !== renderer.domElement) return;
  pointerFromEvent(event);
  const itemHits = raycaster.intersectObjects(itemGroup.children, true);
  if (itemHits.length) {
    let root = itemHits[0].object;
    while (root.parent && root.parent !== itemGroup) root = root.parent;
    const hitMesh = itemHits.find((hit) => hit.object?.isMesh)?.object || null;
    selectItem(root);
    if (event.shiftKey && pendingCabinetMaterial && hitMesh) {
      applyMaterialToCabinetMeshes([hitMesh], pendingCabinetMaterial, "picked");
      setStatus(`تم تطبيق ${pendingCabinetMaterial.name} على: ${hitMesh.name || "جزء الكابينة"}`);
    }
    return;
  }

  const surfaceHits = raycaster.intersectObjects(selectableSurfaces, false);
  if (surfaceHits.length) {
    const surface = surfaceHits[0].object;
    selectSurface(surface);
    if (activeBrushMaterial?.kind === "material") {
      applyMaterialToTarget(activeBrushMaterial, { surfaceMesh: surface, applyToCategory: false });
    }
    return;
  }
  selectItem(null);
}

function handleDrop(event) {
  event.preventDefault();
  const payload = event.dataTransfer.getData("application/json");
  if (!payload) return;
  const asset = JSON.parse(payload);
  const { point, surface } = getDropPoint(event);
  if (asset.kind === "material") {
    // If it's a cabinet/metal material, apply to the cabinet under pointer (or selected).
    if (isCabinetOrModelMaterial(asset)) {
      const item = pickItemUnderPointer(event) || selected;
      if (item) {
        selectItem(item);
        openCabinetMaterialPanel();
        applyMaterialToSelectedCabinet(asset);
      } else {
        setStatus("اسحب خامة الكابينات على كابينة داخل المشهد");
      }
      return;
    }
    if (surface) selectSurface(surface);
    applyMaterialToTarget(asset, { surfaceMesh: surface || null, applyToCategory: !surface });
    return;
  }
  addModelAsset(asset, point);
}

function resize() {
  const { clientWidth, clientHeight } = viewport;
  camera.aspect = clientWidth / Math.max(clientHeight, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight, false);
}

function animate() {
  controls.update();
  if (selected) {
    selectionBox.setFromObject(selected);
    updateItemHudPosition();
  }
  if (!pathTraceActive) {
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
}

document.getElementById("drawerToggle").addEventListener("click", () => {
  closeOverflowMenu();
  drawer.classList.add("open");
});
document.getElementById("drawerClose").addEventListener("click", () => drawer.classList.remove("open"));
document.getElementById("renderShot").addEventListener("click", renderShot);
fetchRenderQuota().then(updateRenderQuotaUI);
document.getElementById("openAiRender")?.addEventListener("click", openAiRenderHub);
renderCancelBtn?.addEventListener("click", () => {
  pathTraceAbort = true;
});
document.getElementById("clearItems").addEventListener("click", clearItems);
document.getElementById("resizeClose").addEventListener("click", () => resizePanel.classList.remove("open"));
document.getElementById("resizeApply").addEventListener("click", applySelectedResize);
document.getElementById("materialClose").addEventListener("click", closeMaterialPanel);
materialTargetSelect.addEventListener("change", () => syncMaterialPanelFromRoom(materialTargetSelect.value));
document.getElementById("materialApply").addEventListener("click", applyMaterialProps);

moreMenuBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleOverflowMenu();
});
menuMaterial.addEventListener("click", () => openMaterialPanel());
menuWalls.addEventListener("click", () => toggleWalls());
menuOrder.addEventListener("click", () => {
  closeOverflowMenu();
  createOrder();
});

hdrSelect?.addEventListener("change", async () => {
  closeOverflowMenu();
  await applyHdrEnvironment(hdrSelect.value, { save: true });
});

hdrShowBg?.addEventListener("change", applyHdrSettingsFromUi);
hdrEnvIntensity?.addEventListener("input", applyHdrSettingsFromUi);
hdrBgIntensity?.addEventListener("input", applyHdrSettingsFromUi);

hudResize.addEventListener("click", (event) => {
  event.stopPropagation();
  openResizePanel();
});
hudCabinetMat?.addEventListener("click", (event) => {
  event.stopPropagation();
  openCabinetMaterialPanel();
});
hudRotate45.addEventListener("click", (event) => {
  event.stopPropagation();
  rotateSelectedByDegrees(45);
});
hudRotate90.addEventListener("click", (event) => {
  event.stopPropagation();
  rotateSelectedByDegrees(90);
});
hudDelete.addEventListener("click", (event) => {
  event.stopPropagation();
  deleteSelected();
});

cabinetMatClose?.addEventListener("click", closeCabinetMaterialPanel);
cabinetMatRegion?.addEventListener("change", () => {
  if (pendingCabinetMaterial) applyMaterialToSelectedCabinet(pendingCabinetMaterial);
});
cabinetUvScale?.addEventListener("input", reapplyCabinetUv);
cabinetUvU?.addEventListener("input", reapplyCabinetUv);
cabinetUvV?.addEventListener("input", reapplyCabinetUv);

document.getElementById("snapToggle").addEventListener("click", (event) => {
  snapEnabled = !snapEnabled;
  event.currentTarget.setAttribute("aria-pressed", String(snapEnabled));
  event.currentTarget.textContent = snapEnabled ? "مغنطة" : "بدون مغنطة";
  if (snapEnabled && selected) snapObject(selected);
});

function toggleMenu(which) {
  const openMaterials = which === "materials" ? materialsMenu.hasAttribute("hidden") : false;
  const openObjects = which === "objects" ? objectsMenu.hasAttribute("hidden") : false;
  materialsMenu.toggleAttribute("hidden", !(which === "materials" && openMaterials));
  objectsMenu.toggleAttribute("hidden", !(which === "objects" && openObjects));
  materialsMenuBtn?.setAttribute("aria-expanded", String(which === "materials" && openMaterials));
  objectsMenuBtn?.setAttribute("aria-expanded", String(which === "objects" && openObjects));
}

materialsMenuBtn?.addEventListener("click", () => toggleMenu("materials"));
objectsMenuBtn?.addEventListener("click", () => toggleMenu("objects"));

materialsMenu?.querySelectorAll("[data-quick]")?.forEach((btn) => {
  btn.addEventListener("click", () => {
    materialsMenu.setAttribute("hidden", "");
    materialsMenuBtn?.setAttribute("aria-expanded", "false");
    setActiveQuick(btn.dataset.quick);
  });
});
objectsMenu?.querySelectorAll("[data-quick]")?.forEach((btn) => {
  btn.addEventListener("click", () => {
    objectsMenu.setAttribute("hidden", "");
    objectsMenuBtn?.setAttribute("aria-expanded", "false");
    setActiveQuick(btn.dataset.quick);
  });
});

document.addEventListener("click", (event) => {
  if (!overflowMenu.contains(event.target) && event.target !== moreMenuBtn) {
    closeOverflowMenu();
  }
});

renderer.domElement.addEventListener("pointerdown", handleCanvasPointerDown);
renderer.domElement.addEventListener("dragover", (event) => event.preventDefault());
renderer.domElement.addEventListener("drop", handleDrop);
window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === "Delete" || event.key === "Backspace") deleteSelected();
  if (event.key === "ArrowUp") nudgeSelected("forward");
  if (event.key === "ArrowDown") nudgeSelected("backward");
  if (event.key === "ArrowLeft") nudgeSelected("left");
  if (event.key === "ArrowRight") nudgeSelected("right");
});

buildRoom();
loadCatalog();
loadHdrCatalog();
initDraggableCabinetPanel();
resize();
animate();
