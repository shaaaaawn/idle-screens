import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { pearlSites } from './bubbles';
import { buildFlora, lampHeads, FLORA_BY_ENVIRONMENT, GALLERY_ROWS, FLORA_COLOR, FLORA_SPECIES, FLORA_SWAY, FLORA_VERTEX, MAX_FLORA_FISH, parseFloraMix, SPORE_VERTEX, type FloraOptions } from './flora';
import { parseFloraPalette, worldPalette } from './flora-mix';

const anchors = [{ x: 0, y: 0, z: 0, color: '#2dffb0' }, { x: 80, y: 0, z: -40, color: '#4fe9ff' }];
const opts: FloraOptions = { density: 1, cap: 8, scale: 1, blocked: () => false };
const flat = (): number => 0;
const arr = (g: { getAttribute(n: string): { array: ArrayLike<number> } }, n: string): number[] => Array.from(g.getAttribute(n).array);

describe('flora', () => {
  it('plants a mixed garden, seeded, in two draws', () => {
    const a = buildFlora(anchors, flat, createRng(3), opts);
    expect(a.plants).toBe(72);
    expect(FLORA_SPECIES.filter(sp => a.bySpecies[sp] > 0).length).toBeGreaterThanOrEqual(11);
    expect(a.bySpecies.grass).toBeGreaterThan(a.bySpecies.tube); // ground cover outnumbers the features
    expect(a.bySpecies.clam).toBeLessThanOrEqual(2)
    expect(a.parts).toHaveLength(1);
    expect(a.lamps).toHaveLength(1);
    const b = buildFlora(anchors, flat, createRng(3), opts);
    expect(arr(b.parts[0]!, 'position')).toEqual(arr(a.parts[0]!, 'position'));
    expect(arr(buildFlora(anchors, flat, createRng(4), opts).parts[0]!, 'position')).not.toEqual(arr(a.parts[0]!, 'position'));
  });

  it('is made of cubes on a grid: axis-aligned quads, finite, budgeted', () => {
    const f = buildFlora(anchors, flat, createRng(5), opts);
    for (const g of [...f.parts, ...f.lamps]) {
      const n = g.getAttribute('position').count;
      expect(n % 6).toBe(0); // whole quads (a solid draws only the faces that touch water)
      for (const name of ['normal', 'color', 'aSway', 'aGlow', 'aMat']) expect(g.getAttribute(name).count).toBe(n);
      expect(arr(g, 'position').every(Number.isFinite)).toBe(true);
      const nor = arr(g, 'normal');
      for (let i = 0; i < nor.length; i += 3) expect(Math.abs(nor[i]!) + Math.abs(nor[i + 1]!) + Math.abs(nor[i + 2]!)).toBe(1);
    }
    expect(f.voxels * 12).toBeLessThan(60_000);
  });

  it('stays in budget in every room, at the top tier', () => {
    for (const environment of ['void', ...Object.keys(FLORA_BY_ENVIRONMENT)]) {
      const f = buildFlora(anchors, flat, createRng(7), { ...opts, cap: 12, environment });
      const tris = [...f.parts, ...f.lamps].reduce((a, g) => a + g.getAttribute('position').count / 3, 0);
      expect(tris, environment).toBeLessThan(64_000);
      expect(f.plants).toBe(108);
    }
  });

  it('floraMix chooses what grows, by relative weight', () => {
    for (const sp of FLORA_SPECIES) {
      const f = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { [sp]: 1 } });
      expect(f.bySpecies[sp], sp).toBe(f.plants);
      expect(f.plants, sp).toBeGreaterThan(0);
      expect(f.parts.length + f.lamps.length, sp).toBeGreaterThan(0);
    }
    const f = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { kelp: 3, anemone: 1 } });
    expect(f.bySpecies.kelp + f.bySpecies.anemone).toBe(f.plants);
    expect(f.bySpecies.kelp).toBeGreaterThan(f.bySpecies.anemone * 1.5);
  });

  it('a giant clam is a specimen: two to a garden, however it is asked for', () => {
    const f = buildFlora(anchors, flat, createRng(3), { ...opts, cap: 12, mix: { clam: 1 } });
    expect(f.bySpecies.clam).toBe(2);
    expect(f.lights).toHaveLength(2); // the mantle glows
    expect(f.tips.every((t) => t.flex === 0)).toBe(true); // and it is stone
  });

  it('each room grows its own garden when floraMix is empty', () => {
    const grow = (environment: string) => buildFlora(anchors, flat, createRng(3), { ...opts, environment }).bySpecies;
    const reef = grow('reef'), kelp = grow('kelp'), vent = grow('vent');
    expect(reef.staghorn + reef.brain + reef.fan).toBeGreaterThan(reef.kelp + reef.grass);
    expect(kelp.staghorn).toBe(0);
    expect(Math.max(...FLORA_SPECIES.map(sp => kelp[sp]))).toBe(kelp.kelp);
    expect(vent.tube).toBeGreaterThan(vent.kelp);
    // A mix always wins over the room.
    expect(buildFlora(anchors, flat, createRng(3), { ...opts, environment: 'reef', mix: { whip: 1 } }).bySpecies.whip).toBe(72);
    // An unknown room is the default garden.
    expect(grow('nowhere')).toEqual(grow('void'));
  });

  it('solids draw only their skin', () => {
    const f = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { brain: 1 } });
    const tris = f.parts[0]!.getAttribute('position').count / 3;
    expect(tris).toBeLessThan(f.voxels * 12 * 0.5);
  });

  it('stone does not sway: each species has its own stiffness', () => {
    const flexOf = (sp: string): number[] => {
      const f = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { [sp]: 1 } });
      const m = arr(f.parts[0]!, 'aMat');
      return [...new Set(m.filter((_, i) => i % 2 === 0).map((v) => +v.toFixed(3)))].sort();
    };
    expect(flexOf('brain')).toEqual([0]);
    expect(flexOf('clam')).toEqual([0]);
    expect(flexOf('staghorn')).toEqual([0.12]);
    expect(flexOf('kelp')).toEqual([1]);
    // The anemone: a still column, tentacles that writhe from the crown.
    expect(flexOf('anemone')).toEqual([0.2, 2.4]);
    const an = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { anemone: 1 } });
    const mat = arr(an.parts[0]!, 'aMat'), sw = arr(an.parts[0]!, 'aSway'), pos = arr(an.parts[0]!, 'position');
    for (let v = 0; v < mat.length / 2; v += 1) {
      // A tentacle is rooted at its crown, above the floor, so it never pulls off the column.
      if (mat[v * 2]! > 2) { expect(sw[v * 3]!).toBeGreaterThan(0); expect(pos[v * 3 + 1]!).toBeGreaterThanOrEqual(sw[v * 3]! - 1e-6); }
    }
    expect(Math.max(...an.tips.map((t) => t.flex))).toBe(2.4); // the canopy knows the crown sways
  });

  it('plants grow in colonies that share a colour', () => {
    const f = buildFlora(anchors, flat, createRng(3), { ...opts, cap: 12 });
    expect(f.colonies).toBeGreaterThan(f.plants / 6);
    expect(f.colonies).toBeLessThan(f.plants * 0.8);
    // A one-species garden of whips: siblings share a hue, so far fewer
    // distinct tip colours than stands.
    const w = buildFlora(anchors, flat, createRng(9), { ...opts, mix: { whip: 1 } });
    const col = arr(w.parts[0]!, 'color'), nor = arr(w.parts[0]!, 'normal');
    const hues = new Set<string>();
    for (let v = 0; v < col.length / 3; v += 1) if (nor[v * 3 + 1] === 1) {
      const r = col[v * 3]!, g = col[v * 3 + 1]!, b = col[v * 3 + 2]!, m = Math.max(r, g, b);
      hues.add(`${(r / m).toFixed(1)},${(g / m).toFixed(1)},${(b / m).toFixed(1)}`);
    }
    expect(hues.size).toBeLessThan(w.plants * 4);
  });

  it('about one colony in thirty is a rare morph, and it gleams', () => {
    let rare = 0, plants = 0, lampsGleam = false;
    for (let seed = 1; seed <= 30; seed += 1) {
      const f = buildFlora(anchors, flat, createRng(seed), { ...opts, cap: 12 });
      rare += f.rare; plants += f.plants;
      if (f.rare) {
        const sheen = arr(f.parts[0]!, 'aMat').filter((_, i) => i % 2 === 1);
        expect(sheen.some((v) => v === 1)).toBe(true);
        // Its lamps are nacreous too, not just its body.
        if (f.lamps[0] && arr(f.lamps[0], 'aMat').some((v, i) => i % 2 === 1 && v === 1)) lampsGleam = true;
      }
    }
    expect(lampsGleam).toBe(true);
    expect(rare / plants).toBeGreaterThan(0.01);
    expect(rare / plants).toBeLessThan(0.12);
  }, 30_000); // thirty whole gardens: a rate needs a sample, and coverage slows every voxel

  it('the elder is one great tree, out past the garden', () => {
    const f = buildFlora(anchors, flat, createRng(3), { ...opts, cap: 12, mix: { elder: 1 } });
    expect(f.bySpecies.elder).toBe(1);
    const t = f.tips[0]!;
    expect(t.y - t.root).toBeGreaterThan(35);
    expect(Math.min(...anchors.map((a) => Math.hypot(t.x - a.x, t.z - a.z)))).toBeGreaterThanOrEqual(29);
    // Its blossoms are lamps apart: each sheds its own spores, four at most.
    expect(f.lights.length).toBeGreaterThan(1);
    expect(f.lights.length).toBeLessThanOrEqual(4);
  });

  it('pearls rise only off leaves', () => {
    const stone = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { brain: 1, staghorn: 1, clam: 1 } });
    expect(pearlSites(stone.parts, 1)).toHaveLength(0);
    const leaves = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { kelp: 1 } });
    expect(pearlSites(leaves.parts, 1).length).toBeGreaterThan(10);
  });

  it('answers a passing fish: crowns fold, worms duck, pens pull down, pods swell', () => {
    const reactOf = (sp: string, which: 'parts' | 'lamps' = 'parts'): number[] => {
      const f = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { [sp]: 1 } });
      const g = f[which][0]!;
      return [...new Set(arr(g, 'aPlant').filter((_, i) => i % 4 === 2).map((v) => +v.toFixed(2)))].sort();
    };
    expect(reactOf('anemone')).toEqual([0, 1]); // the column stands; the tentacles fold
    expect(reactOf('tube')).toEqual([0]); //       the tube stands…
    expect(reactOf('tube', 'lamps')).toEqual([1]); // …and the worm's light ducks into it
    expect(reactOf('seapen')).toEqual([0.8]);
    expect(reactOf('clam', 'lamps')).toEqual([1]);
    expect(reactOf('kelp')).toEqual([0]); //       kelp does not flinch
    // A pod swells about its own middle, above its root.
    const pod = buildFlora(anchors, flat, createRng(4), { ...opts, mix: { pod: 1 } });
    const ap = arr(pod.parts[0]!, 'aPlant'), sw = arr(pod.parts[0]!, 'aSway');
    let swell = 0;
    for (let v = 0; v < ap.length / 4; v += 1) if (ap[v * 4 + 2] === -1) { swell += 1; expect(ap[v * 4 + 3]!).toBeGreaterThan(sw[v * 3]!); }
    expect(swell).toBeGreaterThan(0);
    // The shader measures once, flares lamps, and folds only what reacts.
    expect(FLORA_COLOR).toMatch(/mqStartle = mqStartleAt\(position\)/);
    expect(FLORA_COLOR).toMatch(/aGlow \* mqStartle/);
    expect(FLORA_VERTEX).toMatch(/if \(mqStartle > 0\.0 && aPlant\.z != 0\.0\)/);
    expect(MAX_FLORA_FISH).toBe(24);
  });

  it('dimorphic: some siblings grow as the small form of their species', () => {
    const f = buildFlora(anchors, flat, createRng(3), { ...opts, cap: 12, mix: { kelp: 1 } });
    const h = f.tips.map((t) => t.y - t.root);
    // A full-grown kelp is at least 12 voxels (20 units); a sapling is under that.
    expect(h.filter((v) => v < 18).length).toBeGreaterThan(2);
    expect(h.filter((v) => v >= 20).length).toBeGreaterThan(h.length / 2);
    // Specimens are never small.
    const clam = buildFlora(anchors, flat, createRng(3), { ...opts, cap: 12, mix: { clam: 1 } });
    expect(Math.min(...clam.tips.map((t) => t.y - t.root))).toBeGreaterThan(5);
  });

  it('grows the fiddlehead and the pod in both its forms', () => {
    const curl = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { curl: 1 } });
    // A bead at every coil's heart: one light a coil, every plant lit.
    expect(curl.lights.length).toBeGreaterThanOrEqual(curl.plants);
    expect(curl.lights.length).toBeLessThanOrEqual(curl.plants * 4);
    let orb = 0, whirl = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const p = buildFlora(anchors, flat, createRng(seed), { ...opts, mix: { pod: 1 } });
      const swells = arr(p.parts[0]!, 'aPlant').some((v, i) => i % 4 === 2 && v === -1);
      if (swells) orb += 1; else whirl += 1;
    }
    expect(orb).toBeGreaterThan(0);
    expect(orb + whirl).toBe(6);
  });

  it('a world palette pulls every colony toward one scheme', () => {
    expect(parseFloraPalette('')).toEqual({ palette: undefined, problems: [] });
    expect(parseFloraPalette('world', 0.25).palette).toEqual(worldPalette(0.25));
    expect(worldPalette(0.25)).toHaveLength(3);
    expect(worldPalette(0.25)).toEqual(worldPalette(1.25));
    expect(parseFloraPalette('#FF00FF, #00ff88').palette).toEqual(['#ff00ff', '#00ff88']);
    const bad = parseFloraPalette('#ff00ff, blue, #12');
    expect(bad.palette).toEqual(['#ff00ff']);
    expect(bad.problems).toHaveLength(2);
    const mean = (f: ReturnType<typeof buildFlora>, ch: number): number => {
      const c = arr(f.parts[0]!, 'color');
      let t = 0;
      for (let i = ch; i < c.length; i += 3) t += c[i]!;
      return t / (c.length / 3);
    };
    const natural = buildFlora(anchors, flat, createRng(3), opts);
    const magenta = buildFlora(anchors, flat, createRng(3), { ...opts, palette: ['#ff00ff'] });
    expect(mean(magenta, 1)).toBeLessThan(mean(natural, 1) * 0.8); // far less green
    expect(mean(magenta, 0)).toBeGreaterThan(mean(magenta, 1) * 1.5);
  });

  it('the gallery plants one of each species in its own plot, low in front and tall behind', () => {
    const f = buildFlora(anchors, flat, createRng(3), { ...opts, layout: 'gallery' });
    expect(GALLERY_ROWS.flat().sort()).toEqual([...FLORA_SPECIES].sort()); // every species has a place
    expect(f.plants).toBe(FLORA_SPECIES.length);
    for (const sp of FLORA_SPECIES) expect(f.bySpecies[sp], sp).toBe(1);
    // Plots are apart, and none stands inside a crystal.
    for (let i = 0; i < f.tips.length; i += 1) for (let j = i + 1; j < f.tips.length; j += 1) {
      expect(Math.hypot(f.tips[i]!.x - f.tips[j]!.x, f.tips[i]!.z - f.tips[j]!.z)).toBeGreaterThan(15);
    }
    for (const t of f.tips) for (const c of anchors) expect(Math.hypot(t.x - c.x, t.z - c.z)).toBeGreaterThanOrEqual(14);
    // The front row is nearer (+z) than the back.
    const zOf = (sp: string): number => f.tips[[...GALLERY_ROWS.flat()].indexOf(sp as never)]!.z;
    expect(zOf('grass')).toBeGreaterThan(zOf('kelp'));
    // floraMix narrows it to what it names; no crystals is no problem.
    const two = buildFlora([], flat, createRng(3), { ...opts, layout: 'gallery', mix: { clam: 1, elder: 2 } });
    expect(two.plants).toBe(2);
    expect(two.bySpecies.clam + two.bySpecies.elder).toBe(2);
  });

  it('parses floraMix', () => {
    expect(parseFloraMix('kelp:3, anemone, clam:0.5, kelp')).toEqual({ mix: { kelp: 4, anemone: 1, clam: 0.5 }, problems: [] });
    expect(parseFloraMix('').mix).toEqual({});
    expect(parseFloraMix(`kelp:1${'0'.repeat(400)}`).problems).toHaveLength(1); // overflows to Infinity
    const bad = parseFloraMix('kelp, rose:2, whip:x');
    expect(bad.mix).toEqual({ kelp: 1 });
    expect(bad.problems).toHaveLength(2);
    expect(bad.problems[0]).toMatch(/rose/);
  });

  it('never roots inside something solid, and nothing grows with no light to feed on', () => {
    const blocked = (x: number, z: number): boolean => Math.hypot(x, z) < 60;
    const f = buildFlora([anchors[0]!], flat, createRng(3), { ...opts, blocked });
    expect(f.plants).toBe(0); // every habitat is inside the blocked disc
    expect(buildFlora([], flat, createRng(3), opts).plants).toBe(0);
    expect(buildFlora(anchors, flat, createRng(3), { ...opts, density: 0 }).parts).toHaveLength(0);
  });

  it('stems never glow; lights always do', () => {
    const f = buildFlora(anchors, flat, createRng(5), opts);
    expect(arr(f.parts[0]!, 'aGlow').every((v) => v === 0)).toBe(true);
    expect(arr(f.lamps[0]!, 'aGlow').every((v) => v === 1)).toBe(true);
  });

  it('reports a light for every lamp a plant carries, four at most, and a crown for every plant', () => {
    const f = buildFlora(anchors, flat, createRng(3), opts);
    const unlit = f.bySpecies.grass + f.bySpecies.brain;
    expect(f.lights.length).toBeLessThanOrEqual((f.plants - unlit) * 4);
    expect(f.lights.length).toBeGreaterThan((f.plants - unlit) * 0.8); // a staghorn may light no tip
    expect(f.lights.every(l => l.y > l.root && Number.isFinite(l.x + l.z))).toBe(true);
    // The shoal keeps above every plant, lit or not.
    expect(f.tips).toHaveLength(f.plants);
    expect(f.tips.every(t => t.y > t.root)).toBe(true);
    const whips = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { whip: 1 } });
    expect(Math.max(...whips.tips.map(t => t.y - t.root))).toBeGreaterThan(20);
  });

  it('a spore sways with the lamp it leaves: that lamp\'s own root, flex and phase', () => {
    const f = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { anemone: 1, elder: 1 } });
    const g = f.lamps[0]!, pos = arr(g, 'position'), sway = arr(g, 'aSway'), mat = arr(g, 'aMat');
    expect(f.lights.length).toBeGreaterThan(0);
    const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
    for (const l of f.lights) {
      // Some corner of the cell it was taken from (siblings' tips can sit
      // closer than a cell's own corners, so not simply the nearest vertex)
      // sways exactly as the light does. Within 3: an elder's blossom cell
      // reaches 1.6 to its corners.
      let match = false;
      for (let v = 0; v < pos.length / 3 && !match; v += 1) {
        const q = (pos[v * 3]! - l.x) ** 2 + (pos[v * 3 + 1]! - l.y) ** 2 + (pos[v * 3 + 2]! - l.z) ** 2;
        match = q < 9 && near(l.root, sway[v * 3]!) && near(l.phase, sway[v * 3 + 1]!) && near(l.gust, sway[v * 3 + 2]!) && near(l.flex, mat[v * 2]!);
      }
      expect(match, `light at ${l.x.toFixed(1)},${l.y.toFixed(1)},${l.z.toFixed(1)}`).toBe(true);
    }
  });

  it('tells a plant\'s lamps apart by whether their cells touch', () => {
    // Cells 0-2 a run along x (one lamp), 3 alone, 4-5 a pair: drawn in that order.
    const cells = [0, 0, 0, 1, 0, 0, 2, 0, 0, 10, 5, 0, 20, 0, 0, 20, 1, 0];
    expect(lampHeads(cells, 0, 6, 1.5 ** 2, 4)).toEqual([5, 3, 2]); // each lamp's last cell, the last lamp first
    expect(lampHeads(cells, 0, 6, 1.5 ** 2, 2)).toEqual([5, 3]); //    capped
    expect(lampHeads(cells, 3, 6, 1.5 ** 2, 4)).toEqual([5, 3]); //    only this plant's cells
    expect(lampHeads(cells, 0, 6, 30 ** 2, 4)).toEqual([5]); //        all touching: one lamp
    expect(lampHeads(cells, 2, 2, 1, 4)).toEqual([]);
  });

  it('motion is gentle, pure in the tank clock, and zero at the root', () => {
    for (const src of [FLORA_VERTEX, FLORA_COLOR]) expect(src).toMatch(/uSwayTime/);
    expect(FLORA_SWAY).toMatch(/h \* h/); // grows with height² — a root never moves
    expect(FLORA_SWAY).toMatch(/min\(/); //   and is capped — water, not wind
    expect(FLORA_SWAY).toMatch(/- h \* 0\.16/); // a wave CLIMBS the stalk: an S-curve, not a lean
    for (const src of [FLORA_SWAY, FLORA_VERTEX, FLORA_COLOR, SPORE_VERTEX]) expect(src).not.toMatch(/random|noise\(/);
    expect(SPORE_VERTEX).toMatch(/mqFloraSway/); // spores leave from where the tip IS
  });
});

