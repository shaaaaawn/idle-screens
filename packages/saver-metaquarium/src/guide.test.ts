import { describe, expect, it } from 'vitest';
import { GRAMMAR, PARAM_DOCS, RECIPES, recipe, recipeTrack, validateMetaquariumParams } from './guide';
import { metaquariumManifest } from './manifest';

const space = metaquariumManifest.paramSpace!;

describe('agent guide', () => {
  it('documents every param, and nothing that is not one', () => {
    expect(Object.keys(space).filter((k) => !PARAM_DOCS[k])).toEqual([]);
    expect(Object.keys(PARAM_DOCS).filter((k) => !space[k])).toEqual([]);
    for (const [k, doc] of Object.entries(PARAM_DOCS)) expect(doc.length, k).toBeGreaterThan(10);
  });

  it('every recipe is a legal scene: known params, in range, right type, clean DSLs, channel-safe', () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    for (const r of RECIPES) {
      for (const [k, v] of Object.entries(r.params)) {
        const def = space[k];
        expect(def, `${r.id}.${k}`).toBeDefined();
        if (def!.type === 'number') {
          expect(typeof v, `${r.id}.${k}`).toBe('number');
          if (def!.min !== undefined) expect(v as number, `${r.id}.${k}`).toBeGreaterThanOrEqual(def!.min);
          if (def!.max !== undefined) expect(v as number, `${r.id}.${k}`).toBeLessThanOrEqual(def!.max);
        } else if (def!.type === 'enum') expect(def!.options, `${r.id}.${k}`).toContain(v);
        else expect(typeof v, `${r.id}.${k}`).toBe('string');
      }
      expect(validateMetaquariumParams(r.params), r.id).toEqual([]);
      // Nothing a wall cannot reach.
      expect(JSON.stringify(r.params)).not.toMatch(/localhost|\/assets\/|dracoPath/);
      expect(r.what.length).toBeGreaterThan(20);
    }
  });

  it('a recipe becomes the track publishScene takes', () => {
    const track = recipeTrack(RECIPES[0]!.params);
    expect(track.deltas).toHaveLength(Object.keys(RECIPES[0]!.params).length);
    expect(track.deltas.every((d) => d.t === 0 && d.path in space)).toBe(true);
  });

  it('finds a recipe by id, and nothing by a name it does not have', () => {
    for (const r of RECIPES) expect(recipe(r.id)).toBe(r);
    expect(recipe('tea')!.params.interior).toBe('geode');
    expect(recipe('TEA')).toBeUndefined(); // ids are exact
    expect(recipe('')).toBeUndefined();
  });

  it('catches what an agent gets wrong, with the path to fix', () => {
    const bad = validateMetaquariumParams({ fishMix: 'goldfish:2', propMix: 'rock:3', spotRig: 'first', spotCues: '8s:a', vignette: 'a >home1' });
    expect(new Set(bad.map((b) => b.path))).toEqual(new Set(['fishMix', 'propMix', 'spotRig', 'spotCues', 'vignette']));
    // …and the same vignette is fine once the world has homes.
    expect(validateMetaquariumParams({ vignette: '4s: a =home1, b =home2 | 6s: a >centre, b >centre | 6s: a >home1, b >home2', geodeHomes: 2, fishMix: '100:1,257:1' })).toEqual([]);
    expect(validateMetaquariumParams({ vignette: '6s: a >gate', landmark: 'castle' })).toEqual([]);
  });

  it('says when fishMix overrides fishCount and fishUrl — the silent 14 → 9 of the prod probe', () => {
    const out = validateMetaquariumParams({ fishMix: 'octopus:2,blowfish:3,dori:4', fishCount: 14 });
    expect(out).toEqual([{ path: 'fishCount', also: ['fishMix'], message: expect.stringContaining('9 fish') }]);
    expect(validateMetaquariumParams({ fishMix: 'dori:2', fishUrl: 'ipfs://x' }).map((p) => p.path)).toEqual(['fishUrl']);
    // Without a mix, fishCount IS the cast: nothing to say.
    expect(validateMetaquariumParams({ fishCount: 14 })).toEqual([]);
    // A mix with no valid token falls back to fishCount, so fishCount is not overridden.
    expect(validateMetaquariumParams({ fishMix: 'nemo:3', fishCount: 4 }).map((p) => p.path)).toEqual(['fishMix']);
    expect(validateMetaquariumParams({ fishMix: 'dori:20,blowfish:10' })[0]?.message).toContain('at most 24');
  });

  it('flags a slot past the end of the cast', () => {
    const paths = (p: Record<string, unknown>): string[] => validateMetaquariumParams(p).map((x) => x.path);
    expect(paths({ fishMix: 'dori:2', cameraFollow: 2 })).toEqual(['cameraFollow']);
    expect(paths({ fishMix: 'dori:3', cameraFollow: 2 })).toEqual([]);
    expect(paths({ fishCount: 3, followSpot: 5 })).toEqual(['followSpot']);
    expect(paths({ fishMix: 'dori:1', spotRig: '0, 1/#ff8ad0' })).toEqual(['spotRig']);
    expect(paths({ fishMix: 'dori:1', vignette: 'duet' })).toEqual(['vignette']);
    expect(validateMetaquariumParams({ fishCount: 1, followSpot: 1 })[0]).toEqual({
      path: 'followSpot', also: ['fishCount'], message: 'slot 1 has no fish — the cast is fishCount 1 (slots 0–0)',
    });
  });

  it('flags a param that only shapes something switched off', () => {
    const paths = (p: Record<string, unknown>): string[] => validateMetaquariumParams(p).map((x) => x.path);
    expect(paths({ fishMix: 'dori:3', starfishDance: 'aerobics' })).toEqual(['starfishDance']);
    expect(paths({ fishMix: 'starfish:7', starfishDance: 'aerobics', danceTempo: 110 })).toEqual([]);
    expect(paths({ danceTempo: 110 })).toEqual(['danceTempo']);
    expect(paths({ followDistance: 60, followAngle: 90 })).toEqual(['followDistance', 'followAngle']);
    expect(paths({ fishMix: 'dori:2', cameraFollow: 0, cameraDistance: 140, autoRotate: 1, followDistance: 60 })).toEqual(['cameraDistance']);
    // A follow slot past the cast never activates: only the slot problem, no "orbit ignored".
    expect(paths({ fishMix: 'dori:2', cameraFollow: 5, cameraDistance: 140 })).toEqual(['cameraFollow']);
    expect(paths({ spotStrength: 0.9, spotColor: '#ffffff' })).toEqual(['spotStrength', 'spotColor']);
    expect(paths({ fishMix: 'dori:2', spotRig: '0, 1', spotColor: '#ffffff', spotStrength: 0.9 })).toEqual(['spotColor']);
    expect(paths({ followSpot: 0, spotColor: '#ffffff' })).toEqual([]);
    expect(paths({ shoalKind: 'ember', shoalSpeed: 1 })).toEqual(['shoalKind', 'shoalSpeed']);
    expect(paths({ shoal: 0.6, shoalKind: 'ember' })).toEqual([]);
    expect(paths({ shoal: 0.01, shoalKind: 'ember' })).toEqual(['shoalKind']);
    expect(paths({ fishMix: 'dori:24,starfish:1', starfishDance: 'aerobics' })).toEqual(['fishMix', 'starfishDance']);
    expect(paths({ fishMix: 'dori:2', spotRig: '0, 1', followSpot: 1 })).toEqual(['followSpot']);
    expect(paths({ floraMix: 'kelp:3', floraPalette: 'world' })).toEqual(['floraMix', 'floraPalette']);
    expect(paths({ floraDensity: 0.5, floraMix: 'kelp:3' })).toEqual([]);
  });

  it('names the other params each problem is about', () => {
    const [p] = validateMetaquariumParams({ fishMix: 'dori:2', fishCount: 5 });
    expect(p?.also).toEqual(['fishMix']);
  });

  it('the grammar names every DSL and lists the marks', () => {
    for (const word of ['fishMix', 'propMix', 'spotRig', 'spotCues', 'vignette', 'home1', 'gate', 'table']) expect(GRAMMAR).toContain(word);
  });
});
