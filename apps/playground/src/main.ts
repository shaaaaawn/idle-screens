import './workbench'; // registers <wb-dock> + <wb-splitter> custom elements
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
import { compileSaver, LANTERNS_SPEC, SNOWFALL_SPEC } from '@idle-screens/schema';
import type { FlashReport } from '@idle-screens/validator';
import { sampleSaver, sampleStrobe, type ValidateResult } from './validate';
import { buildCapabilitiesPanel, type CapabilitiesHandle } from './capabilities-panel';
import { buildSchemaPanel } from './schema-panel';

const ALL_SAVERS = [blackHole, ...CLASSIC_SAVERS, compileSaver(SNOWFALL_SPEC), compileSaver(LANTERNS_SPEC)];

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
// Validator harness: sample savers (or a synthetic strobe) for the e2e gate.
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
// Deterministic single-frame render: the target of the Playwright proof.
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
    reducedMotion: true, // no rAF; we render exactly one frame
  };
  void Promise.resolve(blackHole.mount(ctx)).then((inst: SaverInstance) => {
    if (params.get('track') === 'demo') inst.applyTrack?.(demoTrack);
    inst.renderFrame?.(frame, seed);
    window.__frameReady = true;
  });
}

// ---------------------------------------------------------------------------
// SaverInstance lifecycle harness (drives the full interface directly).
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
// Live overlay + interactive config panel + determinism demo.
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

  // Reduced-motion is driven by matchMedia; let the panel force it by overriding.
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
    if (el) el.remove(); // disconnect -> teardown (destroys an element-owned engine)
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
    // The panel's saver dropdown is the source of truth here. The engine otherwise
    // restores the last-persisted plugin from localStorage, which would silently
    // override (and ignore) the selection — so force it and persist the choice.
    window.__idleScreens?.setPlugin(c.saver);
  };
  rebuild(cfg);

  // Dock the panels into the workbench regions (left = savers, right = inspector,
  // bottom = tools). Each dock body scrolls locally; the window never scrolls.
  const right = document.getElementById('dock-right')!;
  const bottom = document.getElementById('dock-bottom')!;
  const left = document.getElementById('dock-left')!;

  const propsPanel = buildPropertiesPanel(right);
  buildConfigPanel(cfg, rebuild, right);
  const capsHandle = buildCapabilitiesPanel(ALL_SAVERS, right);
  buildDeterminismDemo(bottom);
  buildSafetyPanel(bottom);
  buildSchemaPanel(bottom);

  // Inline viewport preview: selecting a saver (palette or dropdown) shows it IN the
  // center viewport, not fullscreen. The top-bar "Sleep" is what triggers fullscreen.
  const viewportHost = document.getElementById('viewport-host') as HTMLDivElement | null;
  const viewportLabel = document.getElementById('viewport-label');
  let previewInst: SaverInstance | null = null;
  const selectSaver = (id: string): void => {
    const saver = ALL_SAVERS.find((s) => s.manifest.id === id);
    if (!saver) return;
    cfg.saver = id;
    rebuild(cfg);
    propsPanel.select(saver);
    document
      .querySelectorAll('#dock-left .palette-item')
      .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.id === id));
    if (!viewportHost) return;
    if (previewInst) {
      previewInst.dispose();
      previewInst = null;
    }
    viewportHost.querySelectorAll(':scope > :not(#viewport-label)').forEach((n) => n.remove());
    viewportHost.classList.add('active');
    viewportHost.classList.toggle('passthrough', !!saver.manifest.passthrough);
    if (viewportLabel) viewportLabel.textContent = `${saver.manifest.label} -- inline preview`;
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
    ).then((i) => {
      previewInst = i;
    });
  };

  void capsHandle.then((h) => {
    buildSaverPalette(left, h, selectSaver);
  });

  propsPanel.select(ALL_SAVERS.find((s) => s.manifest.id === cfg.saver) ?? ALL_SAVERS[0]!);
  selectSaver(cfg.saver);
}

