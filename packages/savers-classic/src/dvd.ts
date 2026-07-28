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
 * DVD / Bouncing Logo — the consolidated, modernized descendant of the two
 * "mark bounces around a black screen" savers that used to ship separately:
 *   - `dvd.ts`: a raw rAF physics loop, `vx = 2.4px/frame`, `vy = 2px/frame`
 *     (i.e. 144px/s / 120px/s at an implicit 60fps), colour re-rolled on
 *     every wall hit, DOM/CSS rendering.
 *   - `logo.ts` (retired): a CSS `alternate` keyframe pair, one-way periods
 *     5000ms (x) / 6300ms (y), After Dark "logo" concept, no hit reaction.
 * They were the same saver wearing two sprites. This canvas version keeps the
 * `dvd` id (referenced by e2e) and the CLASSIC bounce-and-flash behaviour as
 * the default, and lets the mark itself — plus three more geometric marks —
 * be a typed, steerable parameter instead of a second saver.
 *
 * Motion is closed-form in `t`: position is a triangle wave per axis (the
 * canvas equivalent of `animation: alternate`), so the wall-hit COUNT at any
 * `t` is `floor(t / onewayPeriod)` — no accumulated velocity/position state,
 * ever. Hue is derived purely from those hit counts (a fixed step per hit,
 * not a re-roll), and "corner party" intensity is the analytic product of
 * both axes' proximity to a simultaneous hit. `BASE_SPEED_X`/`BASE_SPEED_Y`
 * carry dvd.ts's numeric velocity forward (144px/s : 120px/s, ratio 1.2 —
 * close to logo.ts's 6300:5000 = 1.26 period ratio, the same asymmetric
 * diagonal feel both originals had).
 */

const MARKS = ['dvd', 'idle-screens', 'diamond', 'ring'] as const;
type Mark = (typeof MARKS)[number];

const PARAM_SPACE = {
  /** Which shape bounces. 'dvd' = the classic wordmark-in-a-pill. */
  mark: { type: 'enum', default: 'dvd', options: [...MARKS] },
  /** Multiplies both axis speeds (and therefore the wall-hit rate). */
  speed: { type: 'number', default: 1, min: 0.25, max: 3, ease: 'smooth' },
  /** Multiplies the mark's box size. */
  scale: { type: 'number', default: 1, min: 0.5, max: 2, ease: 'smooth' },
  /** Base hue (0-360); each wall hit steps it deterministically from here. */
  hue: { type: 'number', default: 110, min: 0, max: 360, ease: 'smooth' },
  /** Phosphor glow around the mark. */
  glow: { type: 'number', default: 0.25, min: 0, max: 1, ease: 'smooth' },
  /** Burst intensity when both axes hit a wall at once (a corner hit). */
  cornerParty: { type: 'number', default: 0.6, min: 0, max: 1, ease: 'smooth' },
} satisfies ParamSpace;

export const dvdManifest: SaverManifest = {
  id: 'dvd',
  label: 'Bouncing Logo',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  a11y: {
    flashSafe: true,
    notes: 'Hue steps once per wall hit and a brief corner burst on exact corner hits; no strobing.',
  },
  attribution: {
    source: 'DVD player idle screen + After Dark logo bounce — concepts. The DVD-Video logo is a trademark of DVD FLLC',
    license: 'MIT, original implementation; logo drawn from scratch as nostalgic homage (the bouncing-DVD meme) — no third-party assets',
  },
  workerReady: true,
};

interface Params {
  mark: Mark;
  speed: number;
  scale: number;
  hue: number;
  glow: number;
  cornerParty: number;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// dvd.ts's original per-frame velocity (2.4px/frame, 2px/frame) at the
// implicit ~60fps rAF cadence it ran at, converted to px/s.
const BASE_SPEED_X = 144;
const BASE_SPEED_Y = 120;

// dvd.ts's `.dvd-logo` box (200px wide; 58px word + 20px disc + ~6px gap).
const BASE_MARK_W = 200;
const BASE_MARK_H = 84;

// Deterministic hue step per wall hit. Not a multiple of small divisors of
// 360 (so it doesn't cycle through the same handful of hues), but plain
// arithmetic — never `ctx.rng` — so it's reproducible from (t, params) alone.
const HUE_STEP_DEG = 47;

// How close (ms) to an axis's wall-bounce instant counts as "hitting now",
// for both the hue step's edge and the corner-burst falloff window.
const CORNER_BURST_MS = 220;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Triangle wave in [0,1] with one-way period `p` (ms) — the canvas
 *  equivalent of `animation: alternate`. Pure function of `t`. */
function tri(t: number, p: number): number {
  const cycle = p * 2;
  const k = ((t % cycle) + cycle) % cycle;
  return k < p ? k / p : 2 - k / p;
}

/** Wall-bounce count on one axis by time `t`, for a one-way period `p`.
 *  Bounces land on every multiple of `p`. Never accumulated — recomputed
 *  fresh from `t` every call. */
function hitCount(t: number, p: number): number {
  return Math.floor(Math.max(0, t) / p);
}

/** Time-distance (ms) from `t` to the nearest wall-bounce instant on an axis
 *  with one-way period `p`. */
function distToNearestHit(t: number, p: number): number {
  const r = ((t % p) + p) % p;
  return Math.min(r, p - r);
}

class DvdInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly c2d: Ctx2D;

