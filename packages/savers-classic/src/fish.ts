import type { SaverContext, SaverInstance, SaverManifest, SaverPlugin } from '@idle-screens/core';
import { BUBBLES, FISH, SEAFLOOR } from './fish-assets';

/**
 * Fish Aquarium — the original After Dark "Aquatic Realm / Fish!" saver, restored exactly
 * from shawn-site's screensaver (MIT HTML/CSS, github.com/bryanbraun/after-dark-css;
 * artwork © Berkeley Systems). CSS-driven: 2-frame sprite fish swim across nine rows over
 * a repeating seafloor while bubbles rise, each fish flipping to face its heading at the
 * edges. Sprites are embedded as data URIs (see fish-assets.ts) so it is self-contained.
 * Pausing is a CSS class toggle (`animation-play-state: paused`); no JS loop.
 */
export const fishManifest: SaverManifest = {
  id: 'fish',
  label: 'Fish Aquarium',
  passthrough: false,
  minBackend: 'css',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true },
};

/** Piece = "kind fish rowN route" — the exact 16-fish layout from the original. */
const PIECES: string[] = [
  'butterfly fish row1 ltr', 'jelly fish row1 rtl-fast',
  'guppy fish row2 rtl', 'angel fish row2 rtl-delay1',
  'seahorse fish row3 rtl-delay2',
  'red fish row4 rtl-delay2', 'jelly fish row4 ltr',
  'minnow fish row5 rtl', 'seahorse fish row5 ltr-fast',
  'angel fish row6 rtl-fast',
  'striped fish row7 ltr', 'guppy fish row7 ltr-delay1',
  'angel fish row8 ltr-delay2', 'minnow fish row8 rtl-delay2',
  'flounder fish row9 rtl', 'red fish row9 ltr-delay1',
];

const STYLE = `
.fish-root { position:absolute; inset:0; display:block; overflow:hidden; background-color:#000;
  background-image:url('${SEAFLOOR}'); background-position:bottom; background-repeat:repeat-x; }
.fish-root.ss-paused * { animation-play-state: paused !important; }
.bubbles { position:absolute; bottom:-60px; display:block; width:50px; height:56px; background-repeat:no-repeat;
  background-image:url('${BUBBLES}');
  animation: fish-rise 13s linear infinite, fish-reappear 39s steps(3) linear infinite, fish-bubble-alt 0.2s steps(2) infinite; }
.fish { position:absolute; width:145px; height:145px; left:-50%; top:-50%; }
.butterfly { background-image:url('${FISH.butterfly}'); }
.guppy { background-image:url('${FISH.guppy}'); }
.seahorse { background-image:url('${FISH.seahorse}'); }
.jelly { background-image:url('${FISH.jelly}'); }
.minnow { background-image:url('${FISH.minnow}'); }
.red { background-image:url('${FISH.red}'); }
.striped { background-image:url('${FISH.striped}'); }
.angel { background-image:url('${FISH.angel}'); }
.flounder { background-image:url('${FISH.flounder}'); }
/* routes: speed, delay, direction */
.ltr { animation: fish-ltr 26s linear infinite, fish-toggle 0.2s steps(2) infinite; }
.ltr-delay1 { animation: fish-ltr 26s 4s linear infinite, fish-toggle 0.2s steps(2) infinite; }
.ltr-delay2 { animation: fish-ltr 26s 8s linear infinite, fish-toggle 0.2s steps(2) infinite; }
.ltr-fast { animation: fish-ltr 17s linear infinite, fish-toggle 0.2s steps(2) infinite; }
.rtl { animation: fish-rtl 26s linear infinite, fish-toggle 0.2s steps(2) infinite; }
.rtl-delay1 { animation: fish-rtl 26s 4s linear infinite, fish-toggle 0.2s steps(2) infinite; }
.rtl-delay2 { animation: fish-rtl 26s 7s linear infinite, fish-toggle 0.2s steps(2) infinite; }
.rtl-fast { animation: fish-rtl 17s linear infinite, fish-toggle 0.2s steps(2) infinite; }
.row1{top:0%;} .row2{top:9%;} .row3{top:18%;} .row4{top:27%;} .row5{top:36%;}
.row6{top:45%;} .row7{top:54%;} .row8{top:63%;} .row9{top:72%;}
@keyframes fish-ltr { 0%{left:-30%;} 50%{left:110%;} 51%{transform:rotateY(0);} 52%{transform:rotateY(180deg);} 100%{transform:rotateY(180deg);left:-30%;} }
@keyframes fish-rtl { 0%{transform:rotateY(180deg);left:110%;} 50%{left:-30%;} 51%{transform:rotateY(180deg);} 52%{transform:rotateY(0);} 100%{left:110%;} }
@keyframes fish-rise { from{transform:translate(0,0);} to{transform:translate(0,-1800px);} }
@keyframes fish-reappear { from{left:20%;} to{left:80%;} }
@keyframes fish-bubble-alt { from{background-position:0;} to{background-position:-100px;} }
@keyframes fish-toggle { from{background-position:0;} to{background-position:-290px;} }
`;

class FishInstance implements SaverInstance {
  private readonly root: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;

  constructor(ctx: SaverContext) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    ctx.host.appendChild(style);
    this.styleEl = style;

    const root = document.createElement('div');
    root.className = 'fish-root';
    root.setAttribute('aria-hidden', 'true');
    const bubbles = document.createElement('b');
    bubbles.className = 'bubbles';
    root.appendChild(bubbles);
    for (const p of PIECES) {
      const el = document.createElement('div');
      el.className = p;
      root.appendChild(el);
    }
    ctx.host.appendChild(root);
    this.root = root;

    this.setPaused(ctx.reducedMotion);
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('ss-paused', paused);
  }

  resize(_w: number, _h: number): void {
    // CSS-driven; percentage rows + viewport-relative routes adapt to the host.
  }

  dispose(): void {
    this.root.remove();
    this.styleEl.remove();
  }
}

/** The Fish Aquarium saver plugin. */
export const fish: SaverPlugin = {
  manifest: fishManifest,
  mount: (ctx: SaverContext) => new FishInstance(ctx),
};
