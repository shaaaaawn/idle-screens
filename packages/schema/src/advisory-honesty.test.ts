/**
 * Advisories that contradicted the perception returned beside them (MCP
 * feedback X384, X388, X416, X418, X423, X437 — each reproduced on prod
 * before it was fixed). Every case carries its control: the advisory must
 * still fire where the problem is real.
 */
import { describe, expect, it } from 'vitest';
import { adviseSequence, adviseSpec } from './advise';
import { perceiveScene } from './perceive';
import type { IdleSequence, LayerSpec, SaverSpec } from './types';

const scene = (layers: LayerSpec[], x: Partial<SaverSpec> = {}): SaverSpec =>
  ({ schemaVersion: 1, id: 't', label: 'T', seed: 1, background: { type: 'solid', color: '#101014' }, layers, ...x }) as SaverSpec;
const codes = (s: SaverSpec, vp = { width: 960, height: 540 }) => adviseSpec(s, vp).map((w) => w.code);
const rect = (key: string, color: string, width: number, x: Partial<LayerSpec> = {}): LayerSpec =>
  ({ key, count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'rect', width: [width, width], aspect: [1, 1], color }, motion: { type: 'static' }, ...x }) as LayerSpec;

describe('low-contrast-layer judges the solid layer underneath (X388)', () => {
  it('a near-black plate on an opaque yellow panel is content, not background', () => {
    expect(codes(scene([rect('panel', '#ffe600', 0.6), rect('ink', '#0a0a0c', 0.25)]))).not.toContain('low-contrast-layer');
  });
  it('the same plate on the bare page still fires', () => {
    expect(codes(scene([rect('ink', '#0a0a0c', 0.25)]))).toContain('low-contrast-layer');
  });
  it('a plate the panel does not reach is judged against the page', () => {
    expect(codes(scene([rect('panel', '#ffe600', 0.2, { position: { x: 0.2, y: 0.5 } }), rect('ink', '#0a0a0c', 0.2, { position: { x: 0.8, y: 0.5 } })]))).toContain('low-contrast-layer');
  });
  it('only ever silences: ink that stands off the page is not newly judged against a panel', () => {
    // Yellow-on-yellow is a real miss, but catching it would ADD warnings to
    // scenes that never had one — this fix only removes false positives.
    expect(codes(scene([rect('panel', '#ffe600', 0.6), rect('ink', '#fde501', 0.25)]))).not.toContain('low-contrast-layer');
  });
  it('a soft or additive layer underneath is not a plate', () => {
    const glow = { key: 'glow', count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'circle', radius: [0.4, 0.4], color: '#ffe600', soft: true }, motion: { type: 'static' } } as LayerSpec;
    expect(codes(scene([glow, rect('ink', '#0a0a0c', 0.25)]))).toContain('low-contrast-layer');
  });
});

describe('off-center weighs ink, not entity count (X384)', () => {
  const diptych = scene([
    { key: 'field', count: 24, layout: { type: 'grid', columns: 24 }, region: { x: [0.5, 1], y: [0.5, 0.5] }, sprite: { kind: 'rect', width: [0.1, 0.1], aspect: [22, 22], color: '#0d2e2a' }, motion: { type: 'static' } } as LayerSpec,
    { key: 'zip', count: 1, position: { x: 0.13, y: 0.5 }, sprite: { kind: 'rect', width: [2.4, 2.4], aspect: [0.0142, 0.0142], color: '#f1e7d0' }, rotate: 90, motion: { type: 'static' } } as LayerSpec,
  ], { background: { type: 'gradient', stops: [{ at: 0, color: '#c4282c' }, { at: 1, color: '#b0222a' }] } });
  it('24 slivers in one half against a full-height stripe in the other: silent', () => {
    expect(codes(diptych, { width: 1000, height: 1000 })).not.toContain('off-center');
  });
  it('a real cluster off to one side still fires, and reports the ink centroid', () => {
    const corner = scene([{ key: 'c', count: 20, region: { x: [0.78, 0.95], y: [0.4, 0.6] }, sprite: { kind: 'circle', radius: [0.02, 0.03], color: '#ffffff' }, motion: { type: 'static' } } as LayerSpec]);
    const w = adviseSpec(corner, { width: 960, height: 540 }).find((x) => x.code === 'off-center');
    expect(w).toBeDefined();
    const p = perceiveScene(corner, { viewport: { width: 960, height: 540 } });
    expect(w!.message).toContain(`(${p.centroid!.x.toFixed(2)}, ${p.centroid!.y.toFixed(2)})`);
  });
});

describe('text-overlap leaves the outline / drop-shadow idiom alone (X416)', () => {
  const title = (dx: number, str2 = 'The Puddlefords'): SaverSpec => scene([
    { key: 'outline', count: 1, position: { x: 0.5, y: 0.75, dx }, sprite: { kind: 'text', strings: ['The Puddlefords'], color: '#17131c', font: '900 120px sans-serif', align: 'center', baseline: 'middle' }, alpha: [1, 1], motion: { type: 'static' } } as LayerSpec,
    { key: 'fill', count: 1, position: { x: 0.5, y: 0.75 }, sprite: { kind: 'text', strings: [str2], color: '#ffd90f', font: '900 120px sans-serif', align: 'center', baseline: 'middle' }, alpha: [1, 1], motion: { type: 'static' } } as LayerSpec,
  ], { background: { type: 'solid', color: '#3d84d6' } });
  const vp = { width: 1920, height: 1080 };
  it('the same string nudged a few px is one title', () => {
    expect(codes(title(0.006), vp)).not.toContain('text-overlap');
  });
  it('different strings on top of each other still clash', () => {
    expect(codes(title(0.006, 'Other words here'), vp)).toContain('text-overlap');
  });
  it('the same string pushed well past a nudge still clashes', () => {
    expect(codes(title(0.1), vp)).toContain('text-overlap');
  });
});