  private w = 0;
  private h = 0;
  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  private t = 0;

  private params: Params = defaultParams(PARAM_SPACE) as unknown as Params;
  private track: ControlTrack | null = null;

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
    if (ctx.surface) {
      this.canvas = ctx.surface;
    } else {
      const el = document.createElement('canvas');
      el.style.cssText = 'display:block;width:100%;height:100%;background:#04050a';
      ctx.host.appendChild(el);
      this.canvas = el;
    }
    const c2d = this.canvas.getContext('2d', { alpha: false }) as Ctx2D | null;
    if (!c2d) throw new Error('dvd: no 2d context');
    this.c2d = c2d;
    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();

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
    this.c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- closed-form geometry ----

  private markSize(): { markW: number; markH: number } {
    const s = this.params.scale;
    return {
      markW: clamp(BASE_MARK_W * s, 60, this.w * 0.7),
      markH: clamp(BASE_MARK_H * s, 26, this.h * 0.7),
    };
  }

  /** One-way traversal periods (ms) for each axis at the current box size
   *  and speed. Pure function of (w, h, markW, markH, speed). */
  private periods(markW: number, markH: number): { px: number; py: number } {
    const distX = Math.max(1, this.w - markW);
    const distY = Math.max(1, this.h - markH);
    const speedX = BASE_SPEED_X * Math.max(0.05, this.params.speed);
    const speedY = BASE_SPEED_Y * Math.max(0.05, this.params.speed);
    return { px: (distX / speedX) * 1000, py: (distY / speedY) * 1000 };
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
    this.renderFrame(now - this.startT, this.ctxSaver.seed);
  }

  private renderStill(): void {
    this.renderFrame(this.t, this.ctxSaver.seed);
  }

  // ---- draw ----

  /** Rounded-rect path built from `arc` + `lineTo` only (no `quadraticCurveTo`/
   *  `roundRect`, to stay inside the minimal Canvas2D surface classic savers
   *  rely on). */
  private roundRectPath(c: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
    c.lineTo(x + w, y + h - rr);
    c.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
    c.lineTo(x + rr, y + h);
    c.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
    c.lineTo(x, y + rr);
    c.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
    c.closePath();
  }

  /** The classic mark, as the meme remembers it: heavy italic "DVD" letters
   *  over the wide disc ellipse with its centre hole. Drawn entirely from
   *  text + ellipse paths — no imported asset. The DVD-Video logo shape is a
   *  trademark of the DVD Format/Logo Licensing Corp; it appears here as the
   *  nostalgic bouncing-logo homage (see CREDITS.md). */
  private drawDvd(c: Ctx2D, x: number, y: number, w: number, h: number, color: string): void {
    // The letters. Real-logo proportions: the wordmark fills the top ~2/3.
    c.save();
    c.fillStyle = color;
    c.font = `italic 900 ${Math.round(h * 0.66)}px "Arial Black", Arial, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('DVD', x + w / 2, y + h * 0.32);
    c.restore();

    // The disc: a wide flat ellipse under the letters, hole knocked out with
    // the background ink (the field is always #04050a — see render()).
    const cx = x + w / 2;
    const cy = y + h * 0.8;
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(cx, cy, w * 0.5, h * 0.155, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#04050a';
    c.beginPath();
    c.ellipse(cx, cy, w * 0.115, h * 0.052, 0, 0, Math.PI * 2);
    c.fill();
  }

  private drawWordmark(c: Ctx2D, x: number, y: number, w: number, h: number, color: string): void {
    c.fillStyle = color;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 ${Math.round(h * 0.32)}px ui-rounded, "Avenir Next", system-ui, sans-serif`;
    c.fillText('idle-screens', x + w / 2, y + h / 2);
  }

  private drawDiamond(c: Ctx2D, x: number, y: number, w: number, h: number, color: string): void {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const s = Math.min(w, h) * 0.62;
    c.save();
    c.translate(cx, cy);
    c.rotate(Math.PI / 4);
    c.fillStyle = color;
    c.fillRect(-s / 2, -s / 2, s, s);
    c.restore();
  }

