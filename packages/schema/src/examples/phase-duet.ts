import type { SaverSpec } from "../types";

/**
 * Phase Duet — three layers on one clock.
 * A grid of sixty dots ripples as a traveling wave (`pulse.wave`), three rings
 * swell, and one soft heart breathes — and none of them drift apart, because
 * all three declare the same `clock`. `clock` is the format's answer to
 * coincidence: without it, `pulse`, `grow` and `cycle` run on per-entity
 * seeded phases, so two layers with the same period never line up (they are
 * a room full of people, not a duet). With one shared `clock: { phase: 0,
 * rate: 1 }` they breathe in step and stay there — period ÷ rate must stay
 * ≥ 1000 ms, which is why every layer here runs a 6000 ms cycle.
 */
export const PHASE_DUET_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: "phase-duet",
  label: "Phase Duet",
  seed: 88,
  motionIntensity: "calm",
  background: {
    type: "gradient",
    stops: [
      { at: 0, color: "#0a0f1c" },
      { at: 0.6, color: "#101b2e" },
      { at: 1, color: "#07141a" },
    ],
  },
  layers: [
    {
      key: "ripple",
      count: 60,
      sprite: {
        kind: "circle",
        radius: [0.0018, 0.003],
        color: "#6fd3c7",
        colors: ["#6fd3c7", "#9fb8d8"],
        colorWeights: [2, 1],
      },
      motion: { type: "static" },
      layout: { type: "grid", columns: 10, jitter: 0 },
      alpha: [0.3, 0.55],
      pulse: { amp: 0.35, period: 6000, wave: { wavelength: 0.7, angle: 25 } },
      clock: { phase: 0, rate: 1 },
    },
    {
      key: "rings",
      count: 3,
      sprite: {
        kind: "ring",
        radius: [0.05, 0.09],
        width: 0.0012,
        color: "#6fd3c7",
      },
      motion: { type: "static" },
      alpha: [0.25, 0.35],
      blend: "lighter",
      grow: { amp: 0.5, period: 6000 },
      clock: { phase: 0, rate: 1 },
    },
    {
      key: "heart",
      count: 1,
      sprite: {
        kind: "circle",
        radius: [0.11, 0.11],
        color: "#9fb8d8",
        soft: true,
      },
      motion: { type: "static" },
      position: { x: 0.5, y: 0.5 },
      alpha: [0.22, 0.22],
      blend: "lighter",
      grow: { amp: 0.25, period: 6000 },
      clock: { phase: 0, rate: 1 },
    },
  ],
};
