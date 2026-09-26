import type { InputBinding, SaverSpec } from '../types';

/**
 * Outpost — a space station in cross-section over a planet, and the first
 * scene that declares `inputs`: feed it a roster of up to eight agents (or
 * builds, or services — the states are the scene's own) and each one takes a
 * crew pod. Working crew sit at lit screens; resting crew leave their pod for
 * the sofas on the observation deck; a crew member who needs you raises a
 * hand in an amber pod and the roof beacon turns amber.
 *
 * Every per-member layer is a 4 × 2 `table` sharing one centre and one gap,
 * so entity i of each is member i, and every input binding is paint
 * (`colors.{i}`, `glyphs.{i}`, `strings.{i}`) — feeding it never rebuilds.
 * Horizontal placement comes only from tables centred on x = 0.5 with gaps in
 * min(w,h) units, so the station holds its shape at 16:9 and 16:10 alike.
 */

const SLOTS = 8;
const fill = (v: string): string[] => Array.from({ length: SLOTS }, () => v);
const rect = (w: number, h: number, color: string, extra: Record<string, unknown> = {}) =>
  ({ kind: 'rect' as const, width: [w, w] as [number, number], aspect: [h / w, h / w] as [number, number], color, ...extra });
const still = { type: 'static' as const };

// Two floors of four pods: centres at y 0.46 and 0.72, 0.27 apart across.
const POD_Y = 0.59;
const pods = (dy = 0) => ({
  layout: { type: 'table' as const, columns: 4, gap: { x: 0.27, y: 0.26 } },
  region: { x: [0.5, 0.5] as [number, number], y: [POD_Y + dy, POD_Y + dy] as [number, number] },
});

const POD_REST = '#1c2338';
const GLOW_REST = '#16223a';
const SCREEN_REST = '#2a3150';

/** One member's look: pod shell, screen glow and screen, ceiling lamp, who stands where. */
function look(o: {
  shell?: string; glow: string; screen: string; lamp?: string;
  crew?: string; lounge?: string; text?: string;
}): InputBinding[] {
  return [
    { path: 'pod.sprite.colors.{i}', value: o.shell ?? '#232b44' },
    { path: 'glow.sprite.colors.{i}', value: o.glow },
    { path: 'screen.sprite.colors.{i}', value: o.screen },
    { path: 'lamp.sprite.colors.{i}', value: o.lamp ?? '#3a4a6a' },
    { path: 'crew.sprite.glyphs.{i}', value: o.crew ?? ' ' },
    { path: 'lounge.sprite.glyphs.{i}', value: o.lounge ?? ' ' },
    { path: 'label.sprite.strings.{i}', value: o.text ?? '{label} · {verb}{count}' },
  ];
}

