// dispose-spy.test.ts — the counting fake renderer that needs no WebGL
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { DisposeSpy } from "../src/dispose-spy";

describe("DisposeSpy: a fake renderer that counts via the dispose event", () => {
  it("counts geometries/textures; the dispose event decrements the counter", () => {
    const spy = new DisposeSpy();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ map: texture }),
    );

    spy.renderScene(mesh);
    expect(spy.info.memory.geometries).toBe(1);
    expect(spy.info.memory.textures).toBe(1);

    geometry.dispose();
    texture.dispose();
    expect(spy.info.memory.geometries).toBe(0);
    expect(spy.info.memory.textures).toBe(0);
  });

  it("rendering the same resource twice does not double count (first sighting wins)", () => {
    const spy = new DisposeSpy();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());

    spy.renderScene(mesh);
    spy.renderScene(mesh);
    expect(spy.info.memory.geometries).toBe(1);
  });

  it("two materials with the same signature share ONE program, freed when both are disposed", () => {
    const spy = new DisposeSpy();
    const a = new THREE.MeshStandardMaterial({
      map: new THREE.DataTexture(new Uint8Array(4), 1, 1),
    });
    const b = new THREE.MeshStandardMaterial({
      map: new THREE.DataTexture(new Uint8Array(4), 1, 1),
    });
    const g = new THREE.BoxGeometry(1, 1, 1);
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(g, a));
    scene.add(new THREE.Mesh(g, b));

    spy.renderScene(scene);
    expect(spy.info.programs.length).toBe(1); // same signature → one program (refs 2)

    a.dispose();
    expect(spy.info.programs.length).toBe(1); // B is still using it

    b.dispose();
    expect(spy.info.programs.length).toBe(0); // the last owner left → freed
  });

  it("materials with different signatures count as separate programs", () => {
    const spy = new DisposeSpy();
    const withMap = new THREE.MeshStandardMaterial({
      map: new THREE.DataTexture(new Uint8Array(4), 1, 1),
    });
    const plain = new THREE.MeshStandardMaterial();
    const g = new THREE.BoxGeometry(1, 1, 1);
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(g, withMap));
    scene.add(new THREE.Mesh(g, plain));

    spy.renderScene(scene);
    expect(spy.info.programs.length).toBe(2); // different signatures → two programs
  });
});
