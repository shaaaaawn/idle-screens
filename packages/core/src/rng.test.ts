import { describe, it, expect } from 'vitest';
import { createRng } from './rng';

const seq = (seed: number, n = 20): number[] => {
  const r = createRng(seed);
  return Array.from({ length: n }, () => r.next());
};

describe('createRng (R1-R8)', () => {
  it('R1: same seed yields an identical sequence across constructions', () => {
    expect(seq(12345)).toEqual(seq(12345));
    expect(seq(0)).toEqual(seq(0));
  });

  it('R2: different seeds diverge', () => {
    expect(seq(1)).not.toEqual(seq(2));
    expect(seq(999)).not.toEqual(seq(1000));
  });

  it('R3: next() is in [0, 1)', () => {
    const r = createRng(42);
    for (let i = 0; i < 5000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('R4: range(min,max) stays within [min, max)', () => {
    const r = createRng(7);
    for (let i = 0; i < 5000; i++) {
      const v = r.range(-3, 9);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(9);
    }
  });

  it('R5: int(min,max) is inclusive and reaches both endpoints', () => {
    const r = createRng(123);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = r.int(1, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.has(1)).toBe(true);
    expect(seen.has(6)).toBe(true);
    expect(seen.size).toBe(6);
  });

  it('R6: pick returns an array element and is deterministic per seed', () => {
    const arr = ['a', 'b', 'c', 'd'] as const;
    const a = createRng(5);
    const b = createRng(5);
    for (let i = 0; i < 50; i++) {
      const x = a.pick(arr);
      expect(arr).toContain(x);
      expect(x).toBe(b.pick(arr));
    }
  });

  it('R7: fork is deterministic and independent of parent + other salts', () => {
    const f1a = createRng(100).fork(1);
    const f1b = createRng(100).fork(1);
    expect(Array.from({ length: 10 }, () => f1a.next())).toEqual(
      Array.from({ length: 10 }, () => f1b.next()),
    );

    const parent = createRng(100);
    const parentSeq = Array.from({ length: 10 }, () => parent.next());
    const fork = createRng(100).fork(1);
    const forkSeq = Array.from({ length: 10 }, () => fork.next());
    expect(forkSeq).not.toEqual(parentSeq);

    const s1 = Array.from({ length: 10 }, () => createRng(100).fork(1).next());
    const s2 = Array.from({ length: 10 }, () => createRng(100).fork(2).next());
    expect(s1).not.toEqual(s2);
  });

  it('R8: seeds are coerced to uint32 (seed and seed + 2^32 match)', () => {
    expect(seq(13)).toEqual(seq(13 + 2 ** 32));
    // negative seed folds into uint32 too
    expect(seq(-1)).toEqual(seq(0xffffffff));
  });
});
