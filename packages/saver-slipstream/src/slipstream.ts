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
 * SLIPSTREAM — the page as a boundary condition.
 *
 * The progression across the deep passthrough savers: black hole samples a
 * field AT each block, tide hands each block the field's DERIVATIVE, limelight
 * makes blocks act on EACH OTHER. Here the coupling closes: the page's own
 * geometry SHAPES the field (each block is an obstacle in an analytic
 * potential-flow wind; streamlines must thread between the content), and the
 * field pushes back on the page (blocks lean and flutter with the local flow).
 *
 * Everything stays closed-form for the determinism proof. The velocity at any
 * point is a superposition of a uniform wind and one doublet per obstacle —
 * the classical flow-past-a-cylinder solution — so it is a pure function of
 * (x, y, params). Streamlines are integrated with fixed-step RK2 from seeded
 * seeds and cached per quantised FLOW BUCKET (a pure function of t, never a
 * frame counter); dust advects along the cached polylines by an arc-length
 * offset that is again a pure function of t. Seek anywhere, get the frame.
 */
const PARAM_SPACE = {
  /** Wind direction in degrees. 0 = left-to-right, 90 = downward. */
  windAngle: { type: 'number', default: 0, min: -180, max: 180, ease: 'smooth' },
  /** How far the direction wanders around `windAngle`. 0 = agent owns the vane. */
  veer: { type: 'number', default: 14, min: 0, max: 60, ease: 'smooth' },
  /** Base wind speed — scales advection, lean, flutter, everything. */
  windSpeed: { type: 'number', default: 1, min: 0.1, max: 3, ease: 'smooth' },
  /** Gust depth: 0 = steady laminar wind, 1 = strong breathing. */
  gustiness: { type: 'number', default: 0.45, min: 0, max: 1, ease: 'smooth' },
  /** How wide a berth the flow gives each block, multiplying its radius. */
  clearance: { type: 'number', default: 1, min: 0.4, max: 1.8, ease: 'smooth' },
  /** Streamline count. Read per bucket, so it is live-steerable. */
  lineCount: { type: 'number', default: 44, min: 8, max: 90 },
  /** Streamline visibility. */
  lineOpacity: { type: 'number', default: 0.5, min: 0, max: 1, ease: 'smooth' },
  /** Dust riding the lines. Read once at build. */
  dustCount: { type: 'number', default: 160, min: 0, max: 400 },
  /** How hard the wind leans the page's blocks downstream. */
  sway: { type: 'number', default: 1, min: 0, max: 2.5, ease: 'smooth' },
  /** High-frequency shiver on small blocks sitting in fast flow. */
  flutter: { type: 'number', default: 1, min: 0, max: 2.5, ease: 'smooth' },
  /** Darkness of the night-wind veil over the page. */
  veil: { type: 'number', default: 0.62, min: 0, max: 0.9, ease: 'smooth' },
  /** Line hue: 0 = moonlit silver-blue, 1 = sodium amber. */
  tint: { type: 'number', default: 0.18, min: 0, max: 1, ease: 'smooth' },
} satisfies ParamSpace;

export const slipstreamManifest: SaverManifest = {
  id: 'slipstream',
  label: 'Slipstream',
  passthrough: true,
  minBackend: 'canvas2d',
  costTier: 'high',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  a11y: {
    flashSafe: true,
    notes: 'Slow wind lines over a dim page. No flashing; everything drifts over seconds.',
  },
};

/** Generic content selector a passthrough saver eats. Hosts can override later. */
const VICTIM_SELECTOR =
  'main :is(h1,h2,h3,h4,p,li,img,a,button), nav a, header a, footer a, .card, [data-idle-victim]';

/** Field evaluation is O(obstacles) per sample; keep the boundary set tight. */
const MAX_VICTIMS = 90;
/** Only the strongest obstacles enter the field — a wall of tiny links would
 *  turn the flow to soup. The rest still lean with it. */
const MAX_OBSTACLES = 26;

