import { describe, it, expect } from 'vitest';
import {
  anchorFraction, AUTO_STYLE_BY_BREED, autoStyleFor, bandRange, FISH_LENGTH, fishHash, fishVariation, FORMATION_SHAPES, formationBreathe, formationExtent, formationSlot, idleSway,
  SWIM_STYLES, SWIM_STYLE_NAMES, swimStyleOf, fitBreath,
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
      ['bottom', 'chase', 'drift', 'follow', 'hover', 'loop', 'pair', 'patrol', 'school', 'surface'],
    );
    // `auto` is a manifest option, not a style: it resolves per fish.
    expect([...(METAQUARIUM_PARAMS.swimStyle.options ?? [])].sort())
      .toEqual([...SWIM_STYLE_NAMES, 'auto'].sort());
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
  it('every formation shape seats every cast with clear water between all pairs', () => {
    // The one law every seating chart obeys, whatever its geometry.
    for (const shape of FORMATION_SHAPES) {
      for (const count of [2, 8, 16, 24]) {
        for (const variance of [0, 1]) {
          const slots = Array.from({ length: count }, (_, i) =>
            formationSlot(i, count, variance, undefined, shape));
          for (let i = 0; i < count; i += 1) {
            for (let k = i + 1; k < count; k += 1) {
              const a = slots[i]!; const b = slots[k]!;
              const gap = Math.hypot(a.side - b.side, a.up - b.up, a.back - b.back);
              expect(gap, `${shape} ${count} v${variance} pair ${i},${k}`)
                .toBeGreaterThanOrEqual(FISH_LENGTH);
            }
          }
        }
      }
    }
  });
  it('every shape at every cast still FITS the tank', () => {
    // The finding that forced line/wedge to wrap: a 24-fish single file at
    // 1.7 body lengths is a 700-unit procession in a 120-radius tank. The
    // carrier clamp needs headroom left over, so the seating chart's planar
    // reach must stay well inside the glass.
    for (const shape of FORMATION_SHAPES) {
      for (const count of [8, 16, 24]) {
        let reach = 0;
        let up = 0;
        for (let i = 0; i < count; i += 1) {
          const s2 = formationSlot(i, count, 1, undefined, shape);
          reach = Math.max(reach, Math.hypot(s2.side, s2.back));
          up = Math.max(up, Math.abs(s2.up));
        }
        expect(reach, `${shape} ${count}`).toBeLessThan(115);
        expect(up, `${shape} ${count} up`).toBeLessThan(29); // fits the water column
      }
    }
  });
  it('the extent bounds every slot for every shape', () => {
    for (const shape of FORMATION_SHAPES) {
      const ext = formationExtent(16, 0.8, shape);
      for (let i = 0; i < 16; i += 1) {
        const s2 = formationSlot(i, 16, 0.8, undefined, shape);
        expect(Math.abs(s2.side)).toBeLessThanOrEqual(ext.side);
        expect(Math.abs(s2.up)).toBeLessThanOrEqual(ext.up);
        expect(Math.abs(s2.back)).toBeLessThanOrEqual(ext.back);
      }
    }
  });
  it('shapes are visibly different seating charts', () => {
    const sig = (shape: (typeof FORMATION_SHAPES)[number]) =>
      Array.from({ length: 6 }, (_, i) => formationSlot(i, 6, 0, undefined, shape))
        .map((s2) => `${Math.round(s2.side)},${Math.round(s2.up)},${Math.round(s2.back)}`).join('|');
    expect(new Set(FORMATION_SHAPES.map(sig)).size).toBe(FORMATION_SHAPES.length);
  });
  it('no two fish in a formation are inside one body length', () => {
    // The enforceable version of "a school does not collide". A review
    // measured 36% of fish-frames with a neighbour inside a body length when
    // the lattice pitch was a bare number; this is the guard that stops that
    // regressing, and it is the claim the changeset is allowed to make.
    for (const count of [2, 4, 8, 12, 18, 24]) {
      for (const variance of [0, 0.3, 0.6, 1]) {
        const slots = Array.from({ length: count }, (_, i) => formationSlot(i, count, variance));
        for (let i = 0; i < count; i += 1) {
          for (let k = i + 1; k < count; k += 1) {
            const a = slots[i]!; const b = slots[k]!;
            const gap = Math.hypot(a.side - b.side, a.up - b.up, a.back - b.back);
            expect(gap).toBeGreaterThanOrEqual(FISH_LENGTH);
          }
        }
      }
    }
  });
  it('the formation extent bounds every slot it describes', () => {
    // The tank keeps the shoal in the glass by moving its CENTRE inward by
    // this much. If the extent under-reports, fish go through the wall; if it
    // over-reports, the shoal never reaches the outside of the tank.
    for (const count of [1, 8, 24]) {
      for (const variance of [0, 0.6, 1]) {
        const ext = formationExtent(count, variance);
        for (let i = 0; i < count; i += 1) {
          const s = formationSlot(i, count, variance);
          expect(Math.abs(s.side)).toBeLessThanOrEqual(ext.side);
          expect(Math.abs(s.up)).toBeLessThanOrEqual(ext.up);
          expect(Math.abs(s.back)).toBeLessThanOrEqual(ext.back);
        }
      }
    }
    // Wider cast, wider shoal — the extent has to track the count.
    expect(formationExtent(24, 0.6).side).toBeGreaterThan(formationExtent(4, 0.6).side);
  });
  it('a big cast still fits inside the tank radius', () => {
    for (const count of [4, 12, 24]) {
      for (let i = 0; i < count; i += 1) {
        // The tank clamps to radius 120; the lattice must not need most of it.
        expect(Math.abs(formationSlot(i, count, 1).side)).toBeLessThanOrEqual(80);
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

describe('relationships, auto styles, breathing, sway', () => {
  it('bonded styles declare their bond; every older style is unbonded', () => {
    expect(swimStyleOf('follow').bond).toBe('follow');
    expect(swimStyleOf('pair').bond).toBe('pair');
    expect(swimStyleOf('chase').bond).toBe('chase');
    for (const n of ['loop', 'school', 'drift', 'hover', 'patrol', 'bottom', 'surface']) {
      expect(swimStyleOf(n).bond ?? 'none').toBe('none');
      // Exactly one older style forms; a style that silently became a
      // formation (or school stopped being one) must fail here.
      expect(swimStyleOf(n).formation).toBe(n === 'school');
    }
  });
  it('fitBreath caps a breath that would push seats out of the glass', () => {
    const bounds = { yRange: 57, radius: 120 };
    // A ring's vertical reach is capped at 24: ×1.22 = 29.3 > 28.5 half-column.
    const fit = fitBreath({ up: 24, reach: 50 }, 1.22, bounds, 0);
    expect(fit).toBeCloseTo(28.5 / 24, 5);
    expect(24 * fit).toBeLessThanOrEqual(bounds.yRange / 2);
    // A shoal that fits breathes the full amount.
    expect(fitBreath({ up: 10, reach: 30 }, 1.22, bounds, 0)).toBe(1.22);
    // Never below 1: a shoal already at the limit holds, it does not shrink.
    expect(fitBreath({ up: 40, reach: 30 }, 1.22, bounds, 0)).toBe(1);
  });
  it('auto covers every minted breed and every NPC breed, and loops for strangers', () => {
    for (const b of ['betafish', 'angelfish', 'seahorse', 'seaturtle',
      'blowfish', 'hackerfish', 'glowfish', 'babyfish', 'shark', 'crab', 'jellyfish', 'dori']) {
      expect(AUTO_STYLE_BY_BREED[b]).toBeDefined();
      expect(swimStyleOf(AUTO_STYLE_BY_BREED[b]!).name).toBe(AUTO_STYLE_BY_BREED[b]);
    }
    expect(autoStyleFor('seahorse').name).toBe('hover');
    expect(autoStyleFor('SeaTurtle').name).toBe('surface');
    expect(autoStyleFor('reef@night').name).toBe('loop');
    expect(autoStyleFor(undefined).name).toBe('loop');
  });
  it('breathing only ever expands, and 0 is exactly 1', () => {
    for (let t = 0; t < 60; t += 0.37) {
      expect(formationBreathe(t, 0)).toBe(1);
      expect(formationBreathe(t, 1)).toBeGreaterThanOrEqual(1);
      expect(formationBreathe(t, 1)).toBeLessThanOrEqual(1.22 + 1e-9);
      expect(formationBreathe(t, 2)).toBe(formationBreathe(t, 1));
    }
  });
  it('idle sway belongs to station-keepers only', () => {
    for (const n of ['loop', 'school', 'patrol', 'bottom', 'surface', 'follow']) {
      expect(idleSway(swimStyleOf(n), 3.3, 1)).toBe(0);
    }
    const hover = Array.from({ length: 50 }, (_, i) => idleSway(swimStyleOf('hover'), i * 0.3, 0));
    expect(Math.max(...hover.map(Math.abs))).toBeGreaterThan(0.3);
    expect(Math.max(...hover.map(Math.abs))).toBeLessThan(0.5);
    expect(Math.abs(idleSway(swimStyleOf('drift'), 3.49, 0))).toBeLessThan(0.25);
  });
  it('the wheel is the ring tilted; the ring itself stays flat for published scenes', () => {
    const ups = Array.from({ length: 8 }, (_, i) => formationSlot(i, 8, 0, undefined, 'wheel').up);
    expect(Math.max(...ups) - Math.min(...ups)).toBeGreaterThan(FISH_LENGTH);
    expect(Math.max(...ups.map(Math.abs))).toBeLessThanOrEqual(28);
    const ringUps = Array.from({ length: 8 }, (_, i) => formationSlot(i, 8, 0, undefined, 'ring').up);
    expect(Math.max(...ringUps.map(Math.abs))).toBeLessThanOrEqual(FISH_LENGTH * 0.3);
    for (let i = 0; i < 8; i++) {
      const a = formationSlot(i, 8, 0.4, undefined, 'ring');
      const b = formationSlot(i, 8, 0.4, undefined, 'wheel');
      expect(a.side).toBe(b.side);
      expect(a.back).toBe(b.back);
    }
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
        // Seating charts centre fore-aft, so back is signed now.
        expect(Number.isFinite(s.back)).toBe(true);
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

describe('anchorFraction — the rule the tank actually applies', () => {
  // The tests above prove the HASH spreads. They passed while the tank was
  // still knotting patrol/bottom/surface into one clump at mount, because the
  // bug was in the tank's USE of the hash: the offset applied only when
  // `travel < 1`. These assert the rule itself, which is what the tank calls.
  const CAST = 24;
  const spread = (name: string, variance: number): number[] =>
    Array.from({ length: CAST }, (_, i) => anchorFraction(swimStyleOf(name), i, variance));

  it('loop is anchorless — its no-op promise reaches frame 0', () => {
    expect(spread('loop', 0.6).every((a) => a === 0)).toBe(true);
  });

  it('EVERY other style spreads, full-travel ones included', () => {
    // The regression gate. patrol/bottom/surface/school all carry travel = 1,
    // so a `travel < 1` condition silently exempts them — and they are exactly
    // the styles that were seen knotting on a live channel.
    for (const name of SWIM_STYLE_NAMES) {
      if (name === 'loop') continue;
      const xs = spread(name, 0.6);
      expect(new Set(xs.map((a) => a.toFixed(4))).size, name).toBe(CAST);
      // Reaching both ends means the cast starts strung round the whole
      // route, not bunched near the spline's azimuth-0 origin.
      expect(Math.min(...xs), name).toBeLessThan(0.25);
      expect(Math.max(...xs), name).toBeGreaterThan(0.75);
      // No quarter of the route left empty — a cast can hit both extremes and
      // still be two clumps.
      const quarters = new Set(xs.map((a) => Math.floor(a * 4)));
      expect(quarters.size, name).toBe(4);
    }
  });

  it('at least one full-travel style exists to be gated', () => {
    // Guards the gate above against becoming vacuous if the catalogue's
    // travel values are ever retuned.
    const full = SWIM_STYLES.filter((s) => s.travel === 1 && s.name !== 'loop');
    expect(full.length).toBeGreaterThan(0);
  });

  it('spreads at variance 0 too — it is correctness, not flavour', () => {
    expect(new Set(spread('patrol', 0).map((a) => a.toFixed(4))).size).toBe(CAST);
    expect(spread('patrol', 0)).toEqual(spread('patrol', 1));
  });
});
