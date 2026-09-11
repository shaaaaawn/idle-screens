import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { adviseSpec, adviseSequence } from './advise';
import { describeScene } from './describe';
import { EXAMPLE_SPECS, LOBBY_TALK_SPEC } from './examples/index';
import type { IdleSequence, SaverSpec } from './types';

const base: SaverSpec = {
  schemaVersion: 1,
  id: 'test',
  label: 'Test',
  units: 'px',
  layers: [
    { count: 20, sprite: { kind: 'circle', radius: [5, 10], color: '#fff' }, motion: { type: 'drift', speed: [10, 30] } },
  ],
};

describe('adviseSpec', () => {
  it('returns zero warnings for all shipped examples', () => {
    for (const spec of EXAMPLE_SPECS) {
      const warnings = adviseSpec(spec);
      expect(warnings, `${spec.id} should produce zero warnings`).toEqual([]);
    }
  });

  it('warns when a layer is painted its own background colour', () => {
    // The failure `invisible-layer` cannot catch: full radius, full alpha, and
    // still unseeable because the colour matches the plate behind it.
    const camouflaged: SaverSpec = {
      ...base,
      background: { type: 'gradient', stops: [{ at: 0, color: '#2b0a06' }, { at: 1, color: '#2b0a06' }] },
      layers: [{
        count: 30,
        sprite: { kind: 'circle', radius: [20, 40], color: '#2b0a06' },
        alpha: [1, 1],
        motion: { type: 'drift', speed: [10, 30] },
      }],
    };
    const warnings = adviseSpec(camouflaged);
    expect(warnings.map((w) => w.code)).toContain('low-contrast-layer');
    expect(warnings.find((w) => w.code === 'low-contrast-layer')!.path).toBe('layers[0].sprite');
    // Not a size/alpha problem — the other invisibility check stays quiet.
    expect(warnings.map((w) => w.code)).not.toContain('invisible-layer');
  });

  it('judges additive layers by the light they add, not their difference', () => {
    // Under `lighter` a background-matched colour still brightens the plate, so
    // the question is whether the layer has any light to contribute at all.
    const bg = { type: 'gradient' as const, stops: [{ at: 0, color: '#101010' }, { at: 1, color: '#101010' }] };
    const dim: SaverSpec = {
      ...base,
      background: bg,
      layers: [{
        count: 30,
        sprite: { kind: 'circle', radius: [20, 40], color: '#050505' },
        blend: 'lighter',
        motion: { type: 'drift', speed: [10, 30] },
      }],
    };
    expect(adviseSpec(dim).map((w) => w.code)).toContain('low-contrast-layer');

    // A bright additive layer is fine even though it sits on a similar-luma
    // plate — difference would have mis-flagged it.
    const bright: SaverSpec = {
      ...dim,
      layers: [{ ...dim.layers[0]!, sprite: { kind: 'circle', radius: [20, 40], color: '#ff4a1c' } }],
    };
    expect(adviseSpec(bright).map((w) => w.code)).not.toContain('low-contrast-layer');
  });

  it('does not flag equal-luminance, contrasting-hue fields', () => {
    // Pointillism: golden dots over a pale grey-blue plate. Only 0.013 apart in
    // luma — a luminance-based check flags this, and it is perfectly visible.
    // This test exists to stop anyone "simplifying" colourSeparation back to a
    // luma difference.
    const pointillist: SaverSpec = {
      ...base,
      background: {
        type: 'gradient',
        stops: [{ at: 0, color: '#d8e0e8' }, { at: 0.6, color: '#c8d0c0' }, { at: 1, color: '#9aa888' }],
      },
      layers: [{
        count: 60,
        sprite: { kind: 'circle', radius: [2, 12], color: '#e8c060' },
        alpha: [0.7, 1],
        motion: { type: 'drift', speed: [5, 15] },
      }],
    };
    expect(adviseSpec(pointillist).map((w) => w.code)).not.toContain('low-contrast-layer');
  });

  it('does not flag faint-but-coloured atmosphere', () => {
    // The schema actively recommends this pattern ("tiny soft circles at low
    // alpha"); low opacity is `invisible-layer`'s axis, not this one.
    const atmosphere: SaverSpec = {
      ...base,
      background: { type: 'gradient', stops: [{ at: 0, color: '#05050a' }, { at: 1, color: '#05050a' }] },
      layers: [{
        count: 80,
        sprite: { kind: 'circle', radius: [12, 24], color: '#8fb4d8', soft: true },
        alpha: [0.15, 0.25],
        blend: 'lighter',
        motion: { type: 'drift', speed: [5, 15] },
      }],
    };
    expect(adviseSpec(atmosphere).map((w) => w.code)).not.toContain('low-contrast-layer');
  });

  it('warns on dense scenes (> 500 entities)', () => {
    const dense: SaverSpec = {
      ...base,
      layers: [{ count: 300, sprite: { kind: 'circle', radius: [1, 2], color: '#fff' }, motion: { type: 'static' } },
        { count: 250, sprite: { kind: 'circle', radius: [1, 2], color: '#fff' }, motion: { type: 'static' } }],
    };
    const w = adviseSpec(dense);
    expect(w.some((x) => x.code === 'dense-scene')).toBe(true);
  });

  it('warns on invisible layers', () => {
    const inv: SaverSpec = {
      ...base,
      layers: [{ count: 10, sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#fff' }, alpha: [0.01, 0.02], motion: { type: 'static' } }],
    };
    const w = adviseSpec(inv);
    expect(w.some((x) => x.code === 'invisible-layer')).toBe(true);
  });

  it('warns on sparse scenes (coverage < 0.05%)', () => {
    const sparse: SaverSpec = {
      ...base,
      layers: [{ count: 3, sprite: { kind: 'circle', radius: [0.5, 1], color: '#fff' }, alpha: [0.1, 0.2], motion: { type: 'static' } }],
    };
    const w = adviseSpec(sparse);
    expect(w.some((x) => x.code === 'sparse-scene')).toBe(true);
  });

  it('a near-invisible textBlock does not count as coverage (sparse-scene still fires)', () => {
    // A big block would normally cover plenty of the frame (well above the
    // 0.05% sparse threshold) — but opacity 0.001 means almost nothing is
    // actually painted, so it should still read as sparse. Before the fix,
    // coverage ignored textBlock opacity and this scene registered ~4%
    // covered, well clear of sparse.
    const faded: SaverSpec = {
      ...base,
      units: undefined,
      layers: [
        { count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'textBlock', text: 'barely there', maxWidth: 0.9, fontSize: 0.1, opacity: 0.001 }, motion: { type: 'static' } },
      ],
    };
    const w = adviseSpec(faded);
    expect(w.some((x) => x.code === 'sparse-scene')).toBe(true);
  });

  it('withholds sparse-scene when the spec declares density: sparse — the emptiness is the point', () => {
    const sparse: SaverSpec = {
      ...base,
      density: 'sparse',
      layers: [{ count: 3, sprite: { kind: 'circle', radius: [0.5, 1], color: '#fff' }, alpha: [0.1, 0.2], motion: { type: 'static' } }],
    };
    const codes = adviseSpec(sparse).map((x) => x.code);
    expect(codes).not.toContain('sparse-scene');
    expect(codes).not.toContain('density-mismatch');
  });

  it('flags density-mismatch when a declared-sparse scene is actually a field', () => {
    const field: SaverSpec = {
      ...base,
      density: 'sparse',
      layers: [{ count: 200, sprite: { kind: 'circle', radius: [40, 60], color: '#fff' }, motion: { type: 'static' } }],
    };
    const w = adviseSpec(field);
    expect(w.some((x) => x.code === 'density-mismatch' && x.path === 'density')).toBe(true);
  });

  it('withholds dense-scene under density: dense, and flags a dense declaration on an empty scene', () => {
    const crowd: SaverSpec = {
      ...base,
      density: 'dense',
      layers: [
        { count: 300, sprite: { kind: 'circle', radius: [2, 4], color: '#fff' }, motion: { type: 'drift', speed: [10, 30] } },
        { count: 300, sprite: { kind: 'circle', radius: [2, 4], color: '#fff' }, motion: { type: 'drift', speed: [10, 30] } },
      ],
    };
    expect(adviseSpec(crowd).map((x) => x.code)).not.toContain('dense-scene');
    const empty: SaverSpec = {
      ...base,
      density: 'dense',
      layers: [{ count: 3, sprite: { kind: 'circle', radius: [0.5, 1], color: '#fff' }, alpha: [0.1, 0.2], motion: { type: 'static' } }],
    };
    expect(adviseSpec(empty).map((x) => x.code)).toContain('density-mismatch');
  });

  it('an undeclared spec advises exactly as before', () => {
    const codes = (spec: SaverSpec): string[] => adviseSpec(spec).map((x) => x.code);
    expect(codes({ ...base, density: 'normal' })).toEqual(codes(base));
  });

  it('warns on text-heavy static specs', () => {
    const heavy: SaverSpec = {
      ...base,
      layers: [
        { count: 1, sprite: { kind: 'text', strings: ['A'] }, size: [20, 20], motion: { type: 'static' } },
        { count: 1, sprite: { kind: 'text', strings: ['B'] }, size: [20, 20], motion: { type: 'static' } },
        { count: 1, sprite: { kind: 'text', strings: ['C'] }, size: [20, 20], motion: { type: 'static' } },
        { count: 1, sprite: { kind: 'text', strings: ['D'] }, size: [20, 20], motion: { type: 'static' } },
        { count: 1, sprite: { kind: 'text', strings: ['E'] }, size: [20, 20], motion: { type: 'static' } },
      ],
    };
    const w = adviseSpec(heavy);
    expect(w.some((x) => x.code === 'text-heavy')).toBe(true);
  });

  it('warns on link starvation', () => {
    const starved: SaverSpec = {
      ...base,
      layers: [{
        count: 10,
        sprite: { kind: 'circle', radius: [5, 10], color: '#fff' },
        motion: { type: 'drift', speed: [10, 30] },
        links: { k: 4, maxDist: 1 },
      }],
    };
    const w = adviseSpec(starved);
    expect(w.some((x) => x.code === 'link-starvation')).toBe(true);
  });

  it('warns on uniform motion', () => {
    const uniform: SaverSpec = {
      ...base,
      layers: [{
        count: 20,
        sprite: { kind: 'circle', radius: [5, 10], color: '#fff' },
        motion: { type: 'drift', speed: [100, 100] },
      }],
    };
    const w = adviseSpec(uniform);
    expect(w.some((x) => x.code === 'uniform-motion')).toBe(true);
  });
});

describe('adviseSpec — spatial text (#44)', () => {
  const vp: SaverSpec = { ...base, units: 'viewport', layers: [] };
  const block = (text: string, x: number, y: number, extra: Partial<Extract<SaverSpec['layers'][number]['sprite'], { kind: 'textBlock' }>> = {}, key?: string) => ({
    key,
    count: 1,
    sprite: { kind: 'textBlock' as const, text, maxWidth: 0.4, fontSize: 0.05, ...extra },
    motion: { type: 'static' as const },
    position: { x, y },
  });

  it('warns when a textBlock runs off the right edge', () => {
    const w = adviseSpec({ ...vp, layers: [block('A caption that is far too wide for where it sits', 0.85, 0.5)] });
    const off = w.find((x) => x.code === 'text-off-screen');
    expect(off).toBeDefined();
    expect(off!.path).toBe('layers[0]');
    expect(off!.message).toMatch(/right edge/);
  });

  it('warns when a textBlock runs off the bottom edge', () => {
    const w = adviseSpec({ ...vp, layers: [block('one\ntwo\nthree\nfour\nfive', 0.1, 0.9)] });
    expect(w.find((x) => x.code === 'text-off-screen')!.message).toMatch(/bottom edge/);
  });

  it('does not flag a block that fits', () => {
    // position.x is a fraction of width (0.5·1920 = 960 px); maxWidth is a
    // fraction of min(w,h) (0.4·1080 = 432 px) — the box ends at 1392 of 1920.
    expect(adviseSpec({ ...vp, layers: [block('Fits comfortably here', 0.5, 0.5)] }).filter((x) => x.code === 'text-off-screen')).toEqual([]);
  });

  it('warns when two static text layers paint over each other, once per pair', () => {
    const w = adviseSpec({
      ...vp,
      layers: [block('Title of the talk', 0.1, 0.3, {}, 'title'), block('Body copy under it', 0.1, 0.3, {}, 'body')],
    });
    const overlaps = w.filter((x) => x.code === 'text-overlap');
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.path).toBe('layers[0]');
    expect(overlaps[0]!.message).toMatch(/`title` and `body`/);
  });

  it('does not flag stacked blocks that clear each other', () => {
    const w = adviseSpec({
      ...vp,
      layers: [block('Title of the talk', 0.1, 0.2, {}, 'title'), block('Body copy under it', 0.1, 0.4, {}, 'body')],
    });
    expect(w.filter((x) => x.code === 'text-overlap')).toEqual([]);
  });

  it('judges plain text sprites too — align/baseline move the anchor, maxWidth caps the box', () => {
    const rightAligned: SaverSpec = {
      ...vp,
      layers: [
        // Left-aligned at x 0.98: the whole string hangs off the right edge.
        { count: 1, sprite: { kind: 'text', strings: ['TELEMETRY NOMINAL'], font: 'bold 40px monospace', align: 'left' }, motion: { type: 'static' }, position: { x: 0.98, y: 0.5 } },
        // Right-aligned at the same spot: fits.
        { count: 1, sprite: { kind: 'text', strings: ['TELEMETRY NOMINAL'], font: 'bold 40px monospace', align: 'right' }, motion: { type: 'static' }, position: { x: 0.98, y: 0.7 } },
        // Left-aligned but squeezed by maxWidth: fits.
        { count: 1, sprite: { kind: 'text', strings: ['TELEMETRY NOMINAL'], font: 'bold 40px monospace', align: 'left', maxWidth: 0.02 }, motion: { type: 'static' }, position: { x: 0.98, y: 0.9 } },
      ],
    };
    const off = adviseSpec(rightAligned).filter((x) => x.code === 'text-off-screen');
    expect(off.map((x) => x.path)).toEqual(['layers[0]']);
  });

  it('ignores moving text — it has no fixed box to judge', () => {
    const w = adviseSpec({
      ...vp,
      layers: [
        { count: 1, sprite: { kind: 'textBlock', text: 'A caption that is far too wide for where it sits', maxWidth: 0.4, fontSize: 0.05 }, motion: { type: 'drift', speed: [0.01, 0.02] }, region: { x: [0.9, 0.95] } },
      ],
    });
    expect(w.filter((x) => x.code === 'text-off-screen' || x.code === 'text-overlap')).toEqual([]);
  });
});

