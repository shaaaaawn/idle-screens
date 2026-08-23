import { describe, it, expect } from 'vitest';
import {
  bandRange, fishHash, fishVariation, formationSlot, SWIM_STYLES,
  SWIM_STYLE_NAMES, swimStyleOf,
} from './swim';
import { METAQUARIUM_PARAMS } from './manifest';

describe('swim styles', () => {
  it('loop is a no-op — the pre-style behaviour exactly', () => {
    const l = swimStyleOf('loop');
    expect(l).toMatchObject({ speedMul: 1, band: 'free', bobAmp: 0, formation: false, travel: 1 });
    expect(METAQUARIUM_PARAMS.swimStyle.default).toBe('loop');
    // Every param added alongside the styles defaults to the OLD look. A
    // scene already on a wall must not change because a dependency moved.
    expect(METAQUARIUM_PARAMS.swimVariance.default).toBe(0);
    expect(METAQUARIUM_PARAMS.bodyWiggle.default).toBe(0);
  });
  it('the published style list is what we say it is', () => {
    // Spelled out, not derived. The manifest builds its options FROM
    // SWIM_STYLE_NAMES, so comparing the two only proves assignment works.
    // A literal is the only thing here that fails when someone renames a
    // style out from under the scenes already published with it.
    expect([...SWIM_STYLE_NAMES].sort()).toEqual(
      ['bottom', 'drift', 'hover', 'loop', 'patrol', 'school', 'surface'],
    );
    expect([...(METAQUARIUM_PARAMS.swimStyle.options ?? [])].sort())
      .toEqual([...SWIM_STYLE_NAMES].sort());
    for (const n of SWIM_STYLE_NAMES) expect(swimStyleOf(n).name).toBe(n);
  });
  it('variance 0 is a uniform population, not a synchronised one', () => {
    for (const i of [0, 1, 7, 23]) {
      const v = fishVariation(i, 0);
      expect(v.speedMul).toBe(1);
      expect(v.scaleMul).toBe(1);
    }
    // ...but phase and anchor still spread, deliberately: see fishVariation.
    const phases = [0, 1, 2, 3, 4, 5].map((i) => fishVariation(i, 0).phase);
    expect(new Set(phases).size).toBe(phases.length);
    expect(fishVariation(3, 0).anchor).toBe(fishVariation(3, 1).anchor);
  });
  it('a big cast still fits the tank it is swimming in', () => {
    for (const count of [4, 12, 24]) {
      for (let i = 0; i < count; i += 1) {
        const s = formationSlot(i, count, 1);
        expect(Math.abs(s.side)).toBeLessThanOrEqual(60);
      }
    }
  });
  it('unknown styles fall back to loop rather than throwing', () => {
    // The classic steering lane validates nothing, so this WILL be hit.
    expect(swimStyleOf('breakdance').name).toBe('loop');
    expect(swimStyleOf('').name).toBe('loop');
  });
  it('every style is a distinct silhouette of movement', () => {
    const sigs = SWIM_STYLES.map((s) => `${s.speedMul}|${s.band}|${s.bobAmp}|${s.formation}|${s.travel}`);
    expect(new Set(sigs).size).toBe(SWIM_STYLES.length);
  });
  it('hover works a patch of water; patrol tours the tank', () => {
    expect(swimStyleOf('hover').travel).toBeLessThan(0.25);
    expect(swimStyleOf('patrol').travel).toBe(1);
    expect(swimStyleOf('school').formation).toBe(true);
  });
});

describe('per-fish uniqueness', () => {
  it('variance 0 is a uniform shoal — the safe default', () => {
    for (const i of [0, 1, 7, 23]) {
      const v = fishVariation(i, 0);
      expect(v.speedMul).toBe(1);
      expect(v.scaleMul).toBe(1);
    }
    expect(METAQUARIUM_PARAMS.swimVariance.default).toBe(0);
  });
  it('variance 1 spreads fish without producing a broken one', () => {
    for (let i = 0; i < 24; i++) {
      const v = fishVariation(i, 1);
      expect(v.speedMul).toBeGreaterThan(0.55);
      expect(v.speedMul).toBeLessThan(1.45);
      expect(v.scaleMul).toBeGreaterThan(0.7);
      expect(v.scaleMul).toBeLessThan(1.3);
    }
  });
  it('a fish varies by INDEX, not by spawn order or rebuild count', () => {
    // Recoverable from the index alone — the whole reason this is a hash and
    // not an rng draw.
    expect(fishVariation(5, 1)).toEqual(fishVariation(5, 1));
    expect(fishVariation(5, 1).speedMul).not.toBe(fishVariation(6, 1).speedMul);
    expect(fishHash(3, 1)).toBeGreaterThanOrEqual(0);
    expect(fishHash(3, 1)).toBeLessThan(1);
  });
  it('out-of-range variance is clamped, not trusted', () => {
    expect(fishVariation(2, 99).speedMul).toEqual(fishVariation(2, 1).speedMul);
    expect(fishVariation(2, -5).speedMul).toBe(1);
  });
});

describe('formation', () => {
  it('never places two fish in the same slot', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const s = formationSlot(i, 24, 0.5);
      seen.add(`${s.side.toFixed(3)}|${s.up.toFixed(3)}|${s.back.toFixed(3)}`);
    }
    expect(seen.size).toBe(24);
  });
  it('always terminates and stays finite — a lattice, not rejection sampling', () => {
    for (const count of [1, 2, 7, 24]) {
      for (let i = 0; i < count; i++) {
        const s = formationSlot(i, count, 1);
        expect(Number.isFinite(s.side)).toBe(true);
        expect(Number.isFinite(s.up)).toBe(true);
        expect(s.back).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('depth bands', () => {
  it('free means unclamped; the others are ordered and disjoint enough to read', () => {
    expect(bandRange('free')).toBeNull();
    expect(bandRange('floor')!.hi).toBeLessThanOrEqual(bandRange('mid')!.lo);
    expect(bandRange('mid')!.hi).toBeLessThanOrEqual(bandRange('ceiling')!.lo);
  });
});

describe('station-keeping styles must not knot up', () => {
  it('every fish anchors at a different point on its route', () => {
    // hover/drift traverse a fraction of the loop, so without a per-fish
    // anchor they all sit at distance 0 and pile into one corner — the exact
    // failure the first on-screen check caught.
    const anchors = new Set<string>();
    for (let i = 0; i < 24; i++) anchors.add(fishVariation(i, 0).anchor.toFixed(4));
    expect(anchors.size).toBe(24);
  });
  it('anchors spread across the whole loop, not just the start', () => {
    const xs = Array.from({ length: 24 }, (_, i) => fishVariation(i, 0).anchor);
    expect(Math.min(...xs)).toBeLessThan(0.25);
    expect(Math.max(...xs)).toBeGreaterThan(0.75);
    for (const a of xs) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });
  it('anchoring does not depend on variance — spreading is correctness', () => {
    expect(fishVariation(9, 0).anchor).toBe(fishVariation(9, 1).anchor);
  });
});