/** Left-dock outliner: click a saver to select it.
 *  Each item shows per-saver capability attributes (backend, cost, motion, eligibility). */
function buildSaverPalette(mount: HTMLElement, caps: CapabilitiesHandle, onSelect: (id: string) => void): void {
  const list = document.createElement('div');
  list.className = 'palette';

  const statusColors: Record<string, string> = { ok: '#3fb950', degraded: '#d29922', blocked: '#f85149' };

  const updateBadges = (): void => {
    const results = caps.getResults();
    for (let i = 0; i < ALL_SAVERS.length; i++) {
      const item = list.children[i] as HTMLElement | undefined;
      const r = results[i];
      if (!item || !r) continue;
      const badge = item.querySelector('.palette-status') as HTMLElement | null;
      if (badge) {
        badge.textContent = r.status;
        badge.style.color = statusColors[r.status] ?? '';
        badge.title = r.reasons.length ? r.reasons.join('; ') : '';
      }
    }
  };

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

    const status = document.createElement('span');
    status.className = 'palette-status';
    status.textContent = 'ok';

    item.append(label, status);
    item.addEventListener('click', () => onSelect(s.manifest.id));
    list.append(item);
  }
  mount.append(list);

  updateBadges();
  caps.onChange(updateBadges);
}

/**
 * "Safety & performance" panel: runs @idle-screens/validator over frames sampled from
 * the black hole's renderFrame(t), and lets you check that the flash gate actually
 * FAILS a dangerous strobe (not just rubber-stamps calm savers).
 */
function buildSafetyPanel(mount: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'card safety';
  section.innerHTML = `
    <h2>Safety &amp; performance</h2>
    <p class="lead">WCAG 2.3.1 flash safety (per-tile, &le;3 flashes/sec over &lt;25% area) plus a
      frame-cost budget, computed by <code>@idle-screens/validator</code> over frames stepped
      through <code>renderFrame(t)</code>.</p>
    <div class="det-controls">
      <button id="val-blackhole">Validate the black hole</button>
      <button id="val-strobe-safe">Gate check: 3 Hz strobe</button>
      <button id="val-strobe-danger">Gate check: 15 Hz strobe</button>
    </div>
    <div id="val-out" class="val-out">Click a button to run the validator.</div>`;
  mount.append(section);

  const out = section.querySelector('#val-out') as HTMLDivElement;
  const badge = (ok: boolean, label: string): string =>
    `<span class="verdict ${ok ? 'same' : 'diff'}">● ${label}</span>`;

  const showValidate = (r: ValidateResult): void => {
    if (!r.supported || !r.flash || !r.perf) {
      out.innerHTML = `<em>${r.id}</em> is not frame-addressable (no <code>renderFrame</code>) — flash sampling needs a deterministic frame source.`;
      return;
    }
    const f = r.flash;
    const p = r.perf;
    const honest = r.declaredFlashSafe === undefined || r.declaredFlashSafe === f.passes;
    out.innerHTML = `
      ${badge(f.passes, f.passes ? 'FLASH-SAFE (WCAG 2.3.1)' : 'FLASH RISK')}
      <div class="val-metric">worst ${f.general.worstTileFlashesPerSecond} flashes/sec ·
        flashing area ${(f.general.flashingAreaFraction * 100).toFixed(1)}% · ${f.tiles} tiles · ${f.fps.toFixed(0)}fps sampled</div>
      <div class="val-metric">perf: median ${p.medianMs.toFixed(2)}ms · p95 ${p.p95Ms.toFixed(2)}ms ·
        tier <strong>${p.costTier}</strong> · ${p.withinBudget ? 'within budget' : 'PATHOLOGICAL'}</div>
      <div class="val-metric">manifest a11y.flashSafe = ${String(r.declaredFlashSafe)} — ${honest ? 'matches measured ✓' : 'DISAGREES with measured ✗'}</div>`;
  };

  const showStrobe = (hz: number, f: FlashReport): void => {
    out.innerHTML = `
      ${badge(f.passes, `${hz} Hz strobe → ${f.passes ? 'PASSES' : 'FAILS'} the gate`)}
      <div class="val-metric">worst ${f.general.worstTileFlashesPerSecond} flashes/sec · flashing area ${(f.general.flashingAreaFraction * 100).toFixed(0)}%</div>
      <div class="val-metric">${f.passes ? 'At/below 3 flashes/sec — allowed.' : 'Above 3 flashes/sec over the whole frame — a real gate rejects this.'}</div>`;
  };

  const busy = (): void => {
    out.textContent = 'Sampling…';
  };
  section.querySelector('#val-blackhole')!.addEventListener('click', () => {
    busy();
    void sampleSaver(blackHole, { seconds: 2 }).then(showValidate);
  });
  section.querySelector('#val-strobe-safe')!.addEventListener('click', () => {
    busy();
    showStrobe(3, sampleStrobe(3, { seconds: 2 }));
  });
  section.querySelector('#val-strobe-danger')!.addEventListener('click', () => {
    busy();
    showStrobe(15, sampleStrobe(15, { seconds: 2 }));
  });
}

