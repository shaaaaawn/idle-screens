import { describe, expect, it } from 'vitest';
import { SCALAR_BOUND, scalarWanted } from './validate-hints';

describe('scalar-bound messages', () => {
  it('reads the messages a one-number field gives', () => {
    for (const m of ['must be 0..1', 'must be 0.5..1.5 (seconds)', 'must be -1..1', 'must be > 0', 'must be a number', 'must be between -3 and 3']) expect(scalarWanted(m)).toBe(true);
    for (const m of ['must be a [min,max] range', 'must be 1..', 'must be 0..1x']) expect(SCALAR_BOUND.test(m)).toBe(false);
  });

  it('stays linear on a long run of dots (CodeQL js/polynomial-redos)', () => {
    const evil = `must be 0${'.'.repeat(50_000)}x`;
    const t = performance.now();
    expect(SCALAR_BOUND.test(evil)).toBe(false);
    expect(performance.now() - t).toBeLessThan(50);
  });
});
