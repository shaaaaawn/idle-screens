/**
 * Advisory false positives on established idioms (F145, F146, F147 in the
 * MCP feedback log). Each case pins the old false positive silent AND the real
 * positive it must keep raising — an advisory that goes quiet everywhere would
 * pass the first half on its own.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adviseSequence, adviseSpec } from './advise';
import { EXAMPLE_SPECS, SCHEMA_EXAMPLES, THREE_MOVEMENTS_SEQUENCE } from './examples/index';
import { describeStructuralDifferences, structuralDifferences, structuralSignature } from './steer';
import { LIMITS, type IdleSequence, type LayerSpec, type SaverSpec } from './types';
import { validateSequence, validateSpec } from './validate';

const scene = (layers: LayerSpec[], extra: Partial<SaverSpec> = {}): SaverSpec => ({
  schemaVersion: 1,
  id: 'idiom',
  label: 'Idiom',
  background: { type: 'solid', color: '#08080e' },
  layers,
  ...extra,
});
const seqOf = (segments: IdleSequence['segments']): IdleSequence => ({ format: 'idle-sequence', schemaVersion: 1, id: 'seq', label: 'Seq', loop: false, segments } as IdleSequence);
const codes = (s: SaverSpec, vp?: { width: number; height: number }) => adviseSpec(s, vp).map((w) => w.code);
const valid = (s: SaverSpec): SaverSpec => {
  const r = validateSpec(s);
  expect(r.errors).toEqual([]);
  return s;
};

type TextBlock = Extract<LayerSpec['sprite'], { kind: 'textBlock' }>;
const block = (key: string, text: string, x: number, y: number, extra: Partial<TextBlock> = {}, layer: Partial<LayerSpec> = {}): LayerSpec => ({
  key,
  count: 1,
  sprite: { kind: 'textBlock', text, maxWidth: 0.4, fontSize: 0.05, color: '#e6e8ef', ...extra },
  motion: { type: 'static' },
  position: { x, y },
  ...layer,
});

describe("F146 X807: role 'atmosphere' text skips the layout checks", () => {
  const wall = (role?: 'atmosphere' | 'read'): SaverSpec => scene([{
    key: 'board',
    count: 4,
    sprite: { kind: 'text', strings: ['ARRIVALS', 'DEPARTURES', 'PLATFORM'], color: '#7a8090', ...(role ? { role } : {}) },
    size: [0.05, 0.05],
    motion: { type: 'static' },
    position: { x: 0.4, y: 0.4 },
    layout: { type: 'table', columns: 2, gap: 0.05 },
  }]);

  it('layout-text-overlap and list-length-mismatch stay silent on atmosphere, fire without it', () => {
    expect(codes(wall())).toContain('layout-text-overlap');
    expect((validateSpec(wall()).warnings ?? []).map((w) => w.code)).toContain('list-length-mismatch');
    expect(codes(wall('read'))).toContain('layout-text-overlap');
    expect(codes(wall('atmosphere'))).not.toContain('layout-text-overlap');
    const atm = validateSpec(wall('atmosphere'));
    expect(atm.valid).toBe(true);
    expect((atm.warnings ?? []).map((w) => w.code)).not.toContain('list-length-mismatch');
  });

  it('text-overlap drops any pair with an atmosphere member; two unmarked layers still collide', () => {
    const pair = (role?: 'atmosphere') => scene([block('title', 'Title of the talk', 0.1, 0.3), block('haze', 'drifting words under it', 0.1, 0.3, role ? { role } : {})]);
    expect(codes(pair())).toContain('text-overlap');
    expect(codes(pair('atmosphere'))).not.toContain('text-overlap');
  });
});

describe('F146 X783: a chip on a path-drawing card is judged against the card', () => {
  // A seven-part card (a pale face, a frame, five details) and a dark chip on its face.
  const card = (chipColor: string, cardAt = { x: 0.5, y: 0.5 }, face = '#e8e4d8'): SaverSpec => valid(scene([
    {
      key: 'card',
      count: 1,
      position: cardAt,
      sprite: {
        kind: 'polygon',
        radius: [0.35, 0.35],
        color: face,
        parts: [
          { path: 'M -1 -0.7 L 1 -0.7 L 1 0.7 L -1 0.7 Z' },
          { path: 'M -1 -0.7 L 1 -0.7 L 1 -0.62 L -1 -0.62 Z', color: '#b0a890' },
          { path: 'M -0.9 0.5 L -0.5 0.5 L -0.5 0.6 L -0.9 0.6 Z', color: '#c8c0a8' },
          { path: 'M 0.5 0.5 L 0.9 0.5 L 0.9 0.6 L 0.5 0.6 Z', color: '#c8c0a8' },
          { path: 'M -0.9 -0.5 L -0.7 -0.5 L -0.7 -0.4 L -0.9 -0.4 Z', color: '#d8d0b8' },
          { path: 'M 0.7 -0.5 L 0.9 -0.5 L 0.9 -0.4 L 0.7 -0.4 Z', color: '#d8d0b8' },
          { path: 'M -0.2 0.62 L 0.2 0.62 L 0.2 0.68 L -0.2 0.68 Z', color: '#a09880' },
        ],
      },
      motion: { type: 'static' },
    },
    { key: 'chip', count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'circle', radius: [0.03, 0.03], color: chipColor }, motion: { type: 'static' } },
  ]));
  const rectCard = (chipColor: string): SaverSpec => valid(scene([
    { key: 'card', count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'rect', width: [0.7, 0.7], aspect: [0.7, 0.7], color: '#e8e4d8' }, motion: { type: 'static' } },
    { key: 'chip', count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'circle', radius: [0.03, 0.03], color: chipColor }, motion: { type: 'static' } },
  ]));

  it('a background-coloured chip reads like the same chip on a rect card: clean', () => {
    expect(codes(rectCard('#0a0a12'))).not.toContain('low-contrast-layer');
    expect(codes(card('#0a0a12'))).not.toContain('low-contrast-layer');
  });

  it('still fires for the dark chip on a dark card face, and with no card under it', () => {
    expect(codes(card('#0a0a12', { x: 0.5, y: 0.5 }, '#0b0b13'))).toContain('low-contrast-layer');
    expect(codes(card('#0a0a12', { x: 0.1, y: 0.1 }))).toContain('low-contrast-layer');
  });
});

describe('F146 X739: uniform-motion on an orbit compares on-screen speed', () => {
  const ring = (radius: [number, number]): SaverSpec => valid(scene([{
    count: 12,
    sprite: { kind: 'circle', radius: [0.008, 0.012], color: '#ffd9a0' },
    motion: { type: 'orbit', speed: [20, 20], radius, center: { x: 0.5, y: 0.5 } },
  }]));

  it('one angular speed over a spread of radii is varied motion', () => {
    expect(codes(ring([0.05, 0.45]))).not.toContain('uniform-motion');
  });

  it('one angular speed at one radius is still uniform', () => {
    expect(codes(ring([0.3, 0.3]))).toContain('uniform-motion');
  });
});

describe('F146 X771: count-based advisories read the declared count', () => {
  const motes = (count: number): LayerSpec => ({ count, sprite: { kind: 'circle', radius: [0.002, 0.004], color: '#ffffff' }, alpha: [0.4, 0.8], motion: { type: 'drift', speed: [0.01, 0.02] } });
  const crowd = (n: number): SaverSpec => valid(scene([motes(Math.ceil(n / 2)), motes(Math.floor(n / 2))]));

  it('532 entities raise dense-scene at 480×270, 960×540 and 1920×1080 alike', () => {
    for (const vp of [{ width: 480, height: 270 }, { width: 960, height: 540 }, { width: 1920, height: 1080 }]) {
      expect(codes(crowd(532), vp)).toContain('dense-scene');
    }
  });

  it('300 entities stay silent at 4K, where the build doubles them', () => {
    expect(codes(crowd(300), { width: 3840, height: 2160 })).not.toContain('dense-scene');
    expect(codes(crowd(300))).not.toContain('dense-scene');
  });

  it('full-coherence reads the declared count too', () => {
    const sheet = valid(scene([{ count: 24, sprite: { kind: 'circle', radius: [0.004, 0.008], color: '#8fd0ff' }, motion: { type: 'wander', speed: [0.01, 0.02], coherence: 1 } }]));
    expect(codes(sheet, { width: 480, height: 270 })).toContain('full-coherence');
    expect(codes(sheet)).toContain('full-coherence');
  });
});

describe('F145 X759/X776: text overlap is judged over the piece, not one instant', () => {
  // Two cards in one place, handed off by a keyed opacity cross-fade — the timed-deck idiom.
  const handoff = (outEnds: number, inStarts: number, extra: Partial<SaverSpec> = {}): SaverSpec => valid(scene([
    block('first', 'The first card of the deck', 0.1, 0.3, {}, { opacity: 1 }),
    block('second', 'And the second one after', 0.1, 0.3, {}, { opacity: 0 }),
  ], {
    timeline: {
      keys: [
        { t: outEnds - 400, path: 'first.opacity', value: 0, dur: 400 },
        { t: inStarts, path: 'second.opacity', value: 1, dur: 400 },
      ],
    },
    ...extra,
  }));

  it('silent when the two are never visible together (X759: one is at opacity 0 at the judged instant)', () => {
    const w = adviseSpec(handoff(2000, 2200));
    expect(w.map((x) => x.code)).not.toContain('text-overlap');
  });

  it('fires when the cards are visible together at a key boundary, and names when', () => {
    const w = adviseSpec(handoff(3000, 1000)).filter((x) => x.code === 'text-overlap');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/both visible at \d+ ms/);
  });

  it('a box keyed to scale 0.001 is not a box (X776); at full scale the same pair fires', () => {
    const shrink = (scale: number) => valid(scene([
      block('title', 'Title of the talk', 0.1, 0.3),
      // Scaled in place (about its own anchor), so the shrunk box still sits inside the title's.
      block('body', 'Body copy under it', 0.1, 0.3, {}, { transform: { scale: 1, origin: 'anchor' } }),
    ], { timeline: { keys: [{ t: 0, path: 'body.transform.scale', value: scale, dur: 0 }] } }));
    expect(codes(shrink(0.001))).not.toContain('text-overlap');
    expect(codes(shrink(1))).toContain('text-overlap');
  });

  it('a reveal that has not begun hides its box; a begun one does not', () => {
    const typed = (progress: number) => valid(scene([
      block('title', 'Title of the talk', 0.1, 0.3),
      block('body', 'Body copy under it', 0.1, 0.3, { reveal: { progress } }),
    ]));
    expect(codes(typed(0))).not.toContain('text-overlap');
    expect(codes(typed(0.5))).toContain('text-overlap');
  });

  it('never samples past a sequence segment\'s end', () => {
    // The second card fades in at 4 s, but the segment ends at 3 s: within it they never share the screen.
    const piece = handoff(6000, 4000);
    expect(codes(piece)).toContain('text-overlap');
    const seq = seqOf([{ key: 'a', scene: piece, duration: 3000 }]);
    expect(validateSequence(seq).valid).toBe(true);
    expect(adviseSequence(seq).map((w) => w.code)).not.toContain('text-overlap');
  });

  it('an untimed scene is judged at its one instant, exactly as before', () => {
    const still = valid(scene([block('title', 'Title of the talk', 0.1, 0.3), block('body', 'Body copy under it', 0.1, 0.3)]));
    const w = adviseSpec(still).filter((x) => x.code === 'text-overlap');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/^`title` and `body` text boxes overlap \(~\d+% of the smaller one\) — they will paint over each other; move one or shrink it$/);
  });

  it('text-heavy counts text as static only when no key touches it', () => {
    const doc = (keyed: boolean) => valid(scene([
      block('a', 'One line', 0.1, 0.1, {}, { opacity: 1 }),
      block('b', 'Two line', 0.1, 0.3),
      block('c', 'Three line', 0.1, 0.5),
      block('d', 'Four line', 0.1, 0.7),
    ], keyed ? { timeline: { keys: [{ t: 1000, path: 'a.opacity', value: 0.4, dur: 1000 }] } } : {}));
    expect(codes(doc(false))).toContain('text-heavy');
    expect(codes(doc(true))).not.toContain('text-heavy');
  });
});

describe('F145 X808: life under a looping timeline is noted', () => {
  const lifeScene = (life: LayerSpec['life'], loop: boolean): SaverSpec => valid(scene([
    { key: 'motes', count: 30, sprite: { kind: 'circle', radius: [0.004, 0.008], color: '#ffd9a0' }, alpha: [0.4, 0.8], life, opacity: 1, motion: { type: 'drift', speed: [0.01, 0.03] } },
  ], { timeline: { loop, duration: 8000, keys: [{ t: 0, path: 'motes.opacity', value: 1, dur: 1000 }] } }));

  it('an informational note when life sits under loop: true', () => {
    const w = adviseSpec(lifeScene({ enter: 500, exit: 6000 }, true)).filter((x) => x.code === 'life-runs-once');
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe('layers[0].life');
    expect(w[0]!.message).toMatch(/^informational: /);
    expect(w[0]!.message).toMatch(/stays gone/);
  });

  it('silent without loop, or with a life that does nothing over time', () => {
    expect(codes(lifeScene({ enter: 500 }, false))).not.toContain('life-runs-once');
    expect(codes(lifeScene({ fade: 500 }, true))).not.toContain('life-runs-once');
  });
});

describe('F147 X810: morph-structural-mismatch names the field that differs', () => {
  const tiles = (layout: LayerSpec['layout']): SaverSpec => scene([
    { count: 4, sprite: { kind: 'circle', radius: [0.01, 0.01], color: '#ffffff' }, motion: { type: 'static' } },
    {
      key: 'tiles',
      count: 3,
      sprite: { kind: 'text', strings: ['a', 'b', 'c'], color: '#e6e8ef' },
      size: [0.04, 0.04],
      motion: { type: 'static' },
      region: { x: [0.2, 0.8], y: [0.2, 0.8] },
      layout,
    },
  ]);
  const seq = (b: SaverSpec): IdleSequence => seqOf([
    { key: 'a', scene: tiles({ type: 'grid', columns: 3 }), duration: 4000, transition: { type: 'morph', dur: 1000 } },
    { key: 'b', scene: b, duration: 4000 },
  ]);

  it('a layout-only change names layers[1].layout.type, in the validator and the advisory', () => {
    const s = seq(tiles({ type: 'list' }));
    expect(validateSequence(s).errors).toEqual([]);
    const v = (validateSequence(s).warnings ?? []).find((w) => w.code === 'morph-structural-mismatch');
    const a = adviseSequence(s).find((w) => w.code === 'morph-structural-mismatch');
    for (const w of [v, a]) {
      expect(w).toBeDefined();
      expect(w!.message).toContain('layers[1].layout.type: grid → list');
      expect(w!.message).toContain('layers[1].layout.columns: 3 → (unset)');
      expect(w!.message).toMatch(/morph will fall back to cut$/);
    }
  });

  it('names a count change and caps a long list', () => {
    const b = tiles({ type: 'grid', columns: 3 });
    expect(structuralDifferences(tiles({ type: 'grid', columns: 3 }), { ...b, layers: [{ ...b.layers[0]!, count: 9 }, b.layers[1]!] })).toEqual(['layers[0].count: 4 → 9']);
    const many = { ...b, units: 'px' as const, referenceViewport: 720, layers: [{ ...b.layers[0]!, count: 9 }] };
    expect(describeStructuralDifferences(tiles({ type: 'grid', columns: 3 }), many)).toMatch(/; \+\d+ more$/);
  });

  it('structural twins name nothing', () => {
    const a = tiles({ type: 'grid', columns: 3 });
    expect(structuralDifferences(a, { ...a, background: { type: 'solid', color: '#202030' } })).toEqual([]);
  });
});

/**
 * The signature as it was written before it was split into named fields —
 * kept verbatim as the reference the refactor must reproduce byte for byte
 * (the renderer and the validator compare these strings).
 */
