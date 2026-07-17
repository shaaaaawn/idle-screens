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
