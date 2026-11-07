import { describe, expect, it } from 'vitest';
import { adviseSpec } from './advise';
import { luminanceGrid, motionStats, perceiveScene, type LuminanceGrid } from './perceive';
import type { SaverSpec } from './types';

// Each case is a third-party report (X-number) of perception reading
// something the screen does not show; the repro is the report's own spec.
const sq = 'M -1 -1 L 1 -1 L 1 1 L -1 1 Z';
const L = (o: Record<string, unknown>): Record<string, unknown> => ({ count: 1, alpha: [1, 1], motion: { type: 'static' }, ...o });
const scene = (bg: unknown, layers: unknown[], extra: Record<string, unknown> = {}): SaverSpec =>
  ({ schemaVersion: 1, id: 'p', label: 'p', background: typeof bg === 'string' ? { type: 'solid', color: bg } : bg, layers, ...extra }) as unknown as SaverSpec;
const codes = (s: SaverSpec, w: number, h: number, t?: number): string[] => adviseSpec(s, { width: w, height: h }, t === undefined ? {} : { t }).map((x) => x.code);
/** Total ink of a grid on a black ground (each cell is the share of it a white shape covers). */
const mass = (g: LuminanceGrid): number => g.cells.reduce((m, v) => m + v, 0);
const share = (s: SaverSpec, key: string, w: number, h: number): number =>
  perceiveScene(s, { viewport: { width: w, height: h } }).dominance.find((d) => d.key === key)?.share ?? 0;

