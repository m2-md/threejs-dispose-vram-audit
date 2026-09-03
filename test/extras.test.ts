// extras.test.ts — grafik DIŞI kaynaklar + acquire idempotentliği
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SceneManager } from "../src/scene-manager";
import { TextureCache } from "../src/texture-cache";
import { buildLevel, ATLAS_KEY } from "../src/level-factory";

describe("Mesh'lerin ötesi: grafik dışı kaynaklar", () => {
  it("sahne ağacında OLMAYAN WebGLRenderTarget yine de dispose edilir", () => {
    const sm = new SceneManager();
    const level = buildLevel(sm.cache, 3);

    const rt = level.extras[0] as THREE.WebGLRenderTarget;
    let disposed = false;
    rt.addEventListener("dispose", () => (disposed = true));

    sm.load(level);
    expect(disposed).toBe(false);

    sm.unload(level);
    expect(disposed).toBe(true); // extras listesi sahiplendi → kapatıldı
  });
});

describe("TextureCache.acquire idempotentliği", () => {
  it("aynı anahtarla iki acquire AYNI instance'ı verir, refs 2 olur", () => {
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

    expect(second).toBe(first); // AYNI Texture instance
    expect(created).toBe(1); // üretici yalnızca bir kez koştu (lazy)
    expect(cache.refs(ATLAS_KEY)).toBe(2);
    expect(cache.size).toBe(1);
  });
});
