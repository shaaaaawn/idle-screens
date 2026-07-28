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
 * Mystify — bouncing polygon outlines that morph and leave fading trails.
 * Inspired by the Windows XP "Mystify" screensaver (clean-room recreation;
 * concept is generic). No external assets.
 *
 * Closed-form since July 2026: a vertex bouncing between two walls is a
 * triangle wave, so its position is a FOLD of `x0 + vx·φ` into [0, span] —
 * no integration, no reflection state. The classic ribbon trail (an alpha
 * fade accumulated frame over frame) is instead drawn as GHOSTS: the same
 * polygon evaluated at `t − k·GHOST_MS` with geometrically decaying alpha,
 * oldest first. Both make renderFrame(t, seed) a pure function — mystify is
 * scrubbable and seek-back deterministic.
 *
 * `speed` is live-steerable, so positions advance along the INTEGRAL of the
 * sampled speed (bucketed prefix sum, pure in t) rather than `t·speed` —
 * multiplying raw t by a changing rate teleports every vertex by t·Δrate at
 * each change, the same bug the slipstream dust had.
 */
const PARAM_SPACE = {
  /** How many polygons perform. Identities are stable per slot (seeded
   *  forks), so steering the count never re-rolls the visible shapes. */
  shapes: { type: 'number', default: 3, min: 1, max: 6 },
  /** Motion rate multiplier — integrated, so live changes never teleport. */
  speed: { type: 'number', default: 1, min: 0.25, max: 2.5, ease: 'smooth' },
  /** Trail persistence: 0 = crisp outline, 1 = long dreamy ribbons. */
  trail: { type: 'number', default: 0.55, min: 0, max: 1, ease: 'smooth' },
  /** Stroke width, px. */
  width: { type: 'number', default: 2, min: 1, max: 5, ease: 'smooth' },
  /** Additive hue rotation over each shape's seeded base hue, degrees. */
  hueShift: { type: 'number', default: 0, min: 0, max: 360, ease: 'smooth' },
} satisfies ParamSpace;

type Params = Record<keyof typeof PARAM_SPACE, number>;

export const mystifyManifest: SaverManifest = {
  id: 'mystify',
  label: 'Mystify',
  description: 'Drifting polygons leave fading trails. Inspired by Windows Mystify.',
  timeModel: 'closed-form',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'moderate',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  attribution: {
    source: 'Windows "Mystify" — concept only; clean-room reimplementation',
    license: 'MIT (original code)',
  },
  a11y: { flashSafe: true, notes: 'Slow-fade polygon trails on black; no strobing.' },
  workerReady: true,
};

/** Full identity pool — `shapes` selects a prefix, identities never re-roll. */
const MAX_SHAPES = 6;
/** Ghost spacing. ~The frame cadence the fade used to accumulate at. */
const GHOST_MS = 25;
/** Speed-integral bucket (see phaseAt). */
const PHASE_BUCKET_MS = 250;

interface ShapeId {
  hue: number;
  /** Anchors as viewport fractions, velocities in px/s — resize keeps both. */
  fx: number[];
  fy: number[];
  vx: number[];
  vy: number[];
}

/** Reflect an unbounded coordinate into [0, span] — the triangle wave. */
const fold = (p: number, span: number): number => {
  const period = 2 * span;
  const m = ((p % period) + period) % period;
  return m <= span ? m : period - m;
};

class MystifyInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private w = 0;
  private h = 0;

  private readonly shapes: ShapeId[];

  private track: ControlTrack | null = null;
  private readonly baseParams: Params = defaultParams(PARAM_SPACE) as Params;

  /** Append-only speed-integral caches, one slot per PHASE_BUCKET_MS. */
  private phiPrefix: number[] = [0];
  private phiSpeeds: number[] = [];

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
  private t = 0;

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
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
    if (!c2d) throw new Error('mystify: no 2d context');
    this.ctx = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();
    this.shapes = MystifyInstance.buildShapes(ctx.rng);

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  /** The full identity pool, one fork per slot — count-independent. */
  private static buildShapes(rng: Rng): ShapeId[] {
    const out: ShapeId[] = [];
    for (let s = 0; s < MAX_SHAPES; s++) {
      const f = rng.fork(0xf01d + s);
      const vertCount = f.int(3, 5);
      const hue = f.int(0, 359);
      const id: ShapeId = { hue, fx: [], fy: [], vx: [], vy: [] };
      for (let v = 0; v < vertCount; v++) {
        id.fx.push(f.range(0.15, 0.85));
        id.fy.push(f.range(0.15, 0.85));
        const dir = f.range(0, Math.PI * 2);
        const speed = f.range(70, 150);
        id.vx.push(Math.cos(dir) * speed);
        id.vy.push(Math.sin(dir) * speed);
      }
      out.push(id);
    }
    return out;
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Params at `t` — track-driven when applied, defaults otherwise. */
  private paramsAt(t: number): Params {
    if (!this.track) return this.baseParams;
    const p = sampleTrack(PARAM_SPACE, this.track, t);
    const out = { ...this.baseParams };
    for (const k of Object.keys(PARAM_SPACE) as Array<keyof typeof PARAM_SPACE>) {
      const v = p[k];
      if (typeof v === 'number') out[k] = v;
    }
    return out;
  }

  /** Speed the phase integral uses across one bucket (sampled at its centre). */
  private bucketSpeed(b: number): number {
    let s = this.phiSpeeds[b];
    if (s === undefined) {
      // Buckets fill strictly in order so the prefix sum below stays aligned.
      for (let k = this.phiSpeeds.length; k <= b; k++) {
        this.phiSpeeds[k] = this.paramsAt(k * PHASE_BUCKET_MS + PHASE_BUCKET_MS / 2).speed;
        this.phiPrefix[k + 1] = this.phiPrefix[k]! + this.phiSpeeds[k]! * (PHASE_BUCKET_MS / 1000);
      }
      s = this.phiSpeeds[b]!;
    }
    return s;
  }

  /** ∫ speed dt in seconds — continuous in t, pure (prefix grounds at 0). */
  private phaseAt(t: number): number {
    if (t <= 0) return 0;
    const b = Math.floor(t / PHASE_BUCKET_MS);
    const s = this.bucketSpeed(b);
    return this.phiPrefix[b]! + s * ((t - b * PHASE_BUCKET_MS) / 1000);
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

  private renderStill(): void {
    // At t=0 the trail has no history; park the still where ribbons show.
    const t = this.t === 0 ? 1200 : this.t;
    this.renderFrame(t, this.ctxSaver.seed);
  }

  // ---- draw ----
  private strokeShape(id: ShapeId, phi: number, alpha: number, width: number, hueShift: number): void {
    const ctx = this.ctx;
    const sw = Math.max(1, this.w);
    const sh = Math.max(1, this.h);
    ctx.strokeStyle = `hsla(${(id.hue + hueShift) % 360}, 90%, 62%, ${alpha.toFixed(3)})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let v = 0; v < id.fx.length; v++) {
      const x = fold(id.fx[v]! * sw + id.vx[v]! * phi, sw);
      const y = fold(id.fy[v]! * sh + id.vy[v]! * phi, sh);
      if (v === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  /** Pure, frame-addressable render: black field, ghost trail oldest-first,
   *  live outline last. Everything derives from (t, seed, params-at-t). */
  renderFrame(t: number, _seed: number): void {
    this.t = t;
    const p = this.paramsAt(t);
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const n = Math.max(1, Math.min(MAX_SHAPES, Math.round(p.shapes)));
    // Ghost alphas decay geometrically; `trail` sets the half-life. The
    // classic accumulated fade (0.12/frame at 60fps) sits near trail=0.55.
    const decay = 0.68 + p.trail * 0.29;
    const ghosts = Math.min(48, Math.max(1, Math.ceil(Math.log(0.03 / 0.92) / Math.log(decay))));
    for (let k = ghosts - 1; k >= 0; k--) {
      const tk = t - k * GHOST_MS;
      if (tk < 0) continue;
      const phi = this.phaseAt(tk);
      const alpha = 0.92 * Math.pow(decay, k);
      for (let s = 0; s < n; s++) this.strokeShape(this.shapes[s]!, phi, alpha, p.width, p.hueShift);
    }
  }

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
    // Identities are viewport fractions + px/s velocities — nothing re-rolls.
    if (this.paused) this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
    // The speed integral is param-dependent; reground the prefix sum.
    this.phiPrefix = [0];
    this.phiSpeeds = [];
    if (this.paused) this.renderStill();
  }

  dispose(): void {
    this.stop();
    if (typeof HTMLCanvasElement !== 'undefined' && this.canvas instanceof HTMLCanvasElement) {
      this.canvas.remove();
    }
  }
}

/** The Mystify bouncing-polygon saver plugin. */
export const mystify: SaverPlugin = {
  manifest: mystifyManifest,
  mount: (ctx: SaverContext) => new MystifyInstance(ctx),
};

/** A demo control-track: the classic three ribbons quicken and multiply into
 *  a six-shape colour-shifted weave, then settle back. Deterministic. */
export const mystifyDemoTrack: ControlTrack = {
  program: 'mystify',
  seed: 5,
  duration: 24_000,
  loop: true,
  deltas: [
    { t: 0, path: 'shapes', value: 3 },
    { t: 10_000, path: 'shapes', value: 6 },
    { t: 20_000, path: 'shapes', value: 3 },
    { t: 0, path: 'speed', value: 0.8 },
    { t: 12_000, path: 'speed', value: 2, ease: 'smooth' },
    { t: 24_000, path: 'speed', value: 0.8, ease: 'smooth' },
    { t: 0, path: 'trail', value: 0.45 },
    { t: 12_000, path: 'trail', value: 0.85, ease: 'smooth' },
    { t: 24_000, path: 'trail', value: 0.45, ease: 'smooth' },
    { t: 0, path: 'hueShift', value: 0 },
    { t: 24_000, path: 'hueShift', value: 300, ease: 'smooth' },
  ],
};
