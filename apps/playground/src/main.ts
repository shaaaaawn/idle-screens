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
import { CLASSIC_SAVERS } from '@idle-screens/savers-classic';
import { AURORA_SPEC, COMETS_SPEC, compileSaver, CONSTELLATION_SPEC, DASHBOARD_SPEC, LANTERNS_SPEC, MATRIX_RAIN_SPEC, POLYGONS_SPEC, ORRERY_SPEC, PROCESSION_SPEC, SAKURA_SPEC, SNOWFALL_SPEC, WARP_TUNNEL_SPEC } from '@idle-screens/schema';
import type { FlashReport } from '@idle-screens/validator';
import { sampleSaver, sampleStrobe, type ValidateResult } from './validate';
import { buildDevDocs } from './dev-docs';
import { wireCapabilitiesHarness, wireSchemaHarness } from './dev-harness';
import { buildBottomDock } from './bottom-dock';
import { buildRightDock } from './right-dock';
import { formatBackendLabel, readPreviewBackend } from './preview-backend';

const SCHEMA_IDS = new Set(['aquarium', 'rain', 'snowfall', 'lanterns', 'sakura', 'dev-dashboard', 'orrery', 'constellation', 'comets', 'aurora', 'warp-tunnel', 'polygons', 'matrix-rain', 'procession']);

interface SaverGroup {
  id: string;
  label: string;
  savers: SaverPlugin[];
}

const SAVER_GROUPS: SaverGroup[] = [
  { id: 'saver-black-hole', label: '@idle-screens/saver-black-hole', savers: [blackHole] },
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
    ],
  },
];

const ALL_SAVERS = SAVER_GROUPS.flatMap((g) => g.savers);

const GROUP_SHORT_LABEL: Record<string, string> = {
  'saver-black-hole': 'black-hole',
  'savers-classic': 'classic',
  schema: 'schema',
};

function buildSaverPalette(mount: HTMLElement, onSelect: (id: string) => void, activeId?: string): void {
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

  mount.append(tree);
}

