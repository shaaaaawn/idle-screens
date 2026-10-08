/**
 * Runtime step-down when a scene is too heavy for the box it landed on.
 *
 * Preflight gating (`capability-ladder.ts`) decides what to *attempt* from what
 * the device claims and what the host declares. It cannot catch everything:
 * cost also depends on what else is running, a channel can publish an
 * arbitrarily heavy scene at any moment, and a Pi reports WebGL2 truthfully
 * while rendering it at four frames a second. tvOS has the same problem and
 * answers it with `RenderGuard` + `FrameWatchdog` — watch real frame times and
 * step the renderer down rather than leaving a slideshow on screen.
 *
 * This is the web equivalent. It is deliberately a pure state machine fed
 * timestamps: no rAF, no clock, no DOM. The caller drives it (see `attach`),
 * which is what makes the escalation policy unit-testable instead of something
 * you can only observe by throttling a real browser.
 *
 * Why sustained overrun and not a single slow frame: mounting a saver, a GC
 * pause, or the compositor handing over a new surface all produce one-off
 * spikes. Stepping down on those would make the ladder twitchy and would, on a
 * perfectly capable machine, demote a scene seconds after it appeared.
 */

/** What the host should do next. Mirrors tvOS's RenderGuard.Level ordering. */
export type LadderLevel = 'full' | 'reduced' | 'cheapest';

export interface WatchdogOptions {
  /**
   * Frame budget in ms. Defaults to 1000/30 (≈33.3), i.e. "step down when this
   * is sustained worse than 30fps" — NOT 60.
   *
   * Tuned against a real browser rather than guessed: at a 60fps budget, warp on
   * a busy machine reported 45/90 frames over budget at a 24ms mean (~42fps) and
   * stepped down twice. A screensaver at 42fps is fine; demoting it is a
   * regression, and on any loaded machine it would demote constantly. The
   * threshold has to sit where the experience is actually bad.
   */
  budgetMs?: number;
  /** How many recent frames to judge on. */
  window?: number;
  /** Fraction of the window that must overrun before stepping down (0..1). */
  overrunRatio?: number;
  /** Ignore this many frames after a (re)mount — mounting itself is spiky. */
  graceFrames?: number;
  /** Called when the level changes, with a human-readable reason. */
  onLevel?: (level: LadderLevel, reason: string) => void;
}

export interface FrameWatchdog {
  /** Feed one frame timestamp (ms, monotonic). Returns the current level. */
  frame(nowMs: number): LadderLevel;
  /** Call after mounting a saver: clears history and re-arms the grace period. */
  reset(): void;
  /**
   * Back to 'full' with fresh history. For an explicit user selection after the
   * watchdog bottomed out: the pick is theirs to make, but it must be judged
   * afresh rather than inheriting a floor it never earned.
   */
  rearm(): void;
  level(): LadderLevel;
  /** Observed mean frame time over the current window, or null before 2 frames. */
  meanFrameMs(): number | null;
}

/** Longer than any real frame, shorter than any tab switch. */
const HIDDEN_TAB_GAP_MS = 2000;

const NEXT: Record<LadderLevel, LadderLevel> = {
  full: 'reduced',
  reduced: 'cheapest',
  cheapest: 'cheapest',
};

export function createFrameWatchdog(opts: WatchdogOptions = {}): FrameWatchdog {
  const budgetMs = opts.budgetMs ?? 1000 / 30;
  const window = Math.max(2, opts.window ?? 90);
  const overrunRatio = opts.overrunRatio ?? 0.5;
  const graceFrames = opts.graceFrames ?? 30;
  const onLevel = opts.onLevel ?? (() => {});

  let deltas: number[] = [];
  let last: number | null = null;
  let grace = graceFrames;
  let current: LadderLevel = 'full';

  const reset = (): void => {
    deltas = [];
    last = null;
    grace = graceFrames;
  };

  return {
    frame(nowMs: number): LadderLevel {
      if (last !== null) {
        const delta = nowMs - last;
        // A backgrounded tab or a blanked display stops rAF entirely; the gap on
        // resume is not a slow frame and must not count as one.
        //
        // The cutoff is ABSOLUTE, not a multiple of the budget. Scaled to the
        // budget it was 667ms, which would have silently discarded genuinely
        // terrible frames — a scene limping at 2fps is exactly what this is
        // supposed to catch, and it would have been thrown away as a tab switch.
        // No real frame takes 2s; a hidden tab takes far longer.
        if (delta > 0 && delta < HIDDEN_TAB_GAP_MS) {
          if (grace > 0) grace -= 1;
          else {
            deltas.push(delta);
            if (deltas.length > window) deltas.shift();
          }
        }
      }
      last = nowMs;

      if (deltas.length >= window && current !== 'cheapest') {
        const over = deltas.filter((d) => d > budgetMs).length;
        if (over / deltas.length >= overrunRatio) {
          const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
          const from = current;
          current = NEXT[current];
          // Start the next level's judgement from scratch, and give the new
          // renderer the same grace a fresh mount gets.
          reset();
          onLevel(
            current,
            `${from} → ${current}: ${over}/${window} frames over ${budgetMs.toFixed(1)}ms ` +
              `(mean ${mean.toFixed(1)}ms)`,
          );
        }
      }
      return current;
    },
    reset,
    rearm() {
      current = 'full';
      reset();
    },
    level: () => current,
    meanFrameMs: () =>
      deltas.length >= 1 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null,
  };
}

/**
 * Drive a watchdog from requestAnimationFrame. Separated from the state machine
 * so the policy above stays testable without a browser.
 */
export function attachFrameWatchdog(
  watchdog: FrameWatchdog,
  raf: (cb: (t: number) => void) => number = requestAnimationFrame,
  cancel: (h: number) => void = cancelAnimationFrame,
): () => void {
  let handle = raf(function tick(t: number) {
    watchdog.frame(t);
    handle = raf(tick);
  });
  return () => cancel(handle);
}
