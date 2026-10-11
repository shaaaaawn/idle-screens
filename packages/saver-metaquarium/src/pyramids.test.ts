import { createRng } from '@idle-screens/core';
import { Quaternion, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { validateMetaquariumParams } from './guide';
import {
  buildPyramids, groundUnder, parsePyramidMix, pyramidFlatness, PYRAMID_CUBES, PYRAMID_SHAPES, PYRAMID_VOXEL, pyramidMaterial, pyramidProfile, PyramidWriter, writePyramid, type PyramidOptions,
} from './pyramids';
import { buildScenery, type SceneryOptions } from './scenery';
import { FISH_LENGTH } from './swim';

const flat = (): number => 0;
const opts = (over: Partial<PyramidOptions> = {}): PyramidOptions => ({ amount: 1, cap: 12, scale: 1, environment: 'void', terrain: flat, free: () => true, ...over });

/** One pyramid's quads, in its cell frame: each a sorted list of its corners, the list sorted. */
function quadsOf(shape: (typeof PYRAMID_SHAPES)[number], half: number): string[] {
  const w = new PyramidWriter();
  w.V = 1;
  writePyramid(w, shape, pyramidProfile(shape, half));
  return toQuads(w.pos);
}
const toQuads = (pos: readonly number[], map: (x: number, y: number, z: number) => [number, number, number] = (x, y, z) => [x, y, z]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < pos.length; i += 18) {
    const pts = new Set<string>();
    for (let k = 0; k < 6; k++) {
      const [x, y, z] = map(pos[i + k * 3]!, pos[i + k * 3 + 1]!, pos[i + k * 3 + 2]!);
      pts.add([x, y, z].map((v) => (Math.abs(v) < 1e-9 ? 0 : Math.round(v * 1000) / 1000)).join(','));
    }
    out.push([...pts].sort().join(' '));
  }
  return out.sort();
};

describe('pyramids: on the fish\'s own grid, perfectly symmetric', () => {
  it('one voxel is a classic token\'s: fourteen to a fish', () => {
    expect(PYRAMID_VOXEL * 14).toBeCloseTo(FISH_LENGTH, 9);
  });

  it('every shape is the same under a quarter turn and a mirror — the stone and its stairs', () => {
    for (const shape of PYRAMID_SHAPES) for (const half of [5, 9, 14]) {
      const q = quadsOf(shape, half);
      expect(q.length, shape).toBeGreaterThan(4);
      const w = new PyramidWriter(); w.V = 1;
      writePyramid(w, shape, pyramidProfile(shape, half));
      expect(toQuads(w.pos, (x, y, z) => [-z, y, x]), `${shape} turned`).toEqual(q);
      expect(toQuads(w.pos, (x, y, z) => [-x, y, z]), `${shape} mirrored`).toEqual(q);
      expect(toQuads(w.pos, (x, y, z) => [z, y, x]), `${shape} across the diagonal`).toEqual(q);
    }
  });

  it('comes to a single cube, on an odd base; the tiered ones end on a platform', () => {
    for (const shape of ['giza', 'step', 'bent', 'frame'] as const) for (let half = 3; half < 60; half += 7) {
      const p = pyramidProfile(shape, half);
      expect(p[p.length - 1], shape).toBe(0);
      expect(p[0], shape).toBe(half);
      for (let j = 1; j < p.length; j++) expect(p[j]!).toBeLessThanOrEqual(p[j - 1]!);
    }
    for (const shape of ['djoser', 'mayan'] as const) {
      const p = pyramidProfile(shape, 24);
      expect(p[p.length - 1]!).toBeGreaterThan(0);
    }
    expect(new Set(pyramidProfile('djoser', 30)).size).toBe(6);
  });

  it('keeps its angle: Giza five rises to four insets (51°), a step one in one, the bent one steep then shallow', () => {
    const slope = (p: number[], a: number, b: number): number => (b - a) / (p[a]! - p[b]!);
    const giza = pyramidProfile('giza', 80);
    expect(Math.atan(slope(giza, 0, giza.length - 1)) * 180 / Math.PI).toBeCloseTo(51.3, 0);
    const step = pyramidProfile('step', 30);
    expect(slope(step, 0, step.length - 1)).toBeCloseTo(1, 1);
    const bent = pyramidProfile('bent', 60), mid = Math.round(bent.length * 0.35);
    expect(slope(bent, 0, mid)).toBeGreaterThan(1.2);
    expect(slope(bent, bent.length - 15, bent.length - 1)).toBeLessThan(1.1);
  });

  it('paints from the cell each face belongs to: half a cell in from the face, in the pyramid\'s own frame', () => {
    const w = new PyramidWriter(); w.V = 2;
    writePyramid(w, 'step', pyramidProfile('step', 4));
    for (let v = 0; v < w.pos.length / 3; v++) {
      const [cx, cy, cz] = [w.cell[v * 3]!, w.cell[v * 3 + 1]!, w.cell[v * 3 + 2]!];
      const frac = (c: number): number => Math.abs(c - Math.floor(c));
      // Along its normal a face's cell coordinate is mid-cell: a cell centre in x/z, mid-layer in y.
      const toCentre = (c: number): number => Math.abs(c - Math.round(c));
      if (w.face[v] === 0) expect(Math.min(toCentre(cx), toCentre(cz))).toBeLessThan(1e-9);
      else expect(frac(cy)).toBeCloseTo(0.5, 9);
    }
  });
});

