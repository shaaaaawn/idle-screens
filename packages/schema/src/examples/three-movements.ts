import type { IdleSequence } from '../types';

/**
 * Three Movements — one ground, three scenes, two kinds of transition.
 *
 * The sequence envelope, exercised end to end:
 *
 * - **bed.** A drifting field with a few motes, drawn under every segment on
 *   the SEQUENCE clock — it does not reset at a boundary and a
 *   `sequence.segment` steer cannot rewind it. That is the fix for the
 *   boundary rewind every ambient sequence suffers: put the motion that must
 *   be continuous in the bed, the slide content in the segments. (Segments
 *   deliberately declare no `background`: over a bed it is never painted on
 *   the web, and the validator warns `bed-hides-segment-background` — the
 *   native tvOS player, which ignores the bed, will show them over black
 *   until it learns the field. Prefer a bed the piece can survive without.)
 * - **morph + text crossfade.** Segments 1 → 2 are structural twins differing
 *   only in colour and words, so the transition can MORPH: every numeric and
 *   hex value glides over 2500 ms, and because the words differ and the
 *   transition declares `text: 'crossfade'`, the outgoing caption fades under
 *   the incoming one instead of switching whole-frame. Without the crossfade
 *   declaration a morph steps strings on its first frame — it reads as a cut
 *   and the validator says `morph-nothing-morphable`.
 * - **fade.** Segments 2 → 3 have nothing structurally in common, so a morph
 *   is impossible and a `fade` is the honest transition: the outgoing scene
 *   keeps animating on its own canvas for 3000 ms while the incoming one
 *   fades up. The cost is two live segments during the window, which is why
 *   the lowest capability tier degrades a fade to a cut
 *   (`fade-degrades-on-low-tier` — informational, and this sequence keeps the
 *   fade because the web and native players both honour it).
 * - **finish.** One grain-and-dither pass over the composed frame — bed,
 *   segment and any fade together — the sequence-level screen no segment can
 *   override.
 *
 * The final segment carries no duration, so it holds indefinitely; `loop` is
 * therefore false (`loop: true` is incompatible with a durationless segment).
 * `sync: 'mount'` is the default and the reason a joiner always sees movement
 * one: pre-roll semantics. An `epoch` sequence would instead start every
 * viewer at the room's shared clock — right for a wall of screens, wrong for
 * a piece that should start when you look at it.
 */
export const THREE_MOVEMENTS_SEQUENCE: IdleSequence = {
  format: 'idle-sequence',
  schemaVersion: 1,
  id: 'three-movements',
  label: 'Three Movements',
  seed: 404,
  loop: false,
  sync: 'mount',
  finish: { grain: 0.3, dither: 0.12 },
  bed: {
    schemaVersion: 1,
    id: 'three-movements-bed',
    label: 'Three Movements — bed',
    background: {
      type: 'field',
      scale: 2.0,
      octaves: 3,
      warp: 0.4,
      quantize: 0,
      bands: ['#0a0d18', '#141c2e', '#233046'],
      drift: { period: 60000, amount: 0.25 },
    },
    layers: [
      {
        key: 'motes',
        count: 12,
        sprite: { kind: 'circle', radius: [0.0012, 0.003], color: '#9fb8d8', soft: true },
        motion: { type: 'drift', speed: [0.002, 0.006], angle: 90 },
        alpha: [0.1, 0.25],
      },
    ],
  },
  segments: [
    {
      key: 'cold-open',
      duration: 8000,
      transition: { type: 'morph', dur: 2500, text: 'crossfade' },
      scene: {
        schemaVersion: 1,
        id: 'three-movements-cold-open',
        label: 'Cold Open',
        seed: 11,
        layers: [
          {
            key: 'caption',
            count: 1,
            sprite: {
              kind: 'textBlock',
              text: 'COLD OPEN.\nThe room before anyone arrives.',
              maxWidth: 0.6,
              fontSize: 0.028,
              lineHeight: 1.5,
              align: 'left',
              anchor: 'top-left',
              font: 'monospace',
              color: '#9fb8d8',
              opacity: 0.9,
              reveal: { progress: 1, mode: 'typewriter', speed: 12, caret: { blink: 1.1 } },
            },
            motion: { type: 'static' },
            position: { x: 0.1, y: 0.4 },
            alpha: [0.9, 0.9],
          },
          {
            key: 'sparks',
            count: 30,
            sprite: { kind: 'circle', radius: [0.0012, 0.0026], color: '#c9d8e6' },
            motion: { type: 'static' },
            alpha: [0.15, 0.45],
            pulse: { amp: 0.12, period: 6000 },
          },
        ],
      },
    },
    {
      key: 'kindle',
      duration: 9000,
      transition: { type: 'fade', dur: 3000 },
      scene: {
        schemaVersion: 1,
        id: 'three-movements-kindle',
        label: 'Kindle',
        seed: 12,
        layers: [
          {
            key: 'caption',
            count: 1,
            sprite: {
              kind: 'textBlock',
              text: 'KINDLE.\nOne lamp, and then another.',
              maxWidth: 0.6,
              fontSize: 0.028,
              lineHeight: 1.5,
              align: 'left',
              anchor: 'top-left',
              font: 'monospace',
              color: '#e8b878',
              opacity: 0.9,
              reveal: { progress: 1, mode: 'typewriter', speed: 12, caret: { blink: 1.1 } },
            },
            motion: { type: 'static' },
            position: { x: 0.1, y: 0.4 },
            alpha: [0.9, 0.9],
          },
          {
            key: 'sparks',
            count: 30,
            sprite: { kind: 'circle', radius: [0.0012, 0.0026], color: '#e8b878' },
            motion: { type: 'static' },
            alpha: [0.15, 0.45],
            pulse: { amp: 0.12, period: 6000 },
          },
        ],
      },
    },
    {
      key: 'dusk',
      scene: {
        schemaVersion: 1,
        id: 'three-movements-dusk',
        label: 'Dusk',
        seed: 13,
        layers: [
          {
            key: 'bloom',
            count: 3,
            sprite: { kind: 'circle', radius: [0.09, 0.14], color: '#7a4a5e', colors: ['#7a4a5e', '#b06a4a'], soft: true },
            motion: { type: 'wander', speed: [0.001, 0.002], meander: 0.04, coherence: 0.7 },
            alpha: [0.25, 0.4],
            blend: 'lighter',
            grow: { amp: 0.3, period: 14000 },
          },
          {
            key: 'strokes',
            count: 8,
            sprite: {
              kind: 'stroke',
              length: [0.1, 0.2],
              points: [[-1, 0.2], [-0.3, -0.6], [0.5, -0.4], [1, 0.2]],
              width: 0.004,
              taper: true,
              color: '#c2447a',
              colors: ['#c2447a', '#8f2c58'],
            },
            motion: { type: 'drift', speed: [0.003, 0.008], angle: 20, bidirectional: true },
            alpha: [0.3, 0.5],
            rotate: [-30, 30],
          },
        ],
      },
    },
  ],
};