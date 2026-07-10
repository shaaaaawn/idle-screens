import type { SaverSpec } from './types';

/**
 * Reproduces the hand-coded Fish Aquarium saver as pure DATA — the discriminating test
 * that the schema is actually expressive: two layers (fish drifting both ways at varied
 * speeds with a bob + flip, over a gradient with a seafloor band; bubbles rising with sway).
 */
export const AQUARIUM_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'aquarium',
  label: 'Aquarium',
  seed: 42,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#0a3a52' },
      { at: 0.6, color: '#062534' },
      { at: 1, color: '#02141d' },
    ],
    band: { color: '#0b1a12', height: 24 },
  },
  layers: [
    {
      count: 14,
      sprite: { kind: 'emoji', glyphs: ['🐟', '🐠', '🐡', '🦈', '🐙'] },
      size: [34, 72],
      motion: { type: 'drift', speed: [30, 110], bidirectional: true, bob: 6 },
      flip: true,
    },
    {
      count: 22,
      sprite: { kind: 'circle', radius: [2, 7], color: '#c8ebff' },
      motion: { type: 'rise', speed: [24, 78], sway: 8 },
    },
  ],
};

/** Rain: dense text streaks falling straight down over a near-black sky. */
export const RAIN_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'rain',
  label: 'Rain',
  seed: 7,
  motionIntensity: 'moderate',
  background: { type: 'solid', color: '#05070a' },
  layers: [
    {
      count: 140,
      sprite: { kind: 'text', strings: ['│'], color: '#9fd0ff' },
      size: [12, 26],
      motion: { type: 'drift', angle: 90, speed: [520, 900] },
    },
  ],
};

/** Snowfall: three depth layers of white circles drifting down with horizontal bob. */
export const SNOWFALL_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'snowfall',
  label: 'Snowfall',
  seed: 12,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#0a1628' },
      { at: 0.7, color: '#0d1f3c' },
      { at: 1, color: '#121212' },
    ],
  },
  layers: [
    {
      count: 50,
      sprite: { kind: 'circle', radius: [1, 2.5], color: '#8899aa' },
      motion: { type: 'drift', angle: 90, speed: [15, 40], bob: 3 },
    },
    {
      count: 35,
      sprite: { kind: 'circle', radius: [2, 4.5], color: '#c0cdd8' },
      motion: { type: 'drift', angle: 85, speed: [35, 80], bob: 6 },
    },
    {
      count: 15,
      sprite: { kind: 'circle', radius: [3.5, 7], color: '#e8eff5' },
      motion: { type: 'drift', angle: 82, speed: [55, 120], bob: 10 },
    },
  ],
};

/**
 * Night Lanterns (Yi Peng festival sky): depth from four correlated parallax cues —
 * closer layers are LARGER, FASTER, SWAY WIDER, and glow WARMER/BRIGHTER. v2 of this
 * composition exercises the expressive additions the first draft exposed as missing:
 * soft glow orbs + additive blend (lantern light that sums where it overlaps), bounded
 * alpha pulse with per-entity phases (breathing flames, strobe-proof by construction),
 * and spawn regions (stars only above the horizon; dim ember shimmer kept low near
 * the water line).
 */
export const LANTERNS_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'lanterns',
  label: 'Night Lanterns',
  seed: 88,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#04060f' },
      { at: 0.55, color: '#0b1026' },
      { at: 0.85, color: '#251731' },
      { at: 1, color: '#472518' },
    ],
  },
  layers: [
    {
      count: 60,
      sprite: { kind: 'circle', radius: [0.5, 1.4], color: '#8fa0c8' },
      alpha: [0.35, 1],
      region: { y: [0, 0.62] },
      motion: { type: 'drift', speed: [0.5, 2], bob: 1 },
    },
    {
      count: 36,
      sprite: {
        kind: 'circle',
        radius: [1.5, 3],
        color: '#b06a2a',
        soft: true,
      },
      alpha: [0.5, 0.9],
      blend: 'lighter',
      pulse: { amp: 0.18, period: 2800 },
      motion: { type: 'rise', speed: [6, 14], sway: 4 },
    },
    {
      count: 14,
      sprite: {
        kind: 'circle',
        radius: [3.5, 6.5],
        color: '#e08a34',
        soft: true,
      },
      alpha: [0.6, 1],
      blend: 'lighter',
      pulse: { amp: 0.22, period: 3400 },
      motion: { type: 'rise', speed: [16, 28], sway: 7 },
    },
    {
      count: 8,
      sprite: { kind: 'emoji', glyphs: ['🏮'] },
      size: [26, 44],
      alpha: [0.85, 1],
      motion: { type: 'rise', speed: [30, 48], sway: 10 },
    },
    {
      count: 4,
      sprite: { kind: 'emoji', glyphs: ['🏮'] },
      size: [58, 84],
      motion: { type: 'rise', speed: [52, 74], sway: 14 },
    },
    {
      count: 12,
      sprite: { kind: 'circle', radius: [2, 5], color: '#e08a34', soft: true },
      alpha: [0.12, 0.35],
      blend: 'lighter',
      region: { y: [0.93, 1] },
      pulse: { amp: 0.1, period: 2200 },
      motion: { type: 'drift', speed: [2, 6], bob: 2 },
    },
  ],
};