describe('pyramids: where they stand, and how', () => {
  // A terrace's tread: flat, with a slight ripple.
  const hill = (x: number, z: number): number => Math.sin(x * 0.04) * 0.2 + Math.cos(z * 0.03) * 0.2;

  it('is pure in its seed, and nothing at all at amount 0', () => {
    const a = buildPyramids(createRng(5), opts()), b = buildPyramids(createRng(5), opts());
    expect(Array.from(a.geometry!.getAttribute('position').array)).toEqual(Array.from(b.geometry!.getAttribute('position').array));
    expect(a.sites).toEqual(b.sites);
    const none = buildPyramids(createRng(5), opts({ amount: 0 }));
    expect([none.geometry, none.sites.length]).toEqual([null, 0]);
  });

  it('stands on the floor, every one: its base at or into the ground, its footprint on the floor, nothing floating', () => {
    const poses = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const p = buildPyramids(createRng(seed), opts({ terrain: hill }));
      for (const site of p.sites) {
        poses.add(site.pose);
        expect(site.seat).toBeLessThanOrEqual(0);
        expect(Math.hypot(site.x, site.z) + site.reach).toBeLessThanOrEqual(590 + 1e-6);
      }
    }
    expect([...poses].sort()).toEqual(['capless', 'stand', 'sunk']);
  });

  it('stands only where the floor is flat under all of it: none on a dune or a mound', () => {
    // Rolling dunes, with a flat plain to the east of x = 150.
    const dunes = (x: number, z: number): number => (x > 150 ? 2 : Math.sin(x * 0.05) * 9 + Math.cos(z * 0.04) * 9);
    let placed = 0;
    for (let seed = 1; seed <= 10; seed++) {
      for (const site of buildPyramids(createRng(seed), opts({ terrain: dunes })).sites) {
        placed++;
        const V = PYRAMID_VOXEL * site.cube;
        // (Squared to the compass give or take a few degrees: measured square-on, a hair of slack.)
        expect(groundUnder(dunes, site.x, site.z, (site.half + 0.5) * V * 0.97, new Quaternion()).spread).toBeLessThanOrEqual(pyramidFlatness(V, 1) + 1e-9);
        expect(site.x).toBeGreaterThan(150);
      }
    }
    expect(placed).toBeGreaterThan(0);
    // Flat ground everywhere: they fill the floor.
    expect(buildPyramids(createRng(1), opts()).sites.length).toBeGreaterThan(8);
  });

  it('is built of cubes a whole number of the fish\'s: one near the glass, bigger at the back', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const p = buildPyramids(createRng(seed), opts());
      for (const site of p.sites) {
        expect(PYRAMID_CUBES).toContain(site.cube);
        if (site.band === 'near') expect(site.cube).toBe(1);
        if (site.band === 'far') expect(site.cube).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('stands in complexes, as Giza does: a great pyramid and its queens, one stone, one cube, the queens smaller', () => {
    let queens = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const p = buildPyramids(createRng(seed), opts());
      const by = new Map<number, typeof p.sites>();
      for (const site of p.sites) by.set(site.complex, [...(by.get(site.complex) ?? []), site]);
      for (const members of by.values()) {
        const [great, ...rest] = members;
        queens += rest.length;
        for (const q of rest) {
          expect([q.material, q.cube]).toEqual([great!.material, great!.cube]);
          expect(q.half).toBeLessThan(great!.half);
        }
      }
    }
    expect(queens).toBeGreaterThan(8);
  });

  it('keeps the camera\'s path clear: the near ones inside its orbit, the rest well outside it', () => {
    for (let seed = 1; seed <= 12; seed++) {
      for (const site of buildPyramids(createRng(seed), opts()).sites) {
        const r = Math.hypot(site.x, site.z);
        if (site.band === 'near') expect(r + site.reach).toBeLessThanOrEqual(72 + 1e-6);
        else expect(r - site.reach).toBeGreaterThanOrEqual(125 - 1e-6);
      }
    }
  });

  it('keeps off what is already there, and stands its ground: an obstacle for every one', () => {
    expect(buildPyramids(createRng(3), opts({ free: () => false })).sites).toEqual([]);
    const p = buildPyramids(createRng(3), opts());
    expect(p.obstacles.length).toBeGreaterThanOrEqual(p.sites.length);
  });

  it('takes its stone from the room, or from the mix; shapes from the mix', () => {
    const ice = buildPyramids(createRng(4), opts({ environment: 'ice' }));
    expect(ice.sites.every((s) => ['crystal', 'nacre', 'limestone'].includes(s.material))).toBe(true);
    const gold = buildPyramids(createRng(4), opts({ mix: 'gold,mayan' }));
    expect(gold.sites.length).toBeGreaterThan(0);
    expect(gold.sites.every((s) => s.material === 'gold' && s.shape === 'mayan')).toBe(true);
    expect(parsePyramidMix('giza:3, obsidian, mayan:0.5').problems).toEqual([]);
    expect(parsePyramidMix('octa').problems).toHaveLength(1);
    expect(validateMetaquariumParams({ pyramidMix: 'giza,cone' }).map((p) => p.path)).toEqual(['pyramidMix']);
  });

  it('a lit capstone throws a little light on the floor: three at most', () => {
    let lights = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const p = buildPyramids(createRng(seed), opts({ mix: 'giza,gold' }));
      expect(p.emitters.length).toBeLessThanOrEqual(3);
      lights += p.emitters.length;
    }
    expect(lights).toBeGreaterThan(0);
  });

  it('draws its cubes as cubes: one material, a seam between every cube and the next', () => {
    const m = pyramidMaterial();
    expect(m.customProgramCacheKey()).toBe('mq-pyramids-v2');
    const shader = { vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>', uniforms: {} as Record<string, unknown> };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain('mqPyrPaint()');
    expect(shader.fragmentShader).toContain('seam');
    expect(shader.vertexShader).toContain('vCell = aCell');
  });
});

describe('pyramids: in the world', () => {
  const base: SceneryOptions = { rocks: 1, veins: 0.7, homes: 2, flora: 1, bubbles: 0, snow: 0, cap: 8, scale: 1 };
  const terrain = (): number => 0;
  const buffers = (o: SceneryOptions) => buildScenery([], createRng(9), terrain, o).group.children
    .filter((c) => c.name !== 'pyramids').map((c) => [c.name, ...Array.from((c as Mesh).geometry.getAttribute('position').array)]);

  it('adds one draw and moves nothing else: the rest of the world is the same with or without them', () => {
    const w = buildScenery([], createRng(9), terrain, { ...base, pyramids: 1 });
    expect(w.group.children.filter((c) => c.name === 'pyramids')).toHaveLength(1);
    expect(w.counts.pyramids).toBeGreaterThan(6);
    expect(buffers({ ...base, pyramids: 0 })).toEqual(buffers(base));
  });

  it('never indoors', () => {
    const w = buildScenery([], createRng(9), terrain, { ...base, pyramids: 1, interior: true });
    expect(w.group.children.some((c) => c.name === 'pyramids')).toBe(false);
  });
});