describe('flora-mix', () => {
  it('stays three-free: the package entry reaches it through guide.ts, on the TV\'s 2D path too', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./flora-mix.ts', import.meta.url), 'utf8');
    // Every import, side-effect ones included, either quote style.
    const importsOf = (code: string): string[] => [...code.matchAll(/^\s*(?:import\s+(?:[^;'"]*?\s+from\s+)?|export\s+[^;'"]*?\s+from\s+)['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
    // The same reader finds three where it is imported (it is not vacuous)…
    expect(importsOf(readFileSync(new URL('./flora.ts', import.meta.url), 'utf8'))).toContain('three');
    expect(importsOf(`import 'three';\nimport { a } from "./crystals";`)).toEqual(['three', './crystals']);
    // …and flora-mix imports nothing that could pull three in.
    for (const from of importsOf(src)) expect(['./crystals'], from).toContain(from.replace(/\.ts$/, ''));
  });

  it('refuses a weight too large to be a number', async () => {
    const { parseFloraMix } = await import('./flora-mix');
    expect(parseFloraMix('kelp:' + '9'.repeat(400)).problems[0]).toMatch(/too large/); // parses as Infinity
    expect(parseFloraMix('kelp:' + '9'.repeat(400)).mix.kelp).toBeUndefined();
  });
});
