import type { SaverSpec } from '../types';

/** Snowfall: three depth layers of white circles drifting down with horizontal bob. */
export const SNOWFALL_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'snowfall',
  label: 'Snowfall',
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
      sprite: { kind: 'circle', radius: [0.0009259, 0.002315], color: '#8899aa' },
      motion: { type: 'drift', angle: 90, speed: [0.01389, 0.03704], bob: 0.002778 },
    },
    {
      count: 35,
      sprite: { kind: 'circle', radius: [0.001852, 0.004167], color: '#c0cdd8' },
      motion: { type: 'drift', angle: 85, speed: [0.03241, 0.07407], bob: 0.005556 },
    },
    {
      count: 15,
      sprite: { kind: 'circle', radius: [0.003241, 0.006481], color: '#e8eff5' },
      motion: { type: 'drift', angle: 82, speed: [0.05093, 0.1111], bob: 0.009259 },
    },
  ],
};
