import { createRng } from '@idle-screens/core';
import { MeshBasicMaterial, type Material, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { emptyPoolUniforms, installFloorPools } from './crystal-mesh';
import {
  buildFloorCover, COVER_OVER, COVER_PARS, lawnAt, MAX_LAWNS, MOSAIC_PALETTES, mosaicTone, paintsFloor, RIPPLE_WAVE, writeCover,
  type CoverContext,
} from './floor-cover';
import { parseFloorCover } from './floor-cover-mix';
import { validateMetaquariumParams } from './guide';
import type { PathSegment } from './paths';
import { buildScenery, type SceneryOptions } from './scenery';
import { buildTown, currentFlow, TOWN_VOXEL, yardFrame, type TownYard } from './town';
import { parseTownProps } from './town-mix';

type Shader = Parameters<Material['onBeforeCompile']>[0];
const V = TOWN_VOXEL;
/** Two homes facing the camera (+z), each with a walk from its door down to the square at (0, 70). */
const yards: TownYard[] = [
  { x: -70, z: 0, y: 0, across: 24, along: 20, door: { x: -70, z: 11 }, tint: '#49cfff' },
  { x: 70, z: 0, y: 0, across: 28, along: 22, door: { x: 70, z: 12 }, tint: '#ff67bc' },
];
const walks: PathSegment[] = [
  { x0: -70, z0: 0, x1: -10, z1: 70, width: 7, material: 'pebble' },
  { x0: 70, z0: 0, x1: 10, z1: 70, width: 7, material: 'sand' },
];
const ctx = (over: Partial<CoverContext> = {}): CoverContext => ({
  rng: createRng(3), scale: 1, terrain: () => 0, yards, walks, current: 0.7,
  square: { x: 0, z: 70, inner: 19, r: 44 },
  free: (x, z, r) => !yards.some((y) => Math.hypot(x - y.x, z - y.z) < Math.max(y.across, y.along) * 0.6 + r),
  ...over,
});
const cover = (src: string, over: Partial<CoverContext> = {}) => buildFloorCover(parseFloorCover(src).cover, ctx(over));
const cubes = (g: { getAttribute(n: string): { count: number } } | null): number => (g ? g.getAttribute('position').count / 36 : 0);

describe('floorCover: the string', () => {
  it('reads kinds and styles, defaults each style, and says what it cannot', () => {
    const { cover: c, problems } = parseFloorCover('lawn/checks, mosaic/glass, mat, steps, ripples/broad');
    expect(problems).toEqual([]);
    expect(c).toEqual({ lawn: { style: 'checks' }, mosaic: { style: 'glass' }, mat: { style: 'kelp' }, steps: { style: null }, ripples: { style: 'broad' } });
    expect(parseFloorCover('').cover).toEqual({ lawn: null, mosaic: null, mat: null, steps: null, ripples: null });
    expect(parseFloorCover('lawn/plaid, carpet, steps/marble, mat:3').problems).toHaveLength(4);
  });

  it('allows spaces around : and /, rejects them inside a word, and stays linear on a long run of spaces (CodeQL js/polynomial-redos)', () => {
    expect(parseFloorCover('lawn / checks').cover.lawn).toEqual({ style: 'checks' });
    expect(parseFloorCover('la wn').problems).toHaveLength(1);
    const t0 = performance.now();
    const { problems } = parseFloorCover(`a${' '.repeat(50_000)}!`);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(problems).toHaveLength(1);
  });

  it('asks for what each lies on: homes for lawns and mats, paths for steps, a square for a mosaic', () => {
    const problems = (p: Record<string, unknown>) => validateMetaquariumParams(p).filter((x) => x.path === 'floorCover').map((x) => x.message);
    expect(problems({ floorCover: 'lawn, mat' }).join()).toMatch(/geodeHomes/);
    expect(problems({ floorCover: 'steps', geodeHomes: 2 }).join()).toMatch(/paths/);
    expect(problems({ floorCover: 'mosaic' }).join()).toMatch(/square/);
    expect(problems({ floorCover: 'lawn, mosaic, mat, steps, ripples', geodeHomes: 2, paths: 1 })).toEqual([]);
    expect(problems({ floorCover: 'ripples' })).toEqual([]);
  });
});

describe('floorCover: lawns', () => {
  it('fills each yard\'s own rectangle — the fence\'s — mown in stripes two cubes wide, and nowhere else', () => {
    const c = cover('lawn');
    expect(c.counts.lawns).toBe(2);
    for (const [i, y] of yards.entries()) {
      const f = yardFrame(y, V), l = c.paint.lawns[i]!;
      expect([l.Rd, l.Rr, l.dx, l.dz]).toEqual([f.Rd, f.Rr, f.d.x, f.d.z]);
      // Just inside each corner is lawn; just outside is not.
      for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const at = (k: number) => [y.x + (f.d.x * f.Rd * a + f.r.x * f.Rr * b) * k, y.z + (f.d.z * f.Rd * a + f.r.z * f.Rr * b) * k] as const;
        expect(lawnAt(c.paint, at(0.98)[0], at(0.98)[1])).toBeGreaterThanOrEqual(0);
        expect(lawnAt(c.paint, at(1.03)[0], at(1.03)[1])).toBe(-1);
      }
      // Across the yard, the stripe flips every two cubes; down it (toward the gate), it holds.
      const across = [0.5, 2.5, 4.5].map((k) => lawnAt(c.paint, y.x + f.r.x * k * V, y.z + f.r.z * k * V));
      expect(across).toEqual([across[0], 1 - across[0]!, across[0]]);
      const down = [0.5, 1.5, 3.5].map((k) => lawnAt(c.paint, y.x + f.r.x * 0.5 * V + f.d.x * k * V, y.z + f.r.z * 0.5 * V + f.d.z * k * V));
      expect(new Set(down).size).toBe(1);
    }
    expect(lawnAt(c.paint, 0, 70)).toBe(-1);
  });

  it('checks are a chequerboard', () => {
    const c = cover('lawn/checks'), y = yards[0]!, f = yardFrame(y, V);
    const at = (u: number, v: number) => lawnAt(c.paint, y.x + f.d.x * u * V + f.r.x * v * V, y.z + f.d.z * u * V + f.r.z * v * V);
    expect([at(0.5, 0.5), at(2.5, 0.5), at(0.5, 2.5), at(2.5, 2.5)]).toEqual([at(0.5, 0.5), 1 - at(0.5, 0.5), 1 - at(0.5, 0.5), at(0.5, 0.5)]);
  });

  it('keeps plants and pyramids off the lawn, inside the yard', () => {
    const c = cover('lawn');
    expect(c.keepClear).toHaveLength(2);
    for (const [i, k] of c.keepClear.entries()) {
      const y = yards[i]!, f = yardFrame(y, V);
      for (const [px, pz] of [[k.x0, k.z0], [k.x1, k.z1]]) {
        const u = Math.abs((px! - y.x) * f.d.x + (pz! - y.z) * f.d.z), v = Math.abs((px! - y.x) * f.r.x + (pz! - y.z) * f.r.z);
        expect(u + (f.Rd >= f.Rr ? k.width : 0)).toBeLessThanOrEqual(f.Rd + 1e-2);
        expect(v + (f.Rd >= f.Rr ? 0 : k.width)).toBeLessThanOrEqual(f.Rr + 1e-2);
      }
    }
  });
});

