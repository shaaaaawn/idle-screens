import './workbench';
import {
  createRng,
  defineIdleScreen,
  IdleScreensEngine,
  type IdleScreenElement,
  type IdleScreensConfig,
  type SaverContext,
  type SaverInstance,
  type SaverPlugin,
} from '@idle-screens/core';
import { blackHole, demoTrack } from '@idle-screens/saver-black-hole';
import { tide } from '@idle-screens/saver-tide';
import { limelight } from '@idle-screens/saver-limelight';
import { slipstream } from '@idle-screens/saver-slipstream';
import { catwalk } from '@idle-screens/saver-catwalk';
import { CLASSIC_SAVERS } from '@idle-screens/savers-classic';
import { AURORA_SPEC, COMETS_SPEC, compileSaver, CONSTELLATION_SPEC, DASHBOARD_SPEC, LANTERNS_SPEC, MATRIX_RAIN_SPEC, NOSTALGHIA_CANDLE_SPEC, POLYGONS_SPEC, ORRERY_SPEC, PROCESSION_SPEC, SAKURA_SPEC, SNOWFALL_SPEC, WARP_TUNNEL_SPEC } from '@idle-screens/schema';
import type { FlashReport } from '@idle-screens/validator';
import { sampleSaver, sampleStrobe, type ValidateResult } from './validate';
import { buildDevDocs } from './dev-docs';
import { escapeHtml, safeHttpUrl } from './html';
import { wireCapabilitiesHarness, wireSchemaHarness } from './dev-harness';
import { buildBottomDock } from './bottom-dock';
import { buildRightDock } from './right-dock';
import { formatBackendLabel } from './preview-backend';
import { buildEvalsPanel } from './evals/evals-panel';
import { buildSettingsPanel } from './settings-panel';
import { buildGallery, type GalleryGroup } from './gallery';
import { createPreviewOverlay, type PreviewEntry } from './preview-overlay';
import { STAGES, mountStage, mirrorPage, type MountedStage } from './stages';
import { wirePerceptionHarness } from './frame-perception';

const SCHEMA_IDS = new Set(['aquarium', 'rain', 'snowfall', 'lanterns', 'sakura', 'dev-dashboard', 'orrery', 'constellation', 'comets', 'aurora', 'warp-tunnel', 'polygons', 'matrix-rain', 'procession', 'nostalghia-candle']);

interface SaverGroup {
  id: string;
  label: string;
  savers: SaverPlugin[];
}

const SAVER_GROUPS: SaverGroup[] = [
  { id: 'saver-black-hole', label: '@idle-screens/saver-black-hole', savers: [blackHole] },
  { id: 'saver-tide', label: '@idle-screens/saver-tide', savers: [tide] },
  { id: 'saver-limelight', label: '@idle-screens/saver-limelight', savers: [limelight] },
  { id: 'saver-slipstream', label: '@idle-screens/saver-slipstream', savers: [slipstream] },
  { id: 'saver-catwalk', label: '@idle-screens/saver-catwalk', savers: [catwalk] },
  { id: 'savers-classic', label: '@idle-screens/savers-classic', savers: [...CLASSIC_SAVERS] },
  {
    id: 'schema',
    label: '@idle-screens/schema',
    savers: [
      compileSaver(SNOWFALL_SPEC),
      compileSaver(LANTERNS_SPEC),
      compileSaver(SAKURA_SPEC),
      compileSaver(DASHBOARD_SPEC),
      compileSaver(ORRERY_SPEC),
      compileSaver(CONSTELLATION_SPEC),
      compileSaver(COMETS_SPEC),
      compileSaver(AURORA_SPEC),
      compileSaver(WARP_TUNNEL_SPEC),
      compileSaver(POLYGONS_SPEC),
      compileSaver(MATRIX_RAIN_SPEC),
      compileSaver(PROCESSION_SPEC),
      compileSaver(NOSTALGHIA_CANDLE_SPEC),
    ],
  },
];

const ALL_SAVERS = SAVER_GROUPS.flatMap((g) => g.savers);

const GROUP_SHORT_LABEL: Record<string, string> = {
  'saver-black-hole': 'black-hole',
  'saver-tide': 'tide',
  'saver-limelight': 'limelight',
  'saver-slipstream': 'slipstream',
  'saver-catwalk': 'catwalk',
  'savers-classic': 'classic',
  schema: 'schema',
};

const GALLERY_GROUPS: GalleryGroup[] = SAVER_GROUPS.map((g) => ({
  id: g.id,
  label: g.label,
  short: GROUP_SHORT_LABEL[g.id] ?? g.id,
  savers: g.savers,
}));

const PREVIEW_ENTRIES: PreviewEntry[] = SAVER_GROUPS.flatMap((g) =>
  g.savers.map((saver) => ({ saver, pkg: g.label })),
);