function legacySignature(spec: SaverSpec): string {
  return JSON.stringify([
    spec.units,
    spec.referenceViewport ?? LIMITS.referenceViewport,
    spec.layers.map((l) => {
      const s = l.sprite as Record<string, unknown>;
      return [
        l.count, l.size, l.region, l.position, l.motion, l.wrap, l.flip, l.alpha, l.pulse, l.spin, l.grow, l.layout, l.emit, l.clock,
        l.sprite.kind, s.radius, s.length,
        l.sprite.kind === 'rect' ? [s.width, s.aspect] : l.sprite.kind === 'bar' ? [s.length, s.thickness] : undefined,
        Array.isArray(s.colors) ? s.colors.length : undefined,
        s.colorWeights,
        l.sprite.kind === 'emoji'
          ? [l.sprite.glyphs.length, l.sprite.cycle?.period]
          : l.sprite.kind === 'text'
            ? [l.sprite.strings.length, l.sprite.cycle?.period]
            : l.sprite.kind === 'textBlock'
              ? (l.sprite.anchor ? [l.sprite.fontSize, l.sprite.anchor] : [l.sprite.fontSize])
              : undefined,
        ...(l.rotate !== undefined ? [l.rotate] : []),
        ...(l.rock !== undefined ? [{ rock: l.rock }] : []),
      ];
    }),
  ]);
}