describe('floorCover: mats and stepping stones', () => {
  it('lays a mat at every door, in front of its step, before the gate', () => {
    const c = cover('mat');
    expect(c.counts.mats).toBe(2);
    expect(cubes(c.fixed)).toBe(80); // 8 × 5 woven cells each
    const pos = c.fixed!.getAttribute('position').array;
    for (const y of yards) {
      const f = yardFrame(y, V);
      // Every vertex of the mat nearest this door lies between the door's step and the fence's gate, low on the floor.
      let n = 0;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!, h = pos[i + 1]!, z = pos[i + 2]!;
        if (Math.hypot(x - y.door.x, z - y.door.z) > 6 * V) continue;
        const u = (x - y.x) * f.d.x + (z - y.z) * f.d.z;
        expect(u).toBeGreaterThan(Math.hypot(y.door.x - y.x, y.door.z - y.z));
        expect(u).toBeLessThan(f.Rd);
        expect(h).toBeLessThan(0.3 * V);
        n++;
      }
      expect(n).toBeGreaterThan(0);
    }
    expect(cubes(cover('mat/stripe').fixed)).toBeGreaterThan(80); // and fringed
  });

  it('puts stepping stones down the walks, a stride apart, off the square and out of the homes', () => {
    const c = cover('steps');
    expect(c.counts.stones).toBeGreaterThan(4);
    const pos = c.fixed!.getAttribute('position').array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i]!, z = pos[i + 2]!;
      expect(Math.hypot(x, z - 70)).toBeGreaterThan(44);
      // No stone's middle in a shell: no corner deep inside one.
      for (const y of yards) expect(((x - y.x) / (y.across + V)) ** 2 + ((z - y.z) / (y.along + V)) ** 2).toBeGreaterThan(0.7);
    }
    // Each walk's stones match its ground, unless told: the pebble walk's are slate (blue-grey), the sand walk's warm.
    const col = c.fixed!.getAttribute('color').array;
    let warm = 0, cool = 0;
    for (let i = 0; i < col.length; i += 3) { if (col[i]! > col[i + 2]! * 1.3) warm++; else cool++; }
    expect(warm).toBeGreaterThan(0);
    expect(cool).toBeGreaterThan(0);
  });

  it('only on flat ground: a slope under a mat or a stone and it is left out', () => {
    const steep = (x: number) => x * 0.6;
    expect(cover('mat, steps', { terrain: steep }).counts).toMatchObject({ mats: 0, stones: 0 });
    expect(cover('mat, steps', { terrain: () => 3 }).counts.stones).toBe(cover('mat, steps').counts.stones);
  });
});

