import {
  sampleTrack,
  defaultParams,
  type ControlTrack,
  type ParamSpace,
  type SaverContext,
  type SaverInstance,
  type SaverLayer,
  type SaverManifest,
  type SaverPlugin,
} from '@idle-screens/core';

/**
 * Typed knobs an agent can steer. `lightX`/`lightY` are the steered aim of the
 * key light and the roam is an offset around it, so a track that pins
 * `roamX: 0, roamY: 0` hands an agent absolute control of where the light
 * points. `moteCount` is read only at build.
 */
const PARAM_SPACE = {
  /** Where the key light is AIMED, as a fraction of the viewport. */
  lightX: { type: 'number', default: 0.5, min: 0, max: 1, ease: 'smooth' },
  lightY: { type: 'number', default: 0.42, min: 0, max: 1, ease: 'smooth' },
  /** Roam amplitude around the aim. Zero = the agent owns the light. */
  roamX: { type: 'number', default: 0.3, min: 0, max: 0.5, ease: 'smooth' },
  roamY: { type: 'number', default: 0.14, min: 0, max: 0.5, ease: 'smooth' },
  roamSpeed: { type: 'number', default: 1, min: 0, max: 3, ease: 'smooth' },
  /**
   * How far ABOVE the top edge the lamp hangs, in viewport heights. This is what
   * makes it a stage and not a torch: shadows radiate from a point off-screen,
   * so they sweep down the page in near-parallel instead of pointing away from
   * a hotspot sitting in the middle of the content.
   */
  rigHeight: { type: 'number', default: 0.62, min: 0.1, max: 2, ease: 'smooth' },
  /** How dark the unlit stage sits. */
  ambient: { type: 'number', default: 0.78, min: 0, max: 0.95, ease: 'smooth' },
  /** Radius of the lit pool where the beam lands, as a fraction of the short edge. */
  beamSize: { type: 'number', default: 0.4, min: 0.12, max: 1.2, ease: 'smooth' },
  /** Brightness of the volumetric shaft the set carves slots out of. */
  beamStrength: { type: 'number', default: 0.55, min: 0, max: 1.2, ease: 'smooth' },
  /** How fast illumination drops with distance from the pool centre. */
  falloff: { type: 'number', default: 1, min: 0.2, max: 3, ease: 'smooth' },
  shadowLength: { type: 'number', default: 1, min: 0, max: 3, ease: 'smooth' },
  shadowOpacity: { type: 'number', default: 0.68, min: 0, max: 0.95, ease: 'smooth' },
  /** How far blocks stand off the page — drives parallax AND the visible side walls. */
  lift: { type: 'number', default: 1, min: 0, max: 2, ease: 'smooth' },
  /** How strongly a block sitting in another block's shadow is dimmed. */
  occlusion: { type: 'number', default: 1, min: 0, max: 1, ease: 'smooth' },
  /** A cold counter-light from the opposite side: rim and a second shadow only. */
  backLight: { type: 'number', default: 0.5, min: 0, max: 1, ease: 'smooth' },
  /** Bright edge on the faces turned toward a lamp. */
  rim: { type: 'number', default: 0.8, min: 0, max: 1.5, ease: 'smooth' },
  /** Key gel: 0 = cold moonlight, 1 = warm tungsten. */
  warmth: { type: 'number', default: 0.62, min: 0, max: 1, ease: 'smooth' },
  /** Dust in the beam. Read once at build. */
  moteCount: { type: 'number', default: 90, min: 0, max: 240 },
} satisfies ParamSpace;

export const limelightManifest: SaverManifest = {
  id: 'limelight',
  label: 'Limelight',
  passthrough: true,
  minBackend: 'canvas2d',
  costTier: 'high',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  a11y: {
    flashSafe: true,
    notes: 'A slow raking stage light. No flashing; brightness drifts over seconds.',
  },
};

/** Generic content selector a passthrough saver eats. Hosts can override later. */
const VICTIM_SELECTOR =
  'main :is(h1,h2,h3,h4,p,li,img,a,button), nav a, header a, footer a, .card, [data-idle-victim]';

/**
 * Every block costs two shadow polygons, a side wall, a rim stroke and a slot
 * carved out of the beam layer, so the stage takes a smaller cast than the
 * field savers do.
 */
const MAX_VICTIMS = 130;

/**
 * Occlusion is resolved on a quantised clock. The bucket is a pure function of
 * `t` — never a frame counter — so seeking backwards reproduces the frame.
 */
