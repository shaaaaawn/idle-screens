import { createRng } from '@idle-screens/core';
import type { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { validateMetaquariumParams } from './guide';
import { buildScenery, type SceneryOptions } from './scenery';
import { buildTown, flagUp, TOWN_VOXEL, townMaterial, type TownContext, type TownYard } from './town';
import { parseTownProps } from './town-mix';

const V = TOWN_VOXEL;
/** Two homes facing the camera (+z), a path running between them to the square at (0, 60). */
const yards: TownYard[] = [
  { x: -70, z: 0, y: 0, across: 24, along: 20, door: { x: -70, z: 11 }, tint: '#49cfff' },
  { x: 70, z: 0, y: 0, across: 28, along: 22, door: { x: 70, z: 12 }, tint: '#ff67bc' },
];
const path = (x: number, _z: number): number => Math.abs(x) - 4; // a path four wide along z through x = 0
const ctx = (over: Partial<TownContext> = {}): TownContext => ({
  rng: createRng(3), scale: 1, terrain: () => 0, yards, centre: { x: 0, z: 70, r: 20 },
  free: (x, z, r, own) => !yards.some((y) => !(own && own.x === y.x && own.z === y.z) && Math.hypot(x - y.x, z - y.z) < Math.max(y.across, y.along) + r),
  pathClear: (x, z) => path(x, z), ...over,
});
const positions = (g: { getAttribute(n: string): { array: ArrayLike<number>; count: number } } | null): Array<[number, number, number]> => {
  if (!g) return [];
  const a = g.getAttribute('position').array, out: Array<[number, number, number]> = [];
  for (let i = 0; i < a.length; i += 3) out.push([a[i]!, a[i + 1]!, a[i + 2]!]);
  return out;
};

describe('townProps: the string', () => {
  it('reads kinds, counts and styles, and says what it cannot', () => {
    const { props, problems } = parseTownProps('fence/coral, mailbox, bench:6/stone, sock:2');
    expect(problems).toEqual([]);
    expect(props).toEqual({ fence: { style: 'coral' }, mailbox: { style: null }, bench: { count: 6, style: 'stone' }, sock: { count: 2 } });
    expect(parseTownProps('').props).toEqual({ fence: null, mailbox: null, bench: null, sock: null });
    expect(parseTownProps('fence/brick, lamppost, bench:3/marble, sock/red').problems).toHaveLength(4);
    expect(parseTownProps('bench:40').props.bench!.count).toBe(8);
  });

  it('asks for homes when it fences or posts to them, and knows the mailboxes as vignette marks', () => {
    expect(validateMetaquariumParams({ townProps: 'fence, mailbox' }).map((p) => p.path)).toContain('townProps');
    expect(validateMetaquariumParams({ townProps: 'fence, mailbox', geodeHomes: 2 }).filter((p) => p.path === 'townProps')).toEqual([]);
    expect(validateMetaquariumParams({ townProps: 'mailbox', geodeHomes: 2, vignette: 'a >mailbox1' }).filter((p) => p.path === 'vignette')).toEqual([]);
    expect(validateMetaquariumParams({ geodeHomes: 2, vignette: 'a >mailbox1' }).filter((p) => p.path === 'vignette').length).toBeGreaterThan(0);
  });
});

describe('town: fences', () => {
  it('rings each home\'s yard outside its shell, keeps off the path, and leaves a gate on the door\'s side', () => {
    const t = buildTown(parseTownProps('fence').props, ctx());
    expect(t.counts.fences).toBe(2);
    expect(t.counts.posts).toBeGreaterThan(20);
    // Every post's centre clear of the path and outside the shells (an ellipse with the yard's half-widths).
    const posts = t.obstacles.filter((o) => Math.abs(o.r - V) < 1e-9);
    for (const p of posts) {
      expect(path(p.x, p.z)).toBeGreaterThanOrEqual(1.5 * V - 1e-9);
      for (const y of yards) expect(((p.x - y.x) / y.across) ** 2 + ((p.z - y.z) / y.along) ** 2).toBeGreaterThan(1);
    }
    // The gate: no post on the door's line in front of each home but its two gate posts, either side.
    for (const y of yards) {
      const front = posts.filter((p) => p.z > y.z + y.along && Math.abs(p.x - y.x) < 2.4 * V);
      expect(front).toEqual([]);
      expect(posts.filter((p) => p.z > y.z + y.along && Math.abs(Math.abs(p.x - y.x) - 2.5 * V) < 1e-6)).toHaveLength(2);
    }
  });

  it('draws every style, each its own look, and a crystal fence\'s caps in its home\'s colour', () => {
    const counts = ['driftwood', 'coral', 'stone', 'crystal'].map((style) => positions(buildTown(parseTownProps(`fence/${style}`).props, ctx()).fixed).length);
    expect(new Set(counts).size).toBe(4);
    const crystal = buildTown(parseTownProps('fence/crystal').props, ctx()).fixed!;
    const col = crystal.getAttribute('color').array;
    // The flat (unshaded) caps carry their home's tint exactly: cyan's blue channel well over its red.
    let caps = 0;
    for (let i = 0; i < col.length; i += 3) if (col[i + 2]! > 0.9 && col[i]! < 0.3) caps++;
    expect(caps).toBeGreaterThan(0);
  });

  it('a fence with no home is no fence', () => {
    expect(buildTown(parseTownProps('fence, mailbox').props, ctx({ yards: [] })).counts).toEqual({ fences: 0, posts: 0, mailboxes: 0, benches: 0, socks: 0 });
  });
});

describe('town: mailboxes, benches, socks', () => {
  it('puts a mailbox outside every gate, by the path, and a mark in front of it for the post to come to', () => {
    const t = buildTown(parseTownProps('fence, mailbox').props, ctx());
    expect(t.counts.mailboxes).toBe(2);
    expect(Object.keys(t.marks).sort()).toEqual(['mailbox1', 'mailbox2']);
    for (const [k, y] of yards.entries()) {
      const m = t.marks[`mailbox${k + 1}`]!;
      expect(m.z).toBeGreaterThan(y.z + y.along); // out in front of the home
      expect(m.y).toBeGreaterThan(0);
    }
    // Its flag (a post box) moves; so does a clam's lid, a bottle.
    for (const style of ['post', 'clam', 'bottle']) {
      const g = buildTown(parseTownProps(`mailbox/${style}`).props, ctx()).moving!;
      expect(g.getAttribute('aSwing').count).toBeGreaterThan(0);
    }
  });

  it('seats benches round the square, facing in, evenly, off the path', () => {
    const t = buildTown(parseTownProps('bench:4').props, ctx());
    expect(t.counts.benches).toBe(4);
    const benches = t.obstacles.filter((o) => Math.abs(o.r - 2.4 * V) < 1e-9);
    const d = benches.map((b) => Math.hypot(b.x, b.z - 70));
    for (const r of d) expect(r).toBeCloseTo(d[0]!, 6);
    for (const b of benches) expect(path(b.x, b.z)).toBeGreaterThan(1.2 * V);
    expect(buildTown(parseTownProps('bench:4').props, ctx({ centre: null })).counts.benches).toBe(0);
  });

  it('stands current socks clear of yards and of each other, their socks turned by the current', () => {
    const t = buildTown(parseTownProps('fence, sock:2').props, ctx());
    expect(t.counts.socks).toBe(2);
    const socks = t.obstacles.filter((o) => Math.abs(o.r - 1.2 * V) < 1e-9);
    expect(Math.hypot(socks[0]!.x - socks[1]!.x, socks[0]!.z - socks[1]!.z)).toBeGreaterThan(20 * V - 1e-6);
    const swing = t.moving!.getAttribute('aSwing').array;
    for (let i = 0; i < swing.length; i += 4) expect(swing[i]).toBe(4);
  });

  it('is pure in its seed', () => {
    const a = buildTown(parseTownProps('fence, mailbox, bench, sock').props, ctx());
    const b = buildTown(parseTownProps('fence, mailbox, bench, sock').props, ctx());
    expect(positions(a.fixed)).toEqual(positions(b.fixed));
    expect(positions(a.moving)).toEqual(positions(b.moving));
  });
});

describe('town: the moving parts', () => {
  it('a flag is up for the mail eighteen seconds in every forty-seven, eased, each box on its own phase', () => {
    let upFor = 0;
    for (let t = 0; t < 47; t += 0.05) if (flagUp(0.3, t) > 0.5) upFor += 0.05;
    expect(upFor).toBeGreaterThan(17);
    expect(upFor).toBeLessThan(19);
    for (let t = 0; t < 100; t += 0.05) expect(Math.abs(flagUp(0.3, t + 0.05) - flagUp(0.3, t))).toBeLessThan(0.12);
    const cycle = (phase: number): number[] => Array.from({ length: 94 }, (_, k) => Math.round(flagUp(phase, k * 0.5)));
    expect(cycle(0.3)).not.toEqual(cycle(0.7));
  });

  it('turns them in the vertex shader, on the scene clock, on its own program', () => {
    const clock = { value: 0 }, m = townMaterial(clock);
    expect(m.customProgramCacheKey()).toBe('mq-town-moving-v1');
    const shader = { vertexShader: '#include <begin_vertex>', fragmentShader: '', uniforms: {} as Record<string, unknown> };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.uTownTime).toBe(clock);
    expect(shader.vertexShader).toContain('transformed = aPivot + p;');
  });
});

