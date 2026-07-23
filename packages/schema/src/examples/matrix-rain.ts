import type { SaverSpec } from '../types';

/**
 * Matrix Rain: showcases `layout: grid` with per-axis jitter ({ y: 1 } keeps the
 * columns crisp while de-syncing them vertically), glyph `cycle`, and `ghosting`
 * doing the classic fading-trail work. Two depths of rain plus rare bright heads.
 */
export const MATRIX_RAIN_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'matrix-rain',
  label: 'Matrix Rain',
  seed: 1999,
  motionIntensity: 'moderate',
  ghosting: 0.88,
  background: { type: 'solid', color: '#010401' },
  layers: [
    {
      key: 'rain-far',
      count: 64,
      sprite: {
        kind: 'text',
        strings: ['ア', 'カ', 'サ', 'タ', 'ナ', 'ハ', 'マ', 'ヤ', 'ラ', 'ワ', '0', '1', '7', 'Z', 'X', 'K'],
        color: '#1c7a2e',
        font: 'bold monospace',
        cycle: { period: 900 },
      },
      size: [0.014, 0.02],
      layout: { type: 'grid', columns: 32, jitter: { y: 1 } },
      motion: { type: 'drift', speed: [0.06, 0.14], angle: 90 },
      alpha: [0.35, 0.6],
    },
    {
      key: 'rain-near',
      count: 40,
      sprite: {
        kind: 'text',
        strings: ['ミ', 'ネ', 'リ', 'ソ', 'ツ', 'ヌ', 'ホ', 'ユ', '3', '8', '9', 'V', 'N'],
        color: '#2ecc40',
        font: 'bold monospace',
        cycle: { period: 700 },
      },
      size: [0.022, 0.03],
      layout: { type: 'grid', columns: 20, jitter: { y: 1 } },
      motion: { type: 'drift', speed: [0.16, 0.3], angle: 90 },
      alpha: [0.6, 0.9],
    },
    {
      key: 'heads',
      count: 12,
      sprite: {
        kind: 'text',
        strings: ['ケ', 'メ', 'エ', 'ム', 'ヲ', '5', '2'],
        color: '#c8ffd4',
        font: 'bold monospace',
        cycle: { period: 500 },
      },
      size: [0.024, 0.032],
      layout: { type: 'grid', columns: 12, jitter: { y: 1 } },
      motion: { type: 'drift', speed: [0.2, 0.34], angle: 90 },
      alpha: [0.9, 1],
    },
  ],
};
