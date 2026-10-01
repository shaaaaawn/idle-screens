import { createRng } from '@idle-screens/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGeodeMineral, parseGeodeMix } from './geode-mix';
import { buildGeodeField, galleryRows, GEODE_FRAGMENT_PARS, GEODE_KINDS, GEODE_SHADE, GEODE_VERTEX, mineralNear, MINERALS, PART, type GeodeFieldOptions, type MineralName } from './geodes';

const opts: GeodeFieldOptions = { amount: 1, cap: 8, scale: 1, blocked: () => false, terrain: () => 0 };
type Field = ReturnType<typeof buildGeodeField>;
const arr = (f: Field, n: string): number[] => Array.from(f.geometry!.getAttribute(n).array);
/** Vertex indices whose part is `p`. */
const ofPart = (f: Field, p: number): number[] => arr(f, 'aPart').flatMap((v, i) => (v === p ? [i] : []));

describe('wild geodes', () => {
  it('scatters a seeded field, fewer and better, the mega geode first, in one geometry', () => {
    const a = buildGeodeField(createRng(3), opts);
    expect(a.geodes).toBe(6); // amount × cap × 0.8: a geode is a find, not gravel
    expect(a.byKind.cavern).toBe(1);
    expect(arr(buildGeodeField(createRng(3), opts), 'position')).toEqual(arr(a, 'position'));
    expect(arr(buildGeodeField(createRng(4), opts), 'position')).not.toEqual(arr(a, 'position'));
    for (const n of ['color', 'aColB', 'aPart', 'aGeo', 'normal']) expect(a.geometry!.getAttribute(n).count).toBe(a.geometry!.getAttribute('position').count);
    expect(arr(a, 'position').every(Number.isFinite)).toBe(true);
    expect(a.obstacles).toHaveLength(a.geodes);
    expect(a.triangles).toBeLessThan(90_000);
    // Every part is drawn: crust, agate, hollow, crystals.
    for (const p of [PART.crust, PART.cut, PART.hollow, PART.crystal]) expect(ofPart(a, p).length, String(p)).toBeGreaterThan(0);
  });

  it('a thin field has no landmark unless asked, and nothing grows where it is blocked', () => {
    const thin = buildGeodeField(createRng(3), { ...opts, amount: 0.3, mix: { geode: 1, cluster: 1 } });
    expect(thin.byKind.cavern).toBe(0);
    expect(thin.byKind.geode + thin.byKind.cluster).toBe(thin.geodes);
    expect(buildGeodeField(createRng(3), { ...opts, blocked: () => true }).geodes).toBe(0);
    expect(buildGeodeField(createRng(3), { ...opts, amount: 0 }).geometry).toBeNull();
  });

  it('keeps them apart and clear of what stands there', () => {
    const blocked = (x: number, z: number, r: number): boolean => Math.hypot(x, z) < 60 + r;
    const f = buildGeodeField(createRng(5), { ...opts, cap: 12, blocked });
    for (const o of f.obstacles) expect(Math.hypot(o.x, o.z)).toBeGreaterThan(60);
    for (let i = 0; i < f.obstacles.length; i += 1) for (let j = i + 1; j < f.obstacles.length; j += 1) {
      expect(Math.hypot(f.obstacles[i]!.x - f.obstacles[j]!.x, f.obstacles[i]!.z - f.obstacles[j]!.z)).toBeGreaterThan(30);
    }
  });

  it('the gallery is a lineup: a row per kind, a column per mineral, the mega geode behind', () => {
    const rows = galleryRows();
    expect(rows.map((r) => r[0]!.kind)).toEqual(['geode', 'geode', 'geode', 'cluster', 'cathedral', 'cavern']);
    for (const row of rows.slice(1, 5)) expect(row.map((g) => g.mineral)).toEqual([...MINERALS]);
    expect(rows[0]!.every((g) => g.aura)).toBe(true);
    const g = buildGeodeField(createRng(3), { ...opts, layout: 'gallery' });
    expect(g.geodes).toBe(rows.flat().length);
    for (const k of GEODE_KINDS) expect(g.byKind[k], k).toBeGreaterThan(0);
    expect(g.thundereggs).toBe(MINERALS.length);
    expect(g.aura).toBe(3);
    // Rows run front to back; the mega geode is behind everything.
    const zs = g.obstacles.map((o) => o.z), cavern = zs[zs.length - 1]!;
    expect(Math.max(...zs.slice(0, -1).filter((_, i) => i >= rows.flat().length - 1 - MINERALS.length))).toBeGreaterThan(cavern);
    expect(Math.min(...zs)).toBe(cavern);
    // Nothing overlaps its neighbour in a row.
    const front = g.obstacles.slice(3, 3 + MINERALS.length);
    for (let i = 1; i < front.length; i += 1) expect(front[i]!.x - front[i - 1]!.x).toBeGreaterThan(45);
    // A scene's own minerals choose the columns.
    expect(galleryRows(['citrine', 'rose']).filter((r) => r[0]!.kind !== 'cavern').every((r) => r.length === 2)).toBe(true);
    // Everything with a hollow glows (thunder eggs are solid): what flora grows round.
    expect(g.lights).toHaveLength(g.geodes - g.thundereggs);
  });

  it('agate is a band field: 0 at the crust, 1 at the hollow, past 1 into a thunder egg\'s star', () => {
    const g = buildGeodeField(createRng(3), { ...opts, layout: 'gallery' });
    const geo = arr(g, 'aGeo');
    const t = ofPart(g, PART.cut).map((i) => geo[i * 4]!);
    expect(t.reduce((a, v) => Math.min(a, v), Infinity)).toBe(0);
    expect(t.some((v) => Math.abs(v - 1) < 1e-6)).toBe(true);
    expect(t.reduce((a, v) => Math.max(a, v), -Infinity)).toBeGreaterThan(1.5); // the star's fortification bands
    // A hollow geode's band field stops at the hollow.
    const hollow = buildGeodeField(createRng(3), { ...opts, layout: 'gallery', minerals: ['amethyst'] });
    expect(ofPart(hollow, PART.cut).length).toBeGreaterThan(0);
  });

  it('crystals are quartz habit, zoned root to tip, and never rise through the cut', () => {
    // One lying half: its cut is the plane through the top of the geode.
    const f = buildGeodeField(createRng(7), { ...opts, amount: 0.15, cap: 8, mix: { geode: 1 } });
    expect(f.byKind.geode).toBe(1);
    const geo = arr(f, 'aGeo'), crystals = ofPart(f, PART.crystal);
    // 18 triangles a crystal: six sides of two, six faces of the point.
    expect(crystals.length % 54).toBe(0);
    const u = crystals.map((i) => geo[i * 4]!);
    expect(Math.min(...u)).toBe(0); // root
    expect(Math.max(...u)).toBe(1); // tip
    const cA = arr(f, 'color'), cB = arr(f, 'aColB');
    const i0 = crystals[0]!;
    expect([cA[i0 * 3], cA[i0 * 3 + 1], cA[i0 * 3 + 2]]).not.toEqual([cB[i0 * 3], cB[i0 * 3 + 1], cB[i0 * 3 + 2]]); // two colours to zone between
  });

  it('about one in twenty is an aura morph; crystals and druse wake near a fish', () => {
    const f = buildGeodeField(createRng(3), opts);
    const geo = arr(f, 'aGeo');
    expect(ofPart(f, PART.crystal).every((i) => geo[i * 4 + 3] === 1)).toBe(true);
    expect(ofPart(f, PART.crust).every((i) => geo[i * 4 + 3] === 0)).toBe(true); // stone sleeps
    // Thirty fields (~360 geodes) pin a 1-in-20 rate well inside these
    // bounds; sixty took ten seconds under coverage on a loaded machine.
    let aura = 0, total = 0, checked = false;
    for (let seed = 1; seed <= 30; seed += 1) {
      const g = buildGeodeField(createRng(seed), { ...opts, cap: 12 });
      aura += g.aura; total += g.geodes;
      if (g.aura && !checked) { expect(arr(g, 'aGeo').some((v, i) => i % 4 === 2 && v >= 10)).toBe(true); checked = true; }
    }
    expect(checked).toBe(true);
    expect(aura / total).toBeGreaterThan(0.005);
    expect(aura / total).toBeLessThan(0.12);
  }, 30_000); // thirty whole fields: a rate needs a sample, and coverage slows every vertex

  it('a mineral list chooses what they are made of', () => {
    const tipsOf = (m: string): [number, number, number] => {
      const f = buildGeodeField(createRng(3), { ...opts, minerals: [m as MineralName], mix: { cluster: 1 } });
      const cB = arr(f, 'aColB'), t: [number, number, number] = [0, 0, 0];
      for (const i of ofPart(f, PART.crystal)) { t[0] += cB[i * 3]!; t[1] += cB[i * 3 + 1]!; t[2] += cB[i * 3 + 2]!; }
      return t;
    };
    const citrine = tipsOf('citrine'), amethyst = tipsOf('amethyst');
    expect(citrine[0]).toBeGreaterThan(citrine[2]); // gold
    expect(amethyst[2]).toBeGreaterThan(amethyst[1]); // violet
  });

  it('belongs to its world: the mineral of the crystal nearest it, the world\'s stone, room for flora', () => {
    expect(mineralNear('#ff4fd0')).toBe('rose'); //    hot pink
    expect(mineralNear('#a855ff')).toBe('amethyst'); // purple
    expect(mineralNear('#ffb020')).toBe('citrine'); //  orange-gold
    expect(mineralNear('#ffffff')).toBe('quartz'); //   white
    const anchors = [{ x: -400, z: 0, color: '#ff4fd0' }, { x: 400, z: 0, color: '#a855ff' }];
    const f = buildGeodeField(createRng(3), { ...opts, anchors });
    const tips = arr(f, 'aColB'), crystals = ofPart(f, PART.crystal);
    // Every crystal is pink or violet, the colours of its crystals.
    for (const i of crystals) expect(tips[i * 3]! + tips[i * 3 + 2]!).toBeGreaterThan(tips[i * 3 + 1]! * 1.6);
    // The crust is the world's slate (cool, dark), not a brown photo rock.
    const crust = ofPart(f, PART.crust)[0]!, cA = arr(f, 'color');
    expect(cA[crust * 3 + 2]!).toBeGreaterThan(cA[crust * 3]!);
    // Every geode with a hollow or a cluster glows: what flora grows round.
    expect(f.lights.length).toBeGreaterThanOrEqual(f.geodes - f.thundereggs);
  });

  it('parses geodeMix and geodeMineral, and stays three-free for the TV', () => {
    expect(parseGeodeMix('cathedral:2, geode, cluster, geode:0.5')).toEqual({ mix: { cathedral: 2, geode: 1.5, cluster: 1 }, problems: [] });
    expect(parseGeodeMix('cathedral, nodule').problems).toHaveLength(1);
    expect(parseGeodeMix(`geode:1${'0'.repeat(400)}`).problems).toHaveLength(1); // overflows to Infinity
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

  it('draws its look per pixel, pure in the clock', () => {
    expect(GEODE_VERTEX).toMatch(/mqStartleAt\(vGeoW\)/);
    expect(GEODE_SHADE).toMatch(/dFdx\(vGeoW\)/); // crisp facets
    expect(GEODE_SHADE).toMatch(/float nb = 8\.0/); // the agate's bands
    // The world's rules: its key (up, left, from behind), its crystal (white-hot root), its glow and pulse.
    expect(GEODE_SHADE).toMatch(/vec3\(-0\.45, 0\.78, -0\.43\)/);
    expect(GEODE_SHADE).toMatch(/float hot = \(1\.0 - t\) \* \(1\.0 - t\) \* 0\.9/);
    expect(GEODE_FRAGMENT_PARS).toMatch(/uniform float uGeoGlow; uniform float uGeoPulse;/);
    for (const src of [GEODE_VERTEX, GEODE_SHADE]) expect(src).not.toMatch(/random\(/);
  });

  it('a fountain and lamps take the mineral the scene gives them, or quartz with none', () => {
    const plain = buildGeodeField(createRng(3), { ...opts, amount: 0, fountain: { kind: 'geode', x: 0, z: 0 }, lamps: [{ x: 40, z: 0 }] });
    expect(plain.fountain).toBeTruthy();
    expect(plain.lamps).toHaveLength(1);
    expect(plain.lamps[0]!.color).toBe('#ffffff'); // quartz
    const listed = buildGeodeField(createRng(3), { ...opts, amount: 0, minerals: ['citrine'], lamps: [{ x: 40, z: 0 }] });
    expect(listed.lamps[0]!.color).toBe('#c86808'); // citrine's tip
    const vent = buildGeodeField(createRng(3), { ...opts, amount: 0, fountain: { kind: 'vent', x: 0, z: 0 }, anchors: [{ x: 50, z: 0, color: '#a855ff' }] });
    expect(vent.fountain!.color).toBe('#ffb36b'); // a vent's mouth is hot whatever the neighbourhood
    expect(vent.obstacles).toHaveLength(1);
  });
});
