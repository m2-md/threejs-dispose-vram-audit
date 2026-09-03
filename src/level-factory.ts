// level-factory.ts
import * as THREE from "three";
import type { TextureCache } from "./texture-cache";

export const ATLAS_KEY = "shared-atlas";

export interface Level {
  root: THREE.Object3D;
  shared: string[]; // cache keys (shared textures)
  extras: { dispose(): void }[]; // render target, PMREM — OUTSIDE the scene graph
}

// mulberry32 — small, fast, deterministic PRNG (identical to the one in object-pools / broad-phase).
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A tiny RGBA DataTexture — needs NO GL context, so it builds under node too.
export function dataTexture(
  size: number,
  rng: () => number,
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i++) data[i] = (rng() * 256) | 0;
  const tex = new THREE.DataTexture(data, size, size);
  tex.needsUpdate = true;
  return tex;
}

export function buildLevel(
  cache: TextureCache,
  seed: number,
  meshCount = 8,
): Level {
  const rng = makeRng(seed);
  const root = new THREE.Group();

  // Shared atlas: ALL levels share a single instance. Its factory has fixed content
  // (makeRng(0)) — the cache runs it ONLY on the first acquire, after that it is refcount.
  const atlas = cache.acquire(ATLAS_KEY, () => dataTexture(64, makeRng(0)));

  // Optional texture slots that vary per level → different program signatures.
  // In the naive version these signatures pile up (programs climbs); in the correct
  // version each one is released when the level unloads (programs returns to baseline).
  const mask = seed % 8;

  for (let i = 0; i < meshCount; i++) {
    const geometry = new THREE.BoxGeometry(1, 1, 1); // every mesh gets its OWN geometry
    const material = new THREE.MeshStandardMaterial({
      map: atlas, // shared texture
      normalMap: dataTexture(32, rng), // owned
      roughnessMap: dataTexture(32, rng), // owned
    });
    if (mask & 1) material.metalnessMap = dataTexture(32, rng); // owned, optional
    if (mask & 2) material.aoMap = dataTexture(32, rng); // owned, optional
    if (mask & 4) material.alphaMap = dataTexture(32, rng); // owned, optional
    root.add(new THREE.Mesh(geometry, material));
  }

  const reflection = new THREE.WebGLRenderTarget(256, 256);
  return { root, shared: [ATLAS_KEY], extras: [reflection] };
}
