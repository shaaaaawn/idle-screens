/**
 * Named shots (the Amano study): a handful of framings a channel can cut
 * between — the way the Amano demo offers hero, front, low, top and macro
 * views of its tank. A shot is a target, an angle and a lens; the author's
 * `cameraAzimuth` (plus `autoRotate`) still turns it, and `cameraDistance`
 * still scales it, so a scene can hold a shot or drift around it.
 *
 *   orbit    today's camera, exactly (the default)
 *   hero     three-quarter view from a little above: the establishing shot
 *   front    level and long-lensed, straight on: the tank as a picture
 *   low      down among the plants, looking up at the fish against the light
 *   top      high and steep, the floor laid out like a map
 *   surface  on the floor looking up at the underside of the water
 *   macro    close on one landmark (the crystal or rock nearest the front)
 *   cast     the leads (the mix's first three: a vignette's a, b, c), wherever
 *            they swim: aimed at their middle, as far back as their spread
 *            needs (castPose, placed once the fish have moved)
 *
 * Pure: `shotPose` depends only on its inputs, so it is testable and a cut
 * lands identically on every screen. Kept inside the water — never above the
 * ceiling, never under the floor — the way the follow camera is.
 */

export type ShotName = 'orbit' | 'hero' | 'front' | 'low' | 'top' | 'surface' | 'macro' | 'cast';
export const SHOT_NAMES: readonly ShotName[] = ['orbit', 'hero', 'front', 'low', 'top', 'surface', 'macro', 'cast'];

/** The default camera's lens and aim — what `orbit` has always been. */
export const ORBIT_FOV = 55;
export const ORBIT_TARGET_Y = 35;

export interface ShotInput {
  /** Degrees, `cameraAzimuth` plus any `autoRotate` so far. */
  azimuth: number;
  /** Degrees, `cameraElevation` (orbit only; the others choose their own). */
  elevation: number;
  /** `cameraDistance`. The other shots scale from it (110 is the default). */
  distance: number;
  /** The water surface's height, or null for open water. */
  ceiling: number | null;
  /** Ground height, including whatever stands on it. */
  floor: (x: number, z: number) => number;
  /** For `macro`: the landmark to frame (its top point) and its size. */
  landmark: { x: number; y: number; z: number; size: number } | null;
}

export interface ShotPose { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number }

interface Framing { target: [number, number, number]; elevation: number; distance: number; azimuth: number; fov: number }

const rad = (d: number): number => (d * Math.PI) / 180;

function framing(name: ShotName, i: ShotInput): Framing {
  const k = i.distance / 110; // the author's distance scales every framing
  const surfaceY = i.ceiling ?? 150;
  switch (name) {
    // `cast` stands where `hero` does until the fish have moved this frame (castPose).
    case 'cast':
    case 'hero': return { target: [0, 32, 0], elevation: 17, distance: 128 * k, azimuth: shotAzimuthOffset('hero'), fov: 45 };
    case 'front': return { target: [0, 36, 0], elevation: 3, distance: 150 * k, azimuth: 0, fov: 38 };
    case 'low': return { target: [0, 46, 0], elevation: -12, distance: 88 * k, azimuth: shotAzimuthOffset('low'), fov: 58 };
    case 'top': return { target: [0, 18, 0], elevation: 58, distance: 125 * k, azimuth: 0, fov: 48 };
    case 'surface': {
      // Low and close, tipped right back: most of the frame is the water's underside.
      const ty = Math.min(surfaceY - 12, 120);
      return { target: [0, ty, 0], elevation: -38, distance: 95 * k, azimuth: 0, fov: 62 };
    }
    case 'macro': {
      const l = i.landmark ?? { x: 0, y: 26, z: 0, size: 24 };
      // Far enough back that the plants round its foot do not fill the lens,
      // aimed at its upper half, from a little above.
      // Plants ring every landmark (flora grows round the same anchors), so
      // the lens looks down over their tops rather than in through them.
      const d = Math.max(55, Math.min(110, l.size * 2.8)) * Math.min(1.6, Math.max(0.6, k));
      return { target: [l.x, l.y - l.size * 0.35, l.z], elevation: 30, distance: d, azimuth: 0, fov: 40 };
    }
    default: return { target: [0, ORBIT_TARGET_Y, 0], elevation: i.elevation, distance: i.distance, azimuth: 0, fov: ORBIT_FOV };
  }
}