describe('town: in the world', () => {
  const base: SceneryOptions = { rocks: 0, veins: 0.7, homes: 3, flora: 0, bubbles: 0, snow: 0, cap: 12, scale: 1, paths: 1, fountain: 'geode', lamps: 0.5 };
  const buffers = (o: SceneryOptions) => buildScenery([], createRng(42), () => 0, o).group.children
    .filter((c) => !c.name.startsWith('town')).map((c) => [c.name, ...Array.from((c as Mesh).geometry.getAttribute('position').array)]);

  it('furnishes the village: every home fenced and posted, benches round the fountain, the socks up', () => {
    const w = buildScenery([], createRng(42), () => 0, { ...base, town: parseTownProps('fence, mailbox, bench:4, sock:2').props });
    expect([w.counts.fences, w.counts.benches, w.counts.socks]).toEqual([3, 4, 2]);
    expect(w.counts.mailboxes).toBeGreaterThanOrEqual(2);
    expect(w.group.children.map((c) => c.name)).toEqual(expect.arrayContaining(['town-props', 'town-props-moving']));
    expect(w.marks.mailbox1).toBeDefined();
  });

  it('changes nothing without it: the world is the same with an empty townProps as never having had one', () => {
    expect(buffers({ ...base, town: parseTownProps('').props })).toEqual(buffers(base));
  });

  it('never indoors', () => {
    const w = buildScenery([], createRng(42), () => 0, { ...base, interior: true, town: parseTownProps('fence, mailbox, bench, sock').props });
    expect(w.group.children.some((c) => c.name.startsWith('town'))).toBe(false);
  });
});
