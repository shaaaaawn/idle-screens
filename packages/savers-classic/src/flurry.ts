import {
  sampleTrack,
  defaultParams,
  type ControlTrack,
  type ParamSpace,
  type Rng,
  type SaverContext,
  type SaverInstance,
  type SaverManifest,
  type SaverPlugin,
} from '@idle-screens/core';

/**
 * Flurry — the multi-armed glowing particle stream (a macOS "Flurry" homage;
 * this implementation is original, not a port). Several luminous arms weave
 * around the screen center, each trailing a soft additive glow.
 *
 * Modernized to closed-form: an arm's tip is a pure function of (arm, s) — a
 * sum of three seeded sine octaves per axis (harmonic wander). The "trail"
 * that used to come from painting a translucent rect each frame (accumulated
 * pixel state, not seek-safe) is now drawn analytically: every frame samples
 * that same closed form at `s, s - step, s - 2*step, ...` (PARTICLES_PER_ARM
 * points) and connects every consecutive pair with a tapered glow stroke — a
 * continuous ribbon with no history buffer and no gaps (a stroked segment
 * always touches its neighbor, unlike discrete blobs), fading from a
 * bright/fat head to a thin/dim tail. Same (t, seed) always paints the same
 * pixels, so scrubbing/seeking is exact.
 */

const STREAM_COUNT = 5; // preserved default arm count from the original port
// Sample points per arm; consecutive points are connected by a stroked
// segment (see render()), so this controls curve smoothness, not whether the
// ribbon has gaps — continuity comes from stroking, not from density. O(arms
// x this) per frame, still cheap for canvas2d (~1100 stroke calls worst-case
// at 10 arms).
const PARTICLES_PER_ARM = 56;
const BASE_RADIUS = 6;
const STILL_T = 6000; // anchor frame for reducedMotion / renderStill

// The analytic trail's length is expressed as a FRACTION OF THE SCREEN
// DIAGONAL, not a raw time span — that keeps every arm's ribbon a similar
// visual length regardless of its randomized frequency/amplitude (a fast,
// wide-swinging arm needs a much shorter time-span to trace the same pixel
// distance as a slow, tight one). `trail` (0-1) interpolates between these.
const TRAIL_FRAC_MIN = 0.12;
const TRAIL_FRAC_MAX = 0.42; // trail=0.5 (default) lands at ~0.27 — mid of the 20-35% target
// Taper toward the tail: shrink to this fraction of head size, and dim with
// this power of (1 - kFrac) so the head reads bright/fat and the tail reads
// thin/dim (what sells continuous motion, not just a static streak).
const TAIL_SIZE_FLOOR = 0.45;
const TAIL_ALPHA_POWER = 1.4;

const PARAM_SPACE = {
  /** Arm count. Build-time: rebuilt (deterministically, from the same seeded
   *  RNG forks) whenever this changes rather than smoothly animated — more
   *  arms means re-deriving the whole cast, not interpolating between two. */
  arms: { type: 'number', default: STREAM_COUNT, min: 3, max: 10, ease: 'step' },
  speed: { type: 'number', default: 1, min: 0.25, max: 3, ease: 'smooth' },
  /** Additive glow strength: halo reach and brightness of each particle. */
  glow: { type: 'number', default: 0.6, min: 0, max: 1.5, ease: 'smooth' },
  /** How far back each arm's analytic trail reads, as a fraction of the
   *  screen diagonal (0 = short stub, 1 = long flowing ribbon). */
  trail: { type: 'number', default: 0.5, min: 0, max: 1, ease: 'smooth' },
  /** Color scheme. 'spectrum' rotates hue continuously over ~20s — well
   *  outside flash-safety limits, no strobing. */
  palette: { type: 'enum', default: 'aurora', options: ['aurora', 'ember', 'mono', 'spectrum'] },
  size: { type: 'number', default: 1, min: 0.5, max: 2, ease: 'smooth' },
} satisfies ParamSpace;

export const flurryManifest: SaverManifest = {
  id: 'flurry',
  label: 'Flurry',
  description: 'Smooth flowing particle trails like macOS Flurry.',
  timeModel: 'closed-form',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  a11y: {
    flashSafe: true,
    notes: 'Softly glowing arms drifting on black. The spectrum palette rotates hue over ~20s; no flashing.',
  },
  workerReady: true,
};

