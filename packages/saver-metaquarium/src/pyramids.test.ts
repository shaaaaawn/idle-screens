import { createRng } from '@idle-screens/core';
import { Color, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { validateMetaquariumParams } from './guide';
import {
  buildPyramids, parsePyramidMix, PYRAMID_SHAPES, PYRAMID_VOXEL, pyramidMaterial, pyramidProfile, PyramidWriter, writePyramid, type PyramidOptions,
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
    for (const shape of ['giza', 'step', 'bent', 'octa', 'frame'] as const) for (let half = 3; half < 60; half += 7) {
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
  it('is pure in its seed, and nothing at all at amount 0', () => {
    const a = buildPyramids(createRng(5), opts()), b = buildPyramids(createRng(5), opts());
    expect(Array.from(a.far!.getAttribute('position').array)).toEqual(Array.from(b.far!.getAttribute('position').array));
    expect(a.sites).toEqual(b.sites);
    const none = buildPyramids(createRng(5), opts({ amount: 0 }));
    expect([none.near, none.far, none.sites.length]).toEqual([null, null, 0]);
  });

  it('many far off, some middling, a few near; every pose; the far ones inside the horizon\'s bound', () => {
    const poses = new Set<string>(), bands = { near: 0, mid: 0, far: 0 };
    for (let seed = 1; seed <= 12; seed++) {
      const p = buildPyramids(createRng(seed), opts());
      for (const s of p.sites) { poses.add(s.pose); bands[s.band]++; }
      const pos = p.far!.getAttribute('position');
      // Bobbing adds a few units at most; the horizon's own bound is 950.
      for (let i = 0; i < pos.count; i++) expect(Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i))).toBeLessThan(950);
    }
    expect(bands.far).toBeGreaterThan(bands.mid);
    expect(bands.mid).toBeGreaterThan(bands.near);
    expect([...poses].sort()).toEqual(['capless', 'float', 'inverted', 'lean', 'stand', 'sunk']);
  });

  it('keeps off what is already there, and stands its ground: an obstacle for every one in the water but the floating', () => {
    const blocked = buildPyramids(createRng(3), opts({ free: () => false }));
    expect(blocked.sites.every((s) => s.band === 'far')).toBe(true);
    const p = buildPyramids(createRng(3), opts());
    const grounded = p.sites.filter((s) => s.band !== 'far' && s.pose !== 'float');
    expect(p.obstacles.length).toBeGreaterThanOrEqual(grounded.length);
  });

  it('takes its stone from the room, or from the mix; shapes from the mix', () => {
    const reef = buildPyramids(createRng(4), opts({ environment: 'ice' }));
    expect(reef.sites.every((s) => ['crystal', 'nacre', 'limestone'].includes(s.material))).toBe(true);
    const gold = buildPyramids(createRng(4), opts({ mix: 'gold,mayan' }));
    expect(gold.sites.every((s) => s.material === 'gold' && s.shape === 'mayan')).toBe(true);
    expect(parsePyramidMix('giza:3, obsidian, mayan:0.5').problems).toEqual([]);
    expect(parsePyramidMix('cone').problems).toHaveLength(1);
    expect(validateMetaquariumParams({ pyramidMix: 'giza,cone' }).map((p) => p.path)).toEqual(['pyramidMix']);
  });

  it('a lit capstone throws a little light on the floor; the far ones none', () => {
    let lights = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const p = buildPyramids(createRng(seed), opts({ mix: 'giza,gold' }));
      expect(p.emitters.length).toBeLessThanOrEqual(3);
      lights += p.emitters.length;
    }
    expect(lights).toBeGreaterThan(0);
  });

  it('its two materials compile apart: the near one fogged, the far one hazed', () => {
    const clock = { value: 0 }, fog = { value: new Color() };
    const near = pyramidMaterial(false, clock, fog), far = pyramidMaterial(true, clock, fog);
    expect(near.customProgramCacheKey()).not.toEqual(far.customProgramCacheKey());
    expect([near.fog, far.fog]).toEqual([true, false]);
    for (const [m, isFar] of [[near, false], [far, true]] as const) {
      const shader = { vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>', uniforms: {} as Record<string, unknown> };
      m.onBeforeCompile(shader as never, undefined as never);
      expect(shader.fragmentShader).toContain('mqPyrPaint()');
      expect(shader.vertexShader).toContain('aPyrB.w * sin(uPyrTime');
      expect(shader.fragmentShader.includes('uHorizonFog')).toBe(isFar);
    }
  });
});

describe('pyramids: in the world', () => {
  const base: SceneryOptions = { rocks: 1, veins: 0.7, homes: 2, flora: 1, bubbles: 0, snow: 0, cap: 8, scale: 1 };
  const terrain = (x: number, z: number): number => Math.sin(x * 0.02) * 3 + Math.cos(z * 0.03) * 4;
  const buffers = (o: SceneryOptions) => buildScenery([], createRng(9), terrain, o).group.children
    .filter((c) => !c.name.startsWith('pyramids')).map((c) => [c.name, ...Array.from((c as Mesh).geometry.getAttribute('position').array)]);

  it('adds two draws and moves nothing else: the rest of the world is the same with or without them', () => {
    const w = buildScenery([], createRng(9), terrain, { ...base, pyramids: 1 });
    expect(w.group.children.filter((c) => c.name.startsWith('pyramids')).map((c) => c.name).sort()).toEqual(['pyramids', 'pyramids-far']);
    expect(w.counts.pyramids).toBeGreaterThan(10);
    // Without: byte-identical to never having had the option.
    expect(buffers({ ...base, pyramids: 0 })).toEqual(buffers(base));
  });

  it('never indoors', () => {
    const w = buildScenery([], createRng(9), terrain, { ...base, pyramids: 1, interior: true });
    expect(w.group.children.some((c) => c.name.startsWith('pyramids'))).toBe(false);
  });
});
