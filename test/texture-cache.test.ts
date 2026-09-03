// texture-cache.test.ts
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SceneManager } from "../src/scene-manager";
import { buildLevel } from "../src/level-factory";

describe("shared texture refcount", () => {
  it("the atlas is disposed only when the LAST owner leaves (2→1→0)", () => {
    const sm = new SceneManager();
    const a = buildLevel(sm.cache, 1);
    const b = buildLevel(sm.cache, 2);

    sm.load(a);
    sm.load(b);
    expect(sm.cache.refs("shared-atlas")).toBe(2);

    // listen for the atlas's real dispose
    const firstMesh = a.root.children[0] as THREE.Mesh;
    const atlas = (firstMesh.material as THREE.MeshStandardMaterial).map!;
    let disposed = false;
    atlas.addEventListener("dispose", () => {
      disposed = true;
    });

    sm.unload(a);
    expect(sm.cache.refs("shared-atlas")).toBe(1);
    expect(disposed).toBe(false); // B is still using it — not deleted

    sm.unload(b);
    expect(sm.cache.refs("shared-atlas")).toBe(0);
    expect(disposed).toBe(true); // the last owner left → REAL dispose
  });
});