describe("adviseSpec — legibility, opt-in by role: 'read' (#59, plan 1e)", () => {
  const vp: SaverSpec = { ...base, units: 'viewport', layers: [] };
  type TextBlockSprite = Extract<SaverSpec['layers'][number]['sprite'], { kind: 'textBlock' }>;
  const block = (text: string, x: number, y: number, extra: Partial<TextBlockSprite> = {}, key?: string): SaverSpec['layers'][number] => ({
    key,
    count: 1,
    sprite: { kind: 'textBlock', text, maxWidth: 0.4, fontSize: 0.05, ...extra },
    motion: { type: 'static' },
    position: { x, y },
  });
  const LEGIBILITY_CODES = new Set(['text-legibility', 'text-safe-area']);
  const legibility = (spec: SaverSpec, viewport?: { width: number; height: number }) =>
    adviseSpec(spec, viewport).filter((w) => LEGIBILITY_CODES.has(w.code));

  /** Every text layer given `role`, or stripped of it. */
  const withRole = (spec: SaverSpec, role: 'read' | 'atmosphere' | undefined): SaverSpec => ({
    ...spec,
    layers: spec.layers.map((l) => {
      if (l.sprite.kind !== 'text' && l.sprite.kind !== 'textBlock') return l;
      const sprite = { ...l.sprite } as Record<string, unknown>;
      if (role === undefined) delete sprite.role;
      else sprite.role = role;
      return { ...l, sprite: sprite as SaverSpec['layers'][number]['sprite'] };
    }),
  });

  const loadFixture = (name: string): IdleSequence =>
    JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}.sequence.json`, import.meta.url)), 'utf8')) as IdleSequence;

  it('role absent (or atmosphere) ⇒ adviseSpec output is identical for every fixture, and the legibility codes never fire', () => {
    // The shipped examples plus every segment of the two stored sequences:
    // the widest set of real text layouts in the repo. `dev-dashboard` puts
    // labels at x 0.035 and paints them at ~2.6:1 on purpose; both advisories
    // would fire on it if they were not gated behind the declaration.
    const fixtures: SaverSpec[] = [
      ...EXAMPLE_SPECS,
      ...loadFixture('deck').segments.map((s) => s.scene),
      ...loadFixture('snow-white').segments.map((s) => s.scene),
    ];
    expect(fixtures.length).toBeGreaterThan(20);
    for (const spec of fixtures) {
      const today = adviseSpec(withRole(spec, undefined));
      expect(adviseSpec(spec), spec.id).toEqual(today);
      expect(adviseSpec(withRole(spec, 'atmosphere')), spec.id).toEqual(today);
      expect(today.filter((w) => LEGIBILITY_CODES.has(w.code)), spec.id).toEqual([]);
    }
  });

  it('the shipped lobby-talk example declares role: read on every text layer and has zero advisories, landscape and portrait', () => {
    const roles = LOBBY_TALK_SPEC.layers
      .filter((l) => l.sprite.kind === 'text' || l.sprite.kind === 'textBlock')
      .map((l) => (l.sprite as { role?: string }).role);
    expect(roles.length).toBeGreaterThanOrEqual(3);
    expect(roles.every((r) => r === 'read')).toBe(true);
    expect(adviseSpec(LOBBY_TALK_SPEC)).toEqual([]);
    expect(adviseSpec(LOBBY_TALK_SPEC, { width: 1080, height: 1920 })).toEqual([]);
  });

  it("role: 'read' on dim text fires text-legibility with the measured ratio; the same text undeclared is silent", () => {
    const dim: SaverSpec = {
      ...vp,
      background: { type: 'solid', color: '#0a0d18' },
      layers: [block('Quarterly adoption', 0.3, 0.4, { color: '#3a4a5c' }, 'label')],
    };
    expect(legibility(dim)).toEqual([]);
    const read = withRole(dim, 'read');
    const w = legibility(read);
    expect(w.map((x) => x.code)).toEqual(['text-legibility']);
    expect(w[0]!.path).toBe('layers[0].sprite');
    // #3a4a5c on #0a0d18 is ~2.1:1 — the message carries the number.
    expect(w[0]!.message).toMatch(/`label`.*reads at 2\.1:1 against the background at the box centre/);
    expect(w[0]!.message).toMatch(/below 4\.5:1/);
    expect(w[0]!.message).not.toMatch(/contrast/i);
    expect(w[0]!.code).not.toMatch(/contrast/i);
    // Bright text on the same ground clears the floor.
    expect(legibility({ ...read, layers: [block('Quarterly adoption', 0.3, 0.4, { color: '#f2f4f8', role: 'read' })] })).toEqual([]);
  });

  it('samples the background at the box centre — a gradient can pass at the top and fail at the bottom', () => {
    const graded: SaverSpec = {
      ...vp,
      background: { type: 'gradient', stops: [{ at: 0, color: '#05050a' }, { at: 1, color: '#c8d0dc' }] },
      layers: [
        block('Top line', 0.3, 0.05, { color: '#d8e0ea', role: 'read' }, 'top'),
        block('Bottom line', 0.3, 0.85, { color: '#d8e0ea', role: 'read' }, 'bottom'),
      ],
    };
    const codes = adviseSpec(graded).filter((w) => w.code === 'text-legibility').map((w) => w.message);
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatch(/`bottom`/);
  });

  it("a field background samples opts.backgroundSeed, not opts.seed — the seed a sequence's inkOverBed advisory needs", () => {
    // scale 8 / octaves 1 at (0.5, 0.5): seed 2 reads near-white, seed 6 near-black
    // (picked empirically — any pair with a legible/illegible split would do).
    const fieldSpec: SaverSpec = {
      ...vp,
      background: { type: 'field', scale: 8, octaves: 1, bands: ['#000000', '#ffffff'] },
      layers: [block('Caption', 0.5, 0.5, { color: '#808080', role: 'read', anchor: 'center' })],
    };
    const asIfBackgroundSeeded = (seed: number, backgroundSeed: number) =>
      adviseSpec(fieldSpec, { width: 1920, height: 1080 }, { seed, backgroundSeed }).filter((w) => LEGIBILITY_CODES.has(w.code));
    // seed varies, backgroundSeed fixed ⇒ same ground (only the background changed methods).
    expect(asIfBackgroundSeeded(1, 2)).toEqual(asIfBackgroundSeeded(99, 2));
    // backgroundSeed varies ⇒ different ground (2 reads white, 6 reads black at this point).
    expect(asIfBackgroundSeeded(1, 2)).not.toEqual(asIfBackgroundSeeded(1, 6));
    // Omitting backgroundSeed falls back to seed, unchanged for every caller
    // with one scene and one seed (every caller but a sequence's inkOverBed).
    // Passes `seed` explicitly (backgroundSeed omitted) so the fallback
    // itself is exercised, not just `spec.seed ?? 42` coincidentally landing
    // on the same value as an all-defaults call would.
    expect(adviseSpec(fieldSpec, { width: 1920, height: 1080 }, { seed: 42 }).filter((w) => LEGIBILITY_CODES.has(w.code)))
      .toEqual(asIfBackgroundSeeded(42, 42));
  });

  it('judges against the brightest additive layer that can sit under a line, at its peak pulse', () => {
    // Bright text on a dark plate: fine on its own. A big static `lighter`
    // glow parked under it, pulsing up to alpha 0.95, lifts the plate until
    // the text no longer reads — the ratio in the message is the lit one.
    const text = block('Signal locked', 0.5, 0.5, { color: '#e6e8ef', role: 'read', anchor: 'center' }, 'caption');
    const glow = (extra: Partial<SaverSpec['layers'][number]> = {}): SaverSpec['layers'][number] => ({
      key: 'glow',
      count: 1,
      sprite: { kind: 'circle', radius: [0.3, 0.3], color: '#ffffff', soft: true },
      alpha: [0.8, 0.8],
      pulse: { amp: 0.15, period: 4000 },
      blend: 'lighter',
      motion: { type: 'static' },
      position: { x: 0.5, y: 0.5 },
      ...extra,
    });
    const clear: SaverSpec = { ...vp, background: { type: 'solid', color: '#05050a' }, layers: [text] };
    expect(legibility(clear)).toEqual([]);

    const lit: SaverSpec = { ...clear, layers: [glow(), text] };
    const w = legibility(lit);
    expect(w.map((x) => x.code)).toEqual(['text-legibility']);
    expect(w[0]!.message).toMatch(/under `glow` at its brightest/);
    // The ground ratio is reported alongside and is still fine.
    expect(w[0]!.message).toMatch(/reads at 1[5-9]\.\d:1 against the background/);

    // The same glow parked far from the text does not reach it.
    expect(legibility({ ...clear, layers: [glow({ position: { x: 0.05, y: 0.05 }, sprite: { kind: 'circle', radius: [0.04, 0.04], color: '#ffffff', soft: true } }), text] })).toEqual([]);
    // A travelling glow can be anywhere — it counts.
    expect(legibility({ ...clear, layers: [glow({ position: undefined, motion: { type: 'wander', speed: [0.01, 0.02] } }), text] }).map((x) => x.code)).toEqual(['text-legibility']);
    // Dust smaller than a glyph cannot wash out a line, however bright.
    expect(legibility({ ...clear, layers: [glow({ position: undefined, count: 60, sprite: { kind: 'circle', radius: [0.001, 0.002], color: '#ffffff', soft: true }, motion: { type: 'wander', speed: [0.01, 0.02] } }), text] })).toEqual([]);
    // Source-over paint is not additive — it is the ground's job to be judged, not a layer's.
    expect(legibility({ ...clear, layers: [glow({ blend: undefined }), text] })).toEqual([]);
  });

  it("emit's on/off envelope does not zero the text's own alpha — a bright emitting label still clears the floor", () => {
    // A `role: 'read'` layer that also declares `emit` is closed at t = 0;
    // sampling `alphaAt(e, 0)` there would collapse the ink to the ground and
    // always fire, regardless of colour. The measured alpha must come from
    // the layer's base/pulse, not the emit window.
    const emitting: SaverSpec = {
      ...vp,
      background: { type: 'solid', color: '#05050a' },
      layers: [{ ...block('Standby', 0.3, 0.4, { color: '#f2f4f8', role: 'read' }), emit: { every: 4000, life: 400 } }],
    };
    expect(legibility(emitting)).toEqual([]);
  });

  it("measures a role: 'read' layer at what it actually paints — a textBlock's own low opacity, or a low-alpha layer, cannot hide behind an unmeasured alpha", () => {
    const lowOpacity: SaverSpec = {
      ...vp,
      background: { type: 'solid', color: '#05050a' },
      layers: [block('Standby', 0.3, 0.4, { color: '#f2f4f8', role: 'read', opacity: 0.05 })],
    };
    expect(legibility(lowOpacity).map((x) => x.code)).toEqual(['text-legibility']);

    const lowLayerAlpha: SaverSpec = {
      ...vp,
      background: { type: 'solid', color: '#05050a' },
      layers: [{ ...block('Standby', 0.3, 0.4, { color: '#f2f4f8', role: 'read' }), alpha: [0.05, 0.05] }],
    };
    expect(legibility(lowLayerAlpha).map((x) => x.code)).toEqual(['text-legibility']);

    // Full opacity/alpha still clears the floor against the same ground.
    expect(legibility({ ...lowOpacity, layers: [block('Standby', 0.3, 0.4, { color: '#f2f4f8', role: 'read' })] })).toEqual([]);
  });

  it('composites the text at its own layer blend, not always source-over', () => {
    // Same ground, ink and alpha: additive lifts clear of the floor while
    // source-over does not — a regression to always-source-over would flip
    // the additive case to fire too, so this fails loudly if that branch
    // stops being exercised.
    const additive: SaverSpec = {
      ...vp,
      background: { type: 'solid', color: '#505050' },
      layers: [{ ...block('Standby', 0.3, 0.4, { color: '#ffffff', role: 'read' }), blend: 'lighter', alpha: [0.5, 0.5] }],
    };
    expect(legibility(additive)).toEqual([]);

    const sourceOver: SaverSpec = {
      ...vp,
      background: { type: 'solid', color: '#505050' },
      layers: [{ ...block('Standby', 0.3, 0.4, { color: '#ffffff', role: 'read' }), alpha: [0.5, 0.5] }],
    };
    expect(legibility(sourceOver).map((x) => x.code)).toEqual(['text-legibility']);

    // Same story for `multiply`: mid-tone ink darkens the ground more than a
    // plain source-over blend would, crossing the floor in the other direction.
    const multiply: SaverSpec = {
      ...vp,
      background: { type: 'solid', color: '#b4b4b4' },
      layers: [{ ...block('Standby', 0.3, 0.4, { color: '#464646', role: 'read' }), blend: 'multiply', alpha: [0.9, 0.9] }],
    };
    expect(legibility(multiply)).toEqual([]);

    const multiplyAsSourceOver: SaverSpec = {
      ...vp,
      background: { type: 'solid', color: '#b4b4b4' },
      layers: [{ ...block('Standby', 0.3, 0.4, { color: '#464646', role: 'read' }), alpha: [0.9, 0.9] }],
    };
    expect(legibility(multiplyAsSourceOver).map((x) => x.code)).toEqual(['text-legibility']);
  });

  it("text at x: 0.02 fires text-safe-area (with its box) only under role: 'read'", () => {
    const edge: SaverSpec = { ...vp, layers: [block('Fine print', 0.02, 0.5, { color: '#ffffff' }, 'fine')] };
    expect(legibility(edge)).toEqual([]);
    const w = legibility(withRole(edge, 'read'));
    expect(w.map((x) => x.code)).toEqual(['text-safe-area']);
    expect(w[0]!.path).toBe('layers[0]');
    expect(w[0]!.message).toMatch(/within 5% of the left edge at 1920×1080/);
    expect(w[0]!.boxes).toHaveLength(1);
    const b = w[0]!.boxes![0]!;
    expect(b.x).toBeCloseTo(0.02, 3);
    expect(b.w).toBeGreaterThan(0);
    expect(b.y).toBeCloseTo(0.5, 3);
    // Two edges name both; a list's whole extent is judged.
    const corner = legibility({ ...vp, layers: [block('Corner', 0.01, 0.97, { color: '#ffffff', role: 'read' })] });
    expect(corner.find((x) => x.code === 'text-safe-area')!.message).toMatch(/left and bottom edges/);
  });

  it('text-overlap carries both boxes in viewport fractions for every fire, role or not; the message is unchanged', () => {
    const w = adviseSpec({
      ...vp,
      layers: [block('Title of the talk', 0.1, 0.3, {}, 'title'), block('Body copy under it', 0.1, 0.3, {}, 'body')],
    });
    const overlaps = w.filter((x) => x.code === 'text-overlap');
    expect(overlaps).toHaveLength(1);
    const o = overlaps[0]!;
    expect(o.message).toMatch(/`title` and `body` text boxes overlap \(~\d+% of the smaller one\) — they will paint over each other; move one or shrink it/);
    expect(o.boxes).toHaveLength(2);
    for (const b of o.boxes!) {
      expect(b.x).toBeCloseTo(0.1, 3);
      expect(b.y).toBeCloseTo(0.3, 3);
      expect(b.w).toBeGreaterThan(0);
      expect(b.w).toBeLessThan(1);
      expect(b.h).toBeGreaterThan(0);
      expect(b.h).toBeLessThan(1);
    }
    // Same fire, same boxes when the layers declare a role.
    const declared = adviseSpec({
      ...vp,
      layers: [block('Title of the talk', 0.1, 0.3, { role: 'read' }, 'title'), block('Body copy under it', 0.1, 0.3, { role: 'atmosphere' }, 'body')],
    }).filter((x) => x.code === 'text-overlap');
    expect(declared[0]!.boxes).toEqual(o.boxes);
  });

  it('a list of text sprites is judged per row, worst row wins, one advisory per layer', () => {
    const rows: SaverSpec = {
      ...vp,
      background: { type: 'gradient', stops: [{ at: 0, color: '#05050a' }, { at: 1, color: '#b0b8c4' }] },
      layers: [{
        key: 'labels',
        count: 4,
        sprite: { kind: 'text', strings: ['One', 'Two', 'Three', 'Four'], color: '#c8d0dc', align: 'left', role: 'read' },
        size: [0.03, 0.03],
        motion: { type: 'static' },
        position: { x: 0.2, y: 0.2 },
        layout: { type: 'list', gap: 0.2 },
      }],
    };
    const w = legibility(rows);
    expect(w.map((x) => x.code)).toEqual(['text-legibility']);
    expect(w[0]!.message).toMatch(/`labels`/);
  });
});

describe('describeScene', () => {
  it('returns snapshots at requested time values', () => {
    const desc = describeScene(base, { times: [0, 3000] });
    expect(desc.snapshots).toHaveLength(2);
    expect(desc.snapshots[0]!.t).toBe(0);
    expect(desc.snapshots[1]!.t).toBe(3000);
  });

  it('reports layer count matching spec', () => {
    const desc = describeScene(base, { times: [0] });
    expect(desc.snapshots[0]!.layers[0]!.count).toBe(20);
  });

  it('scales count with viewport for viewport-unit specs', () => {
    const vpSpec: SaverSpec = {
      ...base,
      units: 'viewport',
      layers: [{ count: 100, sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#fff' }, motion: { type: 'drift', speed: [0.05, 0.1] } }],
    };
    const small = describeScene(vpSpec, { viewport: { width: 540, height: 540 }, times: [0] });
    const large = describeScene(vpSpec, { viewport: { width: 2160, height: 2160 }, times: [0] });
    expect(small.snapshots[0]!.layers[0]!.count).toBe(50);
    expect(large.snapshots[0]!.layers[0]!.count).toBe(200);
  });

  it('reports link connectivity for link layers', () => {
    const linked: SaverSpec = {
      ...base,
      units: 'viewport',
      layers: [{
        count: 30,
        sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#fff' },
        motion: { type: 'drift', speed: [0.01, 0.02] },
        links: { k: 3, maxDist: 0.3 },
      }],
    };
    const desc = describeScene(linked, { times: [0] });
    const layer = desc.snapshots[0]!.layers[0]!;
    expect(layer.linksDrawn).toBeGreaterThan(0);
    expect(layer.linksExpected).toBeGreaterThan(0);
    expect(layer.connectedComponents).toBeGreaterThan(0);
    expect(layer.isolatedNodes).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// adviseSequence
// ---------------------------------------------------------------------------

describe('adviseSequence', () => {
  const scene: SaverSpec = {
    schemaVersion: 1,
    id: 'seq-adv',
    label: 'Seq Advise',
    background: { type: 'solid', color: '#111111' },
    layers: [{ count: 3, sprite: { kind: 'circle', radius: [5, 10], color: '#ffffff' }, motion: { type: 'static' } }],
  };

  function mkSeq(overrides: Partial<IdleSequence> = {}): IdleSequence {
    return {
      format: 'idle-sequence',
      schemaVersion: 1,
      id: 'adv-test',
      label: 'Advise Test',
      seed: 1,
      loop: false,
      segments: [
        { key: 'a', scene, duration: 5000 },
        { key: 'b', scene, duration: 5000 },
      ],
      ...overrides,
    };
  }

  it('returns no warnings for structurally identical segments', () => {
    const warnings = adviseSequence(mkSeq());
    expect(warnings.filter((w) => w.code === 'boundary-luminance-jump')).toHaveLength(0);
  });

  it('fade-degrades-on-low-tier: once per sequence when any fade is declared, never for cut/morph (1c)', () => {
    const fades = adviseSequence(mkSeq({
      segments: [
        { key: 'a', scene, duration: 5000, transition: { type: 'fade', dur: 800 } },
        { key: 'b', scene, duration: 5000, transition: { type: 'fade', dur: 800 } },
        { key: 'c', scene, duration: 5000 },
      ],
    })).filter((w) => w.code === 'fade-degrades-on-low-tier');
    expect(fades).toHaveLength(1);
    expect(fades[0]!.path).toBe('segments[0].transition');
    expect(fades[0]!.message).toMatch(/^informational: 2 fade transitions/);
    for (const transition of [{ type: 'cut' } as const, { type: 'morph', dur: 800 } as const, undefined]) {
      const w = adviseSequence(mkSeq({ segments: [{ key: 'a', scene, duration: 5000, transition }, { key: 'b', scene, duration: 5000 }] }));
      expect(w.filter((x) => x.code === 'fade-degrades-on-low-tier')).toHaveLength(0);
    }
  });

  it('fade-degrades-on-low-tier: not raised for a fade on the last segment without loop (it never runs)', () => {
    const w = adviseSequence(mkSeq({
      loop: false,
      segments: [
        { key: 'a', scene, duration: 5000 },
        { key: 'b', scene, duration: 5000, transition: { type: 'fade', dur: 800 } },
      ],
    })).filter((x) => x.code === 'fade-degrades-on-low-tier');
    expect(w).toHaveLength(0);
  });

  it("fade-degrades-on-low-tier: raised for the last segment's fade under loop (it's the wrap's transition)", () => {
    const w = adviseSequence(mkSeq({
      loop: true,
      segments: [
        { key: 'a', scene, duration: 5000 },
        { key: 'b', scene, duration: 5000, transition: { type: 'fade', dur: 800 } },
      ],
    })).filter((x) => x.code === 'fade-degrades-on-low-tier');
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe('segments[1].transition');
  });

  it('warns on large luminance jump at boundary', () => {
    const dark: SaverSpec = { ...scene, background: { type: 'solid', color: '#000000' } };
    const bright: SaverSpec = { ...scene, background: { type: 'solid', color: '#ffffff' } };
    const warnings = adviseSequence(mkSeq({
      segments: [
        { key: 'a', scene: dark, duration: 5000 },
        { key: 'b', scene: bright, duration: 5000 },
      ],
    }));
    expect(warnings.some((w) => w.code === 'boundary-luminance-jump')).toBe(true);
  });

  it('warns on morph structural mismatch', () => {
    const diffScene: SaverSpec = {
      ...scene,
      layers: [{ count: 10, sprite: { kind: 'emoji', glyphs: ['🔴'] }, motion: { type: 'static' } }],
    };
    const warnings = adviseSequence(mkSeq({
      segments: [
        { key: 'a', scene, duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: diffScene, duration: 5000 },
      ],
    }));
    expect(warnings.some((w) => w.code === 'morph-structural-mismatch')).toBe(true);
  });

  it('warns morph-nothing-morphable for text-only twins, and only then', () => {
    const caption = (text: string, color: string): SaverSpec => ({
      ...scene,
      units: undefined,
      layers: [{
        count: 1,
        sprite: { kind: 'textBlock', text, maxWidth: 0.6, fontSize: 0.04, color },
        motion: { type: 'static' },
        position: { x: 0.2, y: 0.2 },
      }],
    });
    const morph = (a: SaverSpec, b: SaverSpec, type: 'morph' | 'cut' = 'morph') => adviseSequence(mkSeq({
      segments: [
        { key: 'a', scene: a, duration: 5000, transition: type === 'morph' ? { type, dur: 1000 } : { type } },
        { key: 'b', scene: b, duration: 5000 },
      ],
    })).filter((w) => w.code === 'morph-nothing-morphable');

    expect(morph(caption('Act I', '#e6e8ef'), caption('Act II', '#e6e8ef'))).toHaveLength(1);
    expect(morph(caption('Act I', '#e6e8ef'), caption('Act II', '#808080'))).toHaveLength(0);
    expect(morph(caption('Act I', '#e6e8ef'), caption('Act II', '#e6e8ef'), 'cut')).toHaveLength(0);
  });

  it('propagates per-segment advisories', () => {
    const camoScene: SaverSpec = {
      ...scene,
      background: { type: 'solid', color: '#ffffff' },
      layers: [{ count: 5, sprite: { kind: 'circle', radius: [5, 10], color: '#ffffff' }, motion: { type: 'static' } }],
    };
    const warnings = adviseSequence(mkSeq({
      segments: [{ key: 'a', scene: camoScene, duration: 5000 }],
    }));
    expect(warnings.some((w) => w.path.startsWith('segments[0].scene.'))).toBe(true);
  });
});
