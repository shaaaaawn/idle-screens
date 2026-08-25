/**
 * Environments — the tank as a room.
 *
 * The original aquarium switches whole VENUES, not backdrops: turning its
 * EXHIBIT knob moves from open shader terrain under a water ceiling to an
 * indoor hall with walls and a striped floor. Our tank has one room — a disc
 * under fog — so the gap was never "more knobs", it was that there is no room.
 *
 * This is that room, as data. An `environment` names a PLACE; an agent picks
 * one instead of dialling thirty numbers, and the values below are the taste.
 * Design and the browser session behind it:
 * `idle-mono/docs/metaquarium-environment-spec.md`.
 *
 * Zero-dep on purpose — the server validates through `./manifest` without
 * pulling three.js.
 */

export type EnvironmentName =
  | 'void' | 'abyss' | 'reef' | 'kelp' | 'ice' | 'vent' | 'lagoon' | 'universe';

/** Terrain silhouette. `flat` is the original disc; the rest are generated
 *  from the mount seed — never fetched, so determinism and offline both hold. */
export type FloorKind = 'flat' | 'dunes' | 'ridges' | 'basin';

/** Runtime guard for the same set — the steering lane is unvalidated, so a
 *  bad value must fall back rather than build an invisible floor. */
export const FLOOR_KINDS: readonly FloorKind[] = ['flat', 'dunes', 'ridges', 'basin'];

/** A translucent plane ABOVE the fish. The single strongest identity cue in
 *  the original: it is what makes a scene read as *under* something. */
export interface WaterCeiling {
  /** World Y. The tank's fish swim between y=15 and y=72. */
  y: number;
  color: string;
  opacity: number;
}

/** Volumetric shafts. `y` may be NEGATIVE — the original's raysLightY swings
 *  ±2000, and light from below is the difference between a sunlit surface and
 *  an abyssal glow. */
export interface Rays {
  strength: number;
  color: string;
  y: number;
}

export interface EnvironmentPreset {
  name: EnvironmentName;
  label: string;
  water: WaterCeiling | null;
  floor: FloorKind;
  rays: Rays | null;
  /** Terrain rng salt — two rooms sharing a floor kind must not share a hill. */
  seedSalt: number;
  /** Room palette, applied ONLY where the author left the matching param at
   *  its manifest default. An authored color always wins over the room's. */
  palette?: { fog: string; floor: string; mote: string };
}

/**
 * The catalogue. `void` is EXACTLY today's scene — no ceiling, flat floor, no
 * rays, no palette — so the default is a no-op and every already-published
 * scene renders unchanged. That is the whole reason the enum was safe to ship.
 *
 * Palettes: a QA pass measured `vent`, `universe`, and `kelp` rendering
 * byte-identical (0.000 pixel difference vent↔universe) because they share
 * `ridges`, one terrain seed, and no palette — the original "the palette
 * stays the author's" rule left three of eight rooms indistinguishable.
 * The repaired rule: a preset palette applies ONLY where the author left
 * that param untouched, so "did the author choose this?" stays answerable —
 * an authored fogColor always wins over the room's.
 *
 * `seedSalt` forks the terrain rng per environment, so two `ridges` rooms
 * are different hills, not one heightfield wearing two names.
 */
export const ENVIRONMENTS: readonly EnvironmentPreset[] = [
  { name: 'void', label: 'Void', water: null, floor: 'flat', rays: null, seedSalt: 0 },
  { name: 'abyss', label: 'Abyss', water: null, floor: 'basin', seedSalt: 0x0a1,
    rays: { strength: 0.35, color: '#0e4a6e', y: -620 },
    palette: { fog: '#02030a', floor: '#05070f', mote: '#4fd4a8' } },
  { name: 'reef', label: 'Reef', water: { y: 150, color: '#2ad4ff', opacity: 0.18 },
    floor: 'dunes', rays: { strength: 0.5, color: '#bfefff', y: 900 }, seedSalt: 0x0a2,
    palette: { fog: '#0a3d5c', floor: '#123c50', mote: '#bfe8ff' } },
  { name: 'kelp', label: 'Kelp forest', water: { y: 170, color: '#1e6f5c', opacity: 0.2 },
    floor: 'ridges', rays: { strength: 0.4, color: '#9ef5d0', y: 820 }, seedSalt: 0x0a3,
    palette: { fog: '#07271e', floor: '#0c2f22', mote: '#a5f2c6' } },
  { name: 'ice', label: 'Under ice', water: { y: 132, color: '#cfefff', opacity: 0.32 },
    floor: 'flat', rays: { strength: 0.6, color: '#eaf8ff', y: 1000 }, seedSalt: 0x0a4,
    palette: { fog: '#12283c', floor: '#1b3d59', mote: '#d8f2ff' } },
  { name: 'vent', label: 'Hydrothermal vent', water: null, floor: 'ridges', seedSalt: 0x0a5,
    rays: { strength: 0.45, color: '#ff7a3c', y: -520 },
    palette: { fog: '#170502', floor: '#4a1a0a', mote: '#ff8a3c' } },
  { name: 'lagoon', label: 'Lagoon', water: { y: 118, color: '#7ff3d0', opacity: 0.22 },
    floor: 'dunes', rays: { strength: 0.55, color: '#fff3b0', y: 950 }, seedSalt: 0x0a6,
    palette: { fog: '#0d453f', floor: '#6e4457', mote: '#eafff4' } },
  { name: 'universe', label: 'Universe', water: null, floor: 'ridges', seedSalt: 0x0a7,
    rays: { strength: 0.3, color: '#c39bff', y: 1200 },
    palette: { fog: '#0d0618', floor: '#171030', mote: '#cfa8ff' } },
];

export const ENVIRONMENT_NAMES: readonly EnvironmentName[] =
  ENVIRONMENTS.map((e) => e.name);

export function environmentOf(name: string): EnvironmentPreset {
  return ENVIRONMENTS.find((e) => e.name === name) ?? ENVIRONMENTS[0]!;
}

// ---------------------------------------------------------------------------
// Cost budget
// ---------------------------------------------------------------------------

/**
 * What each layer costs, and what a tier can afford.
 *
 * The arch research asked for a cost model "before rich scenes ship", and this
 * is that, scoped to one saver. The floor is free because it is generated once
 * at mount and never touched per frame; the ceiling is one extra draw call;
 * rays are the only per-frame work worth rationing.
 */
export const LAYER_COST = { floor: 0, water: 1, rays: 2 } as const;

/** Shafts at full and at reduced count. A rays-only place keeps its identity
 *  on a weak device by running fewer shafts rather than none. */
export const RAY_COUNT = { full: 5, reduced: 2 } as const;

/**
 * Layers in priority order until the budget runs out: a device that can only
 * afford one thing keeps the ceiling, the cue that carries most of the read.
 *
 * But `abyss`, `vent` and `universe` have NO ceiling — their whole identity is
 * the glow — so spending ceiling-first would silently leave them as bare
 * terrain on exactly the devices that most need a recognisable scene. When
 * nothing higher-priority claims the budget, rays run at a reduced shaft count
 * instead of not at all.
 */
export function affordableLayers(budget: number, preset: EnvironmentPreset): {
  floor: boolean; water: boolean; rayCount: number;
} {
  let left = budget;
  const water = preset.water !== null && left >= LAYER_COST.water;
  if (water) left -= LAYER_COST.water;
  let rayCount = 0;
  if (preset.rays !== null && left > 0) {
    rayCount = left >= LAYER_COST.rays ? RAY_COUNT.full : RAY_COUNT.reduced;
  }
  return { floor: true, water, rayCount };
}
