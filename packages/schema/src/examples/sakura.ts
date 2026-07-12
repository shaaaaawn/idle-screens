import type { SaverSpec } from '../types';

/**
 * Sakura Drift: cherry-blossom petals carried on a spring twilight breeze. Five
 * correlated-parallax layers build the depth — the far backdrop is a barely-moving
 * field of soft blossom-glow orbs (additive, breathing out of phase), then three
 * petal layers grow LARGER, FASTER, BRIGHTER and FLUTTER WIDER as they approach
 * (the near gust), over a blue-hour gradient with a warm rose horizon and a dark
 * grass band. A final low layer of dim pink glow settles at the grass line — fallen
 * petals catching the last light. Wind direction is consistent (down-left) across
 * every moving layer; petals differ from snowfall by glyph, colour, palette and the
 * diagonal breeze, and from lanterns by falling rather than rising.
 */
export const SAKURA_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'sakura',
  label: 'Sakura Drift',
  seed: 314,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#1b1d38' },
      { at: 0.45, color: '#3a2645' },
      { at: 0.8, color: '#7d3d4e' },
      { at: 1, color: '#0f140d' },
    ],
    band: { color: '#0c140d', height: 44 },
  },
  layers: [
    {
      count: 60,
      sprite: { kind: 'circle', radius: [0.6, 1.6], color: '#ffe3ec', soft: true },
      alpha: [0.3, 0.9],
      blend: 'lighter',
      region: { y: [0, 0.72] },
      pulse: { amp: 0.22, period: 3000 },
      motion: { type: 'drift', speed: [0.3, 1.2], bob: 1 },
    },
    {
      count: 28,
      sprite: { kind: 'emoji', glyphs: ['🌸'] },
      size: [13, 20],
      alpha: [0.5, 0.8],
      motion: { type: 'drift', speed: [12, 26], angle: 100, bob: 3 },
    },
    {
      count: 18,
      sprite: { kind: 'emoji', glyphs: ['🌸'] },
      size: [20, 32],
      alpha: [0.7, 0.95],
      motion: { type: 'drift', speed: [24, 44], angle: 100, bob: 6 },
    },
    {
      count: 10,
      sprite: { kind: 'emoji', glyphs: ['🌸'] },
      size: [34, 54],
      alpha: [0.85, 1],
      motion: { type: 'drift', speed: [42, 68], angle: 100, bob: 11 },
    },
    {
      count: 16,
      sprite: { kind: 'circle', radius: [1.5, 4], color: '#ff9bb5', soft: true },
      alpha: [0.1, 0.3],
      blend: 'lighter',
      region: { y: [0.9, 1] },
      pulse: { amp: 0.15, period: 2600 },
      motion: { type: 'drift', speed: [0.3, 1.5], angle: 180, bob: 1 },
    },
  ],
};
