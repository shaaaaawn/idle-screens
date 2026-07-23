import type { SaverSpec } from '../types';

/**
 * Aurora Borealis: the "fake fluid" recipe — showcases `wander` motion (harmonic
 * drift) with high `coherence` so the curtain undulates as one body, `pulse.wave`
 * (a traveling shimmer across the star field), weighted palettes, additive blend,
 * and `ghosting` smearing the soft glows into continuous curtains of light.
 */
export const AURORA_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'aurora',
  label: 'Aurora',
  seed: 66,
  motionIntensity: 'calm',
  ghosting: 0.85,
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#02030d' },
      { at: 0.65, color: '#050a18' },
      { at: 1, color: '#0a1220' },
    ],
    drift: { period: 40000, amount: 0.1 },
  },
  layers: [
    {
      key: 'stars',
      count: 110,
      sprite: { kind: 'circle', radius: [0.0005, 0.0015], color: '#e8ecff', soft: true },
      motion: { type: 'static' },
      region: { y: [0, 0.75] },
      alpha: [0.2, 0.6],
      // A slow shimmer travels across the sky instead of stars twinkling independently.
      pulse: { amp: 0.25, period: 6000, wave: { wavelength: 0.5, angle: 15 } },
    },
    {
      key: 'curtain-green',
      count: 100,
      sprite: {
        kind: 'circle',
        radius: [0.055, 0.11],
        color: '#1fd68a',
        soft: true,
        colors: ['#1fd68a', '#2ee6c8', '#4bd1ff'],
        colorWeights: [5, 2, 1],
      },
      motion: { type: 'wander', speed: [0.004, 0.012], angle: 0, meander: 0.13, coherence: 0.7 },
      region: { y: [0.1, 0.42] },
      alpha: [0.04, 0.1],
      blend: 'lighter',
      grow: { amp: 0.25, period: 9000 },
    },
    {
      key: 'curtain-violet',
      count: 60,
      sprite: {
        kind: 'circle',
        radius: [0.045, 0.09],
        color: '#8d5bff',
        soft: true,
        colors: ['#8d5bff', '#d14bff', '#ff4bd8'],
        colorWeights: [4, 1.5, 0.5],
      },
      motion: { type: 'wander', speed: [0.003, 0.01], angle: 180, meander: 0.1, coherence: 0.55 },
      region: { y: [0.04, 0.28] },
      alpha: [0.03, 0.08],
      blend: 'lighter',
      grow: { amp: 0.3, period: 12000 },
    },
    {
      key: 'fireflies',
      count: 14,
      sprite: { kind: 'circle', radius: [0.001, 0.003], color: '#b8ffe1', soft: true },
      motion: { type: 'wander', speed: [0.006, 0.02], meander: 0.06 },
      region: { y: [0.55, 0.95] },
      alpha: [0.2, 0.55],
      pulse: { amp: 0.3, period: 3500 },
      blend: 'lighter',
    },
  ],
};
