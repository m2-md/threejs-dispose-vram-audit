// scene-manager.test.ts
import { describe, it, expect } from "vitest";
import { SceneManager } from "../src/scene-manager";
import { NaiveSceneManager } from "../src/naive-scene-manager";
import { TextureCache } from "../src/texture-cache";
import { buildLevel } from "../src/level-factory";
import { DisposeSpy } from "../src/dispose-spy";
import { MemoryProbe } from "../src/memory-probe";

describe("dispose audit — 200 cycles", () => {
  it("naive scene.remove leaks: the counter climbs and never comes down", () => {
    const spy = new DisposeSpy();
    const probe = new MemoryProbe();
    const naive = new NaiveSceneManager();
    const cache = new TextureCache(); // the naive version never releases this
    probe.sample(spy, 0);

    for (let cycle = 1; cycle <= 200; cycle++) {
      const level = buildLevel(cache, cycle);
      naive.load(level);
      spy.renderScene(naive.scene); // upload to the GPU
      naive.unload(level); // scene.remove only
      probe.sample(spy, cycle);
    }

    const drift = probe.drift();
    expect(drift.geometries).toBeGreaterThan(0); // PROOF of the leak
    expect(drift.textures).toBeGreaterThan(0);
  });

  it("the correct unload does not leak: after 200 cycles the counters return to baseline", () => {
    const spy = new DisposeSpy();
    const probe = new MemoryProbe();
    const sm = new SceneManager();
    probe.sample(spy, 0); // baseline: empty scene

    for (let cycle = 1; cycle <= 200; cycle++) {
      const level = buildLevel(sm.cache, cycle);
      sm.load(level);
      spy.renderScene(sm.scene);
      sm.unload(level); // dispose + refcount release
      probe.sample(spy, cycle);
    }

    expect(probe.drift()).toEqual({
      geometries: 0,
      textures: 0,
      programs: 0,
      calls: 0,
    });
    expect(sm.cache.size).toBe(0); // the shared texture was cleaned up too
    expect(sm.loadedCount).toBe(0);
  });
});
