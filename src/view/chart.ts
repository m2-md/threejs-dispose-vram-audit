// view/chart.ts — neon area/line chart of the geometries drift.
// leak (naive) → climbing rose line + glow + fill gradient; fixed (correct) → flat emerald.
// Purely visual: it reads MemoryProbe.toCSV() rows and does not touch the counter logic.

export type ChartMode = "leak" | "fixed";

const COLORS: Record<
  ChartMode,
  { line: string; glow: string; fill0: string; fill1: string }
> = {
  leak: {
    line: "#fb7185",
    glow: "rgba(251,113,133,0.85)",
    fill0: "rgba(251,113,133,0.32)",
    fill1: "rgba(251,113,133,0.0)",
  },
  fixed: {
    line: "#34d399",
    glow: "rgba(52,211,153,0.8)",
    fill0: "rgba(52,211,153,0.22)",
    fill1: "rgba(52,211,153,0.0)",
  },
};

// rows: [cycle, geometries, textures, programs, calls][] (baseline row included)
export function drawDriftChart(
  canvas: HTMLCanvasElement,
  rows: number[][],
  mode: ChartMode,
): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 320;
  const cssH = canvas.clientHeight || 180;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const pad = { l: 8, r: 12, t: 22, b: 20 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  const c = COLORS[mode];

  // Scale: the y axis is always 0..1600 (the article's peak value) → both modes share one scale.
  const maxY = 1600;
  const geom = rows.map((r) => r[1] - rows[0][1]); // drift relative to the baseline
  const peak = Math.max(0, ...geom);

  // --- thin grid + axis labels ---
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "middle";
  const ticks = [0, 400, 800, 1200, 1600];
  for (const tk of ticks) {
    const y = pad.t + plotH - (tk / maxY) * plotH;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, y + 0.5);
    ctx.lineTo(pad.l + plotW, y + 0.5);
    ctx.stroke();
    ctx.fillStyle = "rgba(148,163,184,0.55)";
    ctx.textAlign = "left";
    ctx.fillText(String(tk), pad.l + plotW - 26, y - 6);
  }

  const xAt = (i: number) =>
    pad.l + (geom.length <= 1 ? 0 : (i / (geom.length - 1)) * plotW);
  const yAt = (v: number) => pad.t + plotH - (v / maxY) * plotH;

  // --- fill gradient ---
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
  grad.addColorStop(0, c.fill0);
  grad.addColorStop(1, c.fill1);
  ctx.beginPath();
  ctx.moveTo(xAt(0), pad.t + plotH);
  geom.forEach((v, i) => ctx.lineTo(xAt(i), yAt(v)));
  ctx.lineTo(xAt(geom.length - 1), pad.t + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // --- neon line + glow ---
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 14;
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 2.4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  geom.forEach((v, i) =>
    i === 0 ? ctx.moveTo(xAt(i), yAt(v)) : ctx.lineTo(xAt(i), yAt(v)),
  );
  ctx.stroke();
  ctx.restore();

  // --- peak point + badge ---
  const lastX = xAt(geom.length - 1);
  const lastY = yAt(geom[geom.length - 1]);
  ctx.fillStyle = c.line;
  ctx.beginPath();
  ctx.arc(lastX, lastY, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // title
  ctx.fillStyle = "rgba(226,232,240,0.85)";
  ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.fillText("GEOMETRIES DRIFT", pad.l, 11);

  // peak badge (only when the leak visibly climbs)
  if (peak > 40) {
    const badge = `peak ${peak}`;
    ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    const bw = ctx.measureText(badge).width + 14;
    const bx = Math.min(lastX + 6, cssW - bw - 4);
    const by = Math.max(pad.t, lastY - 20);
    ctx.fillStyle = "rgba(251,113,133,0.16)";
    roundRect(ctx, bx, by, bw, 16, 8);
    ctx.fill();
    ctx.fillStyle = c.line;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(badge, bx + 7, by + 8);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
