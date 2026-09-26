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
 *
 * Pure: `shotPose` depends only on its inputs, so it is testable and a cut
 * lands identically on every screen. Kept inside the water — never above the
 * ceiling, never under the floor — the way the follow camera is.
 */

export type ShotName = 'orbit' | 'hero' | 'front' | 'low' | 'top' | 'surface' | 'macro';
export const SHOT_NAMES: readonly ShotName[] = ['orbit', 'hero', 'front', 'low', 'top', 'surface', 'macro'];

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
    case 'hero': return { target: [0, 32, 0], elevation: 17, distance: 128 * k, azimuth: -28, fov: 45 };
    case 'front': return { target: [0, 36, 0], elevation: 3, distance: 150 * k, azimuth: 0, fov: 38 };
    case 'low': return { target: [0, 46, 0], elevation: -12, distance: 88 * k, azimuth: 12, fov: 58 };
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
