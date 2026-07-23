import type { SaverSpec } from '../types';

/**
 * Warp Tunnel: showcases `warp` motion (perspective depth — size/alpha/speed scale
 * with 1/z), `streak` sprites oriented along the analytic heading, `colorWeights`
 * (mostly white stars, occasional blue/amber), and light `ghosting` for smear.
 */
export const WARP_TUNNEL_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'warp-tunnel',
  label: 'Warp Tunnel',
  seed: 1701,
  motionIntensity: 'energetic',
  ghosting: 0.55,
  background: { type: 'solid', color: '#020208' },
  layers: [
    {
      key: 'far-stars',
      count: 150,
      sprite: {
        kind: 'streak',
        length: [0.008, 0.02],
        width: 0.0015,
        color: '#cfd8ff',
        colors: ['#cfd8ff', '#ffffff', '#8ab4ff', '#ffd9a0'],
        colorWeights: [5, 3, 1.5, 0.5],
      },
      motion: { type: 'warp', speed: [0.06, 0.16] },
      alpha: [0.5, 0.9],
      blend: 'lighter',
    },
    {
      key: 'near-stars',
      count: 50,
      sprite: {
        kind: 'streak',
        length: [0.025, 0.06],
        width: 0.0025,
        color: '#ffffff',
        colors: ['#ffffff', '#a8c8ff'],
        colorWeights: [3, 1],
      },
      motion: { type: 'warp', speed: [0.3, 0.55] },
      alpha: [0.7, 1],
      blend: 'lighter',
    },
    {
      key: 'core-glow',
      count: 1,
      sprite: { kind: 'circle', radius: [0.06, 0.06], color: '#3a4a8f', soft: true },
      motion: { type: 'static' },
      position: { x: 0.5, y: 0.5 },
      alpha: [0.35, 0.35],
      pulse: { amp: 0.15, period: 5000 },
      blend: 'lighter',
    },
  ],
};
