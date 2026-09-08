import { describe, expect, it } from 'vitest';
import type { ControlTrack, ParamSpace } from '@idle-screens/core';
import { LogicalClock, rateOffset } from './runtime';

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

describe('rateOffset', () => {
  const space: ParamSpace = {
    autoRotate: { type: 'number', default: 0, min: 0, max: 12, ease: 'smooth' },
  };

  it('does not apply a newly steered rate to elapsed history', () => {
    const track: ControlTrack = {
      program: 'test', seed: 1,
      deltas: [{ t: 60_000, path: 'autoRotate', value: 3, dur: 0, ease: 'step' }],
    };
    expect(rateOffset(space, track, 'autoRotate', 60_000, 3, true)).toBe(0);
    expect(rateOffset(space, track, 'autoRotate', 61_000, 3, true)).toBe(3);
  });

  it('keeps the legacy constant-rate result when the path is untracked', () => {
    expect(rateOffset(space, null, 'autoRotate', 60_000, 3, false)).toBe(180);
  });
});
