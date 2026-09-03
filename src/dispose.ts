// dispose.ts
import * as THREE from "three";
import type { TextureCache } from "./texture-cache";

export const TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "alphaMap",
  "envMap",
] as const;

export function disposeMaterial(
  material: THREE.Material,
  cache?: TextureCache,
): void {
  for (const slot of TEXTURE_SLOTS) {
    const tex = (material as unknown as Record<string, unknown>)[slot];
    if (tex instanceof THREE.Texture) {
      if (cache?.isShared(tex)) continue; // shared texture is the cache's job — hands off
      tex.dispose();
    }
  }
  material.dispose();
}

export function disposeSubtree(
  root: THREE.Object3D,
  cache?: TextureCache,
): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();

    const material = mesh.material;
    if (!material) return;
    if (Array.isArray(material)) {
      for (const m of material) disposeMaterial(m, cache);
    } else {
      disposeMaterial(material, cache);
    }
  });
}