export const OUTPOST_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'outpost',
  label: 'Outpost',
  seed: 2207,
  motionIntensity: 'calm',
  background: { type: 'gradient', stops: [{ at: 0, color: '#070913' }, { at: 1, color: '#04050b' }] },
  layers: [
    // ---- space ----
    { key: 'stars', count: 90, sprite: { kind: 'circle', radius: [0.0008, 0.0018], color: '#c8d0ff' }, alpha: [0.35, 0.9], pulse: { amp: 0.25, period: 5000 }, motion: still },
    // A moon in the corner, small enough that its lit rim never sits behind a pod label.
    { key: 'moon-glow', count: 1, position: { x: 0, y: 1 }, sprite: { kind: 'circle', radius: [0.33, 0.33], color: '#123066', soft: true }, blend: 'lighter', motion: still },
    { key: 'moon', count: 1, position: { x: 0, y: 1 }, sprite: { kind: 'circle', radius: [0.28, 0.28], color: '#24457e' }, motion: still },
    { key: 'moon-rim', count: 1, position: { x: 0, y: 1 }, sprite: { kind: 'ring', radius: [0.28, 0.28], color: '#8cc2ff', width: 0.004 }, blend: 'lighter', alpha: [0.7, 0.7], motion: still },

    // ---- hull ----
    { key: 'hull-rim', count: 1, position: { x: 0.5, y: 0.5 }, sprite: rect(1.175, 0.875, '#4a5680'), motion: still },
    { key: 'hull', count: 1, position: { x: 0.5, y: 0.5 }, sprite: rect(1.16, 0.86, '#161c2e'), motion: still },
    { key: 'slabs', count: 3, layout: { type: 'list', gap: 0.26 }, region: { x: [0.5, 0.5], y: [POD_Y, POD_Y] }, sprite: rect(1.16, 0.014, '#3a4468'), motion: still },
    { key: 'bulkheads', count: 6, ...pods(), sprite: rect(0.012, 0.225, '#3a4468'), layout: { type: 'table', columns: 3, gap: { x: 0.27, y: 0.26 } }, motion: still },
    { key: 'antenna', count: 1, position: { x: 0.5, y: 0.04 }, sprite: rect(0.006, 0.055, '#4a5680'), motion: still },
    { key: 'beacon', count: 1, position: { x: 0.5, y: 0.014 }, sprite: { kind: 'circle', radius: [0.012, 0.012], color: '#2fb8a4', soft: true }, blend: 'lighter', pulse: { amp: 0.4, period: 2400 }, motion: still },
    { key: 'hull-lights', count: 12, layout: { type: 'table', columns: 12, gap: 0.09 }, region: { x: [0.5, 0.5], y: [0.905, 0.905] }, sprite: { kind: 'circle', radius: [0.003, 0.003], color: '#3fd6c0' }, blend: 'lighter', pulse: { amp: 0.5, period: 3000, wave: { wavelength: 0.5 } }, motion: still },

    // ---- observation deck: the big window, and the sofas where resting crew go ----
    { key: 'sign', count: 1, position: { x: 0.5, y: 0.1 }, size: [0.02, 0.02], sprite: { kind: 'text', strings: ['O U T P O S T'], color: '#b8c4e0', font: '700 monospace', role: 'read' }, motion: still },
    { key: 'window', count: 1, position: { x: 0.5, y: 0.19 }, sprite: rect(1.06, 0.1, '#0e1530'), motion: still },
    { key: 'window-stars', count: 24, region: { x: [0.3, 0.7], y: [0.15, 0.23] }, sprite: { kind: 'circle', radius: [0.0008, 0.0016], color: '#dfe6ff' }, alpha: [0.5, 1], pulse: { amp: 0.4, period: 3800 }, motion: still },
    { key: 'mullions', count: 6, layout: { type: 'table', columns: 6, gap: 0.212 }, region: { x: [0.5, 0.5], y: [0.19, 0.19] }, sprite: rect(0.008, 0.1, '#4a5680'), motion: still },
    { key: 'deck', count: 1, position: { x: 0.5, y: 0.293 }, sprite: rect(1.1, 0.028, '#2c3552'), motion: still },
    { key: 'sofas', count: 2, layout: { type: 'table', columns: 2, gap: 0.46 }, region: { x: [0.5, 0.5], y: [0.27, 0.27] }, sprite: rect(0.36, 0.028, '#4b5285', { feather: 0.15 }), motion: still },
    { key: 'lounge', count: SLOTS, layout: { type: 'table', columns: SLOTS, gap: 0.1 }, region: { x: [0.5, 0.5], y: [0.245, 0.245] }, size: [0.045, 0.045], sprite: { kind: 'emoji', glyphs: fill(' ') }, motion: still },
    {
      key: 'bot', count: 1, size: [0.042, 0.042], flip: true, sprite: { kind: 'emoji', glyphs: ['🤖'] },
      motion: { type: 'path', points: [{ x: 0.38, y: 0.25 }, { x: 0.62, y: 0.25 }], duration: 36000, curve: 'linear', closed: false },
    },

    // ---- crew pods: entity i of every layer below is member i ----
    { key: 'pod', count: SLOTS, ...pods(-0.005), sprite: rect(0.25, 0.225, POD_REST, { colors: fill(POD_REST) }), motion: still },
    { key: 'glow', count: SLOTS, ...pods(-0.02), sprite: { kind: 'circle', radius: [0.075, 0.075], color: GLOW_REST, colors: fill(GLOW_REST), soft: true }, blend: 'lighter', alpha: [0.7, 0.7], motion: still },
    { key: 'screen', count: SLOTS, ...pods(-0.025), sprite: rect(0.095, 0.05, SCREEN_REST, { colors: fill(SCREEN_REST) }), motion: still },
    // Ceiling lamps breathe slowly — invisible on a grey lamp, unmissable on the one amber lamp.
    { key: 'lamp', count: SLOTS, ...pods(-0.107), sprite: rect(0.07, 0.008, '#3a4a6a', { colors: fill('#3a4a6a') }), pulse: { amp: 0.45, period: 2000 }, motion: still },
    { key: 'crew', count: SLOTS, ...pods(0.045), size: [0.075, 0.075], sprite: { kind: 'emoji', glyphs: fill(' ') }, motion: still },
    { key: 'label', count: SLOTS, ...pods(0.1), size: [0.017, 0.017], sprite: { kind: 'text', strings: fill(' '), color: '#dfe6f2', font: '600 monospace', role: 'read' }, motion: still },
  ],
  inputs: {
    crew: {
      kind: 'roster',
      slots: SLOTS,
      default: 'absent',
      states: {
        absent: look({ shell: POD_REST, glow: GLOW_REST, screen: SCREEN_REST, lamp: '#3a4a6a', text: ' ' }),
        idle: look({ glow: GLOW_REST, screen: '#2f3a55', lounge: '😴' }),
        thinking: look({ glow: '#122850', screen: '#5a86d6', crew: '🤔' }),
        reading: look({ glow: '#0f3a52', screen: '#4aa3f0', crew: '🧑‍💻' }),
        editing: look({ glow: '#0f4a40', screen: '#3fd6c0', crew: '🧑‍💻' }),
        running: look({ glow: '#241f58', screen: '#8f86f5', crew: '🧑‍🔧' }),
        browsing: look({ glow: '#0d3a50', screen: '#58e0f5', crew: '🧑‍🚀' }),
        compacting: look({ glow: '#241a40', screen: '#8a6ad0', crew: '🧹' }),
        done: look({ glow: '#2a2612', screen: '#f3e3a6', lamp: '#8a7a40', crew: '🧑‍🚀📦' }),
        waiting: look({ shell: '#3a2a12', glow: '#5a3208', screen: '#ffb040', lamp: '#ffb040', crew: '🙋' }),
        error: look({ shell: '#3a1818', glow: '#5a120e', screen: '#ff5a4a', lamp: '#ff5a4a', crew: '😵' }),
      },
      verbs: {
        idle: 'resting', compacting: 'tidying up', waiting: 'needs you', error: 'stuck',
      },
      count: { glyph: '🛸', max: 4 },
      alert: {
        states: ['waiting', 'error'],
        on: [{ path: 'beacon.sprite.color', value: '#ffb040' }],
        off: [{ path: 'beacon.sprite.color', value: '#2fb8a4' }],
      },
    },
  },
};
