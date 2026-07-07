import type {
  SaverContext,
  SaverInstance,
  SaverManifest,
  SaverPlugin,
} from '@idle-screens/core';

/**
 * Rainstorm — layered parallax rain with a periodic lightning flash. Ported from
 * the After Dark CSS screensaver (MIT, github.com/bryanbraun/after-dark-css);
 * artwork © Berkeley Systems.
 *
 * The Angular original stacked six repeating rain-tile PNGs at three depths and
 * drifted them diagonally, with a `flash` keyframe strobing the background white
 * for a frame every 8s. Here it is re-authored dependency-free on canvas2d:
 * three depth layers of angled streaks fall + drift, over a near-black sky that
 * briefly flashes white as lightning.
 */
export const rainstormManifest: SaverManifest = {
  id: 'rainstorm',
  label: 'Rainstorm',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'moderate',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true, notes: 'Rain streaks over a dark sky; the lightning is a brief, gentle brightening (no rapid strobe).' },
  workerReady: true,
};

/** One rain streak. Position is stored pre-drift; each layer drifts as a whole. */
interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number; // px per second (vertical component)
  width: number;
  alpha: number;
}

interface Layer {
  drops: Drop[];
  slant: number; // horizontal px per vertical px (preserves the fall angle)
}

const FLASH_PERIOD = 8000; // ms between lightning flashes (matches the 8s CSS)

class RainstormInstance implements SaverInstance {
  private readonly ctx: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly c2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private w = 0;
  private h = 0;
  private layers: Layer[] = [];

  private frameId: number | null = null;
  private paused = false;
  private last = 0;
  private clock = 0;

  constructor(ctx: SaverContext) {
    this.ctx = ctx;
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (ctx.surface) {
      canvas = ctx.surface;
    } else {
      const el = document.createElement('canvas');
      el.style.cssText = 'display:block;width:100%;height:100%';
      ctx.host.appendChild(el);
      canvas = el;
    }
    this.canvas = canvas;
    const c2d = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!c2d) throw new Error('rainstorm: no 2d context');
    this.c2d = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();
    this.buildLayers();

    this.setPaused(ctx.reducedMotion);
    if (this.paused) this.renderStill();
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctx.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Three depth layers: near (fast, long, bright), mid, distant (slow, faint). */
  private buildLayers(): void {
    const rng = this.ctx.rng;
    const area = (this.w * this.h) / (1280 * 800);
    // The three depths, mirroring r1/r2, r3/r4, r5/r6 in the original.
    const specs = [
      { count: 220, minLen: 26, maxLen: 46, minSpd: 900, maxSpd: 1150, width: 1.6, alpha: 0.5, slant: 0.19 },
      { count: 160, minLen: 16, maxLen: 30, minSpd: 520, maxSpd: 700, width: 1.2, alpha: 0.34, slant: 0.19 },
      { count: 120, minLen: 10, maxLen: 20, minSpd: 300, maxSpd: 420, width: 0.9, alpha: 0.22, slant: 0.19 },
    ];
    this.layers = specs.map((s) => {
      const n = Math.max(8, Math.round(s.count * area));
      const drops: Drop[] = new Array(n);
      for (let i = 0; i < n; i++) {
        drops[i] = {
          x: rng.range(-40, this.w + 40),
          y: rng.range(-this.h, this.h),
          len: rng.range(s.minLen, s.maxLen),
          speed: rng.range(s.minSpd, s.maxSpd),
          width: s.width,
          alpha: rng.range(s.alpha * 0.7, s.alpha),
        };
      }
      return { drops, slant: s.slant };
    });
  }

  // ---- lightning ----
  /** 0..1 flash intensity given the wall clock (ms). A short white pulse near the
   *  top of each period, echoing the CSS `flash` keyframe (98% black → 99% white). */
  private flashLevel(): number {
    const p = ((this.clock % FLASH_PERIOD) + FLASH_PERIOD) % FLASH_PERIOD;
    // pulse lives in the last ~120ms of the period
    const start = FLASH_PERIOD - 140;
    if (p < start) return 0;
    const k = (p - start) / 140; // 0..1 across the pulse
    // ramp up fast, decay
    return k < 0.4 ? k / 0.4 : Math.max(0, 1 - (k - 0.4) / 0.6);
  }

  // ---- loop ----
  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.last = 0;
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
    if (this.last === 0) this.last = now;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt * 1000;
    this.update(dt);
    this.render();
  }

  private update(dt: number): void {
    for (const layer of this.layers) {
      for (const d of layer.drops) {
        d.y += d.speed * dt;
        d.x += d.speed * layer.slant * dt;
        if (d.y - d.len > this.h) {
          d.y = -d.len - this.ctx.rng.range(0, this.h * 0.4);
          d.x = this.ctx.rng.range(-40, this.w + 40);
        }
        if (d.x - d.len > this.w) d.x = -40;
      }
    }
  }

  private render(): void {
    const ctx = this.c2d;
    const flash = this.flashLevel();
    // Sky: near-black, brightened by the lightning flash.
    const base = 8 + flash * 235;
    ctx.fillStyle = `rgb(${base | 0},${(base + 2) | 0},${(base + 8) | 0})`;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.lineCap = 'round';
    for (const layer of this.layers) {
      const dx = -layer.slant; // streaks lean back along their travel
      for (const d of layer.drops) {
        ctx.strokeStyle = `rgba(200,215,235,${d.alpha.toFixed(3)})`;
        ctx.lineWidth = d.width;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + dx * d.len, d.y - d.len);
        ctx.stroke();
      }
    }
  }

  private renderStill(): void {
    this.clock = 0;
    this.render();
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
    if (dpr !== undefined) this.ctx.dpr = dpr;
    this.sizeCanvas();
    this.buildLayers();
    if (this.paused) this.renderStill();
  }

  dispose(): void {
    this.stop();
    if (this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
  }
}

/** The rainstorm saver plugin. */
export const rainstorm: SaverPlugin = {
  manifest: rainstormManifest,
  mount: (ctx: SaverContext) => new RainstormInstance(ctx),
};
