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

export const EXAMPLE_SPECS: SaverSpec[] = [AQUARIUM_SPEC, RAIN_SPEC];
