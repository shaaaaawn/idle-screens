import type { SaverSpec } from '../types';

/**
 * Lobby Talk — one screen of a "quarter in review" that runs on a lobby wall
 * between meetings: a five-row adoption chart over the same slow haze and
 * dust the whole talk shares. The words are the point, so every text layer
 * declares `role: 'read'` — the opt-in that turns on `adviseSpec`'s
 * legibility advisories (`text-legibility` against the ground *and* the
 * brightest additive layer that can sit under a line, `text-safe-area` for
 * the bezel zone). Tuned to zero advisories: the haze is bright enough to
 * matter and dim enough to leave every label above 4.5:1 at its peak.
 *
 * Schema exercises: `role: 'read'` on both `textBlock` and `text`, a
 * `list`-laid chart in three layers (labels, `bar`s, readouts), additive
 * atmosphere (`lighter` soft circles with `pulse`) under readable copy.
 * Steer `bars.sprite.values` to change the numbers live.
 */
export const LOBBY_TALK_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'lobby-talk',
  label: 'Lobby Talk',
  seed: 1207,
  motionIntensity: 'calm',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#060912' },
      { at: 1, color: '#0b1224' },
    ],
    drift: { period: 40000, amount: 0.1 },
  },
  layers: [
    {
      key: 'haze',
      count: 3,
      sprite: { kind: 'circle', radius: [0.22, 0.3], soft: true, color: '#123a4a', colors: ['#123a4a', '#2a1e4a', '#0e2a3a'] },
      alpha: [0.35, 0.5],
      blend: 'lighter',
      region: { x: [0.2, 0.8], y: [0.3, 0.7] },
      motion: { type: 'wander', speed: [0.002, 0.004], meander: 0.05 },
      pulse: { amp: 0.15, period: 9000 },
    },
    {
      key: 'dust',
      count: 50,
      sprite: { kind: 'circle', radius: [0.0008, 0.0018], soft: true, color: '#7fb8c9' },
      alpha: [0.2, 0.5],
      blend: 'lighter',
      motion: { type: 'wander', speed: [0.001, 0.003] },
    },
    {
      key: 'title',
      count: 1,
      sprite: { kind: 'textBlock', text: 'Adoption by feature, % of accounts', maxWidth: 1.0, fontSize: 0.034, color: '#f2f4f8', role: 'read' },
      motion: { type: 'static' },
      position: { x: 0.12, y: 0.16 },
    },
    {
      key: 'labels',
      count: 5,
      sprite: { kind: 'text', strings: ['Onboarding', 'Search', 'Billing', 'Exports', 'Mobile'], font: 'system-ui', align: 'left', baseline: 'middle', color: '#a9b7cc', role: 'read' },
      size: [0.03, 0.03],
      motion: { type: 'static' },
      position: { x: 0.12, y: 0.32 },
      layout: { type: 'list', gap: 0.085 },
    },
    {
      key: 'bars',
      count: 5,
      sprite: {
        kind: 'bar',
        values: [82, 64, 91, 37, 58],
        max: 100,
        length: 0.75,
        thickness: 0.026,
        color: '#7fe0d2',
        colors: ['#7fe0d2', '#7fe0d2', '#ffcf7a', '#7fe0d2', '#7fe0d2'],
      },
      alpha: [0.9, 0.9],
      motion: { type: 'static' },
      position: { x: 0.33, y: 0.32 },
      layout: { type: 'list', gap: 0.085 },
    },
    {
      key: 'readouts',
      count: 5,
      sprite: { kind: 'text', strings: ['82%', '64%', '91%', '37%', '58%'], font: 'bold system-ui', align: 'left', baseline: 'middle', color: '#f2f4f8', role: 'read' },
      size: [0.03, 0.03],
      motion: { type: 'static' },
      position: { x: 0.78, y: 0.32 },
      layout: { type: 'list', gap: 0.085 },
    },
  ],
};
