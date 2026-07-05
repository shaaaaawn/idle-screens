import type { Rng } from './rng';

/** How a parameter interpolates between control-track deltas. */
export type Ease = 'step' | 'linear' | 'smooth';

export type ParamType = 'number' | 'color' | 'bool' | 'enum';
export type ParamValue = number | string | boolean;

/** One typed, ranged, interpolatable knob: an agent's steering surface. */
export interface ParamDef {
  type: ParamType;
  default: ParamValue;
  min?: number;
  max?: number;
  options?: string[];
  /** Default interpolation when a delta targets this knob. */
  ease?: Ease;
}

export type ParamSpace = Record<string, ParamDef>;

/** A sparse, timestamped, interpolatable parameter change. Agents stream THESE
 *  (over AG-UI state-patches / MCP resource updates), never frames. */
export interface ParamDelta {
  /** ms from track start. */
  t: number;
  /** key in the saver's paramSpace. */
  path: string;
  value: ParamValue;
  ease?: Ease;
  /** ramp duration ms from the previous value (0 = instant). */
  dur?: number;
}

/** A recorded or live steering performance for a seeded program. */
export interface ControlTrack {
  program: string;
  seed: number;
  duration?: number;
  loop?: boolean;
  deltas: ParamDelta[];
}

/** Page-context seam: passthrough savers read/eat the live page through this,
 *  rather than querying `document` directly. */
export interface PageContext {
  /** Sample dominant colors of the page (for palette-reactive savers). */
  palette(): string[];
  /** Visible page blocks a passthrough saver may transform ("victims"). */
  victims(selector: string): HTMLElement[];
}

/** What the host hands a saver when it mounts. */
export interface SaverContext {
  /** A full-viewport container the saver renders into. Canvas savers create a
   *  canvas inside it; DOM savers (toasters, DVD, messages) append elements. The
   *  host is cleared by the runtime on dispose. */
  host: HTMLElement;
  width: number;
  height: number;
  /** Seeded PRNG. Use this, never Math.random(), for determinism. */
  rng: Rng;
  seed: number;
  reducedMotion: boolean;
  /** Present for passthrough savers (over the live page). */
  page?: PageContext;
}

/** A mounted, running saver visual. */
export interface SaverInstance {
  /** Freeze/unfreeze the render loop (paused, reduced-motion, or screensaver end). */
  setPaused(paused: boolean): void;
  resize(width: number, height: number): void;
  /** Deterministic, frame-addressable render: draw the state at logical time `t`
   *  (ms) for `seed`. Pure w.r.t. (program, seed, applied track, t). Optional. */
  renderFrame?(t: number, seed: number): void;
  /** Steer parameters over time. Optional. */
  applyTrack?(track: ControlTrack): void;
  /** Tear down; MUST restore any live-page mutations. */
  dispose(): void;
}

/** Self-describing metadata, readable WITHOUT executing the saver. */
export interface SaverManifest {
  id: string;
  label: string;
  passthrough?: boolean;
  minBackend?: 'css' | 'canvas2d' | 'webgl2' | 'webgpu';
  costTier?: 'idle' | 'low' | 'medium' | 'high';
  motionIntensity?: 'calm' | 'moderate' | 'energetic';
  reducedMotionFallback?: 'static' | 'slow' | 'hide';
  palette?: string[];
  paramSpace?: ParamSpace;
  a11y?: { flashSafe?: boolean; notes?: string };
  provenance?: { prompt?: string; seed?: number; model?: string };
  thumbnail?: string;
}

/** A registered saver: manifest + a (possibly lazy/async) mount factory. */
export interface SaverPlugin {
  manifest: SaverManifest;
  mount(ctx: SaverContext): SaverInstance | Promise<SaverInstance>;
}

/** Engine configuration. */
export interface IdleScreensConfig {
  /** Idle time before sleeping, in ms. */
  timeoutMs: number;
  /** Also sleep when the window loses focus. */
  sleepOnBlur: boolean;
  /** Do not run on localhost (debug hooks bypass this). */
  disableOnLocalhost: boolean;
  /** Which registered saver to show. */
  defaultPluginId: string;
  /** How to pick across sleeps. */
  selection: 'fixed' | 'random' | 'rotate';
  /** Show the clock chrome (non-passthrough savers only). */
  showClock: boolean;
  /** Exact document title while asleep. */
  sleepTitle?: string;
  /** Master seed for plugin selection + the default saver seed. */
  seed: number;
  /** Return true for a URL where the saver must never sleep. */
  suppress?: (url: string) => boolean;
  /** Pluggable persistence (defaults to localStorage when available). */
  storage?: { get(key: string): string | null; set(key: string, value: string): void };
  /** Built-in, keyboard-opened config menu (saver picker). `true`/omitted =
   *  enabled with ⌘K / Ctrl+K; `false` = no hotkey and no built-in menu (the
   *  `configMenuOpen` signal + open/close API still work, so a host may render
   *  its own). Pass an object to reconfigure. */
  configMenu?: boolean | ConfigMenuConfig;
}

/** Options for the built-in, keyboard-opened config menu. */
export interface ConfigMenuConfig {
  /** Master switch. Default true. */
  enabled?: boolean;
  /** Decides whether a keydown opens/toggles the menu. Default: ⌘K / Ctrl+K. */
  hotkey?: (e: KeyboardEvent) => boolean;
  /** Show the saver picker control. Default true. */
  showPicker?: boolean;
  /** Preview the picked saver immediately (sleep to show it). Default true. */
  previewOnPick?: boolean;
  /** Heading text. Default 'Screen Saver'. */
  title?: string;
}

/** Default menu hotkey: ⌘K (mac) / Ctrl+K, no other modifiers. */
export const DEFAULT_MENU_HOTKEY = (e: KeyboardEvent): boolean =>
  (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k';

/** Normalize `configMenu` to a filled config, or null when disabled. */
export function resolveConfigMenu(
  c: boolean | ConfigMenuConfig | undefined,
): Required<ConfigMenuConfig> | null {
  if (c === false) return null;
  const o: ConfigMenuConfig = c === true || c === undefined ? {} : c;
  if (o.enabled === false) return null;
  return {
    enabled: true,
    hotkey: o.hotkey ?? DEFAULT_MENU_HOTKEY,
    showPicker: o.showPicker ?? true,
    previewOnPick: o.previewOnPick ?? true,
    title: o.title ?? 'Screen Saver',
  };
}

export const DEFAULT_CONFIG: IdleScreensConfig = {
  timeoutMs: 60_000,
  sleepOnBlur: true,
  disableOnLocalhost: false,
  defaultPluginId: '',
  selection: 'fixed',
  showClock: true,
  seed: 1,
  configMenu: true,
};
