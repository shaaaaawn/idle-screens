import type { SaverSpec } from "../types";

/**
 * Sparse Night — emptiness, declared as intent.
 * A star-grain field (radius under 0.001 — the rung FORMAT.md's ladder calls
 * texture, never the subject) over near-black, one faint linked pentagon as
 * the only figure, and a single satellite that flares for three seconds out of
 * every eighteen. Measured coverage sits around one percent, which `adviseSpec`
 * would flag as `sparse-scene` at every legal count — the spec's
 * `density: 'sparse'` declaration is the point of this example: it withholds
 * that advisory AND opts the scene into `density-mismatch` instead, so the
 * emptiness is a claim the perception API checks rather than a gap it nags
 * about. Before `density` shipped, restraint like this could not pass advise
 * clean; the one-mark house style sat at the suite floor for exactly this
 * reason.
 */
export const SPARSE_NIGHT_SPEC: SaverSpec = {
     schemaVersion: 1,
     id: "sparse-night",
     label: "Sparse Night",
     seed: 101,
     motionIntensity: "calm",
     density: "sparse",
     background: { type: "solid", color: "#02030a" },
     layers: [
          {
               key: "grain",
               count: 110,
               sprite: {
                    kind: "circle",
                    radius: [0.0003, 0.0009],
                    color: "#c9d4e6",
               },
               motion: { type: "static" },
               alpha: [0.05, 0.3],
               pulse: { amp: 0.08, period: 7000 },
          },
          {
               key: "figure",
               count: 5,
               sprite: {
                    kind: "circle",
                    radius: [0.0016, 0.0022],
                    color: "#dfe8f2",
               },
               motion: { type: "drift", speed: [0.0004, 0.0009] },
               alpha: [0.4, 0.7],
               region: { x: [0.36, 0.64], y: [0.32, 0.62] },
               links: {
                    k: 2,
                    maxDist: 0.09,
                    color: "#7f97b8",
                    alpha: 0.16,
                    width: 0.0004,
                    mode: "chain",
                    closed: true,
               },
          },
          {
               key: "satellite",
               count: 1,
               sprite: {
                    kind: "circle",
                    radius: [0.0024, 0.0024],
                    color: "#e8b04a",
                    soft: true,
               },
               motion: { type: "orbit", speed: [3, 3], radius: [0.34, 0.4] },
               alpha: [0.85, 0.85],
               blend: "lighter",
               emit: { every: 18000, life: 3000, jitter: 0, grow: [0.5, 1.6] },
          },
     ],
};
