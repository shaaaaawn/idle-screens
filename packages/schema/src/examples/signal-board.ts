import type { SaverSpec } from "../types";

/**
 * Signal Board — the instrument panel, laid out by the format.
 * A 3×3 table of data bars with their labels in a matching table, one
 * monospace caption, and a phosphor sweep crossing the frame every ~90
 * seconds. The teaching layer is `layout: { type: 'table', columns: 3 }`:
 * nine bars and nine labels are TWO layers, not eighteen positioned blocks —
 * entity i reads `values[i]` / `strings[i]` in reading order, and each bar
 * draws `length × values[i] / max` from its cell. `values` are paint, so
 * `setParam("readout.sprite.values", [...])` glides every bar at once, which
 * is the whole point of the shape: a live readout that never re-publishes.
 */
export const SIGNAL_BOARD_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: "signal-board",
  label: "Signal Board",
  seed: 707,
  motionIntensity: "calm",
  background: { type: "solid", color: "#0d0b08" },
  layers: [
    {
      key: "readout",
      count: 9,
      sprite: {
        kind: "bar",
        values: [62, 38, 84, 21, 55, 91, 44, 70, 29],
        max: 100,
        length: 0.24,
        thickness: 0.013,
        color: "#ffb000",
        direction: "right",
      },
      motion: { type: "static" },
      layout: { type: "table", columns: 3, gap: 0.07 },
      region: { x: [0.1, 0.9], y: [0.34, 0.78] },
      alpha: [0.5, 0.62],
    },
    {
      key: "labels",
      count: 9,
      sprite: {
        kind: "text",
        strings: [
          "A-01",
          "A-02",
          "A-03",
          "B-01",
          "B-02",
          "B-03",
          "C-01",
          "C-02",
          "C-03",
        ],
        color: "#b08a3a",
        font: "monospace",
        align: "left",
      },
      motion: { type: "static" },
      size: [0.011, 0.011],
      layout: { type: "table", columns: 3, gap: 0.07 },
      region: { x: [0.1, 0.9], y: [0.28, 0.72] },
      alpha: [0.55, 0.55],
    },
    {
      key: "caption",
      count: 1,
      sprite: {
        kind: "textBlock",
        text: "STATION 7 — QUIET HOURS",
        maxWidth: 0.6,
        fontSize: 0.022,
        lineHeight: 1.4,
        align: "left",
        anchor: "top-left",
        font: "bold monospace",
        color: "#c8862a",
      },
      motion: { type: "static" },
      position: { x: 0.1, y: 0.14 },
      alpha: [0.8, 0.8],
    },
    {
      key: "sweep",
      count: 1,
      sprite: {
        kind: "stroke",
        length: [1.4, 1.4],
        points: [
          [-1, 0],
          [1, 0],
        ],
        width: 0.0016,
        color: "#33ff66",
      },
      motion: { type: "drift", speed: [0.012, 0.012], angle: 90 },
      alpha: [0.22, 0.22],
      blend: "screen",
    },
  ],
};
