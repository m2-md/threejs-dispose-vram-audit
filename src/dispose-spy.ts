// dispose-spy.ts
import * as THREE from "three";
import { TEXTURE_SLOTS } from "./dispose";

export class DisposeSpy {
  private geom = 0;
  private tex = 0;
  private prog = 0;

  private seenGeom = new WeakSet<THREE.BufferGeometry>();
  private seenTex = new WeakSet<THREE.Texture>();
  private seenMat = new WeakSet<THREE.Material>();
  private programRefs = new Map<string, number>();

  // EXACTLY the same shape as renderer.info → MemoryProbe can read either one
  get info() {
    return {
      memory: { geometries: this.geom, textures: this.tex },
      programs: { length: this.prog },
      render: { calls: 0 },
    };
  }

  renderScene(scene: THREE.Object3D): void {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) this.trackGeometry(mesh.geometry);
      const material = mesh.material;
      if (!material) return;
      const materials = Array.isArray(material) ? material : [material];
      for (const m of materials) this.trackMaterial(m);
    });
  }

  private trackGeometry(geometry: THREE.BufferGeometry): void {
    if (this.seenGeom.has(geometry)) return;
    this.seenGeom.add(geometry);
    this.geom++;
    const onDispose = () => {
      this.geom--;
      geometry.removeEventListener("dispose", onDispose);
    };
    geometry.addEventListener("dispose", onDispose);
  }

  private trackTexture(texture: THREE.Texture): void {
    if (this.seenTex.has(texture)) return;
    this.seenTex.add(texture);
    this.tex++;
    const onDispose = () => {
      this.tex--;
      texture.removeEventListener("dispose", onDispose);
    };
    texture.addEventListener("dispose", onDispose);
  }

  private trackMaterial(material: THREE.Material): void {
    if (this.seenMat.has(material)) return;
    this.seenMat.add(material);

    for (const slot of TEXTURE_SLOTS) {
      const tex = (material as unknown as Record<string, unknown>)[slot];
      if (tex instanceof THREE.Texture) this.trackTexture(tex);
    }

    // Program: deduped by signature — the way WebGLPrograms does it
    const sig = programSignature(material);
    const refs = this.programRefs.get(sig) ?? 0;
    this.programRefs.set(sig, refs + 1);
    if (refs === 0) this.prog++;

    const onDispose = () => {
      const n = (this.programRefs.get(sig) ?? 1) - 1;
      if (n <= 0) {
        this.programRefs.delete(sig);
        this.prog--;
      } else {
        this.programRefs.set(sig, n);
      }
      material.removeEventListener("dispose", onDispose);
    };
    material.addEventListener("dispose", onDispose);
  }
}

function programSignature(material: THREE.Material): string {
  const slots = TEXTURE_SLOTS.filter(
    (s) => (material as unknown as Record<string, unknown>)[s],
  );
  return `${material.type}|${slots.join(",")}`;
}
