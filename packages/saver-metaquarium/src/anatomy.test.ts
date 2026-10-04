import { describe, expect, it } from 'vitest';
import { describeMetaquarium, metaquariumParamsFromTrack } from './anatomy';
import { RECIPES } from './guide';
import * as manifest from './manifest';

/** The fishtank channel's "grand tour", as getState returned its track on prod (2026-10-04). */
const GRAND_TOUR: Record<string, unknown> = {
  water: 1, swimWave: 1, eyeLife: 1, fishLighting: 'lit', fishAmbient: 0.6, finish: 0.6, dither: 'on', bubbleStyle: 'live',
  sizeVariance: 0.35, environment: 'lagoon', floorKind: 'shelf', waterClarity: 0.8, waterTint: '#d0f4ff', rayStrength: 0.4,
  caustics: 0.5, surfaceMirror: 0.5, landmark: 'citadel', geodeHomes: 3, paths: 1, pathMaterial: 'pebble', fountain: 'geode',
  streetLamps: 0.8, floraDensity: 0.4, floraMix: 'staghorn, brain, anemone, kelp, elder, pod', horizon: 0.6,
  propMix: 'crystal:1@spire/cyan,crystal:1@druse/hotpink', crystalScale: 0.9,
  fishMix: 'shark:1@patrol*1.1, crab:6@bottom, hackerfish:2@loop, glowfish:2@drift, dori:3@pair, blowfish:2@drift, babyfish:6@school',
  shoal: 1, shoalKind: 'rummynose', shot: 'orbit', cameraDistance: 220, cameraElevation: 18, autoRotate: 0.5,
};