/**
 * Sakura Drift: cherry-blossom petals carried on a spring twilight breeze. Five
 * correlated-parallax layers build the depth — the far backdrop is a barely-moving
 * field of soft blossom-glow orbs (additive, breathing out of phase), then three
 * petal layers grow LARGER, FASTER, BRIGHTER and FLUTTER WIDER as they approach
 * (the near gust), over a blue-hour gradient with a warm rose horizon and a dark
 * grass band. A final low layer of dim pink glow settles at the grass line — fallen
 * petals catching the last light. Wind direction is consistent (down-left) across
 * every moving layer; petals differ from snowfall by glyph, colour, palette and the
 * diagonal breeze, and from lanterns by falling rather than rising.
 */
export const SAKURA_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'sakura',
  label: 'Sakura Drift',
  seed: 314,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#1b1d38' },
      { at: 0.45, color: '#3a2645' },
      { at: 0.8, color: '#7d3d4e' },
      { at: 1, color: '#0f140d' },
    ],
    band: { color: '#0c140d', height: 44 },
  },
  layers: [
    {
      count: 60,
      sprite: { kind: 'circle', radius: [0.6, 1.6], color: '#ffe3ec', soft: true },
      alpha: [0.3, 0.9],
      blend: 'lighter',
      region: { y: [0, 0.72] },
      pulse: { amp: 0.22, period: 3000 },
      motion: { type: 'drift', speed: [0.3, 1.2], bob: 1 },
    },
    {
      count: 28,
      sprite: { kind: 'emoji', glyphs: ['🌸'] },
      size: [13, 20],
      alpha: [0.5, 0.8],
      motion: { type: 'drift', speed: [12, 26], angle: 100, bob: 3 },
    },
    {
      count: 18,
      sprite: { kind: 'emoji', glyphs: ['🌸'] },
      size: [20, 32],
      alpha: [0.7, 0.95],
      motion: { type: 'drift', speed: [24, 44], angle: 100, bob: 6 },
    },
    {
      count: 10,
      sprite: { kind: 'emoji', glyphs: ['🌸'] },
      size: [34, 54],
      alpha: [0.85, 1],
      motion: { type: 'drift', speed: [42, 68], angle: 100, bob: 11 },
    },
    {
      count: 16,
      sprite: { kind: 'circle', radius: [1.5, 4], color: '#ff9bb5', soft: true },
      alpha: [0.1, 0.3],
      blend: 'lighter',
      region: { y: [0.9, 1] },
      pulse: { amp: 0.15, period: 2600 },
      motion: { type: 'drift', speed: [0.3, 1.5], angle: 180, bob: 1 },
    },
  ],
};

/**
 * Dev Dashboard: a dense ops-style HUD exercising static positioning, keyed layers,
 * and text alignment at scale. Two ambient particle layers provide depth behind 28
 * pinned text elements arranged in a three-column layout with header, metrics,
 * file list, and scrolling event log.
 */
