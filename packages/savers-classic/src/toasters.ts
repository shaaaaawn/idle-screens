import type { SaverContext, SaverInstance, SaverManifest, SaverPlugin } from '@idle-screens/core';

/**
 * Flying Toasters — the classic After Dark saver (MIT, bryanbraun/after-dark-css),
 * reverted to the ORIGINAL sprite implementation from shawn-site's screensaver: the
 * authentic Berkeley Systems toaster/toast GIF sprites, a 4-frame wing-flap driven by
 * `background-position` steps(4), and the reverse-L start positions that fly diagonally
 * off the top/right edges. The sprites are embedded as data URIs so the saver stays
 * self-contained (no external URLs).
 *
 * Attribution: HTML/CSS © MIT (Bryan Braun); toaster/toast sprites © Berkeley Systems.
 */
export const toastersManifest: SaverManifest = {
  id: 'toasters',
  label: 'Flying Toasters',
  passthrough: false,
  minBackend: 'css',
  costTier: 'low',
  motionIntensity: 'moderate',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true },
};

const TOASTER_SPRITE = 'data:image/gif;base64,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';
const TOAST_SPRITE = 'data:image/gif;base64,R0lGODlhQABAAKIGAP/MZsyZM5lmAGYzAMxmAP//mTMzMwAAACH5BAEAAAYALAAAAABAAEAAAAP/aLrc/jDKSau9OOvNu/9gKI5kaZ5oqq5s675wLM/0Atx1de97/hQFXgAw7PkMu6GSeCviZknmctk0voJVZWC7lfKsKSCWqBVwzVym92kCfsncLTpdpIJB4qQ2bu4H5nRTdxtuX3tnf38CfnFdVE4dY2RSe4t+l2iAdoMWklN8mH2iiY5eTmydQqZyioqWr4mapW8YWHVwpK+6urmOs18XnpSIoruLsY1rbwAWA7aryMXGx42Cp6gSBM6qjdJyltHWk8sFFQPaz5+xsMfg1ePLN+UU2uhjh6zhyMrxOwUCFQjUO3dvUjVWstL0IwJkAEB6As8RVLOnCSlEv24xCVJguYDDhxPORdQ2kWIWPoHUkOvo0SPIkPUGSjI1zJeTUxxbflyEQSJJAoWiwBnGT15DnQI+ZhDpc1sXbjTfHNW58+UFpjJVQb0GYCpSSx4EDiQZdKFRllRfhcCKtaxJeVQduuQ5QmTEpkGdTE36cScKu2OdSTqatHDVFR7FNgUqxrDcwnRdAL77ky/kyDBaih2ZlMAivz7s+jSMObRikkqPNEg8cIDqCDpfy55Nu7bt27hz697Nu7fvBwkAADs=';

/** Piece = "kind speed position". Tunable density lives here. */
const PIECES: string[] = [
  'toaster t1 p6', 'toaster t3 p7', 'toast tst1 p8', 'toaster t3 p9',
  'toaster t1 p11', 'toaster t3 p12', 'toaster t2 p13', 'toast tst3 p14',
  'toast tst2 p16', 'toaster t1 p17', 'toast tst2 p19', 'toast tst3 p20',
  'toaster t2 p21', 'toast tst1 p24', 'toaster t1 p22', 'toast tst2 p26',
  'toaster t1 p28', 'toast tst2 p30', 'toaster t2 p31', 'toaster t1 p32',
  'toast tst3 p33',
];

const STYLE = `
.ts-root { position:absolute; inset:0; display:block; overflow:hidden; }
.ts-root.ts-paused * { animation-play-state: paused !important; }
.toaster, .toast { position:absolute; width:64px; height:64px; }
.toaster { background-image: url('${TOASTER_SPRITE}'); }
.toast { background-image: url('${TOAST_SPRITE}'); }
/* speed classes: flap (wing sprite) + fly (diagonal drift) */
.t1 { animation: t-flap 0.2s steps(4) infinite alternate, t-fly 10s linear infinite; }
.t2 { animation: t-flap 0.2s steps(4) infinite alternate-reverse, t-fly 16s linear infinite; }
.t3 { animation: t-flap 0.2s steps(4) infinite alternate, t-fly 24s linear infinite; }
.t4 { animation: t-flap 0.2s steps(4) infinite alternate, t-fly 10s 5s linear infinite; }
.tst1 { animation: t-fly 10s linear infinite; }
.tst2 { animation: t-fly 16s linear infinite; }
.tst3 { animation: t-fly 24s linear infinite; }
/* start positions (reverse-L batches, off the top/right edges) */
.p6 { right:-2%; top:-17%; } .p7 { right:10%; top:-19%; } .p8 { right:20%; top:-18%; }
.p9 { right:30%; top:-20%; } .p11 { right:50%; top:-18%; } .p12 { right:60%; top:-20%; }
.p13 { right:-17%; top:10%; } .p14 { right:-19%; top:20%; } .p16 { right:-23%; top:50%; }
.p17 { right:-25%; top:70%; } .p19 { right:10%; top:-20%; } .p20 { right:20%; top:-36%; }
.p21 { right:30%; top:-24%; } .p22 { right:40%; top:-33%; } .p24 { right:-26%; top:10%; }
.p26 { right:-29%; top:50%; } .p28 { right:10%; top:-56%; } .p30 { right:30%; top:-60%; }
.p31 { right:-46%; top:10%; } .p32 { right:-56%; top:20%; } .p33 { right:-49%; top:30%; }
@keyframes t-flap { from { background-position: 0; } to { background-position: -256px; } }
@keyframes t-fly { from { transform: translate(0, 0); } to { transform: translate(-1600px, 1600px); } }
`;

class ToastersInstance implements SaverInstance {
  private readonly root: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;

  constructor(ctx: SaverContext) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    ctx.host.appendChild(style);
    this.styleEl = style;

    const root = document.createElement('div');
    root.className = 'ts-root';
    root.setAttribute('aria-hidden', 'true');
    for (const p of PIECES) {
      const piece = document.createElement('div');
      piece.className = p;
      root.appendChild(piece);
    }
    ctx.host.appendChild(root);
    this.root = root;

    this.setPaused(ctx.reducedMotion);
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('ts-paused', paused);
  }

  resize(_w: number, _h: number): void {
    // CSS-driven; percentage offsets adapt to the host automatically.
  }

  dispose(): void {
    this.root.remove();
    this.styleEl.remove();
  }
}

/** The Flying Toasters saver plugin. */
export const toasters: SaverPlugin = {
  manifest: toastersManifest,
  mount: (ctx: SaverContext) => new ToastersInstance(ctx),
};
