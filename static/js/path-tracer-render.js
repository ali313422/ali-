import { WebGLPathTracer, BlurredEnvMapGenerator, DenoiseMaterial } from "three-gpu-pathtracer";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import * as THREE from "three";

const DEFAULT_SAMPLES = 140;
const DEFAULT_BOUNCES = 12;

function denoisePathTracerFrame(renderer, pathTracer) {
  const w = renderer.domElement.width;
  const h = renderer.domElement.height;
  if (!w || !h || !pathTracer?.target?.texture) {
    return renderer.domElement.toDataURL("image/png", 1.0);
  }

  try {
    const denoiseMat = new DenoiseMaterial();
    denoiseMat.map = pathTracer.target.texture;
    denoiseMat.sigma = 4.2;
    denoiseMat.threshold = 0.025;
    denoiseMat.kSigma = 1.1;
    denoiseMat.needsUpdate = true;

    const quad = new FullScreenQuad(denoiseMat);
    const buffer = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat
    });

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(buffer);
    quad.render(renderer);
    renderer.setRenderTarget(prevTarget);

    const readCanvas = document.createElement("canvas");
    readCanvas.width = w;
    readCanvas.height = h;
    const ctx = readCanvas.getContext("2d");
    const pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(buffer, 0, 0, w, h, pixels);

    const imageData = ctx.createImageData(w, h);
    for (let y = 0; y < h; y += 1) {
      const row = h - 1 - y;
      for (let x = 0; x < w; x += 1) {
        const src = (row * w + x) * 4;
        const dst = (y * w + x) * 4;
        imageData.data[dst] = pixels[src];
        imageData.data[dst + 1] = pixels[src + 1];
        imageData.data[dst + 2] = pixels[src + 2];
        imageData.data[dst + 3] = pixels[src + 3];
      }
    }
    ctx.putImageData(imageData, 0, 0);

    quad.dispose();
    denoiseMat.dispose();
    buffer.dispose();

    return readCanvas.toDataURL("image/png", 1.0);
  } catch (error) {
    console.warn("Denoise export failed, using raw buffer", error);
    pathTracer.renderToCanvas = true;
    pathTracer.renderSample();
    return renderer.domElement.toDataURL("image/png", 1.0);
  }
}

/**
 * Progressive GPU path-traced capture — photoreal (no cartoon raster pass).
 */
export async function capturePathTracedImage({
  renderer,
  scene,
  camera,
  viewport,
  hideObjects = [],
  prepareScene,
  onProgress,
  shouldAbort,
  targetSamples = DEFAULT_SAMPLES,
  maxDimension = 2560
}) {
  if (!renderer.capabilities.isWebGL2) {
    throw new Error("webgl2_required");
  }

  const cw = viewport.clientWidth;
  const ch = viewport.clientHeight;
  const aspect = cw / Math.max(ch, 1);
  const scale = Math.min(2.5, maxDimension / Math.max(cw, ch, 1));
  const rw = Math.floor(cw * scale);
  const rh = Math.floor(ch * scale);

  const prev = {
    size: renderer.getSize(new THREE.Vector2()),
    ratio: renderer.getPixelRatio(),
    exposure: renderer.toneMappingExposure,
    toneMapping: renderer.toneMapping,
    fog: scene.fog,
    background: scene.background,
    environment: scene.environment,
    environmentIntensity: scene.environmentIntensity,
    backgroundIntensity: scene.backgroundIntensity,
    backgroundBlurriness: scene.backgroundBlurriness,
    hidden: []
  };

  const hideForRender = (obj) => {
    if (!obj || obj.visible === false) return;
    prev.hidden.push(obj);
    obj.visible = false;
  };

  hideObjects.forEach(hideForRender);
  scene.traverse((obj) => {
    if (obj.type === "BoxHelper" || obj.isLine || obj.isLineSegments || obj.type === "GridHelper") {
      hideForRender(obj);
    }
  });

  scene.fog = null;
  renderer.setPixelRatio(1);
  renderer.setSize(rw, rh, false);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;

  let pathTracer = null;
  let blurredEnv = null;
  let envGenerator = null;
  let restoredBackground = null;

  try {
    if (prepareScene) await prepareScene();

    pathTracer = new WebGLPathTracer(renderer);
    pathTracer.bounces = DEFAULT_BOUNCES;
    pathTracer.renderScale = 1;
    pathTracer.tiles.set(3, 3);
    pathTracer.filterGlossyFactor = 0.18;
    pathTracer.renderToCanvas = false;
    pathTracer.rasterizeScene = false;
    pathTracer.minSamples = 3;
    pathTracer.fadeDuration = 0;
    pathTracer.renderDelay = 0;

    if (scene.background?.isTexture && scene.background.image) {
      envGenerator = new BlurredEnvMapGenerator(renderer);
      blurredEnv = envGenerator.generate(scene.background, 0.12);
      restoredBackground = scene.background;
      scene.background = blurredEnv;
    }

    onProgress?.(0, targetSamples, "جاري تحضير رندر فوتوغرافي...");
    try {
      pathTracer.setScene(scene, camera);
    } catch (sceneError) {
      console.error(sceneError);
      throw new Error("scene_setup_failed");
    }
    pathTracer.updateLights();
    pathTracer.updateEnvironment();
    pathTracer.reset();

    await accumulateSamples(pathTracer, targetSamples, onProgress, shouldAbort);
    onProgress?.(targetSamples, targetSamples, "تنعيم الصورة النهائية...");

    return denoisePathTracerFrame(renderer, pathTracer);
  } finally {
    if (restoredBackground) scene.background = restoredBackground;
    blurredEnv?.dispose?.();
    envGenerator?.dispose?.();
    pathTracer?.dispose?.();

    prev.hidden.forEach((obj) => {
      obj.visible = true;
    });
    scene.fog = prev.fog;
    scene.background = prev.background;
    scene.environment = prev.environment;
    scene.environmentIntensity = prev.environmentIntensity;
    if ("backgroundIntensity" in scene) scene.backgroundIntensity = prev.backgroundIntensity;
    if ("backgroundBlurriness" in scene) scene.backgroundBlurriness = prev.backgroundBlurriness;
    renderer.setPixelRatio(prev.ratio);
    renderer.setSize(prev.size.x, prev.size.y, false);
    renderer.toneMappingExposure = prev.exposure;
    renderer.toneMapping = prev.toneMapping;
    camera.aspect = cw / Math.max(ch, 1);
    camera.updateProjectionMatrix();
  }
}

function accumulateSamples(pathTracer, targetSamples, onProgress, shouldAbort) {
  return new Promise((resolve, reject) => {
    let stalled = 0;
    let lastSamples = -1;

    const tick = () => {
      if (shouldAbort?.()) {
        reject(new Error("cancelled"));
        return;
      }

      try {
        pathTracer.renderSample();
      } catch (renderError) {
        console.error(renderError);
        reject(new Error("render_sample_failed"));
        return;
      }

      const samples = Math.floor(pathTracer.samples || 0);
      onProgress?.(samples, targetSamples, `رندر فوتوغرافي: ${samples} / ${targetSamples}`);

      if (samples >= targetSamples) {
        resolve();
        return;
      }

      if (samples === lastSamples) {
        stalled += 1;
        if (stalled > 240) {
          reject(new Error("render_stalled"));
          return;
        }
      } else {
        stalled = 0;
        lastSamples = samples;
      }

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
