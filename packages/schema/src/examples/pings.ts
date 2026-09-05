import type { SaverSpec } from '../types';

/**
 * Pings — almost nothing, almost never.
 * A near-black ground and one teal hue. Three rings take turns: each one
 * appears, expands to sixteen times its size and fades over five seconds,
 * then the frame is empty until the next — `emit` with `jitter: 0` spaces
 * them evenly, one event every four seconds. Underneath, a few motes rise,
 * `settle` to rest and fade on their own, longer, seeded schedule. Nothing
 * travels; everything grows and goes. The house style Fathom describes this
 * exactly and, before `emit`, could not be authored.
 */
export const PINGS_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'pings',
  label: 'Pings',
  seed: 7,
  motionIntensity: 'calm',
  ghosting: 0.9,
  background: { type: 'solid', color: '#03060a' },
  layers: [
    {
      key: 'ping',
      count: 3,
      sprite: { kind: 'ring', radius: [0.05, 0.05], color: '#4fb3a8', width: 0.0015 },
      alpha: [0.35, 0.35],
      blend: 'lighter',
      region: { x: [0.2, 0.8], y: [0.25, 0.75] },
      motion: { type: 'static' },
      // One ring at a time: three entities evenly staggered across 12 s.
      emit: { every: 12000, life: 5000, jitter: 0, grow: [0.15, 2.4] },
    },
    {
      key: 'motes',
      count: 14,
      sprite: { kind: 'circle', radius: [0.0012, 0.002], color: '#4fb3a8', soft: true },
      alpha: [0.1, 0.22],
      blend: 'lighter',
      // Each mote is flung upward and comes to rest within ~2.5 s of its event.
      motion: { type: 'rise', speed: [0.01, 0.02], sway: 0.004, ease: { type: 'settle', tau: 2500 } },
      emit: { every: 16000, life: 7000, grow: [0.6, 1.4] },
    },
  ],
};
