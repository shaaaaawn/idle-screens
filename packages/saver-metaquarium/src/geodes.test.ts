import { createRng } from '@idle-screens/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGeodeMineral, parseGeodeMix } from './geode-mix';
import { buildGeodeField, GEODE_GALLERY, GEODE_KINDS, GEODE_LOOK, GEODE_VERTEX, MINERALS, type GeodeFieldOptions } from './geodes';

const opts: GeodeFieldOptions = { amount: 1, cap: 8, scale: 1, blocked: () => false, terrain: () => 0 };
const arr = (f: ReturnType<typeof buildGeodeField>, n: string): number[] => Array.from(f.geometry!.getAttribute(n).array);

describe('wild geodes', () => {
  it('scatters a seeded field of every kind, the mega geode first, in one geometry', () => {
    const a = buildGeodeField(createRng(3), opts);
    expect(a.geodes).toBe(12); // amount × cap × 1.5
    expect(a.byKind.cavern).toBe(1); // a full field always has its landmark…
    expect(a.byKind.orb).toBeLessThanOrEqual(3); // …and orbs stay rare
    expect(GEODE_KINDS.filter((k) => a.byKind[k] > 0).length).toBeGreaterThanOrEqual(5);
    expect(arr(buildGeodeField(createRng(3), opts), 'position')).toEqual(arr(a, 'position'));
    expect(arr(buildGeodeField(createRng(4), opts), 'position')).not.toEqual(arr(a, 'position'));
    for (const n of ['color', 'aGeo', 'aFloat', 'normal']) expect(a.geometry!.getAttribute(n).count).toBe(a.geometry!.getAttribute('position').count);
    expect(arr(a, 'position').every(Number.isFinite)).toBe(true);
    expect(a.obstacles).toHaveLength(a.geodes);
    expect(a.triangles).toBeLessThan(60_000);
  });

  it('a thin field has no landmark unless asked, and nothing grows where it is blocked', () => {
    const thin = buildGeodeField(createRng(3), { ...opts, amount: 0.3, mix: { nodule: 1, druse: 1 } });
    expect(thin.byKind.cavern).toBe(0);
    expect(thin.byKind.nodule + thin.byKind.druse).toBe(thin.geodes);
    expect(buildGeodeField(createRng(3), { ...opts, blocked: () => true }).geodes).toBe(0);
    expect(buildGeodeField(createRng(3), { ...opts, amount: 0 }).geometry).toBeNull();
  });

  it('keeps them apart and clear of what stands there', () => {
    const blocked = (x: number, z: number, r: number): boolean => Math.hypot(x, z) < 60 + r;
    const f = buildGeodeField(createRng(5), { ...opts, cap: 12, blocked });
    for (const o of f.obstacles) expect(Math.hypot(o.x, o.z)).toBeGreaterThan(60);
    for (let i = 0; i < f.obstacles.length; i += 1) for (let j = i + 1; j < f.obstacles.length; j += 1) {
      expect(Math.hypot(f.obstacles[i]!.x - f.obstacles[j]!.x, f.obstacles[i]!.z - f.obstacles[j]!.z)).toBeGreaterThan(20);
    }
  });

  it('the gallery stands one of each kind in two rows', () => {
    const g = buildGeodeField(createRng(3), { ...opts, layout: 'gallery' });
    expect(g.geodes).toBe(GEODE_GALLERY.flat().length);
    for (const k of GEODE_KINDS) expect(g.byKind[k], k).toBeGreaterThan(0);
    const front = g.obstacles.slice(0, GEODE_GALLERY[0]!.length), back = g.obstacles.slice(GEODE_GALLERY[0]!.length);
    expect(Math.min(...front.map((o) => o.z))).toBeGreaterThan(Math.max(...back.map((o) => o.z)));
  });

  it('only the orbs float; the big ones light the floor', () => {
    const g = buildGeodeField(createRng(3), { ...opts, layout: 'gallery' });
    const flt = arr(g, 'aFloat'), pos = arr(g, 'position');
    let floating = 0;
    for (let v = 0; v < flt.length / 4; v += 1) if (flt[v * 4 + 3]! > 0) {
      floating += 1;
      expect(pos[v * 3 + 1]!).toBeGreaterThan(5); // up off the floor
    }
    expect(floating).toBeGreaterThan(0);
    // Cathedrals ×2, the orb and the cavern carry a light.
    expect(g.lights).toHaveLength(4);
  });

  it('druse glints, a geode answers a fish, and about one in twenty is an aura morph', () => {
    const f = buildGeodeField(createRng(3), opts);
    const geo = arr(f, 'aGeo');
    expect(geo.some((v, i) => i % 4 === 0 && v > 0)).toBe(true); // glint
    expect(geo.some((v, i) => i % 4 === 3 && v > 0)).toBe(true); // wakes near a fish
    let aura = 0, total = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const g = buildGeodeField(createRng(seed), { ...opts, cap: 12 });
      aura += g.aura; total += g.geodes;
      if (g.aura) expect(arr(g, 'aGeo').some((v, i) => i % 4 === 1 && v === 1)).toBe(true);
    }
    expect(aura / total).toBeGreaterThan(0.01);
    expect(aura / total).toBeLessThan(0.12);
  });

  it('a mineral list colours every crystal its own way', () => {
    const tips = (m: string): [number, number, number] => {
      const f = buildGeodeField(createRng(3), { ...opts, minerals: [m as never], mix: { druse: 1 } });
      const geo = arr(f, 'aGeo'), col = arr(f, 'color');
      const t = [0, 0, 0];
      for (let v = 0; v < geo.length / 4; v += 1) if (geo[v * 4]! > 0) { t[0] += col[v * 3]!; t[1] += col[v * 3 + 1]!; t[2] += col[v * 3 + 2]!; }
      return t as [number, number, number];
    };
    const citrine = tips('citrine'), amethyst = tips('amethyst');
    expect(citrine[0]).toBeGreaterThan(citrine[2]); // gold: more red than blue
    expect(amethyst[2]).toBeGreaterThan(amethyst[1]); // violet: more blue than green
  });

  it('parses geodeMix and geodeMineral, and stays three-free for the TV', () => {
    expect(parseGeodeMix('cathedral:2, nodule, orb, nodule:0.5')).toEqual({ mix: { cathedral: 2, nodule: 1.5, orb: 1 }, problems: [] });
    expect(parseGeodeMix('cathedral, pyramid').problems).toHaveLength(1);
    expect(parseGeodeMineral('')).toEqual({ minerals: undefined, problems: [] });
    const w = parseGeodeMineral('world', 0.42).minerals!;
    expect(w).toHaveLength(2);
    expect(w[0]).not.toBe(w[1]);
    expect(parseGeodeMineral('world', 0.42).minerals).toEqual(w);
    expect(MINERALS).toEqual(expect.arrayContaining(w));
    expect(parseGeodeMineral('Amethyst, citrine, amethyst').minerals).toEqual(['amethyst', 'citrine']);
    expect(parseGeodeMineral('amethyst, unobtainium').problems).toHaveLength(1);
    const src = readFileSync(new URL('./geode-mix.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from ['"]three/);
    expect(src).not.toMatch(/from ['"]\.\//);
  });

  it('moves and lights in the vertex shader, pure in the clock', () => {
    expect(GEODE_VERTEX).toMatch(/aFloat\.w > 0\.0/);
    expect(GEODE_LOOK).toMatch(/pow\(max\(0\.0, sin\(aGeo\.z \* 61\.0/);
    expect(GEODE_LOOK).toMatch(/mqStartleAt\(gW\)/);
    for (const src of [GEODE_VERTEX, GEODE_LOOK]) expect(src).not.toMatch(/random|noise\(/);
  });
});
