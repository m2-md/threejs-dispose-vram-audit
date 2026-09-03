// main.ts — browser demo.
// There are TWO separate WebGL contexts:
//   1) The MEASUREMENT renderer (`renderer` below) — the real WebGLRenderer from the article.
//      It feeds the `renderer.info.memory` counters. Its scene is EMPTY at baseline, so after
//      200 naive cycles the geometries drift = absolute = 1600 (the article's claim holds).
//   2) The DIORAMA renderer (view/diorama.ts) — presentation only, a SEPARATE context.
//      It does not touch the measurement counters.
// Do NOT open with `file://` (blank screen) → `npm run dev` (Vite).
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

// Cinematic presentation — separate context. Does not affect the measurement.
createDiorama(stage);

// --- MEASUREMENT renderer: the real WebGLRenderer from the article, source of the counters. ---
// Not visible (a small, hidden container) but a real context → render() feeds the counters.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.info.autoReset = false; // we reset render.calls ourselves; memory is persistent anyway
renderer.setSize(320, 200);
meterGl.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, 320 / 200, 0.1, 100);
camera.position.set(0, 0, 6);
const light = new THREE.AmbientLight(0xffffff, 1);

// Correct version: the exact browser loop from the article.
function runCorrect(): MemoryProbe {
  const sm = new SceneManager();
  sm.scene.add(light);
  const probe = new MemoryProbe();
  probe.sample(renderer, 0); // baseline: empty scene

  for (let cycle = 1; cycle <= 200; cycle++) {
    const level = buildLevel(sm.cache, cycle);
    sm.load(level);
    renderer.render(sm.scene, camera); // upload to the GPU
    sm.unload(level);
    const s = probe.sample(renderer, cycle);
    console.log(cycle, s.geometries, s.textures, s.programs);
  }
  return probe;
}

// Naive version: scene.remove only — it never says a word to the GPU.
function runNaive(): MemoryProbe {
  const naive = new NaiveSceneManager();
  naive.scene.add(light);
  const cache = new TextureCache(); // the naive version never releases this
  const probe = new MemoryProbe();
  probe.sample(renderer, 0);

  for (let cycle = 1; cycle <= 200; cycle++) {
    const level = buildLevel(cache, cycle);
    naive.load(level);
    renderer.render(naive.scene, camera);
    naive.unload(level); // scene.remove only
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
      "NAIVE — scene.remove. We took the sign off the left building; the right one (VRAM) is packed full.";
    verdict.dataset.state = "leak";
  } else {
    verdict.textContent =
      "CORRECT — dispose + refcount. Across 200 cycles all four counters returned to baseline. Zero leak.";
    verdict.dataset.state = "fixed";
  }
}

function run(mode: ChartMode): void {
  status.textContent = "running 200 cycles…";
  // The measurement blocks; defer to the next tick so the status gets painted.
  // setTimeout, NOT rAF: rAF halts in a background tab, setTimeout keeps running —
  // so the measurement finishes even if the user starts it and switches tabs.
  setTimeout(() => {
    const probe = mode === "leak" ? runNaive() : runCorrect();
    drawDriftChart(chart, rowsOf(probe), mode);
    showDrift(probe, mode);
    status.textContent =
      mode === "leak"
        ? "naive: geometries climbed to 1600"
        : "correct: geometries is a flat zero line";
  }, 0);
}

document.getElementById("naive")!.addEventListener("click", () => run("leak"));
document
  .getElementById("correct")!
  .addEventListener("click", () => run("fixed"));
