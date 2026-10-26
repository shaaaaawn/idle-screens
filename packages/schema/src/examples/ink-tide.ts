import type { SaverSpec } from '../types';

/**
 * Ink Tide — a pen drawing that draws itself.
 * One line of ink traces a ridge, a shoreline and a low moon (`stroke.draw`
 * gliding `end` 0 → 1, eased `out` so it arrives and settles), holds, and
 * then erases from its tail (`start` gliding after it, eased `in`), on a
 * 30 s loop. A small boat rocks at the waterline (`rock`, one clock, so it
 * swings rather than tumbles), and a caption lifts into place as it fades
 * in (`reveal.rise` on `glyphFade`). The base spec is the rest state — the
 * finished drawing and the caption shown — so a player without the timeline
 * still shows the picture.
 */
export const INK_TIDE_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'ink-tide',
  label: 'Ink Tide',
  seed: 31,
  motionIntensity: 'calm',
  background: { type: 'gradient', stops: [{ at: 0, color: '#f1e9d8' }, { at: 1, color: '#e2d6bd' }] },
  layers: [
    {
      key: 'ink',
      count: 1,
      position: { x: 0.5, y: 0.48 },
      motion: { type: 'static' },
      sprite: {
        kind: 'polygon',
        radius: [0.4, 0.4],
        color: '#2b2622',
        fill: false,
        // One pen run: the ridge, the shoreline, then the moon.
        path: 'M -1 0.32 L -0.64 -0.12 L -0.44 0.06 L -0.08 -0.46 L 0.2 -0.1 L 0.4 -0.26 L 1 0.32 M -0.96 0.5 C -0.5 0.4 -0.2 0.58 0.1 0.5 C 0.4 0.42 0.7 0.58 0.96 0.5 M 0.62 -0.66 A 0.12 0.12 0 1 1 0.619 -0.66',
        stroke: { color: '#2b2622', width: 0.01, cap: 'round', join: 'round', draw: { start: 0, end: 1 } },
      },
    },
    {
      key: 'boat',
      count: 1,
      position: { x: 0.5, y: 0.5, dx: 0.12, dy: 0.17 },
      motion: { type: 'static' },
      sprite: { kind: 'polygon', radius: [0.035, 0.035], color: '#2b2622', points: [[-1, -0.15], [1, -0.15], [0.62, 0.3], [-0.62, 0.3]] },
      rock: { amp: 6, period: 6000 },
      clock: { phase: 0 },
    },
    {
      key: 'caption',
      count: 1,
      position: { x: 0.5, y: 0.86 },
      motion: { type: 'static' },
      sprite: {
        kind: 'textBlock',
        text: 'the tide goes out and leaves the sky behind',
        maxWidth: 1.2,
        fontSize: 0.032,
        anchor: 'center',
        align: 'center',
        color: '#5a4f45',
        font: "italic Georgia, 'Times New Roman', serif",
        opacity: 1,
        reveal: { progress: 1, mode: 'glyphFade', fade: 0.3, rise: 0.4 },
      },
    },
  ],
  timeline: {
    loop: true,
    duration: 30000,
    keys: [
      { t: 0, path: 'ink.sprite.stroke.draw.end', value: 1, dur: 12000, ease: 'out' },
      { t: 9000, path: 'caption.sprite.reveal.progress', value: 1, dur: 4000, ease: 'out' },
      { t: 20000, path: 'ink.sprite.stroke.draw.start', value: 1, dur: 7000, ease: 'in' },
      { t: 21000, path: 'caption.sprite.opacity', value: 0, dur: 3000 },
      { t: 29000, path: 'ink.sprite.stroke.draw.end', value: 0, dur: 0 },
      { t: 29000, path: 'ink.sprite.stroke.draw.start', value: 0, dur: 0 },
      { t: 29200, path: 'caption.sprite.reveal.progress', value: 0, dur: 0 },
      { t: 29400, path: 'caption.sprite.opacity', value: 1, dur: 0 },
    ],
  },
};
