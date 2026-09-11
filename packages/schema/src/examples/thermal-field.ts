import type { SaverSpec } from '../types';

/**
 * Thermal Field: the `field` background — seeded, domain-warped value noise
 * posterised into six riso inks (`quantize: 6`, one hard band per level) and
 * drifting once every forty seconds, so the contours crawl like a weather
 * chart. The foreground is deliberately almost nothing: a handful of pale
 * motes screened over the bands, so the ground IS the piece. A house
 * `thermal` look; the same field with `quantize: 0` is a smooth aura. A
 * `finish` of grain and dither screens the whole frame like a riso print.
 */
export const THERMAL_FIELD_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'thermal-field',
  label: 'Thermal Field',
  seed: 71,
  motionIntensity: 'calm',
  // The riso print: grain at half strength, a light dither screen — the
  // finish that makes the flat inks read as paper rather than pixels.
  finish: { grain: 0.5, dither: 0.3 },
  background: {
    type: 'field',
    scale: 2.2,
    octaves: 3,
    warp: 0.4,
    quantize: 6,
    bands: ['#1b1a3a', '#0078bf', '#00a99d', '#ffe800', '#ff6c2f', '#ff48b0'],
    drift: { period: 40000, amount: 0.3 },
  },
  layers: [
    {
      key: 'motes',
      count: 14,
      sprite: { kind: 'circle', radius: [0.012, 0.028], color: '#fff6e0', soft: true },
      motion: { type: 'wander', speed: [0.003, 0.008], meander: 0.04, coherence: 0.3 },
      alpha: [0.18, 0.4],
      blend: 'screen',
      pulse: { amp: 0.15, period: 9000 },
    },
  ],
};