/**
 * Streamlines rebuild on this quantised clock — a pure function of `t`, so
 * seeking reproduces the cache. Long enough that the rebuild cost is
 * amortised, short enough that a steered wind answers promptly.
 */
const FLOW_BUCKET_MS = 240;

/** RK2 integration parameters for a streamline. */
const STEP_PX = 9;
const MAX_STEPS = 260;

interface Obstacle {
  cx: number;
  cy: number;
  /** Effective cylinder radius, px. */
  r: number;
}

interface Streamline {
  /** Flattened x,y polyline. */
  pts: Float32Array;
  /** Number of points actually written. */
  n: number;
  /** Total arc length, px (STEP_PX * (n - 1), but kept explicit). */
  len: number;
}

interface Dust {
  /** Which streamline this mote rides, as a seeded fraction (index = frac * lines). */
  lane: number;
  /** Start offset along the line, fraction of its length. */
  s0: number;
  speed: number;
  size: number;
  ph: number;
}

interface Victim {
  el: HTMLElement;
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** 0..1 — small light blocks flutter, large ones barely lean. */
  give: number;
  flutterPh: number;
  prevTransform: string;
  prevOrigin: string;
  prevWillChange: string;
  prevTransition: string;
  lastTransform: string;
}

type Params = Record<keyof typeof PARAM_SPACE, number>;

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smooth01 = (k: number): number => k * k * (3 - 2 * k);

class SlipstreamInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private w = 0;
  private h = 0;

  private victims: Victim[] = [];
  private obstacles: Obstacle[] = [];
  private dust: Dust[] = [];

  private lines: Streamline[] = [];
  private flowBucket = -1;
  /** Wind snapshot the cached lines were built with — reused per frame so the
   *  page's lean matches the lines exactly. */
  private bAngle = 0;
  private bSpeed = 1;

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
    if (!c2d) throw new Error('slipstream: no 2d context');
    this.ctx = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.buildDust();
    this.sizeCanvas();
    this.collectVictims();

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  // ---- build (seeded, once) ----
  private buildDust(): void {
    const rng = this.ctxSaver.rng;
    const n = Math.round(this.params.dustCount);
    this.dust = new Array(n);
    for (let i = 0; i < n; i++) {
      this.dust[i] = {
        lane: rng.next(),
        s0: rng.next(),
        speed: 0.6 + rng.next() * 0.9,
        size: 0.5 + Math.pow(rng.next(), 2) * 1.9,
        ph: rng.next() * TAU,
      };
    }
  }

  private applyParams(t: number): void {
    const p = this.track ? sampleTrack(PARAM_SPACE, this.track, t) : this.params;
    for (const k of Object.keys(PARAM_SPACE) as Array<keyof typeof PARAM_SPACE>) {
      const v = p[k];
      this.params[k] = typeof v === 'number' ? v : this.params[k];
    }
  }

  /** Params at an arbitrary `t`, without disturbing the live ones. */
  private paramsAt(t: number): Params {
    if (!this.track) return this.params;
    const p = sampleTrack(PARAM_SPACE, this.track, t);
    const out = { ...this.params } as Params;
    for (const k of Object.keys(PARAM_SPACE) as Array<keyof typeof PARAM_SPACE>) {
      const v = p[k];
      if (typeof v === 'number') out[k] = v;
    }
    return out;
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- the wind (closed form in t) ----

  /** Wind direction at `t`, radians. Veer is a slow figure-of-sines drift. */
  private windAngleAt(p: Params, t: number): number {
    const veer = (p.veer * Math.PI) / 180;
    return (
      (p.windAngle * Math.PI) / 180 +
      veer * (0.6 * Math.sin(t * 0.00006) + 0.4 * Math.sin(t * 0.000131 + 2.1))
    );
  }

  /** Gust envelope at `t` — multiplies the base speed. Never reaches zero. */
  private gustAt(p: Params, t: number): number {
    const g = p.gustiness;
    return 1 + g * (0.45 * Math.sin(t * 0.00021) + 0.3 * Math.sin(t * 0.00047 + 1.3) + 0.25 * Math.sin(t * 0.00009 + 4.2));
  }

  /**
   * Analytic velocity at a point: uniform wind + one doublet per obstacle
   * (potential flow past a cylinder), plus a soft repulsion INSIDE a cylinder
   * so a streamline that starts in one is pushed out instead of trapped.
   * Superposition of single-body solutions is not exact for multiple bodies —
   * and does not need to be. It is exact far from everything, divergence-free,
   * and visually parts around each block.
   */
  private velocity(x: number, y: number, ax: number, ay: number, out: [number, number]): void {
    let vx = ax;
    let vy = ay;
    for (const o of this.obstacles) {
      const dx = x - o.cx;
      const dy = y - o.cy;
      const r2 = dx * dx + dy * dy;
      const a2 = o.r * o.r;
      if (r2 < a2) {
        // Inside: push straight out, fading to the boundary.
        const r = Math.sqrt(r2) || 1;
        const k = (1 - r2 / a2) * 2;
        vx += (dx / r) * k * Math.hypot(ax, ay);
        vy += (dy / r) * k * Math.hypot(ax, ay);
        continue;
      }
      // Doublet aligned with the free stream: v -= a² * ( U(dx²-dy²) + 2V dx dy,
      // V(dy²-dx²) + 2U dx dy ) / r⁴  — the image term of flow past a cylinder.
      const inv = a2 / (r2 * r2);
      vx -= inv * (ax * (dx * dx - dy * dy) + ay * 2 * dx * dy);
      vy -= inv * (ay * (dy * dy - dx * dx) + ax * 2 * dx * dy);
    }
    out[0] = vx;
    out[1] = vy;
  }

  // ---- page victims (passthrough) ----
  private collectVictims(): void {
    this.victims = [];
    this.obstacles = [];
    this.flowBucket = -1;
    const page = this.ctxSaver.page;
    if (!page) return;
    let els = page.victims(VICTIM_SELECTOR);
    els = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
    const rng = this.ctxSaver.rng;
    for (const el of els) {
      if (this.victims.length >= MAX_VICTIMS) break;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 6) continue;
      if (r.bottom < -40 || r.top > this.h + 40) continue;
      if (r.right < 0 || r.left > this.w) continue;

      // Per-block jitter from a FORKED stream keyed on index — `resize()`
      // re-collects, and a shared-cursor draw would re-roll every block.
      const jitter = rng.fork(this.victims.length).next();
      const area = r.width * r.height;
      const bulk = clamp((area - 4_000) / 70_000, 0, 1);
      const give = clamp((1 - smooth01(bulk)) * (0.5 + jitter * 0.5), 0, 1);

      this.victims.push({
        el,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        w: r.width,
        h: r.height,
        give,
        flutterPh: jitter * TAU,
        prevTransform: el.style.transform,
        prevOrigin: el.style.transformOrigin,
        prevWillChange: el.style.willChange,
        prevTransition: el.style.transition,
        lastTransform: '',
      });
      el.style.willChange = 'transform';
      el.style.transition = 'none';
      el.style.transformOrigin = '50% 100%'; // blocks hinge at their base, like grass
    }

    // The largest blocks become the flow's boundary — sorted by area so the
    // obstacle set is stable regardless of DOM order.
    const byArea = [...this.victims].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, MAX_OBSTACLES);
    for (const v of byArea) {
      // Effective cylinder radius: between the half-diagonal and the mean
      // half-extent, so wide flat blocks do not claim absurd circles.
      const r = (Math.hypot(v.w, v.h) / 2) * 0.62 + 8;
      this.obstacles.push({ cx: v.cx, cy: v.cy, r });
    }
  }

  private restoreVictims(): void {
    for (const v of this.victims) {
      v.el.style.transform = v.prevTransform;
      v.el.style.transformOrigin = v.prevOrigin;
      v.el.style.willChange = v.prevWillChange;
      v.el.style.transition = v.prevTransition;
    }
    this.victims = [];
    this.obstacles = [];
  }

  // ---- streamlines (cached per flow bucket) ----

  /**
   * Rebuild the streamline cache for a bucket. Pure in the bucket index: wind
   * angle/speed are sampled at the bucket's centre time, seeds come from a
   * bucket-independent fork, and the integrator is fixed-step.
   */
  private ensureFlow(t: number): void {
    const bucket = Math.floor(t / FLOW_BUCKET_MS);
    if (bucket === this.flowBucket) return;
    this.flowBucket = bucket;

    const tc = bucket * FLOW_BUCKET_MS + FLOW_BUCKET_MS / 2;
    const p = this.paramsAt(tc);
    const angle = this.windAngleAt(p, tc);
    const speed = p.windSpeed * this.gustAt(p, tc);
    this.bAngle = angle;
    this.bSpeed = speed;

    // Apply clearance by scaling obstacle radii for this bucket's integration.
    const scaled = this.obstacles.map((o) => ({ cx: o.cx, cy: o.cy, r: o.r * p.clearance }));
    const saved = this.obstacles;
    this.obstacles = scaled;

    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    // Seed line starts along the upwind edge, spread across the crosswind axis.
    const px = -ay;
    const py = ax;
    const diag = Math.hypot(this.w, this.h);
    const cx = this.w / 2;
    const cy = this.h / 2;
    const nLines = Math.round(p.lineCount);
    const lineRng = this.ctxSaver.rng.fork(0x51eea);

    const lines: Streamline[] = new Array(nLines);
    const v: [number, number] = [0, 0];
    for (let i = 0; i < nLines; i++) {
      // Even spacing with a seeded wobble, so lines don't read as a grid.
      const frac = (i + 0.5) / nLines - 0.5 + (lineRng.next() - 0.5) * (0.6 / nLines);
      const sx = cx - ax * diag * 0.62 + px * frac * diag * 1.1;
      const sy = cy - ay * diag * 0.62 + py * frac * diag * 1.1;

      const pts = new Float32Array(MAX_STEPS * 2);
      let n = 0;
      let x = sx;
      let y = sy;
      for (let s = 0; s < MAX_STEPS; s++) {
        pts[n * 2] = x;
        pts[n * 2 + 1] = y;
        n++;
        // RK2 midpoint step, fixed length so arc-length ≈ n * STEP_PX.
        this.velocity(x, y, ax, ay, v);
        let m = Math.hypot(v[0], v[1]);
        if (m < 1e-4) break;
        const mx = x + (v[0] / m) * STEP_PX * 0.5;
        const my = y + (v[1] / m) * STEP_PX * 0.5;
        this.velocity(mx, my, ax, ay, v);
        m = Math.hypot(v[0], v[1]);
        if (m < 1e-4) break;
        x += (v[0] / m) * STEP_PX;
        y += (v[1] / m) * STEP_PX;
        // Stall guard: at a stagnation point between two obstacles the
        // integrator can oscillate in place, drawing a dense scribble knot.
        // A real streamline covers ground; one that hasn't net-moved ~3 steps'
        // worth over the last 8 is trapped — cut it.
        if (n >= 8) {
          const bx = pts[(n - 8) * 2]!;
          const by = pts[(n - 8) * 2 + 1]!;
          if (Math.hypot(x - bx, y - by) < STEP_PX * 2.5) {
            // Drop the oscillating tail too, or every trapped line leaves a
            // bright little scribble stub at the stagnation point.
            n = Math.max(0, n - 7);
            break;
          }
        }
        const margin = diag * 0.25;
        if (x < -margin || x > this.w + margin || y < -margin || y > this.h + margin) {
          // One more point so the line exits the frame cleanly.
          if (n < MAX_STEPS) {
            pts[n * 2] = x;
            pts[n * 2 + 1] = y;
            n++;
          }
          break;
        }
      }
      lines[i] = { pts, n, len: (n - 1) * STEP_PX };
    }

    this.obstacles = saved;
    this.lines = lines;
  }

  // ---- the wind acts on the page ----

  /**
   * Lean each block downstream of the LOCAL flow — a block in an obstacle's
   * wake feels the deflected wind, not the free stream — and shiver the small
   * ones. Hinged at the base like grass. Pure in `t`.
   */
  private applyVictim(v: Victim, t: number, ax: number, ay: number): void {
    const vel: [number, number] = [0, 0];
    this.velocity(v.cx, v.cy, ax, ay, vel);
    const p = this.params;
    const gust = this.gustAt(p, t);
    const strength = p.windSpeed * gust;

    // Lean: rotation toward downstream, capped small — content stays readable.
    const lean = clamp(vel[0] * strength * v.give * p.sway * 2.4, -6.5, 6.5);
    // Crosswind shear from the vertical component: tall thin blocks wag more.
    const shear = clamp(vel[1] * strength * v.give * p.sway * 1.4, -4, 4);
    // Flutter: high-frequency shiver whose amplitude rides the gusts.
    const fl =
      p.flutter * v.give * strength * (0.4 + 0.6 * Math.abs(gust - 1)) *
      Math.sin(t * 0.013 + v.flutterPh);
    const dx = vel[0] * strength * v.give * p.sway * 3 + fl * 1.1;
    const dy = vel[1] * strength * v.give * p.sway * 1.6;

    const transform =
      Math.abs(lean) < 0.05 && Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1
        ? v.prevTransform
        : `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${lean.toFixed(2)}deg) skewX(${shear.toFixed(2)}deg)`;
    if (transform !== v.lastTransform) {
      v.el.style.transform = transform;
      v.lastTransform = transform;
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
    this.renderFrame(now - this.startT, this.ctxSaver.seed);
  }

  private renderStill(): void {
    this.renderFrame(this.t, this.ctxSaver.seed);
  }

  // ---- draw ----
  private lineColor(alpha: number): string {
    const tint = this.params.tint;
    const r = Math.round(168 + tint * 87);
    const g = Math.round(196 + tint * 8);
    const b = Math.round(238 - tint * 118);
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  }

  private render(t: number): void {
    const ctx = this.ctx;
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'source-over';

    // Night veil, heavier at the edges so the page centre stays legible.
    const veil = this.params.veil;
    if (veil > 0.005) {
      ctx.fillStyle = `rgba(6,9,18,${(veil * 0.82).toFixed(3)})`;
      ctx.fillRect(0, 0, this.w, this.h);
      const vg = ctx.createRadialGradient(
        this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.28,
        this.w / 2, this.h / 2, Math.hypot(this.w, this.h) * 0.6,
      );
      vg.addColorStop(0, 'rgba(4,6,14,0)');
      vg.addColorStop(1, `rgba(4,6,14,${(veil * 0.55).toFixed(3)})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    // Streamlines: drawn as travelling dashes so the flow visibly MOVES along
    // the cached geometry. Dash phase is pure in t.
    const lop = this.params.lineOpacity;
    if (lop > 0.01 && this.lines.length) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      const dashLen = 34;
      const gapLen = 26;
      const cycle = dashLen + gapLen;
      const flow = t * 0.11 * this.bSpeed;
      ctx.setLineDash([dashLen, gapLen]);
      // Two passes per line: a wide soft underglow, then a bright core — the
      // dashes read as travelling light, not hairline scratches. A single 1px
      // pass at low alpha was invisible over any real content.
      for (const [width, gain] of [[3.2, 0.4], [1.3, 1]] as const) {
        ctx.lineWidth = width;
        for (let i = 0; i < this.lines.length; i++) {
          const ln = this.lines[i]!;
          if (ln.n < 2) continue;
          // Neighbouring lines breathe out of phase so the field shimmers.
          const a = lop * gain * (0.34 + 0.16 * Math.sin(t * 0.0006 + i * 1.7));
          if (a <= 0.008) continue;
          ctx.strokeStyle = this.lineColor(a);
          ctx.lineDashOffset = -(flow % cycle) - i * 13.7;
          ctx.beginPath();
          ctx.moveTo(ln.pts[0]!, ln.pts[1]!);
          for (let k = 1; k < ln.n; k++) ctx.lineTo(ln.pts[k * 2]!, ln.pts[k * 2 + 1]!);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      // Dust: motes advected along the cached polylines by arc-length offset —
      // real particle advection with zero per-frame integration.
      for (const d of this.dust) {
        const ln = this.lines[Math.min(this.lines.length - 1, Math.floor(d.lane * this.lines.length))]!;
        if (ln.n < 2 || ln.len <= 0) continue;
        const s = ((d.s0 + (t * 0.00006 * d.speed * this.bSpeed)) % 1 + 1) % 1;
        const f = s * (ln.n - 1);
        const k = Math.floor(f);
        const frac = f - k;
        const x = ln.pts[k * 2]! + (ln.pts[Math.min(k + 1, ln.n - 1) * 2]! - ln.pts[k * 2]!) * frac;
        const y = ln.pts[k * 2 + 1]! + (ln.pts[Math.min(k + 1, ln.n - 1) * 2 + 1]! - ln.pts[k * 2 + 1]!) * frac;
        if (x < -10 || x > this.w + 10 || y < -10 || y > this.h + 10) continue;
        const fade = Math.sin(s * Math.PI) * (0.5 + 0.5 * Math.sin(t * 0.0011 + d.ph));
        if (fade <= 0.03) continue;
        ctx.fillStyle = this.lineColor(0.5 * fade * lop * 1.6);
        ctx.beginPath();
        ctx.arc(x, y, d.size, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
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
    this.restoreVictims();
    this.sizeCanvas();
    this.collectVictims();
    if (this.paused) this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
    this.flowBucket = -1; // the cache is param-dependent; force a rebuild
    if (this.paused) this.renderStill();
  }

  /**
   * Pure, frame-addressable render at logical time `t` — canvas AND page. The
   * streamline cache is keyed on a bucket derived from `t`, so seeking
   * backwards reproduces the earlier frame exactly.
   */
  renderFrame(t: number, _seed: number): void {
    this.t = t;
    this.applyParams(t);
    this.ensureFlow(t);
    const ax = Math.cos(this.bAngle) * this.bSpeed;
    const ay = Math.sin(this.bAngle) * this.bSpeed;
    for (const v of this.victims) this.applyVictim(v, t, ax, ay);
    this.render(t);
  }

  dispose(): void {
    this.stop();
    this.restoreVictims();
    this.canvas.remove();
  }
}

/** The slipstream saver plugin. */
export const slipstream: SaverPlugin = {
  manifest: slipstreamManifest,
  mount: (ctx: SaverContext) => new SlipstreamInstance(ctx),
};

/** A demo control-track: a still evening breeze swings to a gusty crosswind
 *  and back, the vane veering through ninety degrees. Deterministic. */
export const demoTrack: ControlTrack = {
  program: 'slipstream',
  seed: 23,
  duration: 30000,
  loop: true,
  deltas: [
    { t: 0, path: 'veer', value: 0 },
    { t: 0, path: 'windAngle', value: -8 },
    { t: 15000, path: 'windAngle', value: 82, ease: 'smooth' },
    { t: 30000, path: 'windAngle', value: -8, ease: 'smooth' },
    { t: 0, path: 'windSpeed', value: 0.5 },
    { t: 15000, path: 'windSpeed', value: 2.1, ease: 'smooth' },
    { t: 30000, path: 'windSpeed', value: 0.5, ease: 'smooth' },
    { t: 0, path: 'gustiness', value: 0.15 },
    { t: 15000, path: 'gustiness', value: 0.85, ease: 'smooth' },
    { t: 30000, path: 'gustiness', value: 0.15, ease: 'smooth' },
    { t: 0, path: 'tint', value: 0.1 },
    { t: 15000, path: 'tint', value: 0.75, ease: 'smooth' },
    { t: 30000, path: 'tint', value: 0.1, ease: 'smooth' },
  ],
};
