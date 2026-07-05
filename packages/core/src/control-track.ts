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
  return p >= 1 ? b : a; // bool / enum / step
}

function evalPath(
  dflt: ParamValue,
  type: string,
  defaultEase: Ease,
  deltas: ParamDelta[],
  t: number,
): ParamValue {
  if (deltas.length === 0) return dflt;
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
