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
import { compileSaver, DASHBOARD_SPEC, LANTERNS_SPEC, SAKURA_SPEC, SNOWFALL_SPEC } from '@idle-screens/schema';
import type { FlashReport } from '@idle-screens/validator';
import { sampleSaver, sampleStrobe, type ValidateResult } from './validate';
import { buildCapabilitiesPanel, type CapabilitiesHandle } from './capabilities-panel';
import { buildSchemaPanel } from './schema-panel';
import { buildTimelinePanel } from './timeline-panel';

const ALL_SAVERS = [
  blackHole,
  ...CLASSIC_SAVERS,
  compileSaver(SNOWFALL_SPEC),
  compileSaver(LANTERNS_SPEC),
  compileSaver(SAKURA_SPEC),
  compileSaver(DASHBOARD_SPEC),
];

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

const SCHEMA_IDS = new Set(['aquarium', 'rain', 'snowfall', 'lanterns', 'sakura', 'dev-dashboard']);

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
      const victim = document.querySelector<HTMLElement>('.content h1');
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
  document.getElementById('tb-wake')?.addEventListener('click', () => window.__idleScreens?.wake());

  const capsPromise = buildCapabilitiesPanel(ALL_SAVERS, document.createElement('div'));

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
    });
  }

  setTimeout(() => {
    galleryInstances.forEach((inst) => inst.setPaused(true));
  }, 2000);

  // ========== DEV VIEW (lazy-init on first navigate) ==========
  let devInitialized = false;

  const initDev = (): void => {
    if (devInitialized) return;
    devInitialized = true;

    const right = document.getElementById('dock-right')!;
    const bottom = document.getElementById('dock-bottom')!;
    const left = document.getElementById('dock-left')!;

    const devProps = buildPropertiesPanel(right);
    devProps.select(ALL_SAVERS.find((s) => s.manifest.id === cfg.saver) ?? ALL_SAVERS[0]!);
    buildConfigPanel(cfg, rebuild, right);

    void capsPromise.then(() => {
      buildCapabilitiesPanel(ALL_SAVERS, right);
    });

    const timeline = buildTimelinePanel(bottom);
    buildSchemaPanel(right);

    const viewportHost = document.getElementById('viewport-host') as HTMLDivElement | null;
    const viewportLabel = document.getElementById('viewport-label');
    let devPreviewInst: SaverInstance | null = null;
    let resolvedCaps: CapabilitiesHandle | null = null;

    const updateDevStatus = (id: string): void => {
      if (!resolvedCaps) return;
      const idx = ALL_SAVERS.findIndex((s) => s.manifest.id === id);
      const r = resolvedCaps.getResults()[idx];
      if (r) devProps.setStatus(r.status, r.reasons);
    };

    const devSelect = (id: string): void => {
      const saver = ALL_SAVERS.find((s) => s.manifest.id === id);
      if (!saver) return;
      cfg.saver = id;
      rebuild(cfg);
      devProps.select(saver);
      updateDevStatus(id);
      document
        .querySelectorAll('#dock-left .palette-item')
        .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.id === id));
      if (!viewportHost) return;
      viewportHost.classList.add('active');
      viewportHost.classList.toggle('passthrough', !!saver.manifest.passthrough);
      if (viewportLabel) viewportLabel.textContent = `${saver.manifest.label} -- inline preview`;

      if (devPreviewInst) devPreviewInst.dispose();
      viewportHost.querySelectorAll(':scope > :not(#viewport-label)').forEach((n) => n.remove());
      const rect = viewportHost.getBoundingClientRect();
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
        timeline.setSaver(saver, inst);
        if (saver.manifest.id === 'black-hole') {
          timeline.loadTrack(demoTrack);
        }
      });
    };

    void capsPromise.then((h) => {
      resolvedCaps = h;
      buildSaverPalette(left, h, devSelect);
      updateDevStatus(cfg.saver);
      h.onChange(() => updateDevStatus(cfg.saver));
    });

    devSelect(cfg.saver);
  };

  // ========== ROUTER ==========
  type View = 'gallery' | 'dev';
  const galleryView = document.getElementById('view-gallery')!;
  const devView = document.getElementById('view-dev')!;

  const showView = (view: View): void => {
    galleryView.hidden = view !== 'gallery';
    devView.hidden = view !== 'dev';
    document.querySelectorAll('#topbar nav a').forEach((a) =>
      a.classList.toggle('active', (a as HTMLElement).dataset.view === view),
    );
    if (view === 'dev') initDev();
  };

  const currentView = (): View => (location.hash === '#dev' ? 'dev' : 'gallery');

  document.querySelectorAll('#topbar nav a').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = (a as HTMLAnchorElement).getAttribute('href') ?? '#';
      location.hash = href === '#' ? '' : href.replace('#', '');
    }),
  );
  window.addEventListener('hashchange', () => showView(currentView()));
  showView(currentView());
}

// ---------------------------------------------------------------------------
// Panel builders (used by dev view)
// ---------------------------------------------------------------------------

