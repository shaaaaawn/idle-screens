import type { SaverSpec } from '../types';

/** Haiku: a centered text block with a slowly drifting haiku over deep indigo. */
export const HAIKU_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'haiku',
  label: 'Haiku',
  seed: 42,
  background: { type: 'solid', color: '#080812' },
  layers: [
    {
      count: 1,
      sprite: {
        kind: 'textBlock',
        text: 'An old silent pond\nA frog jumps into the pond —\nSplash! Silence again.',
        maxWidth: 0.8,
        fontSize: 0.05,
        lineHeight: 1.8,
        align: 'center',
        color: '#c8cad4',
      },
      motion: { type: 'static' },
      position: { x: 0.1, y: 0.35 },
    },
    {
      count: 30,
      sprite: { kind: 'circle', radius: [0.0005, 0.0015], color: '#3a3a5c' },
      motion: { type: 'drift', speed: [0.002, 0.006], angle: 270 },
    },
  ],
};
