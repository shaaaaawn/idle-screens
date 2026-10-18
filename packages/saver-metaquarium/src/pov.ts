/**
 * A floor walker's own eye: where the follow camera stands when it rides
 * inside Dot, a crab, an octopus, a snail or a starfish (`followDistance`
 * under a body length), and where it looks.
 *
 * Measured on prod (2026-10-17, Dot's first-person show): the eye sat at the
 * walker's feet + 1.5, held at floor + 7, looking level at its own feet 60
 * units on. On Dot that is ankle to knee: curbs, sign posts, basins and the
 * other floor folk filled the frame, and any rise ahead read as a wall.
 *
 * Now the eye is the walker's own, measured once from its model (a screen
 * face, else its eyes, else near the top of its bounds) and scaled with it,
 * and it looks along its heading at eye height, pitched with the seabed
 * ahead so a path up or down a hill stays in frame. Pure in time: the pitch
 * is the mean rise over a few points ahead, no smoothing state, so every
 * display draws the same frames. Swimmers never come here.
 */

/** How far ahead the eye looks, in tank units (the swimmer eye's own reach). */
export const POV_LOOK = 60;
/** Where the seabed is sampled ahead of the walker for the pitch. */
export const POV_PITCH_SAMPLES: readonly number[] = [15, 30, 45];
/** The steepest the eye pitches, up or down (~15°): a cliff ahead tilts the view, it does not fill it. */
export const POV_PITCH_MAX = 0.26;
/** With nothing better to go on, an eye sits this far up the model's height above its feet. */
export const POV_EYE_FALLBACK = 0.85;

/**
 * A walker's eye height in model units above its feet, from its rest pose.
 * `eyes`: the heights of whatever it sees with (a screen face's centre, its
 * eyes' centres); empty when the model names none. Held within its own
 * height (a fifth of it at least), since a mis-named part must not put the
 * eye under the floor or over its antenna.
 */
export function walkerEyeRest(o: { minY: number; maxY: number; anchorY: number; eyes: readonly number[] }): number {
  const h = Math.max(0, o.maxY - Math.max(o.minY, o.anchorY));
  if (!(h > 0)) return 0;
  const seen = o.eyes.filter(Number.isFinite);
  if (!seen.length) return h * POV_EYE_FALLBACK;
  const mean = seen.reduce((a, b) => a + b, 0) / seen.length - o.anchorY;
  return Math.min(h, Math.max(h * 0.2, mean));
}

export interface WalkerPov {
  /** The eye's height. */
  y: number;
  /** Where it looks. */
  tx: number; ty: number; tz: number;
  /** Its pitch, radians, + up. */
  pitch: number;
}

/**
 * The eye of a walker standing with its feet at (x, feet, z), facing the unit
 * (hx, hz), its eye `eye` above them. `ground` is the seabed: its rise ahead,
 * over POV_PITCH_SAMPLES, tilts the look — measured from the seabed under
 * the walker, not its feet, so a jetting octopus looks level over flat sand.
 * `eyeY`, when given, is the eye's height after the camera's own clamps (it
 * may have been lifted over scenery): the look keeps its pitch from there.
 */
export function walkerPov(
  x: number, z: number, hx: number, hz: number, feet: number, eye: number,
  ground: ((x: number, z: number) => number) | null, out: WalkerPov, eyeY?: number,
): WalkerPov {
  let pitch = 0;
  if (ground) {
    const g0 = ground(x, z);
    let rise = 0;
    for (const d of POV_PITCH_SAMPLES) rise += (ground(x + hx * d, z + hz * d) - g0) / d;
    pitch = Math.atan(rise / POV_PITCH_SAMPLES.length);
    if (!Number.isFinite(pitch)) pitch = 0;
    pitch = Math.max(-POV_PITCH_MAX, Math.min(POV_PITCH_MAX, pitch));
  }
  out.y = eyeY ?? feet + eye;
  out.pitch = pitch;
  out.tx = x + hx * POV_LOOK;
  out.ty = out.y + Math.tan(pitch) * POV_LOOK;
  out.tz = z + hz * POV_LOOK;
  return out;
}
