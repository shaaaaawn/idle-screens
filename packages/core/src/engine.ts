import { computed, effect, signal, untracked, type ReadonlySignal } from './reactive';
import { IdleDetector } from './idle-detector';
import { createRng, type Rng } from './rng';
import {
  DEFAULT_CONFIG,
  resolveConfigMenu,
  type ConfigMenuConfig,
  type IdleScreensConfig,
  type SaverPlugin,
} from './types';

export type EngineState = 'awake' | 'sleeping';

const hasWindow = typeof window !== 'undefined';
const hasDoc = typeof document !== 'undefined';

function defaultStorage(): IdleScreensConfig['storage'] {
  return {
    get: (k) => {
      try {
        return hasWindow ? window.localStorage.getItem(k) : null;
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        if (hasWindow) window.localStorage.setItem(k, v);
      } catch {
        /* private mode / disabled storage */
      }
    },
  };
}

/**
 * The framework-agnostic idle-screens state machine (port of the Angular
 * ScreensaverService). Owns: awake/sleeping state, plugin selection, the sleep
 * clock, reduced-motion + visibility, idle/blur triggers, and the
 * `window.__idleScreens` debug hook. It does NOT render; the `<idle-screen>`
 * element observes its signals.
 */
export class IdleScreensEngine {
  readonly config: IdleScreensConfig;
  private readonly plugins: SaverPlugin[];
  private readonly storage: NonNullable<IdleScreensConfig['storage']>;
  private readonly idle: IdleDetector;
  private readonly selectionRng: Rng;

  private readonly _state = signal<EngineState>('awake');
  readonly state: ReadonlySignal<EngineState> = this._state;
  readonly isSleeping = computed(() => this._state.value === 'sleeping');

  private readonly _activeId = signal('');
  readonly activePlugin = computed(
    () =>
      this.plugins.find((p) => p.manifest.id === this._activeId.value) ??
      this.plugins[0] ??
      null,
  );
  readonly activeIsPassthrough = computed(
    () => this.activePlugin.value?.manifest.passthrough ?? false,
  );

  private readonly _now = signal(new Date(0));
  readonly now: ReadonlySignal<Date> = this._now;
  private readonly _hidden = signal(false);
  readonly hidden: ReadonlySignal<boolean> = this._hidden;
  private readonly _reducedMotion = signal(false);
  readonly reducedMotion: ReadonlySignal<boolean> = this._reducedMotion;

  /** Resolved built-in config-menu options, or null when disabled. */
  readonly configMenu: Required<ConfigMenuConfig> | null;
  private readonly _configMenuOpen = signal(false);
  /** Whether the config menu is open. Drives the built-in `<idle-screen>` menu;
   *  a host may also observe this to render its own. */
  readonly configMenuOpen: ReadonlySignal<boolean> = this._configMenuOpen;

  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private disposers: Array<() => void> = [];

  constructor(config: Partial<IdleScreensConfig>, plugins: SaverPlugin[]) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.plugins = plugins;
    this.configMenu = resolveConfigMenu(this.config.configMenu);
    this.storage = this.config.storage ?? defaultStorage()!;
    this.idle = new IdleDetector(this.config.timeoutMs);
    this.selectionRng = createRng(this.config.seed >>> 0);

