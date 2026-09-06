import type { SaverSpec } from '../types';

/**
 * Facets — a composition in the manner of the early abstractionists: three
 * soft-edged colour planes (feathered `rect`) breathing slowly behind a field
 * of tumbling triangular facets (custom `polygon`), tapered brush arcs
 * (`stroke`) drifting across, and a few glowing hexagons (soft regular
 * `polygon`). Every glyph here is a path, not a disc — the shape family nine
 * of the fifteen style profiles asked for.
 */
export const FACETS_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'facets',
  label: 'Facets',
  seed: 1911,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#101626' },
      { at: 1, color: '#1c1a2e' },
    ],
  },
  layers: [
    {
      key: 'planes',
      count: 3,
      sprite: {
        kind: 'rect',
        width: [0.28, 0.42],
        aspect: [0.6, 1.4],
        color: '#b3402f',
        colors: ['#b3402f', '#c9862b', '#2d4f8a'],
        feather: 0.6,
      },
      alpha: [0.35, 0.5],
      region: { x: [0.2, 0.8], y: [0.2, 0.8] },
      motion: { type: 'wander', speed: [0.001, 0.003], meander: 0.02 },
      spin: [-2, 2],
    },
    {
      key: 'facets',
      count: 14,
      sprite: {
        kind: 'polygon',
        radius: [0.02, 0.06],
        points: [[-1, 0.9], [0.2, -1], [1, 0.4]],
        color: '#f2e8c9',
        colors: ['#f2e8c9', '#e0b53a', '#6fa8dc', '#d94f3d'],
      },
      alpha: [0.6, 0.9],
      motion: { type: 'wander', speed: [0.003, 0.008], meander: 0.03 },
      spin: [-8, 8],
    },
    {
      key: 'arcs',
      count: 12,
      sprite: {
        kind: 'stroke',
        length: [0.08, 0.18],
        points: [[-1, 0.3], [-0.5, -0.6], [0.3, -0.7], [1, 0.1]],
        width: 0.004,
        taper: true,
        color: '#f2e8c9',
      },
      alpha: [0.5, 0.8],
      motion: { type: 'drift', speed: [0.004, 0.01], angle: 20, bidirectional: true },
      spin: [-4, 4],
    },
    {
      key: 'hexes',
      count: 8,
      sprite: { kind: 'polygon', radius: [0.008, 0.016], sides: 6, color: '#e0b53a', soft: true },
      alpha: [0.5, 0.8],
      blend: 'lighter',
      motion: { type: 'wander', speed: [0.002, 0.005] },
    },
  ],
};