const OCC_BUCKET_MS = 90;

/** Base angular rate, rad/ms, before `roamSpeed`. */
const BASE_W = 0.00035;

interface Mote {
  /** Position along and across the beam axis, so dust rides the shaft. */
  along: number;
  across: number;
  drift: number;
  size: number;
  ph: number;
}

interface Victim {
  el: HTMLElement;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  /** 0..1 — how far this block stands off the page. Small chips stand tall. */
  height: number;
  prevTransform: string;
  prevOrigin: string;
  prevFilter: string;
  prevWillChange: string;
  prevTransition: string;
  lastTransform: string;
  lastFilter: string;
  /** Cached occlusion for `occBucket`; recomputed when the bucket changes. */
  occ: number;
}

type Params = Record<keyof typeof PARAM_SPACE, number>;
type RGB = [number, number, number];

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smooth01 = (k: number): number => k * k * (3 - 2 * k);

/**
 * For each of the 8 outer regions a viewpoint can occupy relative to an
 * axis-aligned box: the silhouette runs from corner `a` clockwise to corner `b`
 * along the FACING side. `lit` is that facing chain (used for rim light and for
 * the visible side walls); `dark` is the remainder, which closes a shadow
 * polygon back to `a`. Corners are 0=TL 1=TR 2=BR 3=BL.
 *
 * Keyed by `(hy + 1) * 3 + (hx + 1)`; index 4 (viewpoint inside the box) is
 * null — there is no silhouette then, and with a roaming light that happens
 * constantly.
 */
interface Sil {
  a: number;
  b: number;
  lit: number[];
  dark: number[];
}
const SILHOUETTE: (Sil | null)[] = [
  { a: 3, b: 1, lit: [3, 0, 1], dark: [2] }, // above-left
  { a: 0, b: 1, lit: [0, 1], dark: [2, 3] }, // above
  { a: 0, b: 2, lit: [0, 1, 2], dark: [3] }, // above-right
  { a: 3, b: 0, lit: [3, 0], dark: [1, 2] }, // left
  null, // inside
  { a: 1, b: 2, lit: [1, 2], dark: [3, 0] }, // right
  { a: 2, b: 0, lit: [2, 3, 0], dark: [1] }, // below-left
  { a: 2, b: 3, lit: [2, 3], dark: [0, 1] }, // below
  { a: 1, b: 3, lit: [1, 2, 3], dark: [0] }, // below-right
];

/** Which silhouette a box presents to a point. */
function silhouetteFor(px: number, py: number, x0: number, y0: number, x1: number, y1: number): Sil | null {
  const hx = px < x0 ? -1 : px > x1 ? 1 : 0;
  const hy = py < y0 ? -1 : py > y1 ? 1 : 0;
  return SILHOUETTE[(hy + 1) * 3 + (hx + 1)] ?? null;
}

class LimelightInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Allocated once; the volumetric shaft is drawn here so the set can carve it. */
  private readonly beamCanvas: HTMLCanvasElement;
  private readonly beamCtx: CanvasRenderingContext2D;

  private w = 0;
  private h = 0;
  private s = 1;

  private motes: Mote[] = [];
  private victims: Victim[] = [];
  private occBucket = -1;

  /**
   * The bounding box of the collected set. The light aims in THIS space, not
   * viewport space: on a page with a centered column, a viewport-space roam
   * spends half its time lighting empty margin. `lightX: 0.5` means "middle of
   * the content" — which is also the more useful contract for an agent.
   */
  private stageX = 0;
  private stageY = 0;
  private stageW = 0;
  private stageH = 0;

  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  private t = 0;

  private params: Params = defaultParams(PARAM_SPACE) as Params;
  private track: ControlTrack | null = null;

  /** Scratch corner buffers — avoids per-block allocation in the draw loop. */
  private readonly lifted = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly flat = [0, 0, 0, 0, 0, 0, 0, 0];

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    ctx.host.appendChild(canvas);
    this.canvas = canvas;
    const c2d = canvas.getContext('2d', { alpha: true });
    if (!c2d) throw new Error('limelight: no 2d context');
    this.ctx = c2d;

    // Detached, never in the document — OffscreenCanvas is not guaranteed and
    // this saver is not worker-ready, so a plain element is the safe choice.
    this.beamCanvas = document.createElement('canvas');
    const b2d = this.beamCanvas.getContext('2d', { alpha: true });
    if (!b2d) throw new Error('limelight: no 2d context for the beam layer');
    this.beamCtx = b2d;

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
    const n = Math.round(this.params.moteCount);
    this.motes = new Array(n);
    for (let i = 0; i < n; i++) {
      this.motes[i] = {
        along: 0.1 + rng.next() * 0.95,
        across: rng.next() * 2 - 1,
        drift: 0.00004 + rng.next() * 0.00012,
        size: 0.5 + Math.pow(rng.next(), 2) * 2.4,
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

  private measure(): void {
    this.s = Math.max(1, Math.min(this.w, this.h));
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    const pw = Math.max(1, Math.round(this.w * dpr));
    const ph = Math.max(1, Math.round(this.h * dpr));
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.beamCanvas.width = pw;
    this.beamCanvas.height = ph;
    this.beamCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- the rig (closed form in t) ----

  /** Where the key light is aimed — the centre of the pool on the stage floor. */
  private aimFrom(p: Params, t: number): [number, number] {
    const wt = BASE_W * p.roamSpeed * t;
    const fx = p.lightX + p.roamX * Math.sin(wt);
    const fy = p.lightY + p.roamY * Math.sin(wt * 1.37 + 1.1);
    return [this.stageX + fx * this.stageW, this.stageY + fy * this.stageH];
  }

  /**
   * The lamp itself, hanging off-screen above the stage. It tracks the aim but
   * damped, so swinging the pool across the stage rakes the shadows rather than
   * spinning them around a hotspot.
   */
  private apexFrom(p: Params, aimX: number): [number, number] {
    return [this.w / 2 + (aimX - this.w / 2) * 0.45, -this.h * p.rigHeight];
  }

  /** The cold counter-light, hung opposite the key. */
  private backFrom(p: Params, aimX: number): [number, number] {
    return [this.w / 2 - (aimX - this.w / 2) * 0.75, -this.h * p.rigHeight * 0.75];
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

  private beamPx(): number {
    return Math.max(24, this.s * this.params.beamSize);
  }

  private gel(): RGB {
    const warm = this.params.warmth;
    return [
      Math.round(176 + warm * 79),
      Math.round(203 + warm * 37),
      Math.round(255 - warm * 96),
    ];
  }

  // ---- page victims (passthrough) ----
  private collectVictims(): void {
    this.victims = [];
    this.occBucket = -1;
    const page = this.ctxSaver.page;
    if (!page) return;
    let els = page.victims(VICTIM_SELECTOR);
    // De-nest: a container and its child must not both be set pieces, or the
    // child would be lifted twice and would shadow itself.
    els = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
    const rng = this.ctxSaver.rng;
    for (const el of els) {
      if (this.victims.length >= MAX_VICTIMS) break;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 6) continue;
      if (r.bottom < -40 || r.top > this.h + 40) continue;
      if (r.right < 0 || r.left > this.w) continue;

      // Small chips read as standing flats; a hero image is stage floor.
      // The jitter comes from a FORKED stream keyed on the block's index, not
      // from the shared cursor: `resize()` re-collects, and a stateful draw
      // would silently re-roll every block's height on every viewport change.
      const jitter = rng.fork(this.victims.length).next();
      const area = r.width * r.height;
      const bulk = clamp((area - 5_000) / 80_000, 0, 1);
      const height = clamp((1 - smooth01(bulk)) * (0.45 + jitter * 0.55), 0, 1);

      this.victims.push({
        el,
        x0: r.left,
        y0: r.top,
        x1: r.right,
        y1: r.bottom,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        height,
        prevTransform: el.style.transform,
        prevOrigin: el.style.transformOrigin,
        prevFilter: el.style.filter,
        prevWillChange: el.style.willChange,
        prevTransition: el.style.transition,
        lastTransform: '',
        lastFilter: '',
        occ: 0,
      });
      el.style.willChange = 'transform, filter';
      el.style.transition = 'none';
      el.style.transformOrigin = '50% 50%';
    }
    this.computeStage();
  }

  /** The stage is where the set actually stands; empty pages get the viewport. */
  private computeStage(): void {
    if (!this.victims.length) {
      this.stageX = 0;
      this.stageY = 0;
      this.stageW = this.w;
      this.stageH = this.h;
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const v of this.victims) {
      if (v.x0 < x0) x0 = v.x0;
      if (v.y0 < y0) y0 = v.y0;
      if (v.x1 > x1) x1 = v.x1;
      if (v.y1 > y1) y1 = v.y1;
    }
    this.stageX = clamp(x0, 0, this.w);
    this.stageY = clamp(y0, 0, this.h);
    this.stageW = Math.max(1, clamp(x1, 0, this.w) - this.stageX);
    this.stageH = Math.max(1, clamp(y1, 0, this.h) - this.stageY);
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

  // ---- relief ----

  /** Parallax offset for a block, as seen from a viewer at the screen centre. */
  private liftOffset(v: Victim): [number, number, number] {
    const k = v.height * this.params.lift * 0.11;
    return [(v.cx - this.w / 2) * k, (v.cy - this.h / 2) * k, 1 + v.height * this.params.lift * 0.05];
  }

  /**
   * Fill both corner buffers: `flat` is the block's footprint on the page,
   * `lifted` is where it actually stands. Shadows cast from the lifted corners
   * (otherwise the shadow detaches from the block the viewer sees) and the side
   * walls span between the two.
   */
  private buildBoxes(v: Victim): void {
    const [ox, oy, sc] = this.liftOffset(v);
    const hw = (v.x1 - v.x0) / 2;
    const hh = (v.y1 - v.y0) / 2;
    const f = this.flat;
    f[0] = v.cx - hw; f[1] = v.cy - hh;
    f[2] = v.cx + hw; f[3] = v.cy - hh;
    f[4] = v.cx + hw; f[5] = v.cy + hh;
    f[6] = v.cx - hw; f[7] = v.cy + hh;

    const lw = hw * sc;
    const lh = hh * sc;
    const cx = v.cx + ox;
    const cy = v.cy + oy;
    const l = this.lifted;
    l[0] = cx - lw; l[1] = cy - lh;
    l[2] = cx + lw; l[3] = cy - lh;
    l[4] = cx + lw; l[5] = cy + lh;
    l[6] = cx - lw; l[7] = cy + lh;
  }

  // ---- occlusion: the part where the stage acts on itself ----

  /** Slab test: does the segment from `(px,py)` to `(qx,qy)` cross this box? */
  private static segmentHitsBox(
    px: number, py: number, qx: number, qy: number,
    x0: number, y0: number, x1: number, y1: number,
  ): boolean {
    const dx = qx - px;
    const dy = qy - py;
    let tMin = 0;
    let tMax = 1;
    if (dx === 0) {
      if (px < x0 || px > x1) return false;
    } else {
      let a = (x0 - px) / dx;
      let b = (x1 - px) / dx;
      if (a > b) { const s = a; a = b; b = s; }
      tMin = Math.max(tMin, a);
      tMax = Math.min(tMax, b);
      if (tMin > tMax) return false;
    }
    if (dy === 0) {
      if (py < y0 || py > y1) return false;
    } else {
      let a = (y0 - py) / dy;
      let b = (y1 - py) / dy;
      if (a > b) { const s = a; a = b; b = s; }
      tMin = Math.max(tMin, a);
      tMax = Math.min(tMax, b);
      if (tMin > tMax) return false;
    }
    return true;
  }

  /**
   * Resolve which blocks stand in another block's shadow. Uses the CACHED boxes
   * (not the lifted ones) so the answer depends only on the quantised clock and
   * the collected layout.
   */
  private resolveOcclusion(t: number): void {
    const bucket = Math.floor(t / OCC_BUCKET_MS);
    if (bucket === this.occBucket) return;
    this.occBucket = bucket;
    const tc = bucket * OCC_BUCKET_MS + OCC_BUCKET_MS / 2;
    const p = this.paramsAt(tc);
    const [aimX] = this.aimFrom(p, tc);
    const [lx, ly] = this.apexFrom(p, aimX);
    const n = this.victims.length;
    for (let i = 0; i < n; i++) {
      const v = this.victims[i]!;
      const dv = (v.cx - lx) * (v.cx - lx) + (v.cy - ly) * (v.cy - ly);
      let blocked = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = this.victims[j]!;
        const dO = (o.cx - lx) * (o.cx - lx) + (o.cy - ly) * (o.cy - ly);
        if (dO >= dv) continue; // a block further from the lamp cannot occlude
        if (LimelightInstance.segmentHitsBox(lx, ly, v.cx, v.cy, o.x0, o.y0, o.x1, o.y1)) {
          blocked++;
          if (blocked >= 2) break; // two occluders is already full shadow
        }
      }
      v.occ = Math.min(1, blocked * 0.62);
    }
  }

  /** How lit a block is: pool falloff, minus whatever stands in the way. */
  private litness(v: Victim, aimX: number, aimY: number): number {
    const d = Math.hypot(v.cx - aimX, v.cy - aimY) / this.beamPx();
    const atten = 1 / (1 + d * d * this.params.falloff);
    return clamp(atten * (1 - this.params.occlusion * v.occ), 0, 1);
  }

  /** Stage a block: stand it up, and light it by the pool and by what shades it. */
  private applyVictim(v: Victim, aimX: number, aimY: number): void {
    const [ox, oy, sc] = this.liftOffset(v);
    const transform =
      sc === 1 && ox === 0 && oy === 0
        ? v.prevTransform
        : `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px) scale(${sc.toFixed(4)})`;

    const lit = this.litness(v, aimX, aimY);
    const bri = Math.round((0.62 + lit * 0.88) * 20) / 20;
    const sat = Math.round((0.66 + lit * 0.52) * 20) / 20;
    const filter = bri === 1 && sat === 1 ? v.prevFilter : `brightness(${bri}) saturate(${sat})`;

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

  /**
   * Trace the shadow a block throws from `(lx, ly)` into `ctx`, using the lifted
   * corners. Returns the silhouette so the caller can reuse it, or null when the
   * lamp is inside the block and there is nothing to cast.
   */
  private traceShadow(ctx: CanvasRenderingContext2D, lx: number, ly: number, throwDist: number): Sil | null {
    const l = this.lifted;
    const sil = silhouetteFor(lx, ly, l[0]!, l[1]!, l[4]!, l[5]!);
    if (!sil) return null;
    const ax = l[sil.a * 2]!;
    const ay = l[sil.a * 2 + 1]!;
    const bx = l[sil.b * 2]!;
    const by = l[sil.b * 2 + 1]!;
    const an = Math.hypot(ax - lx, ay - ly) || 1;
    const bn = Math.hypot(bx - lx, by - ly) || 1;

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + ((ax - lx) / an) * throwDist, ay + ((ay - ly) / an) * throwDist);
    ctx.lineTo(bx + ((bx - lx) / bn) * throwDist, by + ((by - ly) / bn) * throwDist);
    ctx.lineTo(bx, by);
    for (const c of sil.dark) ctx.lineTo(l[c * 2]!, l[c * 2 + 1]!);
    ctx.closePath();
    return sil;
  }

  /**
   * Shadows fade along their throw. A flat slab of alpha is the single biggest
   * tell that a light is fake, so each one gets a gradient from the caster out.
   */
  private shadowGradient(lx: number, ly: number, sil: Sil, throwDist: number, alpha: number): CanvasGradient {
    const l = this.lifted;
    const mx = (l[sil.a * 2]! + l[sil.b * 2]!) / 2;
    const my = (l[sil.a * 2 + 1]! + l[sil.b * 2 + 1]!) / 2;
    const n = Math.hypot(mx - lx, my - ly) || 1;
    const g = this.ctx.createLinearGradient(
      mx, my,
      mx + ((mx - lx) / n) * throwDist * 0.62,
      my + ((my - ly) / n) * throwDist * 0.62,
    );
    g.addColorStop(0, `rgba(2,3,10,${alpha.toFixed(3)})`);
    g.addColorStop(0.45, `rgba(3,5,14,${(alpha * 0.55).toFixed(3)})`);
    g.addColorStop(1, 'rgba(4,6,18,0)');
    return g;
  }

  private render(t: number, aimX: number, aimY: number, apex: [number, number], back: [number, number]): void {
    const ctx = this.ctx;
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'source-over';

    const gel = this.gel();
    const beam = this.beamPx();
    const throwDist = Math.hypot(this.w, this.h) * 2.2 * this.params.shadowLength;

    // 1. House lights down: translucent, so the page reads dim rather than gone.
    ctx.fillStyle = `rgba(4,6,16,${this.params.ambient.toFixed(3)})`;
    ctx.fillRect(0, 0, this.w, this.h);

    // 2. Punch the pool out of the wash — the page shows through, lit.
    ctx.globalCompositeOperation = 'destination-out';
    const hole = ctx.createRadialGradient(aimX, aimY, 0, aimX, aimY, beam);
    hole.addColorStop(0, 'rgba(0,0,0,1)');
    hole.addColorStop(0.42, 'rgba(0,0,0,0.9)');
    hole.addColorStop(0.75, 'rgba(0,0,0,0.42)');
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(aimX, aimY, beam, 0, TAU);
    ctx.fill();

    // 2.5. The pool glows. On a dark page, punching a hole in the wash shows
    // more dark — this additive floor is what the shadows then visibly carve,
    // so the shadow story reads on any page. Drawn BEFORE the shadows on
    // purpose: light first, then the set eats it.
    ctx.globalCompositeOperation = 'lighter';
    const pool = ctx.createRadialGradient(aimX, aimY, 0, aimX, aimY, beam * 1.05);
    pool.addColorStop(0, `rgba(${gel[0]},${gel[1]},${gel[2]},0.3)`);
    pool.addColorStop(0.5, `rgba(${gel[0]},${gel[1]},${gel[2]},0.14)`);
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(aimX, aimY, beam * 1.05, 0, TAU);
    ctx.fill();
    const hot = ctx.createRadialGradient(aimX, aimY, 0, aimX, aimY, beam * 0.42);
    hot.addColorStop(0, `rgba(${gel[0]},${gel[1]},${gel[2]},0.24)`);
    hot.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hot;
    ctx.beginPath();
    ctx.arc(aimX, aimY, beam * 0.42, 0, TAU);
    ctx.fill();

    // 3. The set casts back into its own light — key, then the cold counter.
    ctx.globalCompositeOperation = 'source-over';
    if (this.params.shadowLength > 0 && this.params.shadowOpacity > 0) {
      for (const v of this.victims) {
        this.buildBoxes(v);
        const sil = this.traceShadow(ctx, apex[0], apex[1], throwDist);
        if (!sil) continue;
        ctx.fillStyle = this.shadowGradient(apex[0], apex[1], sil, throwDist, this.params.shadowOpacity);
        ctx.fill();
      }
      const backA = this.params.shadowOpacity * this.params.backLight * 0.45;
      if (backA > 0.01) {
        for (const v of this.victims) {
          this.buildBoxes(v);
          const sil = this.traceShadow(ctx, back[0], back[1], throwDist * 0.7);
          if (!sil) continue;
          ctx.fillStyle = this.shadowGradient(back[0], back[1], sil, throwDist * 0.7, backA);
          ctx.fill();
        }
      }
    }

    // 4. Side walls: the flats have thickness, so they read as objects standing
    //    on the page rather than pictures printed on it.
    this.drawWalls();

    // 5. Rim light on the faces turned toward each lamp.
    ctx.globalCompositeOperation = 'lighter';
    this.drawRims(apex, gel, this.params.rim, aimX, aimY);
    this.drawRims(back, [150, 196, 255], this.params.rim * this.params.backLight * 0.9, aimX, aimY);

    // 6. The shaft itself, with the set's slots carved out of it.
    this.compositeBeam(apex, aimX, aimY, beam, gel, throwDist);

    // 7. Haze at the pool, and dust riding the shaft.
    const haze = ctx.createRadialGradient(aimX, aimY, 0, aimX, aimY, beam * 0.95);
    haze.addColorStop(0, `rgba(${gel[0]},${gel[1]},${gel[2]},0.14)`);
    haze.addColorStop(0.6, `rgba(${gel[0]},${gel[1]},${gel[2]},0.045)`);
    haze.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(aimX, aimY, beam * 0.95, 0, TAU);
    ctx.fill();
    this.drawMotes(t, apex, aimX, aimY, beam, gel);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** The visible thickness of each flat: a quad from its footprint to where it stands. */
  private drawWalls(): void {
    const ctx = this.ctx;
    if (this.params.lift <= 0) return;
    const ex = this.w / 2;
    const ey = this.h / 2;
    ctx.fillStyle = 'rgba(6,9,20,0.72)';
    for (const v of this.victims) {
      this.buildBoxes(v);
      const l = this.lifted;
      const f = this.flat;
      // Walls face the viewer, so the silhouette is the one presented to the eye.
      const sil = silhouetteFor(ex, ey, l[0]!, l[1]!, l[4]!, l[5]!);
      if (!sil) continue;
      for (let i = 0; i < sil.lit.length - 1; i++) {
        const p = sil.lit[i]!;
        const q = sil.lit[i + 1]!;
        ctx.beginPath();
        ctx.moveTo(f[p * 2]!, f[p * 2 + 1]!);
        ctx.lineTo(f[q * 2]!, f[q * 2 + 1]!);
        ctx.lineTo(l[q * 2]!, l[q * 2 + 1]!);
        ctx.lineTo(l[p * 2]!, l[p * 2 + 1]!);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** A bright edge along the faces turned toward a lamp. */
  private drawRims(lamp: [number, number], gel: RGB, gain: number, aimX: number, aimY: number): void {
    if (gain <= 0.02) return;
    const ctx = this.ctx;
    ctx.lineJoin = 'round';
    for (const v of this.victims) {
      const lit = this.litness(v, aimX, aimY);
      const a = 0.55 * gain * (0.22 + lit * 0.78);
      if (a < 0.02) continue;
      // Blocks in the pool get a fat hot edge; the rest a hairline.
      ctx.lineWidth = 1 + lit * 1.9;
      this.buildBoxes(v);
      const l = this.lifted;
      const sil = silhouetteFor(lamp[0], lamp[1], l[0]!, l[1]!, l[4]!, l[5]!);
      if (!sil) continue;
      ctx.strokeStyle = `rgba(${gel[0]},${gel[1]},${gel[2]},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(l[sil.lit[0]! * 2]!, l[sil.lit[0]! * 2 + 1]!);
      for (let i = 1; i < sil.lit.length; i++) {
        ctx.lineTo(l[sil.lit[i]! * 2]!, l[sil.lit[i]! * 2 + 1]!);
      }
      ctx.stroke();
    }
  }

  /**
   * Draw the volumetric shaft on its own layer, punch the set's shadows out of
   * it, then add the result. The carved slots are what sell it: the beam is
   * visibly interrupted by the page's own content.
   */
  private compositeBeam(
    apex: [number, number],
    aimX: number,
    aimY: number,
    beam: number,
    gel: RGB,
    throwDist: number,
  ): void {
    const strength = this.params.beamStrength;
    if (strength <= 0.01) return;
    const bc = this.beamCtx;
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    bc.setTransform(dpr, 0, 0, dpr, 0, 0);
    bc.clearRect(0, 0, this.w, this.h);
    bc.globalCompositeOperation = 'source-over';

    const dx = aimX - apex[0];
    const dy = aimY - apex[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    // The shaft terminates AT the pool — a beam that runs off the bottom of
    // the frame reads as a glitch, not a light.
    const far = len * 1.12;
    const spread = beam / len;

    // Two nested wedges: the wider one at low alpha softens the beam's edge.
    for (const [widen, mul] of [[1.5, 0.32], [1, 1]] as const) {
      const halfFar = spread * far * widen;
      const g = bc.createLinearGradient(apex[0], apex[1], apex[0] + ux * far, apex[1] + uy * far);
      const a = 0.2 * strength * mul;
      g.addColorStop(0, `rgba(${gel[0]},${gel[1]},${gel[2]},${(a * 1.1).toFixed(4)})`);
      g.addColorStop(0.62, `rgba(${gel[0]},${gel[1]},${gel[2]},${(a * 0.75).toFixed(4)})`);
      g.addColorStop(0.88, `rgba(${gel[0]},${gel[1]},${gel[2]},${(a * 0.3).toFixed(4)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      bc.fillStyle = g;
      bc.beginPath();
      bc.moveTo(apex[0], apex[1]);
      bc.lineTo(apex[0] + ux * far + px * halfFar, apex[1] + uy * far + py * halfFar);
      bc.lineTo(apex[0] + ux * far - px * halfFar, apex[1] + uy * far - py * halfFar);
      bc.closePath();
      bc.fill();
    }

    // Terminal splash where the shaft lands — drawn on the beam layer so the
    // set's shadows carve it along with the shaft itself.
    const splash = bc.createRadialGradient(aimX, aimY, 0, aimX, aimY, beam * 0.8);
    splash.addColorStop(0, `rgba(${gel[0]},${gel[1]},${gel[2]},${(0.28 * strength).toFixed(4)})`);
    splash.addColorStop(1, 'rgba(0,0,0,0)');
    bc.fillStyle = splash;
    bc.beginPath();
    bc.ellipse(aimX, aimY, beam * 0.8, beam * 0.52, 0, 0, TAU);
    bc.fill();

    // The set eats the light it stands in.
    bc.globalCompositeOperation = 'destination-out';
    bc.fillStyle = 'rgba(0,0,0,0.92)';
    for (const v of this.victims) {
      this.buildBoxes(v);
      if (this.traceShadow(bc, apex[0], apex[1], throwDist)) bc.fill();
    }
    bc.globalCompositeOperation = 'source-over';

    this.ctx.globalCompositeOperation = 'lighter';
    this.ctx.drawImage(this.beamCanvas, 0, 0, this.w, this.h);
  }

  private drawMotes(
    t: number,
    apex: [number, number],
    aimX: number,
    aimY: number,
    beam: number,
    gel: RGB,
  ): void {
    const ctx = this.ctx;
    if (!this.motes.length) return;
    const dx = aimX - apex[0];
    const dy = aimY - apex[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    for (const m of this.motes) {
      // Dust settles down the shaft and wobbles across it.
      const along = ((m.along + t * m.drift) % 1.15) + 0.05;
      const across = m.across * (0.35 + along * 0.75) + 0.08 * Math.sin(t * m.drift * 6 + m.ph);
      const d = along * len * 1.25;
      const spread = beam * along * 1.15;
      const x = apex[0] + ux * d + px * across * spread;
      const y = apex[1] + uy * d + py * across * spread;
      if (y < -20 || y > this.h + 20) continue;
      const fade = (1 - Math.abs(m.across)) * (0.45 + 0.55 * Math.sin(t * 0.0008 + m.ph)) * (1 - along * 0.45);
      if (fade <= 0.02) continue;
      ctx.fillStyle = `rgba(${gel[0]},${gel[1]},${gel[2]},${(0.4 * fade).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, m.size, 0, TAU);
      ctx.fill();
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
    this.measure();
    this.sizeCanvas();
    this.collectVictims();
    if (this.paused) this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
    if (this.paused) this.renderStill();
  }

  /** The practical composition stack, bottom-up. */
  composition(): SaverLayer[] {
    return [
      { id: 'page', label: 'Stage page', kind: 'page', description: 'Blocks stand up with parallax, brighten in the pool, dim in each other\'s shadow. Restored on dispose.' },
      { id: 'surface', label: 'Light canvas', kind: 'surface', el: this.canvas, description: 'The rig\'s light drawn over the page.' },
      { id: 'wash', label: 'House wash & pool', kind: 'pass' },
      { id: 'shadows', label: 'Cast shadows (key + counter)', kind: 'pass' },
      { id: 'walls', label: 'Side walls & rims', kind: 'pass' },
      { id: 'beam', label: 'Volumetric beam (own buffer, slots carved)', kind: 'pass' },
      { id: 'motes', label: 'Haze & dust', kind: 'pass' },
    ];
  }

  /**
   * Pure, frame-addressable render at logical time `t` — canvas AND page.
   * Occlusion resolves on a bucket derived from `t`, so seeking backwards
   * reproduces the earlier frame exactly rather than approximately.
   */
  renderFrame(t: number, _seed: number): void {
    this.t = t;
    this.applyParams(t);
    this.measure();
    const [aimX, aimY] = this.aimFrom(this.params, t);
    const apex = this.apexFrom(this.params, aimX);
    const back = this.backFrom(this.params, aimX);
    this.resolveOcclusion(t);
    for (const v of this.victims) this.applyVictim(v, aimX, aimY);
    this.render(t, aimX, aimY, apex, back);
  }

  dispose(): void {
    this.stop();
    this.restoreVictims();
    this.canvas.remove();
  }
}

/** The limelight saver plugin. */
export const limelight: SaverPlugin = {
  manifest: limelightManifest,
  mount: (ctx: SaverContext) => new LimelightInstance(ctx),
};

/** A demo control-track: one slow cross-stage rake, tightening to a hard
 *  followspot at centre and opening back out. Deterministic. */
export const demoTrack: ControlTrack = {
  program: 'limelight',
  seed: 19,
  duration: 20000,
  loop: true,
  deltas: [
    { t: 0, path: 'roamX', value: 0 },
    { t: 0, path: 'roamY', value: 0 },
    { t: 0, path: 'lightX', value: 0.1 },
    { t: 10000, path: 'lightX', value: 0.9, ease: 'smooth' },
    { t: 20000, path: 'lightX', value: 0.1, ease: 'smooth' },
    { t: 0, path: 'lightY', value: 0.3 },
    { t: 10000, path: 'lightY', value: 0.62, ease: 'smooth' },
    { t: 20000, path: 'lightY', value: 0.3, ease: 'smooth' },
    { t: 0, path: 'beamSize', value: 0.55 },
    { t: 10000, path: 'beamSize', value: 0.24, ease: 'smooth' },
    { t: 20000, path: 'beamSize', value: 0.55, ease: 'smooth' },
    { t: 0, path: 'warmth', value: 0.15 },
    { t: 10000, path: 'warmth', value: 0.92, ease: 'smooth' },
    { t: 20000, path: 'warmth', value: 0.15, ease: 'smooth' },
  ],
};
