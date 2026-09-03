// scene-manager.ts
import * as THREE from "three";
import { disposeSubtree } from "./dispose";
import { TextureCache } from "./texture-cache";
import type { Level } from "./level-factory";

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly cache = new TextureCache();
  private loaded: Level[] = [];

  load(level: Level): void {
    this.scene.add(level.root);
    this.loaded.push(level);
  }

  unload(level: Level): void {
    this.scene.remove(level.root);
    disposeSubtree(level.root, this.cache); // owned geometry + textures + materials
    for (const key of level.shared) this.cache.release(key); // shared: refcount
    for (const extra of level.extras) extra.dispose(); // resources OUTSIDE the graph
    this.loaded = this.loaded.filter((l) => l !== level);
  }

  get loadedCount(): number {
    return this.loaded.length;
  }
}
