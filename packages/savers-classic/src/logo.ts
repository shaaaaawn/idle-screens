import type {
  SaverContext,
  SaverInstance,
  SaverManifest,
  SaverPlugin,
} from '@idle-screens/core';

/**
 * Logo — a wordmark drifting corner-to-corner over black, the classic
 * bouncing-DVD-style idle mark. Ported from the After Dark CSS
 * (MIT, github.com/bryanbraun/after-dark-css). The original used a logo.png
 * sprite in a custom face; since this port ships no image or font assets, the
 * mark is drawn as styled text ("idle") in a system serif. Keyframes namespaced
 * so multiple CSS plugins can coexist.
 */
export const logoManifest: SaverManifest = {
  id: 'logo',
  label: 'Logo',
  passthrough: false,
  minBackend: 'css',
  costTier: 'idle',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true, notes: 'A wordmark gliding smoothly; no flashing.' },
};

const CSS = `
.is-logo {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #000;
}
.is-logo .logo {
  display: block;
  position: absolute;
  width: 145px;
  height: 54px;
  line-height: 54px;
  text-align: center;
  white-space: nowrap;
  font-family: 'Times New Roman', 'Georgia', serif;
  font-weight: 700;
  letter-spacing: 0.04em;
  font-size: 34px;
  color: #fff;
  animation:
    is-logo-moveX 5s linear 0s infinite alternate,
    is-logo-moveY 6.3s linear 0s infinite alternate;
}
.is-logo.is-paused .logo {
  animation-play-state: paused !important;
}
@keyframes is-logo-moveX {
  from { left: 0; }
  to { left: calc(100% - 145px); }
}
@keyframes is-logo-moveY {
  from { top: calc(100% - 54px); }
  to { top: 0; }
}
`;

class LogoInstance implements SaverInstance {
  private readonly root: HTMLElement;
  private readonly style: HTMLStyleElement;

  constructor(ctx: SaverContext) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    ctx.host.appendChild(this.style);

    this.root = document.createElement('div');
    this.root.className = 'is-logo';
    this.root.setAttribute('aria-hidden', 'true');
    const logo = document.createElement('div');
    logo.className = 'logo';
    logo.textContent = 'idle';
    this.root.appendChild(logo);
    ctx.host.appendChild(this.root);

    this.setPaused(ctx.reducedMotion);
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('is-paused', paused);
  }

  resize(_width: number, _height: number): void {
    // Fully fluid CSS (calc/%); nothing to recompute.
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}

/** The logo saver plugin. */
export const logo: SaverPlugin = {
  manifest: logoManifest,
  mount: (ctx: SaverContext) => new LogoInstance(ctx),
};
