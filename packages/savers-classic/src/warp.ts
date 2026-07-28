import {
  sampleTrack,
  defaultParams,
  type ControlTrack,
  type ParamSpace,
  type SaverContext,
  type SaverInstance,
  type SaverManifest,
  type SaverPlugin,
} from '@idle-screens/core';

/**
 * Warp — the original starfield-at-lightspeed. A self-contained canvas2d
 * starfield: each star has a fixed field direction (x, y) plus a per-star
 * phase; its depth along the travel axis at time `t` is a pure function of
 * `t` (no per-frame accumulation), so it projects to screen and draws a
 * motion-streak from a slightly-earlier instant, giving the classic radial
 * warp. Stars fade in over the first ~15% of their travel instead of
 * popping in near the center at full alpha, and fade out again right before
 * they recycle so the wrap is invisible. No external assets.
 *
 * Honours pause (freeze on last frame) + reducedMotion (a single still frame).
 */
const PARAM_SPACE = {
  /** Star count basis. Read only at build time — rebuilding the field live
   *  would reshuffle star identity and break renderFrame purity, so steer
   *  the other knobs to change the feel while live; density only takes
   *  effect on (re)mount. */
  density: { type: 'number', default: 520, min: 120, max: 1400 },
  speed: { type: 'number', default: 1, min: 0.25, max: 3, ease: 'smooth' },
  /** Star color. '#ffffff' is the classic white starfield. */
  tint: { type: 'color', default: '#ffffff' },
  /** Elongation of the per-star motion streak. */
  streak: { type: 'number', default: 0.4, min: 0, max: 1, ease: 'smooth' },
  /** Subtle per-star brightness shimmer. No strobe: each star's shimmer
   *  period is fixed at build (800-1800ms), well under any flash threshold. */
  twinkle: { type: 'number', default: 0.3, min: 0, max: 1, ease: 'smooth' },
} satisfies ParamSpace;

export const warpManifest: SaverManifest = {
  id: 'warp',
  label: 'Warp',
  timeModel: 'closed-form',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'energetic',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  a11y: { flashSafe: true, notes: 'Streaming star field; brightness shimmer is subtle and >=800ms per cycle.' },
  workerReady: true,
};

interface Params {
  density: number;
  speed: number;
  tint: string;
  streak: number;
  twinkle: number;
}

/** A star's fixed identity — its field direction and phase. Forked per index
 *  from the saver's seed at build time, so it never depends on how much of
 *  `ctx.rng`'s stream other code has already consumed, and a resize/rebuild
 *  reproduces the identical field. */
interface StarSeed {
  x: number; // -1..1 field direction
  y: number;
  phase: number; // 0..1 initial travel offset
  twinklePhase: number; // radians
  twinklePeriod: number; // ms, always >= 800
}

/** Progress per ms at speed=1 — tuned so a star's full spawn-to-recycle
 *  traversal takes ~1.4s, matching the original's per-frame feel. */
const BASE_RATE = 0.000727;

const frac = (x: number): number => x - Math.floor(x);

