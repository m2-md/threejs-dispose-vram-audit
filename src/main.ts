// main.ts — tarayıcı demosu.
// İKİ ayrı WebGL context vardır:
//   1) ÖLÇÜM renderer'ı (aşağıdaki `renderer`) — makaledeki gerçek WebGLRenderer.
//      `renderer.info.memory` sayaçlarını besler. Sahnesi baseline'da BOŞtur, bu yüzden
//      naif 200 döngü sonunda geometries drift = ve mutlak = 1600 (makale iddiası korunur).
//   2) DIORAMA renderer'ı (view/diorama.ts) — salt sinematik sunum, AYRI context.
//      Ölçüm sayaçlarına dokunmaz.
// `file://` ile AÇILMAZ (boş ekran) → `npm run dev` (Vite).
import * as THREE from "three";
import { SceneManager } from "./scene-manager";
import { NaiveSceneManager } from "./naive-scene-manager";
import { TextureCache } from "./texture-cache";
import { buildLevel } from "./level-factory";
import { MemoryProbe } from "./memory-probe";
import { createDiorama } from "./view/diorama";
import { drawDriftChart, type ChartMode } from "./view/chart";

const stage = document.getElementById("stage") as HTMLElement;
const meterGl = document.getElementById("meter-gl") as HTMLElement;
const chart = document.getElementById("chart") as HTMLCanvasElement;
const status = document.getElementById("status") as HTMLElement;

// Sinematik sunum — ayrı context. Ölçümü etkilemez.
createDiorama(stage);

// --- ÖLÇÜM renderer'ı: makaledeki gerçek WebGLRenderer, sayaç kaynağı. ---
// Görünür değil (küçük, gizli kap) ama gerçek bir context → render() sayaçları besler.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.info.autoReset = false; // render.calls'ı biz sıfırlayacağız; memory zaten kalıcı
renderer.setSize(320, 200);
meterGl.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, 320 / 200, 0.1, 100);
camera.position.set(0, 0, 6);
const light = new THREE.AmbientLight(0xffffff, 1);

// Doğru sürüm: makaledeki tarayıcı döngüsünün birebir hâli.
function runCorrect(): MemoryProbe {
  const sm = new SceneManager();
  sm.scene.add(light);
  const probe = new MemoryProbe();
  probe.sample(renderer, 0); // baseline: boş sahne

  for (let cycle = 1; cycle <= 200; cycle++) {
    const level = buildLevel(sm.cache, cycle);
    sm.load(level);
    renderer.render(sm.scene, camera); // GPU'ya yükle
    sm.unload(level);
    const s = probe.sample(renderer, cycle);
    console.log(cycle, s.geometries, s.textures, s.programs);
  }
  return probe;
}

// Naif sürüm: yalnızca scene.remove — GPU'ya tek kelime etmez.
function runNaive(): MemoryProbe {
  const naive = new NaiveSceneManager();
  naive.scene.add(light);
  const cache = new TextureCache(); // naif sürüm bunu asla release etmez
  const probe = new MemoryProbe();
  probe.sample(renderer, 0);

  for (let cycle = 1; cycle <= 200; cycle++) {
    const level = buildLevel(cache, cycle);
    naive.load(level);
    renderer.render(naive.scene, camera);
    naive.unload(level); // yalnızca scene.remove
    const s = probe.sample(renderer, cycle);
    console.log(cycle, s.geometries, s.textures, s.programs);
  }
  return probe;
}

function rowsOf(probe: MemoryProbe): number[][] {
  return probe
    .toCSV()
    .split("\n")
    .slice(1)
    .map((r) => r.split(",").map(Number));
}

function setStat(id: string, value: number, mode: ChartMode): void {
  const el = document.getElementById(id)!;
  el.textContent = value > 0 ? `+${value}` : String(value);
  el.dataset.state = value > 0 ? mode : "zero";
}

function showDrift(probe: MemoryProbe, mode: ChartMode): void {
  const d = probe.drift();
  setStat("stat-geom", d.geometries, mode);
  setStat("stat-tex", d.textures, mode);
  setStat("stat-prog", d.programs, mode);

  const verdict = document.getElementById("verdict")!;
  if (mode === "leak") {
    verdict.textContent =
      "NAİF — scene.remove. Sol binadaki tabelayı söktük; sağ bina (VRAM) tıka basa dolu.";
    verdict.dataset.state = "leak";
  } else {
    verdict.textContent =
      "DOĞRU — dispose + refcount. 200 döngüde dört sayaç da baseline'a döndü. Sıfır sızıntı.";
    verdict.dataset.state = "fixed";
  }
}

function run(mode: ChartMode): void {
  status.textContent = "200 döngü koşuyor…";
  // Ölçüm bloke edici; status'ün boyanması için bir sonraki tick'e bırak.
  // rAF DEĞİL setTimeout: arka plan sekmede rAF durur, setTimeout çalışır —
  // kullanıcı çalıştırıp sekme değiştirse bile ölçüm tamamlanır.
  setTimeout(() => {
    const probe = mode === "leak" ? runNaive() : runCorrect();
    drawDriftChart(chart, rowsOf(probe), mode);
    showDrift(probe, mode);
    status.textContent =
      mode === "leak"
        ? "naif: geometries 1600'e tırmandı"
        : "doğru: geometries düz sıfır çizgisi";
  }, 0);
}

document.getElementById("naive")!.addEventListener("click", () => run("leak"));
document
  .getElementById("correct")!
  .addEventListener("click", () => run("fixed"));
