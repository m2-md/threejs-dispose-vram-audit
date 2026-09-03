# dispose() VRAM Audit — Three.js Level Teardown

Working code for the article "The Garbage Collector's Key Does Not Open the GPU
Door". It reloads a level 200 times in a menu→level→menu cycle, first makes the
VRAM leak visible through the `renderer.info.memory` counters, then closes it
with a reference-counting ResourceTracker — and proves zero leak under vitest
with a counting fake renderer that needs no WebGL.

The **first** project of the Three.js 3D series; the projects that follow
(physics, glTF, terrain) inherit this `SceneManager` + `TextureCache` +
`disposeSubtree` backbone.

Version: `three@0.185.1` (r185), the classic `WebGLRenderer`. This project does not touch WebGPU.

## What's inside

- **`src/naive-scene-manager.ts`** — nothing but `scene.add` / `scene.remove`. The leak pattern:
  it cuts the JS reference but never says a word to the GPU.
- **`src/memory-probe.ts`** — turns the `renderer.info` counters into a measuring instrument:
  keeps a baseline, returns `drift()`, emits `toCSV()` (ring buffer, so the probe itself
  does not leak). Thanks to the `RendererInfoLike` shape it reads both the real renderer and
  the fake one.
- **`src/dispose.ts`** — `disposeSubtree` walks the scene graph with `traverse` and disposes
  all SEVEN texture slots of every material (`map`, `normalMap`, `roughnessMap`, `metalnessMap`,
  `aoMap`, `alphaMap`, `envMap`) + the geometry + the material.
- **`src/texture-cache.ts`** — reference counting for shared textures. `acquire` increments,
  `release` decrements, the real `dispose()` is called only at zero (the atlas 2→1→0 path).
- **`src/scene-manager.ts`** — walker + refcount + off-graph `extras` (render target,
  PMREM) under a single `unload` contract.
- **`src/dispose-spy.ts`** — a counting fake renderer that needs no WebGL. It listens to
  Three.js's real `"dispose"` event; its `info` getter returns exactly the same shape as
  `renderer.info`, so `MemoryProbe` cannot tell the fake renderer from the real one.
- **`src/level-factory.ts`** — a deterministic (`mulberry32`) level generator; 8 meshes, each
  with its own geometry + owned textures, all of them acquiring the shared atlas.
- **`src/main.ts` + `index.html`** — browser demo with a real `WebGLRenderer`
  (dark cinematic + neon glow interface).
- **`src/view/diorama.ts`** — the presentation layer: a SEPARATE `WebGLRenderer` that draws the
  audited 8-mesh level as a cinematic diorama (ACESFilmic tone mapping, `RoomEnvironment`
  + PMREM IBL, shadowed ground, fog, `UnrealBloomPass`). Because it has its own context it
  does **not** touch the measurement counters → the naive `geometries` drift stays 1600.
- **`src/view/chart.ts`** — a neon area/line chart of the geometries drift (leak = climbing
  rose line + glow + a "peak 1600" badge; fixed = flat emerald line).

## Setup

```bash
npm install
```

## Test

```bash
npm test
```

15 tests — all deterministic, requiring **NO WebGL/GPU** (they run under Node):

- **Naive leak:** 200 cycles of `NaiveSceneManager` → `drift().geometries > 0` and
  `.textures > 0` (the counter climbs and never comes down).
- **Zero leak:** 200 cycles of `SceneManager` → `drift()` is `0` in all four fields,
  `cache.size === 0`, `loadedCount === 0`.
- **Refcount 2→1→0:** the atlas is disposed only when the LAST owner leaves (neither early nor late).
- **Walking:** `disposeSubtree` disposes `map` + `normalMap` + `aoMap` + the geometry + the
  material in a single call, and leaves the shared texture alone.
- **Off-graph:** a `WebGLRenderTarget` that is NOT in the scene tree still gets closed.
- **Probe / spy:** `drift` measures the deviation from baseline, `toCSV` emits the right number
  of rows; the spy's program count dedupes by signature.

Expected output:

```
 ✓ test/dispose-spy.test.ts    (4 tests)
 ✓ test/dispose.test.ts        (3 tests)
 ✓ test/memory-probe.test.ts   (3 tests)
 ✓ test/texture-cache.test.ts  (1 test)
 ✓ test/extras.test.ts         (2 tests)
 ✓ test/scene-manager.test.ts  (2 tests)

 Test Files  6 passed (6)
      Tests  15 passed (15)
```

The deterministic numbers measured (without WebGL, using `DisposeSpy`):

| Scenario (200 cycles, meshCount=8) | geometries | textures | programs |
|---|---|---|---|
| Naive (`scene.remove`) | **1600** (200×8) | 5601 | 8 |
| Correct (`dispose` + refcount) — drift | **0** | **0** | **0** |

In the naive version `geometries` shows exactly **1600** at cycle 200. In the correct version
every counter returns to baseline (`cache.size === 0`).

## Demo (browser)

```bash
npm run dev
```

`http://localhost:5173/` → cinematic diorama + a glass control panel:

- **Naive 200× load** (rose/danger button) — the `renderer.info.memory` counters climb; the
  neon chart draws the geometries drift as a rose line rising 0→**1600** (glow +
  fill + a "peak 1600" badge), the stat counters show `+1600 / +5602 / +8` (red).
- **Correct 200× load** (emerald/success button) — the chart is a flat emerald zero line; all three
  counters are `0`.

Architecture — **two separate WebGL contexts**:

1. **The measurement renderer** (`main.ts`) — the real `WebGLRenderer` from the article. Its scene
   is empty at baseline; after 200 naive cycles `geometries` absolute = drift = **1600**
   (the article's claim). Invisible but a real context (the source of the counters).
2. **The diorama renderer** (`view/diorama.ts`) — presentation only, a separate context; it does not
   touch the measurement counters. It shows the audited 8 meshes under neon light on a shadowed ground.

> The demo needs a dev server. Opening `index.html` with `file://` gives a blank screen
> (Vite resolves the bare module specifiers). Always use `npm run dev`.

Verified in the browser against the real `WebGLRenderer.info.memory` (headless Chrome, SwiftShader):
naive → `geometries +1600 / textures +5602 / programs +8`; correct → all `0`.

## Build

```bash
npm run build   # tsc && vite build → dist/
```

## Why is this testable without WebGL?

The GPU residency that `renderer.info.memory` measures is updated by Three.js listening for a
`"dispose"` event coming from the resources. `BufferGeometry`, `Texture` and `Material` emit a
`"dispose"` event when `dispose()` is called — that is real Three.js behavior.
`DisposeSpy` listens to the same event and counts; it never touches a canvas, a GPU or a browser.
That is how the 200-cycle proof runs deterministically under Node, in milliseconds.

## License

MIT
