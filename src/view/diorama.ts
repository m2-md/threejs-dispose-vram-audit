// view/diorama.ts — Ölçümden BAĞIMSIZ sinematik sahne.
// Bu renderer ölçüm renderer'ından (main.ts'teki gerçek WebGLRenderer) AYRIDIR;
// kendi WebGL context'i vardır. Bu yüzden diorama'nın geometri/doku sayısı,
// naif döngünün `renderer.info.memory` sayaçlarına DOKUNMAZ → geometries drift = 1600 korunur.
//
// Görevi tek: makalede denetlenen 8 mesh'lik seviyeyi "dark cinematic + neon glow"
// bir diorama gibi göstermek. Işık/kamera/zemin/bloom burada; kaynak sayısı umurunda değil.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { TextureCache } from "../texture-cache";
import { buildLevel } from "../level-factory";

// Neon accent paleti — cyan / violet / magenta döngüsü.
const NEON = [0x22d3ee, 0xa78bfa, 0xf472b6, 0x34d399, 0x38bdf8, 0xc084fc];

export interface Diorama {
  dispose(): void;
}

export function createDiorama(container: HTMLElement): Diorama {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const size = () => ({
    w: Math.max(1, container.clientWidth),
    h: Math.max(1, container.clientHeight),
  });
  let { w, h } = size();
  renderer.setSize(w, h);
  renderer.setClearColor(0x05060b, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x080a11, 0.055);

  // RoomEnvironment + PMREM → yumuşak IBL. Harici HDR dosyası YOK (bundled).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;

  const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
  camera.position.set(4.6, 3.4, 6.4);
  camera.lookAt(0, 0.4, 0);

  // Anahtar ışık (key) — soğuk beyaz, gölge kaynağı.
  const key = new THREE.DirectionalLight(0xdfefff, 2.6);
  key.position.set(6, 9, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.0008;
  key.shadow.radius = 6;
  scene.add(key);

  // Neon dolgu (fill) ışıkları — sahneye cyan/violet renk sızdırır.
  const cyanFill = new THREE.PointLight(0x22d3ee, 26, 22, 2);
  cyanFill.position.set(-5, 2.2, 3.5);
  scene.add(cyanFill);
  const violetFill = new THREE.PointLight(0xa78bfa, 20, 22, 2);
  violetFill.position.set(4.5, 1.4, -4);
  scene.add(violetFill);
  scene.add(new THREE.HemisphereLight(0x1a2740, 0x05060b, 0.35));

  // Gölgeli zemin — hafif metalik, çevreyi yansıtan koyu düzlem.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(16, 96),
    new THREE.MeshStandardMaterial({
      color: 0x0a0e17,
      roughness: 0.32,
      metalness: 0.85,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  // Zemin ızgarası — ince neon çizgiler, derinlik hissi.
  const grid = new THREE.GridHelper(28, 56, 0x22d3ee, 0x141c2b);
  const gm = grid.material as THREE.Material;
  gm.transparent = true;
  gm.opacity = 0.16;
  grid.position.y = 0;
  scene.add(grid);

  // --- Denetlenen seviye: gerçek buildLevel ile 8 mesh (ayrı cache/context). ---
  const cache = new TextureCache();
  const level = buildLevel(cache, 7); // mask=7 → tüm opsiyonel slotlar dolu, zengin materyal
  const rig = new THREE.Group();
  scene.add(rig);
  rig.add(level.root);

  // level-factory tüm mesh'leri (0,0,0)'a koyar → üst üste biner. Görsel katmanda
  // yeniden konumlandırıyoruz (kaynak sayısını DEĞİŞTİRMEDEN) ve neon emissive veriyoruz.
  const meshes: THREE.Mesh[] = [];
  level.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  meshes.forEach((mesh, i) => {
    const angle = (i / meshes.length) * Math.PI * 2;
    const ring = 2.1;
    const scl = 0.55 + ((i * 37) % 5) * 0.14;
    mesh.position.set(Math.cos(angle) * ring, scl / 2, Math.sin(angle) * ring);
    mesh.scale.setScalar(scl);
    mesh.rotation.set(0, angle + 0.4, ((i % 3) - 1) * 0.12);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Materyali diorama için neon'a çek (ölçüme etkisi yok — ayrı renderer).
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const neon = NEON[i % NEON.length];
    mat.emissive = new THREE.Color(neon);
    mat.emissiveIntensity = 0.85;
    mat.metalness = 0.9;
    mat.roughness = 0.25;
    mat.envMapIntensity = 1.2;
    mat.needsUpdate = true;

    // İnce neon tel-çerçeve — glow'u bloom'da güçlendirir.
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({
        color: neon,
        transparent: true,
        opacity: 0.9,
      }),
    );
    mesh.add(edges);
  });

  // Merkezde yükselen neon "sütun" — sahneye dikey aksanı verir (dekoratif).
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 3.2, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  pillar.position.y = 1.6;
  rig.add(pillar);

  // --- Post-processing: hafif bloom → neon glow. ---
  const composer = new EffectComposer(renderer);
  composer.setSize(w, h);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.7, 0.5, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // --- Animasyon: yavaş dönüş + kamera nefesi. ---
  const clock = new THREE.Clock();
  let raf = 0;
  const tick = () => {
    const t = clock.getElapsedTime();
    rig.rotation.y = t * 0.18;
    meshes.forEach((m, i) => {
      m.position.y = m.scale.x / 2 + Math.sin(t * 1.1 + i) * 0.08;
      m.rotation.y += 0.004;
    });
    pillar.rotation.y = -t * 0.6;
    camera.position.x = Math.cos(t * 0.08) * 6.6;
    camera.position.z = Math.sin(t * 0.08) * 6.6 + 2.2;
    camera.position.y = 3.4 + Math.sin(t * 0.15) * 0.4;
    camera.lookAt(0, 0.7, 0);
    composer.render();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const onResize = () => {
    const s = size();
    w = s.w;
    h = s.h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  };
  window.addEventListener("resize", onResize);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      envRT.dispose();
      pmrem.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
