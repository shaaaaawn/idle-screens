import type { SaverSpec } from '../types';

/**
 * Night Procession: a choreographed scene. Showcases `path` motion (a smooth
 * figure-eight lantern route with scatter), layer-parented `orbit` (moths circling
 * a wandering lantern-bearer), `life` staging (stars first, the procession enters
 * at 4 s, moths at 7 s), plus `ring` and `rect` sprites.
 */
export const PROCESSION_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'procession',
  label: 'Night Procession',
  seed: 8,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#060612' },
      { at: 0.8, color: '#101024' },
      { at: 1, color: '#1a1428' },
    ],
    drift: { period: 30000, amount: 0.08 },
  },
  layers: [
    {
      key: 'stars',
      count: 90,
      sprite: { kind: 'circle', radius: [0.0006, 0.0016], color: '#f0ead8', soft: true },
      motion: { type: 'static' },
      region: { y: [0, 0.6] },
      alpha: [0.25, 0.6],
      pulse: { amp: 0.15, period: 5000 },
    },
    {
      key: 'lanterns',
      count: 9,
      sprite: {
        kind: 'rect',
        width: [0.012, 0.02],
        aspect: [1.3, 1.7],
        color: '#ffb347',
        colors: ['#ffb347', '#ff8c69', '#ffd97a'],
        colorWeights: [3, 1, 2],
      },
      motion: {
        type: 'path',
        points: [
          { x: 0.12, y: 0.72 },
          { x: 0.38, y: 0.58 },
          { x: 0.62, y: 0.78 },
          { x: 0.88, y: 0.62 },
          { x: 0.62, y: 0.5 },
          { x: 0.38, y: 0.72 },
        ],
        duration: 36000,
        curve: 'smooth',
        closed: true,
        scatter: 0.02,
      },
      alpha: [0.65, 0.9],
      pulse: { amp: 0.15, period: 2600 },
      life: { enter: 4000, fade: 2500 },
      trail: { length: 1200, fade: 1 },
    },
    {
      key: 'bearer',
      count: 1,
      sprite: { kind: 'circle', radius: [0.014, 0.014], color: '#ffe9b0', soft: true },
      motion: { type: 'wander', speed: [0.008, 0.012], meander: 0.08 },
      alpha: [0.8, 0.8],
      blend: 'lighter',
      life: { enter: 4000, fade: 2500 },
    },
    {
      key: 'moths',
      count: 7,
      sprite: { kind: 'ring', radius: [0.002, 0.005], color: '#d8f6ff', width: 0.001 },
      motion: { type: 'orbit', speed: [20, 55], radius: [0.03, 0.09], center: { layer: 'bearer' } },
      alpha: [0.3, 0.7],
      life: { enter: 7000, fade: 2000 },
      trail: { length: 600 },
    },
  ],
};
