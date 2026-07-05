import type { SaverContext, SaverInstance, SaverManifest, SaverPlugin } from '@idle-screens/core';

/**
 * The DVD bouncing logo. A small JS physics loop (the colour must change ON each wall
 * hit — CSS can't detect the bounce) that writes only `transform` each frame. Honours
 * pause (freeze) + reducedMotion (sit still). Bounds are cached and re-read on resize.
 *
 * Asset substitution: no logo image — the classic "DVD" wordmark is drawn as bouncing
 * coloured DOM text, fully self-contained.
 */
export const dvdManifest: SaverManifest = {
  id: 'dvd',
  label: 'DVD Bouncing Logo',
  passthrough: false,
  minBackend: 'css',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true },
};

const STYLE = `
.dvd-root { position:absolute; inset:0; display:block; overflow:hidden; background:#000; }
.dvd-logo {
  position:absolute; top:0; left:0; width:200px; will-change:transform;
  color:#39ff14; text-align:center; user-select:none;
}
.dvd-word {
  font-family:'Arial Black', Arial, sans-serif; font-size:58px; font-weight:900;
  font-style:italic; letter-spacing:-3px; line-height:1; transform:skewX(-10deg);
}
.dvd-disc {
  margin:2px auto 0; width:156px; height:20px; border-radius:50%;
  background:currentColor; position:relative;
}
.dvd-video {
  position:absolute; inset:0; color:#000; font-family:Arial, sans-serif;
  font-size:13px; font-weight:700; letter-spacing:5px; line-height:20px;
  text-indent:5px; text-align:center;
}
`;

const COLORS = [
  '#39ff14', '#ff2079', '#00e5ff', '#ffe600',
  '#ff6a00', '#b967ff', '#ff3b3b', '#f5f5f5',
];

class DvdInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly root: HTMLDivElement;
  private readonly logo: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;

  private x = 40;
  private y = 40;
  private vx = 2.4;
  private vy = 2;
  private w = 0;
  private h = 0;
  private W = 0;
  private H = 0;
  private ci = 0;
  private frameId: number | null = null;
  private paused = false;

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;

    const style = document.createElement('style');
    style.textContent = STYLE;
    ctx.host.appendChild(style);
    this.styleEl = style;

    const root = document.createElement('div');
    root.className = 'dvd-root';
    const logo = document.createElement('div');
    logo.className = 'dvd-logo';
    logo.setAttribute('aria-hidden', 'true');
    logo.innerHTML =
      '<div class="dvd-word">DVD</div>' +
      '<div class="dvd-disc"><span class="dvd-video">VIDEO</span></div>';
    root.appendChild(logo);
    ctx.host.appendChild(root);
    this.root = root;
    this.logo = logo;

    this.W = ctx.width;
    this.H = ctx.height;
    this.measure();
    this.x = ctx.rng.next() * Math.max(1, this.W - this.w);
    this.y = ctx.rng.next() * Math.max(1, this.H - this.h);
    this.vx = 2.4 * (ctx.rng.next() < 0.5 ? -1 : 1);
    this.vy = 2 * (ctx.rng.next() < 0.5 ? -1 : 1);
    this.setColor(0);
    this.apply();

    this.paused = ctx.reducedMotion;
    if (!this.paused) this.start();
  }

  private measure(): void {
    this.w = this.logo.offsetWidth;
    this.h = this.logo.offsetHeight;
    this.W = this.root.clientWidth || this.ctxSaver.width;
    this.H = this.root.clientHeight || this.ctxSaver.height;
  }

  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.measure();
    this.loop();
  }

  private stop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private loop(): void {
    this.frameId = requestAnimationFrame(() => this.loop());
    this.x += this.vx;
    this.y += this.vy;
    let hit = false;
    if (this.x <= 0) {
      this.x = 0;
      this.vx = Math.abs(this.vx);
      hit = true;
    } else if (this.x + this.w >= this.W) {
      this.x = this.W - this.w;
      this.vx = -Math.abs(this.vx);
      hit = true;
    }
    if (this.y <= 0) {
      this.y = 0;
      this.vy = Math.abs(this.vy);
      hit = true;
    } else if (this.y + this.h >= this.H) {
      this.y = this.H - this.h;
      this.vy = -Math.abs(this.vy);
      hit = true;
    }
    if (hit) this.setColor();
    this.apply();
  }

  private apply(): void {
    this.logo.style.transform = `translate(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px)`;
  }

  private setColor(next?: number): void {
    this.ci =
      next ??
      (this.ci + 1 + Math.floor(this.ctxSaver.rng.next() * (COLORS.length - 1))) % COLORS.length;
    this.logo.style.color = COLORS[this.ci];
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.stop();
    else this.start();
  }

  resize(width: number, height: number): void {
    this.W = width;
    this.H = height;
    this.measure();
    // Keep the logo inside the new bounds.
    this.x = Math.min(this.x, Math.max(0, this.W - this.w));
    this.y = Math.min(this.y, Math.max(0, this.H - this.h));
    this.apply();
  }

  dispose(): void {
    this.stop();
    this.root.remove();
    this.styleEl.remove();
  }
}

/** The DVD bouncing-logo saver plugin. */
export const dvd: SaverPlugin = {
  manifest: dvdManifest,
  mount: (ctx: SaverContext) => new DvdInstance(ctx),
};