/**
 * Where the shot's camera stands, in degrees round the tank (0..360, the
 * convention `cameraAzimuth` uses: 0 looks from +z): `cameraAzimuth`, plus how
 * far an `autoRotate` has turned it by now (`turned`), plus the shot's own
 * swing. What `frame.state.camera.bearing` reports (X438) — `azimuth` there is
 * the param, which an orbit never changes.
 */
export function shotBearing(name: ShotName, azimuth: number, turned: number): number {
  const b = (((azimuth + turned + shotAzimuthOffset(name)) % 360) + 360) % 360;
  return Math.round(b * 10) / 10 % 360;
}

/** How far a shot swings off `cameraAzimuth` (degrees): lanes laid across the view use it. */
export function shotAzimuthOffset(name: ShotName): number {
  return name === 'hero' ? -28 : name === 'low' ? 12 : 0;
}

export function shotPose(name: ShotName, i: ShotInput, out: ShotPose): ShotPose {
  const f = framing(name, i);
  const az = rad(i.azimuth + f.azimuth), el = rad(f.elevation);
  if (name === 'orbit') {
    // Bit-for-bit today's camera: its height is measured from 15, not from
    // the target, and floored at 10.
    out.x = Math.cos(el) * Math.sin(az) * f.distance;
    out.y = Math.max(10, 15 + Math.sin(el) * f.distance);
    out.z = Math.cos(el) * Math.cos(az) * f.distance;
    out.tx = 0; out.ty = ORBIT_TARGET_Y; out.tz = 0;
    out.fov = ORBIT_FOV;
    return out;
  }
  const [tx, ty, tz] = f.target;
  out.x = tx + Math.cos(el) * Math.sin(az) * f.distance;
  out.y = ty + Math.sin(el) * f.distance;
  out.z = tz + Math.cos(el) * Math.cos(az) * f.distance;
  // Inside the water: above whatever stands here, under the surface.
  out.y = Math.max(out.y, i.floor(out.x, out.z) + 6);
  if (i.ceiling !== null) out.y = Math.min(out.y, i.ceiling - 6);
  out.tx = tx; out.ty = ty; out.tz = tz;
  out.fov = f.fov;
  return out;
}

/** The landmark `macro` frames: near the front of the tank for this azimuth, bigger ones preferred. Deterministic. */
export function pickLandmark(
  candidates: readonly { x: number; y: number; z: number; size: number }[], azimuthDeg: number,
): { x: number; y: number; z: number; size: number } | null {
  if (!candidates.length) return null;
  const fx = Math.sin(rad(azimuthDeg)) * 70, fz = Math.cos(rad(azimuthDeg)) * 70;
  let best = candidates[0]!, bd = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - fx, c.z - fz) - c.size * 1.5;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/** What `cast` needs besides the fish: the shot's angles, its scale, and the water's bounds. */
export interface CastInput {
  /** Degrees, `cameraAzimuth` plus any `autoRotate` so far. */
  azimuth: number;
  /** Degrees above the cast's middle (`cameraElevation`, at least 6). */
  elevation: number;
  /** `cameraDistance` / 110: the author's dial still scales the framing. */
  scale: number;
  ceiling: number | null;
  floor: (x: number, z: number) => number;
  /** How far from the tank's centre the camera may stand (horizontally). */
  reach: number;
}

/** How many of the mix's first slots `cast` frames: a vignette's actors. */
export const CAST_LEADS = 3;

/** The cast shot's lens (degrees) and how much room it leaves round the cast. */
export const CAST_FOV = 45;
const CAST_ROOM = 1.15;

