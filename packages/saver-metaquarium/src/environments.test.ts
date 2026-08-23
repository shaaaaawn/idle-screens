import { describe, it, expect } from 'vitest';
import {
  affordableLayers, ENVIRONMENTS, ENVIRONMENT_NAMES, environmentOf, FLOOR_KINDS,
  LAYER_COST, RAY_COUNT,
} from './environments';
import { METAQUARIUM_PARAMS } from './manifest';
import { qualityFor } from './quality';

describe('environments', () => {
  it('void is a no-op — the pre-environment scene exactly', () => {
    const v = environmentOf('void');
    expect(v.water).toBeNull();
    expect(v.rays).toBeNull();
    expect(v.floor).toBe('flat');
    expect(METAQUARIUM_PARAMS.environment.default).toBe('void');
  });
  it('every preset is reachable from the param enum, and vice versa', () => {
    expect([...(METAQUARIUM_PARAMS.environment.options ?? [])].sort())
      .toEqual([...ENVIRONMENT_NAMES].sort());
    for (const n of ENVIRONMENT_NAMES) expect(environmentOf(n).name).toBe(n);
  });
  it('unknown names fall back to void rather than throwing', () => {
    expect(environmentOf('atlantis').name).toBe('void');
    expect(environmentOf('').name).toBe('void');
  });
  it('presets are internally coherent', () => {
    for (const e of ENVIRONMENTS) {
      if (e.water) {
        // A ceiling must sit ABOVE the fish (they swim to y=72) or it is a wall.
        expect(e.water.y).toBeGreaterThan(72);
        expect(e.water.opacity).toBeGreaterThan(0);
        expect(e.water.opacity).toBeLessThan(1);
        expect(e.water.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
      if (e.rays) {
        expect(e.rays.strength).toBeGreaterThan(0);
        expect(e.rays.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
  it('at least one environment lights from BELOW — the abyssal read', () => {
    expect(ENVIRONMENTS.some((e) => (e.rays?.y ?? 0) < 0)).toBe(true);
  });
});

describe('layer budget', () => {
  it('drops rays before the ceiling as the budget shrinks', () => {
    const reef = environmentOf('reef');   // has BOTH layers
    expect(affordableLayers(3, reef)).toEqual({ floor: true, water: true, rayCount: RAY_COUNT.full });
    expect(affordableLayers(2, reef)).toEqual({ floor: true, water: true, rayCount: RAY_COUNT.reduced });
    expect(affordableLayers(1, reef)).toEqual({ floor: true, water: true, rayCount: 0 });
    expect(affordableLayers(0, reef)).toEqual({ floor: true, water: false, rayCount: 0 });
  });
  it('never invents a layer the preset does not have', () => {
    const abyss = environmentOf('abyss');   // no ceiling
    expect(affordableLayers(99, abyss).water).toBe(false);
    expect(affordableLayers(99, environmentOf('void')))
      .toEqual({ floor: true, water: false, rayCount: 0 });
  });
  it('a rays-only place keeps its glow on the weakest tier', () => {
    // abyss/vent/universe ARE their glow — losing it leaves bare terrain on
    // exactly the devices that most need a recognisable scene.
    for (const name of ['abyss', 'vent', 'universe'] as const) {
      const p = environmentOf(name);
      expect(p.water).toBeNull();
      expect(affordableLayers(qualityFor('basic').envBudget, p).rayCount)
        .toBeGreaterThan(0);
      expect(affordableLayers(qualityFor('high').envBudget, p).rayCount)
        .toBe(RAY_COUNT.full);
    }
  });
  it('every tier can afford the ceiling where one exists', () => {
    const reef = environmentOf('reef');
    expect(affordableLayers(qualityFor('high').envBudget, reef).rayCount).toBe(RAY_COUNT.full);
    expect(affordableLayers(qualityFor('standard').envBudget, reef).water).toBe(true);
    expect(affordableLayers(qualityFor('basic').envBudget, reef).water).toBe(true);
    expect(LAYER_COST.floor).toBe(0);
  });
});

describe('sentinel params cannot pretend to interpolate', () => {
  it('waterY and rayStrength step, because -1 is a sentinel', () => {
    // A smooth ramp from -1 would pass through negatives that read as "auto",
    // so the control would jump instead of glide.
    expect(METAQUARIUM_PARAMS.waterY.ease).toBe('step');
    expect(METAQUARIUM_PARAMS.rayStrength.ease).toBe('step');
  });
});

describe('floor kinds', () => {
  it('the runtime guard matches every kind the presets use', () => {
    for (const e of ENVIRONMENTS) expect(FLOOR_KINDS).toContain(e.floor);
    expect([...(METAQUARIUM_PARAMS.floorKind.options ?? [])].sort())
      .toEqual(['auto', ...FLOOR_KINDS].sort());
  });
});
