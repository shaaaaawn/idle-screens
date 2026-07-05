import { signal, type ReadonlySignal } from './reactive';

/**
 * Detects user inactivity. `idle` flips true once no activity for `timeoutMs`.
 * Framework-agnostic port of the Angular IdleService: 6 activity events + a
 * single `setTimeout` (not a poll) whose reschedule is throttled to >=500ms so
 * frequent pointermove events do not thrash timers.
 */
export class IdleDetector {
  private readonly _idle = signal(false);
  readonly idle: ReadonlySignal<boolean> = this._idle;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastReset = 0;
  private running = false;

  private static readonly EVENTS = [
    'pointerdown',
    'pointermove',
    'keydown',
    'wheel',
    'touchstart',
    'scroll',
  ] as const;

  constructor(private readonly timeoutMs: number) {}

  private readonly onActivity = (): void => this.markActive();

  start(): void {
    if (this.running || typeof window === 'undefined') return;
    this.running = true;
    for (const e of IdleDetector.EVENTS) {
      window.addEventListener(e, this.onActivity, { passive: true });
    }
    this.schedule();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const e of IdleDetector.EVENTS) {
      window.removeEventListener(e, this.onActivity);
    }
    this.clear();
  }

  /** Force an activity pulse (resets the countdown, wakes from idle). */
  markActive(): void {
    if (this._idle.value) this._idle.value = false;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastReset < 500) return; // throttle reschedules
    this.lastReset = now;
    this.schedule();
  }

  private schedule(): void {
    this.clear();
    this.timer = setTimeout(() => {
      this._idle.value = true;
    }, this.timeoutMs);
  }

  private clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
