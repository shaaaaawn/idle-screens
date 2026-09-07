import { describe, expect, it } from 'vitest';
import { LogicalClock } from './runtime';

describe('LogicalClock', () => {
  it('continues from the paused media time when wall time advances', () => {
    const clock = new LogicalClock();
    clock.resume();
    expect(clock.sample(1_000)).toBe(0);
    expect(clock.sample(6_000)).toBe(5_000);

    clock.pause();
    clock.resume();
    expect(clock.sample(16_000)).toBe(5_000);
    expect(clock.sample(17_000)).toBe(6_000);
  });

  it('continues from an explicitly rendered frame', () => {
    const clock = new LogicalClock();
    clock.seek(20_000);
    clock.resume();
    expect(clock.sample(50_000)).toBe(20_000);
    expect(clock.sample(51_000)).toBe(21_000);
  });
});
