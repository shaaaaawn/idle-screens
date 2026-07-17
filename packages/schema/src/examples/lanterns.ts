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
      sprite: { kind: 'circle', radius: [0.5, 1.4], color: '#8fa0c8' },
      alpha: [0.35, 1],
      region: { y: [0, 0.62] },
      motion: { type: 'drift', speed: [0.5, 2], bob: 1 },
    },
    {
      count: 36,
      sprite: {
        kind: 'circle',
        radius: [1.5, 3],
        color: '#b06a2a',
        soft: true,
      },
      alpha: [0.5, 0.9],
      blend: 'lighter',
      pulse: { amp: 0.18, period: 2800 },
      motion: { type: 'rise', speed: [6, 14], sway: 4 },
    },
    {
      count: 14,
      sprite: {
        kind: 'circle',
        radius: [3.5, 6.5],
        color: '#e08a34',
        soft: true,
      },
      alpha: [0.6, 1],
      blend: 'lighter',
      pulse: { amp: 0.22, period: 3400 },
      motion: { type: 'rise', speed: [16, 28], sway: 7 },
    },
    {
      count: 8,
      sprite: { kind: 'emoji', glyphs: ['🏮'] },
      size: [26, 44],
      alpha: [0.85, 1],
      motion: { type: 'rise', speed: [30, 48], sway: 10 },
    },
    {
      count: 4,
      sprite: { kind: 'emoji', glyphs: ['🏮'] },
      size: [58, 84],
      motion: { type: 'rise', speed: [52, 74], sway: 14 },
    },
    {
      count: 12,
      sprite: { kind: 'circle', radius: [2, 5], color: '#e08a34', soft: true },
      alpha: [0.12, 0.35],
      blend: 'lighter',
      region: { y: [0.93, 1] },
      pulse: { amp: 0.1, period: 2200 },
      motion: { type: 'drift', speed: [2, 6], bob: 2 },
    },
  ],
};
