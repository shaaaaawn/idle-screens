/**
 * The lofi tank's room and atmosphere — a mirror of the Apple TV's
 * apps/ios/IdleScreens/Render/AquariumExtras.swift, draw for draw:
 *
 * - Room: `fogColor` (the water) and `floorColor` (the dunes) override the
 *   room's palette; `interior: geode` is a cave (its own palette, no shafts);
 *   `floraDensity` thins the kelp (0 = none). These apply only when the
 *   scene AUTHORED them — the TV only ever sees authored params, so a
 *   manifest default must not repaint the room here either.
 * - Atmosphere: `marineSnow`, `skyLanterns`, and a `shoal` of `shoalKind`
 *   at `shoalSpeed`.
 * - Critters: the unminted breeds a `fishMix` names swim — or, the floor
 *   breeds, crawl the dunes — as icons rendered from their own models
 *   (lofi-npc-icons.ts; the TV bundles the same PNGs).
 *
 * Every element draws from its OWN seeded stream (fixed constants below), so
 * the original tank's stream — and every existing layout — is untouched.
 */
import { parseFishMix } from './ipfs';
import { mulberry32, type LofiPalette, type Rgb } from './lofi';

export interface LofiParams {
  fogColor?: string;
  floorColor?: string;
  interior?: string;
  floraDensity?: number;
  marineSnow: number;
  skyLanterns: number;
  shoal: number;
  shoalKind: string;
  shoalSpeed: number;
}

