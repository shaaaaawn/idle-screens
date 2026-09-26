/**
 * `timeline` — authored keyframes on a scene's own clock.
 *
 * Everything here is a pure function of `(spec, t)`: resolving a scene at a
 * time never depends on what was rendered before, so a timeline scene is as
 * seekable and frame-addressable as any other (ghosting warm-up replays call
 * `resolveTimelineAt` at each replay frame's own time). A spec without a
 * `timeline` is returned untouched, which is what keeps every existing scene
 * byte-identical.
 *
 * Semantics:
 * - Keys address the same dot-paths as live steering; a path must already
 *   exist on the spec (a key cannot create a field).
 * - A key glides from wherever its path is at `t` to `value` over `dur` ms
 *   (default 1000, the live-steering default; 0 is a cut), eased `smooth`
 *   unless it says otherwise. Overlapping glides are fine: the later one
 *   starts from the earlier one's in-flight value.
 * - Without `loop`, a path holds the base spec's value before its first key.
 * - With `loop`, time wraps every `duration` ms and a path's value before its
 *   first key is its LAST key's value — the lap is one closed cycle, and lap 1
 *   looks exactly like lap 7 (the value depends only on `t mod duration`).
 */
import type { SaverSpec, Timeline, TimelineKey } from './types';
import { applyDeltasToSpec, canonicalSpecPath, easeSmooth, lerpValue, readSpecPath } from './steer';

/** Default glide length for a key without `dur` — the same as a live steer's. */
export const DEFAULT_KEY_DUR = 1000;

type Tracks = Map<string, TimelineKey[]>;
const tracksCache = new WeakMap<Timeline, { spec: SaverSpec; tracks: Tracks }>();

/** The spec without its `timeline` (a shallow copy — the layers are shared, never mutated). */
export function withoutTimeline(spec: SaverSpec): SaverSpec {
  if (!spec.timeline) return spec;
  const rest: Partial<SaverSpec> = { ...spec };
  delete rest.timeline;
  return rest as SaverSpec;
}

/**
 * The spec's keys grouped by the field they animate (index-form path), each
 * group sorted by time (stable, so equal times keep authored order and the
 * later one wins). Keys whose path does not resolve are dropped — the
 * validator rejects them, and the runtime stays lenient like steering.
 */
export function timelineTracks(spec: SaverSpec): Tracks {
  const tl = spec.timeline;
  if (!tl) return new Map();
  const hit = tracksCache.get(tl);
  if (hit && hit.spec === spec) return hit.tracks;
  const base = withoutTimeline(spec);
  const tracks: Tracks = new Map();
  for (const k of tl.keys ?? []) {
    const cp = canonicalSpecPath(base, k.path);
    if (!cp) continue;
    const list = tracks.get(cp) ?? [];
    list.push(k);
    tracks.set(cp, list);
  }
  for (const list of tracks.values()) list.sort((a, b) => a.t - b.t);
  tracksCache.set(tl, { spec, tracks });
  return tracks;
}

/** Scene time folded into the timeline's own clock: `t mod duration` under `loop`, else `t`. */
export function timelineLocalTime(tl: Timeline, t: number): number {
  const d = tl.duration ?? 0;
  if (tl.loop && d > 0) return ((t % d) + d) % d;
  return t;
}

function ease(k: TimelineKey, x: number): number {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  if (k.ease === 'step') return c >= 1 ? 1 : 0;
  if (k.ease === 'linear') return c;
  return easeSmooth(c);
}

/** One path's value at timeline-local time `tt`, starting from `start`. */
function evalTrack(keys: TimelineKey[], start: unknown, tt: number): unknown {
  let from = start;
  let key: TimelineKey | null = null;
  const at = (tau: number): unknown => {
    if (!key) return from;
    const dur = key.dur ?? DEFAULT_KEY_DUR;
    if (dur <= 0 || tau >= key.t + dur) return key.value;
    return lerpValue(from, key.value, ease(key, (tau - key.t) / dur));
  };
  for (const k of keys) {
    if (k.t > tt) break;
    from = at(k.t);
    key = k;
  }
  return at(tt);
}