function smoothstep01(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

const FADE_IN_END = 0.15; // fade in over the first 15% of travel
const FADE_OUT_START = 0.94; // fade out over the last ~6%, so recycling is invisible

/** Opacity envelope over a star's travel progress `p` in [0, 1). Pure. */
function fadeEnvelope(p: number): number {
  let e = 1;
  if (p < FADE_IN_END) e *= smoothstep01(p / FADE_IN_END);
  if (p > FADE_OUT_START) e *= smoothstep01((1 - p) / (1 - FADE_OUT_START));
  return e;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const h = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

class WarpInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private w = 0;
  private h = 0;
  private stars: StarSeed[] = [];
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

  private params: Params = defaultParams(PARAM_SPACE) as unknown as Params;
  private track: ControlTrack | null = null;

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
    const c2d = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!c2d) throw new Error('warp: no 2d context');
    this.ctx = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();
    this.buildStars();

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  // ---- params ----
  private applyParams(t: number): void {
    const p = this.track ? sampleTrack(PARAM_SPACE, this.track, t) : this.params;
    for (const k of Object.keys(PARAM_SPACE) as Array<keyof typeof PARAM_SPACE>) {
      const v = (p as Record<string, unknown>)[k];
      if (v !== undefined) (this.params as unknown as Record<string, unknown>)[k] = v;
    }
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Build the star field's fixed identity from forked streams. Deterministic
   *  regardless of how much of `ctx.rng` other code has consumed, and safe
   *  to call again (e.g. a future density change on remount) without
   *  reshuffling existing star identities. */
  private buildStars(): void {
    const count = Math.max(1, Math.round(this.params.density));
    this.stars = new Array(count);
    for (let i = 0; i < count; i++) {
      const r = this.ctxSaver.rng.fork(i);
      this.stars[i] = {
        x: r.range(-1, 1),
        y: r.range(-1, 1),
        phase: r.next(),
        twinklePhase: r.range(0, Math.PI * 2),
        twinklePeriod: r.range(800, 1800),
      };
    }
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
    this.renderFrame(this.t, this.ctxSaver.seed);
  }

  // ---- closed-form travel + draw ----

  /** A star's travel progress at time `t`: 0 = just spawned (near center,
   *  dim), approaches 1 as it nears the eye and is about to recycle. Pure
   *  function of `t` and the star's fixed phase — no accumulation. */
  private progress(star: StarSeed, t: number, rate: number): number {
    return frac(star.phase + t * rate);
  }

  private render(t: number): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const cx = w / 2;
    const cy = h / 2;
    const focal = Math.min(w, h) * 0.9;
    const p = this.params;
    const rate = BASE_RATE * p.speed;
    const [tr, tg, tb] = hexToRgb(p.tint);
    const streakDt = 16 * (1 + p.streak * 5); // ms lookback for the trail's tail point

    // Slight trail for a warm streaking feel.
    ctx.fillStyle = 'rgba(17,17,17,0.45)';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';

    for (const s of this.stars) {
      const prog = this.progress(s, t, rate);
      const z = 1 - prog * 0.99;
      const sx = cx + (s.x / z) * focal;
      const sy = cy + (s.y / z) * focal;

      let progPrev = this.progress(s, t - streakDt, rate);
      if (progPrev > prog) progPrev = prog; // wrapped mid-interval — no bogus cross-screen streak
      const zPrev = 1 - progPrev * 0.99;
      const px = cx + (s.x / zPrev) * focal;
      const py = cy + (s.y / zPrev) * focal;

      // Cull only when BOTH ends of the streak are off-screen — a long streak
      // (high streak/speed) can have its head past the edge while the tail is
      // still visible, and culling on the head alone would pop the whole
      // streak out early.
      const headOut = sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50;
      const tailOut = px < -50 || px > w + 50 || py < -50 || py > h + 50;
      if (headOut && tailOut) continue;

      const envelope = fadeEnvelope(prog);
      const shimmer =
        1 + p.twinkle * 0.4 * Math.sin((2 * Math.PI * t) / s.twinklePeriod + s.twinklePhase);
      const alpha = Math.max(0, Math.min(1, (0.15 + prog * 1.1) * envelope * shimmer));
      if (alpha <= 0.002) continue;
      const size = Math.max(0.4, prog * 2.6);

      ctx.strokeStyle = `rgba(${tr},${tg},${tb},${alpha.toFixed(3)})`;
      ctx.lineWidth = size;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }
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

  /** Pure, frame-addressable render: draw the state at logical time `t` for
   *  `seed`. Identical (t, seed, applied track) always produces the same
   *  frame — safe to seek forward or backward. */
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

/** The Warp starfield saver plugin. */
export const warp: SaverPlugin = {
  manifest: warpManifest,
  mount: (ctx: SaverContext) => new WarpInstance(ctx),
};

/** A demo control-track: speed surges into a burst of longer streaks with a
 *  cool tint, then eases back to the calm white default. ~14s loop.
 *  Deterministic: apply it, then `renderFrame(t, seed)` reproduces every frame. */
export const warpDemoTrack: ControlTrack = {
  program: 'warp',
  seed: 7,
  duration: 14000,
  loop: true,
  deltas: [
    { t: 0, path: 'speed', value: 0.6 },
    { t: 5000, path: 'speed', value: 2.4, ease: 'smooth' },
    { t: 9000, path: 'speed', value: 0.6, ease: 'smooth' },
    { t: 14000, path: 'speed', value: 0.6 },
    { t: 0, path: 'streak', value: 0.15 },
    { t: 5000, path: 'streak', value: 0.9, ease: 'smooth' },
    { t: 9000, path: 'streak', value: 0.15, ease: 'smooth' },
    { t: 14000, path: 'streak', value: 0.15 },
    { t: 0, path: 'tint', value: '#ffffff' },
    { t: 7000, path: 'tint', value: '#8fd8ff', ease: 'smooth' },
    { t: 14000, path: 'tint', value: '#ffffff', ease: 'smooth' },
  ],
};
