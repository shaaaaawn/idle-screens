import type { Rng } from '@idle-screens/core';

export const RD_DU = 0.16;
export const RD_DV = 0.08;
export const RD_F = 0.055;
export const RD_K = 0.062;
export const RD_DT = 1.0;
export const SEED_R = 5;
export const SEED_COUNT = 15;
export const RESEED_INTERVAL = 360;
export const RESEED_BATCH = 3;

export interface SeedPoint {
  x: number;
  y: number;
}

export function generateSeeds(rng: Rng, N: number, count: number): SeedPoint[] {
  const seeds: SeedPoint[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push({
      x: rng.int(SEED_R + 1, N - SEED_R - 2),
      y: rng.int(SEED_R + 1, N - SEED_R - 2),
    });
  }
  return seeds;
}

export function applySeedsCPU(
  u: Float32Array, v: Float32Array, N: number,
  seeds: SeedPoint[], r: number,
): void {
  for (const s of seeds) {
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        if (di * di + dj * dj > r * r) continue;
        const x = (s.x + di + N) % N;
        const y = (s.y + dj + N) % N;
        const idx = x + y * N;
        u[idx] = 0.5;
        v[idx] = 0.25;
      }
    }
  }
}

const LUT = buildColorLUT();

function buildColorLUT(): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let r: number, g: number, b: number;
    if (t < 0.33) {
      const s = t / 0.33;
      r = 10 + s * 3;   g = 10 + s * 67;  b = 46 + s * 56;
    } else if (t < 0.66) {
      const s = (t - 0.33) / 0.33;
      r = 13 + s * 211;  g = 77 + s * 35;  b = 102 - s * 38;
    } else {
      const s = (t - 0.66) / 0.34;
      r = 224 + s * 16;  g = 112 + s * 97;  b = 64 + s * 96;
    }
    lut[i * 3] = Math.round(r);
    lut[i * 3 + 1] = Math.round(g);
    lut[i * 3 + 2] = Math.round(b);
  }
  return lut;
}

export function colorV(v: number): [number, number, number] {
  const i = Math.min(255, Math.max(0, (v * 768) | 0));
  return [LUT[i * 3]!, LUT[i * 3 + 1]!, LUT[i * 3 + 2]!];
}
