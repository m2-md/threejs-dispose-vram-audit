// extras.test.ts — resources OUTSIDE the graph + acquire idempotency
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SceneManager } from "../src/scene-manager";
import { TextureCache } from "../src/texture-cache";
import { buildLevel, ATLAS_KEY } from "../src/level-factory";

describe("Beyond meshes: resources outside the graph", () => {
  it("a WebGLRenderTarget that is NOT in the scene tree still gets disposed", () => {
    const sm = new SceneManager();
    const level = buildLevel(sm.cache, 3);

    const rt = level.extras[0] as THREE.WebGLRenderTarget;
    let disposed = false;
    rt.addEventListener("dispose", () => (disposed = true));

    sm.load(level);
    expect(disposed).toBe(false);

    sm.unload(level);
    expect(disposed).toBe(true); // the extras list owned it → it was closed
  });
});

describe("TextureCache.acquire idempotency", () => {
  it("two acquires with the same key return the SAME instance and refs becomes 2", () => {
    const cache = new TextureCache();
    let created = 0;
    const create = () => {
      created++;
      const t = new THREE.DataTexture(new Uint8Array(4), 1, 1);
      t.needsUpdate = true;
      return t;
    };

    const first = cache.acquire(ATLAS_KEY, create);
    const second = cache.acquire(ATLAS_KEY, create);

    expect(second).toBe(first); // the SAME Texture instance
    expect(created).toBe(1); // the factory ran exactly once (lazy)
    expect(cache.refs(ATLAS_KEY)).toBe(2);
    expect(cache.size).toBe(1);
  });
});
