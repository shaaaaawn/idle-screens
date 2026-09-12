import { describe, it, expect } from 'vitest';
import { validateSpec, validateSequence } from './validate';
import { manifestFor } from './compile';
import { structuralSignature } from './steer';
import { AQUARIUM_SPEC, RAIN_SPEC, EXAMPLE_SPECS, SCHEMA_EXAMPLES, EXAMPLE_SEQUENCES } from './examples';

describe('example specs', () => {
  it('all example specs validate', () => {
    for (const spec of EXAMPLE_SPECS) {
      expect(validateSpec(spec), spec.id).toEqual({ valid: true, errors: [], warnings: [] });
    }
  });

  it('the aquarium reproduces fish: two layers (drift+flip, rise) over a gradient+band', () => {
    expect(AQUARIUM_SPEC.layers).toHaveLength(2);
    expect(AQUARIUM_SPEC.layers[0].motion.type).toBe('drift');
    expect(AQUARIUM_SPEC.layers[0].flip).toBe(true);
    expect(AQUARIUM_SPEC.layers[1].motion.type).toBe('rise');
    expect(AQUARIUM_SPEC.background).toMatchObject({ type: 'gradient', band: { height: 0.02222 } });
  });

  it('SCHEMA_EXAMPLES catalog matches EXAMPLE_SPECS', () => {
    expect(SCHEMA_EXAMPLES).toHaveLength(28);
    expect(EXAMPLE_SPECS.map((s) => s.id)).toEqual(SCHEMA_EXAMPLES.map((e) => e.id));
  });

  it('every example sequence validates with no warnings', () => {
    for (const e of EXAMPLE_SEQUENCES) {
      const v = validateSequence(e.sequence);
      expect(v.errors, `${e.id} errors`).toEqual([]);
      expect(v.warnings ?? [], `${e.id} warnings`).toEqual([]);
    }
  });

  it('three-movements morph pair is structurally identical, so the morph is real', () => {
    // The example's teaching claim: segments 1 → 2 differ only in paint (colour
    // + words), which is what lets the transition MORPH and crossfade the
    // caption. If a future edit makes them structurally different the morph
    // silently degrades to a cut, so pin the property rather than the prose.
    const seq = EXAMPLE_SEQUENCES.find((e) => e.id === 'three-movements')!.sequence;
    const [first, second] = seq.segments;
    expect(second.transition?.type).toBe('fade');
    expect(first.transition).toMatchObject({ type: 'morph', text: 'crossfade' });
    expect(structuralSignature(second.scene)).toBe(structuralSignature(first.scene));
    // …and the paint really does differ, or the morph would have nothing to do.
    expect(second.scene.layers[0]!.sprite).not.toEqual(first.scene.layers[0]!.sprite);
  });

  it('the dense example stays above the dense-scene threshold it declares', () => {
    // `density: 'dense'` is only meaningful past 500 entities — below it the
    // declaration is describing nothing. The example exists to show the
    // withholding, so the count is part of the contract.
    const murmur = SCHEMA_EXAMPLES.find((e) => e.id === 'murmur')!.spec;
    const total = murmur.layers.reduce((n, l) => n + l.count, 0);
    expect(murmur.density).toBe('dense');
    expect(total).toBeGreaterThan(500);
  });

  it('manifestFor derives a canvas2d manifest with a cost tier from entity count', () => {
    const m = manifestFor(AQUARIUM_SPEC); // 14 + 22 = 36 entities -> low
    expect(m).toMatchObject({ id: 'aquarium', minBackend: 'canvas2d', costTier: 'low', motionIntensity: 'calm', workerReady: true });
    expect(m.a11y?.flashSafe).toBe(true);
    expect(manifestFor(RAIN_SPEC).costTier).toBe('low'); // 140 -> low
  });
});
