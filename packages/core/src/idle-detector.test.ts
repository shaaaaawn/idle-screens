// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleDetector } from './idle-detector';

// Fake performance too — IdleDetector.markActive gates its 500ms reschedule on
// performance.now(); without faking it, now() stays frozen and every reschedule
// is (wrongly) throttled.
const FAKE = {
  toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
} as Parameters<typeof vi.useFakeTimers>[0];

let det: IdleDetector | null = null;

beforeEach(() => vi.useFakeTimers(FAKE));
afterEach(() => {
  det?.stop();
  det = null;
  vi.useRealTimers();
});

const fire = (type: string): void => {
  window.dispatchEvent(new Event(type));
};

describe('IdleDetector (I1-I7)', () => {
  it('I1: idle starts false', () => {
    det = new IdleDetector(1000);
    expect(det.idle.value).toBe(false);
  });

  it('I2: flips idle true after timeoutMs of inactivity', () => {
    det = new IdleDetector(1000);
    det.start();
    vi.advanceTimersByTime(999);
    expect(det.idle.value).toBe(false);
    vi.advanceTimersByTime(1);
    expect(det.idle.value).toBe(true);
  });

  it('I3: an activity event resets the countdown', () => {
    det = new IdleDetector(1000);
    det.start();
    vi.advanceTimersByTime(600); // past the 500ms throttle window
    fire('keydown'); // reschedules: new deadline at 600 + 1000 = 1600
    vi.advanceTimersByTime(500); // now=1100, past the ORIGINAL 1000 deadline
    expect(det.idle.value).toBe(false); // proof the reset happened
    vi.advanceTimersByTime(500); // now=1600
    expect(det.idle.value).toBe(true);
  });

  it('I4: markActive() flips idle back to false immediately', () => {
    det = new IdleDetector(1000);
    det.start();
    vi.advanceTimersByTime(1000);
    expect(det.idle.value).toBe(true);
    det.markActive();
    expect(det.idle.value).toBe(false);
  });

  it('I5: reschedules are throttled to >=500ms (rapid activity does not extend)', () => {
    det = new IdleDetector(1000);
    det.start();
    vi.advanceTimersByTime(100);
    fire('pointermove'); // 100 - 0 < 500 -> throttled, does NOT reschedule
    vi.advanceTimersByTime(900); // original deadline (1000) still stands
    expect(det.idle.value).toBe(true);
  });

  it('I6: stop() removes listeners and cancels the pending timer (no late fire)', () => {
    det = new IdleDetector(1000);
    det.start();
    vi.advanceTimersByTime(400);
    det.stop();
    vi.advanceTimersByTime(5000);
    expect(det.idle.value).toBe(false);
    // events after stop are ignored (no throw, no state change)
    fire('keydown');
    vi.advanceTimersByTime(5000);
    expect(det.idle.value).toBe(false);
  });

  it('I7: start() is idempotent (a single countdown, not stacked)', () => {
    det = new IdleDetector(1000);
    det.start();
    det.start(); // second call is a no-op
    vi.advanceTimersByTime(1000);
    expect(det.idle.value).toBe(true);
  });
});