export const DEFAULT_LOFI_PARAMS: LofiParams = { marineSnow: 0, skyLanterns: 0, shoal: 0, shoalKind: 'neon', shoalSpeed: 0.8 };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** `#rgb` / `#rrggbb` → 0…1 channels, or null. */
export function hexRgb(s: string | undefined): Rgb | null {
  if (typeof s !== 'string') return null;
  let h = s.trim();
  if (!h.startsWith('#')) return null;
  h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/**
 * The params the lofi tank reads, from the current values. `authored` names
 * the keys the scene actually set (its own params or track paths): the room
 * overrides apply only for those, exactly as on the TV.
 */
export function lofiParamsFrom(values: Record<string, unknown>, authored: ReadonlySet<string>): LofiParams {
  const num = (k: string): number | undefined => {
    const v = values[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const str = (k: string): string | undefined => (typeof values[k] === 'string' ? (values[k] as string) : undefined);
  const out: LofiParams = {
    marineSnow: clamp(num('marineSnow') ?? 0, 0, 1),
    skyLanterns: clamp(num('skyLanterns') ?? 0, 0, 1),
    shoal: clamp(num('shoal') ?? 0, 0, 1),
    shoalKind: str('shoalKind') ?? 'neon',
    shoalSpeed: clamp(num('shoalSpeed') ?? 0.8, 0.3, 2),
  };
  if (authored.has('fogColor') && hexRgb(str('fogColor'))) out.fogColor = str('fogColor');
  if (authored.has('floorColor') && hexRgb(str('floorColor'))) out.floorColor = str('floorColor');
  if (authored.has('interior')) out.interior = str('interior');
  if (authored.has('floraDensity')) {
    const f = num('floraDensity');
    if (f !== undefined) out.floraDensity = clamp(f, 0, 1);
  }
  return out;
}

export function lofiParamsKey(p: LofiParams): string {
  return [p.fogColor ?? '', p.floorColor ?? '', p.interior ?? '', p.floraDensity ?? '', p.marineSnow, p.skyLanterns, p.shoal, p.shoalKind, p.shoalSpeed].join('|');
}

/** Fixed stream constants — the same in AquariumExtras.swift. */
export const STREAMS = { critters: 0x6d71ca51, snow: 0x51a4e3b7, lanterns: 0x1a77e2a5, shoal: 0x5b0a17c3 } as const;

export interface CritterBreed { id: number; size: number; tempo: number; floor: boolean; facing: boolean }

/** Unminted breeds: icon id, size vs a minted fish (breeds.json), tempo, floor-dweller, front/top-view art. */
export const CRITTERS: Record<string, CritterBreed> = {
  blowfish: { id: 601, size: 0.8, tempo: 1.2, floor: false, facing: false },
  hackerfish: { id: 602, size: 0.85, tempo: 1.0, floor: false, facing: false },
  glowfish: { id: 603, size: 0.8, tempo: 1.3, floor: false, facing: false },
  babyfish: { id: 604, size: 0.45, tempo: 0.8, floor: false, facing: false },
  shark: { id: 605, size: 2.2, tempo: 1.4, floor: false, facing: false },
  crab: { id: 606, size: 0.9, tempo: 1.0, floor: true, facing: true },
  dori: { id: 608, size: 0.9, tempo: 0.9, floor: false, facing: false },
  starfish: { id: 609, size: 1.0, tempo: 2.0, floor: true, facing: true },
  octopus: { id: 610, size: 1.2, tempo: 1.2, floor: true, facing: true },
  snail: { id: 611, size: 0.8, tempo: 2.0, floor: true, facing: false },
  dot: { id: 612, size: 1.2, tempo: 1.0, floor: false, facing: false },
  dolphin: { id: 613, size: 1.8, tempo: 0.7, floor: false, facing: false },
};

export interface Critter { breed: string; depth: number; lane: number; period: number; phase: number; dir: number; bobAmp: number; bobHz: number; bobPhase: number }
export interface Mote { x: number; y: number; fall: number; sway: number; r: number }
export interface Lantern { x: number; y: number; drift: number; pulse: number; r: number }
export interface ShoalFish { dx: number; dy: number; wiggle: number }

export interface LofiExtras { critters: Critter[]; snow: Mote[]; lanterns: Lantern[]; shoal: ShoalFish[]; shoalLane: number }

/** Swift's `(x).rounded()` — halves away from zero. */
const roundHalfAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.sign(x) * Math.floor(Math.abs(x) + 0.5));

/** The tank's extras, a pure function of (seed, rich, mix, params). */
export function buildLofiExtras(seed: number, rich: boolean, fishMix: string | undefined, p: LofiParams): LofiExtras {
  const out: LofiExtras = { critters: [], snow: [], lanterns: [], shoal: [], shoalLane: 0.45 };

  const rc = mulberry32((seed ^ STREAMS.critters) >>> 0);
  const cap = rich ? 6 : 4;
  const names: string[] = [];
  for (const e of parseFishMix(fishMix ?? '').entries) {
    if (!CRITTERS[e.breed]) continue;
    for (let i = 0; i < e.count && names.length < cap; i++) names.push(e.breed);
  }
  for (const name of names) {
    const b = CRITTERS[name]!;
    const depth = 0.35 + rc() * 0.65;
    const base = b.floor ? 90_000 : 55_000 - depth * 37_000;
    const period = base * (0.85 + rc() * 0.3) * b.tempo;
    const phase = rc();
    const dir = rc() < 0.5 ? -1 : 1;
    const lane = 0.15 + rc() * 0.6;
    const bobAmp = b.floor ? 0 : 0.006 + rc() * 0.014;
    const bobHz = 0.1 + rc() * 0.15;
    const bobPhase = rc() * Math.PI * 2;
    out.critters.push({ breed: name, depth, lane, period, phase, dir, bobAmp, bobHz, bobPhase });
  }

  const rs = mulberry32((seed ^ STREAMS.snow) >>> 0);
  for (let i = 0; i < roundHalfAway(p.marineSnow * (rich ? 60 : 30)); i++) {
    const x = rs(); const y = rs(); const fall = 0.012 + rs() * 0.02; const sway = rs() * Math.PI * 2; const r = 0.8 + rs() * 1.6;
    out.snow.push({ x, y, fall, sway, r });
  }

  const rl = mulberry32((seed ^ STREAMS.lanterns) >>> 0);
  for (let i = 0; i < roundHalfAway(p.skyLanterns * (rich ? 6 : 4)); i++) {
    const x = rl(); const y = 0.04 + rl() * 0.22; const drift = (rl() * 2 - 1) * 0.004; const pulse = rl() * Math.PI * 2; const r = 14 + rl() * 10;
    out.lanterns.push({ x, y, drift, pulse, r });
  }

  const rh = mulberry32((seed ^ STREAMS.shoal) >>> 0);
  out.shoalLane = 0.3 + rh() * 0.3;
  for (let i = 0; i < roundHalfAway(p.shoal * (rich ? 24 : 12)); i++) {
    const dx = (rh() * 2 - 1) * 0.07; const dy = (rh() * 2 - 1) * 0.045; const wiggle = rh() * Math.PI * 2;
    out.shoal.push({ dx, dy, wiggle });
  }
  return out;
}

/** Height of the front dune at x — the ground floor critters stand on. */
export const duneY = (x: number, h: number): number => h * 0.93 + Math.sin(x * 0.004 + 2.1) * h * 0.018;

export function critterPose(c: Critter, t: number, w: number, h: number): { x: number; y: number; side: number; alpha: number } {
  const b = CRITTERS[c.breed]!;
  const travel = (c.phase + t / c.period) % 1;
  const rawX = travel * w * 1.28 - w * 0.14;
  const x = c.dir > 0 ? rawX : w - rawX;
  const side = (0.05 + c.depth * 0.10) * h * b.size;
  const y = b.floor
    ? duneY(x, h) - side * 0.42
    : (c.lane + Math.sin(t * 0.001 * c.bobHz * 2 * Math.PI + c.bobPhase) * c.bobAmp) * h;
  return { x, y, side, alpha: 0.55 + c.depth * 0.45 };
}

export function motePos(m: Mote, t: number, w: number, h: number): { x: number; y: number } {
  return { x: (m.x + Math.sin(t * 0.0004 + m.sway) * 0.01) * w, y: ((m.y + (t / 1000) * m.fall) % 1) * h * 0.92 };
}

export function lanternPos(l: Lantern, t: number, w: number, h: number): { x: number; y: number; glow: number } {
  const raw = (l.x + (t / 1000) * l.drift) % 1;
  return { x: (raw < 0 ? raw + 1 : raw) * w, y: l.y * h, glow: 0.8 + 0.2 * Math.sin(t * 0.0015 + l.pulse) };
}

export function shoalCentre(lane: number, speed: number, t: number, w: number, h: number): { x: number; y: number } {
  const travel = (t / (40_000 / speed)) % 1;
  return { x: travel * w * 1.4 - w * 0.2, y: (lane + 0.08 * Math.sin(t * 0.00021)) * h };
}

export function shoalColors(kind: string): { body: Rgb; mark: Rgb } {
  switch (kind) {
    case 'rummynose': return { body: { r: 0.85, g: 0.86, b: 0.8 }, mark: { r: 0.95, g: 0.2, b: 0.18 } };
    case 'ember': return { body: { r: 1, g: 0.45, b: 0.2 }, mark: { r: 1, g: 0.75, b: 0.4 } };
    default: return { body: { r: 0.25, g: 0.75, b: 1 }, mark: { r: 0.95, g: 0.22, b: 0.25 } };
  }
}

/** A geode's cave: amethyst walls, no light from above. */
export const GEODE_PALETTE: LofiPalette = {
  top: { r: 0.10, g: 0.05, b: 0.14 }, mid: { r: 0.06, g: 0.03, b: 0.10 }, deep: { r: 0.02, g: 0.01, b: 0.04 },
  kelp: { r: 0.18, g: 0.10, b: 0.26 }, dune: { r: 0.16, g: 0.10, b: 0.20 }, shaft: { r: 0.76, g: 0.61, b: 1 }, shaftAlpha: 0,
};

/** The room with the scene's authored overrides: geode, then water, then floor. */
export function applyRoom(pal: LofiPalette, p: LofiParams): LofiPalette {
  let out: LofiPalette = { ...pal };
  if (p.interior === 'geode') out = { ...GEODE_PALETTE };
  const fog = hexRgb(p.fogColor);
  if (fog) {
    out.top = { r: fog.r + (1 - fog.r) * 0.06, g: fog.g + (1 - fog.g) * 0.06, b: fog.b + (1 - fog.b) * 0.06 };
    out.mid = fog;
    out.deep = { r: fog.r * 0.45, g: fog.g * 0.45, b: fog.b * 0.45 };
  }
  const floor = hexRgb(p.floorColor);
  if (floor) out.dune = floor;
  return out;
}
