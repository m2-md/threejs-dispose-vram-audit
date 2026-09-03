// memory-probe.ts
export interface RendererInfoLike {
  info: {
    memory: { geometries: number; textures: number };
    programs: { length: number } | null;
    render: { calls: number };
  };
}

export interface MemorySample {
  cycle: number;
  geometries: number;
  textures: number;
  programs: number;
  calls: number;
}

export class MemoryProbe {
  private baseline: MemorySample | null = null;
  private ring: MemorySample[] = [];

  constructor(private readonly capacity = 256) {}

  sample(renderer: RendererInfoLike, cycle: number): MemorySample {
    const info = renderer.info;
    const s: MemorySample = {
      cycle,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      calls: info.render.calls,
    };
    this.baseline ??= s; // the first sample becomes the baseline
    this.ring.push(s);
    if (this.ring.length > this.capacity) this.ring.shift();
    return s;
  }

  drift(): Omit<MemorySample, "cycle"> {
    const last = this.ring.at(-1);
    const base = this.baseline;
    if (!last || !base)
      return { geometries: 0, textures: 0, programs: 0, calls: 0 };
    return {
      geometries: last.geometries - base.geometries,
      textures: last.textures - base.textures,
      programs: last.programs - base.programs,
      calls: last.calls - base.calls,
    };
  }

  toCSV(): string {
    const header = "cycle,geometries,textures,programs,calls";
    const rows = this.ring.map(
      (s) =>
        `${s.cycle},${s.geometries},${s.textures},${s.programs},${s.calls}`,
    );
    return [header, ...rows].join("\n");
  }
}
