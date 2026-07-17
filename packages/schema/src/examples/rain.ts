import type { SaverSpec } from '../types';

/** Rain: dense text streaks falling straight down over a near-black sky. */
export const RAIN_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'rain',
  label: 'Rain',
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