describe('a timed segment is judged at one stated moment inside it (X418)', () => {
  const seq: IdleSequence = {
    format: 'idle-sequence', schemaVersion: 1, id: 'q', label: 'q', loop: true,
    segments: [
      { key: 'dive', duration: 2000, scene: scene([{ key: 'word', count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'text', strings: ['Puddlefords'], color: '#ffd90f', font: '900 1800px sans-serif', align: 'center', baseline: 'middle' }, alpha: [1, 1], motion: { type: 'static' }, group: 'plane' } as LayerSpec], { background: { type: 'solid', color: '#3d84d6' }, groups: { plane: { transform: { scale: 0.083 } } }, timeline: { keys: [{ t: 0, path: 'groups.plane.transform.scale', value: 8, dur: 2000, ease: 'smooth' }] } } as Partial<SaverSpec>) },
      { key: 'after', duration: 2000, scene: scene([{ key: 'dot', count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'circle', radius: [0.05, 0.05], color: '#ffffff' }, alpha: [1, 1], motion: { type: 'static' } } as LayerSpec]) },
    ],
  } as IdleSequence;
  const ws = adviseSequence(seq, { width: 1600, height: 900 }).filter((w) => w.path.startsWith('segments[0]'));
  it('never "empty" and "33 000 px off-screen" about the same word in one breath', () => {
    const c = ws.map((w) => w.code);
    expect(c.includes('sparse-scene') && c.includes('text-off-screen')).toBe(false);
  });
  it('names the moment it judged, inside the segment', () => {
    expect(ws.length).toBeGreaterThan(0);
    for (const w of ws) expect(w.message).toContain('judged 2.0 s into this 2.0 s segment');
  });
  it('an untimed segment keeps its message as it was', () => {
    const untimed = adviseSequence({ ...seq, segments: [seq.segments[1]!, { ...seq.segments[1]!, key: 'b', scene: scene([rect('ink', '#0a0a0c', 0.25)]) }] } as IdleSequence);
    expect(untimed.some((w) => w.message.includes('judged'))).toBe(false);
  });
});

describe('perceiveScene motion sees timeline-driven layers (X437)', () => {
  const ticker = (keys: boolean): SaverSpec => scene(
    [{ key: 'tick', count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'circle', radius: [0.03, 0.03], color: '#ffffff' }, motion: { type: 'static' }, transform: { x: 0 } } as LayerSpec],
    keys ? { timeline: { loop: true, duration: 10000, keys: [{ t: 0, path: 'tick.transform.x', value: -0.8, dur: 0 }, { t: 200, path: 'tick.transform.x', value: 0.8, dur: 9800, ease: 'linear' }] } } as Partial<SaverSpec> : {},
  );
  it('a disc glided by transform.x keys moves at its real speed', () => {
    const [m] = perceiveScene(ticker(true), { viewport: { width: 960, height: 540 }, t: 5000 }).motion;
    // 1.6 units of min(w, h) = 540 px over 9.8 s ≈ 88 px/s.
    expect(m!.moving).toBe(true);
    expect(m!.meanSpeed).toBeCloseTo((1.6 * 540) / 9.8, 0);
  });
  it('the same disc without keys is still', () => {
    expect(perceiveScene(ticker(false), { viewport: { width: 960, height: 540 }, t: 5000 }).motion[0]!.moving).toBe(false);
  });
});

describe('overlap-seams tells soft lumps from hard seams (X423)', () => {
  const storm = (soft: boolean): SaverSpec => scene(
    [{ key: 'storm', count: 16, region: { x: [0, 1], y: [0, 0.28] }, sprite: { kind: 'circle', radius: [0.16, 0.3], colors: ['#22262f', '#2a2e3a', '#30343e'], soft }, alpha: [0.55, 0.8], motion: { type: 'drift', angle: 0, speed: [0.0026, 0.0026] } } as LayerSpec],
    { background: { type: 'gradient', stops: [{ at: 0, color: '#2a2e3c' }, { at: 0.42, color: '#585e68' }, { at: 0.66, color: '#ece0ac' }, { at: 1, color: '#2a3220' }] } },
  );
  const seam = (s: SaverSpec) => adviseSpec(s, { width: 1600, height: 900 }).find((w) => w.code === 'overlap-seams');
  it('a soft layer is not told it paints edges — it is told it cannot be one solid shape', () => {
    const w = seam(storm(true));
    expect(w).toBeDefined();
    expect(w!.message).not.toContain('visible edge');
    expect(w!.message).toContain('soft lumps');
  });
  it('a hard translucent layer keeps the edge warning', () => {
    expect(seam(storm(false))!.message).toContain('every overlap paints a visible edge');
  });
});
