import { describe, it, expect } from 'vitest';
import { analyzePerf } from './perf';

const rep = (times: number[], opts = {}) => analyzePerf(times, opts);

describe('analyzePerf', () => {
  it('empty input is a safe zero report', () => {
    const r = rep([]);
    expect(r.frames).toBe(0);
    expect(r.withinBudget).toBe(true);
    expect(r.costTier).toBe('idle');
  });

  it('computes median/p95/fps and a cost tier', () => {
    const r = rep(new Array(100).fill(5));
    expect(r.medianMs).toBe(5);
    expect(r.fps).toBeCloseTo(200, 0);
    expect(r.costTier).toBe('low');
    expect(r.pathological).toBe(false);
    expect(r.withinBudget).toBe(true);
  });

  it('classifies tiers by median frame cost', () => {
    expect(rep(new Array(50).fill(1)).costTier).toBe('idle');
    expect(rep(new Array(50).fill(6)).costTier).toBe('low');
    expect(rep(new Array(50).fill(12)).costTier).toBe('medium');
    expect(rep(new Array(50).fill(30)).costTier).toBe('high');
  });

  it('a single spike does NOT fail the budget (report maxMs, not gate on it)', () => {
    const times = new Array(100).fill(5);
    times[42] = 250; // one bad frame
    const r = rep(times);
    expect(r.maxMs).toBe(250);
    expect(r.p95Ms).toBe(5); // p95 unaffected by a lone spike
    expect(r.pathological).toBe(false);
    expect(r.withinBudget).toBe(true);
  });

  it('sustained pathological frame cost fails the budget', () => {
    const r = rep(new Array(60).fill(150));
    expect(r.pathological).toBe(true);
    expect(r.withinBudget).toBe(false);
    expect(r.costTier).toBe('high');
  });

  it('jankRatio is the fraction of frames over the jank threshold', () => {
    const times = [5, 5, 5, 5, 5, 5, 5, 5, 20, 20]; // 2/10 over 16.7ms
    expect(rep(times).jankRatio).toBeCloseTo(0.2, 5);
  });
});
