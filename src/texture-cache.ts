// texture-cache.ts
import * as THREE from "three";

interface Entry {
  texture: THREE.Texture;
  refs: number;
}

export class TextureCache {
  private byKey = new Map<string, Entry>();
  private keyOf = new WeakMap<THREE.Texture, string>();

  acquire(key: string, create: () => THREE.Texture): THREE.Texture {
    let entry = this.byKey.get(key);
    if (!entry) {
      const texture = create(); // üretici YALNIZCA ilk edinmede koşar
      entry = { texture, refs: 0 };
      this.byKey.set(key, entry);
      this.keyOf.set(texture, key);
    }
    entry.refs++;
    return entry.texture;
  }

  release(key: string): void {
    const entry = this.byKey.get(key);
    if (!entry) return;
    entry.refs--;
    if (entry.refs <= 0) {
      entry.texture.dispose(); // GERÇEK dispose — yalnızca son sahip çıkınca
      this.byKey.delete(key);
    }
  }

  isShared(texture: THREE.Texture): boolean {
    const key = this.keyOf.get(texture);
    return key !== undefined && this.byKey.has(key);
  }

  refs(key: string): number {
    return this.byKey.get(key)?.refs ?? 0;
  }

  get size(): number {
    return this.byKey.size;
  }
}
