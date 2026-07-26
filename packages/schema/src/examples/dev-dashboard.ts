import type { SaverSpec } from '../types';

/**
 * Control Center — VIREO-9, Trans-Lunar Relay Operations.
 *
 * A mission-control WALL BOARD, laid out the way real ops rooms lay them out:
 * framed zones with a clear reading order, one hero display (the orbital
 * plot), dense-but-calm peripheral telemetry, and a boot sequence when the
 * board comes up. The fiction: a small relay station somewhere past GEO,
 * mid-shift, tracking a five-craft fleet (named for this library's own
 * savers — the station runs our little universe).
 *
 * Composed against the validator's 36-layer ceiling deliberately — every
 * layer earns its slot. Schema exercises: grid `layout` LED wall with a
 * traveling `pulse.wave`, `orbit` motion with `trail`s and chain `links`
 * (the relay web between the fleet), `ring` orbit guides, wave-phased rect
 * meters, staged `life` boots per zone. Every reading is keyed so an agent
 * can steer the fiction live (`signal-value`, `feed-1`, `alert`, ...).
 */
export const DASHBOARD_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'dev-dashboard',
  label: 'Control Center',
  seed: 256,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#05070d' },
      { at: 0.55, color: '#080b14' },
      { at: 1, color: '#0a0d18' },
    ],
  },
  layers: [
    // ---- ambient: the LED wall behind everything ----
    {
      key: 'led-wall',
      count: 240,
      sprite: { kind: 'circle', radius: [0.0007, 0.0011], color: '#22344c' },
      alpha: [0.04, 0.1],
      layout: { type: 'grid', columns: 24, jitter: 0.1 },
      pulse: { amp: 0.3, period: 6200, wave: { wavelength: 0.4, angle: 24 } },
      motion: { type: 'static' },
    },
    // ---- frame chrome (boots first) ----
    {
      key: 'rule-header', count: 1,
      position: { x: 0.5, y: 0.085 },
      sprite: { kind: 'rect', width: [0.93, 0.93], aspect: [0.0012, 0.0012], color: '#24384f' },
      alpha: [0.8, 0.8],
      motion: { type: 'static' },
      life: { enter: 100, fade: 400 },
    },
    {
      key: 'rule-footer', count: 1,
      position: { x: 0.5, y: 0.915 },
      sprite: { kind: 'rect', width: [0.93, 0.93], aspect: [0.0012, 0.0012], color: '#24384f' },
      alpha: [0.8, 0.8],
      motion: { type: 'static' },
      life: { enter: 100, fade: 400 },
    },
    {
      key: 'rule-col-left', count: 1,
      position: { x: 0.265, y: 0.5 },
      sprite: { kind: 'rect', width: [0.0009, 0.0009], aspect: [620, 620], color: '#1c2c40' },
      alpha: [0.7, 0.7],
      motion: { type: 'static' },
      life: { enter: 100, fade: 400 },
    },
    {
      key: 'rule-col-right', count: 1,
      position: { x: 0.645, y: 0.5 },
      sprite: { kind: 'rect', width: [0.0009, 0.0009], aspect: [620, 620], color: '#1c2c40' },
      alpha: [0.7, 0.7],
      motion: { type: 'static' },
      life: { enter: 100, fade: 400 },
    },
    // ---- header band ----
    {
      key: 'title', count: 1,
      position: { x: 0.035, y: 0.052 },
      sprite: { kind: 'text', strings: ['VIREO-9 · TRANS-LUNAR RELAY · OPS WALL 03'], color: '#7f93ab',
        font: "600 13px 'SF Mono', monospace", align: 'left' },
      motion: { type: 'static' },
      life: { enter: 200, fade: 600 },
    },
    {
      key: 'clock', count: 1,
      position: { x: 0.5, y: 0.058 },
      sprite: { kind: 'text', strings: ['04:17:26 UTC'], color: '#c8d4e4',
        font: "600 20px 'SF Mono', monospace", align: 'center' },
      motion: { type: 'static' },
      life: { enter: 200, fade: 600 },
    },
    {
      key: 'status', count: 1,
      position: { x: 0.965, y: 0.052 },
      sprite: { kind: 'text', strings: ['● UPLINK LOCKED · WATCH C'], color: '#46d17a',
        font: "bold 11px 'SF Mono', monospace", align: 'right' },
      pulse: { amp: 0.18, period: 2600 },
      motion: { type: 'static' },
      life: { enter: 200, fade: 600 },
    },
    // ---- left column: arrays (boots second) ----
    {
      key: 'dish1', count: 1,
      position: { x: 0.035, y: 0.148 },
      sprite: { kind: 'text', strings: ['DSA-1 EAST    AZ 214.6°  EL 38.2°'], color: '#9fb2c8',
        font: "11px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 700, fade: 600 },
    },
    {
      key: 'dish1-bars', count: 14,
      sprite: { kind: 'rect', width: [0.0038, 0.0038], aspect: [0.5, 2.6], color: '#2ee6c8' },
      alpha: [0.3, 0.65],
      layout: { type: 'grid', columns: 14 },
      region: { x: [0.035, 0.15], y: [0.183, 0.203] },
      pulse: { amp: 0.42, period: 1500, wave: { wavelength: 0.09, angle: 0 } },
      motion: { type: 'static' },
      life: { enter: 700, fade: 600 },
    },
    {
      key: 'dish2', count: 1,
      position: { x: 0.035, y: 0.243 },
      sprite: { kind: 'text', strings: ['DSA-2 WEST    AZ 097.1°  EL 61.7°'], color: '#9fb2c8',
        font: "11px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 850, fade: 600 },
    },
    {
      key: 'dish2-bars', count: 14,
      sprite: { kind: 'rect', width: [0.0038, 0.0038], aspect: [0.5, 2.2], color: '#44aaff' },
      alpha: [0.3, 0.6],
      layout: { type: 'grid', columns: 14 },
      region: { x: [0.035, 0.15], y: [0.278, 0.298] },
      pulse: { amp: 0.4, period: 1900, wave: { wavelength: 0.11, angle: 0 } },
      motion: { type: 'static' },
      life: { enter: 850, fade: 600 },
    },
    {
      key: 'dish3', count: 1,
      position: { x: 0.035, y: 0.338 },
      sprite: { kind: 'text', strings: ['DSA-3 POLAR   AZ 002.4°  EL 12.9°  △ WIND'], color: '#5d7089',
        font: "11px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 1000, fade: 600 },
    },
    {
      key: 'dish3-bars', count: 14,
      sprite: { kind: 'rect', width: [0.0038, 0.0038], aspect: [0.4, 1.1], color: '#5d7089' },
      alpha: [0.2, 0.4],
      layout: { type: 'grid', columns: 14 },
      region: { x: [0.035, 0.15], y: [0.373, 0.393] },
      pulse: { amp: 0.3, period: 2600, wave: { wavelength: 0.14, angle: 0 } },
      motion: { type: 'static' },
      life: { enter: 1000, fade: 600 },
    },
    {
      key: 'dish-leds', count: 3,
      sprite: { kind: 'circle', radius: [0.004, 0.004], color: '#46d17a' },
      alpha: [0.9, 0.9],
      layout: { type: 'grid', columns: 1 },
      region: { x: [0.238, 0.246], y: [0.15, 0.35] },
      pulse: { amp: 0.25, period: 2100 },
      motion: { type: 'static' },
      life: { enter: 1000, fade: 600 },
    },
    // carrier + doppler + station env
    {
      key: 'carrier-wave', count: 30,
      sprite: { kind: 'rect', width: [0.0032, 0.0032], aspect: [0.4, 3.6], color: '#2ee6c8' },
      alpha: [0.25, 0.6],
      layout: { type: 'grid', columns: 30 },
      region: { x: [0.035, 0.245], y: [0.47, 0.5] },
      pulse: { amp: 0.5, period: 2100, wave: { wavelength: 0.16, angle: 0 } },
      motion: { type: 'static' },
      life: { enter: 1150, fade: 600 },
    },
    {
      key: 'doppler', count: 1,
      position: { x: 0.035, y: 0.535 },
      sprite: { kind: 'text', strings: ['CARRIER X-BAND · DOPPLER +2.114 kHz · DRIFT 0.03'], color: '#9fb2c8',
        font: "10px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 1150, fade: 600 },
    },
    {
      key: 'env-line', count: 1,
      position: { x: 0.035, y: 0.6 },
      sprite: { kind: 'text', strings: ['STATION · PWR 28.1 V · THERM 312 K · GYRO NOM · PROP 81%'], color: '#5d7089',
        font: "10px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 1300, fade: 600 },
    },
    // ---- center: the orbital plot (boots third) ----
    {
      key: 'moon', count: 1,
      position: { x: 0.455, y: 0.4 },
      sprite: { kind: 'circle', radius: [0.028, 0.028], color: '#8fa3bd', soft: true },
      alpha: [0.9, 0.9],
      motion: { type: 'static' },
      life: { enter: 1200, fade: 700 },
    },
    {
      key: 'orbit-guides', count: 3,
      // All three guides pin to the plot centre; the seeded radius range
      // spreads them into concentric orbits (`position` is count:1-only).
      region: { x: [0.455, 0.455], y: [0.4, 0.4] },
      sprite: { kind: 'ring', radius: [0.075, 0.185], color: '#1e3a52', width: 0.0011 },
      alpha: [0.55, 0.55],
      motion: { type: 'static' },
      life: { enter: 1200, fade: 700 },
    },
    {
      key: 'fleet',
      count: 5,
      sprite: { kind: 'circle', radius: [0.0045, 0.0065], color: '#2ee6c8',
        colors: ['#2ee6c8', '#44aaff', '#ffd166', '#aa88ff', '#ff9f43'] },
      alpha: [0.85, 0.95],
      blend: 'lighter',
      motion: { type: 'orbit', speed: [4, 11], radius: [0.075, 0.185], center: { x: 0.455, y: 0.4 } },
      trail: { length: 9, fade: 0.75 },
      // The relay web: each craft holds a comm chain to its neighbours.
      links: { k: 2, maxDist: 0.5, color: '#2ee6c8', alpha: 0.2, width: 0.0012, mode: 'chain' },
      life: { enter: 1350, fade: 700 },
    },
    {
      key: 'fleet-legend', count: 1,
      position: { x: 0.455, y: 0.63 },
      sprite: { kind: 'text', strings: ['TRACKING 5 · KESTREL  TIDE-2  LIMELIGHT  CATWALK-1  SLIPSTREAM'], color: '#5d7089',
        font: "9px 'SF Mono', monospace", align: 'center', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 1500, fade: 700 },
    },
    // pass schedule under the plot
    {
      key: 'pass-label', count: 1,
      position: { x: 0.3, y: 0.69 },
      sprite: { kind: 'text', strings: ['PASS SCHEDULE'], color: '#41536b',
        font: "9px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 1650, fade: 600 },
    },
    {
      key: 'pass-1', count: 1,
      position: { x: 0.3, y: 0.72 },
      sprite: { kind: 'text', strings: ['04:41  CATWALK-1   ACQUIRE · DSA-1     ▲ 12 MIN'], color: '#c8d4e4',
        font: "11px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 1650, fade: 600 },
    },
    {
      key: 'pass-2', count: 1,
      position: { x: 0.3, y: 0.757 },
      sprite: { kind: 'text', strings: ['05:03  TIDE-2      OCCULT EXIT · DSA-2'], color: '#7f93ab',
        font: "11px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 1750, fade: 600 },
    },
    {
      key: 'pass-3', count: 1,
      position: { x: 0.3, y: 0.794 },
      sprite: { kind: 'text', strings: ['05:47  KESTREL     RANGING · DSA-1+2'], color: '#7f93ab',
        font: "11px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 1850, fade: 600 },
    },
    // ---- right column: telemetry (boots fourth) ----
    {
      key: 'signal-label', count: 1,
      position: { x: 0.665, y: 0.115 },
      sprite: { kind: 'text', strings: ['PRIMARY CARRIER · CATWALK-1'], color: '#41536b',
        font: "9px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 1700, fade: 600 },
    },
    {
      key: 'signal-value', count: 1,
      position: { x: 0.665, y: 0.14 },
      sprite: { kind: 'text', strings: ['-112.4 dBm'], color: '#ffd166',
        font: "bold 30px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 1700, fade: 600 },
    },
    {
      key: 'telemetry-row', count: 1,
      position: { x: 0.665, y: 0.215 },
      sprite: { kind: 'text', strings: ['RANGE 1.28 LS   DOWNLINK 2.048 Mb/s   BUFFER 38%'], color: '#9fb2c8',
        font: "11px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 1800, fade: 600 },
    },
    // event log
    {
      key: 'feed-1', count: 1,
      position: { x: 0.665, y: 0.3 },
      sprite: { kind: 'text', strings: ['04:15:02  DSA-1 LOCK RE-ACQUIRED'], color: '#9fb2c8',
        font: "10px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 1950, fade: 600 },
    },
    {
      key: 'feed-2', count: 1,
      position: { x: 0.665, y: 0.334 },
      sprite: { kind: 'text', strings: ['04:12:47  CATWALK-1 WHEEL DESAT OK'], color: '#7f93ab',
        font: "10px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 2050, fade: 600 },
    },
    {
      key: 'feed-3', count: 1,
      position: { x: 0.665, y: 0.368 },
      sprite: { kind: 'text', strings: ['04:09:31  RANGING RESIDUAL 0.4 m'], color: '#5d7089',
        font: "10px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 2150, fade: 600 },
    },
    // alert + relay load
    {
      key: 'alert', count: 1,
      position: { x: 0.665, y: 0.49 },
      sprite: { kind: 'text', strings: ['△ SOLAR FLUX ELEVATED — MONITORING'], color: '#ff9f43',
        font: "bold 11px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      pulse: { amp: 0.22, period: 3400 },
      motion: { type: 'static' },
      life: { enter: 2450, fade: 600 },
    },
    {
      key: 'load-bars', count: 24,
      sprite: { kind: 'rect', width: [0.0042, 0.0042], aspect: [0.5, 3.2],
        color: '#aa88ff', colors: ['#aa88ff', '#44aaff', '#2ee6c8'], colorWeights: [2, 2, 3] },
      alpha: [0.3, 0.65],
      layout: { type: 'grid', columns: 24 },
      region: { x: [0.665, 0.965], y: [0.58, 0.615] },
      pulse: { amp: 0.45, period: 1800, wave: { wavelength: 0.12, angle: 0 } },
      motion: { type: 'static' },
      life: { enter: 2550, fade: 600 },
    },
    {
      key: 'load-note', count: 1,
      position: { x: 0.665, y: 0.65 },
      sprite: { kind: 'text', strings: ['RELAY LOAD · QUEUE 14 FRAMES · NOMINAL'], color: '#5d7089',
        font: "10px 'SF Mono', monospace", align: 'left', baseline: 'top' },
      motion: { type: 'static' },
      life: { enter: 2550, fade: 600 },
    },
    // ---- footer band ----
    {
      key: 'footer', count: 1,
      position: { x: 0.035, y: 0.95 },
      sprite: { kind: 'text', strings: ['NET STATE GREEN · 3 ARRAYS · 5 CARRIERS · DSN HANDOVER 23:34 · NEXT WINDOW 04:41:00'], color: '#41536b',
        font: "9px 'SF Mono', monospace", align: 'left' },
      motion: { type: 'static' },
      life: { enter: 2750, fade: 600 },
    },
  ],
};
