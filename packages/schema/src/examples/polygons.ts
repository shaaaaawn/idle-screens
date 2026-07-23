import type { SaverSpec } from '../types';

/**
 * Polygons: the classic Mystify-style bouncing-polygon saver, expressed as chain links + heavy
 * ghosting. Showcases `links.mode: 'chain'` with `closed` (vertices wired in order
 * into a polygon), `bounce` motion, and high `ghosting` (the decaying after-images
 * ARE the effect — no per-entity trail sampling involved).
 */
export const POLYGONS_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'polygons',
  label: 'Polygons',
  seed: 1995,
  motionIntensity: 'moderate',
  ghosting: 0.95,
  background: { type: 'solid', color: '#04040a' },
  layers: [
    {
      key: 'poly-cyan',
      count: 4,
      sprite: { kind: 'circle', radius: [0.0025, 0.0025], color: '#37e5d7' },
      motion: { type: 'bounce', speed: [0.14, 0.24] },
      wrap: false,
      alpha: [0.9, 0.9],
      links: { k: 1, maxDist: 3, mode: 'chain', closed: true, color: '#37e5d7', alpha: 0.85, width: 0.0018 },
    },
    {
      key: 'poly-magenta',
      count: 4,
      sprite: { kind: 'circle', radius: [0.0025, 0.0025], color: '#e83e9c' },
      motion: { type: 'bounce', speed: [0.1, 0.2] },
      wrap: false,
      alpha: [0.9, 0.9],
      links: { k: 1, maxDist: 3, mode: 'chain', closed: true, color: '#e83e9c', alpha: 0.85, width: 0.0018 },
    },
  ],
};