describe('floorCover: the mosaic', () => {
  it('tiles the square round the basin, a compass rose: four points, four lesser, two-faced, in borders', () => {
    const c = cover('mosaic/shell');
    expect(c.paint.mosaic).toMatchObject({ x: 0, z: 70, r: 44, inner: 19, style: 1 });
    const r0 = 19 / 44;
    // A quarter turn is the same rose.
    for (let rho = 0.02; rho < 1; rho += 0.07) for (let th = -3; th < 3; th += 0.13) {
      expect(mosaicTone(rho, th + Math.PI / 2, r0)).toBe(mosaicTone(rho, th, r0));
    }
    // The main points reach further out than the lesser ones.
    expect(mosaicTone(0.72, 0.02, r0)).toBeGreaterThanOrEqual(4);
    expect(mosaicTone(0.72, Math.PI / 4 + 0.02, r0)).toBe(0);
    expect(mosaicTone(0.55, Math.PI / 4 + 0.02, r0)).toBeGreaterThanOrEqual(4);
    // Lit one side, dark the other.
    expect(mosaicTone(0.6, 0.03, r0)).not.toBe(mosaicTone(0.6, -0.03, r0));
    // The border: dark, light, dark.
    expect([0.86, 0.9, 0.97].map((rho) => mosaicTone(rho, 0.4, r0))).toEqual([2, 3, 2]);
    // With no fountain, a boss at the middle.
    expect(mosaicTone(0.05, 1, 0)).toBe(3);
  });

  it('the GLSL copy carries the JS model\'s numbers and every palette', () => {
    for (const k of ['0.940', '0.880', '0.840', '0.800', '0.620', '0.700']) expect(COVER_PARS).toContain(k);
    for (const pal of Object.values(MOSAIC_PALETTES)) for (const c of pal) expect(COVER_PARS).toContain(`vec3(${c.map((v) => v.toFixed(3)).join(', ')})`);
    expect(COVER_OVER).toContain('mqMosaicTone(rho, atan(pc.y, pc.x)');
  });

  it('with no square there is no mosaic', () => {
    expect(cover('mosaic', { square: null }).paint.mosaic).toBeNull();
  });
});

describe('floorCover: ripples', () => {
  it('combs the sand across the current the socks stream down', () => {
    const current = 2.1;
    const c = cover('ripples/broad', { current });
    const f = currentFlow(current);
    expect(c.paint.ripples).toEqual({ fx: f.x, fz: f.z, wave: RIPPLE_WAVE.broad * V });
    // The socks: each one's resting heading within a quarter-radian of that current.
    const town = buildTown(parseTownProps('sock:3').props, {
      rng: createRng(5), scale: 1, terrain: () => 0, yards: [], centre: { x: 0, z: 0, r: 20 }, current,
      free: () => true, pathClear: () => 99,
    });
    const swing = town.moving!.getAttribute('aSwing').array;
    expect(town.counts.socks).toBe(3);
    for (let i = 0; i < swing.length; i += 4) expect(Math.abs(swing[i + 2]! - current)).toBeLessThanOrEqual(0.25);
  });
});

