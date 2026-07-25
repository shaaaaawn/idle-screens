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
 * Typed knobs an agent can steer via a control-track. Everything here is read
 * per frame and is a pure function of `t` — there is no integrated state
 * anywhere in this saver, so `renderFrame(t, seed)` reproduces a frame exactly,
 * including the live page's transforms. `bubbleCount` is read only at build.
 */
const PARAM_SPACE = {
  /** Fraction of the viewport submerged, measured from the bottom. >1 = fully under. */
  waterLevel: { type: 'number', default: 0.55, min: 0, max: 1.2, ease: 'smooth' },
  /** Peak-to-peak sweep of the tide around `waterLevel`. 0 = a still, fixed level. */
  tideSwing: { type: 'number', default: 0.9, min: 0, max: 1.2, ease: 'smooth' },
  /** Milliseconds for one full ebb -> flood -> ebb. Matches `demoTrack.duration`,
   *  so the workbench timeline covers exactly one cycle. */
  tideCycleMs: { type: 'number', default: 24000, min: 6000, max: 90000, ease: 'smooth' },
  /** Refraction amplitude in CSS px — how far submerged content is pushed around. */
  waveAmp: { type: 'number', default: 15, min: 0, max: 40, ease: 'smooth' },
  /** Spatial frequency multiplier. Higher = shorter wavelength = more shear per element. */
  waveScale: { type: 'number', default: 1, min: 0.3, max: 3, ease: 'smooth' },
  /** Time multiplier for the refraction field and the surface. */
  waveSpeed: { type: 'number', default: 1, min: 0, max: 3, ease: 'smooth' },
  /** Surface-line wave amplitude in CSS px. */
  surfaceAmp: { type: 'number', default: 15, min: 0, max: 48, ease: 'smooth' },
  /**
   * How much of the local field *derivative* reaches the page. 0 = every victim
   * merely translates (the black-hole behaviour); 1 = victims shear and stretch
   * with the wave; >1 = gooey.
   */
  shear: { type: 'number', default: 1, min: 0, max: 2, ease: 'smooth' },
  /** How strongly light content is pulled up to raft on the surface. */
  buoyancy: { type: 'number', default: 1, min: 0, max: 1.5, ease: 'smooth' },
  /** Lateral sway of rafting content, in CSS px. */
  drift: { type: 'number', default: 14, min: 0, max: 60, ease: 'smooth' },
  /** Depth-of-field blur on sunken content (multiplier on ~2.2px max). */
  depthBlur: { type: 'number', default: 1, min: 0, max: 2.5, ease: 'smooth' },
  /** Darkness/saturation of the water body drawn over the page. */
  depthTint: { type: 'number', default: 1, min: 0, max: 1.6, ease: 'smooth' },
  /** Brightness of the light shafts descending from the surface. */
  caustics: { type: 'number', default: 1, min: 0, max: 2, ease: 'smooth' },
  /** Rising bubbles. Read once at build. */
  bubbleCount: { type: 'number', default: 90, min: 0, max: 300 },
} satisfies ParamSpace;

export const tideManifest: SaverManifest = {
  id: 'tide',
  label: 'Tide',
  passthrough: true,
  minBackend: 'canvas2d',
  costTier: 'medium',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  a11y: {
    flashSafe: true,
    notes: 'Slow water. No flashing; caustics drift over seconds at low amplitude.',
  },
};

/** Generic content selector a passthrough saver eats. Hosts can override later. */
const VICTIM_SELECTOR =
  'main :is(h1,h2,h3,h4,p,li,img,a,button), nav a, header a, footer a, .card, [data-idle-victim]';

/** Bound the per-frame style-write cost on very dense pages. */
const MAX_VICTIMS = 240;

/** Hard safety clamp on each Jacobian entry: keeps det(I + J) >= 0.2 (never mirrored). */
const J_CLAMP = 0.4;