describe('structuralSignature is byte-identical after the named-field refactor', () => {
  const scenes: SaverSpec[] = [...EXAMPLE_SPECS, ...SCHEMA_EXAMPLES.map((e) => e.spec), ...THREE_MOVEMENTS_SEQUENCE.segments.map((s) => s.scene)];
  const fixtures = fileURLToPath(new URL('./__fixtures__', import.meta.url));
  const visit = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    const o = v as Record<string, unknown>;
    if (o.schemaVersion === 1 && Array.isArray(o.layers)) { scenes.push(o as unknown as SaverSpec); return; }
    Object.values(o).forEach(visit);
  };
  for (const dir of [fixtures, `${fixtures}/timed`]) {
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) visit(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
  }

  it('matches the legacy string for every example and fixture scene', () => {
    expect(scenes.length).toBeGreaterThan(30);
    for (const s of scenes) expect(structuralSignature(s)).toBe(legacySignature(s));
  });

  it('names a difference exactly when the signatures differ', () => {
    for (let i = 0; i < scenes.length; i++) {
      const a = scenes[i]!;
      const b = scenes[(i + 1) % scenes.length]!;
      expect(structuralDifferences(a, b).length > 0).toBe(structuralSignature(a) !== structuralSignature(b));
      expect(structuralDifferences(a, a)).toEqual([]);
    }
  });
});