describe('floorCover: on the floor', () => {
  it('writes its paint into the floor\'s uniforms, and null clears it', () => {
    const u = emptyPoolUniforms() as never as Record<string, { value: unknown }>;
    const c = cover('lawn, mosaic, ripples');
    expect(paintsFloor(c.paint)).toBe(true);
    writeCover(u, c.paint);
    expect(u.uMqLawnN!.value).toBe(2);
    expect((u.uMqMosaic!.value as { z: number }).z).toBe(44);
    expect((u.uMqRipple!.value as { z: number }).z).toBe(RIPPLE_WAVE.fine * V);
    writeCover(u, null);
    expect(u.uMqLawnN!.value).toBe(0);
    expect((u.uMqMosaic!.value as { z: number }).z).toBe(0);
    expect((u.uMqRipple!.value as { z: number }).z).toBe(0);
    expect(paintsFloor(cover('mat, steps').paint)).toBe(false);
    expect(MAX_LAWNS).toBeGreaterThanOrEqual(3); // geodeHomes ≤ 3
  });

  it('paints in the floor\'s one program, in order: lawns, paths, mosaic, the light, then ripples on bare floor', () => {
    const m = new MeshBasicMaterial();
    installFloorPools(m, emptyPoolUniforms());
    const s = { uniforms: {}, vertexShader: 'void main(){\n#include <project_vertex>\n}', fragmentShader: 'void main(){\n#include <color_fragment>\n}' } as never as Shader;
    m.onBeforeCompile(s, undefined as never);
    const f = s.fragmentShader, at = (k: string) => f.indexOf(k);
    expect(m.customProgramCacheKey()).toContain('mq-floor-pools-v8');
    expect(at('uMqLawnN) break')).toBeGreaterThan(0);
    expect(at('uMqLawnN) break')).toBeLessThan(at('if (uMqPathN > 0)'));
    expect(at('if (uMqPathN > 0)')).toBeLessThan(at('if (uMqMosaic.z > 0.0)'));
    expect(at('if (uMqMosaic.z > 0.0)')).toBeLessThan(at('uMqPoolN) break'));
    expect(at('uMqSpotColor[k] * (edge')).toBeLessThan(at('uMqRipple.z > 0.0 && mqBare'));
    expect(s.uniforms).toHaveProperty('uMqLawn');
  });
});

describe('floorCover: in the world', () => {
  const base: SceneryOptions = { rocks: 0, veins: 0.7, homes: 3, flora: 0, bubbles: 0, snow: 0, cap: 12, scale: 1, paths: 1, fountain: 'geode', lamps: 0.4 };
  const world = (o: Partial<SceneryOptions>) => buildScenery([], createRng(52), () => 0, { ...base, ...o });
  const buffers = (o: SceneryOptions) => buildScenery([], createRng(42), () => 0, o).group.children
    .filter((c) => c.name !== 'floor-cover').map((c) => [c.name, ...Array.from((c as Mesh).geometry.getAttribute('position').array)]);

  it('lays the village\'s floor: a lawn and a mat for every home, the mosaic round the fountain, the ripples', () => {
    const w = world({ floorCover: parseFloorCover('lawn, mosaic, mat, steps, ripples').cover });
    expect([w.counts.lawns, w.counts.mats, w.counts.mosaics, w.counts.ripples]).toEqual([3, 3, 1, 1]);
    expect(w.cover!.mosaic).toMatchObject({ r: 44, inner: 19 });
    expect(w.group.children.map((c) => c.name)).toContain('floor-cover');
    // No fountain: the mosaic is the square, at the hub.
    expect(world({ fountain: 'none', floorCover: parseFloorCover('mosaic').cover }).cover!.mosaic).toMatchObject({ r: 18, inner: 0 });
  });

  it('changes nothing without it: an empty floorCover builds the same world as none', () => {
    expect(buffers({ ...base, floorCover: parseFloorCover('').cover })).toEqual(buffers(base));
    expect(buildScenery([], createRng(42), () => 0, base).cover).toBeNull();
  });

  it('shares the current with the town: ripples run the way the socks stream', () => {
    const w = world({ town: parseTownProps('sock:2').props, floorCover: parseFloorCover('ripples').cover });
    const sock = w.group.children.find((c) => c.name === 'town-props-moving') as Mesh;
    const heading = sock.geometry.getAttribute('aSwing').array[2]!;
    const f = currentFlow(heading);
    expect(f.x * w.cover!.ripples!.fx + f.z * w.cover!.ripples!.fz).toBeGreaterThan(Math.cos(0.25) - 1e-9);
  });

  it('never indoors', () => {
    const w = world({ interior: true, floorCover: parseFloorCover('lawn, mosaic, mat, steps, ripples').cover });
    expect(w.cover).toBeNull();
    expect(w.group.children.some((c) => c.name === 'floor-cover')).toBe(false);
  });
});
