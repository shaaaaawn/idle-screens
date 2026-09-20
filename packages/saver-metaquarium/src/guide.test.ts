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
    expect(validateMetaquariumParams({ vignette: '4s: a =home1, b =home2 | 6s: a >centre, b >centre | 6s: a >home1, b >home2', geodeHomes: 2 })).toEqual([]);
    expect(validateMetaquariumParams({ vignette: 'a >gate', landmark: 'castle' }).filter((b) => /no mark/.test(b.message))).toEqual([]);
  });

  it('the grammar names every DSL and lists the marks', () => {
    for (const word of ['fishMix', 'propMix', 'spotRig', 'spotCues', 'vignette', 'home1', 'gate', 'table']) expect(GRAMMAR).toContain(word);
  });
});
