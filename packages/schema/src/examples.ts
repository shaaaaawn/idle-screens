import type { SaverSpec } from './types';

/**
 * Reproduces the hand-coded Fish Aquarium saver as pure DATA — the discriminating test
 * that the schema is actually expressive: two layers (fish drifting both ways at varied
 * speeds with a bob + flip, over a gradient with a seafloor band; bubbles rising with sway).
 */
export const AQUARIUM_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'aquarium',
  label: 'Aquarium (declarative)',
  seed: 42,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#0a3a52' },
      { at: 0.6, color: '#062534' },
      { at: 1, color: '#02141d' },
    ],
    band: { color: '#0b1a12', height: 24 },
  },
  layers: [
    {
      count: 14,
      sprite: { kind: 'emoji', glyphs: ['🐟', '🐠', '🐡', '🦈', '🐙'] },
      size: [34, 72],
      motion: { type: 'drift', speed: [30, 110], bidirectional: true, bob: 6 },
      flip: true,
    },
    {
      count: 22,
      sprite: { kind: 'circle', radius: [2, 7], color: '#c8ebff' },
      motion: { type: 'rise', speed: [24, 78], sway: 8 },
    },
  ],
};

/** Rain: dense text streaks falling straight down over a near-black sky. */
export const RAIN_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'rain',
  label: 'Rain (declarative)',
  seed: 7,
  motionIntensity: 'moderate',
  background: { type: 'solid', color: '#05070a' },
  layers: [
    {
      count: 140,
      sprite: { kind: 'text', strings: ['│'], color: '#9fd0ff' },
      size: [12, 26],
      motion: { type: 'drift', angle: 90, speed: [520, 900] },
    },
  ],
};

/** Snowfall: three depth layers of white circles drifting down with horizontal bob. */
export const SNOWFALL_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'snowfall',
  label: 'Snowfall (declarative)',
  seed: 12,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#0a1628' },
      { at: 0.7, color: '#0d1f3c' },
      { at: 1, color: '#121212' },
    ],
  },
  layers: [
    {
      count: 50,
      sprite: { kind: 'circle', radius: [1, 2.5], color: '#8899aa' },
      motion: { type: 'drift', angle: 90, speed: [15, 40], bob: 3 },
    },
    {
      count: 35,
      sprite: { kind: 'circle', radius: [2, 4.5], color: '#c0cdd8' },
      motion: { type: 'drift', angle: 85, speed: [35, 80], bob: 6 },
    },
    {
      count: 15,
      sprite: { kind: 'circle', radius: [3.5, 7], color: '#e8eff5' },
      motion: { type: 'drift', angle: 82, speed: [55, 120], bob: 10 },
    },
  ],
};

/**
 * Night Lanterns (Yi Peng festival sky): depth from four correlated parallax cues —
 * closer layers are LARGER, FASTER, SWAY WIDER, and glow WARMER/BRIGHTER. v2 of this
 * composition exercises the expressive additions the first draft exposed as missing:
 * soft glow orbs + additive blend (lantern light that sums where it overlaps), bounded
 * alpha pulse with per-entity phases (breathing flames, strobe-proof by construction),
 * and spawn regions (stars only above the horizon; dim ember shimmer kept low near
 * the water line).
 */
export const LANTERNS_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'lanterns',
  label: 'Night Lanterns (declarative)',
  seed: 88,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#04060f' },
      { at: 0.55, color: '#0b1026' },
      { at: 0.85, color: '#251731' },
      { at: 1, color: '#472518' },
    ],
  },
  layers: [
    {
      count: 60,
      sprite: { kind: 'circle', radius: [0.5, 1.4], color: '#8fa0c8' },
      alpha: [0.35, 1],
      region: { y: [0, 0.62] },
      motion: { type: 'drift', speed: [0.5, 2], bob: 1 },
    },
    {
      count: 36,
      sprite: {
        kind: 'circle',
        radius: [1.5, 3],
        color: '#b06a2a',
        soft: true,
      },
      alpha: [0.5, 0.9],
      blend: 'lighter',
      pulse: { amp: 0.18, period: 2800 },
      motion: { type: 'rise', speed: [6, 14], sway: 4 },
    },
    {
      count: 14,
      sprite: {
        kind: 'circle',
        radius: [3.5, 6.5],
        color: '#e08a34',
        soft: true,
      },
      alpha: [0.6, 1],
      blend: 'lighter',
      pulse: { amp: 0.22, period: 3400 },
      motion: { type: 'rise', speed: [16, 28], sway: 7 },
    },
    {
      count: 8,
      sprite: { kind: 'emoji', glyphs: ['🏮'] },
      size: [26, 44],
      alpha: [0.85, 1],
      motion: { type: 'rise', speed: [30, 48], sway: 10 },
    },
    {
      count: 4,
      sprite: { kind: 'emoji', glyphs: ['🏮'] },
      size: [58, 84],
      motion: { type: 'rise', speed: [52, 74], sway: 14 },
    },
    {
      count: 12,
      sprite: { kind: 'circle', radius: [2, 5], color: '#e08a34', soft: true },
      alpha: [0.12, 0.35],
      blend: 'lighter',
      region: { y: [0.93, 1] },
      pulse: { amp: 0.1, period: 2200 },
      motion: { type: 'drift', speed: [2, 6], bob: 2 },
    },
  ],
};

export const EXAMPLE_SPECS: SaverSpec[] = [
  AQUARIUM_SPEC,
  RAIN_SPEC,
  SNOWFALL_SPEC,
  LANTERNS_SPEC,
];
