import type { IdleSequence } from './types';

export interface ResolvedSegment {
  index: number;
  localT: number;
  /** Cumulative start time of this segment in the global timeline. */
  startT: number;
  /**
   * Present (true) when the timeline has run past this segment's duration but
   * the segment has `advance: 'input'` and no input has released it yet — the
   * scene keeps animating (`localT` keeps growing) while the show waits for
   * the presenter.
   */
  held?: true;
}

export interface ResolveOptions {
  /**
   * Segments below this index have been released by input: a `sequence.segment`
   * steer to index `n` counts as the presenter clicking past every hold before
   * `n`. `SequenceInstance` maintains this; callers resolving a bare timeline
   * leave it at 0, so every `advance: 'input'` hold is honoured.
   */
  releasedBelow?: number;
}

/** Global start time of segment `index` — the prefix sum of the durations before it. */
export function segmentStart(seq: IdleSequence, index: number): number {
  let t = 0;
  const n = Math.max(0, Math.min(index, seq.segments.length - 1));
  for (let i = 0; i < n; i++) t += seq.segments[i]!.duration ?? 0;
  return t;
}

/**
 * Map global time T to (segmentIndex, localT) via prefix sums of durations.
 * Segments are half-open: [start, start+duration). The final segment may omit
 * duration, in which case it holds indefinitely (T past the last timed segment
 * always resolves to the final one).
 *
 * `advance: 'input'` makes a timed segment hold at its end instead of yielding
 * to the next one — the clicker. `auto` (default) and `either` advance on the
 * timer. A hold is released by a `sequence.segment` steer (see
 * `ResolveOptions.releasedBelow`); the held scene keeps its clock running, so
 * `localT` grows past `duration` rather than freezing.
 *
 * With `loop: true`, T wraps modulo the total duration of all segments — but
 * only once every hold on the current lap has been released; after a wrap
 * every hold is armed again. If the final segment has no duration, looping is
 * over the timed prefix only — the durationless tail is unreachable in loop
 * mode (validated elsewhere).
 */
export function resolveSegment(seq: IdleSequence, T: number, opts: ResolveOptions = {}): ResolvedSegment {
  const { segments, loop } = seq;
  if (segments.length === 0) return { index: 0, localT: 0, startT: 0 };

  let totalTimed = 0;
  for (const seg of segments) {
    if (seg.duration != null) totalTimed += seg.duration;
    else break;
  }

  const t0 = Math.max(0, T);

  // Walk the timed prefix once; null means the clock ran off the end.
  const walk = (t: number, releasedBelow: number): ResolvedSegment | null => {
    let cumulative = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      if (seg.duration == null) {
        // A durationless tail holds forever — except in loop mode, where it
        // is unreachable and the clock wraps instead.
        return loop ? null : { index: i, localT: t - cumulative, startT: cumulative };
      }
      if (t < cumulative + seg.duration) {
        return { index: i, localT: t - cumulative, startT: cumulative };
      }
      if (seg.advance === 'input' && i >= releasedBelow) {
        return { index: i, localT: t - cumulative, startT: cumulative, held: true };
      }
      cumulative += seg.duration;
    }
    return null;
  };

  const first = walk(t0, opts.releasedBelow ?? 0);
  if (first) return first;

  if (loop && totalTimed > 0) {
    // A fresh lap, with every hold armed again. Always modulo: subtracting
    // one lap (`t0 - totalTimed`) leaves later laps (T ≥ 2×totalTimed) still
    // past the end of the loop, so a released clock lands on the last hold
    // with a growing localT instead of wrapping.
    const wrapped = walk(t0 % totalTimed, 0);
    if (wrapped) return wrapped;
  }

  const last = segments.length - 1;
  const lastStart = totalTimed - (segments[last]!.duration ?? 0);
  return { index: last, localT: t0 - lastStart, startT: lastStart };
}
