/**
 * A tiny, fast, seedable PRNG (splitmix32). Deterministic: the same seed always
 * yields the same sequence, on any machine. This is what makes "same program +
 * seed + control-track = identical frames" hold. Savers take an `Rng` from their
 * `SaverContext` instead of calling `Math.random()`.
 */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Random element of a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** A fresh independent stream (e.g. per subsystem), derived from this seed. */
  fork(salt: number): Rng;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)] as (typeof arr)[number],
    fork: (salt) => createRng((seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0),
  };
  return rng;
}
