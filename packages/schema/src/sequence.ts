import type { IdleSequence } from './types';

export interface ResolvedSegment {
  index: number;
  localT: number;
  /** Cumulative start time of this segment in the global timeline. */
  startT: number;
}

/**
 * Map global time T to (segmentIndex, localT) via prefix sums of durations.
 * Segments are half-open: [start, start+duration). The final segment may omit
 * duration, in which case it holds indefinitely (T past the last timed segment
 * always resolves to the final one).
 *
 * With `loop: true`, T wraps modulo the total duration of all segments. If the
 * final segment has no duration, looping is over the timed prefix only — the
 * durationless tail is unreachable in loop mode (validated elsewhere).
 */
export function resolveSegment(seq: IdleSequence, T: number): ResolvedSegment {
  const { segments, loop } = seq;
  if (segments.length === 0) return { index: 0, localT: 0, startT: 0 };

  let totalTimed = 0;
  for (const seg of segments) {
    if (seg.duration != null) totalTimed += seg.duration;
    else break;
  }

  let t = Math.max(0, T);

  if (loop && totalTimed > 0) {
    t = t % totalTimed;
  }

  let cumulative = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.duration == null) {
      return { index: i, localT: t - cumulative, startT: cumulative };
    }
    if (t < cumulative + seg.duration) {
      return { index: i, localT: t - cumulative, startT: cumulative };
    }
    cumulative += seg.duration;
  }

  const last = segments.length - 1;
  const lastStart = cumulative - (segments[last]!.duration ?? 0);
  return { index: last, localT: t - lastStart, startT: lastStart };
}
