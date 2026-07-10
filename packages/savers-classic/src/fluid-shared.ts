import type { Rng } from '@idle-screens/core';

export const DT = 0.025;
export const DENS_DECAY = 0.993;
export const VEL_DECAY = 0.98;
export const DYE_RATE = 1400;
export const FORCE_RATE = 5;
export const EMITTER_N = 4;

export function hue2rgb(h: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const s = h / 60;
  const x = 1 - Math.abs(s % 2 - 1);
  if (s < 1) return [1, x, 0];
  if (s < 2) return [x, 1, 0];
  if (s < 3) return [0, 1, x];
  if (s < 4) return [0, x, 1];
  if (s < 5) return [x, 0, 1];
  return [1, 0, x];
}

export interface Emitter {
  hue: number;
  fx: number;
  fy: number;
  px: number;
  py: number;
  speed: number;
  prevGx: number;
  prevGy: number;
}

export interface EmitterFrame {
  gx: number;
  gy: number;
  dx: number;
  dy: number;
  r: number;
  g: number;
  b: number;
}

export function buildEmitters(rng: Rng, N: number): Emitter[] {
  const out: Emitter[] = [];
  for (let i = 0; i < EMITTER_N; i++) {
    const px = rng.range(0, Math.PI * 2);
    const py = rng.range(0, Math.PI * 2);
    out.push({
      hue: ((i * 360) / EMITTER_N + rng.range(0, 40)) % 360,
      fx: rng.range(0.3, 0.8),
      fy: rng.range(0.3, 0.8),
      px,
      py,
      speed: rng.range(0.5, 1.0),
      prevGx: (Math.sin(px) * 0.35 + 0.5) * N + 1,
      prevGy: (Math.cos(py) * 0.35 + 0.5) * N + 1,
    });
  }
  return out;
}

export function stepEmitters(t: number, emitters: Emitter[], N: number): EmitterFrame[] {
  return emitters.map((e) => {
    const st = t * e.speed;
    const gx = (Math.sin(st * e.fx + e.px) * 0.35 + 0.5) * N + 1;
    const gy = (Math.cos(st * e.fy + e.py) * 0.35 + 0.5) * N + 1;
    const dx = gx - e.prevGx;
    const dy = gy - e.prevGy;
    const [r, g, b] = hue2rgb(e.hue + t * 15);
    e.prevGx = gx;
    e.prevGy = gy;
    return { gx, gy, dx, dy, r, g, b };
  });
}
