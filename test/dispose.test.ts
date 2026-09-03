// dispose.test.ts — proof that the walker really visits every texture slot
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { disposeSubtree, disposeMaterial } from "../src/dispose";
import { TextureCache } from "../src/texture-cache";

function tinyTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  t.needsUpdate = true;
  return t;
}

describe("disposeSubtree: walking the scene graph", () => {
  it("disposes the geometry + 3 texture slots + the material in ONE call", () => {
    const disposed = new Set<string>();

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const map = tinyTexture();
    const normalMap = tinyTexture();
    const aoMap = tinyTexture();
    const material = new THREE.MeshStandardMaterial({ map, normalMap, aoMap });

    geometry.addEventListener("dispose", () => disposed.add("geometry"));
    map.addEventListener("dispose", () => disposed.add("map"));
    normalMap.addEventListener("dispose", () => disposed.add("normalMap"));
    aoMap.addEventListener("dispose", () => disposed.add("aoMap"));
    material.addEventListener("dispose", () => disposed.add("material"));

    const mesh = new THREE.Mesh(geometry, material);
    disposeSubtree(mesh); // NO cache → every texture counts as owned

    expect(disposed).toEqual(
      new Set(["geometry", "map", "normalMap", "aoMap", "material"]),
    );
  });

  it("walks every material of a multi-material mesh", () => {
    const disposed = new Set<string>();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const matA = new THREE.MeshStandardMaterial({ map: tinyTexture() });
    const matB = new THREE.MeshStandardMaterial({ normalMap: tinyTexture() });
    matA.addEventListener("dispose", () => disposed.add("A"));
    matB.addEventListener("dispose", () => disposed.add("B"));

    const mesh = new THREE.Mesh(geometry, [matA, matB]);
    disposeSubtree(mesh);

    expect(disposed).toEqual(new Set(["A", "B"]));
  });

  it("leaves the shared (cached) texture ALONE and disposes the owned one", () => {
    const cache = new TextureCache();
    const shared = cache.acquire("atlas", () => tinyTexture()); // refs 1
    const owned = tinyTexture();
    const material = new THREE.MeshStandardMaterial({
      map: shared,
      normalMap: owned,
    });

    let sharedDisposed = false;
    let ownedDisposed = false;
    shared.addEventListener("dispose", () => (sharedDisposed = true));
    owned.addEventListener("dispose", () => (ownedDisposed = true));

    disposeMaterial(material, cache);

    expect(sharedDisposed).toBe(false); // shared → the cache's job, skipped
    expect(ownedDisposed).toBe(true); // owned → disposed
    expect(cache.isShared(shared)).toBe(true); // still in the cache (refs 1)
  });
});
