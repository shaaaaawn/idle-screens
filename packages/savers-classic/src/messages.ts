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
 * Messages — the consolidated, modernized descendant of the two After Dark
 * text savers (concepts by Berkeley Systems; CSS reference by Bryan Braun's
 * after-dark-css, MIT). The old pair shipped as separate hard-coded CSS
 * keyframe ports:
 *   - "Out to Lunch": a marquee crawl that stepped down the page
 *   - "Macintosh": a line drifting corner-to-corner
 * They are now two `mode`s of ONE canvas saver — closed-form in `t`, so the
 * timeline scrubs it; typed params, so agents and the workbench steer it;
 * worker-ready, so it renders off-main-thread; and typeset like it's this
 * century.
 */
const PHRASES = {
  'out-to-lunch': 'OUT TO LUNCH',
  'staring': 'Why are you staring at my Macintosh?',
  'brb': 'BE RIGHT BACK',
  'gone-idle': 'gone idle — leave a message',
  'ship-it': 'SHIP IT IN THE MORNING',
} as const;
type PhraseKey = keyof typeof PHRASES;

const PARAM_SPACE = {
  /** Which line the screen mutters. */
  phrase: { type: 'enum', default: 'out-to-lunch', options: Object.keys(PHRASES) },
  /** 'marquee' = the Out-to-Lunch crawl (steps down the page);
   *  'drift' = the Macintosh corner-to-corner wander. */
  mode: { type: 'enum', default: 'marquee', options: ['marquee', 'drift'] },
  speed: { type: 'number', default: 1, min: 0.25, max: 3, ease: 'smooth' },
  /** Text size multiplier on the short-edge-relative base. */
  textScale: { type: 'number', default: 1, min: 0.5, max: 2.6, ease: 'smooth' },
  ink: { type: 'color', default: '#e8ecf4' },
  /** Phosphor glow around the letters. */
  glow: { type: 'number', default: 0.4, min: 0, max: 1, ease: 'smooth' },
  /** Ghost trail of previous instants. */
  trail: { type: 'number', default: 0.25, min: 0, max: 1, ease: 'smooth' },
} satisfies ParamSpace;

export const messagesManifest: SaverManifest = {
  id: 'messages',
  label: 'Messages',
  timeModel: 'closed-form',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  attribution: {
    source: 'After Dark "Messages" — concepts by Berkeley Systems',
    license: 'MIT port; reference CSS MIT (Bryan Braun)',
    url: 'https://github.com/bryanbraun/after-dark-css',
  },
  a11y: { flashSafe: true, notes: 'A single line of text moving smoothly; no flashing.' },
  workerReady: true,
};

interface Params {
  phrase: PhraseKey;
  mode: 'marquee' | 'drift';
  speed: number;
  textScale: number;
  ink: string;
  glow: number;
  trail: number;
}

/** Triangle wave in [0,1] with period `p` — the CSS `alternate` of the original. */
const tri = (t: number, p: number): number => {
  const k = ((t % (p * 2)) + p * 2) % (p * 2);
  return k < p ? k / p : 2 - k / p;
};

class MessagesInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly c2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

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
    const c2d = this.canvas.getContext('2d', { alpha: false }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!c2d) throw new Error('messages: no 2d context');
    this.c2d = c2d;
    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

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

  // ---- closed-form placement ----

  private fontPx(): number {
    return Math.max(14, Math.min(this.w, this.h) * 0.05 * this.params.textScale);
  }

  private font(): string {
    // The 1992 default was Times New Roman. We can do better and still stay
    // self-contained: a weighted system stack, spaced like a sign, not a doc.
    return `500 ${this.fontPx().toFixed(1)}px ui-rounded, "Avenir Next", "Segoe UI Variable Display", system-ui, sans-serif`;
  }

  /** Position of the line's left baseline at time `t`. Pure. */
  private place(t: number, textW: number): [number, number] {
    const p = this.params;
    const fs = this.fontPx();
    if (p.mode === 'marquee') {
      // The classic: a 10s crawl right-to-left, restepping down the page in
      // thirds every crawl (the old `steps(3)` descent).
      const crawl = 10_000 / p.speed;
      const k = ((t % crawl) + crawl) % crawl;
      const x = this.w - (k / crawl) * (this.w + textW * 1.5);
      const stepPhase = ((t % (crawl * 3)) + crawl * 3) % (crawl * 3);
      const row = Math.floor(stepPhase / crawl); // 0, 1, 2
      const y = this.h * 0.22 + row * this.h * 0.27 + fs * 0.5;
      return [x, y];
    }
    // Drift: the Macintosh wander — two incommensurate triangle waves, exactly
    // the original's 8s / 17.3s alternate pair.
    const x = tri(t, 8_000 / p.speed) * Math.max(0, this.w - textW);
    const y = fs + tri(t, 17_300 / p.speed) * Math.max(0, this.h - fs * 1.6);
    return [x, y];
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

  private render(t: number): void {
    const ctx = this.c2d;
    const p = this.params;
    ctx.fillStyle = '#04050a';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.font = this.font();
    ctx.textBaseline = 'alphabetic';
    const text = PHRASES[p.phrase] ?? PHRASES['out-to-lunch'];
    const textW = ctx.measureText(text).width;

    // Ghost trail: the same pure placement at recent instants, fading out.
    if (p.trail > 0.02) {
      for (let k = 4; k >= 1; k--) {
        const [gx, gy] = this.place(t - k * 90, textW);
        ctx.globalAlpha = p.trail * 0.16 * (1 - k / 5);
        ctx.fillStyle = p.ink;
        ctx.fillText(text, gx, gy);
      }
      ctx.globalAlpha = 1;
    }

    const [x, y] = this.place(t, textW);
    if (p.glow > 0.02) {
      ctx.shadowColor = p.ink;
      ctx.shadowBlur = this.fontPx() * 0.55 * p.glow;
    }
    ctx.fillStyle = p.ink;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
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

  /** Pure, frame-addressable render at logical time `t`. */
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

/** The consolidated messages saver plugin (marquee + drift modes). */
export const messages: SaverPlugin = {
  manifest: messagesManifest,
  mount: (ctx: SaverContext) => new MessagesInstance(ctx),
};

/** A demo control-track: the lunch marquee hands over to the Macintosh drift
 *  and back, glow breathing across the cut. Deterministic. */
export const messagesDemoTrack: ControlTrack = {
  program: 'messages',
  seed: 2,
  duration: 20000,
  loop: true,
  deltas: [
    { t: 0, path: 'mode', value: 'marquee' },
    { t: 10000, path: 'mode', value: 'drift' },
    { t: 0, path: 'phrase', value: 'out-to-lunch' },
    { t: 10000, path: 'phrase', value: 'staring' },
    { t: 0, path: 'glow', value: 0.2 },
    { t: 5000, path: 'glow', value: 0.7, ease: 'smooth' },
    { t: 10000, path: 'glow', value: 0.2, ease: 'smooth' },
    { t: 15000, path: 'glow', value: 0.7, ease: 'smooth' },
    { t: 20000, path: 'glow', value: 0.2, ease: 'smooth' },
  ],
};
