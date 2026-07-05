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
 * Typed knobs an agent can steer via a control-track. Geometry knobs re-measure
 * on change; brightness / tilt / roam are applied per frame. `particleCount` is
 * read only at build.
 */
const PARAM_SPACE = {
  holeRadius: { type: 'number', default: 0.052, min: 0.02, max: 0.12, ease: 'smooth' },
  diskInner: { type: 'number', default: 1.5, min: 1.1, max: 2.5, ease: 'smooth' },
  diskOuter: { type: 'number', default: 0.17, min: 0.08, max: 0.3, ease: 'smooth' },
  pull: { type: 'number', default: 0.32, min: 0.1, max: 0.5, ease: 'smooth' },
  tilt: { type: 'number', default: 0.4, min: 0.05, max: 0.9, ease: 'smooth' },
  roamSpeedX: { type: 'number', default: 0.00042, min: 0, max: 0.002, ease: 'smooth' },
  roamSpeedY: { type: 'number', default: 0.00058, min: 0, max: 0.002, ease: 'smooth' },
  diskBrightness: { type: 'number', default: 1, min: 0, max: 2.5, ease: 'smooth' },
  absorption: { type: 'number', default: 1, min: 0, max: 2, ease: 'smooth' },
  particleCount: { type: 'number', default: 520, min: 80, max: 1200 },
} satisfies ParamSpace;

export const blackHoleManifest: SaverManifest = {
  id: 'black-hole',
  label: 'Black Hole',
  passthrough: true,
  minBackend: 'canvas2d',
  costTier: 'medium',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  a11y: { flashSafe: true, notes: 'No fast flashing; warm gradient over a dark field.' },
};

/** Generic content selector a passthrough saver eats. Hosts can override later. */
const VICTIM_SELECTOR =
  'main :is(h1,h2,h3,h4,p,li,img,a,button), nav a, header a, footer a, .card, [data-idle-victim]';

interface Particle {
  rNorm: number; // 0..1 radius within [ri, ro]
  a0: number; // initial angle
  tn: number; // temperature norm
}

interface Victim {
  el: HTMLElement;
  hx: number;
  hy: number;
  p: number;
  spin: number;
  prevTransform: string;
  prevOpacity: string;
  prevWillChange: string;
  prevTransition: string;
}

type Params = Record<keyof typeof PARAM_SPACE, number>;

class BlackHoleInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;

  private w = 0;
  private h = 0;
  private rh = 0;
  private ri = 0;
  private ro = 0;
  private pullR = 0;
  private tilt = 0.4;

  private hx = 0;
  private hy = 0;
  private cx0 = 0;
  private cy0 = 0;
  private ax = 0;
  private ay = 0;
  private ph = Math.PI / 3;

  private disk: Particle[] = [];
  private victims: Victim[] = [];
  private reforming = false;
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
    const c2d = this.canvas.getContext('2d', { alpha: true });
    if (!c2d) throw new Error('black-hole: no 2d context');
    this.ctx = c2d;
    this.w = ctx.width;
    this.h = ctx.height;
    this.buildDisk();
    this.measure();
    this.collectVictims();
    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  // ---- params ----
  private applyParams(t: number): void {
    const p = this.track ? sampleTrack(PARAM_SPACE, this.track, t) : this.params;
    for (const k of Object.keys(PARAM_SPACE) as Array<keyof typeof PARAM_SPACE>) {
      const v = p[k];
      this.params[k] = typeof v === 'number' ? v : this.params[k];
    }
  }

  // ---- geometry ----
  private measure(): void {
    const s = Math.min(this.w, this.h);
    this.rh = s * this.params.holeRadius;
    this.ri = this.rh * this.params.diskInner;
    this.ro = s * this.params.diskOuter;
    this.pullR = s * this.params.pull;
    this.tilt = this.params.tilt;
    const mx = this.w * 0.16;
    const my = this.h * 0.16;
    this.cx0 = this.w / 2;
    this.cy0 = this.h / 2;
    this.ax = this.w / 2 - mx;
    this.ay = this.h / 2 - my;
    this.hx = this.cx0;
    this.hy = this.cy0;
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private temp(tn: number): [number, number, number] {
    const stops: [number, [number, number, number]][] = [
      [0.0, [206, 230, 255]],
      [0.2, [255, 246, 224]],
      [0.45, [255, 200, 120]],
      [0.72, [255, 118, 64]],
      [1.0, [150, 34, 22]],
    ];
    for (let i = 1; i < stops.length; i++) {
      if (tn <= stops[i]![0]) {
        const [p0, c0] = stops[i - 1]!;
        const [p1, c1] = stops[i]!;
        const k = (tn - p0) / (p1 - p0 || 1);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return stops[stops.length - 1]![1];
  }

  private buildDisk(): void {
    const rng = this.ctxSaver.rng;
    const n = Math.round(this.params.particleCount);
    this.disk = new Array(n);
    for (let i = 0; i < n; i++) {
      const rNorm = Math.pow(rng.next(), 1.6);
      this.disk[i] = { rNorm, a0: rng.next() * Math.PI * 2, tn: rNorm };
    }
  }

  // ---- page victims (passthrough) ----
  private collectVictims(): void {
    this.victims = [];
    const page = this.ctxSaver.page;
    if (!page) return;
    let els = page.victims(VICTIM_SELECTOR);
    els = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
    const rng = this.ctxSaver.rng;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 6) continue;
      if (r.bottom < -40 || r.top > this.h + 40) continue;
      if (r.right < 0 || r.left > this.w) continue;
      this.victims.push({
        el,
        hx: r.left + r.width / 2,
        hy: r.top + r.height / 2,
        p: 0,
        spin: (rng.next() < 0.5 ? -1 : 1) * (0.4 + rng.next() * 0.8),
        prevTransform: el.style.transform,
        prevOpacity: el.style.opacity,
        prevWillChange: el.style.willChange,
        prevTransition: el.style.transition,
      });
      el.style.willChange = 'transform, opacity';
      el.style.transition = 'none';
    }
  }

  private restoreVictims(): void {
    for (const v of this.victims) {
      v.el.style.transform = v.prevTransform;
      v.el.style.opacity = v.prevOpacity;
      v.el.style.willChange = v.prevWillChange;
      v.el.style.transition = v.prevTransition;
    }
    this.victims = [];
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
    this.t = now - this.startT;
    this.applyParams(this.t);
    this.measure();
    this.moveHole();
    this.suck();
    this.render();
  }

  private moveHole(): void {
    this.hx = this.cx0 + this.ax * Math.sin(this.t * this.params.roamSpeedX);
    this.hy = this.cy0 + this.ay * Math.sin(this.t * this.params.roamSpeedY + this.ph);
  }

  private suck(): void {
    if (!this.victims.length) return;
    let consumed = 0;
    for (const v of this.victims) {
      if (this.reforming) {
        v.p = Math.max(0, v.p - 0.02);
      } else if (v.p < 1) {
        const dx = v.hx - this.hx;
        const dy = v.hy - this.hy;
        const d = Math.hypot(dx, dy);
        if (d < this.pullR) {
          const grip = 1 - d / this.pullR;
          v.p = Math.min(1, v.p + (0.006 + grip * grip * 0.05));
        }
      }
      if (v.p >= 1) consumed++;
      this.applyVictim(v);
    }
    if (!this.reforming && consumed >= this.victims.length * 0.85) this.reforming = true;
    else if (this.reforming && consumed === 0 && this.allHome()) this.reforming = false;
  }

  private allHome(): boolean {
    for (const v of this.victims) if (v.p > 0.001) return false;
    return true;
  }

  private applyVictim(v: Victim): void {
    const dx = this.hx - v.hx;
    const dy = this.hy - v.hy;
    const d = Math.hypot(dx, dy) + 1;
    const nx = dx / d;
    const ny = dy / d;
    const lens = Math.min(1, ((this.pullR * this.pullR) / (d * d)) * 0.09);
    const bend = lens * this.rh * 2.6;
    const swirl = lens * this.rh * 2.2;
    const lx = nx * bend - ny * swirl;
    const ly = ny * bend + nx * swirl;

    if (v.p <= 0.0005) {
      if (lens < 0.008) {
        v.el.style.transform = v.prevTransform;
        v.el.style.opacity = v.prevOpacity;
        return;
      }
      v.el.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) rotate(${(swirl * 6).toFixed(1)}deg)`;
      v.el.style.opacity = v.prevOpacity;
      return;
    }
    const e = v.p * v.p * (3 - 2 * v.p);
    const tx = dx * e + lx * (1 - e);
    const ty = dy * e + ly * (1 - e);
    const scale = Math.max(0, 1 - e * 0.96);
    const rot = e * v.spin * 220 + swirl * (1 - e) * 6;
    v.el.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
    v.el.style.opacity = String(Math.max(0, 1 - e * e).toFixed(3));
  }

  private renderStill(): void {
    this.applyParams(this.t);
    this.measure();
    this.hx = this.cx0;
    this.hy = this.cy0;
    this.render();
  }

  // ---- draw ----
  private render(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawAbsorption();

    ctx.globalCompositeOperation = 'lighter';
    for (const v of this.victims) {
      if (v.p <= 0.02 || v.p >= 0.995) continue;
      const e = v.p * v.p * (3 - 2 * v.p);
      const ex = v.hx + (this.hx - v.hx) * e;
      const ey = v.hy + (this.hy - v.hy) * e;
      const g = ctx.createLinearGradient(ex, ey, this.hx, this.hy);
      g.addColorStop(0, 'rgba(120,200,255,0)');
      g.addColorStop(1, `rgba(255,210,150,${(0.5 * (1 - e)).toFixed(3)})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(this.hx, this.hy);
      ctx.stroke();
    }

    const haze = ctx.createRadialGradient(this.hx, this.hy, this.rh * 0.6, this.hx, this.hy, this.ro * 1.5);
    haze.addColorStop(0, 'rgba(255,150,70,0.28)');
    haze.addColorStop(0.5, 'rgba(255,90,40,0.08)');
    haze.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(this.hx, this.hy, this.ro * 1.5, 0, Math.PI * 2);
    ctx.fill();

    this.drawDisk((sin) => sin < 0);

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(this.hx, this.hy, this.rh, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    this.drawPhotonRing();
    this.drawDisk((sin) => sin >= 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawAbsorption(): void {
    const ctx = this.ctx;
    const alpha = this.params.absorption;
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createRadialGradient(this.hx, this.hy, this.rh * 0.5, this.hx, this.hy, this.pullR * 1.15);
    g.addColorStop(0, `rgba(3,4,10,${(0.82 * alpha).toFixed(3)})`);
    g.addColorStop(0.25, `rgba(3,4,10,${(0.5 * alpha).toFixed(3)})`);
    g.addColorStop(0.6, `rgba(3,4,10,${(0.16 * alpha).toFixed(3)})`);
    g.addColorStop(1, 'rgba(3,4,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.hx, this.hy, this.pullR * 1.15, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawDisk(pick: (sin: number) => boolean): void {
    const ctx = this.ctx;
    const frames = this.t / 16;
    const bright = this.params.diskBrightness;
    const span = this.ro - this.ri || 1;
    for (const part of this.disk) {
      const r = this.ri + span * part.rNorm;
      const w = 0.06 * Math.pow(this.ri / r, 1.5);
      const a = part.a0 + w * frames;
      const sin = Math.sin(a);
      if (!pick(sin)) continue;
      const x = this.hx + Math.cos(a) * r;
      const y = this.hy + sin * r * this.tilt;
      const beam = 0.7 + 0.5 * Math.cos(a);
      const b = (0.4 + (1 - part.tn) * 0.7) * bright;
      const alpha = Math.min(1, b * beam);
      const [cr, cg, cb] = this.temp(part.tn);
      const size = 0.6 + (1 - part.tn) * 1.6;
      ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPhotonRing(): void {
    const ctx = this.ctx;
    const rr = this.rh * 1.06;
    const grad = ctx.createRadialGradient(this.hx, this.hy, rr * 0.92, this.hx, this.hy, rr * 1.6);
    grad.addColorStop(0, 'rgba(255,244,224,0.95)');
    grad.addColorStop(0.35, 'rgba(255,180,110,0.5)');
    grad.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.hx, this.hy, rr * 1.6, 0, Math.PI * 2);
    ctx.arc(this.hx, this.hy, rr * 0.98, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,248,235,0.95)';
    ctx.lineWidth = Math.max(1, this.rh * 0.06);
    ctx.beginPath();
    ctx.arc(this.hx, this.hy, rr, 0, Math.PI * 2);
    ctx.stroke();
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

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.restoreVictims();
    this.measure();
    this.collectVictims();
    if (this.paused) this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
    if (this.paused) this.renderStill();
  }

  /** Pure, frame-addressable render: draw the state at logical time `t` for `seed`. */
  renderFrame(t: number, _seed: number): void {
    this.t = t;
    this.applyParams(t);
    this.measure();
    this.moveHole();
    this.render();
  }

  dispose(): void {
    this.stop();
    this.restoreVictims();
    this.canvas.remove();
  }
}

/** The black-hole saver plugin. */
export const blackHole: SaverPlugin = {
  manifest: blackHoleManifest,
  mount: (ctx: SaverContext) => new BlackHoleInstance(ctx),
};

/** A demo control-track that breathes the disk brightness and tips the tilt.
 *  Deterministic: apply it, then `renderFrame(t, seed)` reproduces every frame. */
export const demoTrack: ControlTrack = {
  program: 'black-hole',
  seed: 42,
  duration: 6000,
  loop: true,
  deltas: [
    { t: 0, path: 'diskBrightness', value: 0.7 },
    { t: 2000, path: 'diskBrightness', value: 1.8, ease: 'smooth' },
    { t: 4000, path: 'diskBrightness', value: 0.7, ease: 'smooth' },
    { t: 0, path: 'tilt', value: 0.18 },
    { t: 3000, path: 'tilt', value: 0.5, ease: 'smooth' },
    { t: 6000, path: 'tilt', value: 0.18, ease: 'smooth' },
  ],
};