/**
 * Frame the leads: aim at their middle and stand back as far as their spread
 * needs — the RMS distance from the middle, ×1.5, plus a body length, filling
 * the lens with a little room. Mean and RMS move continuously as the fish
 * swim, so the camera glides with them (no frame history: a frame is still a
 * function of t); one fish wandering off widens the shot instead of
 * snapping it. Kept inside the water like the other shots; null with no fish.
 */
export function castPose(points: readonly { x: number; y: number; z: number }[], body: number, i: CastInput, out: ShotPose): ShotPose | null {
  const n = points.length;
  if (!n) return null;
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= n; cy /= n; cz /= n;
  let ss = 0;
  for (const p of points) ss += (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2;
  const radius = 1.5 * Math.sqrt(ss / n) + body;
  const d = Math.max(45, Math.min(220, (radius / Math.tan(rad(CAST_FOV / 2))) * CAST_ROOM)) * i.scale;
  // The aim stays in the water's middle band: never into the sand, never at the surface.
  let ty = Math.max(cy, i.floor(cx, cz) + 8);
  if (i.ceiling !== null) ty = Math.min(ty, i.ceiling - 10);
  const az = rad(i.azimuth), el = rad(Math.max(6, i.elevation));
  out.x = cx + Math.cos(el) * Math.sin(az) * d;
  out.y = ty + Math.sin(el) * d;
  out.z = cz + Math.cos(el) * Math.cos(az) * d;
  // Never out past the tank: the horizon and the room's walls stand there.
  const h = Math.hypot(out.x, out.z);
  if (h > i.reach) { out.x *= i.reach / h; out.z *= i.reach / h; }
  out.y = Math.max(out.y, i.floor(out.x, out.z) + 6);
  if (i.ceiling !== null) out.y = Math.min(out.y, i.ceiling - 6);
  out.tx = cx; out.ty = ty; out.tz = cz;
  out.fov = CAST_FOV;
  return out;
}

/** A step param's last change on a control track: what it was, what it is, and when (ms on the track's clock). */
export interface StepChange { from: string; to: string; at: number }

/**
 * When `path` (a step param such as `shot`) last changed at `t` (ms), from
 * what to what — the cut a `shotBlend` eases. Reads the deltas the way the
 * track does: a step value holds from its own `t`. On a looping track the
 * seam is a change too (from the cycle's last value to its first), from the
 * second cycle on; the very first value, at mount, is not. Null when nothing
 * changed (or changed to what it already was).
 */
export function lastStepChange(
  track: { deltas: ReadonlyArray<{ t: number; path: string; value: unknown }>; loop?: boolean; duration?: number },
  path: string, t: number,
): StepChange | null {
  const ds = track.deltas.filter((d) => d.path === path).slice().sort((a, b) => a.t - b.t);
  if (!ds.length) return null;
  const loop = !!track.loop && !!track.duration && track.duration > 0;
  const w = loop ? t % track.duration! : t;
  let i = -1;
  for (let k = 0; k < ds.length; k++) if (ds[k]!.t <= w) i = k;
  const cycle = t - w; // when this cycle began (0 off a loop)
  let from: unknown, at: number;
  if (i < 0) {
    // Before this cycle's first key: the last change was the previous cycle's last key.
    if (!loop || t < track.duration! || ds.length < 2) return null;
    i = ds.length - 1;
    from = ds[i - 1]!.value;
    at = cycle - track.duration! + ds[i]!.t;
  } else if (i > 0) {
    from = ds[i - 1]!.value;
    at = cycle + ds[i]!.t;
  } else if (loop && t >= track.duration!) {
    // The seam: this cycle's first key, from the last cycle's last.
    from = ds[ds.length - 1]!.value;
    at = cycle + ds[i]!.t;
  } else return null;
  const to = ds[i]!.value;
  if (String(from) === String(to)) return null;
  return { from: String(from), to: String(to), at };
}

/** How far into a `shotBlend` of `blend` seconds a camera is, `since` seconds after the cut: 0..1, eased (smootherstep). 1 when there is no blend. */
export function shotBlendAt(since: number, blend: number): number {
  if (!(blend > 0) || since >= blend) return 1;
  const u = Math.max(0, since / blend);
  return u * u * u * (u * (u * 6 - 15) + 10);
}
