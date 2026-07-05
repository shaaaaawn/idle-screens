import type {
  SaverContext,
  SaverInstance,
  SaverManifest,
  SaverPlugin,
} from '@idle-screens/core';

/**
 * Bouncing Ball — a lone white ball drifting corner-to-corner over a dark field.
 * Ported from the After Dark CSS (MIT, github.com/bryanbraun/after-dark-css).
 * Two independent linear alternating animations (X: 3.4s, Y: 3s) give the classic
 * out-of-phase bounce. Keyframes namespaced so multiple CSS plugins can coexist.
 */
export const bouncingBallManifest: SaverManifest = {
  id: 'bouncing-ball',
  label: 'Bouncing Ball',
  passthrough: false,
  minBackend: 'css',
  costTier: 'idle',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true, notes: 'A single ball gliding smoothly; no flashing.' },
};

const CSS = `
.is-bouncing-ball {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #000;
}
.is-bouncing-ball b {
  display: block;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: #fff;
  position: absolute;
  animation:
    is-bouncing-ball-moveX 3.4s linear 0s infinite alternate,
    is-bouncing-ball-moveY 3s linear 0s infinite alternate;
}
.is-bouncing-ball.is-paused b {
  animation-play-state: paused !important;
}
@keyframes is-bouncing-ball-moveX {
  from { left: calc(100% - 40px); }
  to { left: 0; }
}
@keyframes is-bouncing-ball-moveY {
  from { top: 0; }
  to { top: calc(100% - 40px); }
}
`;

class BouncingBallInstance implements SaverInstance {
  private readonly root: HTMLElement;
  private readonly style: HTMLStyleElement;

  constructor(ctx: SaverContext) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    ctx.host.appendChild(this.style);

    this.root = document.createElement('div');
    this.root.className = 'is-bouncing-ball';
    this.root.setAttribute('aria-hidden', 'true');
    const ball = document.createElement('b');
    this.root.appendChild(ball);
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

/** The bouncing-ball saver plugin. */
export const bouncingBall: SaverPlugin = {
  manifest: bouncingBallManifest,
  mount: (ctx: SaverContext) => new BouncingBallInstance(ctx),
};
