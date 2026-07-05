import { effect } from './reactive';
import { IdleScreensEngine } from './engine';
import { createRng } from './rng';
import type { IdleScreensConfig, PageContext, SaverInstance, SaverPlugin } from './types';

const STYLE = `
  :host { all: initial; }
  dialog.frame {
    position: fixed; inset: 0; width: 100%; height: 100%;
    max-width: none; max-height: none; margin: 0; border: 0; padding: 0;
    background: #0a0a0f; overflow: hidden; cursor: none; color: #fff;
  }
  dialog.frame[open] { animation: ss-in 0.5s ease; }
  dialog.frame.leaving { animation: ss-out 0.32s ease forwards; }
  dialog.frame.reduced { animation: none; }
  dialog.frame::backdrop { background: #0a0a0f; }
  dialog.frame.passthrough, dialog.frame.passthrough::backdrop { background: transparent; }
  @keyframes ss-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes ss-out { from { opacity: 1; } to { opacity: 0; } }
  .surface { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
  .surface > canvas { display: block; width: 100%; height: 100%; }
  .clock {
    position: absolute; top: 10px; right: 12px; text-align: right;
    font-family: 'Orbitron', system-ui, sans-serif; pointer-events: none;
  }
  .clock .day { font-size: 34px; opacity: 0.9; }
  .clock .time { font-size: 54px; }
  .hint {
    position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%);
    color: rgba(230,230,230,0.6); font: 12px ui-monospace, monospace;
    letter-spacing: 0.25em; text-transform: uppercase; opacity: 0;
    transition: opacity 1s ease; pointer-events: none;
  }
  .hint.show { opacity: 1; }

  /* Built-in config menu: a normal (interactive) centered dialog, distinct from
     the cursor-hidden saver frame. */
  dialog.menu {
    position: fixed; inset: 0; margin: auto; border: 0; padding: 0;
    width: min(420px, calc(100vw - 32px)); max-width: none;
    background: transparent; color: #f2f2f5;
  }
  dialog.menu::backdrop { background: rgba(6,6,10,0.5); backdrop-filter: blur(2px); }
  .menu-card {
    background: #14141b; border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px; padding: 20px; box-shadow: 0 24px 60px rgba(0,0,0,0.5);
    font-family: system-ui, sans-serif;
  }
  .menu-title { font-size: 18px; font-weight: 600; margin: 0 0 14px; }
  .menu-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
  .menu-row > span { font-size: 14px; opacity: 0.85; }
  .menu-select {
    flex: 1; max-width: 60%; padding: 7px 10px; border-radius: 8px;
    background: #0d0d12; color: #f2f2f5; border: 1px solid rgba(255,255,255,0.16);
    font-size: 14px;
  }
  .menu-actions { display: flex; justify-content: flex-end; }
  .menu-close {
    padding: 7px 16px; border-radius: 8px; cursor: pointer; font-size: 14px;
    background: #2a2a37; color: #f2f2f5; border: 1px solid rgba(255,255,255,0.14);
  }
  .menu-close:hover { background: #34344a; }
`;

/** Node-safe base: during SSR/prerender there is no `HTMLElement`, and importing
 *  this module (for the engine/types) must not crash. The element is only ever
 *  constructed/registered in the browser. */
const HostBase: typeof HTMLElement =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

/**
 * `<idle-screen>` — the framework-agnostic overlay (port of the Angular
 * ScreensaverComponent). Owns the top-layer `<dialog>`, mounts the active saver
 * into a canvas, shows the clock + "press any key" hint, fades in/out, wakes on
 * input with a 450ms arm-guard, and goes transparent for passthrough savers.
 *
 * Configure by setting the `.config` and `.plugins` properties (Angular can do
 * this via `[config]` / `[plugins]` with CUSTOM_ELEMENTS_SCHEMA).
 */
export class IdleScreenElement extends HostBase {
  private _engine: IdleScreensEngine | null = null;
  private ownsEngine = false;
  private _externalEngine: IdleScreensEngine | null = null;
  private _config: Partial<IdleScreensConfig> | null = null;
  private _plugins: SaverPlugin[] | null = null;

