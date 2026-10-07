import { describe, expect, it, vi } from 'vitest';
import { attachFrameWatchdog, createFrameWatchdog } from './frame-watchdog';

/** Feed `count` frames each `deltaMs` apart, continuing from `start`. */
function feed(
  wd: ReturnType<typeof createFrameWatchdog>,
  count: number,
  deltaMs: number,
  start = 0,
): number {
  let t = start;
  for (let i = 0; i < count; i++) {
    t += deltaMs;
    wd.frame(t);
  }
  return t;
}

const opts = { window: 10, graceFrames: 0, budgetMs: 16.7, overrunRatio: 0.5 };

describe('createFrameWatchdog', () => {
  it('stays at full while frames meet the budget', () => {
    const wd = createFrameWatchdog(opts);
    feed(wd, 200, 16);
    expect(wd.level()).toBe('full');
  });

  it('steps down after a sustained overrun', () => {
    const levels: string[] = [];
    const wd = createFrameWatchdog({ ...opts, onLevel: (l) => levels.push(l) });
    feed(wd, 11, 50); // 50ms frames = 20fps
    expect(wd.level()).toBe('reduced');
    expect(levels).toEqual(['reduced']);
  });

  it('walks full → reduced → cheapest and then stops', () => {
    const wd = createFrameWatchdog(opts);
    let t = feed(wd, 11, 50);
    expect(wd.level()).toBe('reduced');
    t = feed(wd, 11, 50, t);
    expect(wd.level()).toBe('cheapest');
    feed(wd, 200, 50, t);
    expect(wd.level()).toBe('cheapest'); // floor, never below
  });

  it('does not step down on a single slow frame', () => {
    const wd = createFrameWatchdog(opts);
    let t = feed(wd, 9, 16);
    t += 400;
    wd.frame(t); // one GC-sized spike
    feed(wd, 20, 16, t);
    expect(wd.level()).toBe('full');
  });

  it('ignores the huge gap from a backgrounded tab or blanked display', () => {
    // rAF stops entirely while hidden; the resume delta is not a slow frame.
    const wd = createFrameWatchdog(opts);
    let t = feed(wd, 5, 16);
    t += 30_000; // 30s hidden
    wd.frame(t);
    feed(wd, 20, 16, t);
    expect(wd.level()).toBe('full');
  });

  it('counts a genuinely terrible frame instead of mistaking it for a tab switch', () => {
    // Regression: the gap cutoff used to scale with the budget (667ms at 30fps),
    // so a scene limping along at ~2fps had its frames discarded as if the tab
    // were hidden — throwing away precisely what this is meant to catch.
    const wd = createFrameWatchdog({ ...opts, budgetMs: 1000 / 30 });
    feed(wd, 11, 700); // ~1.4fps: awful, and well under the 2s hidden-tab cutoff
    expect(wd.level()).toBe('reduced');
  });

  it('honours the grace period after a mount', () => {
    const wd = createFrameWatchdog({ ...opts, graceFrames: 15 });
    feed(wd, 15, 50); // all inside grace
    expect(wd.level()).toBe('full');
    feed(wd, 12, 50, 15 * 50);
    expect(wd.level()).toBe('reduced');
  });

  it('reset() re-arms grace, so a fresh mount is not judged on the old scene', () => {
    const wd = createFrameWatchdog({ ...opts, graceFrames: 5 });
    const t = feed(wd, 6, 16);
    wd.reset();
    // 11 slow timestamps = 10 deltas: 5 swallowed by grace leaves 5 judged,
    // under the 10-frame window. Without re-armed grace all 10 would be judged
    // and the watchdog would step down.
    feed(wd, 11, 50, t);
    expect(wd.level()).toBe('full');
  });

  it('respects a 30fps budget', () => {
    const wd = createFrameWatchdog({ ...opts, budgetMs: 1000 / 30 });
    feed(wd, 30, 25); // 25ms = 40fps: fine for 30fps, would fail at 60
    expect(wd.level()).toBe('full');
  });

  it('needs a full window before judging', () => {
    const wd = createFrameWatchdog({ ...opts, window: 50 });
    feed(wd, 20, 100); // terrible, but not enough samples yet
    expect(wd.level()).toBe('full');
  });

  it('reports the mean frame time and explains the step-down', () => {
    let reason = '';
    const wd = createFrameWatchdog({ ...opts, onLevel: (_l, r) => (reason = r) });
    feed(wd, 11, 50);
    expect(reason).toMatch(/full → reduced/);
    expect(reason).toMatch(/over 16\.7ms/);
    expect(reason).toMatch(/mean 50\.0ms/);
  });

  it('defaults to a 30fps budget, so a merely-not-60fps scene is left alone', () => {
    // Measured, not guessed: warp on a loaded machine runs ~24ms/frame (~42fps).
    // At a 60fps budget that stepped down twice, which is a regression.
    const wd = createFrameWatchdog({ window: 10, graceFrames: 0 });
    feed(wd, 60, 24);
    expect(wd.level()).toBe('full');
    // Genuinely bad (20fps) still steps down.
    const bad = createFrameWatchdog({ window: 10, graceFrames: 0 });
    feed(bad, 20, 50);
    expect(bad.level()).toBe('reduced');
  });

  it('meanFrameMs is null before any delta is recorded', () => {
    const wd = createFrameWatchdog(opts);
    expect(wd.meanFrameMs()).toBeNull();
    wd.frame(0);
    expect(wd.meanFrameMs()).toBeNull(); // one timestamp = no delta yet
  });
});

describe('attachFrameWatchdog', () => {
  it('drives the watchdog from rAF and stops cleanly', () => {
    const wd = createFrameWatchdog(opts);
    const spy = vi.spyOn(wd, 'frame');
    let cb: ((t: number) => void) | null = null;
    let handle = 0;
    const raf = (fn: (t: number) => void): number => {
      cb = fn;
      return ++handle;
    };
    const cancel = vi.fn();

    const stop = attachFrameWatchdog(wd, raf, cancel);
    cb?.(16);
    cb?.(32);
    expect(spy).toHaveBeenCalledTimes(2);
    stop();
    expect(cancel).toHaveBeenCalled();
  });
});