function buildSaverPalette(mount: HTMLElement, onSelect: (id: string) => void, activeId?: string): void {
  // Same filter affordance as the gallery's — 33 savers is too many to scan.
  const filter = document.createElement('div');
  filter.className = 'palette-filter';
  const search = document.createElement('input');
  search.type = 'search';
  search.id = 'palette-search';
  search.placeholder = 'Filter…';
  search.setAttribute('aria-label', 'Filter savers by name');
  filter.append(search);

  const tree = document.createElement('div');
  tree.className = 'palette-tree';

  for (const group of SAVER_GROUPS) {
    const details = document.createElement('details');
    details.className = 'palette-group';
    details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'palette-group-head';
    summary.textContent = GROUP_SHORT_LABEL[group.id] ?? group.id;
    summary.title = group.label;

    const items = document.createElement('div');
    items.className = 'palette-group-items';

    for (const s of group.savers) {
      const item = document.createElement('button');
      item.className = 'palette-item';
      item.dataset.id = s.manifest.id;
      if (s.manifest.id === activeId) item.classList.add('active');

      const label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = s.manifest.label;

      if (s.manifest.workerReady) {
        const wb = document.createElement('span');
        wb.className = 'palette-worker';
        wb.textContent = 'W';
        wb.title = 'Worker-ready';
        item.append(wb, label);
      } else {
        item.append(label);
      }

      item.addEventListener('click', () => {
        details.open = true;
        onSelect(s.manifest.id);
      });
      items.append(item);
    }

    details.append(summary, items);
    tree.append(details);
  }

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const details of tree.querySelectorAll<HTMLDetailsElement>('.palette-group')) {
      let shown = 0;
      for (const item of details.querySelectorAll<HTMLElement>('.palette-item')) {
        const hit = q === '' || (item.textContent ?? '').toLowerCase().includes(q) || (item.dataset.id ?? '').includes(q);
        item.hidden = !hit;
        if (hit) shown += 1;
      }
      details.hidden = shown === 0;
      if (q !== '') details.open = true;
    }
  });

  mount.append(filter, tree);
}

/** Derived from the group a saver was registered in, so a new package can't
 *  silently show up attributed to savers-classic. */
const PACKAGE_BY_ID = new Map<string, string>(
  SAVER_GROUPS.flatMap((g) => g.savers.map((s) => [s.manifest.id, g.label] as [string, string])),
);

function packageFor(saver: SaverPlugin): string {
  const id = saver.manifest.id;
  const registered = PACKAGE_BY_ID.get(id);
  if (registered) return registered;
  // Compiled specs mounted outside SAVER_GROUPS (aquarium, rain) still resolve.
  return SCHEMA_IDS.has(id) ? '@idle-screens/schema' : '@idle-screens/savers-classic';
}

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage') as HTMLDivElement;

interface HarnessResult {
  id: string;
  passthrough: boolean;
  mounted: boolean;
  survivedOps: boolean;
  victimMutatedDuring: boolean;
  victimRestored: boolean;
  errors: string[];
}

declare global {
  interface Window {
    __frameReady?: boolean;
    __idleScreens?: {
      sleep: () => void;
      wake: () => void;
      setPlugin: (id: string) => void;
      openMenu: () => void;
      closeMenu: () => void;
      toggleMenu: () => void;
      state: () => string;
      menuOpen: () => boolean;
      active: () => string | null;
      plugins: Array<{ id: string; label: string }>;
    };
    __harness?: { run(id: string): Promise<HarnessResult> };
    __validate?: {
      saver(id: string, opts?: Record<string, number>): Promise<ValidateResult>;
      strobe(hz: number, opts?: Record<string, number>): FlashReport;
    };
  }
}

const twoFrames = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

const SAVER_VARIANTS: Record<string, string> = {
  messages: 'Out to Lunch / Macintosh',
};

if (params.has('frame')) {
  frameMode();
} else if (params.has('harness')) {
  harnessMode();
} else if (params.has('validate')) {
  validateMode();
} else {
  liveMode();
}

// ---------------------------------------------------------------------------
// Validator harness
// ---------------------------------------------------------------------------
function validateMode(): void {
  window.__validate = {
    saver: (id: string, opts?: Record<string, number>) => {
      const saver = ALL_SAVERS.find((s) => s.manifest.id === id)!;
      return sampleSaver(saver, opts ?? {});
    },
    strobe: (hz: number, opts?: Record<string, number>) => sampleStrobe(hz, opts ?? {}),
  };
}

// ---------------------------------------------------------------------------
// Deterministic single-frame render
// ---------------------------------------------------------------------------
function frameMode(): void {
  document.body.classList.add('frame-mode');
  stage.hidden = false;
  const seed = Number(params.get('seed') ?? 42);
  const frame = Number(params.get('frame') ?? 1500);
  const ctx: SaverContext = {
    host: stage,
    dpr: 1,
    width: window.innerWidth,
    height: window.innerHeight,
    rng: createRng(seed),
    seed,
    reducedMotion: true,
  };
  void Promise.resolve(blackHole.mount(ctx)).then((inst: SaverInstance) => {
    if (params.get('track') === 'demo') inst.applyTrack?.(demoTrack);
    inst.renderFrame?.(frame, seed);
    window.__frameReady = true;
  });
}

