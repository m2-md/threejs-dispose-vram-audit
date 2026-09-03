// naive-scene-manager.ts
import * as THREE from "three";
import type { Level } from "./level-factory";

export class NaiveSceneManager {
  readonly scene = new THREE.Scene();

  load(level: Level): void {
    this.scene.add(level.root);
  }

  unload(level: Level): void {
    this.scene.remove(level.root); // take the sign off the left building — that is all
  }
}