    const stored = this.storage.get('idleScreens.plugin');
    const initialId =
      (stored && plugins.some((p) => p.manifest.id === stored) && stored) ||
      this.config.defaultPluginId ||
      plugins[0]?.manifest.id ||
      '';
    this._activeId.value = initialId;
  }

  get pluginList(): Array<{ id: string; label: string }> {
    return this.plugins.map((p) => ({ id: p.manifest.id, label: p.manifest.label }));
  }

  /** Begin idle detection + listeners + debug hook. */
  init(): void {
    if (this.started || !hasWindow) return;
    this.started = true;

    if (hasDoc) {
      this._hidden.value = document.hidden;
      const onVis = (): void => {
        this._hidden.value = document.hidden;
      };
      document.addEventListener('visibilitychange', onVis);
      this.disposers.push(() => document.removeEventListener('visibilitychange', onVis));
    }

    const mq = hasWindow ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (mq) {
      this._reducedMotion.value = mq.matches;
      const onMq = (): void => {
        this._reducedMotion.value = mq.matches;
      };
      mq.addEventListener('change', onMq);
      this.disposers.push(() => mq.removeEventListener('change', onMq));
    }

    // Sleep when idle fires (unless suppressed). `sleep()` reads `state` in its
    // guard; wrap it in `untracked` so this effect depends ONLY on the idle
    // signal — otherwise flipping `state` to awake in wake() (while idle is still
    // latched true) would re-trigger this effect and immediately re-sleep.
    this.idle.start();
    this.disposers.push(
      effect(() => {
        if (this.idle.idle.value) untracked(() => this.sleep());
      }),
    );

    if (this.config.sleepOnBlur) {
      const onBlur = (): void => this.sleep();
      window.addEventListener('blur', onBlur);
      this.disposers.push(() => window.removeEventListener('blur', onBlur));
    }

    // Optional built-in config-menu hotkey (⌘K / Ctrl+K by default).
    if (this.configMenu) {
      const hotkey = this.configMenu.hotkey;
      const onKey = (e: KeyboardEvent): void => {
        if (hotkey(e)) {
          e.preventDefault();
          this.toggleConfigMenu();
        }
      };
      window.addEventListener('keydown', onKey);
      this.disposers.push(() => window.removeEventListener('keydown', onKey));
    }

    // Drive the clock only while asleep + visible.
    this.disposers.push(
      effect(() => {
        const ticking = this._state.value === 'sleeping' && !this._hidden.value;
        if (ticking && this.clockTimer === null) {
          this._now.value = new Date();
          this.clockTimer = setInterval(() => {
            this._now.value = new Date();
          }, 1000);
        } else if (!ticking && this.clockTimer !== null) {
          clearInterval(this.clockTimer);
          this.clockTimer = null;
        }
      }),
    );

    this.installDebugHook();
  }

  destroy(): void {
    this.idle.stop();
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    for (const d of this.disposers) d();
    this.disposers = [];
    this.started = false;
  }

  private suppressed(): boolean {
    if (this.config.disableOnLocalhost && hasWindow && /^(localhost|127\.|\[::1\])/.test(location.hostname)) {
      return true;
    }
    const url = hasWindow ? location.pathname + location.search : '';
    return this.config.suppress ? this.config.suppress(url) : false;
  }

  sleep(): void {
    if (this._state.value === 'sleeping' || this.suppressed()) return;
    this.pickPlugin();
    this._state.value = 'sleeping';
  }

  /** Sleep ignoring suppression rules (debug / manual). */
  forceSleep(): void {
    if (this._state.value === 'sleeping') return;
    this.pickPlugin();
    this._state.value = 'sleeping';
  }

  wake(): void {
    if (this._state.value === 'awake') return;
    this._state.value = 'awake';
    this.idle.markActive();
  }

  toggle(): void {
    if (this.isSleeping.value) this.wake();
    else this.forceSleep();
  }

  openConfigMenu(): void {
    this._configMenuOpen.value = true;
  }
  closeConfigMenu(): void {
    this._configMenuOpen.value = false;
  }
  toggleConfigMenu(): void {
    this._configMenuOpen.value = !this._configMenuOpen.value;
  }

  setPlugin(id: string): void {
    if (!this.plugins.some((p) => p.manifest.id === id)) return;
    this._activeId.value = id;
    this.storage.set('idleScreens.plugin', id);
  }

  private pickPlugin(): void {
    if (this.plugins.length === 0) return;
    switch (this.config.selection) {
      case 'random': {
        const i = this.selectionRng.int(0, this.plugins.length - 1);
        this._activeId.value = this.plugins[i]!.manifest.id;
        break;
      }
      case 'rotate': {
        const cur = this.plugins.findIndex((p) => p.manifest.id === this._activeId.value);
        const next = this.plugins[(cur + 1) % this.plugins.length]!;
        this._activeId.value = next.manifest.id;
        break;
      }
      case 'fixed':
      default:
        // Keep the current (persisted / menu-chosen) plugin. `defaultPluginId`
        // is only the INITIAL pick (see constructor); once the user chooses a
        // saver via setPlugin/the menu it sticks across sleeps.
        break;
    }
  }

  private installDebugHook(): void {
    if (!hasWindow) return;
    (window as unknown as { __idleScreens?: unknown }).__idleScreens = {
      sleep: () => this.forceSleep(),
      wake: () => this.wake(),
      toggle: () => this.toggle(),
      setPlugin: (id: string) => this.setPlugin(id),
      openMenu: () => this.openConfigMenu(),
      closeMenu: () => this.closeConfigMenu(),
      toggleMenu: () => this.toggleConfigMenu(),
      state: () => this._state.value,
      menuOpen: () => this._configMenuOpen.value,
      active: () => this.activePlugin.value?.manifest.id ?? null,
      plugins: this.pluginList,
    };
  }
}