// ---------------------------------------------------------------------------
// SaverInstance lifecycle harness
// ---------------------------------------------------------------------------
function harnessMode(): void {
  window.__harness = {
    async run(id: string): Promise<HarnessResult> {
      const errors: string[] = [];
      const onErr = (ev: ErrorEvent): void => void errors.push(ev.message);
      window.addEventListener('error', onErr);
      const saver = ALL_SAVERS.find((s) => s.manifest.id === id)!;
      stage.hidden = false;
      stage.replaceChildren();

      const pageCtx = {
        palette: (): string[] => [],
        victims: (sel: string): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(sel)),
      };
      const victim = document.querySelector<HTMLElement>('#topbar .tb-title');
      const before = { transform: victim?.style.transform ?? '', willChange: victim?.style.willChange ?? '' };

      const inst = await Promise.resolve(
        saver.mount({
          host: stage,
          dpr: devicePixelRatio ?? 1,
          width: window.innerWidth,
          height: window.innerHeight,
          rng: createRng(1),
          seed: 1,
          reducedMotion: false,
          page: saver.manifest.passthrough ? pageCtx : undefined,
        }),
      );
      const mounted = stage.childElementCount > 0;
      await twoFrames();
      const victimMutatedDuring = !!victim && victim.style.willChange !== before.willChange;
      inst.resize(800, 600);
      inst.resize(640, 480, 2);
      inst.setPaused(true);
      inst.setPaused(false);
      const survivedOps = stage.childElementCount > 0 && errors.length === 0;
      inst.dispose();
      const victimRestored =
        !victim || (victim.style.willChange === before.willChange && victim.style.transform === before.transform);

      window.removeEventListener('error', onErr);
      stage.replaceChildren();
      stage.hidden = true;
      return { id, passthrough: !!saver.manifest.passthrough, mounted, survivedOps, victimMutatedDuring, victimRestored, errors };
    },
  };
}

// ---------------------------------------------------------------------------
// Live mode — gallery + dev views with hash routing
// ---------------------------------------------------------------------------
interface LiveConfig {
  saver: string;
  selection: 'fixed' | 'random' | 'rotate';
  timeoutMs: number;
  sleepOnBlur: boolean;
  showClock: boolean;
  seed: number;
  configMenu: boolean;
  reducedMotion: boolean;
  external: boolean;
}