function buildSaverPalette(mount: HTMLElement, caps: CapabilitiesHandle, onSelect: (id: string) => void): void {
  const list = document.createElement('div');
  list.className = 'palette';

  for (const s of ALL_SAVERS) {
    const item = document.createElement('button');
    item.className = 'palette-item';
    item.dataset.id = s.manifest.id;

    const label = document.createElement('span');
    label.className = 'palette-label';
    label.textContent = s.manifest.label;

    if (s.manifest.workerReady) {
      const wb = document.createElement('span');
      wb.className = 'palette-worker';
      wb.textContent = 'W';
      wb.title = 'Worker-ready';
      item.append(wb);
    }

    item.append(label);
    item.addEventListener('click', () => onSelect(s.manifest.id));
    list.append(item);
  }
  mount.append(list);
}

interface PropertiesHandle {
  select(saver: SaverPlugin): void;
  setStatus(status: string, reasons: string[]): void;
}

function buildPropertiesPanel(mount: HTMLElement): PropertiesHandle {
  const panel = document.createElement('aside');
  panel.className = 'config-panel';
  panel.id = 'props-panel';
  mount.append(panel);

  const row = (label: string, value: string): string =>
    `<div class="cap-line"><span>${label}</span><span>${value}</span></div>`;

  const statusColors: Record<string, string> = { ok: '#3fb950', degraded: '#d29922', blocked: '#f85149' };
  let statusEl: HTMLElement | null = null;

  const render = (s: SaverPlugin): void => {
    const m = s.manifest;
    const flashSafe = m.a11y?.flashSafe;
    const workerEligible = m.workerReady
      && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
    const variant = SAVER_VARIANTS[m.id];
    const source = SCHEMA_IDS.has(m.id) ? 'schema' : 'classic';
    panel.innerHTML = `
      <h3>Properties</h3>
      <div class="props-title" id="props-name">${m.label}${workerEligible ? '<span class="worker-badge" title="This saver renders off-main-thread via OffscreenCanvas + Web Worker">Worker</span>' : ''}</div>
      ${row('ID', `<code>${m.id}</code>`)}
      ${variant ? row('Variant', variant) : ''}
      ${row('Source', source)}
      ${row('Backend', m.minBackend ?? 'css')}
      ${row('Cost', m.costTier ?? 'idle')}
      ${row('Motion', m.motionIntensity ?? 'calm')}
      ${row('Passthrough', m.passthrough ? '✓' : '✗')}
      ${row('Reduced-motion', m.reducedMotionFallback ?? 'none')}
      ${row('Flash safe', flashSafe === undefined ? '--' : flashSafe ? '✓' : '✗')}
      ${row('Worker ready', m.workerReady ? '✓' : '✗')}
      <div class="cap-line"><span>Eligibility</span><span id="props-status">--</span></div>
      ${m.paramSpace ? row('Params', String(Object.keys(m.paramSpace).length)) : ''}
      ${m.a11y?.notes ? `<div class="config-note">${m.a11y.notes}</div>` : ''}`;
    statusEl = panel.querySelector('#props-status');
  };

  const setStatus = (status: string, reasons: string[]): void => {
    if (!statusEl) return;
    statusEl.textContent = status;
    statusEl.style.color = statusColors[status] ?? '';
    statusEl.title = reasons.length ? reasons.join('; ') : '';
  };

  return { select: render, setStatus };
}

function buildConfigPanel(cfg: LiveConfig, rebuild: (c: LiveConfig) => void, mount: HTMLElement): void {
  const panel = document.createElement('aside');
  panel.className = 'config-panel';
  panel.innerHTML = '<h3>Engine</h3>';

  const field = (labelText: string, control: HTMLElement): HTMLElement => {
    const row = document.createElement('label');
    row.className = 'field';
    const span = document.createElement('span');
    span.textContent = labelText;
    row.append(span, control);
    return row;
  };
  const commit = (): void => rebuild(cfg);

  const selSel = document.createElement('select');
  selSel.id = 'cfg-selection';
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

  const checkbox = (id: string, checked: boolean, on: (b: boolean) => void): HTMLInputElement => {
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.id = id;
    c.checked = checked;
    c.addEventListener('change', () => on(c.checked));
    return c;
  };
  const blur = checkbox('cfg-blur', cfg.sleepOnBlur, (b) => {
    cfg.sleepOnBlur = b;
    commit();
  });
  const clock = checkbox('cfg-clock', cfg.showClock, (b) => {
    cfg.showClock = b;
    commit();
  });
  const menu = checkbox('cfg-menu', cfg.configMenu, (b) => {
    cfg.configMenu = b;
    commit();
  });
  const reduced = checkbox('cfg-reduced', cfg.reducedMotion, (b) => {
    cfg.reducedMotion = b;
    commit();
  });

  panel.append(
    field('Selection', selSel),
    field('Idle timeout (ms)', timeout),
    field('Seed', seed),
    field('Sleep on blur', blur),
    field('Show clock', clock),
    field('Cmd+K menu', menu),
    field('Reduced motion', reduced),
  );

  const actions = document.createElement('div');
  actions.className = 'config-actions';
  const sleepBtn = document.createElement('button');
  sleepBtn.textContent = 'Sleep now';
  sleepBtn.addEventListener('click', () => window.__idleScreens?.sleep());
  const wakeBtn = document.createElement('button');
  wakeBtn.textContent = 'Wake';
  wakeBtn.addEventListener('click', () => window.__idleScreens?.wake());
  actions.append(sleepBtn, wakeBtn);
  panel.append(actions);

  mount.append(panel);
}
