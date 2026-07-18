import type { SaverSpec } from '../types';

/**
 * Constellation: drifting stars connected by faint k-nearest links. Exercises
 * colors[] (multi-hued stars), links (k-nearest neighbor lines), and cycle
 * (emoji asterisms rotate glyphs). Stars are soft circles in pixel units.
 */
export const CONSTELLATION_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'constellation',
  label: 'Constellation',
  seed: 73,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#020212' },
      { at: 0.5, color: '#050520' },
      { at: 1, color: '#0a0830' },
    ],
  },
  layers: [
    // Distant static stars (no links, just atmosphere)
    {
      count: 100,
      sprite: { kind: 'circle', radius: [1, 3], color: '#667799', colors: ['#8899cc', '#99aadd', '#aabbee', '#7788aa'] },
      alpha: [0.2, 0.7],
      pulse: { amp: 0.2, period: 3000 },
      motion: { type: 'static' },
    },
    // Connected constellation nodes — slow drift, linked
    {
      key: 'nodes',
      count: 40,
      sprite: { kind: 'circle', radius: [2, 5], color: '#88aaff', colors: ['#88aaff', '#aaccff', '#ffcc88', '#ff8866'], soft: true },
      alpha: [0.5, 0.9],
      blend: 'lighter',
      motion: { type: 'drift', speed: [2, 8], bidirectional: true, bob: 3 },
      links: { k: 3, maxDist: 200, alpha: 0.15, width: 0.5 },
    },
    // Cycling asterism markers
    {
      count: 6,
      sprite: { kind: 'emoji', glyphs: ['✦', '✧', '⋆', '∗'], cycle: { period: 2000 } },
      size: [14, 22],
      alpha: [0.4, 0.7],
      motion: { type: 'drift', speed: [1, 4], bidirectional: true },
    },
  ],
};