function packageFor(saver: SaverPlugin): string {
  if (saver.manifest.id === 'black-hole') return '@idle-screens/saver-black-hole';
  if (SCHEMA_IDS.has(saver.manifest.id)) return '@idle-screens/schema';
  return '@idle-screens/savers-classic';
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
  messages: 'Out to Lunch',
  messages2: 'Macintosh',
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

  const toEngineConfig = (c: LiveConfig): Partial<IdleScreensConfig> => ({
    timeoutMs: c.timeoutMs,
    sleepOnBlur: c.sleepOnBlur,
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

  document.getElementById('tb-sleep')?.addEventListener('click', () => window.__idleScreens?.sleep());

  void wireCapabilitiesHarness(ALL_SAVERS);
  wireSchemaHarness();

  // ========== GALLERY VIEW (grid of thumbnail cards) ==========
  const galleryGrid = document.getElementById('gallery-grid')!;
  const galleryInstances: SaverInstance[] = [];

  for (const saver of ALL_SAVERS) {
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.dataset.id = saver.manifest.id;
    if (saver.manifest.id === cfg.saver) card.classList.add('active');

    const preview = document.createElement('div');
    preview.className = 'gallery-card-preview';

    const info = document.createElement('div');
    info.className = 'gallery-card-info';
    const label = document.createElement('span');
    label.className = 'gallery-card-label';
    label.textContent = saver.manifest.label;
    const meta = document.createElement('span');
    meta.className = 'gallery-card-meta';
    meta.textContent = saver.manifest.minBackend ?? 'css';
    info.append(label, meta);

    card.append(preview, info);
    galleryGrid.append(card);

    card.addEventListener('click', () => {
      cfg.saver = saver.manifest.id;
      rebuild(cfg);
      galleryGrid.querySelectorAll('.gallery-card').forEach((c) =>
        c.classList.toggle('active', (c as HTMLElement).dataset.id === saver.manifest.id),
      );
      window.__idleScreens?.sleep();
    });

    void Promise.resolve(
      saver.mount({
        host: preview,
        dpr: 1,
        width: 280,
        height: 175,
        rng: createRng(42),
        seed: 42,
        reducedMotion: false,
      }),
    ).then((inst) => {
      galleryInstances.push(inst);
      const min = saver.manifest.minBackend ?? 'css';
      const syncMeta = (): void => {
        const active = readPreviewBackend(saver.manifest.id, preview);
        meta.textContent = active && active !== min ? active : min;
      };
      requestAnimationFrame(() => requestAnimationFrame(syncMeta));
    });
  }

  setTimeout(() => {
    galleryInstances.forEach((inst) => inst.setPaused(true));
  }, 2000);

  // ========== DEV VIEW (lazy-init on first navigate) ==========
  let devInitialized = false;
  let docsInitialized = false;

  const initDocs = (): void => {
    if (docsInitialized) return;
    docsInitialized = true;
    const mount = document.getElementById('docs-main');
    if (mount) buildDevDocs(mount);
  };

  const initDev = (): void => {
    if (devInitialized) return;
    devInitialized = true;

    const right = buildRightDock(document.getElementById('dock-right')!);
    const bottom = buildBottomDock(document.getElementById('dock-bottom')!);
    const left = document.getElementById('dock-left')!;

    const devProps = buildPropertiesPanel(right.props);
    devProps.select(ALL_SAVERS.find((s) => s.manifest.id === cfg.saver) ?? ALL_SAVERS[0]!);
    buildConfigPanel(cfg, rebuild, right.engine);

    const { debug, perception, layers } = right;
    const { timeline } = bottom;

    let percThrottleId = 0;
    timeline.onTimeChange = (t) => {
      if (percThrottleId) return;
      percThrottleId = window.setTimeout(() => { percThrottleId = 0; perception.setTime(t); }, 250);
    };

    const viewportHost = document.getElementById('viewport-host') as HTMLDivElement | null;
    const viewportLabel = document.getElementById('viewport-label');
    let devPreviewInst: SaverInstance | null = null;

    const devSelect = (id: string): void => {
      const saver = ALL_SAVERS.find((s) => s.manifest.id === id);
      if (!saver) return;
      cfg.saver = id;
      rebuild(cfg);
      devProps.select(saver);
      document
        .querySelectorAll('#dock-left .palette-item')
        .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.id === id));
      if (!viewportHost) return;
      viewportHost.classList.add('active');
      viewportHost.classList.toggle('passthrough', !!saver.manifest.passthrough);
      if (viewportLabel) viewportLabel.textContent = `${saver.manifest.label} -- inline preview`;

      if (devPreviewInst) devPreviewInst.dispose();
      devPreviewInst = null;
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
      });
      layers.setSaver(id);

      void Promise.resolve(
        saver.mount({
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
        timeline.setSaver(saver, inst, cfg.seed);
        requestAnimationFrame(() => {
          devProps.refresh();
          debug.setContext(previewCtx);
        });
      });
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
        });
        perception.updateSpec(editedSpec);
      } catch (err) {
        console.warn('[layers] spec recompile failed:', err);
      }
    };

    buildSaverPalette(left, devSelect, cfg.saver);
    devSelect(cfg.saver);
  };

  // ========== ROUTER ==========
  type View = 'gallery' | 'dev' | 'docs';
  const galleryView = document.getElementById('view-gallery')!;
  const devView = document.getElementById('view-dev')!;
  const docsView = document.getElementById('view-docs')!;

  const scrollDocsAnchor = (anchor: string | null): void => {
    if (!anchor) return;
    requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const parseHash = (): { view: View; docsAnchor: string | null } => {
    const raw = location.hash.replace(/^#/, '');
    if (raw === 'dev') return { view: 'dev', docsAnchor: null };
    if (raw === 'docs') return { view: 'docs', docsAnchor: null };
    if (raw.startsWith('docs/')) return { view: 'docs', docsAnchor: raw.slice(5) };
    if (raw.startsWith('api-')) return { view: 'docs', docsAnchor: raw };
    return { view: 'gallery', docsAnchor: null };
  };

  const showView = (view: View, docsAnchor: string | null = null): void => {
    galleryView.hidden = view !== 'gallery';
    devView.hidden = view !== 'dev';
    docsView.hidden = view !== 'docs';
    document.querySelectorAll('#topbar nav a').forEach((a) => {
      const on = (a as HTMLElement).dataset.view === view;
      a.classList.toggle('active', on);
      a.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (view === 'dev') initDev();
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
      </dl>
      ${m.a11y?.notes ? `<p class="wb-note">${m.a11y.notes}</p>` : ''}`;
  };

  return {
    select: render,
    refresh: () => {
      if (current) render(current);
    },
  };
}

function buildConfigPanel(cfg: LiveConfig, rebuild: (c: LiveConfig) => void, mount: HTMLElement): void {
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
  const sleepBtn = document.createElement('button');
  sleepBtn.type = 'button';
  sleepBtn.className = 'wb-btn wb-btn-primary';
  sleepBtn.textContent = 'Sleep';
  sleepBtn.addEventListener('click', () => window.__idleScreens?.sleep());
  const wakeBtn = document.createElement('button');
  wakeBtn.type = 'button';
  wakeBtn.className = 'wb-btn';
  wakeBtn.textContent = 'Wake';
  wakeBtn.addEventListener('click', () => window.__idleScreens?.wake());
  actions.append(sleepBtn, wakeBtn);

  panel.append(props, toggles, actions);
  mount.append(panel);
}