/** Salt for the per-victim RNG fork — see `collectVictims`. */
const VICTIM_SALT = 0x71de;

/** Refraction wave: normalized cycles across the short viewport edge. */
interface Wave {
  a: number;
  cx: number;
  cy: number;
  w: number;
  ph: number;
  /** Vertical coupling: how much of this wave's energy displaces along y. */
  vy: number;
}

/** Surface-line wave (1-D, along x). */
interface SurfWave {
  a: number;
  c: number;
  w: number;
  ph: number;
}

interface Bubble {
  x: number;
  r: number;
  speed: number;
  ph: number;
  sway: number;
}

interface Victim {
  el: HTMLElement;
  /** Untransformed viewport-space centre + half-extents, cached at collect time. */
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  /** 0..1 buoyancy affinity — small, light blocks raft, large blocks sink. */
  buoy: number;
  /** How far below the surface line this one rides once rafting, in px. */
  draft: number;
  bobAmp: number;
  bobPh: number;
  rockPh: number;
  prevTransform: string;
  prevOrigin: string;
  prevFilter: string;
  prevWillChange: string;
  prevTransition: string;
  /** Last written style strings — we only touch the DOM when they actually change. */
  lastTransform: string;
  lastFilter: string;
}

/** Local displacement field sample: offset plus its analytic Jacobian. */
interface FieldSample {
  ux: number;
  uy: number;
  /** d(ux)/dx */
  uxx: number;
  /** d(ux)/dy */
  uxy: number;
  /** d(uy)/dx */
  uyx: number;
  /** d(uy)/dy */
  uyy: number;
}

type Params = Record<keyof typeof PARAM_SPACE, number>;

const TAU = Math.PI * 2;
/** Base angular rate, rad/ms, before `waveSpeed`. */
const BASE_W = 0.00042;
/** Depth over which the refraction envelope ramps in below the surface, in px. */
const FEATHER = 46;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smooth01 = (k: number): number => k * k * (3 - 2 * k);

class TideInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private w = 0;
  private h = 0;
  /** Short edge — every length in the field is expressed relative to this. */
  private s = 1;

  private waves: Wave[] = [];
  private surf: SurfWave[] = [];
  private bubbles: Bubble[] = [];
  private shafts: { x: number; w: number; ph: number }[] = [];
  private victims: Victim[] = [];

  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  private t = 0;

  private params: Params = defaultParams(PARAM_SPACE) as Params;
  private track: ControlTrack | null = null;

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    ctx.host.appendChild(canvas);
    this.canvas = canvas;
    const c2d = canvas.getContext('2d', { alpha: true });
    if (!c2d) throw new Error('tide: no 2d context');
    this.ctx = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.build();
    this.measure();
    this.sizeCanvas();
    this.collectVictims();

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  // ---- build (seeded, once) ----
  private build(): void {
    const rng = this.ctxSaver.rng;

    const waveN = 4;
    const raw: Wave[] = [];
    let sum = 0;
    for (let i = 0; i < waveN; i++) {
      const a = 0.35 + rng.next() * 0.65;
      sum += a;
      raw.push({
        a,
        cx: 0.8 + rng.next() * 2.4,
        cy: 0.3 + rng.next() * 1.3,
        w: 0.45 + rng.next() * 0.7,
        ph: rng.next() * TAU,
        vy: 0.25 + rng.next() * 0.4,
      });
    }
    for (const wv of raw) wv.a /= sum;
    this.waves = raw;

    const surfN = 3;
    const rawS: SurfWave[] = [];
    let sSum = 0;
    for (let i = 0; i < surfN; i++) {
      const a = 0.4 + rng.next() * 0.6;
      sSum += a;
      rawS.push({ a, c: 0.5 + rng.next() * 1.8, w: 0.35 + rng.next() * 0.6, ph: rng.next() * TAU });
    }
    for (const sw of rawS) sw.a /= sSum;
    this.surf = rawS;

    const n = Math.round(this.params.bubbleCount);
    this.bubbles = new Array(n);
    for (let i = 0; i < n; i++) {
      this.bubbles[i] = {
        x: rng.next(),
        r: 0.7 + Math.pow(rng.next(), 2) * 3.4,
        speed: 0.00004 + rng.next() * 0.00009,
        ph: rng.next(),
        sway: rng.next() * TAU,
      };
    }

    this.shafts = [];
    for (let i = 0; i < 15; i++) {
      this.shafts.push({ x: rng.next(), w: 0.02 + rng.next() * 0.07, ph: rng.next() * TAU });
    }
  }

  // ---- params / geometry ----
  private applyParams(t: number): void {
    const p = this.track ? sampleTrack(PARAM_SPACE, this.track, t) : this.params;
    for (const k of Object.keys(PARAM_SPACE) as Array<keyof typeof PARAM_SPACE>) {
      const v = p[k];
      this.params[k] = typeof v === 'number' ? v : this.params[k];
    }
  }

  private measure(): void {
    this.s = Math.max(1, Math.min(this.w, this.h));
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- the tide (closed form in t) ----

  /** Submerged fraction of the viewport at `t`, measured up from the bottom. */
  private level(t: number): number {
    const cyc = Math.max(1, this.params.tideCycleMs);
    const p = (((t % cyc) + cyc) % cyc) / cyc;
    const tri = p < 0.5 ? p * 2 : 2 - p * 2;
    return this.params.waterLevel - this.params.tideSwing * 0.5 + this.params.tideSwing * smooth01(tri);
  }

  /** Still-water line, in viewport y. */
  private baseY(t: number): number {
    return this.h * (1 - this.level(t));
  }

  /** Surface height at `x`. */
  private surfaceY(x: number, t: number): number {
    const k = (TAU / this.s) * this.params.waveScale;
    const wt = BASE_W * this.params.waveSpeed * t;
    let y = 0;
    for (const sw of this.surf) y += sw.a * Math.sin(sw.c * k * x - sw.w * wt + sw.ph);
    return this.baseY(t) + y * this.params.surfaceAmp;
  }

  /** d(surfaceY)/dx — the surface slope, used for raft tilt and caustic strength. */
  private surfaceSlope(x: number, t: number): number {
    const k = (TAU / this.s) * this.params.waveScale;
    const wt = BASE_W * this.params.waveSpeed * t;
    let dy = 0;
    for (const sw of this.surf) dy += sw.a * sw.c * k * Math.cos(sw.c * k * x - sw.w * wt + sw.ph);
    return dy * this.params.surfaceAmp;
  }

  /**
   * Refraction displacement at a point, with its analytic Jacobian.
   *
   * This is the whole trick: because the field is a closed-form sum of sines we
   * know d(u)/d(x,y) exactly, so a victim can be given the *linearisation* of
   * the field over its own box — a real affine transform — instead of the rigid
   * translate+scale a single point sample would allow.
   */
  private field(x: number, y: number, t: number): FieldSample {
    const out: FieldSample = { ux: 0, uy: 0, uxx: 0, uxy: 0, uyx: 0, uyy: 0 };
    const amp = this.params.waveAmp;
    if (amp <= 0) return out;

    const d = y - this.surfaceY(x, t);
    if (d <= 0) return out;

    // Envelope: ramps in just below the surface, then holds. Its own gradient
    // matters — it is what makes content stretch as it crosses the waterline.
    let env: number;
    let envD: number; // d(env)/d(depth)
    if (d >= FEATHER) {
      env = 1;
      envD = 0;
    } else {
      const k = d / FEATHER;
      env = smooth01(k);
      envD = (6 * k * (1 - k)) / FEATHER;
    }
    env *= amp;
    envD *= amp;
    // depth = y - surfaceY(x), so d(depth)/dx = -slope and d(depth)/dy = 1.
    const envX = envD * -this.surfaceSlope(x, t);
    const envY = envD;

    const k = (TAU / this.s) * this.params.waveScale;
    const wt = BASE_W * this.params.waveSpeed * t;

    let sx = 0; // sum a*sin           (x carrier)
    let cx = 0; // sum a*fx*cos
    let cy = 0; // sum a*fy*cos
    let vc = 0; // sum a*vy*cos        (y carrier)
    let vsx = 0; // sum a*vy*fx*sin
    let vsy = 0; // sum a*vy*fy*sin

    for (const wv of this.waves) {
      const fx = wv.cx * k;
      const fy = wv.cy * k;
      const th = fx * x + fy * y - wv.w * wt + wv.ph;
      const si = Math.sin(th);
      const co = Math.cos(th);
      sx += wv.a * si;
      cx += wv.a * fx * co;
      cy += wv.a * fy * co;
      vc += wv.a * wv.vy * co;
      vsx += wv.a * wv.vy * fx * si;
      vsy += wv.a * wv.vy * fy * si;
    }

    out.ux = env * sx;
    out.uy = env * vc;
    out.uxx = env * cx + envX * sx;
    out.uxy = env * cy + envY * sx;
    out.uyx = -env * vsx + envX * vc;
    out.uyy = -env * vsy + envY * vc;
    return out;
  }

  // ---- page victims (passthrough) ----
  private collectVictims(): void {
    this.victims = [];
    const page = this.ctxSaver.page;
    if (!page) return;
    let els = page.victims(VICTIM_SELECTOR);
    // De-nest: a container and its child must not both be victims, or the
    // child's transform (and filter) would be applied twice.
    els = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
    // A FORK, not the shared stream: `resize()` re-collects, and drawing from
    // the running stream would hand every block a different buoyancy/draft the
    // second time round — the same (seed, t) would stop reproducing the frame.
    // `fork` derives from the original seed, so each collect gets the same one.
    const rng = this.ctxSaver.rng.fork(VICTIM_SALT);
    for (const el of els) {
      if (this.victims.length >= MAX_VICTIMS) break;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 6) continue;
      if (r.bottom < -40 || r.top > this.h + 40) continue;
      if (r.right < 0 || r.left > this.w) continue;

      // Buoyancy from footprint: a nav link bobs up, a hero image sinks.
      const area = r.width * r.height;
      const heavy = clamp((area - 6_000) / 90_000, 0, 1);
      const buoy = clamp((1 - smooth01(heavy)) * (0.55 + rng.next() * 0.45), 0, 1);

      this.victims.push({
        el,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        hw: r.width / 2,
        hh: r.height / 2,
        buoy,
        draft: 3 + rng.next() * 22,
        bobAmp: 2 + rng.next() * 7,
        bobPh: rng.next() * TAU,
        rockPh: rng.next() * TAU,
        prevTransform: el.style.transform,
        prevOrigin: el.style.transformOrigin,
        prevFilter: el.style.filter,
        prevWillChange: el.style.willChange,
        prevTransition: el.style.transition,
        lastTransform: '',
        lastFilter: '',
      });
      el.style.willChange = 'transform, filter';
      el.style.transition = 'none';
      // The affine we build is centre-relative; page CSS may say otherwise.
      el.style.transformOrigin = '50% 50%';
    }
  }

  private restoreVictims(): void {
    for (const v of this.victims) {
      v.el.style.transform = v.prevTransform;
      v.el.style.transformOrigin = v.prevOrigin;
      v.el.style.filter = v.prevFilter;
      v.el.style.willChange = v.prevWillChange;
      v.el.style.transition = v.prevTransition;
    }
    this.victims = [];
  }

  /** Write only what changed — dense pages stay cheap and the DOM stays quiet. */
  private write(v: Victim, transform: string, filter: string): void {
    if (transform !== v.lastTransform) {
      v.el.style.transform = transform;
      v.lastTransform = transform;
    }
    if (filter !== v.lastFilter) {
      v.el.style.filter = filter;
      v.lastFilter = filter;
    }
  }

  /**
   * Give one victim the field's local affine. Pure in `t` — nothing here reads
   * or accumulates prior frames, which is why the page's own deformation is
   * frame-addressable and not just the canvas overlay.
   */
  private applyVictim(v: Victim, t: number): void {
    const surfY = this.surfaceY(v.cx, t);
    const depth = v.cy - surfY;

    if (depth <= 0) {
      // Dry. Hand it back exactly as we found it.
      this.write(v, v.prevTransform, v.prevFilter);
      return;
    }

    const f = this.field(v.cx, v.cy, t);
    const wt = BASE_W * this.params.waveSpeed * t;

    // Buoyancy: the deeper the water gets over it, the harder a light block is
    // pulled up to raft on the surface. Depth-driven, so it is reversible and
    // needs no latch.
    const lift = clamp(v.buoy * this.params.buoyancy * smooth01(clamp(depth / (this.s * 0.2), 0, 1)), 0, 1);
    const targetY = surfY + v.draft + v.hh * 0.15;
    const riseY = (targetY - v.cy) * lift;
    const bobY = lift * v.bobAmp * Math.sin(wt * 1.9 + v.bobPh);
    const swayX = lift * this.params.drift * Math.sin(wt * 1.15 + v.bobPh * 0.7);

    const tx = f.ux + swayX;
    const ty = f.uy + riseY + bobY;

    // Rafting content lies along the surface; sunken content only shears.
    const tilt =
      lift * (Math.atan(this.surfaceSlope(v.cx, t)) * 0.75 + 0.06 * Math.sin(wt * 1.4 + v.rockPh));

    // Linear part: I + shear * J, clamped so the matrix can never invert.
    const sh = this.params.shear;
    const a0 = 1 + clamp(f.uxx * sh, -J_CLAMP, J_CLAMP);
    const b0 = clamp(f.uyx * sh, -J_CLAMP, J_CLAMP);
    const c0 = clamp(f.uxy * sh, -J_CLAMP, J_CLAMP);
    const d0 = 1 + clamp(f.uyy * sh, -J_CLAMP, J_CLAMP);

    // Compose R(tilt) * (I + J). CSS matrix(a,b,c,d,e,f) is column-major:
    // x' = a*x + c*y + e, y' = b*x + d*y + f.
    const co = Math.cos(tilt);
    const si = Math.sin(tilt);
    const a = co * a0 - si * b0;
    const b = si * a0 + co * b0;
    const c = co * c0 - si * d0;
    const d = si * c0 + co * d0;

    const transform =
      `matrix(${a.toFixed(4)},${b.toFixed(4)},${c.toFixed(4)},${d.toFixed(4)},` +
      `${tx.toFixed(1)},${ty.toFixed(1)})`;

    // Depth of field: whatever did not float sinks out of focus.
    const sunk = (1 - lift) * clamp(depth / (this.s * 0.55), 0, 1);
    let filter = v.prevFilter;
    if (sunk > 0.02 && this.params.depthBlur > 0) {
      // Quantised so the string is stable across neighbouring frames.
      const blur = Math.round(sunk * this.params.depthBlur * 2.2 * 4) / 4;
      const sat = Math.round((1 - sunk * 0.55) * 20) / 20;
      const bri = Math.round((1 - sunk * 0.3) * 20) / 20;
      // A no-op filter still forces a containing block + compositing pass, so
      // only set one once it actually does something.
      if (blur > 0 || sat < 1 || bri < 1) {
        filter = `blur(${blur}px) saturate(${sat}) brightness(${bri})`;
      }
    }
    this.write(v, transform, filter);
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

  /** Sample the surface across the viewport once; both the fill and the line use it. */
  private surfacePath(t: number): { xs: number[]; ys: number[] } {
    const step = 18;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = -step; x <= this.w + step; x += step) {
      xs.push(x);
      ys.push(this.surfaceY(x, t));
    }
    return { xs, ys };
  }

  private render(t: number): void {
    const ctx = this.ctx;
    ctx.setTransform(Math.min(this.ctxSaver.dpr, 2), 0, 0, Math.min(this.ctxSaver.dpr, 2), 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'source-over';

    const lvl = this.level(t);
    if (lvl <= 0) return;

    const { xs, ys } = this.surfacePath(t);
    let top = this.h;
    for (const y of ys) if (y < top) top = y;
    if (top > this.h) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(xs[0] as number, ys[0] as number);
    for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i] as number, ys[i] as number);
    ctx.lineTo(this.w + 24, this.h + 24);
    ctx.lineTo(-24, this.h + 24);
    ctx.closePath();
    ctx.clip();

    this.drawBody(top);
    this.drawShafts(t);
    this.drawBubbles(t, xs, ys);
    ctx.restore();

    this.drawSurface(t, xs, ys);
    this.drawWakes(t);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** The water itself: a translucent depth gradient, so the page still reads through. */
  private drawBody(top: number): void {
    const ctx = this.ctx;
    const tint = this.params.depthTint;
    const g = ctx.createLinearGradient(0, top, 0, this.h);
    g.addColorStop(0, `rgba(96,178,196,${(0.1 * tint).toFixed(3)})`);
    g.addColorStop(0.18, `rgba(24,86,116,${(0.26 * tint).toFixed(3)})`);
    g.addColorStop(0.62, `rgba(9,42,72,${(0.5 * tint).toFixed(3)})`);
    g.addColorStop(1, `rgba(3,16,34,${(0.7 * tint).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(-24, top - 4, this.w + 48, this.h - top + 32);
  }

  /** Light shafts refracted through the surface — slow, low-amplitude, flash-safe. */
  private drawShafts(t: number): void {
    const ctx = this.ctx;
    const gain = this.params.caustics;
    if (gain <= 0) return;
    const wt = BASE_W * this.params.waveSpeed * t;
    ctx.globalCompositeOperation = 'lighter';
    for (const sh of this.shafts) {
      const x = (sh.x + 0.05 * Math.sin(wt * 0.42 + sh.ph)) * this.w;
      const y0 = this.surfaceY(x, t);
      // Bright where the surface lenses light together (slope crossing zero).
      const focus = 0.45 + 0.55 * Math.abs(Math.cos(wt * 0.7 + sh.ph));
      const alpha = 0.055 * gain * focus;
      if (alpha < 0.002) continue;
      const wTop = sh.w * this.s * 0.5;
      const wBot = wTop * 3.2;
      const bottom = this.h + 40;
      const g = ctx.createLinearGradient(0, y0, 0, bottom);
      g.addColorStop(0, `rgba(186,236,255,${alpha.toFixed(4)})`);
      g.addColorStop(0.45, `rgba(140,206,240,${(alpha * 0.45).toFixed(4)})`);
      g.addColorStop(1, 'rgba(90,160,210,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - wTop, y0);
      ctx.lineTo(x + wTop, y0);
      ctx.lineTo(x + wBot, bottom);
      ctx.lineTo(x - wBot, bottom);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawBubbles(t: number, xs: number[], ys: number[]): void {
    const ctx = this.ctx;
    if (!this.bubbles.length) return;
    const wt = BASE_W * this.params.waveSpeed * t;
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bubbles) {
      const p = (((t * b.speed + b.ph) % 1) + 1) % 1;
      const x = b.x * this.w + Math.sin(wt * 2.1 + b.sway) * 10;
      const idx = clamp(Math.round((x - (xs[0] as number)) / 18), 0, ys.length - 1);
      const surfY = ys[idx] as number;
      if (surfY >= this.h) continue;
      const y = this.h + 20 - p * (this.h + 20 - surfY);
      const fade = p < 0.06 ? p / 0.06 : p > 0.92 ? (1 - p) / 0.08 : 1;
      ctx.fillStyle = `rgba(198,238,255,${(0.3 * fade).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, b.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawSurface(t: number, xs: number[], ys: number[]): void {
    const ctx = this.ctx;
    // A soft scattering band hugging the line from above.
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(xs[0] as number, ys[0] as number);
    for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i] as number, ys[i] as number);
    ctx.strokeStyle = 'rgba(178,232,248,0.16)';
    ctx.lineWidth = 14;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(226,250,255,0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Foam beads riding the crests.
    const wt = BASE_W * this.params.waveSpeed * t;
    for (let i = 0; i < xs.length; i += 2) {
      const x = xs[i] as number;
      const slope = this.surfaceSlope(x, t);
      const crest = 1 - Math.min(1, Math.abs(slope) * 4);
      if (crest < 0.35) continue;
      const a = 0.22 * crest * (0.6 + 0.4 * Math.sin(wt * 2.4 + i));
      ctx.fillStyle = `rgba(240,253,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, (ys[i] as number) - 1, 1.1 + crest * 1.6, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Where a rafting block meets the line, the water shows it: a bright wake. */
  private drawWakes(t: number): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const v of this.victims) {
      const surfY = this.surfaceY(v.cx, t);
      const depth = v.cy - surfY;
      if (depth <= 0) continue;
      const lift = clamp(
        v.buoy * this.params.buoyancy * smooth01(clamp(depth / (this.s * 0.2), 0, 1)),
        0,
        1,
      );
      if (lift < 0.2) continue;
      const wt = BASE_W * this.params.waveSpeed * t;
      const x = v.cx + lift * this.params.drift * Math.sin(wt * 1.15 + v.bobPh * 0.7);
      const rx = Math.min(v.hw * 1.15, this.w * 0.3);
      const a = 0.2 * (lift - 0.2);
      ctx.strokeStyle = `rgba(214,246,255,${a.toFixed(3)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, surfY + v.draft, rx, 5 + rx * 0.05, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
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
    this.restoreVictims();
    this.measure();
    this.sizeCanvas();
    this.collectVictims();
    if (this.paused) this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
    if (this.paused) this.renderStill();
  }

  /**
   * Pure, frame-addressable render at logical time `t` — canvas *and* page.
   * Unlike a saver that integrates its page state per frame, seeking backwards
   * here reproduces the earlier frame exactly, victims included.
   */
  renderFrame(t: number, _seed: number): void {
    this.t = t;
    this.applyParams(t);
    this.measure();
    for (const v of this.victims) this.applyVictim(v, t);
    this.render(t);
  }

  dispose(): void {
    this.stop();
    this.restoreVictims();
    this.canvas.remove();
  }
}

/** The tide saver plugin. */
export const tide: SaverPlugin = {
  manifest: tideManifest,
  mount: (ctx: SaverContext) => new TideInstance(ctx),
};

/** A demo control-track: one slow flood, then the water goes glassy and clears.
 *  Deterministic: apply it, then `renderFrame(t, seed)` reproduces every frame. */
export const demoTrack: ControlTrack = {
  program: 'tide',
  seed: 7,
  duration: 24000,
  loop: true,
  deltas: [
    { t: 0, path: 'waterLevel', value: 0.15 },
    { t: 12000, path: 'waterLevel', value: 1.05, ease: 'smooth' },
    { t: 24000, path: 'waterLevel', value: 0.15, ease: 'smooth' },
    { t: 0, path: 'tideSwing', value: 0 },
    { t: 0, path: 'shear', value: 1.4 },
    { t: 14000, path: 'shear', value: 0.15, ease: 'smooth' },
    { t: 24000, path: 'shear', value: 1.4, ease: 'smooth' },
    { t: 0, path: 'caustics', value: 0.6 },
    { t: 12000, path: 'caustics', value: 1.7, ease: 'smooth' },
    { t: 24000, path: 'caustics', value: 0.6, ease: 'smooth' },
  ],
};
