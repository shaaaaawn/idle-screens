import type { SaverSpec } from '../types';

/**
 * Shard Fall — tumbling shapes and a passing shadow.
 * Two features nothing else here uses. `rotate` is STATIC per-entity rotation
 * (a range seeded per entity), which is not the same as `spin: [0, 0]` — a
 * zero spin speed renders the seeded start angle as 0, so "tilted but not
 * turning" was previously inexpressible; here the shards are thrown at
 * `rotate: [-180, 180]` AND tumbling on their own `spin` range, so no two
 * facets agree on an angle. The shadow layer demonstrates `blend:
 * 'multiply'`: two large soft discs darkening a pale plate as they wander,
 * which is how the format does shadow and silhouette — `lighter` adds light,
 * `multiply` removes it, and neither needs a sprite that looks like darkness.
 * The polygons use `points` (unit coordinates scaled by `radius`), which are
 * paint, so two shards with the same point count will morph into each other.
 */
export const SHARD_FALL_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'shard-fall',
  label: 'Shard Fall',
  seed: 214,
  motionIntensity: 'moderate',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#efe6d6' },
      { at: 0.55, color: '#e6d6bd' },
      { at: 1, color: '#d9c39f' },
    ],
  },
  layers: [
    {
      key: 'shards',
      count: 26,
      sprite: {
        kind: 'polygon',
        points: [[-1, 0.35], [-0.25, -1], [0.85, -0.4], [0.4, 0.9]],
        radius: [0.012, 0.03],
        color: '#b4593a',
        colors: ['#b4593a', '#7f8a5e', '#5a6b7d', '#8a5a3c'],
        colorWeights: [2, 2, 1, 2],
      },
      motion: { type: 'drift', speed: [0.012, 0.032], angle: 90 },
      alpha: [0.85, 0.95],
      rotate: [-180, 180],
      spin: [-35, 35],
    },
    {
      key: 'shadows',
      count: 2,
      sprite: { kind: 'circle', radius: [0.18, 0.22], color: '#5a4a34', soft: true },
      motion: { type: 'wander', speed: [0.003, 0.005], meander: 0.04, coherence: 0.6 },
      alpha: [0.2, 0.28],
      blend: 'multiply',
    },
  ],
};