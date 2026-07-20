import type { SaverSpec } from '../types';

/**
 * Comet Shower: showcases trails (afterglow behind moving entities) and background
 * drift (gradient stops breathing slowly). Three layers: a static star field, fast
 * comets with long trails, and slow fireflies with short trails and pulse.
 */
export const COMETS_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'comets',
  label: 'Comet Shower',
  seed: 42,
  motionIntensity: 'moderate',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#0a0015' },
      { at: 0.5, color: '#0d1b2a' },
      { at: 1, color: '#1b0a2e' },
    ],
    drift: { period: 25000, amount: 0.12 },
  },
  layers: [
    {
      key: 'stars',
      count: 120,
      sprite: { kind: 'circle', radius: [0.5, 2], color: '#ffffff', soft: true },
      motion: { type: 'static' },
      alpha: [0.3, 0.7],
      pulse: { amp: 0.15, period: 3000 },
    },
    {
      key: 'comets',
      count: 8,
      sprite: { kind: 'circle', radius: [3, 8], color: '#88ccff', soft: true },
      motion: { type: 'drift', speed: [80, 200], angle: 225 },
      alpha: [0.7, 1],
      blend: 'lighter',
      trail: { length: 1500, fade: 1 },
    },
    {
      key: 'fireflies',
      count: 20,
      sprite: { kind: 'circle', radius: [2, 5], color: '#ffdd44', soft: true },
      motion: { type: 'drift', speed: [10, 30], bidirectional: true, bob: 20 },
      alpha: [0.4, 0.8],
      pulse: { amp: 0.3, period: 2000 },
      blend: 'lighter',
      trail: { length: 800 },
    },
  ],
};