type Palette = 'aurora' | 'ember' | 'mono' | 'spectrum';

interface Params {
  arms: number;
  speed: number;
  glow: number;
  trail: number;
  palette: Palette;
  size: number;
}

/** One arm's seeded harmonic-wander parameters. Built once (per arm count)
 *  from `ctx.rng.fork(armIndex)` — a pure function of the saver's seed. */
interface ArmPhase {
  freqX1: number;
  freqY1: number;
  freqX2: number;
  freqY2: number;
  freqX3: number;
  freqY3: number;
  phaseX: number;
  phaseY: number;
  ampX: number;
  ampY: number;
  armSpeed: number;
  hueJitter: number;
}

function buildArm(rng: Rng): ArmPhase {
  return {
    freqX1: rng.range(0.3, 0.9),
    freqY1: rng.range(0.3, 0.9),
    freqX2: rng.range(0.1, 0.4),
    freqY2: rng.range(0.1, 0.4),
    freqX3: rng.range(0.04, 0.15),
    freqY3: rng.range(0.04, 0.15),
    phaseX: rng.range(0, Math.PI * 2),
    phaseY: rng.range(0, Math.PI * 2),
    ampX: rng.range(0.2, 0.4),
    ampY: rng.range(0.2, 0.4),
    armSpeed: rng.range(0.6, 1.2),
    hueJitter: rng.range(0, 1),
  };
}

/** Hue for an arm's particle at time `t` (ms). Pure. */
function paletteHue(palette: Palette, arm: ArmPhase, armIndex: number, armCount: number, t: number): number {
  const spread = armCount > 0 ? armIndex / armCount : 0;
  switch (palette) {
    case 'ember':
      return (8 + spread * 46 + arm.hueJitter * 10) % 360; // reds -> oranges -> yellows
    case 'mono':
      return 201 + arm.hueJitter * 14; // narrow cool-blue band, 201-215
    case 'spectrum': {
      const rotation = (t / 20_000) * 360; // one full turn every ~20s — flash-safe
      return (arm.hueJitter * 360 + rotation) % 360;
    }
    case 'aurora':
    default:
      return (150 + spread * 70 + arm.hueJitter * 20) % 360; // green -> cyan -> blue -> violet
  }
}

class FlurryInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly c2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private w = 0;
  private h = 0;
  private arms: ArmPhase[] = [];
  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  /** Logical time the next rAF origin resumes from.
   *
   *  `start()` re-anchors `startT` to the next frame's timestamp, so on its own
   *  `now - startT` always begins at zero. Mount wants that; resuming from a
   *  pause does not — without carrying the frozen `t` forward, every
   *  pause/resume (and every reduced-motion toggle) snaps the scene back to its
   *  opening frame and restarts any applied control track. Set only in
   *  `setPaused(false)`, so first mount still starts at 0. */
  private resumeFrom = 0;
  private t = STILL_T; // anchor frame until the loop (or a seek) moves it

  private params: Params = defaultParams(PARAM_SPACE) as unknown as Params;
  private track: ControlTrack | null = null;

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
    this.w = ctx.width;
    this.h = ctx.height;

    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (ctx.surface) {
      canvas = ctx.surface;
    } else {
      const el = document.createElement('canvas');
      el.style.cssText = 'display:block;width:100%;height:100%';
      el.setAttribute('aria-hidden', 'true');
      ctx.host.appendChild(el);
      canvas = el;
    }
    this.canvas = canvas;
    const c2d = canvas.getContext('2d', { alpha: false }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!c2d) throw new Error('flurry: no 2d context');
    this.c2d = c2d;

    this.sizeCanvas();

    this.paused = ctx.reducedMotion;
    if (this.paused) {
      this.renderStill();
    } else {
      this.start();
    }
  }

  private applyParams(t: number): void {
    const p = this.track ? sampleTrack(PARAM_SPACE, this.track, t) : this.params;
    for (const k of Object.keys(PARAM_SPACE) as Array<keyof typeof PARAM_SPACE>) {
      const v = (p as Record<string, unknown>)[k];
      if (v !== undefined) (this.params as unknown as Record<string, unknown>)[k] = v;
    }
  }

  /** Rebuild the arm cast for a given count, deterministically, from the
   *  saver's own seeded RNG. Pure w.r.t. (ctx.rng, count) — safe to call any
   *  number of times, in any order, from any `t`. Keying off `arms.length`
   *  alone is correct here (not a "rebuild every frame" bug): `ctx.rng`
   *  never changes for this instance and `Rng.fork(salt)` is itself a pure
   *  function of the salt, so a given count always yields the same cast. */
  private ensureArms(count: number): void {
    if (count === this.arms.length) return;
    const out: ArmPhase[] = [];
    for (let i = 0; i < count; i++) out.push(buildArm(this.ctxSaver.rng.fork(i)));
    this.arms = out;
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Closed-form arm-tip position at arm-local time `s` (seconds). Pure. */
  private armTip(arm: ArmPhase, s: number): [number, number] {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const x =
      cx +
      Math.sin(s * arm.freqX1 + arm.phaseX) * this.w * arm.ampX +
      Math.sin(s * arm.freqX2 + arm.phaseX * 1.7) * this.w * arm.ampX * 0.3 +
      Math.sin(s * arm.freqX3 + arm.phaseX * 0.6) * this.w * arm.ampX * 0.12;
    const y =
      cy +
      Math.cos(s * arm.freqY1 + arm.phaseY) * this.h * arm.ampY +
      Math.cos(s * arm.freqY2 + arm.phaseY * 2.1) * this.h * arm.ampY * 0.3 +
      Math.cos(s * arm.freqY3 + arm.phaseY * 1.3) * this.h * arm.ampY * 0.12;
    return [x, y];
  }

  /** Pure render at logical time `t` (ms): background + every arm's analytic trail. */
  private render(t: number): void {
    const c2d = this.c2d;
    const p = this.params;

    c2d.fillStyle = '#000';
    c2d.fillRect(0, 0, this.w, this.h);

    const armCount = Math.max(3, Math.min(10, Math.round(p.arms)));
    this.ensureArms(armCount);

    c2d.globalCompositeOperation = 'lighter';
    // 'butt' (not 'round'): segments are separate stroke() calls, and round
    // caps would add an extra rounded overlap at every shared joint — under
    // additive blending that doubles up into a beaded/scalloped ribbon
    // instead of a smooth one. Samples are dense enough that butt-capped
    // segments abut invisibly.
    c2d.lineCap = 'butt';
    c2d.lineJoin = 'round';

    const globalS = (t / 1000) * p.speed;
    const glow = Math.max(0, Math.min(1.5, p.glow));
    const size = Math.max(0.5, Math.min(2, p.size));
    // Curator tune (workshop batch 1): flurry is LIGHT — the first ribbon
    // pass read as pencil lines. Halo doubled, head alpha lifted.
    const glowReach = 3.6 + glow * 2.6;
    const headAlpha = 0.85 * (0.5 + glow * 0.6);

    // Ribbon length target in pixels: `trail` picks a fraction of the
    // diagonal, shared by every arm.
    const diag = Math.hypot(this.w, this.h);
    const trailFrac = TRAIL_FRAC_MIN + Math.max(0, Math.min(1, p.trail)) * (TRAIL_FRAC_MAX - TRAIL_FRAC_MIN);
    const targetArcPx = trailFrac * diag;
    const avgDim = (this.w + this.h) / 2;

    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i]!;
      const armS = globalS * arm.armSpeed;

      // This arm's characteristic (dominant-octave) angular rate, converted
      // to a per-arm time span that traces ~targetArcPx of screen distance —
      // so a fast-swinging arm gets a short span and a slow one a long span,
      // and both read as roughly the same ribbon length.
      const charRate = Math.max(0.02, (arm.freqX1 * arm.ampX + arm.freqY1 * arm.ampY) / 2);
      const spanS = targetArcPx / (charRate * avgDim);
      const stepS = spanS / (PARTICLES_PER_ARM - 1);

      // Sample the closed form densely, then connect every consecutive pair
      // with a tapered stroke. Unlike discrete blobs (which gap wherever the
      // curve momentarily outruns particle spacing), a stroked segment always
      // touches its neighbor at a shared endpoint — the ribbon reads as
      // continuous regardless of local curvature or speed.
      const pts: Array<[number, number]> = new Array(PARTICLES_PER_ARM);
      for (let k = 0; k < PARTICLES_PER_ARM; k++) pts[k] = this.armTip(arm, armS - k * stepS);

      const hue = paletteHue(p.palette, arm, i, this.arms.length, t);

      for (let k = 0; k < PARTICLES_PER_ARM - 1; k++) {
        const kFrac = (k + 0.5) / (PARTICLES_PER_ARM - 1);
        const r = BASE_RADIUS * size * (1 - kFrac * (1 - TAIL_SIZE_FLOOR));
        const alpha = headAlpha * Math.pow(1 - kFrac, TAIL_ALPHA_POWER);
        const [x0, y0] = pts[k]!;
        const [x1, y1] = pts[k + 1]!;

        // Soft outer halo, then a brighter core — the two-pass stand-in for
        // the old radial-gradient glow, now along a continuous stroke.
        c2d.strokeStyle = `hsla(${hue},85%,58%,${alpha * 0.5})`;
        c2d.lineWidth = Math.max(0.5, r * glowReach);
        c2d.beginPath();
        c2d.moveTo(x0, y0);
        c2d.lineTo(x1, y1);
        c2d.stroke();

        c2d.strokeStyle = `hsla(${hue},95%,74%,${Math.min(1, alpha * 1.15)})`;
        c2d.lineWidth = Math.max(0.5, r * 1.15);
        c2d.beginPath();
        c2d.moveTo(x0, y0);
        c2d.lineTo(x1, y1);
        c2d.stroke();
      }
    }

    c2d.globalCompositeOperation = 'source-over';
  }

  // ---- loop ----
  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.startT = 0;
    this.frameId = requestAnimationFrame((now) => this.loop(now));
  }

  private stop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private loop(now: number): void {
    this.frameId = requestAnimationFrame((n) => this.loop(n));
    if (this.startT === 0) this.startT = now;
    this.renderFrame(now - this.startT + this.resumeFrom, this.ctxSaver.seed);
  }

  /** Freeze on whatever frame we're actually at — not a fixed anchor — so
   *  pausing mid-loop, resizing while paused, or steering a track while
   *  paused all repaint the same instant instead of snapping elsewhere. */
  private renderStill(): void {
    this.renderFrame(this.t, this.ctxSaver.seed);
  }

  // ---- SaverInstance ----
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.stop();
      this.renderStill();
    } else {
      this.resumeFrom = this.t;
      this.start();
    }
  }

  resize(width: number, height: number, dpr?: number): void {
    this.w = width;
    this.h = height;
    if (dpr !== undefined) this.ctxSaver.dpr = dpr;
    this.sizeCanvas();
    if (this.paused) this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
    if (this.paused) this.renderStill();
  }

  /** Pure, frame-addressable render at logical time `t` (ms) for `seed`.
   *  Same (t, seed) always paints the same pixels — seek-back safe. */
  renderFrame(t: number, _seed: number): void {
    this.t = t;
    this.applyParams(t);
    this.render(t);
  }

  dispose(): void {
    this.stop();
    if (typeof HTMLCanvasElement !== 'undefined' && this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
  }
}

export const flurry: SaverPlugin = {
  manifest: flurryManifest,
  mount: (ctx: SaverContext) => new FlurryInstance(ctx),
};

/** A demo control-track: palette shifts aurora -> ember and back while speed
 *  and glow breathe across the cut. Deterministic; not registered anywhere —
 *  callers opt in explicitly. */
export const flurryDemoTrack: ControlTrack = {
  program: 'flurry',
  seed: 3,
  duration: 16_000,
  loop: true,
  deltas: [
    { t: 0, path: 'palette', value: 'aurora' },
    { t: 8000, path: 'palette', value: 'ember' },
    { t: 0, path: 'speed', value: 0.6 },
    { t: 8000, path: 'speed', value: 1.8, ease: 'smooth' },
    { t: 16_000, path: 'speed', value: 0.6, ease: 'smooth' },
    { t: 0, path: 'glow', value: 0.3 },
    { t: 4000, path: 'glow', value: 0.9, ease: 'smooth' },
    { t: 8000, path: 'glow', value: 0.3, ease: 'smooth' },
    { t: 12_000, path: 'glow', value: 0.9, ease: 'smooth' },
    { t: 16_000, path: 'glow', value: 0.3, ease: 'smooth' },
  ],
};
