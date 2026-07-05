import type {
  SaverContext,
  SaverInstance,
  SaverManifest,
  SaverPlugin,
} from '@idle-screens/core';

/**
 * Messages (Out to Lunch) — "OUT TO LUNCH" crawls across the screen as a marquee
 * that also steps down the page. Ported from the After Dark CSS
 * (MIT, github.com/bryanbraun/after-dark-css). Two animations combine: a 10s
 * horizontal text crawl and a 30s `steps(3)` vertical descent. Keyframes
 * namespaced so multiple CSS plugins can coexist.
 */
export const messagesManifest: SaverManifest = {
  id: 'messages',
  label: 'Messages (Out to Lunch)',
  passthrough: false,
  minBackend: 'css',
  costTier: 'idle',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true, notes: 'Text crawls smoothly; no flashing.' },
};

const MESSAGE = 'OUT TO LUNCH';

const CSS = `
.is-messages {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #000;
}
.is-messages .message {
  white-space: nowrap;
  margin: 0;
  position: absolute;
  font-family: 'Times New Roman', 'Georgia', serif;
  font-size: 20px;
  color: #fff;
  animation:
    is-messages-marquee 10s linear infinite,
    is-messages-move 30s steps(3) infinite;
}
.is-messages.is-paused .message {
  animation-play-state: paused !important;
}
@keyframes is-messages-marquee {
  0% { text-indent: 100%; }
  100% { text-indent: -150px; }
}
@keyframes is-messages-move {
  from { top: 20%; }
  to { top: 100%; }
}
`;

class MessagesInstance implements SaverInstance {
  private readonly root: HTMLElement;
  private readonly style: HTMLStyleElement;

  constructor(ctx: SaverContext) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    ctx.host.appendChild(this.style);

    this.root = document.createElement('div');
    this.root.className = 'is-messages';
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
    // Fully fluid CSS (%/text-indent); nothing to recompute.
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}

/** The "Out to Lunch" messages saver plugin. */
export const messages: SaverPlugin = {
  manifest: messagesManifest,
  mount: (ctx: SaverContext) => new MessagesInstance(ctx),
};