  private dialog!: HTMLDialogElement;
  private surface!: HTMLDivElement;
  private clockEl!: HTMLDivElement;
  private hintEl!: HTMLDivElement;
  private menuDialog: HTMLDialogElement | null = null;
  private menuSelect: HTMLSelectElement | null = null;
  private menuBuilt = false;

  private instance: SaverInstance | null = null;
  private mountToken = 0;
  private armed = false;
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposers: Array<() => void> = [];

  set config(c: Partial<IdleScreensConfig>) {
    this._config = c;
    this.maybeStart();
  }
  set plugins(p: SaverPlugin[]) {
    this._plugins = p;
    this.maybeStart();
  }
  /** Use an externally-owned, already-initialized engine (e.g. an Angular service
   *  that also drives a config menu) instead of creating one from config+plugins. */
  set engine(e: IdleScreensEngine) {
    this._externalEngine = e;
    this.maybeStart();
  }
  /** The live engine (for host code / tests). */
  get idleEngine(): IdleScreensEngine | null {
    return this._engine;
  }

  connectedCallback(): void {
    if (!this.shadowRoot) this.buildDom();
    this.maybeStart();
  }

  disconnectedCallback(): void {
    this.teardown();
  }

  private buildDom(): void {
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'frame';
    this.surface = document.createElement('div');
    this.surface.className = 'surface';
    this.clockEl = document.createElement('div');
    this.clockEl.className = 'clock';
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'hint';
    this.hintEl.textContent = 'press any key';
    this.dialog.append(this.surface, this.clockEl, this.hintEl);
    root.append(style, this.dialog);

    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const) {
      this.dialog.addEventListener(ev, () => this.onWakeInput(), { passive: true });
    }
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this._engine?.wake();
    });
  }

  private maybeStart(): void {
    if (this._engine || !this.shadowRoot || typeof window === 'undefined') return;
    if (this._externalEngine) {
      this._engine = this._externalEngine; // caller owns lifecycle + init()
      this.ownsEngine = false;
    } else if (this._config && this._plugins) {
      this._engine = new IdleScreensEngine(this._config, this._plugins);
      this._engine.init();
      this.ownsEngine = true;
    } else {
      return;
    }
    const eng = this._engine;

    this.disposers.push(
      effect(() => {
        // Read reactive deps up front.
        const sleeping = eng.isSleeping.value;
        const active = eng.activePlugin.value;
        const passthrough = eng.activeIsPassthrough.value;
        if (sleeping && active) this.open(active, passthrough);
        else this.close();
      }),
    );

    // Clock chrome.
    this.disposers.push(
      effect(() => {
        const show = this._engine!.config.showClock && !eng.activeIsPassthrough.value;
        const now = eng.now.value;
        this.clockEl.style.display = show && eng.isSleeping.value ? 'block' : 'none';
        if (show) {
          const day = now.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          });
          const time = now.toLocaleTimeString();
          this.clockEl.innerHTML = `<div class="day">${day}</div><div class="time">${time}</div>`;
        }
      }),
    );

    // Optional built-in config menu (saver picker), opened via engine hotkey/API.
    if (eng.configMenu) {
      this.buildMenu(eng.configMenu);
      this.disposers.push(
        effect(() => {
          const open = eng.configMenuOpen.value;
          const d = this.menuDialog;
          if (!d) return;
          if (open && !d.open) {
            this.syncMenuSelection();
            d.showModal();
          } else if (!open && d.open) {
            d.close();
          }
        }),
      );
      // Keep the picker in sync if the active saver changes elsewhere.
      this.disposers.push(
        effect(() => {
          const id = eng.activePlugin.value?.manifest.id ?? '';
          if (this.menuSelect && this.menuSelect.value !== id) this.menuSelect.value = id;
        }),
      );
    }
  }

  private buildMenu(cfg: NonNullable<IdleScreensEngine['configMenu']>): void {
    if (this.menuBuilt || !this.shadowRoot) return;
    const eng = this._engine!;
    const d = document.createElement('dialog');
    d.className = 'menu';
    const card = document.createElement('div');
    card.className = 'menu-card';

    const title = document.createElement('div');
    title.className = 'menu-title';
    title.textContent = cfg.title;
    card.append(title);

    if (cfg.showPicker) {
      const row = document.createElement('label');
      row.className = 'menu-row';
      const label = document.createElement('span');
      label.textContent = 'Saver';
      const select = document.createElement('select');
      select.className = 'menu-select';
      for (const p of eng.pluginList) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.label;
        select.append(opt);
      }
      select.addEventListener('change', () => {
        eng.setPlugin(select.value);
        if (cfg.previewOnPick) {
          // Close the menu first so the saver isn't stacked behind this modal,
          // then show the chosen saver right away.
          eng.closeConfigMenu();
          eng.forceSleep();
        }
      });
      row.append(label, select);
      card.append(row);
      this.menuSelect = select;
    }

    const actions = document.createElement('div');
    actions.className = 'menu-actions';
    const close = document.createElement('button');
    close.className = 'menu-close';
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => eng.closeConfigMenu());
    actions.append(close);
    card.append(actions);

    d.append(card);
    // Escape and backdrop click both close (without waking the saver).
    d.addEventListener('cancel', (e) => {
      e.preventDefault();
      eng.closeConfigMenu();
    });
    d.addEventListener('click', (e) => {
      if (e.target === d) eng.closeConfigMenu();
    });
    this.shadowRoot.append(d);
    this.menuDialog = d;
    this.menuBuilt = true;
  }

  private syncMenuSelection(): void {
    if (this.menuSelect) {
      this.menuSelect.value = this._engine?.activePlugin.value?.manifest.id ?? '';
    }
  }

  private pageContext(): PageContext {
    return {
      palette: () => [],
      victims: (selector: string) =>
        typeof document !== 'undefined'
          ? Array.from(document.querySelectorAll<HTMLElement>(selector))
          : [],
    };
  }

  private async open(plugin: SaverPlugin, passthrough: boolean): Promise<void> {
    const eng = this._engine!;
    this.dialog.classList.toggle('passthrough', passthrough);
    this.dialog.classList.toggle('reduced', eng.reducedMotion.value);
    if (!this.dialog.open) {
      this.dialog.classList.remove('leaving');
      this.dialog.showModal();
      this.arm();
      this.scheduleHint();
    }
    // (Re)mount the active saver.
    const token = ++this.mountToken;
    await this.disposeInstance();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const seed = eng.config.seed >>> 0;
    const inst = await plugin.mount({
      host: this.surface,
      width: w,
      height: h,
      rng: createRng(seed),
      seed,
      reducedMotion: eng.reducedMotion.value,
      page: plugin.manifest.passthrough ? this.pageContext() : undefined,
    });
    if (token !== this.mountToken) {
      inst.dispose(); // superseded while awaiting
      return;
    }
    this.instance = inst;
    inst.setPaused(eng.reducedMotion.value);
  }

  private close(): void {
    if (!this.dialog?.open) return;
    this.hintEl.classList.remove('show');
    if (this.hintTimer) clearTimeout(this.hintTimer);
    void this.disposeInstance();
    const reduced = this._engine?.reducedMotion.value;
    if (reduced) {
      this.dialog.close();
      return;
    }
    this.dialog.classList.add('leaving');
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      if (this.dialog.open) this.dialog.close();
      this.dialog.classList.remove('leaving');
    }, 320);
  }

  private async disposeInstance(): Promise<void> {
    if (this.instance) {
      this.instance.dispose();
      this.instance = null;
    }
    this.surface?.replaceChildren(); // clear any saver DOM / canvas
  }

  private arm(): void {
    this.armed = false;
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = setTimeout(() => {
      this.armed = true;
    }, 450);
  }

  private scheduleHint(): void {
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintEl.classList.remove('show');
    this.hintTimer = setTimeout(() => this.hintEl.classList.add('show'), 3000);
  }

  private onWakeInput(): void {
    if (!this.armed) return; // grace period after sleeping
    this._engine?.wake();
  }

  private teardown(): void {
    void this.disposeInstance();
    if (this.armTimer) clearTimeout(this.armTimer);
    if (this.hintTimer) clearTimeout(this.hintTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    for (const d of this.disposers) d();
    this.disposers = [];
    if (this.ownsEngine) this._engine?.destroy(); // external engines are the caller's to destroy
    this._engine = null;
  }
}

/** Register the <idle-screen> custom element (idempotent). */
export function defineIdleScreen(tag = 'idle-screen'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, IdleScreenElement);
  }
}
