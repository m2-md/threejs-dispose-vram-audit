// memory-probe.test.ts — the probe that turns a counter into a measuring instrument
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { MemoryProbe } from "../src/memory-probe";
import { DisposeSpy } from "../src/dispose-spy";

describe("MemoryProbe: baseline + drift + CSV", () => {
  it("drift measures the deviation from baseline and returns to zero after dispose", () => {
    const spy = new DisposeSpy();
    const probe = new MemoryProbe();

    probe.sample(spy, 0); // baseline: empty
    expect(probe.drift().geometries).toBe(0);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    spy.renderScene(mesh);
    probe.sample(spy, 1);
    expect(probe.drift().geometries).toBe(1); // 1 geometry uploaded

    geometry.dispose();
    probe.sample(spy, 2);
    expect(probe.drift().geometries).toBe(0); // dispose → back to baseline
  });

  it("toCSV emits a header plus one row per sample", () => {
    const spy = new DisposeSpy();
    const probe = new MemoryProbe();
    probe.sample(spy, 0);
    probe.sample(spy, 1);
    probe.sample(spy, 2);

    const lines = probe.toCSV().split("\n");
    expect(lines[0]).toBe("cycle,geometries,textures,programs,calls");
    expect(lines.length).toBe(1 + 3); // header + 3 samples
  });

  it("the ring buffer drops old samples once capacity is exceeded", () => {
    const spy = new DisposeSpy();
    const probe = new MemoryProbe(4); // small capacity
    for (let i = 0; i < 10; i++) probe.sample(spy, i);

    const lines = probe.toCSV().split("\n");
    expect(lines.length).toBe(1 + 4); // header + the last 4
  });
});
