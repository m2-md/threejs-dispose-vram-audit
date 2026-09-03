// scene-manager.test.ts
import { describe, it, expect } from "vitest";
import { SceneManager } from "../src/scene-manager";
import { NaiveSceneManager } from "../src/naive-scene-manager";
import { TextureCache } from "../src/texture-cache";
import { buildLevel } from "../src/level-factory";
import { DisposeSpy } from "../src/dispose-spy";
import { MemoryProbe } from "../src/memory-probe";

describe("dispose denetimi — 200 döngü", () => {
  it("naif scene.remove sızdırır: sayaç tırmanır, düşmez", () => {
    const spy = new DisposeSpy();
    const probe = new MemoryProbe();
    const naive = new NaiveSceneManager();
    const cache = new TextureCache(); // naif sürüm bunu asla release etmez
    probe.sample(spy, 0);

    for (let cycle = 1; cycle <= 200; cycle++) {
      const level = buildLevel(cache, cycle);
      naive.load(level);
      spy.renderScene(naive.scene); // GPU'ya yükle
      naive.unload(level); // yalnızca scene.remove
      probe.sample(spy, cycle);
    }

    const drift = probe.drift();
    expect(drift.geometries).toBeGreaterThan(0); // sızıntı KANITI
    expect(drift.textures).toBeGreaterThan(0);
  });

  it("doğru unload sızdırmaz: 200 döngü sonunda sayaçlar baseline'a döner", () => {
    const spy = new DisposeSpy();
    const probe = new MemoryProbe();
    const sm = new SceneManager();
    probe.sample(spy, 0); // baseline: boş sahne

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
    expect(sm.cache.size).toBe(0); // paylaşılan doku da temizlendi
    expect(sm.loadedCount).toBe(0);
  });
});