function liveMode(): void {
  defineIdleScreen();

  const wanted = params.get('saver');
  const cfg: LiveConfig = {
    saver: wanted && ALL_SAVERS.some((s) => s.manifest.id === wanted) ? wanted : 'black-hole',
    selection: (['fixed', 'random', 'rotate'] as const).includes(params.get('selection') as never)
      ? (params.get('selection') as LiveConfig['selection'])
      : 'fixed',
    timeoutMs: Number(params.get('timeout') ?? 60_000),
    sleepOnBlur: params.get('blur') === '1',
    showClock: params.get('clock') === '1',
    seed: Number(params.get('seed') ?? 42),
    configMenu: params.get('menu') !== 'off',
    reducedMotion: false,
    external: params.get('engine') === 'external',
  };

  const workerUrl = new URL(
    '../../../packages/savers-classic/src/idle-worker.ts',
    import.meta.url,
  ).href;

  // Watching a fullscreen preview counts as "using the app": without this the
  // idle timer fires after `timeoutMs` and the real screensaver opens on top
  // of the thing you were deliberately looking at.
  let previewIsOpen = false;

  const toEngineConfig = (c: LiveConfig): Partial<IdleScreensConfig> => ({
    timeoutMs: c.timeoutMs,
    sleepOnBlur: c.sleepOnBlur,
    suppress: () => previewIsOpen,
    disableOnLocalhost: false,
    defaultPluginId: c.saver,
    selection: c.selection,
    showClock: c.showClock,
    seed: c.seed,
    configMenu: c.configMenu,
    workerUrl,
  });

  const origMatchMedia = window.matchMedia.bind(window);
  const applyReducedMotion = (on: boolean): void => {
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = on
      ? ((q: string) =>
          /reduced-motion/.test(q)
            ? ({ matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true } as unknown as MediaQueryList)
            : origMatchMedia(q)) as typeof window.matchMedia
      : origMatchMedia;
  };

  let el: IdleScreenElement | null = null;
  let ownedExternal: IdleScreensEngine | null = null;

  const rebuild = (c: LiveConfig): void => {
    applyReducedMotion(c.reducedMotion);
    if (ownedExternal) {
      ownedExternal.destroy();
      ownedExternal = null;
    }
    if (el) el.remove();
    el = document.createElement('idle-screen') as IdleScreenElement;
    if (params.get('forcePolyfill') === '1') el.forceRafPolyfill = true;
    document.body.appendChild(el);
    if (c.external) {
      const engine = new IdleScreensEngine(toEngineConfig(c), ALL_SAVERS);
      engine.init();
      el.engine = engine;
      ownedExternal = engine;
    } else {
      el.plugins = ALL_SAVERS;
      el.config = toEngineConfig(c);
    }
    window.__idleScreens?.setPlugin(c.saver);
  };
  rebuild(cfg);

  /*
   * The top-right control does two different jobs, so it says which one it is
   * doing. In Dev Tools it is a transport for the SELECTED saver's inline
   * preview (paired with the saver's name); everywhere else it triggers the
   * real idle screensaver. Labelling one button "Idle demo" while it played a
   * preview would be the same ambiguity the Gallery preview / Idle demo split
   * was introduced to remove.
   */
  const tbSaver = document.getElementById('tb-saver') as HTMLElement | null;
  const tbBtn = document.getElementById('tb-sleep') as HTMLButtonElement | null;
  /** Set by initDev once the timeline exists; null until then. */
  let devTransport: (() => void) | null = null;

  const setTopbarSaver = (saver: SaverPlugin | null): void => {
    if (!tbSaver) return;
    if (!saver) {
      tbSaver.hidden = true;
      return;
    }
    tbSaver.hidden = false;
    tbSaver.replaceChildren();
    const name = document.createElement('b');
    name.textContent = saver.manifest.label;
    const pkg = document.createElement('span');
    pkg.className = 'tb-saver-pkg';
    pkg.textContent = (packageFor(saver).split('/')[1] ?? '').replace(/^savers?-/, '');
    tbSaver.append(name, pkg);
    tbSaver.title = `${saver.manifest.label} — ${packageFor(saver)}`;
  };

  const setTopbarPlaying = (playing: boolean): void => {
    if (!tbBtn) return;
    tbBtn.dataset.playing = String(playing);
    tbBtn.textContent = playing ? '⏸ Pause' : '▶ Play';
    tbBtn.title = playing
      ? 'Pause the selected saver’s inline preview'
      : 'Play the selected saver’s inline preview';
  };

  /**
   * Which view can actually play the selected saver.
   *
   * The saver's NAME is meaningful everywhere — it is what the engine would
   * show and what "Idle demo" would run. A transport only means something
   * where that saver is on screen: the workbench viewport, or its gallery
   * card. Docs and Settings have no such preview, and the Evals grid shows
   * eval screens rather than catalogue savers, so there the button keeps its
   * original job rather than pretending to drive something.
   */
  const hasTransport = (view: View): boolean => view === 'dev' || view === 'gallery';

  const currentPlaying = (view: View): boolean =>
    view === 'dev' ? devPlaying : view === 'gallery' ? gallery.isPlaying() : false;

  const syncTopbarMode = (view: View): void => {
    if (!tbBtn) return;
    // The selected saver is shown on every view, not just the workbench.
    setTopbarSaver(ALL_SAVERS.find((s) => s.manifest.id === cfg.saver) ?? null);
    const transport = hasTransport(view);
    tbBtn.classList.toggle('is-transport', transport);
    if (transport) {
      setTopbarPlaying(currentPlaying(view));
    } else {
      delete tbBtn.dataset.playing;
      tbBtn.textContent = 'Idle demo';
      tbBtn.title = 'Sleep the engine — the real screensaver, wakes on any input';
    }
  };

  let devPlaying = false;

  tbBtn?.addEventListener('click', () => {
    if (currentView === 'dev' && devTransport) {
      devTransport();
      return;
    }
    if (currentView === 'gallery') {
      setTopbarPlaying(gallery.toggleUserPaused());
      return;
    }
    preview.close();
    window.__idleScreens?.sleep();
  });

  void wireCapabilitiesHarness(ALL_SAVERS);
  wirePerceptionHarness(ALL_SAVERS);
  wireSchemaHarness();

  type View = 'gallery' | 'dev' | 'docs' | 'evals' | 'settings';
  let currentView: View = 'gallery';

  // ========== FULLSCREEN PREVIEW (shared by Gallery + Dev Tools) ==========
  // A viewer, not a screensaver demo: it exits on Escape or a click, never on
  // a stray mouse move. The top-bar "Idle demo" button is the other half of
  // that pair — it sleeps the real <idle-screen>, which does wake on any input.
  let devSelectRef: ((id: string) => void) | null = null;

  const goToDev = (id: string): void => {
    cfg.saver = id;
    if (location.hash.replace(/^#/, '') === 'dev') devSelectRef?.(id);
    else location.hash = 'dev';
  };

  // ========== GALLERY VIEW (grid of thumbnail cards) ==========
  const gallery = buildGallery(document.getElementById('gallery-root')!, GALLERY_GROUPS, {
    activeId: cfg.saver,
    onOpen: (id) => openPreview(id),
    onOpenInDev: goToDev,
  });

  const preview = createPreviewOverlay(PREVIEW_ENTRIES, {
    seed: () => cfg.seed,
    onShow: (id) => {
      cfg.saver = id;
      gallery.setActive(id);
      window.__idleScreens?.setPlugin(id);
    },
    onExit: () => {
      previewIsOpen = false;
      gallery.setPlaying(currentView === 'gallery');
    },
    onOpenInDev: goToDev,
  });

  function openPreview(id: string): void {
    cfg.saver = id;
    setTopbarSaver(ALL_SAVERS.find((s) => s.manifest.id === id) ?? null);
    rebuild(cfg);
    previewIsOpen = true;
    gallery.setActive(id);
    gallery.setPlaying(false); // don't burn 30 canvases behind a fullscreen preview
    preview.open(id);
  }

  // ========== DEV VIEW (lazy-init on first navigate) ==========
  let devInitialized = false;
  let docsInitialized = false;
  let evalsInitialized = false;
  let settingsInitialized = false;

  const initSettings = (): void => {
    if (settingsInitialized) return;
    settingsInitialized = true;
    const mount = document.getElementById('settings-root');
    if (mount) buildSettingsPanel(mount);
  };

  const initDocs = (): void => {
    if (docsInitialized) return;
    docsInitialized = true;
    const mount = document.getElementById('docs-main');
    if (mount) buildDevDocs(mount);
  };

  const initEvals = (): void => {
    if (evalsInitialized) return;
    evalsInitialized = true;
    const mount = document.getElementById('evals-root');
    // The chamber is fullscreen too, so it needs the same idle suppression as
    // the gallery preview — otherwise the screensaver drops over the artwork.
    if (mount) buildEvalsPanel(mount, { onFullscreenChange: (open) => { previewIsOpen = open; } });
  };

  const initDev = (): void => {
    if (devInitialized) return;
    devInitialized = true;

    const right = buildRightDock(document.getElementById('dock-right')!);
    const bottom = buildBottomDock(document.getElementById('dock-bottom')!);
    const left = document.getElementById('dock-left')!;

    const devProps = buildPropertiesPanel(right.props);
    devProps.select(ALL_SAVERS.find((s) => s.manifest.id === cfg.saver) ?? ALL_SAVERS[0]!);
    buildConfigPanel(cfg, rebuild, right.engine, () => openPreview(cfg.saver));

    const { debug, perception, layers } = right;
    const { timeline } = bottom;

    let percThrottleId = 0;
    let pendingT = 0;
    timeline.onTimeChange = (t) => {
      pendingT = t;
      if (percThrottleId) return;
      percThrottleId = window.setTimeout(() => { percThrottleId = 0; perception.setTime(pendingT); }, 250);
    };

    const viewportHost = document.getElementById('viewport-host') as HTMLDivElement | null;
    const viewportLabel = document.getElementById('viewport-label');
    let devPreviewInst: SaverInstance | null = null;
    let devStage: MountedStage | null = null;
    let devMountToken = 0;

    // Stage picker: passthrough savers perform ON a page, so the workbench
    // offers swappable mock documents. (stage, seed) => identical performance.
    const stageSaved = localStorage.getItem('idleScreens.dev.stage');
    let stageId = STAGES.some((s) => s.id === stageSaved) ? stageSaved! : 'article';
    const stagePick = document.createElement('select');
    stagePick.id = 'stage-pick';
    stagePick.title = 'Mock page the passthrough saver performs on';
    stagePick.setAttribute('aria-label', 'Stage document');
    stagePick.style.cssText =
      'position:absolute;right:10px;top:10px;z-index:3;font:10px ui-monospace,monospace;' +
      'background:#14161c;color:#c6cbd4;border:1px solid #2a2e38;border-radius:4px;padding:3px 6px;display:none';
    for (const st of STAGES) {
      const o = document.createElement('option');
      o.value = st.id;
      o.textContent = st.label;
      stagePick.append(o);
    }
    stagePick.value = stageId;
    // Lives NEXT TO the viewport, not inside it — devSelect clears the
    // viewport's children on every mount.
    viewportHost?.parentElement?.appendChild(stagePick);
    stagePick.addEventListener('change', () => {
      stageId = stagePick.value;
      localStorage.setItem('idleScreens.dev.stage', stageId);
      devSelect(cfg.saver);
    });

    const devSelect = (id: string): void => {
      const saver = ALL_SAVERS.find((s) => s.manifest.id === id);
      if (!saver) return;
      cfg.saver = id;
      // Deep link: the address bar always names the selected saver, so the
      // state you are looking at is shareable as-is. replaceState (not push)
      // — browsing the palette is one workbench state, not a history trail.
      const url = new URL(location.href);
      url.searchParams.set('saver', id);
      url.hash = 'dev';
      history.replaceState(null, '', url);
      rebuild(cfg);
      devProps.select(saver);
      setTopbarSaver(saver);
      document
        .querySelectorAll('#dock-left .palette-item')
        .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.id === id));
      if (!viewportHost) return;
      viewportHost.classList.add('active');
      viewportHost.classList.toggle('passthrough', !!saver.manifest.passthrough);
      if (viewportLabel) viewportLabel.textContent = `${saver.manifest.label} -- inline preview`;

      if (devPreviewInst) devPreviewInst.dispose();
      devPreviewInst = null;
      devStage?.destroy();
      devStage = null;
      viewportHost.querySelectorAll(':scope > :not(#viewport-label)').forEach((n) => n.remove());
      const rect = viewportHost.getBoundingClientRect();
      const previewCtx = {
        saver,
        previewActive: true,
        previewSize: { w: Math.round(rect.width) || 640, h: Math.round(rect.height) || 400 },
      };
      timeline.setSaver(saver, null, cfg.seed);
      debug.setContext(previewCtx);
      perception.setSaver(id, {
        width: Math.round(rect.width) || 640,
        height: Math.round(rect.height) || 400,
        seed: cfg.seed,
        // Imperative savers have no spec to analyse; the panel reads their
        // pixels instead, which needs the plugin itself.
        saver,
      });
      layers.setSaver(id);

      // Passthrough savers perform ON a page: mount a stage document in an
      // iframe and let the saver play inside it, victims scoped to the stage.
      // (stage, seed) is the whole recipe — the performance is repeatable.
      const useStage = !!saver.manifest.passthrough && stageId !== 'none';
      stagePick.style.display = saver.manifest.passthrough ? 'block' : 'none';
      const token = ++devMountToken;
      const mounted: Promise<SaverInstance> = useStage
        ? mountStage(viewportHost, STAGES.find((st) => st.id === stageId)!).then((st) => {
            if (token !== devMountToken) { st.destroy(); throw new Error('stale stage mount'); }
            devStage = st;
            return Promise.resolve(
              saver.mount({
                host: st.overlay,
                dpr: devicePixelRatio ?? 1,
                width: st.width || Math.round(rect.width) || 640,
                height: st.height || Math.round(rect.height) || 400,
                rng: createRng((cfg.seed >>> 0) || 1),
                seed: cfg.seed,
                reducedMotion: false,
                page: st.page,
              }),
            );
          })
        : Promise.resolve(
            saver.mount({
              host: viewportHost,
              dpr: devicePixelRatio ?? 1,
              width: Math.round(rect.width) || 640,
              height: Math.round(rect.height) || 400,
              rng: createRng((cfg.seed >>> 0) || 1),
              seed: cfg.seed,
              reducedMotion: false,
            }),
          );
      mounted.then((inst) => {
        if (token !== devMountToken) { inst.dispose(); return; }
        devPreviewInst = inst;
        inst.setPaused(true);
        timeline.setSaver(saver, inst, cfg.seed);
        layers.setRuntime(inst, devStage?.doc.body ?? null);
        if (devStage) {
          // Re-aim perception at the STAGE performance: same victim geometry
          // (mirrored, so the sampler never fights the live instance), same
          // dimensions — the map now portrays what the viewport shows.
          perception.setSaver(id, {
            width: devStage.width || Math.round(rect.width) || 640,
            height: devStage.height || Math.round(rect.height) || 400,
            seed: cfg.seed,
            saver,
            page: mirrorPage(devStage),
          });
        }
        requestAnimationFrame(() => {
          devProps.refresh();
          debug.setContext(previewCtx);
        });
      }).catch(() => { /* superseded by a newer selection */ });
    };

    layers.onSpecChange = (editedSpec) => {
      if (!viewportHost) return;
      try {
        const newSaver = compileSaver(editedSpec);
        if (devPreviewInst) devPreviewInst.dispose();
        devPreviewInst = null;
        viewportHost.querySelectorAll(':scope > :not(#viewport-label)').forEach((n) => n.remove());
        const rect = viewportHost.getBoundingClientRect();
        timeline.setSaver(newSaver, null, cfg.seed);
        void Promise.resolve(
          newSaver.mount({
            host: viewportHost,
            dpr: devicePixelRatio ?? 1,
            width: Math.round(rect.width) || 640,
            height: Math.round(rect.height) || 400,
            rng: createRng((cfg.seed >>> 0) || 1),
            seed: cfg.seed,
            reducedMotion: false,
          }),
        ).then((inst) => {
          devPreviewInst = inst;
          inst.setPaused(true);
          timeline.setSaver(newSaver, inst, cfg.seed);
          layers.setRuntime(inst, null);
        });
        perception.updateSpec(editedSpec);
      } catch (err) {
        console.warn('[layers] spec recompile failed:', err);
      }
    };

    devSelectRef = devSelect;
    devTransport = () => timeline.togglePlay();
    timeline.onPlayingChange = (p) => {
      devPlaying = p;
      if (currentView === 'dev') setTopbarPlaying(p);
    };
    buildSaverPalette(left, devSelect, cfg.saver);
    devSelect(cfg.saver);
  };

  // ========== ROUTER ==========
  const galleryView = document.getElementById('view-gallery')!;
  const devView = document.getElementById('view-dev')!;
  const docsView = document.getElementById('view-docs')!;
  const evalsView = document.getElementById('view-evals')!;
  const settingsView = document.getElementById('view-settings')!;

  const scrollDocsAnchor = (anchor: string | null): void => {
    if (!anchor) return;
    requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const parseHash = (): { view: View; docsAnchor: string | null } => {
    const raw = location.hash.replace(/^#/, '');
    if (raw === 'dev') return { view: 'dev', docsAnchor: null };
    if (raw === 'evals') return { view: 'evals', docsAnchor: null };
    if (raw === 'settings') return { view: 'settings', docsAnchor: null };
    if (raw === 'docs') return { view: 'docs', docsAnchor: null };
    if (raw.startsWith('docs/')) return { view: 'docs', docsAnchor: raw.slice(5) };
    if (raw.startsWith('api-')) return { view: 'docs', docsAnchor: raw };
    return { view: 'gallery', docsAnchor: null };
  };

  const showView = (view: View, docsAnchor: string | null = null): void => {
    currentView = view;
    syncTopbarMode(view);
    preview.close(); // navigating away always leaves the fullscreen viewer
    // Gallery canvases only run while the gallery is the visible tab.
    gallery.setPlaying(view === 'gallery');
    galleryView.hidden = view !== 'gallery';
    devView.hidden = view !== 'dev';
    docsView.hidden = view !== 'docs';
    evalsView.hidden = view !== 'evals';
    settingsView.hidden = view !== 'settings';
    document.querySelectorAll('#topbar nav a').forEach((a) => {
      const on = (a as HTMLElement).dataset.view === view;
      a.classList.toggle('active', on);
      a.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (view === 'dev') initDev();
    if (view === 'evals') initEvals();
    if (view === 'settings') initSettings();
    if (view === 'docs') {
      initDocs();
      scrollDocsAnchor(docsAnchor);
    }
  };

  document.querySelectorAll('#topbar nav a').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = (a as HTMLAnchorElement).getAttribute('href') ?? '#';
      location.hash = href === '#' ? '' : href.replace('#', '');
    }),
  );
  window.addEventListener('hashchange', () => {
    const { view, docsAnchor } = parseHash();
    showView(view, docsAnchor);
  });
  const initial = parseHash();
  showView(initial.view, initial.docsAnchor);
}

interface PropertiesHandle {
  select(saver: SaverPlugin): void;
  refresh(): void;
}

type Attribution = NonNullable<SaverPlugin['manifest']['attribution']>;

/**
 * Render the licence cell — as a link only when the manifest's URL is a real
 * web address.
 *
 * Escaping alone would not make this safe: `href="javascript:…"` contains no
 * character `escapeHtml` touches. A saver's manifest is in-repo today, but a
 * third-party or generated saver is exactly the case attribution exists for,
 * so the link fails closed to plain text rather than trusting the string.
 */
function attributionLicense(a: Attribution): string {
  const href = a.url ? safeHttpUrl(a.url) : null;
  const label = escapeHtml(a.license);
  return href ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>` : label;
}

function buildPropertiesPanel(mount: HTMLElement): PropertiesHandle {
  const panel = document.createElement('div');
  panel.className = 'wb-panel-content';
  panel.id = 'props-panel';
  mount.append(panel);

  const viewport = (): ParentNode | null => document.getElementById('viewport-host');
  let current: SaverPlugin | null = null;

  const row = (label: string, value: string): string =>
    `<div class="wb-prop"><dt>${label}</dt><dd>${value}</dd></div>`;

  const render = (s: SaverPlugin): void => {
    current = s;
    const m = s.manifest;
    const minBackend = m.minBackend ?? 'css';
    const flashSafe = m.a11y?.flashSafe;
    const workerEligible = m.workerReady
      && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
    const variant = SAVER_VARIANTS[m.id];
    panel.innerHTML = `
      <div class="wb-object">
        <span class="wb-object-name">${m.label}</span>
        ${workerEligible ? '<span class="wb-badge" title="OffscreenCanvas + Web Worker">Worker</span>' : ''}
      </div>
      <dl class="wb-props">
        ${row('ID', `<code>${m.id}</code>`)}
        ${variant ? row('Variant', variant) : ''}
        ${row('Package', `<code>${packageFor(s)}</code>`)}
        ${row('Backend', formatBackendLabel(m.id, minBackend, viewport()))}
        ${row('Cost', m.costTier ?? 'idle')}
        ${row('Motion', m.motionIntensity ?? 'calm')}
        ${row('Passthrough', m.passthrough ? 'yes' : 'no')}
        ${row('Reduced motion', m.reducedMotionFallback ?? 'none')}
        ${row('Flash safe', flashSafe === undefined ? '—' : flashSafe ? 'yes' : 'no')}
        ${row('Worker ready', m.workerReady ? 'yes' : 'no')}
        ${m.paramSpace ? row('Params', String(Object.keys(m.paramSpace).length)) : ''}
        ${m.attribution ? row('Source', `<span title="${escapeHtml(m.attribution.source)}">${escapeHtml(m.attribution.source)}</span>`) : ''}
        ${m.attribution ? row('License', attributionLicense(m.attribution)) : ''}
      </dl>
      ${m.a11y?.notes ? `<p class="wb-note">${escapeHtml(m.a11y.notes)}</p>` : ''}`;
  };

  return {
    select: render,
    refresh: () => {
      if (current) render(current);
    },
  };
}

function buildConfigPanel(
  cfg: LiveConfig,
  rebuild: (c: LiveConfig) => void,
  mount: HTMLElement,
  onPreview: () => void,
): void {
  const panel = document.createElement('div');
  panel.className = 'wb-panel-content';

  const propRow = (labelText: string, control: HTMLElement): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'wb-prop';
    const dt = document.createElement('dt');
    dt.textContent = labelText;
    const dd = document.createElement('dd');
    dd.append(control);
    row.append(dt, dd);
    return row;
  };
  const commit = (): void => rebuild(cfg);

  const selSel = document.createElement('select');
  selSel.id = 'cfg-selection';
  selSel.className = 'wb-input wb-select';
  for (const v of ['fixed', 'random', 'rotate'] as const) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    selSel.append(o);
  }
  selSel.value = cfg.selection;
  selSel.addEventListener('change', () => {
    cfg.selection = selSel.value as LiveConfig['selection'];
    commit();
  });

  const numberInput = (id: string, value: number, on: (n: number) => void): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = 'number';
    i.id = id;
    i.className = 'wb-input';
    i.value = String(value);
    i.addEventListener('change', () => on(Number(i.value)));
    return i;
  };
  const timeout = numberInput('cfg-timeout', cfg.timeoutMs, (n) => {
    cfg.timeoutMs = n;
    commit();
  });
  const seed = numberInput('cfg-seed', cfg.seed, (n) => {
    cfg.seed = n;
    commit();
  });

  const checkRow = (id: string, labelText: string, checked: boolean, on: (b: boolean) => void): HTMLElement => {
    const row = document.createElement('label');
    row.className = 'wb-prop wb-prop-check';
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.id = id;
    c.checked = checked;
    c.addEventListener('change', () => on(c.checked));
    const span = document.createElement('span');
    span.textContent = labelText;
    row.append(c, span);
    return row;
  };

  const props = document.createElement('dl');
  props.className = 'wb-props wb-props-form';
  props.append(
    propRow('Selection', selSel),
    propRow('Idle timeout', timeout),
    propRow('Seed', seed),
  );

  const toggles = document.createElement('div');
  toggles.className = 'wb-toggles';
  toggles.append(
    checkRow('cfg-blur', 'Sleep on blur', cfg.sleepOnBlur, (b) => {
      cfg.sleepOnBlur = b;
      commit();
    }),
    checkRow('cfg-clock', 'Show clock', cfg.showClock, (b) => {
      cfg.showClock = b;
      commit();
    }),
    checkRow('cfg-menu', 'Cmd+K menu', cfg.configMenu, (b) => {
      cfg.configMenu = b;
      commit();
    }),
    checkRow('cfg-reduced', 'Reduced motion', cfg.reducedMotion, (b) => {
      cfg.reducedMotion = b;
      commit();
    }),
  );

  const actions = document.createElement('div');
  actions.className = 'wb-actions';
  // Two different fullscreen modes, deliberately labelled apart: "Preview"
  // is the viewer (Esc/click to exit); "Idle demo" is the real screensaver
  // (wakes on any input, including mouse movement).
  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'wb-btn wb-btn-primary';
  previewBtn.textContent = 'Preview';
  previewBtn.title = 'Fullscreen preview — Esc or click to exit';
  previewBtn.addEventListener('click', onPreview);
  const sleepBtn = document.createElement('button');
  sleepBtn.type = 'button';
  sleepBtn.className = 'wb-btn';
  sleepBtn.textContent = 'Idle demo';
  sleepBtn.title = 'Sleep the engine — wakes on any input, like a real screensaver';
  sleepBtn.addEventListener('click', () => window.__idleScreens?.sleep());
  const wakeBtn = document.createElement('button');
  wakeBtn.type = 'button';
  wakeBtn.className = 'wb-btn';
  wakeBtn.textContent = 'Wake';
  wakeBtn.addEventListener('click', () => window.__idleScreens?.wake());
  actions.append(previewBtn, sleepBtn, wakeBtn);

  panel.append(props, toggles, actions);
  mount.append(panel);
}
