import { describe, expect, it } from 'vitest';
import {
  buildLofiField,
  LOFI_CAST_IDS,
  css,
  lofiBreedOf,
  lofiCast,
  lofiFishPose,
  lofiPaletteOf,
  lofiRich,
  mulberry32,
} from './lofi';

describe('lofi tank — parity with the Apple TV aquarium', () => {
  it('mulberry32 matches the Swift generator bit for bit', () => {
    // Vectors printed by apps/ios Mulberry32 (SpecSubset.swift). If these
    // move, the browser lays out a different tank than the TV for one seed.
    const r = mulberry32(42);
    expect([r(), r(), r()]).toEqual(SWIFT_SEED_42);
    const big = mulberry32(3_000_000_000);
    expect([big(), big(), big()]).toEqual(SWIFT_SEED_3E9);
  });

  it('reads breeds by the minted token ranges', () => {
    expect(lofiBreedOf(1)).toBe('beta');
    expect(lofiBreedOf(256)).toBe('beta');
    expect(lofiBreedOf(257)).toBe('angel');
    expect(lofiBreedOf(457)).toBe('seahorse');
    expect(lofiBreedOf(497)).toBe('turtle');
  });

  it('is a pure function of its inputs', () => {
    expect(buildLofiField(7, true, 'reef')).toEqual(buildLofiField(7, true, 'reef'));
    expect(buildLofiField(7, true)).not.toEqual(buildLofiField(8, true));
  });

  it('sizes the tank by tier like t3/t2', () => {
    expect(lofiRich('high')).toBe(true);
    expect(lofiRich('standard')).toBe(false);
    const rich = buildLofiField(1, true);
    const lean = buildLofiField(1, false);
    expect([rich.fish.length, rich.kelp.length, rich.bubbles.length]).toEqual([13, 5, 3]);
    expect([lean.fish.length, lean.kelp.length, lean.bubbles.length]).toEqual([8, 3, 2]);
  });

  it('draws far to near, with depth stratified into thirds', () => {
    const { fish } = buildLofiField(99, true);
    for (let i = 1; i < fish.length; i++) expect(fish[i]!.depth).toBeGreaterThanOrEqual(fish[i - 1]!.depth);
    const thirds = [0, 1, 2].map((k) => fish.filter((f) => f.depth >= k / 3 && f.depth < (k + 1) / 3).length);
    expect(thirds.every((n) => n >= 4)).toBe(true);
  });

  it('casts from the TV bundle without a mix, and from the mix when given', () => {
    for (const f of buildLofiField(5, true).fish) expect(LOFI_CAST_IDS).toContain(f.id);
    const mixed = buildLofiField(5, false, undefined, '497:1');
    expect(mixed.fish.map((f) => f.id)).toEqual(Array(8).fill(497));
    expect(mixed.fish.every((f) => f.breed === 'turtle')).toBe(true);
  });

  it('parses fishMix with the engine DSL and drops icon-less ids', () => {
    expect(lofiCast('', 8)).toBeNull();
    expect(lofiCast('nonsense', 8)).toBeNull();
    const cast = lofiCast('300:3,seahorse:2', 13)!;
    expect(cast).toHaveLength(5);
    expect(new Set(cast).size).toBe(5); // minted fish are individuals
    expect(cast.slice(3).every((id) => lofiBreedOf(id) === 'seahorse')).toBe(true);
  });

  it('palettes follow the environment and fall back to the base room', () => {
    expect(lofiPaletteOf('vent')).not.toEqual(lofiPaletteOf('void'));
    expect(lofiPaletteOf('nowhere')).toEqual(lofiPaletteOf(undefined));
  });

  it('never resolves an inherited Object.prototype key as a palette', () => {
    // A scene's `environment` is untrusted string input; PALETTES is a plain
    // object literal, so a lookup must not fall through to `constructor` et al.
    expect(lofiPaletteOf('constructor')).toEqual(lofiPaletteOf(undefined));
    expect(lofiPaletteOf('toString')).toEqual(lofiPaletteOf(undefined));
    expect(lofiPaletteOf('hasOwnProperty')).toEqual(lofiPaletteOf(undefined));
  });

  it('writes palette colours as css rgba', () => {
    expect(css({ r: 1, g: 0.5, b: 0 })).toBe('rgba(255,128,0,1)');
    expect(css({ r: 0, g: 0, b: 0 }, 0.25)).toBe('rgba(0,0,0,0.25)');
  });

  it('sways seahorses more than angelfish, and mirrors both when swimming left', () => {
    const base = buildLofiField(4, false).fish[0]!;
    const sway = (breed: 'seahorse' | 'angel') =>
      Math.max(...Array.from({ length: 400 }, (_, i) => Math.abs(lofiFishPose({ ...base, breed }, i * 25, 800, 600).rotation)));
    expect(sway('seahorse')).toBeGreaterThan(0.1);
    expect(sway('seahorse')).toBeLessThanOrEqual(0.14);
    expect(sway('angel')).toBeGreaterThan(0.03);
    expect(sway('angel')).toBeLessThanOrEqual(0.05);
    expect(lofiFishPose({ ...base, breed: 'seahorse', dir: -1 }, 0, 800, 600).mirror).toBe(true);
    expect(lofiFishPose({ ...base, breed: 'angel', dir: -1 }, 0, 800, 600).mirror).toBe(true);
  });

  it('poses turtles head-first and never mirrors them', () => {
    const [f] = buildLofiField(3, false, undefined, '497:1').fish;
    const right = lofiFishPose({ ...f!, dir: 1 }, 1234, 1920, 1080);
    const left = lofiFishPose({ ...f!, dir: -1 }, 1234, 1920, 1080);
    expect(right.mirror).toBe(false);
    expect(left.mirror).toBe(false);
    expect(Math.abs(right.rotation - Math.PI / 2)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(left.rotation + Math.PI / 2)).toBeLessThanOrEqual(0.1);
  });

  it('wraps fish across the tank with complete entries and exits', () => {
    const f = { ...buildLofiField(11, false).fish[0]!, breed: 'beta' as const, dir: 1 };
    const w = 1000;
    const xs = Array.from({ length: 200 }, (_, i) => lofiFishPose(f, (i / 200) * f.period, w, 600).x);
    expect(Math.min(...xs)).toBeLessThan(-0.1 * w);
    expect(Math.max(...xs)).toBeGreaterThan(1.1 * w);
    const lefty = lofiFishPose({ ...f, dir: -1 }, 500, w, 600);
    expect(lefty.mirror).toBe(true);
  });
});

const SWIFT_SEED_42 = [0.6011037519201636, 0.44829055899754167, 0.8524657934904099];
const SWIFT_SEED_3E9 = [0.7568875285796821, 0.3733226382173598, 0.9749945921357721];
