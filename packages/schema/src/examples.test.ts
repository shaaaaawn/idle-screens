import { describe, it, expect } from 'vitest';
import { validateSpec } from './validate';
import { manifestFor } from './compile';
import { AQUARIUM_SPEC, RAIN_SPEC, EXAMPLE_SPECS, SCHEMA_EXAMPLES } from './examples';

describe('example specs', () => {
  it('all example specs validate', () => {
    for (const spec of EXAMPLE_SPECS) {
      expect(validateSpec(spec), spec.id).toEqual({ valid: true, errors: [] });
    }
  });

  it('the aquarium reproduces fish: two layers (drift+flip, rise) over a gradient+band', () => {
    expect(AQUARIUM_SPEC.layers).toHaveLength(2);
    expect(AQUARIUM_SPEC.layers[0].motion.type).toBe('drift');
    expect(AQUARIUM_SPEC.layers[0].flip).toBe(true);
    expect(AQUARIUM_SPEC.layers[1].motion.type).toBe('rise');
    expect(AQUARIUM_SPEC.background).toMatchObject({ type: 'gradient', band: { height: 24 } });
  });

  it('SCHEMA_EXAMPLES catalog matches EXAMPLE_SPECS', () => {
    expect(SCHEMA_EXAMPLES).toHaveLength(7);
    expect(EXAMPLE_SPECS.map((s) => s.id)).toEqual(SCHEMA_EXAMPLES.map((e) => e.id));
  });

  it('manifestFor derives a canvas2d manifest with a cost tier from entity count', () => {
    const m = manifestFor(AQUARIUM_SPEC); // 14 + 22 = 36 entities -> low
    expect(m).toMatchObject({ id: 'aquarium', minBackend: 'canvas2d', costTier: 'low', motionIntensity: 'calm', workerReady: true });
    expect(m.a11y?.flashSafe).toBe(true);
    expect(manifestFor(RAIN_SPEC).costTier).toBe('low'); // 140 -> low
  });
});
