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
}

/**
 * The catalogue. `void` is EXACTLY today's scene — no ceiling, flat floor, no
 * rays — so the default is a no-op and every already-published scene renders
 * unchanged. That is the whole reason the enum is safe to ship first.
 *
 * Deliberately NOT set here: fog, floor colour, motes. Those are already
 * steerable params, and an environment that quietly overrode them would make
 * "did the author choose this, or did the preset?" unanswerable. An
 * environment supplies the ROOM; the palette stays the author's.
 */
export const ENVIRONMENTS: readonly EnvironmentPreset[] = [
  { name: 'void', label: 'Void', water: null, floor: 'flat', rays: null },
  { name: 'abyss', label: 'Abyss', water: null, floor: 'basin',
    rays: { strength: 0.35, color: '#0e4a6e', y: -620 } },
  { name: 'reef', label: 'Reef', water: { y: 150, color: '#2ad4ff', opacity: 0.18 },
    floor: 'dunes', rays: { strength: 0.5, color: '#bfefff', y: 900 } },
  { name: 'kelp', label: 'Kelp forest', water: { y: 170, color: '#1e6f5c', opacity: 0.2 },
    floor: 'ridges', rays: { strength: 0.4, color: '#9ef5d0', y: 820 } },
  { name: 'ice', label: 'Under ice', water: { y: 132, color: '#cfefff', opacity: 0.32 },
    floor: 'flat', rays: { strength: 0.6, color: '#eaf8ff', y: 1000 } },
  { name: 'vent', label: 'Hydrothermal vent', water: null, floor: 'ridges',
    rays: { strength: 0.45, color: '#ff7a3c', y: -520 } },
  { name: 'lagoon', label: 'Lagoon', water: { y: 118, color: '#7ff3d0', opacity: 0.22 },
    floor: 'dunes', rays: { strength: 0.55, color: '#fff3b0', y: 950 } },
  { name: 'universe', label: 'Universe', water: null, floor: 'ridges',
    rays: { strength: 0.3, color: '#c39bff', y: 1200 } },
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

/** Layers are added in priority order until the budget runs out, so a weak
 *  device loses rays before it loses the ceiling — the cue that carries most
 *  of the read. */
export function affordableLayers(budget: number, preset: EnvironmentPreset): {
  floor: boolean; water: boolean; rays: boolean;
} {
  let left = budget;
  const water = preset.water !== null && left >= LAYER_COST.water;
  if (water) left -= LAYER_COST.water;
  const rays = preset.rays !== null && left >= LAYER_COST.rays;
  return { floor: true, water, rays };
}