export const DASHBOARD_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'dev-dashboard',
  label: 'Dev Dashboard',
  seed: 256,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#06060c' },
      { at: 0.5, color: '#0a0a14' },
      { at: 1, color: '#0c0c18' },
    ],
  },
  layers: [
    // --- ambient depth ---
    {
      count: 50,
      sprite: { kind: 'circle', radius: [0.2, 0.8], color: '#1a2538' },
      alpha: [0.1, 0.25],
      motion: { type: 'drift', speed: [0.3, 1.2], bob: 0.3 },
    },
    {
      count: 12,
      sprite: { kind: 'circle', radius: [1, 2.5], color: '#1a3050', soft: true },
      alpha: [0.08, 0.18],
      blend: 'lighter',
      pulse: { amp: 0.08, period: 4000 },
      motion: { type: 'drift', speed: [0.5, 1.5], bob: 0.5 },
    },
    // --- header ---
    {
      key: 'title', count: 1,
      position: { x: 0.5, y: 0.04 },
      sprite: { kind: 'text', strings: ['DEV PULSE'], color: '#556677',
        font: "600 13px 'SF Mono', monospace", align: 'center' },
      motion: { type: 'static' },
    },
    {
      key: 'status', count: 1,
      position: { x: 0.92, y: 0.04 },
      sprite: { kind: 'text', strings: ['● ACTIVE'], color: '#44cc66',
        font: "bold 10px monospace", align: 'right' },
      motion: { type: 'static' },
    },
    {
      key: 'uptime', count: 1,
      position: { x: 0.08, y: 0.04 },
      sprite: { kind: 'text', strings: ['up 2h 14m'], color: '#445566',
        font: "10px monospace", align: 'left' },
      motion: { type: 'static' },
    },
    // --- left column: metrics ---
    {
      key: 'tools-label', count: 1,
      position: { x: 0.06, y: 0.12 },
      sprite: { kind: 'text', strings: ['TOOL CALLS'], color: '#445566',
        font: '9px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    {
      key: 'tools-value', count: 1,
      position: { x: 0.06, y: 0.16 },
      sprite: { kind: 'text', strings: ['147'], color: '#44aaff',
        font: 'bold 28px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    {
      key: 'reads-label', count: 1,
      position: { x: 0.06, y: 0.26 },
      sprite: { kind: 'text', strings: ['READS'], color: '#445566',
        font: '9px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    {
      key: 'reads-value', count: 1,
      position: { x: 0.06, y: 0.30 },
      sprite: { kind: 'text', strings: ['89'], color: '#44ddcc',
        font: 'bold 28px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    {
      key: 'edits-label', count: 1,
      position: { x: 0.06, y: 0.40 },
      sprite: { kind: 'text', strings: ['EDITS'], color: '#445566',
        font: '9px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    {
      key: 'edits-value', count: 1,
      position: { x: 0.06, y: 0.44 },
      sprite: { kind: 'text', strings: ['34'], color: '#ff8844',
        font: 'bold 28px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    {
      key: 'errors-label', count: 1,
      position: { x: 0.06, y: 0.54 },
      sprite: { kind: 'text', strings: ['ERRORS'], color: '#445566',
        font: '9px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    {
      key: 'errors-value', count: 1,
      position: { x: 0.06, y: 0.58 },
      sprite: { kind: 'text', strings: ['2'], color: '#ff4455',
        font: 'bold 28px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    // --- center column: system gauges ---
    {
      key: 'cpu-label', count: 1,
      position: { x: 0.38, y: 0.12 },
      sprite: { kind: 'text', strings: ['CPU'], color: '#445566',
        font: '9px monospace', align: 'center' },
      motion: { type: 'static' },
    },
    {
      key: 'cpu-value', count: 1,
      position: { x: 0.38, y: 0.22 },
      sprite: { kind: 'text', strings: ['73%'], color: '#44ff88',
        font: 'bold 36px monospace', align: 'center' },
      motion: { type: 'static' },
    },
    {
      key: 'mem-label', count: 1,
      position: { x: 0.38, y: 0.36 },
      sprite: { kind: 'text', strings: ['MEMORY'], color: '#445566',
        font: '9px monospace', align: 'center' },
      motion: { type: 'static' },
    },
    {
      key: 'mem-value', count: 1,
      position: { x: 0.38, y: 0.46 },
      sprite: { kind: 'text', strings: ['4.2 GB'], color: '#ddcc44',
        font: 'bold 36px monospace', align: 'center' },
      motion: { type: 'static' },
    },
    {
      key: 'tokens-label', count: 1,
      position: { x: 0.38, y: 0.58 },
      sprite: { kind: 'text', strings: ['TOKENS'], color: '#445566',
        font: '9px monospace', align: 'center' },
      motion: { type: 'static' },
    },
    {
      key: 'tokens-value', count: 1,
      position: { x: 0.38, y: 0.66 },
      sprite: { kind: 'text', strings: ['128k'], color: '#aa88ff',
        font: 'bold 28px monospace', align: 'center' },
      motion: { type: 'static' },
    },
    // --- right column: recent files ---
    {
      key: 'files-label', count: 1,
      position: { x: 0.62, y: 0.12 },
      sprite: { kind: 'text', strings: ['RECENT FILES'], color: '#445566',
        font: '9px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    {
      key: 'file-1', count: 1,
      position: { x: 0.62, y: 0.17 },
      sprite: { kind: 'text', strings: ['src/worker.ts'], color: '#8899aa',
        font: '11px monospace', align: 'left', baseline: 'top', maxWidth: 280 },
      motion: { type: 'static' },
    },
    {
      key: 'file-2', count: 1,
      position: { x: 0.62, y: 0.21 },
      sprite: { kind: 'text', strings: ['site/src/App.tsx'], color: '#778899',
        font: '11px monospace', align: 'left', baseline: 'top', maxWidth: 280 },
      motion: { type: 'static' },
    },
    {
      key: 'file-3', count: 1,
      position: { x: 0.62, y: 0.25 },
      sprite: { kind: 'text', strings: ['packages/schema/compile.ts'], color: '#667788',
        font: '11px monospace', align: 'left', baseline: 'top', maxWidth: 280 },
      motion: { type: 'static' },
    },
    {
      key: 'file-4', count: 1,
      position: { x: 0.62, y: 0.29 },
      sprite: { kind: 'text', strings: ['docs/dashboard-spec.md'], color: '#556677',
        font: '11px monospace', align: 'left', baseline: 'top', maxWidth: 280 },
      motion: { type: 'static' },
    },
    {
      key: 'file-5', count: 1,
      position: { x: 0.62, y: 0.33 },
      sprite: { kind: 'text', strings: ['packages/core/types.ts'], color: '#445566',
        font: '11px monospace', align: 'left', baseline: 'top', maxWidth: 280 },
      motion: { type: 'static' },
    },
    // --- right column: session info ---
    {
      key: 'session-label', count: 1,
      position: { x: 0.62, y: 0.42 },
      sprite: { kind: 'text', strings: ['SESSION'], color: '#445566',
        font: '9px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    {
      key: 'session-model', count: 1,
      position: { x: 0.62, y: 0.47 },
      sprite: { kind: 'text', strings: ['claude-opus-4-6'], color: '#8888aa',
        font: '11px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    {
      key: 'session-cost', count: 1,
      position: { x: 0.62, y: 0.51 },
      sprite: { kind: 'text', strings: ['$2.47 this session'], color: '#667788',
        font: '11px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    // --- bottom: event log ---
    {
      key: 'log-label', count: 1,
      position: { x: 0.06, y: 0.76 },
      sprite: { kind: 'text', strings: ['EVENT LOG'], color: '#445566',
        font: '9px monospace', align: 'left', baseline: 'top' },
      motion: { type: 'static' },
    },
    {
      key: 'log-1', count: 1,
      position: { x: 0.06, y: 0.80 },
      sprite: { kind: 'text', strings: ['14:07  Edit compile.ts +18 -3'], color: '#667766',
        font: '10px monospace', align: 'left', baseline: 'top', maxWidth: 600 },
      motion: { type: 'static' },
    },
    {
      key: 'log-2', count: 1,
      position: { x: 0.06, y: 0.84 },
      sprite: { kind: 'text', strings: ['14:06  Bash pnpm test  ✓ 125 passed'], color: '#556655',
        font: '10px monospace', align: 'left', baseline: 'top', maxWidth: 600 },
      motion: { type: 'static' },
    },
    {
      key: 'log-3', count: 1,
      position: { x: 0.06, y: 0.88 },
      sprite: { kind: 'text', strings: ['14:05  Read types.ts  (121 lines)'], color: '#4d5e4d',
        font: '10px monospace', align: 'left', baseline: 'top', maxWidth: 600 },
      motion: { type: 'static' },
    },
    {
      key: 'log-4', count: 1,
      position: { x: 0.06, y: 0.92 },
      sprite: { kind: 'text', strings: ['14:03  Edit examples.ts +84 -1'], color: '#445544',
        font: '10px monospace', align: 'left', baseline: 'top', maxWidth: 600 },
      motion: { type: 'static' },
    },
    {
      key: 'log-5', count: 1,
      position: { x: 0.06, y: 0.96 },
      sprite: { kind: 'text', strings: ['14:01  Bash pnpm build  ✓ 6 packages'], color: '#3d4e3d',
        font: '10px monospace', align: 'left', baseline: 'top', maxWidth: 600 },
      motion: { type: 'static' },
    },
  ],
};

export const EXAMPLE_SPECS: SaverSpec[] = [
  AQUARIUM_SPEC,
  RAIN_SPEC,
  SNOWFALL_SPEC,
  LANTERNS_SPEC,
  SAKURA_SPEC,
  DASHBOARD_SPEC,
];
