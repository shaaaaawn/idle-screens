import type { SaverSpec } from '../types';

/**
 * Sakura Drift: cherry-blossom petals carried on a spring twilight breeze.
 * Glow-up pass (v1-ceiling features): petals ride `wander` harmonics with shared
 * `coherence` so gusts move the whole fall together, `spin` tumbles the glyphs,
 * faint `streak` wind-lines cross the frame, the blossom-glow backdrop shimmers
 * as a traveling `pulse.wave`, and dusk fireflies wander the lower field. The
 * ground is a warm plum earth blended out of the sunset (no more abrupt dark
 * band), with slow background `drift` keeping the sky alive.
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
      { at: 0.78, color: '#7d3d4e' },
      { at: 0.92, color: '#4a2438' },
      { at: 1, color: '#1c1018' },
    ],
    drift: { period: 35000, amount: 0.08 },
  },
  layers: [
    {
      key: 'blossom-glow',
      count: 60,
      sprite: {
        kind: 'circle',
        radius: [0.0005556, 0.001481],
        color: '#ffe3ec',
        soft: true,
      },
      alpha: [0.3, 0.9],
      blend: 'lighter',
      region: { y: [0, 0.72] },
      // Shimmer travels across the sky instead of orbs twinkling independently.
      pulse: { amp: 0.22, period: 4000, wave: { wavelength: 0.45, angle: 10 } },
      motion: { type: 'drift', speed: [0.0002778, 0.001111], bob: 0.0009259 },
    },
    {
      key: 'petals-far',
      count: 28,
      sprite: { kind: 'emoji', glyphs: ['🌸'] },
      size: [0.01204, 0.01852],
      alpha: [0.5, 0.8],
      spin: 16,
      motion: {
        type: 'wander',
        speed: [0.011, 0.024],
        angle: 100,
        meander: 0.025,
        coherence: 0.35,
      },
    },
    {
      key: 'petals-mid',
      count: 18,
      sprite: { kind: 'emoji', glyphs: ['🌸'] },
      size: [0.01852, 0.02963],
      alpha: [0.7, 0.95],
      spin: 24,
      motion: {
        type: 'wander',
        speed: [0.022, 0.041],
        angle: 100,
        meander: 0.045,
        coherence: 0.35,
      },
    },
    {
      key: 'petals-near',
      count: 10,
      sprite: { kind: 'emoji', glyphs: ['🌸'] },
      size: [0.03148, 0.05],
      alpha: [0.85, 1],
      spin: 32,
      motion: {
        type: 'wander',
        speed: [0.039, 0.063],
        angle: 100,
        meander: 0.07,
        coherence: 0.35,
      },
    },
    {
      key: 'gusts',
      count: 7,
      sprite: {
        kind: 'streak',
        length: [0.02, 0.045],
        width: 0.0012,
        color: '#ffd9e6',
      },
      alpha: [0.1, 0.22],
      blend: 'lighter',
      motion: { type: 'drift', speed: [0.09, 0.14], angle: 100 },
    },
    {
      key: 'fireflies',
      count: 6,
      sprite: {
        kind: 'circle',
        radius: [0.0009, 0.002],
        color: '#ffe9a8',
        soft: true,
      },
      alpha: [0.15, 0.5],
      blend: 'lighter',
      region: { y: [0.6, 0.9] },
      pulse: { amp: 0.3, period: 2800 },
      motion: { type: 'wander', speed: [0.004, 0.01], meander: 0.05 },
    },
    {
      key: 'fallen-petals',
      count: 16,
      sprite: {
        kind: 'circle',
        radius: [0.001389, 0.003704],
        color: '#ff9bb5',
        soft: true,
      },
      alpha: [0.1, 0.3],
      blend: 'lighter',
      region: { y: [0.9, 1] },
      // Settled petals catch the last light in a slow wave along the ground.
      pulse: { amp: 0.15, period: 3200, wave: { wavelength: 0.3, angle: 0 } },
      motion: {
        type: 'drift',
        speed: [0.0002778, 0.001389],
        angle: 180,
        bob: 0.0009259,
      },
    },
  ],
};
