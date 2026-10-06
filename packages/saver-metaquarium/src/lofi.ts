import type { CapabilityTier } from '@idle-screens/capabilities';
import { isMintedId } from './farm';
import { parseFishMix } from './ipfs';

/**
 * The lofi tank: a browser port of the Apple TV's native 2D aquarium
 * (apps/ios/IdleScreens/Render/AquariumField.swift). Every minted fish ships a
 * `_transparent_icon.png` — a flat pixel view of its voxel pattern — and this
 * swims those icons through a layered, closed-form After Dark tank instead of
 * loading three.js and GLBs.
 *
 * It exists for two audiences: QA (see what a TV shows without a TV, and
 * catch drift between the two renderers) and nostalgia. Hosts opt in with
 * `createMetaquarium({ backend: 'lofi' })`; it is not a scene param, so a
 * published channel never changes meaning because of it.
 *
 * Parity rule: layout is the Swift field's, draw call for draw call — the
 * same Mulberry32 stream consumed in the same order, the same palettes, the
 * same motion constants — so one seed lays out the same tank on both. Two
 * deliberate differences: the browser can fetch any of the 512 icons (the TV
 * bundles 15 and substitutes the nearest same-breed fish), and bubbles scale
 * with the viewport (identical at the TV's 1080pt height).
 *
 * This module is the pure half — layout, pose, palette. The canvas instance
 * that draws it lives in lofi-tank.ts.
 */

/** Minted breed by token-id range, as the TV reads it. */
export type LofiBreed = 'beta' | 'angel' | 'seahorse' | 'turtle';

export function lofiBreedOf(id: number): LofiBreed {
  if (id <= 256) return 'beta';
  if (id <= 456) return 'angel';
  if (id <= 496) return 'seahorse';
  return 'turtle';
}

/** The TV's bundled cast — the default pool when a scene names no fishMix,
 *  so a seed casts the same fish in both places. */
export const LOFI_CAST_IDS: readonly number[] = [12, 100, 180, 257, 300, 340, 380, 420, 450, 457, 470, 488, 497, 505, 512];

/** Mulberry32, bit-for-bit with the Swift `Mulberry32` (SpecSubset.swift).
 *  Not core's createRng — a different generator would lay out a different
 *  tank than the TV for the same seed, which defeats the QA point. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = ((t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface Rgb { r: number; g: number; b: number }
const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b });
const WHITE = rgb(1, 1, 1);

export interface LofiPalette {
  top: Rgb; mid: Rgb; deep: Rgb; kelp: Rgb; dune: Rgb; shaft: Rgb; shaftAlpha: number;
}

/** The TV's After Dark translation of each room — copied, not re-derived. */
const PALETTES: Record<string, LofiPalette> = {
  abyss: { top: rgb(0.01, 0.02, 0.07), mid: rgb(0.005, 0.012, 0.045), deep: rgb(0, 0, 0), kelp: rgb(0.02, 0.10, 0.09), dune: rgb(0.02, 0.03, 0.07), shaft: rgb(0.06, 0.29, 0.43), shaftAlpha: 0.04 },
  reef: { top: rgb(0.03, 0.16, 0.24), mid: rgb(0.02, 0.09, 0.16), deep: rgb(0.01, 0.05, 0.10), kelp: rgb(0.05, 0.26, 0.15), dune: rgb(0.06, 0.14, 0.16), shaft: WHITE, shaftAlpha: 0.06 },
  kelp: { top: rgb(0.03, 0.15, 0.11), mid: rgb(0.02, 0.10, 0.08), deep: rgb(0.01, 0.05, 0.04), kelp: rgb(0.07, 0.30, 0.16), dune: rgb(0.04, 0.11, 0.08), shaft: rgb(0.62, 0.96, 0.81), shaftAlpha: 0.05 },
  ice: { top: rgb(0.12, 0.22, 0.32), mid: rgb(0.05, 0.12, 0.20), deep: rgb(0.02, 0.06, 0.12), kelp: rgb(0.10, 0.22, 0.20), dune: rgb(0.10, 0.20, 0.28), shaft: WHITE, shaftAlpha: 0.08 },
  vent: { top: rgb(0.11, 0.03, 0.02), mid: rgb(0.07, 0.02, 0.015), deep: rgb(0.03, 0.008, 0.006), kelp: rgb(0.16, 0.07, 0.03), dune: rgb(0.22, 0.09, 0.04), shaft: rgb(1.0, 0.48, 0.24), shaftAlpha: 0.05 },
  lagoon: { top: rgb(0.04, 0.24, 0.21), mid: rgb(0.03, 0.15, 0.14), deep: rgb(0.25, 0.14, 0.19), kelp: rgb(0.07, 0.28, 0.16), dune: rgb(0.36, 0.22, 0.29), shaft: rgb(1.0, 0.95, 0.69), shaftAlpha: 0.06 },
  universe: { top: rgb(0.06, 0.03, 0.11), mid: rgb(0.04, 0.02, 0.08), deep: rgb(0.015, 0.008, 0.04), kelp: rgb(0.10, 0.07, 0.20), dune: rgb(0.09, 0.06, 0.16), shaft: rgb(0.76, 0.61, 1.0), shaftAlpha: 0.05 },
};
const BASE_PALETTE: LofiPalette = {
  top: rgb(0.02, 0.10, 0.16), mid: rgb(0.01, 0.05, 0.10), deep: rgb(0.005, 0.025, 0.06),
  kelp: rgb(0.04, 0.22, 0.13), dune: rgb(0.03, 0.06, 0.10), shaft: WHITE, shaftAlpha: 0.05,
};