  private drawRing(c: Ctx2D, x: number, y: number, w: number, h: number, color: string): void {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) * 0.4;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.strokeStyle = color;
    c.lineWidth = Math.max(4, r * 0.34);
    c.stroke();
  }

  private drawMark(mark: Mark, c: Ctx2D, x: number, y: number, w: number, h: number, color: string): void {
    switch (mark) {
      case 'idle-screens':
        this.drawWordmark(c, x, y, w, h, color);
        break;
      case 'diamond':
        this.drawDiamond(c, x, y, w, h, color);
        break;
      case 'ring':
        this.drawRing(c, x, y, w, h, color);
        break;
      case 'dvd':
      default:
        this.drawDvd(c, x, y, w, h, color);
        break;
    }
  }

  /** A tiny sparkle burst — the "corner party" — purely a function of how
   *  close both axes are to hitting simultaneously right now. */
  private drawBurst(c: Ctx2D, cx: number, cy: number, intensity: number, hue: number): void {
    const rays = 8;
    const radius = 10 + 46 * intensity;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      c.strokeStyle = `hsla(${hue.toFixed(1)}, 92%, 72%, ${(0.85 * intensity).toFixed(3)})`;
      c.lineWidth = 1.5 + 3 * intensity;
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      c.stroke();
    }
    c.restore();
  }

  /** Pure render at logical time `t` for `seed`: everything below is a closed
   *  -form function of (t, seed, this.w, this.h, this.params) — nothing is
   *  read from or written to accumulated instance state. */
  private render(t: number, seed: number): void {
    const c = this.c2d;
    c.fillStyle = '#04050a';
    c.fillRect(0, 0, this.w, this.h);

    const { markW, markH } = this.markSize();
    const { px, py } = this.periods(markW, markH);
    // A deterministic per-seed time offset (plain arithmetic on the seed
    // argument, never ctx.rng) so different seeds land on different bounce
    // phases without breaking (seed, t) purity.
    const shifted = t + (Math.abs(seed) * 233) % 5000;

    const x = tri(shifted, px) * Math.max(0, this.w - markW);
    const y = tri(shifted, py) * Math.max(0, this.h - markH);

    const hits = hitCount(shifted, px) + hitCount(shifted, py);
    const hue = ((this.params.hue + hits * HUE_STEP_DEG) % 360 + 360) % 360;
    const color = `hsl(${hue.toFixed(1)}, 78%, 56%)`;

    if (this.params.glow > 0.02) {
      c.shadowColor = color;
      c.shadowBlur = 26 * this.params.glow;
    } else {
      c.shadowBlur = 0;
    }
    this.drawMark(this.params.mark, c, x, y, markW, markH, color);
    c.shadowBlur = 0;

    // Corner hit = both axes hitting a wall at (nearly) the same instant —
    // detected analytically from each axis's distance to its own next/last
    // bounce, with no memory of past hits required.
    const ax = Math.max(0, 1 - distToNearestHit(shifted, px) / CORNER_BURST_MS);
    const ay = Math.max(0, 1 - distToNearestHit(shifted, py) / CORNER_BURST_MS);
    const cornerIntensity = this.params.cornerParty * ax * ax * ay * ay;
    if (cornerIntensity > 0.002) {
      this.drawBurst(c, x + markW / 2, y + markH / 2, cornerIntensity, hue);
    }
  }

  // ---- SaverInstance ----
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.stop();
      this.renderStill();
    } else {
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

  /** Pure, frame-addressable render: draw the state at logical time `t` for `seed`. */
  renderFrame(t: number, seed: number): void {
    this.t = t;
    this.applyParams(t);
    this.render(t, seed);
  }

  dispose(): void {
    this.stop();
    if (typeof HTMLCanvasElement !== 'undefined' && this.canvas instanceof HTMLCanvasElement) {
      this.canvas.remove();
    }
  }
}

/** The DVD / Bouncing Logo saver plugin. */
export const dvd: SaverPlugin = {
  manifest: dvdManifest,
  mount: (ctx: SaverContext) => new DvdInstance(ctx),
};

/** A demo control-track: cycles through all four marks, sweeps the base hue,
 *  and pumps the speed up and down. ~16s, loops. Deterministic. */
export const dvdDemoTrack: ControlTrack = {
  program: 'dvd',
  seed: 7,
  duration: 16_000,
  loop: true,
  deltas: [
    // The DVD logo IS the act; the other marks get a quick tour at the end.
    { t: 0, path: 'mark', value: 'dvd' },
    { t: 10_000, path: 'mark', value: 'diamond' },
    { t: 12_000, path: 'mark', value: 'ring' },
    { t: 14_000, path: 'mark', value: 'idle-screens' },
    { t: 0, path: 'hue', value: 110 },
    { t: 8000, path: 'hue', value: 280, ease: 'smooth' },
    { t: 16_000, path: 'hue', value: 110, ease: 'smooth' },
    { t: 0, path: 'speed', value: 0.8 },
    { t: 8000, path: 'speed', value: 1.7, ease: 'smooth' },
    { t: 16_000, path: 'speed', value: 0.8, ease: 'smooth' },
  ],
};
