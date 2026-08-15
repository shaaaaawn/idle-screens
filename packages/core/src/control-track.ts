import type { ControlTrack, Ease, ParamDelta, ParamSpace, ParamValue } from './types';

function easeFn(e: Ease, p: number): number {
  const x = p <= 0 ? 0 : p >= 1 ? 1 : p;
  switch (e) {
    case 'step':
      return x >= 1 ? 1 : 0;
    case 'smooth':
      return x * x * (3 - 2 * x);
    case 'linear':
    default:
      return x;
  }
}

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

function parseHex(c: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: [number, number, number]): string {
  const h = (v: number): string =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

function lerpValue(type: string, a: ParamValue, b: ParamValue, p: number): ParamValue {
  if (type === 'number' && typeof a === 'number' && typeof b === 'number') return lerp(a, b, p);
  if (type === 'color' && typeof a === 'string' && typeof b === 'string') {
    const ca = parseHex(a);
    const cb = parseHex(b);
    if (ca && cb) return toHex([lerp(ca[0], cb[0], p), lerp(ca[1], cb[1], p), lerp(ca[2], cb[2], p)]);
  }
  return p >= 1 ? b : a; // bool / enum / string / step
}

/** A number-param keyframe value as both sampling and integration see it:
 *  finite numbers pass, finite numeric strings coerce (MCP harnesses with
 *  untyped `value` params stringify numbers), anything else is null — the
 *  keyframe is treated as absent. Shared by evalPath and integrateParam so
 *  the sampled curve and its integral can never disagree about a value. */
function numericValue(v: ParamValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

function evalPath(
  dflt: ParamValue,
  type: string,
  defaultEase: Ease,
  deltas: ParamDelta[],
  t: number,
): ParamValue {
  if (deltas.length === 0) return dflt;
  // Number params: stringified keyframes coerce, junk keyframes are ignored
  // (as if absent) — identical treatment to integrateParam, so the distance
  // warp can never diverge from the curve the saver samples.
  if (type === 'number') {
    const cleaned: ParamDelta[] = [];
    for (const k of deltas) {
      const n = numericValue(k.value);
      if (n === null) continue;
      cleaned.push(n === k.value ? k : { ...k, value: n });
    }
    deltas = cleaned;
    if (deltas.length === 0) return dflt;
  }
  let prevVal = dflt;
  let prevT = -Infinity;
  for (const k of deltas) {
    if (t < k.t) {
      const rampStart = k.dur != null ? k.t - k.dur : prevT === -Infinity ? k.t : prevT;
      if (t <= rampStart) return prevVal;
      const p = easeFn(k.ease ?? defaultEase, (t - rampStart) / (k.t - rampStart || 1));
      return lerpValue(type, prevVal, k.value, p);
    }
    prevVal = k.value;
    prevT = k.t;
  }
  return prevVal; // after the last keyframe
}

/**
 * Sample a control track: given the saver's param space (defaults + types) and a
 * track, return the interpolated parameter values at logical time `t` (ms). Pure
 * and deterministic: identical `(space, track, t)` yields identical output.
 */
export function sampleTrack(
  space: ParamSpace,
  track: ControlTrack,
  t: number,
): Record<string, ParamValue> {
  const byPath = new Map<string, ParamDelta[]>();
  for (const d of track.deltas) {
    const arr = byPath.get(d.path) ?? [];
    arr.push(d);
    byPath.set(d.path, arr);
  }
  const wrapped =
    track.loop && track.duration && track.duration > 0 ? t % track.duration : t;

  const out: Record<string, ParamValue> = {};
  for (const [path, def] of Object.entries(space)) {
    const deltas = (byPath.get(path) ?? []).slice().sort((a, b) => a.t - b.t);
    out[path] = evalPath(def.default, def.type, def.ease ?? 'linear', deltas, wrapped);
  }
  return out;
}

/** Default param values (the "resting" program before any track is applied). */
export function defaultParams(space: ParamSpace): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const [path, def] of Object.entries(space)) out[path] = def.default;
  return out;
}

// ---------------------------------------------------------------------------
// integrateParam — the closed-form integral of one tracked number param.
// ---------------------------------------------------------------------------

/** ∫₀ᵘ ease dx, for the eases easeFn defines. `step` holds 0 until u = 1 (the
 *  value jumps at the keyframe), so its running integral is 0 on [0, 1). */
function easeIntegral(e: Ease, u: number): number {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
  switch (e) {
    case 'step':
      return 0;
    case 'smooth':
      return x * x * x - (x * x * x * x) / 2; // ∫ 3x² − 2x³
    case 'linear':
    default:
      return (x * x) / 2;
  }
}

