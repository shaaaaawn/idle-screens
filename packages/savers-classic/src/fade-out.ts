import type {
  SaverContext,
  SaverInstance,
  SaverManifest,
  SaverPlugin,
} from '@idle-screens/core';

/**
 * Fade Out — the screen slowly dims to black over 40s.
 *
 * Ported from the After Dark CSS (MIT, github.com/bryanbraun/after-dark-css);
 * concept © Berkeley Systems. The original overlaid a macOS desktop screenshot;
 * since this port ships no image assets, the base is a neutral dark field that
 * a single black `.dim` layer fades in over.
 */
export const fadeOutManifest: SaverManifest = {
  id: 'fade-out',
  label: 'Fade Out',
  passthrough: false,
  minBackend: 'css',
  costTier: 'idle',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true, notes: 'A slow, smooth 40s dim to black; no flashing.' },
};

const CSS = `
.is-fade-out {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #2b2b33;
  background-image:
    radial-gradient(120% 90% at 30% 20%, #3b3f4a 0%, #23262e 55%, #16181d 100%);
}
.is-fade-out .dim {
  position: absolute;
  inset: 0;
  background-color: #000;
  opacity: 0;
  animation: is-fade-out-fade 40s ease-out 1 forwards;
}
.is-fade-out.is-paused .dim {
  animation-play-state: paused !important;
}
@keyframes is-fade-out-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
`;

class FadeOutInstance implements SaverInstance {
  private readonly root: HTMLElement;
  private readonly style: HTMLStyleElement;

  constructor(ctx: SaverContext) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    ctx.host.appendChild(this.style);

    this.root = document.createElement('div');
    this.root.className = 'is-fade-out';
    this.root.setAttribute('aria-hidden', 'true');
    const dim = document.createElement('div');
    dim.className = 'dim';
    this.root.appendChild(dim);
    ctx.host.appendChild(this.root);

    this.setPaused(ctx.reducedMotion);
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('is-paused', paused);
  }

  resize(_width: number, _height: number): void {
    // Fully fluid CSS; nothing to recompute.
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}

/** The fade-out saver plugin. */
export const fadeOut: SaverPlugin = {
  manifest: fadeOutManifest,
  mount: (ctx: SaverContext) => new FadeOutInstance(ctx),
};