/**
 * The scene at time `t` with every key applied — and without its `timeline`,
 * so the result can be rendered, perceived, lerped or steered like any plain
 * spec. A spec without a timeline comes back as the same object.
 */
export function resolveTimelineAt(spec: SaverSpec, t: number): SaverSpec {
  const tl = spec.timeline;
  if (!tl) return spec;
  const base = withoutTimeline(spec);
  const tracks = timelineTracks(spec);
  if (tracks.size === 0) return base;
  const tt = timelineLocalTime(tl, t);
  const deltas: Array<{ t: number; path: string; value: unknown }> = [];
  for (const [path, keys] of tracks) {
    const start = tl.loop ? keys[keys.length - 1]!.value : readSpecPath(base, path);
    deltas.push({ t: 0, path, value: evalTrack(keys, start, tt) });
  }
  return applyDeltasToSpec(base, deltas);
}

/**
 * When the timeline next takes a path back: the scene time of that path's
 * next key after `t`, and that key's glide length — or null when no key will
 * ever touch it again (no key on the path, or a non-looping timeline past its
 * last key). A live steer on the path holds until `at`, then glides back to
 * the timeline over `dur`.
 */
export function nextKeyAfter(spec: SaverSpec, path: string, t: number): { at: number; dur: number } | null {
  const tl = spec.timeline;
  if (!tl) return null;
  const cp = canonicalSpecPath(withoutTimeline(spec), path);
  const keys = cp ? timelineTracks(spec).get(cp) : undefined;
  if (!keys || keys.length === 0) return null;
  const tt = timelineLocalTime(tl, t);
  const next = keys.find((k) => k.t > tt);
  if (next) return { at: t + (next.t - tt), dur: next.dur ?? DEFAULT_KEY_DUR };
  if (tl.loop && (tl.duration ?? 0) > 0) {
    const first = keys[0]!;
    return { at: t + (tl.duration! - tt) + first.t, dur: first.dur ?? DEFAULT_KEY_DUR };
  }
  return null;
}

/**
 * Scene times (timeline-local; within one lap under `loop`) where the keys'
 * combined state is worth checking: time 0, and every key's start, end and
 * glide quarter-points. Two keys can each be valid alone and invalid together
 * (a `clock.rate` and a `pulse.period` the flash floor bounds as a ratio), so
 * validation samples the composed scene here. `dense: false` keeps only the
 * starts and ends, for the per-steer check a live viewer runs. Capped (evenly
 * subsampled) so a 256-key timeline stays cheap to check.
 */
export function timelineSampleTimes(spec: SaverSpec, dense = true, cap = dense ? 300 : 64): number[] {
  const tl = spec.timeline;
  if (!tl) return [];
  const fracs = dense ? [0, 0.25, 0.5, 0.75, 1] : [0, 1];
  const set = new Set<number>([0]);
  for (const k of tl.keys ?? []) {
    if (!Number.isFinite(k.t)) continue;
    const d = k.dur ?? DEFAULT_KEY_DUR;
    for (const f of fracs) set.add(k.t + d * f);
  }
  const d = tl.duration ?? 0;
  let times = [...set].filter(Number.isFinite);
  if (tl.loop && d > 0) times = [...new Set(times.map((t) => ((t % d) + d) % d))];
  times.sort((a, b) => a - b);
  if (times.length <= cap) return times;
  const step = times.length / cap;
  return Array.from({ length: cap }, (_, i) => times[Math.floor(i * step)]!);
}

/** The absolute scene times at or after `now` where `timelineSampleTimes` fall — the next lap's occurrences under `loop`. */
export function timelineSampleTimesAfter(spec: SaverSpec, now: number, dense = false): number[] {
  const tl = spec.timeline;
  if (!tl) return [];
  const local = timelineSampleTimes(spec, dense);
  const d = tl.duration ?? 0;
  if (tl.loop && d > 0) {
    const phase = ((now % d) + d) % d;
    return local.map((s) => now + (((s - phase) % d) + d) % d).sort((a, b) => a - b);
  }
  return local.filter((s) => s > now);
}
