import type { SaverSpec } from '../types';

/**
 * Constellation: drifting stars connected by faint k-nearest links. Exercises
 * colors[] (multi-hued stars), links (k-nearest neighbor lines), and cycle
 * (emoji asterisms rotate glyphs). Stars are soft circles in viewport units.
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
      sprite: { kind: 'circle', radius: [0.0009259, 0.002778], color: '#667799', colors: ['#8899cc', '#99aadd', '#aabbee', '#7788aa'] },
      alpha: [0.2, 0.7],
      pulse: { amp: 0.2, period: 3000 },
      motion: { type: 'static' },
    },
    // Connected constellation nodes — slow drift, linked
    {
      key: 'nodes',
      count: 40,
      sprite: { kind: 'circle', radius: [0.001852, 0.00463], color: '#88aaff', colors: ['#88aaff', '#aaccff', '#ffcc88', '#ff8866'], soft: true },
      alpha: [0.5, 0.9],
      blend: 'lighter',
      motion: { type: 'drift', speed: [0.001852, 0.007407], bidirectional: true, bob: 0.002778 },
      links: { k: 3, maxDist: 0.1852, alpha: 0.15, width: 0.000463 },
    },
    // Cycling asterism markers
    {
      count: 6,
      sprite: { kind: 'emoji', glyphs: ['✦', '✧', '⋆', '∗'], cycle: { period: 2000 } },
      size: [0.01296, 0.02037],
      alpha: [0.4, 0.7],
      motion: { type: 'drift', speed: [0.0009259, 0.003704], bidirectional: true },
    },
  ],
};
