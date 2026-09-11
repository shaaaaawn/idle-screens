import { structuralSignature } from './steer';
import { LIMITS, type IdleSequence, type SequenceTransition } from './types';

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

// ---------------------------------------------------------------------------
// Render seeds — shared by SequenceInstance (compile.ts) and
// perceiveSequenceFrame (perceive.ts), so both derive the same seed from the
// same sequence. Kept in one place after two review rounds found the
// perception side had drifted from the renderer's exact derivation.
// ---------------------------------------------------------------------------

/** Whether the boundary from `from` to `from + 1` morphs: same scene structure, `morph` transition. */
export function canMorph(seq: IdleSequence, from: number): boolean {
  const seg = seq.segments[from];
  if (!seg || seg.transition?.type !== 'morph') return false;
  const next = seq.segments[from + 1];
  if (!next) return false;
  return structuralSignature(seg.scene) === structuralSignature(next.scene);
}

/**
 * Walk back through consecutive `morph` boundaries to the chain's origin. A
 * morph-chained segment's entities are never re-seeded at the boundary —
 * they're the same stream continued from wherever the chain started — so its
 * actual render seed (see `segmentRenderSeed`) is always the chain root's,
 * never its own index's.
 */
export function morphChainRoot(seq: IdleSequence, index: number): number {
  let i = index;
  while (i > 0 && canMorph(seq, i - 1)) i--;
  return i;
}

/** `SpecInstance`'s seed normalization: 0 is falsy, so a valid `seed: 0` lands on 1. */
export function normalizeSeed(seed: number): number {
  return (seed >>> 0) || 1;
}

/**
 * The seed segment `index`'s entities actually render with — its chain
 * root's own seed, else `seq.seed + ` the chain root's index, normalized
 * exactly like `SpecInstance`. `undefined` when neither is set: the same
 * "unknowable ahead of time" case a bare `SaverSpec` has via `ctx.seed`,
 * which callers fall back to their own default for (as `perceiveScene` does).
 */
export function segmentRenderSeed(seq: IdleSequence, index: number): number | undefined {
  const root = morphChainRoot(seq, index);
  const scene = seq.segments[root]?.scene;
  if (!scene) return undefined;
  const raw = scene.seed ?? (seq.seed !== undefined ? seq.seed + root : undefined);
  return raw === undefined ? undefined : normalizeSeed(raw);
}

/**
 * The seed the bed's entities actually render with — its own seed, else
 * `seq.seed + LIMITS.maxSegments` (past every segment's `seq.seed + index`,
 * so a bed and segment 0 never share a stream), normalized like
 * `SpecInstance`. `undefined` when there's no bed or no derivable seed.
 */
export function bedRenderSeed(seq: IdleSequence): number | undefined {
  if (!seq.bed) return undefined;
  const raw = seq.bed.seed ?? (seq.seed !== undefined ? seq.seed + LIMITS.maxSegments : undefined);
  return raw === undefined ? undefined : normalizeSeed(raw);
}

/**
 * Whether a republished sequence can be swapped into a live
 * `SequenceInstance` in place of `prev` without a remount
 * (`SequenceInstance.hotSwapSequence`). True only when every part of the
 * running instance that is fixed at mount — or that a running clock is
 * measured against — is unchanged:
 *
 * - the same number of segments;
 * - every segment's scene is a structural twin (`structuralSignature`) of
 *   its counterpart, so the live child's entities survive a `hotSwapSpec`;
 * - the same render seed per segment (`segmentRenderSeed`) — a child's seed
 *   is fixed at construction, so a changed seed could only take effect at
 *   the next boundary, leaving the room half-swapped;
 * - a `bed` on both sides or neither, structural twins with the same seed
 *   when present;
 * - the same `loop` and `sync` (absent `sync` is `'mount'`);
 * - the same `duration`, `advance` (absent is `'auto'`) and `transition`
 *   (absent is `cut`; `text` on a morph defaults to `'step'`) on every
 *   segment. Durations move segment boundaries under a clock that keeps
 *   running, and `clockOffset`/`releasedBelow` on the instance are measured
 *   in that timeline — so a timing edit is a remount for now.
 *
 * Paint stays free: colours, words, alpha, `background`, `ghosting`, ids and
 * labels, segment keys. Mirrors idle-server's `sequenceSignaturesEqual`
 * precondition and adds the timing terms.
 */
export function sequenceSwapCompatible(prev: IdleSequence, next: IdleSequence): boolean {
  if (prev.segments.length !== next.segments.length) return false;
  if (prev.loop !== next.loop) return false;
  if ((prev.sync ?? 'mount') !== (next.sync ?? 'mount')) return false;
  if (!!prev.bed !== !!next.bed) return false;
  if (prev.bed && next.bed) {
    if (structuralSignature(prev.bed) !== structuralSignature(next.bed)) return false;
    if (bedRenderSeed(prev) !== bedRenderSeed(next)) return false;
  }
  for (let i = 0; i < prev.segments.length; i++) {
    const a = prev.segments[i]!;
    const b = next.segments[i]!;
    if (a.duration !== b.duration) return false;
    if ((a.advance ?? 'auto') !== (b.advance ?? 'auto')) return false;
    if (transitionKey(a.transition) !== transitionKey(b.transition)) return false;
    if (structuralSignature(a.scene) !== structuralSignature(b.scene)) return false;
    if (segmentRenderSeed(prev, i) !== segmentRenderSeed(next, i)) return false;
  }
  return true;
}

/** A transition's shape with its defaults filled in, so `undefined` and `{ type: 'cut' }` compare equal. */
function transitionKey(tr: SequenceTransition | undefined): string {
  if (!tr || tr.type === 'cut') return 'cut';
  if (tr.type === 'morph') return `morph:${tr.dur}:${tr.text ?? 'step'}`;
  return `fade:${tr.dur}`;
}
