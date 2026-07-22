import type { SaverSpec } from '../types';

/**
 * Night Lanterns (Yi Peng festival sky): depth from four correlated parallax cues —
 * closer layers are LARGER, FASTER, SWAY WIDER, and glow WARMER/BRIGHTER. v2 of this
 * composition exercises the expressive additions the first draft exposed as missing:
 * soft glow orbs + additive blend (lantern light that sums where it overlaps), bounded
 * alpha pulse with per-entity phases (breathing flames, strobe-proof by construction),
 * and spawn regions (stars only above the horizon; dim ember shimmer kept low near
 * the water line).
 */
export const LANTERNS_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'lanterns',
  label: 'Night Lanterns',
  seed: 88,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#04060f' },
      { at: 0.55, color: '#0b1026' },
      { at: 0.85, color: '#251731' },
      { at: 1, color: '#472518' },
    ],
  },
  layers: [
    {
      count: 60,
      sprite: { kind: 'circle', radius: [0.000463, 0.001296], color: '#8fa0c8' },
      alpha: [0.35, 1],
      region: { y: [0, 0.62] },
      motion: { type: 'drift', speed: [0.000463, 0.001852], bob: 0.0009259 },
    },
    {
      count: 36,
      sprite: {
        kind: 'circle',
        radius: [0.001389, 0.002778],
        color: '#b06a2a',
        soft: true,
      },
      alpha: [0.5, 0.9],
      blend: 'lighter',
      pulse: { amp: 0.18, period: 2800 },
      motion: { type: 'rise', speed: [0.005556, 0.01296], sway: 0.003704 },
    },
    {
      count: 14,
      sprite: {
        kind: 'circle',
        radius: [0.003241, 0.006019],
        color: '#e08a34',
        soft: true,
      },
      alpha: [0.6, 1],
      blend: 'lighter',
      pulse: { amp: 0.22, period: 3400 },
      motion: { type: 'rise', speed: [0.01481, 0.02593], sway: 0.006481 },
    },
    {
      count: 8,
      sprite: { kind: 'emoji', glyphs: ['🏮'] },
      size: [0.02407, 0.04074],
      alpha: [0.85, 1],
      motion: { type: 'rise', speed: [0.02778, 0.04444], sway: 0.009259 },
    },
    {
      count: 4,
      sprite: { kind: 'emoji', glyphs: ['🏮'] },
      size: [0.0537, 0.07778],
      motion: { type: 'rise', speed: [0.04815, 0.06852], sway: 0.01296 },
    },
    {
      count: 12,
      sprite: { kind: 'circle', radius: [0.001852, 0.00463], color: '#e08a34', soft: true },
      alpha: [0.12, 0.35],
      blend: 'lighter',
      region: { y: [0.93, 1] },
      pulse: { amp: 0.1, period: 2200 },
      motion: { type: 'drift', speed: [0.001852, 0.005556], bob: 0.001852 },
    },
  ],
};
