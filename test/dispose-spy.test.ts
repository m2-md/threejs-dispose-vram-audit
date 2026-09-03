// dispose-spy.test.ts — WebGL gerektirmeyen sayan sahte renderer
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { DisposeSpy } from "../src/dispose-spy";

describe("DisposeSpy: dispose olayıyla sayan sahte renderer", () => {
  it("geometri/doku sayar; dispose olayı sayacı düşürür", () => {
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

  it("aynı kaynağı iki kez render etmek çift saymaz (ilk görüş)", () => {
    const spy = new DisposeSpy();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());

    spy.renderScene(mesh);
    spy.renderScene(mesh);
    expect(spy.info.memory.geometries).toBe(1);
  });

  it("aynı imzalı iki materyal TEK program paylaşır; ikisi de dispose olunca serbest kalır", () => {
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
    expect(spy.info.programs.length).toBe(1); // aynı imza → tek program (refs 2)

    a.dispose();
    expect(spy.info.programs.length).toBe(1); // hâlâ B kullanıyor

    b.dispose();
    expect(spy.info.programs.length).toBe(0); // son sahip çıktı → serbest
  });

  it("farklı imzalı materyaller ayrı program sayılır", () => {
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
    expect(spy.info.programs.length).toBe(2); // farklı imza → iki program
  });
});