describe('perception reads what is on screen', () => {
  it('X616: a layer wholly off screen is not the main mass, and adds no colour', () => {
    const s = scene('#f4eee2', [
      L({ key: 'onscreen', position: { x: 0.5, y: 0.5 }, sprite: { kind: 'polygon', radius: [0.1, 0.1], color: '#ff3a4a', path: sq } }),
      L({ key: 'offscreen', position: { x: 0.5, y: 0.5, dx: -0.9, dy: 0 }, sprite: { kind: 'polygon', radius: [0.1, 0.1], color: '#1b1b22', path: sq } }),
    ]);
    expect(share(s, 'offscreen', 1080, 1080)).toBe(0);
    expect(perceiveScene(s, { viewport: { width: 1080, height: 1080 } }).colour.hex).toBe('#ff3a4a');
  });

  it('a thin rule or a short bar adds the colour of its own ink, not of a square as long as it is', () => {
    // 0.9 × 0.009 of red (or a bar at a twentieth of its 0.9) beside a 0.2 × 0.2 blue tile:
    // the tile lays ~5× (or ~40×) the ink, so the scene reads blue.
    const tile = L({ key: 'tile', position: { x: 0.5, y: 0.7 }, sprite: { kind: 'rect', width: [0.2, 0.2], color: '#0000ff' } });
    const rule = L({ key: 'rule', position: { x: 0.5, y: 0.3 }, sprite: { kind: 'rect', width: [0.9, 0.9], aspect: [0.01, 0.01], color: '#ff0000' } });
    const bar = L({ key: 'bar', position: { x: 0.05, y: 0.3 }, sprite: { kind: 'bar', values: [0.05], max: 1, length: 0.9, thickness: 0.02, color: '#ff0000' } });
    const rgb = (s: SaverSpec) => { const hex = perceiveScene(s, { viewport: { width: 1000, height: 1000 } }).colour.hex; return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); };
    for (const red of [rule, bar]) {
      const [r, , b] = rgb(scene('#000000', [red, tile]));
      expect(b).toBeGreaterThan(r!);
    }
    // A square red tile of the same width as the rule still outweighs the blue one.
    const [r, , b] = rgb(scene('#000000', [L({ key: 'big', position: { x: 0.5, y: 0.3 }, sprite: { kind: 'rect', width: [0.4, 0.4], color: '#ff0000' } }), tile]));
    expect(r).toBeGreaterThan(b!);
  });

  it('X609: a drawing whose parts are all opacity 0 has no share and no colour', () => {
    const s = scene('#10082a', [
      L({ key: 'box', position: { x: 0.3, y: 0.5 }, sprite: { kind: 'polygon', radius: [0.1, 0.1], color: '#ff2a9a', path: sq } }),
      L({ key: 'ghost', position: { x: 0.65, y: 0.5 }, sprite: { kind: 'polygon', radius: [0.3, 0.3], color: '#b4ff1e', parts: [
        { path: 'M -0.9 0 L 0 -0.9 L 0.9 0 Z', color: '#b4ff1e', opacity: 0 },
        { path: 'M -0.9 0.2 L 0.9 0.2 L 0 0.9 Z', color: '#b4ff1e', opacity: 0 },
      ] } }),
    ]);
    expect(share(s, 'ghost', 960, 540)).toBe(0);
    expect(perceiveScene(s, { viewport: { width: 960, height: 540 } }).colour.hex).toBe('#ff2a9a');
  });

  it('X605: one thin open stroke is a line, not an area, and does not trip additive-saturation', () => {
    const s = scene('#100820', [
      L({ key: 'line', position: { x: 0.5, y: 0.5 }, blend: 'lighter', sprite: { kind: 'polygon', radius: [1.6, 1.6], color: '#b4ff1e', fill: false, path: 'M -0.1 0 L 0.06 0.09', stroke: { color: '#b4ff1e', width: 0.0025, opacity: 1 } } }),
      L({ key: 'glow', position: { x: 0.5, y: 0.5 }, blend: 'lighter', alpha: [0.24, 0.24], sprite: { kind: 'circle', radius: [0.3, 0.3], color: '#ffffff', soft: true } }),
    ]);
    expect(share(s, 'line', 1600, 900)).toBeLessThan(0.05);
    expect(codes(s, 1600, 900)).not.toContain('additive-saturation');
  });

  it('X608: a drawing is judged by the colours its parts paint, not its base colour', () => {
    const s = scene({ type: 'gradient', stops: [{ at: 0, color: '#e8f8ff' }, { at: 1, color: '#fff0f6' }] }, [
      L({ key: 'globe', position: { x: 0.5, y: 0.5 }, sprite: { kind: 'polygon', radius: [0.2, 0.2], color: '#e8f8ff', parts: [
        { path: 'M -0.9 0 A 0.9 0.9 0 1 0 0.9 0 A 0.9 0.9 0 1 0 -0.9 0 Z', color: '#e8f8ff', opacity: 0.55 },
        { path: 'M -0.3 0.2 A 0.15 0.15 0 1 0 0 0.2 A 0.15 0.15 0 1 0 -0.3 0.2 Z', color: '#ff9ac8' },
        { path: 'M 0.1 0.3 A 0.15 0.15 0 1 0 0.4 0.3 A 0.15 0.15 0 1 0 0.1 0.3 Z', color: '#8ad0ff' },
      ] } }),
    ]);
    expect(codes(s, 960, 540, 1000)).not.toContain('low-contrast-layer');
  });

  it("X610: a dark layer seen through a pale frame's hole is judged against the frame", () => {
    const s = scene('#120638', [
      L({ key: 'inside', position: { x: 0.5, y: 0.5 }, sprite: { kind: 'polygon', radius: [0.2, 0.2], color: '#0e0624', path: 'M -0.3 -0.3 L 0.3 -0.3 L 0.3 0.3 L -0.3 0.3 Z' } }),
      L({ key: 'wall', position: { x: 0.5, y: 0.5 }, sprite: { kind: 'polygon', radius: [0.2, 0.2], color: '#e8e4ff', fillRule: 'evenodd', path: `${sq} M -0.25 -0.25 L -0.25 0.25 L 0.25 0.25 L 0.25 -0.25 Z` } }),
    ]);
    expect(codes(s, 960, 540)).not.toContain('low-contrast-layer');
    // Without the frame, the same dark layer on the dark ground is still flagged.
    expect(codes(scene('#120638', [(s.layers as unknown[])[0]]), 960, 540)).toContain('low-contrast-layer');
  });

  it("X607: spin moves a shape's ink even when its centre stands still", () => {
    const at = (spin: number) => perceiveScene(scene('#000000', [L({ key: 'wedge', position: { x: 0.5, y: 0.5 }, spin, sprite: { kind: 'polygon', radius: [0.3, 0.3], color: '#ffffff', path: 'M 0 0 L 0.95 -0.15 L 0.95 0.15 Z' } })]), { viewport: { width: 960, height: 540 }, t: 2000 }).motion[0]!;
    expect(at(0).moving).toBe(false);
    expect(at(50).moving).toBe(true);
    expect(at(200).meanSpeed).toBeGreaterThan(at(50).meanSpeed * 3);
  });

  it("X606: a layer's transform.rotate turns its outline in the maps, not just its position", () => {
    const s = scene('#000000', [L({ key: 'bar', position: { x: 0.5, y: 0.5 }, transform: { rotate: 90, x: 0.1, origin: 'anchor' }, sprite: { kind: 'polygon', radius: [0.2, 0.2], color: '#ffffff', path: 'M 0 -0.1 L 0.9 -0.1 L 0.9 0.1 L 0 0.1 Z' } })]);
    const c = perceiveScene(s, { viewport: { width: 400, height: 400 }, t: 1000 }).centroid!;
    expect(c.x).toBeCloseTo(0.6, 1);
    expect(c.y).toBeGreaterThan(0.55);
  });

  it('vork-review A6: a rocking polygon swings its ink in the maps, and moves while its centre stands still', () => {
    // FORMAT.md once said rock (and all sprite rotation) was invisible to
    // perception; the outline path turns it. The wedge is large enough to be
    // traced by its outline, and the clock pins the phase: rotationAt is
    // amp · sin(2πt / period), so +45° at a quarter period, −45° at three.
    const wedge = (rock?: Record<string, unknown>): SaverSpec => scene('#000000', [L({
      key: 'sign', position: { x: 0.5, y: 0.5 }, ...(rock ? { rock, clock: { phase: 0 } } : {}),
      sprite: { kind: 'polygon', radius: [0.3, 0.3], color: '#ffffff', path: 'M 0 0 L 0.95 -0.15 L 0.95 0.15 Z' },
    })]);
    const at = (s: SaverSpec, t: number) => perceiveScene(s, { viewport: { width: 400, height: 400 }, t });
    const rocking = wedge({ amp: 45, period: 4000 });
    expect(at(rocking, 1000).centroid!.y).toBeGreaterThan(0.55); // tip swung down
    expect(at(rocking, 3000).centroid!.y).toBeLessThan(0.45); // …and up
    expect(at(rocking, 2000).motion[0]!.moving).toBe(true); // mid-swing, fastest
    const still = wedge();
    expect(at(still, 3000).centroid).toEqual(at(still, 1000).centroid);
    expect(at(still, 2000).motion[0]!.moving).toBe(false);
    // Motion counts the turn for every shape but a circle or ring, so a
    // rocking rect moves — and its box swings in the maps with it.
    const plank = (rock?: Record<string, unknown>): SaverSpec => scene('#000000', [L({
      key: 'plank', position: { x: 0.5, y: 0.5 }, ...(rock ? { rock, clock: { phase: 0 } } : {}),
      sprite: { kind: 'rect', width: [0.4, 0.4], aspect: [0.1, 0.1], color: '#ffffff' },
    })]);
    expect(at(plank({ amp: 45, period: 4000 }), 2000).motion[0]!.moving).toBe(true);
    expect(at(plank(), 2000).motion[0]!.moving).toBe(false);
    expect(at(plank({ amp: 45, period: 4000 }), 1000).braille).not.toBe(at(plank({ amp: 45, period: 4000 }), 3000).braille);
    expect(at(plank(), 1000).braille).toBe(at(plank(), 3000).braille);
  });

  it('a turned rect lands in the maps where it is painted: its turned box, not its unturned one or its bounding box', () => {
    // A plank lying along the bottom edge is all on screen; stood on end —
    // by `rotate` or by its layer's `transform.rotate` — half of it hangs
    // below the frame, and the half that shows runs up to y = 0.6.
    const plank = (o: Record<string, unknown> = {}, y = 0.9): SaverSpec => scene('#000000', [L({ key: 'plank', position: { x: 0.5, y }, sprite: { kind: 'rect', width: [0.6, 0.6], aspect: [0.05, 0.05], color: '#ffffff' }, ...o })]);
    const centroid = (s: SaverSpec) => perceiveScene(s, { viewport: { width: 400, height: 400 } }).centroid!;
    expect(centroid(plank()).y).toBeCloseTo(0.9, 2);
    expect(centroid(plank({ rotate: 90 })).y).toBeCloseTo(0.8, 1);
    expect(centroid(plank({ transform: { rotate: 90, origin: 'anchor' } })).y).toBeCloseTo(0.8, 1);
    expect(centroid(plank({ rotate: 90 })).x).toBeCloseTo(0.5, 2);
    // At 45° it is a diagonal from top-left to bottom-right, so its bounding
    // box's other two corners stay dark, and it lays the same ink as flat.
    const grid = (s: SaverSpec) => luminanceGrid(s, { viewport: { width: 400, height: 400 }, cols: 40, rows: 40 });
    const at = (g: LuminanceGrid, x: number, y: number) => g.cells[Math.floor(y * g.rows) * g.cols + Math.floor(x * g.cols)]!;
    const flat = grid(plank({}, 0.5));
    const diag = grid(plank({ rotate: 45 }, 0.5));
    expect(at(diag, 0.65, 0.65)).toBeGreaterThan(0.5);
    expect(at(diag, 0.35, 0.35)).toBeGreaterThan(0.5);
    expect(at(diag, 0.65, 0.35)).toBe(0);
    expect(at(diag, 0.35, 0.65)).toBe(0);
    expect(mass(diag) / mass(flat)).toBeCloseTo(1, 3);
  });

  it('a rect or bar is clipped to the frame by its own turned box, not a width-sided square', () => {
    const area = (sprite: Record<string, unknown>, o: Record<string, unknown>) => perceiveScene(scene('#000000', [L({ key: 'k', sprite, ...o })]), { viewport: { width: 400, height: 400 } }).dominance[0]!.factors.area;
    const rect = { kind: 'rect', width: [0.6, 0.6], aspect: [0.05, 0.05], color: '#ffffff' };
    const whole = area(rect, { position: { x: 0.5, y: 0.5 } });
    // Lying along the bottom edge it is all on screen; stood on end (by
    // `rotate` or its layer's `transform.rotate`) 0.33 of its 0.6 shows. A
    // 0.6 square about it read 55 % for both.
    expect(area(rect, { position: { x: 0.5, y: 0.97 } }) / whole).toBeCloseTo(1, 3);
    expect(area(rect, { position: { x: 0.5, y: 0.97 }, rotate: 90 }) / whole).toBeCloseTo(0.33 / 0.6, 3);
    expect(area(rect, { position: { x: 0.5, y: 0.97 }, transform: { rotate: 90, origin: 'anchor' } }) / whole).toBeCloseTo(0.33 / 0.6, 3);
    // Across the bottom-right corner at −45° both ends are off screen; only a
    // 0.015-sided triangle at the corner shows (0.015² of 0.6 × 0.03), where
    // its square or bounding box would keep a quarter.
    expect(area(rect, { position: { x: 1, y: 1 }, rotate: -45 }) / whole).toBeCloseTo(0.0125, 4);
    // A bar turns with its layer's transform too: pointing down from y = 0.9, a tenth of its 0.4 shows.
    const bar = { kind: 'bar', values: [1], max: 1, length: 0.4, thickness: 0.02, color: '#ffffff' };
    const flat = area(bar, { position: { x: 0.5, y: 0.9 } });
    expect(area(bar, { position: { x: 0.5, y: 0.9 }, transform: { rotate: 90, origin: 'anchor' } }) / flat).toBeCloseTo(0.25, 3);
  });

  it('a thin turned plank keeps its ink at every angle: exact turned-box coverage, no scanline gaps', () => {
    // 0.96 px tall on 8.3 px grid rows — thinner than one of the four
    // sub-scanlines a polygon outline is sampled on — and barely tilted.
    const line = (rotate: number, sprite: Record<string, unknown>) => luminanceGrid(scene('#000000', [L({ key: 'scan', position: { x: 0.5, y: 0.5 }, rotate, sprite })]), { viewport: { width: 400, height: 400 } });
    const rect = { kind: 'rect', width: [0.6, 0.6], aspect: [0.004, 0.004], color: '#ffffff' };
    const bar = { kind: 'bar', values: [1], max: 1, length: 0.4, thickness: 0.002, color: '#ffffff' };
    for (const sprite of [rect, bar]) {
      const level = mass(line(0, sprite));
      for (const angle of [0.5, 2, 5, 37, 45, 90, 180]) expect(mass(line(angle, sprite)) / level).toBeCloseTo(1, 2);
    }
    // Measured by its turned box's bounding box, as before, its coverage ballooned at 37°.
    expect(line(37, bar).coverage).toBeLessThan(line(0, bar).coverage * 2);
  });

  it('text turns about its anchor in the maps, as the renderer turns it', () => {
    // A left-aligned label runs right of its anchor; turned a quarter it runs down.
    const label = (rotate: number) => perceiveScene(scene('#000000', [L({ key: 'cap', position: { x: 0.5, y: 0.3 }, rotate, size: [0.08, 0.08], sprite: { kind: 'text', strings: ['VERTICAL'], align: 'left', color: '#ffffff' } })]), { viewport: { width: 400, height: 400 } }).centroid!;
    expect(label(0).x).toBeGreaterThan(0.6);
    expect(label(0).y).toBeCloseTo(0.3, 1);
    expect(label(90).x).toBeCloseTo(0.5, 1);
    expect(label(90).y).toBeGreaterThan(0.4);
  });

  it('X603: a vertical caption is judged by its rotated box', () => {
    const s = scene('#1c0644', [{ key: 'side', count: 1, position: { x: 0.965, y: 0.5 }, rotate: 90, alpha: [0.75, 0.75], motion: { type: 'static' }, sprite: { kind: 'textBlock', text: 'CD-ROM  ·  WWW  ·  KIOSK  ·  14.4  ·  28.8  ·  ISDN', maxWidth: 1.2, fontSize: 0.015, color: '#c8a8ff', anchor: 'center', font: 'monospace' } }]);
    expect(codes(s, 1920, 1080)).not.toContain('text-off-screen');
  });
  it('review: a bar clipped by the left edge counts the part that is visible, not half of a centred square', () => {
    const bar = (key: string, x: number, y: number) => L({ key, position: { x, y }, sprite: { kind: 'bar', values: [1], max: 1, length: 0.3, thickness: 0.05, color: '#ffffff' } });
    const s = scene('#000000', [bar('edge', 0, 0.3), bar('inside', 0.3, 0.7)]);
    const a = share(s, 'edge', 1000, 1000);
    const b = share(s, 'inside', 1000, 1000);
    expect(a).toBeGreaterThan(0);
    expect(a / b).toBeGreaterThan(0.9);
  });

  it('review: a stretched stroke is as wide as the renderer draws it (width · r), not wider', () => {
    const line = (span: string) => scene('#000000', [L({ key: 'rule', position: { x: 0.5, y: 0.5 }, sprite: { kind: 'polygon', radius: [0.1, 0.1], color: '#ffffff', span, parts: [{ path: 'M -1 0 L 1 0', fill: false, stroke: { color: '#ffffff', width: 0.1 } }] } }), L({ key: 'ref', position: { x: 0.5, y: 0.1 }, sprite: { kind: 'circle', radius: 0.05, color: '#ffffff' } })]);
    // sx = 960 vs r = 100: the line is 1920 px long and 10 px thick (19 200 px²), not ~31 000.
    expect(share(line('width'), 'rule', 1920, 1080)).toBeLessThan(share(line('box'), 'rule', 1920, 1080) * 25);
  });

  it('review: a spinning shape under a layer scale moves its ink proportionally further', () => {
    const at = (scale: number) => motionStats(scene('#000000', [L({ key: 'p', position: { x: 0.5, y: 0.5 }, transform: { scale }, spin: 100, sprite: { kind: 'polygon', radius: [0.1, 0.1], color: '#fff', path: sq } })]), { viewport: { width: 800, height: 800 } })[0]!.meanSpeed;
    expect(at(2) / at(1)).toBeCloseTo(2, 1);
  });

  it('review: a redundant gradient stop does not change the scene colour', () => {
    const grad = (stops: unknown[]) => scene('#000000', [L({ key: 'g', position: { x: 0.5, y: 0.5 }, sprite: { kind: 'polygon', radius: [0.2, 0.2], color: '#fff', parts: [{ path: sq, gradient: { type: 'linear', from: [-1, 0], to: [1, 0], stops } }] } })]);
    const hex = (s: SaverSpec) => perceiveScene(s, { viewport: { width: 400, height: 400 } }).colour.hex;
    const ch = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const a = ch(hex(grad([{ at: 0, color: '#ff0000' }, { at: 0.01, color: '#ff0000' }, { at: 1, color: '#0000ff' }])));
    const b = ch(hex(grad([{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }])));
    a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThanOrEqual(3));
  });

  it('review: text rotated and counter-rotated by a paint transform keeps its box', () => {
    const t = (tf: unknown) => scene('#1c0644', [{ key: 'cap', count: 1, position: { x: 0.5, y: 0.5 }, rotate: 45, alpha: [1, 1], motion: { type: 'static' }, ...(tf ? { transform: tf } : {}), sprite: { kind: 'textBlock', text: 'HELLO WORLD HELLO', maxWidth: 0.9, fontSize: 0.05, color: '#c8a8ff', anchor: 'center', font: 'monospace' } }]);
    expect(codes(t({ rotate: -45, origin: 'anchor' }), 400, 400)).not.toContain('text-off-screen');
  });

  it('a rotated path drawing with an origin offset is clipped where it paints, not unturned', () => {
    // radius 0.2, origin [1,0], x = -0.1, rotate 180: paints x -0.1..0.3 (on screen).
    const s = scene('#10082a', [
      L({ key: 'turned', position: { x: -0.1, y: 0.5 }, rotate: 180, sprite: { kind: 'polygon', radius: [0.2, 0.2], origin: [1, 0], color: '#ff3a4a', path: sq } }),
    ]);
    expect(share(s, 'turned', 1000, 1000)).toBeGreaterThan(0);
  });
});