export function lofiPaletteOf(environment: string | undefined): LofiPalette {
  return environment !== undefined && Object.prototype.hasOwnProperty.call(PALETTES, environment)
    ? PALETTES[environment]!
    : BASE_PALETTE;
}

export function css(c: Rgb, alpha = 1): string {
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`;
}

export interface LofiFish {
  id: number;
  breed: LofiBreed;
  /** 0 (far) .. 1 (near) — size, speed, dim. */
  depth: number;
  /** Vertical lane centre, fraction of height. */
  lane: number;
  /** Ms for one full crossing. */
  period: number;
  phase: number;
  /** +1 swims right, -1 left (icons face right). */
  dir: number;
  bobAmp: number;
  bobHz: number;
  bobPhase: number;
}

export interface LofiField {
  fish: LofiFish[];
  kelp: Array<{ x: number; height: number; width: number; swayPhase: number; segments: number }>;
  bubbles: Array<{ x: number; period: number; phase: number; drift: number }>;
  palette: LofiPalette;
  /** t3 on the TV: more fish, kelp, bubble columns and bubbles per column. */
  rich: boolean;
}

/** The TV's t3 is the browser's top tier; everything else renders like t2. */
export function lofiRich(tier: CapabilityTier): boolean {
  return tier === 'high';
}

/**
 * A scene's fishMix as the cast: token ids in slot order, parsed with the
 * engine's own DSL (uniqueness and breed aliases included). Unminted ids
 * (NPC catalog entries) have no icon and drop out. Null = no usable mix.
 */
export function lofiCast(fishMix: string | undefined, cap: number): number[] | null {
  const mix = (fishMix ?? '').trim();
  if (!mix) return null;
  const ids: number[] = [];
  for (const e of parseFishMix(mix).entries) {
    if (!isMintedId(e.id)) continue;
    for (let i = 0; i < e.count && ids.length < cap; i++) ids.push(e.id);
  }
  return ids.length ? ids : null;
}

/** The whole tank's identity, a pure function of its inputs. Mirrors the
 *  Swift initializer's rng consumption order exactly — reorder nothing. */
export function buildLofiField(
  seed: number,
  rich: boolean,
  environment?: string,
  fishMix?: string,
): LofiField {
  const next = mulberry32(seed);
  const n = rich ? 13 : 8;
  const cast = lofiCast(fishMix, n);
  const fish: LofiFish[] = [];
  for (let i = 0; i < n; i++) {
    // Depth stratified, not random: every third of the tank gets its share
    // of near/mid/far so the parallax always reads.
    const depth = ((i % 3) + next()) / 3;
    // Only the seeded pick consumes rng — a cast leaves the stream untouched,
    // as Swift's lazy `??` does.
    const id = cast
      ? cast[i % cast.length]!
      : LOFI_CAST_IDS[Math.floor(next() * LOFI_CAST_IDS.length) % LOFI_CAST_IDS.length]!;
    const breed = lofiBreedOf(id);
    // Near fish cross in ~18s, far in ~55s — After Dark pacing — then each
    // breed sets its own tempo and posture.
    let period = (55_000 - depth * 37_000) * (0.85 + next() * 0.3);
    let bobAmp = 0.008 + next() * 0.02;
    let bobHz = 0.12 + next() * 0.2;
    switch (breed) {
      case 'beta': period *= 0.8; break;
      case 'angel': break;
      case 'seahorse':
        period *= 1.8;
        bobAmp = 0.03 + next() * 0.03;
        bobHz = 0.08 + next() * 0.08;
        break;
      case 'turtle':
        period *= 1.6;
        bobAmp *= 0.6;
        break;
    }
    const lane = 0.12 + next() * 0.68;
    const phase = next();
    const dir = next() < 0.5 ? -1 : 1;
    const bobPhase = next() * Math.PI * 2;
    fish.push({ id, breed, depth, lane, period, phase, dir, bobAmp, bobHz, bobPhase });
  }
  // Near fish draw last (on top). Stable sort, like Swift's for distinct depths.
  fish.sort((a, b) => a.depth - b.depth);

  const kelp: LofiField['kelp'] = [];
  for (let i = 0; i < (rich ? 5 : 3); i++) {
    const x = 0.04 + next() * 0.92;
    const height = 0.22 + next() * 0.3;
    const width = 10 + next() * 14;
    const swayPhase = next() * Math.PI * 2;
    kelp.push({ x, height, width, swayPhase, segments: 5 });
  }

  const bubbles: LofiField['bubbles'] = [];
  for (let i = 0; i < (rich ? 3 : 2); i++) {
    const x = 0.08 + next() * 0.84;
    const period = 2_600 + next() * 2_400;
    const phase = next();
    const drift = 0.006 + next() * 0.012;
    bubbles.push({ x, period, phase, drift });
  }

  return { fish, kelp, bubbles, palette: lofiPaletteOf(environment), rich };
}

export interface LofiFishPose { id: number; x: number; y: number; side: number; alpha: number; rotation: number; mirror: boolean }

/** Where fish `f` is at `t` ms in a `w`×`h` tank — closed-form, no state. */
export function lofiFishPose(f: LofiFish, t: number, w: number, h: number): LofiFishPose {
  const travel = (f.phase + t / f.period) % 1;
  // 14% off-screen margin each side so entries/exits are complete.
  const rawX = travel * w * 1.28 - w * 0.14;
  const x = f.dir > 0 ? rawX : w - rawX;
  const bob = Math.sin(t * 0.001 * f.bobHz * 2 * Math.PI + f.bobPhase) * f.bobAmp;
  let rotation = 0;
  let mirror = f.dir < 0;
  switch (f.breed) {
    case 'turtle':
      // Turtle icons are TOP-DOWN art, head up: rotate the shell to face
      // travel with a slow paddle rock. Never mirrored.
      rotation = (f.dir > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(t * 0.0012 + f.bobPhase) * 0.10;
      mirror = false;
      break;
    case 'seahorse':
      rotation = Math.sin(t * 0.0009 + f.bobPhase) * 0.14;
      break;
    case 'angel':
      rotation = Math.sin(t * 0.0011 + f.bobPhase) * 0.05;
      break;
    case 'beta':
      break;
  }
  return {
    id: f.id,
    x,
    y: (f.lane + bob) * h,
    side: (0.05 + f.depth * 0.10) * h,
    alpha: 0.55 + f.depth * 0.45,
    rotation,
    mirror,
  };
}
