// texture-cache.test.ts
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SceneManager } from "../src/scene-manager";
import { buildLevel } from "../src/level-factory";

describe("paylaşılan doku refcount", () => {
  it("atlas yalnızca SON sahip çıkınca dispose edilir (2→1→0)", () => {
    const sm = new SceneManager();
    const a = buildLevel(sm.cache, 1);
    const b = buildLevel(sm.cache, 2);

    sm.load(a);
    sm.load(b);
    expect(sm.cache.refs("shared-atlas")).toBe(2);

    // atlas'ın gerçek dispose'unu dinle
    const firstMesh = a.root.children[0] as THREE.Mesh;
    const atlas = (firstMesh.material as THREE.MeshStandardMaterial).map!;
    let disposed = false;
    atlas.addEventListener("dispose", () => {
      disposed = true;
    });

    sm.unload(a);
    expect(sm.cache.refs("shared-atlas")).toBe(1);
    expect(disposed).toBe(false); // B hâlâ kullanıyor — silinmedi

    sm.unload(b);
    expect(sm.cache.refs("shared-atlas")).toBe(0);
    expect(disposed).toBe(true); // son sahip çıktı → GERÇEK dispose
  });
});
