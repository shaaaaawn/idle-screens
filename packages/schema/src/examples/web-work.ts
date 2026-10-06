import type { SaverSpec } from "../types";

/**
 * Web Work — a randomised graph that fades with distance.
 * Forty-four drifting nodes wired `mode: 'random'` (a fixed deterministic
 * wiring, not k-nearest — the difference is topology: nearest gives
 * crystalline clusters, random gives a web that crosses itself) with
 * `falloff: true`, so an edge's alpha fades toward `maxDist` instead of
 * popping in at the cutoff. The second layer is a row of `orient: true`
 * strokes: the mark's +x axis turns to follow the entity's heading, so each
 * one reads as a wind tick rather than a stamp. Both are the difference
 * between "lines between dots" and a drawing.
 */
export const WEB_WORK_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: "web-work",
  label: "Web Work",
  seed: 31,
  motionIntensity: "calm",
  background: { type: "solid", color: "#04070c" },
  layers: [
    {
      key: "nodes",
      count: 44,
      sprite: {
        kind: "circle",
        radius: [0.0018, 0.0034],
        color: "#8fb4d8",
        colors: ["#8fb4d8", "#c9d8e6"],
        colorWeights: [2, 1],
      },
      motion: {
        type: "drift",
        speed: [0.002, 0.006],
        angle: 0,
        bidirectional: true,
      },
      alpha: [0.45, 0.8],
      links: {
        k: 3,
        maxDist: 0.3,
        color: "#5f7f9f",
        alpha: 0.16,
        width: 0.0005,
        mode: "random",
        falloff: true,
      },
    },
    {
      key: "flags",
      count: 22,
      sprite: {
        kind: "stroke",
        length: [0.02, 0.045],
        points: [
          [-1, 0.2],
          [-0.2, -0.5],
          [0.6, -0.3],
          [1, 0.1],
        ],
        width: 0.0016,
        taper: true,
        orient: true,
        color: "#6f93b8",
        colors: ["#6f93b8", "#9fb8d8"],
      },
      motion: {
        type: "drift",
        speed: [0.01, 0.03],
        angle: 0,
        bidirectional: true,
      },
      alpha: [0.3, 0.6],
    },
  ],
};
