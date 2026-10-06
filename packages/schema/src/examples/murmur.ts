import type { SaverSpec } from "../types";

/**
 * Murmur — a flock with no birds in it.
 * Six hundred and twenty entities: two registers of streaks (260 each) on
 * harmonic `wander` with `coherence` near 1, so each layer folds and wheels as
 * one body, and a static grain layer behind them. Nothing here
 * interacts — no entity reads another's position — which is the trick the
 * format is built on: a shared harmonic set plus a wide speed range reads as
 * a murmuration while staying a pure function of (seed, t), so it replays
 * identically and seeks instantly. `density: 'dense'` is doing real work:
 * past 500 entities `adviseSpec` raises `dense-scene`, and the declaration
 * says the crowding is the subject rather than a mistake — while still opting
 * into `density-mismatch` if the scene ever measures as empty instead.
 */
export const MURMUR_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: "murmur",
  label: "Murmur",
  seed: 512,
  motionIntensity: "moderate",
  density: "dense",
  background: {
    type: "gradient",
    stops: [
      { at: 0, color: "#151a26" },
      { at: 0.5, color: "#232c3d" },
      { at: 1, color: "#3a3f52" },
    ],
  },
  layers: [
    {
      key: "flock-a",
      count: 260,
      sprite: {
        kind: "streak",
        length: [0.004, 0.012],
        width: 0.0012,
        color: "#c9d4e6",
        colors: ["#c9d4e6", "#8fa6c4"],
        colorWeights: [2, 1],
      },
      motion: {
        type: "wander",
        speed: [0.015, 0.06],
        meander: 0.05,
        coherence: 0.95,
      },
      alpha: [0.25, 0.6],
      blend: "screen",
    },
    {
      // The cap is 400 per layer, so a flock above it is two registers of the
      // same body — slightly different speed and length ranges read as depth.
      key: "flock-b",
      count: 260,
      sprite: {
        kind: "streak",
        length: [0.006, 0.014],
        width: 0.0012,
        color: "#8fa6c4",
        colors: ["#8fa6c4", "#c9d4e6"],
        colorWeights: [2, 1],
      },
      motion: {
        type: "wander",
        speed: [0.02, 0.05],
        meander: 0.045,
        coherence: 0.93,
      },
      alpha: [0.2, 0.5],
      blend: "screen",
    },
    {
      key: "grain",
      count: 100,
      sprite: { kind: "circle", radius: [0.0005, 0.0012], color: "#c9d4e6" },
      motion: { type: "static" },
      alpha: [0.06, 0.2],
    },
  ],
};
