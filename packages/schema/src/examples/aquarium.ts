import type { SaverSpec } from '../types';

/**
 * Reproduces the hand-coded Fish Aquarium saver as pure DATA — the discriminating test
 * that the schema is actually expressive: two layers (fish drifting both ways at varied
 * speeds with a bob + flip, over a gradient with a seafloor band; bubbles rising with sway).
 */
export const AQUARIUM_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'aquarium',
  label: 'Aquarium',
  seed: 42,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#0a3a52' },
      { at: 0.6, color: '#062534' },
      { at: 1, color: '#02141d' },
    ],
    band: { color: '#0b1a12', height: 0.02222 },
  },
  layers: [
    {
      count: 14,
      sprite: { kind: 'emoji', glyphs: ['🐟', '🐠', '🐡', '🦈', '🐙'] },
      size: [0.03148, 0.06667],
      motion: { type: 'drift', speed: [0.02778, 0.1019], bidirectional: true, bob: 0.005556 },
      flip: true,
    },
    {
      count: 22,
      sprite: { kind: 'circle', radius: [0.001852, 0.006481], color: '#c8ebff' },
      motion: { type: 'rise', speed: [0.02222, 0.07222], sway: 0.007407 },
    },
  ],
};
