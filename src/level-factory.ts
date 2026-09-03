// level-factory.ts
import * as THREE from "three";
import type { TextureCache } from "./texture-cache";

export const ATLAS_KEY = "shared-atlas";

export interface Level {
  root: THREE.Object3D;
  shared: string[]; // cache anahtarları (paylaşılan dokular)
  extras: { dispose(): void }[]; // render target, PMREM — sahne grafiği DIŞI
}

// mulberry32 — küçük, hızlı, deterministik PRNG (object-pools / broad-phase ile birebir).
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Küçük bir RGBA DataTexture — GL context GEREKMEZ, node'da da kurulur.
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

  // Paylaşılan atlas: TÜM seviyeler tek instance'ı paylaşır. Üreticisi sabit içerikli
  // (makeRng(0)) — cache YALNIZCA ilk edinmede koşturur, sonrası refcount.
  const atlas = cache.acquire(ATLAS_KEY, () => dataTexture(64, makeRng(0)));

  // Seviyeye göre değişen opsiyonel doku slotları → farklı program imzaları.
  // Naif sürümde bu imzalar birikir (programs tırmanır); doğru sürümde her biri
  // seviye boşalınca serbest kalır (programs baseline'a döner).
  const mask = seed % 8;

  for (let i = 0; i < meshCount; i++) {
    const geometry = new THREE.BoxGeometry(1, 1, 1); // her mesh KENDİ geometrisi
    const material = new THREE.MeshStandardMaterial({
      map: atlas, // paylaşılan doku
      normalMap: dataTexture(32, rng), // sahipli
      roughnessMap: dataTexture(32, rng), // sahipli
    });
    if (mask & 1) material.metalnessMap = dataTexture(32, rng); // sahipli, opsiyonel
    if (mask & 2) material.aoMap = dataTexture(32, rng); // sahipli, opsiyonel
    if (mask & 4) material.alphaMap = dataTexture(32, rng); // sahipli, opsiyonel
    root.add(new THREE.Mesh(geometry, material));
  }

  const reflection = new THREE.WebGLRenderTarget(256, 256);
  return { root, shared: [ATLAS_KEY], extras: [reflection] };
}
