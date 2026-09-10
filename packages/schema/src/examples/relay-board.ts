import type { SaverSpec } from '../types';

/**
 * Relay Board — a six-row status chart in five layers instead of twenty-five.
 * One `list` of labels, one `list` of `bar`s whose lengths are the numbers,
 * one `list` of readouts, a title block, and a slow dust field behind so the
 * board reads as a live wall, not a document. Steer `bars.sprite.values` and the
 * bars glide to the new figures; the labels never move.
 */
export const RELAY_BOARD_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'relay-board',
  label: 'Relay Board',
  seed: 9,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#05070d' },
      { at: 1, color: '#0a0d18' },
    ],
  },
  layers: [
    {
      key: 'dust',
      count: 40,
      sprite: { kind: 'circle', radius: [0.0008, 0.0016], color: '#22344a', soft: true },
      alpha: [0.2, 0.45],
      blend: 'lighter',
      motion: { type: 'wander', speed: [0.001, 0.003] },
    },
    {
      key: 'title',
      count: 1,
      sprite: { kind: 'textBlock', text: 'RELAY LINKS — UPLINK MARGIN', maxWidth: 0.6, fontSize: 0.028, color: '#9fb4c9' },
      motion: { type: 'static' },
      position: { x: 0.12, y: 0.16 },
    },
    {
      key: 'labels',
      count: 6,
      sprite: { kind: 'text', strings: ['VIREO-9', 'TIDE', 'ORRERY', 'COMET', 'LANTERN', 'SAKURA'], font: 'bold monospace', align: 'left', color: '#e6e8ef' },
      size: [0.024, 0.024],
      motion: { type: 'static' },
      position: { x: 0.12, y: 0.3 },
      layout: { type: 'list', gap: 0.075 },
    },
    {
      key: 'bars',
      count: 6,
      sprite: {
        kind: 'bar',
        values: [82, 64, 91, 37, 58, 73],
        max: 100,
        length: 0.5,
        thickness: 0.02,
        color: '#17e8c8',
        colors: ['#17e8c8', '#35d0ff', '#ffd93b', '#ff6ad5', '#ad8cff', '#17e8c8'],
      },
      alpha: [0.85, 0.85],
      motion: { type: 'static' },
      position: { x: 0.3, y: 0.3 },
      layout: { type: 'list', gap: 0.075 },
    },
    {
      key: 'readouts',
      count: 6,
      sprite: { kind: 'text', strings: ['82%', '64%', '91%', '37%', '58%', '73%'], font: 'monospace', align: 'left', color: '#9fb4c9' },
      size: [0.02, 0.02],
      motion: { type: 'static' },
      position: { x: 0.86, y: 0.3 },
      layout: { type: 'list', gap: 0.075 },
    },
  ],
};
