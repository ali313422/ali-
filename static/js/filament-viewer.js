(() => {
  const canvas = document.getElementById("filamentCanvas");
  const status = document.getElementById("filamentStatus");
  if (!canvas || !status) return;

  function set(text) {
    status.textContent = text;
  }

  if (typeof Filament === "undefined") {
    set("لم يتم العثور على Filament. ضع الملفات داخل static/filament/ (filament.js + filament.wasm + ملفات gltfio/IBL).");
    return;
  }

  set("جاري تهيئة Filament...");

  // Filament on web is async init; needs the list of assets it should fetch (at least wasm).
  // This stub keeps the page ready; once you add Filament distribution to /static/filament/,
  // you can expand to load GLB/GLTF from your /models/ catalog.
  try {
    Filament.init([], () => {
      set("Filament جاهز. الخطوة التالية: ربط تحميل موديل GLB/GLTF من كتالوج /api/assets داخل هذه الصفحة.");
      // eslint-disable-next-line no-new
      const engine = Filament.Engine.create(canvas);
      const scene = engine.createScene();
      const swapChain = engine.createSwapChain();
      const renderer = engine.createRenderer();
      const view = engine.createView();
      const cameraEntity = Filament.EntityManager.get().create();
      const camera = engine.createCamera(cameraEntity);
      view.setCamera(camera);
      view.setScene(scene);

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.floor(canvas.clientWidth * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        canvas.width = w;
        canvas.height = h;
        view.setViewport([0, 0, w, h]);
        camera.setProjectionFov(45, w / Math.max(h, 1), 0.1, 1000, Filament.Camera$Fov.VERTICAL);
      };
      window.addEventListener("resize", resize);
      resize();

      const render = () => {
        if (renderer.beginFrame(swapChain)) {
          renderer.render(view);
          renderer.endFrame();
        }
        window.requestAnimationFrame(render);
      };
      window.requestAnimationFrame(render);
    });
  } catch (e) {
    console.error(e);
    set("حصل خطأ أثناء تهيئة Filament. تأكد من وجود filament.js و filament.wasm في static/filament/.");
  }
})();

