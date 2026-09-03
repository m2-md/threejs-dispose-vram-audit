// memory-probe.test.ts — sayacı ölçüm aletine çeviren prob
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { MemoryProbe } from "../src/memory-probe";
import { DisposeSpy } from "../src/dispose-spy";

describe("MemoryProbe: baseline + drift + CSV", () => {
  it("drift baseline'dan sapmayı ölçer; dispose sonrası sıfıra döner", () => {
    const spy = new DisposeSpy();
    const probe = new MemoryProbe();

    probe.sample(spy, 0); // baseline: boş
    expect(probe.drift().geometries).toBe(0);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    spy.renderScene(mesh);
    probe.sample(spy, 1);
    expect(probe.drift().geometries).toBe(1); // 1 geometri yüklendi

    geometry.dispose();
    probe.sample(spy, 2);
    expect(probe.drift().geometries).toBe(0); // dispose → baseline'a döndü
  });

  it("toCSV başlık + örnek başına bir satır üretir", () => {
    const spy = new DisposeSpy();
    const probe = new MemoryProbe();
    probe.sample(spy, 0);
    probe.sample(spy, 1);
    probe.sample(spy, 2);

    const lines = probe.toCSV().split("\n");
    expect(lines[0]).toBe("cycle,geometries,textures,programs,calls");
    expect(lines.length).toBe(1 + 3); // header + 3 örnek
  });

  it("ring-buffer kapasiteyi aşınca eski örnekleri düşürür", () => {
    const spy = new DisposeSpy();
    const probe = new MemoryProbe(4); // küçük kapasite
    for (let i = 0; i < 10; i++) probe.sample(spy, i);

    const lines = probe.toCSV().split("\n");
    expect(lines.length).toBe(1 + 4); // header + son 4
  });
});