interface PropertiesHandle {
  select(saver: SaverPlugin): void;
}

function buildPropertiesPanel(mount: HTMLElement): PropertiesHandle {
  const panel = document.createElement('aside');
  panel.className = 'config-panel';
  panel.id = 'props-panel';
  mount.append(panel);

  const row = (label: string, value: string): string =>
    `<div class="cap-line"><span>${label}</span><span>${value}</span></div>`;

  const render = (s: SaverPlugin): void => {
    const m = s.manifest;
    const flashSafe = m.a11y?.flashSafe;
    const workerEligible = m.workerReady
      && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
    panel.innerHTML = `
      <h3>Properties</h3>
      <div class="props-title" id="props-name">${m.label}${workerEligible ? '<span class="worker-badge" title="This saver renders off-main-thread via OffscreenCanvas + Web Worker">Worker</span>' : ''}</div>
      ${row('ID', `<code>${m.id}</code>`)}
      ${row('Backend', m.minBackend ?? 'css')}
      ${row('Cost', m.costTier ?? 'idle')}
      ${row('Motion', m.motionIntensity ?? 'calm')}
      ${row('Passthrough', m.passthrough ? '✓' : '✗')}
      ${row('Reduced-motion', m.reducedMotionFallback ?? 'none')}
      ${row('Flash safe', flashSafe === undefined ? '--' : flashSafe ? '✓' : '✗')}
      ${row('Worker ready', m.workerReady ? '✓' : '✗')}
      ${m.paramSpace ? row('Params', String(Object.keys(m.paramSpace).length)) : ''}
      ${m.a11y?.notes ? `<div class="config-note">${m.a11y.notes}</div>` : ''}`;
  };

  return { select: render };
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

  // Selection
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

/**
 * Interactive determinism demo: render the SAME black-hole program into two
 * canvases and prove that identical (seed, t, control-track) yields byte-identical
 * pixels — while desyncing the seed, or scrubbing t, changes them in lockstep.
 * This is the library's headline idea ("stream the program, not the frames"),
 * made clickable.
 */
function buildDeterminismDemo(mount: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'card determinism';
  section.innerHTML = `
    <h2>Determinism — click to prove it</h2>
    <p class="lead">Both canvases render <code>renderFrame(t, seed)</code> of the black hole
      independently. Same inputs → identical pixels. Desync the seed, or scrub time, and watch.</p>
    <div class="det-controls">
      <label>seed <input type="number" id="det-seed" value="42" /></label>
      <label>t (ms) <input type="range" id="det-t" min="0" max="6000" step="20" value="1500" /></label>
      <span id="det-tval" style="font:12px ui-monospace,monospace;opacity:.7">1500</span>
      <label><input type="checkbox" id="det-track" checked /> control-track</label>
      <label><input type="checkbox" id="det-desync" /> desync B's seed</label>
    </div>
    <div class="det-row">
      <figure class="det-panel" style="margin:0"><canvas id="det-a" width="264" height="172"></canvas><figcaption id="det-capa"></figcaption></figure>
      <figure class="det-panel" style="margin:0"><canvas id="det-b" width="264" height="172"></canvas><figcaption id="det-capb"></figcaption></figure>
    </div>
    <div><span class="verdict" id="det-verdict">…</span></div>
    <div class="det-controls">
      <button id="det-rerender">Re-render</button>
      <button id="det-random">Random seed</button>
    </div>`;
  mount.append(section);

  const $ = <T extends HTMLElement>(id: string): T => section.querySelector('#' + id) as T;
  const seedIn = $<HTMLInputElement>('det-seed');
  const tIn = $<HTMLInputElement>('det-t');
  const tVal = $<HTMLSpanElement>('det-tval');
  const trackIn = $<HTMLInputElement>('det-track');
  const desyncIn = $<HTMLInputElement>('det-desync');
  const capA = $<HTMLElement>('det-capa');
  const capB = $<HTMLElement>('det-capb');
  const verdict = $<HTMLElement>('det-verdict');

  const hostFor = (canvasId: string): HTMLElement => {
    // Give the saver a fresh host so its own canvas is independent; draw its result
    // back into the visible canvas afterwards.
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:-99999px;width:264px;height:172px';
    document.body.append(wrap);
    void canvasId;
    return wrap;
  };

  const shortHash = (s: string): string => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0');
  };

  const renderInto = async (visible: HTMLCanvasElement, seed: number, t: number, track: boolean): Promise<string> => {
    const host = hostFor(visible.id);
    try {
      const inst = await Promise.resolve(
        blackHole.mount({ host, dpr: 1, width: 264, height: 172, rng: createRng(seed), seed, reducedMotion: true }),
      );
      if (track) inst.applyTrack?.(demoTrack);
      inst.renderFrame?.(t, seed);
      const src = host.querySelector('canvas');
      const ctx = visible.getContext('2d')!;
      ctx.clearRect(0, 0, visible.width, visible.height);
      if (src) ctx.drawImage(src, 0, 0, visible.width, visible.height);
      inst.dispose();
      return visible.toDataURL();
    } finally {
      host.remove();
    }
  };

  const render = async (): Promise<void> => {
    const seed = Number(seedIn.value);
    const t = Number(tIn.value);
    const track = trackIn.checked;
    const seedB = desyncIn.checked ? seed + 1 : seed;
    tVal.textContent = String(t);
    const [a, b] = await Promise.all([
      renderInto($<HTMLCanvasElement>('det-a'), seed, t, track),
      renderInto($<HTMLCanvasElement>('det-b'), seedB, t, track),
    ]);
    capA.textContent = `seed ${seed} · t ${t} · ${shortHash(a)}`;
    capB.textContent = `seed ${seedB} · t ${t} · ${shortHash(b)}`;
    const same = a === b;
    verdict.className = 'verdict ' + (same ? 'same' : 'diff');
    verdict.textContent = same
      ? '● IDENTICAL — same (program, seed, t, track) → same pixels'
      : '● DIFFERENT — inputs diverged, so pixels diverge';
  };

  tIn.addEventListener('input', () => void render());
  for (const c of [seedIn, trackIn, desyncIn]) c.addEventListener('change', () => void render());
  $<HTMLButtonElement>('det-rerender').addEventListener('click', () => void render());
  $<HTMLButtonElement>('det-random').addEventListener('click', () => {
    seedIn.value = String(Math.floor(Math.random() * 100_000));
    void render();
  });

  void render();
}
