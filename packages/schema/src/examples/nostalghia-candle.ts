import type { SaverSpec } from '../types';

/**
 * Tarkovsky — Nostalghia's candle: a single point of devotion.
 * Near-black warm ground; one small warm-white flame at center with grow/pulse
 * wobble; faint smoke rising; sparse amber embers with long fading trails;
 * a wide near-invisible halo breathing on a 10s cycle. Minimalism as tension —
 * most of the screen is darkness.
 *
 * Note: `pulse.amp` is ADDED to base alpha (not multiplied), so the halo's amp
 * must stay below its base alpha or the trough clamps to fully invisible.
 */
export const NOSTALGHIA_CANDLE_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'nostalghia-candle',
  label: "Nostalghia's Candle",
  seed: 1983,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#050302' },
      { at: 0.55, color: '#0a0704' },
      { at: 1, color: '#120c08' },
    ],
  },
  layers: [
    {
      key: 'halo',
      count: 1,
      position: { x: 0.5, y: 0.52 },
      sprite: {
        kind: 'circle',
        radius: [0.11, 0.11],
        color: '#c4782a',
        soft: true,
      },
      // Base 0.04 + amp 0.02 → breathes ~0.02..0.06; never clamps to 0.
      // (pulse.amp is ADDED to alpha, not multiplied.) Kept subordinate to the flame.
      alpha: [0.04, 0.04],
      blend: 'lighter',
      pulse: { amp: 0.02, period: 10000 },
      grow: { amp: 0.08, period: 10000 },
      motion: { type: 'static' },
    },
    {
      key: 'smoke',
      count: 3,
      sprite: {
        kind: 'circle',
        radius: [0.01, 0.022],
        color: '#6a6258',
        soft: true,
      },
      alpha: [0.02, 0.04],
      blend: 'lighter',
      region: { x: [0.46, 0.54], y: [0.36, 0.48] },
      pulse: { amp: 0.015, period: 4500 },
      motion: { type: 'rise', speed: [0.002, 0.004], sway: 0.008 },
    },
    {
      key: 'flame-glow',
      count: 1,
      sprite: {
        kind: 'circle',
        radius: [0.028, 0.028],
        color: '#ffb040',
        soft: true,
      },
      alpha: [0.32, 0.32],
      blend: 'lighter',
      pulse: { amp: 0.12, period: 1400 },
      grow: { amp: 0.4, period: 1600 },
      // Tiny orbit = positional lean without drifting off-center (wander has vx).
      motion: {
        type: 'orbit',
        speed: [18, 18],
        radius: [0.003, 0.003],
        center: { x: 0.5, y: 0.52 },
      },
    },
    {
      key: 'flame-core',
      count: 1,
      sprite: {
        kind: 'circle',
        radius: [0.014, 0.014],
        color: '#fff6e0',
        soft: true,
      },
      alpha: [0.95, 0.95],
      blend: 'lighter',
      pulse: { amp: 0.25, period: 900 },
      grow: { amp: 0.55, period: 1100 },
      motion: {
        type: 'orbit',
        speed: [22, 22],
        radius: [0.0025, 0.0025],
        center: { x: 0.5, y: 0.52 },
      },
    },
    {
      key: 'embers',
      count: 7,
      sprite: {
        kind: 'circle',
        radius: [0.0018, 0.004],
        color: '#e08a34',
        soft: true,
      },
      alpha: [0.4, 0.8],
      blend: 'lighter',
      region: { x: [0.35, 0.65], y: [0.4, 0.7] },
      pulse: { amp: 0.2, period: 2200 },
      trail: { length: 2200, fade: 1 },
      motion: {
        type: 'drift',
        speed: [0.004, 0.012],
        angle: 270,
        bob: 0.008,
      },
    },
  ],
};
