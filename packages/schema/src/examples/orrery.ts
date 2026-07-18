import type { SaverSpec } from '../types';

/**
 * Orrery: a mechanical solar system. Exercises orbit motion (concentric rings
 * at different speeds), spin (planets rotate on their axes), and grow (the sun
 * pulses). Soft glow circles with additive blending create the corona and
 * planetary halos.
 */
export const ORRERY_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'orrery',
  label: 'Orrery',
  seed: 7,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#020210' },
      { at: 0.5, color: '#06051a' },
      { at: 1, color: '#0a0820' },
    ],
  },
  layers: [
    // Distant stars
    {
      count: 80,
      sprite: { kind: 'circle', radius: [0.3, 1.2], color: '#8899cc' },
      alpha: [0.2, 0.8],
      pulse: { amp: 0.3, period: 3000 },
      motion: { type: 'static' },
    },
    // Sun corona (soft glow)
    {
      key: 'corona',
      count: 1,
      sprite: { kind: 'circle', radius: [60, 60], color: '#ffaa22', soft: true },
      blend: 'lighter',
      alpha: [0.6, 0.6],
      grow: { amp: 0.15, period: 4000 },
      motion: { type: 'static' },
      position: { x: 0.5, y: 0.5 },
    },
    // Sun body
    {
      key: 'sun',
      count: 1,
      sprite: { kind: 'emoji', glyphs: ['☀️'] },
      size: [48, 48],
      grow: { amp: 0.08, period: 4000 },
      motion: { type: 'static' },
      position: { x: 0.5, y: 0.5 },
    },
    // Inner ring — small fast planets
    {
      key: 'inner',
      count: 3,
      sprite: { kind: 'emoji', glyphs: ['🪨', '🔴', '🟠'] },
      size: [16, 22],
      spin: 30,
      motion: { type: 'orbit', speed: [28, 42], radius: [80, 120] },
    },
    // Middle ring — gas giants
    {
      key: 'middle',
      count: 2,
      sprite: { kind: 'emoji', glyphs: ['🟤', '🪐'] },
      size: [28, 38],
      spin: -15,
      motion: { type: 'orbit', speed: [12, 20], radius: [160, 200] },
    },
    // Outer ring — ice giants
    {
      key: 'outer',
      count: 2,
      sprite: { kind: 'emoji', glyphs: ['🔵', '💎'] },
      size: [22, 30],
      spin: 10,
      motion: { type: 'orbit', speed: [5, 10], radius: [240, 300] },
    },
    // Orbital dust ring (soft glow particles orbiting slowly)
    {
      count: 24,
      sprite: { kind: 'circle', radius: [1, 3], color: '#ccaa66', soft: true },
      alpha: [0.15, 0.4],
      blend: 'lighter',
      pulse: { amp: 0.2, period: 2500 },
      motion: { type: 'orbit', speed: [2, 8], radius: [100, 320] },
    },
  ],
};