function integrateDeltas(
  dflt: number,
  defaultEase: Ease,
  deltas: Array<{ t: number; value: number; ease?: Ease; dur?: number }>,
  t: number,
): number {
  let acc = 0;
  let cursor = 0; // integrated up to here
  let prevVal = dflt;
  let prevT = -Infinity;
  for (const k of deltas) {
    // Identical rampStart rule to evalPath — including a `dur` that reaches
    // back past the previous keyframe, where sampling starts mid-ease. The
    // eased span is therefore integrated in the ramp's ORIGINAL coordinates
    // (u measured from rampStart over D0), never renormalized to the span we
    // happen to integrate.
    const rampStart = k.dur != null ? k.t - k.dur : prevT === -Infinity ? k.t : prevT;
    const D0 = k.t - rampStart;
    const end = Math.min(t, k.t);
    // Constant stretch at prevVal, up to wherever the ramp (or t) begins.
    const constEnd = Math.min(Math.max(rampStart, cursor), end);
    if (constEnd > cursor) acc += prevVal * (constEnd - cursor);
    // Eased stretch: v(τ) = prevVal + (k.value − prevVal)·E((τ−rampStart)/D0).
    if (D0 > 0 && end > constEnd) {
      const ease = k.ease ?? defaultEase;
      const ua = (constEnd - rampStart) / D0;
      const ub = (end - rampStart) / D0;
      acc +=
        prevVal * (end - constEnd) +
        (k.value - prevVal) * D0 * (easeIntegral(ease, ub) - easeIntegral(ease, ua));
    }
    if (t <= k.t) return acc;
    cursor = k.t;
    prevVal = k.value;
    prevT = k.t;
  }
  return acc + prevVal * (t - cursor);
}

/**
 * Closed-form ∫₀ᵗ v(τ) dτ of one number param's track curve — the exact curve
 * `sampleTrack` emits for that path, integrated analytically segment by
 * segment (constant spans, plus linear/smooth/step ramps with `dur` and
 * previous-keyframe ramp starts handled identically to sampling).
 *
 * Why it exists: a saver that multiplies a rate by the *sampled* value scales
 * its entire accumulated motion when the param changes — a live steer
 * teleports everything proportionally to elapsed time. Integrating the curve
 * instead makes rate changes glide, while staying a pure function of
 * `(space, track, t)` — no accumulated state, so `renderFrame(t)` stays
 * frame-addressable and scrubbing works.
 *
 * Units: `t` is track time in ms; the result is value·ms (divide by 1000 for
 * value·seconds). Looping tracks integrate as
 * `fullLoops · ∫₀ᵈᵘʳ + ∫₀ʳᵉᵐ`. Non-`number` params integrate their numeric
 * default (or 0). Like `sampleTrack`, no min/max clamping is applied.
 */
export function integrateParam(
  space: ParamSpace,
  track: ControlTrack,
  path: string,
  t: number,
  bounds?: { min?: number; max?: number },
): number {
  const def = space[path];
  if (!def) return 0;
  // Endpoint clamping bounds the WHOLE curve because every ease is a
  // monotone interpolation between keyframe values: if both endpoints are
  // in range, every eased point between them is too. (A ramp aimed at an
  // out-of-range value is compressed to the clamped endpoint rather than
  // clipped mid-flight — in range, deterministic, and the curve an
  // intake-validated track would have produced.)
  const clamp = (n: number): number => {
    if (bounds?.min !== undefined && n < bounds.min) return bounds.min;
    if (bounds?.max !== undefined && n > bounds.max) return bounds.max;
    return n;
  };
  const dflt = clamp(numericValue(def.default) ?? 0);
  if (def.type !== 'number' || t <= 0) return dflt * Math.max(0, t);
  const deltas: Array<{ t: number; value: number; ease?: Ease; dur?: number }> = [];
  for (const d of track.deltas) {
    if (d.path !== path) continue;
    const raw = numericValue(d.value);
    if (raw === null) continue;
    const value = clamp(raw);
    const entry: { t: number; value: number; ease?: Ease; dur?: number } = { t: d.t, value };
    if (d.ease !== undefined) entry.ease = d.ease;
    if (d.dur !== undefined) entry.dur = d.dur;
    deltas.push(entry);
  }
  deltas.sort((a, b) => a.t - b.t);
  const defaultEase = def.ease ?? 'linear';
  if (track.loop && track.duration && track.duration > 0) {
    const loops = Math.floor(t / track.duration);
    const rem = t - loops * track.duration;
    const oneLoop = integrateDeltas(dflt, defaultEase, deltas, track.duration);
    return loops * oneLoop + integrateDeltas(dflt, defaultEase, deltas, rem);
  }
  return integrateDeltas(dflt, defaultEase, deltas, t);
}
