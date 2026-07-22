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
    band: { color: '#0c140d', height: 0.04074 },
  },
  layers: [
    {
      count: 60,
      sprite: { kind: 'circle', radius: [0.0005556, 0.001481], color: '#ffe3ec', soft: true },
      alpha: [0.3, 0.9],
      blend: 'lighter',
      region: { y: [0, 0.72] },
      pulse: { amp: 0.22, period: 3000 },
      motion: { type: 'drift', speed: [0.0002778, 0.001111], bob: 0.0009259 },
    },
    {
      count: 28,
      sprite: { kind: 'emoji', glyphs: ['🌸'] },
      size: [0.01204, 0.01852],
      alpha: [0.5, 0.8],
      motion: { type: 'drift', speed: [0.01111, 0.02407], angle: 100, bob: 0.002778 },
    },
    {
      count: 18,
      sprite: { kind: 'emoji', glyphs: ['🌸'] },
      size: [0.01852, 0.02963],
      alpha: [0.7, 0.95],
      motion: { type: 'drift', speed: [0.02222, 0.04074], angle: 100, bob: 0.005556 },
    },
    {
      count: 10,
      sprite: { kind: 'emoji', glyphs: ['🌸'] },
      size: [0.03148, 0.05],
      alpha: [0.85, 1],
      motion: { type: 'drift', speed: [0.03889, 0.06296], angle: 100, bob: 0.01019 },
    },
    {
      count: 16,
      sprite: { kind: 'circle', radius: [0.001389, 0.003704], color: '#ff9bb5', soft: true },
      alpha: [0.1, 0.3],
      blend: 'lighter',
      region: { y: [0.9, 1] },
      pulse: { amp: 0.15, period: 2600 },
      motion: { type: 'drift', speed: [0.0002778, 0.001389], angle: 180, bob: 0.0009259 },
    },
  ],
};