describe('describeMetaquarium', () => {
  it('reads a busy world into cast, sections and a sentence', () => {
    const a = describeMetaquarium(GRAND_TOUR);
    expect(a.cast.map((r) => [r.count, r.label, r.motion, r.slots])).toEqual([
      [1, 'shark', 'patrol', [0, 0]],
      [6, 'crabs', 'floor', [1, 6]],
      [2, 'hackerfish', 'loop', [7, 8]],
      [2, 'glowfish', 'drift', [9, 10]],
      [3, 'tangs', 'pair', [11, 13]],
      [2, 'blowfish', 'drift', [14, 15]],
      [6, 'baby fish', 'school', [16, 21]],
    ]);
    expect(a.cast[0]!.size).toBe(1.1);
    expect(a.castTotal).toBe(22);
    const s = Object.fromEntries(a.sections.map((x) => [x.name, x.items]));
    expect(s.Room).toEqual(['Lagoon', 'shelf floor', 'water overhead', 'water 100%, clarity 80%', 'caustics 50%', 'surface mirror 50%', 'light shafts 40%']);
    expect(s.World).toEqual(expect.arrayContaining(['the citadel', '3 geode homes', 'paths (pebble)', 'geode fountain', '2 crystals: cyan spire, hotpink druse', 'a school of rummynose']));
    expect(s.Camera).toEqual(['distance 220', 'elevation 18°', 'orbits 0.5°/s']);
    expect(s.Look).toEqual(['living eyes', 'finish 60%', 'fish ambient 60%', 'dither']);
    expect(a.summary).toBe('a shark, 6 crabs, 2 hackerfish, 2 glowfish, 3 tangs, 2 blowfish and 6 baby fish in the lagoon, around the citadel; slow orbit.');
    // The room's own colours where the author left them, the author's tint where set.
    expect(a.palette).toEqual(['#0d453f', '#6e4457', '#eafff4', '#d0f4ff']);
    expect(a.problems).toEqual([]);
  });

  it('names the slots a spotlight or the camera follows', () => {
    const a = describeMetaquarium({ fishMix: '100:1,257:1', spotRig: '0/#ff8ad0*26, 1/#7fdcff*26', spotCues: '8s:a, 8s:b, 12s:a+b, 4s:-', vignette: 'duet', cameraFollow: 1 });
    const s = Object.fromEntries(a.sections.map((x) => [x.name, x.items]));
    expect(s.Stage).toEqual(['2 spotlights on slot 0 (betafish), slot 1 (angelfish)', '4 light cues, 32s loop', 'vignette: duet']);
    expect(s.Camera).toEqual(['rides with slot 1 (angelfish)']);
    expect(a.cast.map((r) => r.label)).toEqual(['betafish #100', 'angelfish #257']);
    expect(a.palette).toEqual(expect.arrayContaining(['#ff8ad0', '#7fdcff']));
    expect(a.summary).toBe('a betafish #100 and an angelfish #257 in the void, vignette: duet; following slot 1 (angelfish).');
  });

  it('with no fishMix, the cast is fishCount copies of fishUrl', () => {
    const a = describeMetaquarium({});
    expect(a.cast).toEqual([{ slots: [0, 0], count: 1, visible: 1, breed: 'angelfish', label: 'angelfish #257', motion: 'swims', size: null, offstage: false }]);
    expect(a.sections.map((x) => x.name)).toEqual(['Room', 'Camera']);
    expect(a.summary).toBe('an angelfish #257 in the void; still camera.');
  });

  it('marks fish past the cap and says what is set but idle', () => {
    const a = describeMetaquarium({ fishMix: 'dori:20,blowfish:10', fishCount: 4, shoalKind: 'ember' });
    expect(a.cast.map((r) => r.offstage)).toEqual([false, false]);
    expect(a.cast.map((r) => r.visible)).toEqual([20, 4]);
    expect(a.castTotal).toBe(24);
    expect(a.summary).toMatch(/^20 tangs and 4 blowfish /);
    expect(describeMetaquarium({ fishMix: 'dori:24,octopus:2' }).cast.map((r) => [r.offstage, r.visible])).toEqual([[false, 24], [true, 0]]);
    expect(describeMetaquarium({ fishMix: 'dori:23,octopus:2' }).summary).toMatch(/^23 tangs and an octopus /);
    expect(a.problems.map((p) => p.path)).toEqual(expect.arrayContaining(['fishCount', 'fishMix', 'shoalKind']));
  });

  it('reports the room preset\'s own light shafts, and only a real school', () => {
    expect(describeMetaquarium({ environment: 'lagoon' }).sections[0]?.items).toContain('light shafts 55%');
    expect(describeMetaquarium({ environment: 'lagoon', rayStrength: 0 }).sections[0]?.items).toContain('no light shafts');
    expect(describeMetaquarium({ environment: 'lagoon', rayStrength: 0.2 }).sections[0]?.items).toContain('light shafts 20%');
    const world = (shoal: number) => describeMetaquarium({ shoal }).sections.find((x) => x.name === 'World')?.items ?? [];
    expect(world(0.04)).toEqual([]);
    expect(world(0.05)).toEqual(['a school of neon']);
  });

  it('counts vignette beats split by newline as well as |', () => {
    const stage = (vignette: string) => describeMetaquarium({ vignette }).sections.find((x) => x.name === 'Stage')?.items;
    expect(stage('0s: a\n4s: b')).toEqual(['vignette: 2 beats']);
    expect(stage('0s: a | 4s: b')).toEqual(['vignette: 2 beats']);
  });

  it('reads every recipe without a problem and with a cast', () => {
    for (const r of RECIPES) {
      const a = describeMetaquarium(r.params);
      expect(a.cast.length, r.id).toBeGreaterThan(0);
      expect(a.problems, r.id).toEqual([]);
      expect(a.summary.length, r.id).toBeGreaterThan(20);
    }
    expect(describeMetaquarium(RECIPES.find((r) => r.id === 'starfish-class')!.params).sections.find((s) => s.name === 'Stage')!.items)
      .toEqual(['starfish aerobics at 120 bpm']);
  });
});

describe('metaquariumParamsFromTrack', () => {
  it('folds what is in force at mount and keeps the choreography apart', () => {
    const { params, timed } = metaquariumParamsFromTrack([
      { t: 0, path: 'fishMix', value: 'dori:2' },
      { path: 'environment', value: 'reef' },
      { t: 40_000, path: 'shot', value: 'front' },
      { t: 12_000, path: 'cameraDistance', value: 90 },
      // A live steer: already in force for anyone mounting now, whatever its t.
      { t: 900_000, liveAt: 900_000, path: 'fishMix', value: 'dori:3' },
    ]);
    expect(params).toEqual({ fishMix: 'dori:3', environment: 'reef' });
    expect(timed).toEqual([{ atMs: 12_000, path: 'cameraDistance', value: 90 }, { atMs: 40_000, path: 'shot', value: 'front' }]);
    expect(metaquariumParamsFromTrack(undefined)).toEqual({ params: {}, timed: [] });
  });
});

describe('through ./manifest', () => {
  it('works from the entry clients import (manifest re-exports this module, so nothing may run at load)', () => {
    expect(manifest.describeMetaquarium({ fishMix: 'octopus:1' }).summary).toBe('an octopus in the void; still camera.');
  });
});
