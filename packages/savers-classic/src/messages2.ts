import type {
  SaverContext,
  SaverInstance,
  SaverManifest,
  SaverPlugin,
} from '@idle-screens/core';

/**
 * Messages (Macintosh) — "Why are you staring at my Macintosh?" drifts
 * corner-to-corner over black. Ported from the After Dark CSS
 * (MIT, github.com/bryanbraun/after-dark-css). Two independent linear
 * alternating animations (X: 8s, Y: 17.3s) give the drift. The original defines
 * its keyframes inside two width media queries (narrow: 160px box; wide: 467px
 * box); that quirk is preserved. Keyframes namespaced so multiple CSS plugins
 * can coexist.
 */
export const messages2Manifest: SaverManifest = {
  id: 'messages2',
  label: 'Messages II',
  passthrough: false,
  minBackend: 'css',
  costTier: 'idle',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true, notes: 'Text drifts smoothly; no flashing.' },
};

const MESSAGE = 'Why are you staring at my Macintosh?';

const CSS = `
.is-messages2 {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #000;
}
.is-messages2 .message {
  display: block;
  width: 467px;
  margin: 0;
  color: #fff;
  position: absolute;
  font-family: 'Times New Roman', 'Georgia', serif;
  font-size: 20px;
  animation:
    is-messages2-moveX 8s linear 0s infinite alternate,
    is-messages2-moveY 17.3s linear 0s infinite alternate;
}
.is-messages2.is-paused .message {
  animation-play-state: paused !important;
}

/* Responsive for less than 600px width screen size */
@media screen and (max-width: 600px) {
  .is-messages2 .message {
    width: 160px;
    height: 85px;
  }
  @keyframes is-messages2-moveX {
    from { left: 0; }
    to { left: calc(100% - 160px); }
  }
  @keyframes is-messages2-moveY {
    from { top: 0; }
    to { top: calc(100% - 85px); }
  }
}

/* Responsive for greater than 600px width screen size */
@media screen and (min-width: 600px) {
  @keyframes is-messages2-moveX {
    from { left: 0; }
    to { left: calc(100% - 467px); }
  }
  @keyframes is-messages2-moveY {
    from { top: 0; }
    to { top: calc(100% - 26px); }
  }
}
`;

class Messages2Instance implements SaverInstance {
  private readonly root: HTMLElement;
  private readonly style: HTMLStyleElement;

  constructor(ctx: SaverContext) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    ctx.host.appendChild(this.style);

    this.root = document.createElement('div');
    this.root.className = 'is-messages2';
    this.root.setAttribute('aria-hidden', 'true');
    const msg = document.createElement('h2');
    msg.className = 'message';
    msg.textContent = MESSAGE;
    this.root.appendChild(msg);
    ctx.host.appendChild(this.root);

    this.setPaused(ctx.reducedMotion);
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('is-paused', paused);
  }

  resize(_width: number, _height: number): void {
    // Fully fluid CSS (calc/% + media queries); nothing to recompute.
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}

/** The "Macintosh" messages saver plugin. */
export const messages2: SaverPlugin = {
  manifest: messages2Manifest,
  mount: (ctx: SaverContext) => new Messages2Instance(ctx),
};
