/**
 * Fullscreen saver PREVIEW — a viewer, not a screensaver demo.
 *
 * The distinction matters and is the reason this exists instead of reusing
 * `<idle-screen>`: the element is a faithful screensaver, so it wakes on
 * `pointermove` (correct — that is what a screensaver does). A gallery click
 * means "show me this saver", and dismissing that on the first twitch of the
 * mouse is hostile. Here, moving the mouse REVEALS the chrome; you leave
 * deliberately with Escape or a click.
 *
 * Exit:   Escape, or a click anywhere outside the chrome bar.
 * Browse: ArrowLeft / ArrowRight step through savers without leaving.
 * Idle:   chrome + cursor fade out after IDLE_HIDE_MS of no pointer movement.
 *
 * Renders into the existing `#stage` element (shared with ?frame= / ?harness=
 * modes, which never run at the same time as live mode).
 */
import { createRng, type SaverInstance, type SaverPlugin } from '@idle-screens/core';

/** Chrome (and the cursor) hide after this long without pointer movement. */
const IDLE_HIDE_MS = 2200;

export interface PreviewEntry {
  saver: SaverPlugin;
  /** npm package the saver ships in, for the chrome subtitle. */
  pkg: string;
}

export interface PreviewOverlayOptions {
  /** Seed to mount with — read at open time so config changes are picked up. */
  seed: () => number;
  /** Fired whenever the visible saver changes (open, or arrow-key step). */
  onShow?: (id: string) => void;
  /** Fired on exit, with the id that was last visible. */
  onExit?: (id: string) => void;
  /** "Open in Dev Tools" action; omitted = button hidden. */
  onOpenInDev?: (id: string) => void;
}

export interface PreviewOverlayHandle {
  open(id: string): void;
  close(): void;
  isOpen(): boolean;
  /** Currently previewed saver id, or null when closed. */
  current(): string | null;
}

export function createPreviewOverlay(
  entries: PreviewEntry[],
  opts: PreviewOverlayOptions,
): PreviewOverlayHandle {
  const found = document.getElementById('stage');
  if (!found) throw new Error('[preview] #stage element is missing');
  const stage: HTMLElement = found;

  // ---- DOM ---------------------------------------------------------------
  const surface = document.createElement('div');
  surface.className = 'pv-surface';

  const chrome = document.createElement('div');
  chrome.className = 'pv-chrome';

  const idEl = document.createElement('div');
  idEl.className = 'pv-id';
  const nameEl = document.createElement('span');
  nameEl.className = 'pv-name';
  const pkgEl = document.createElement('span');
  pkgEl.className = 'pv-pkg';
  idEl.append(nameEl, pkgEl);

  const badges = document.createElement('div');
  badges.className = 'pv-badges';

  const nav = document.createElement('div');
  nav.className = 'pv-nav';
  const prevBtn = chromeButton('‹', 'Previous saver (←)');
  const posEl = document.createElement('span');
  posEl.className = 'pv-pos';
  const nextBtn = chromeButton('›', 'Next saver (→)');
  nav.append(prevBtn, posEl, nextBtn);

  const actions = document.createElement('div');
  actions.className = 'pv-actions';
  const devBtn = chromeButton('Dev Tools ↗', 'Inspect this saver in the workbench', 'pv-btn-wide');
  const closeBtn = chromeButton('Close', 'Exit preview (Esc)', 'pv-btn-wide');
  if (opts.onOpenInDev) actions.append(devBtn);
  actions.append(closeBtn);

  chrome.append(idEl, badges, nav, actions);

  const hint = document.createElement('div');
  hint.className = 'pv-hint';
  hint.textContent = 'Esc or click to exit · ← → to browse';

  // ---- state -------------------------------------------------------------
  let open = false;
  /** False for one frame after opening, so the opening click cannot dismiss. */
  let armed = false;
  let armFrame = 0;
  let index = -1;
  let inst: SaverInstance | null = null;
  let mountToken = 0;
  let hideTimer = 0;

  const at = (i: number): PreviewEntry | undefined => entries[i];

  // ---- chrome auto-hide --------------------------------------------------
  const showChrome = (): void => {
    stage.classList.remove('pv-idle');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => stage.classList.add('pv-idle'), IDLE_HIDE_MS);
  };

  // ---- mounting ----------------------------------------------------------
  const disposeInstance = (): void => {
    mountToken += 1; // invalidate any in-flight mount
    if (inst) {
      try {
        inst.dispose();
      } catch (err) {
        console.warn('[preview] dispose failed:', err);
      }
    }
    inst = null;
    surface.replaceChildren();
  };

  const pageCtx = {
    palette: (): string[] => [],
    victims: (sel: string): HTMLElement[] =>
      Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((el) => !stage.contains(el)),
  };

  const show = (i: number): void => {
    const entry = at(i);
    if (!entry) return;
    index = i;
    const { saver, pkg } = entry;
    const m = saver.manifest;

    disposeInstance();
    const token = mountToken;

    // Passthrough savers punch a hole through to the live page — let the
    // gallery show through instead of forcing a black void behind them.
    stage.classList.toggle('pv-passthrough', !!m.passthrough);

    nameEl.textContent = m.label;
    pkgEl.textContent = pkg;
    posEl.textContent = `${i + 1} / ${entries.length}`;
    renderBadges(badges, saver);
    showChrome();

    const seed = opts.seed();
    void Promise.resolve(
      saver.mount({
        host: surface,
        dpr: devicePixelRatio || 1,
        width: window.innerWidth,
        height: window.innerHeight,
        rng: createRng((seed >>> 0) || 1),
        seed,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        page: m.passthrough ? pageCtx : undefined,
      }),
    )
      .then((mounted) => {
        if (token !== mountToken) {
          mounted.dispose(); // superseded while awaiting — drop it
          return;
        }
        inst = mounted;
      })
      .catch((err) => console.warn(`[preview] ${m.id} failed to mount:`, err));

    opts.onShow?.(m.id);
  };

  const step = (delta: number): void => {
    if (!open || entries.length === 0) return;
    show((index + delta + entries.length) % entries.length);
  };

  // ---- input -------------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      // Deliberately NOT stopPropagation: the engine's IdleDetector listens on
      // window in the bubble phase, and swallowing the event here would leave
      // its idle timer latched so the screensaver never armed again.
      close();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
      return;
    }
    // Anything else: surface the chrome so the exit affordance is visible,
    // but do NOT exit. Screensaver "press any key" semantics live on
    // <idle-screen>, behind the top-bar Sleep button.
    showChrome();
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (!open || !armed) return;
    if ((e.target as HTMLElement | null)?.closest('.pv-chrome')) return; // chrome owns its clicks
    close();
  };

  // Movement reveals the chrome. It never exits — that is the whole point.
  const onPointerMove = (): void => {
    if (open) showChrome();
  };

  const onResize = (): void => inst?.resize(window.innerWidth, window.innerHeight, devicePixelRatio || 1);

  // ---- lifecycle ---------------------------------------------------------
  function close(): void {
    if (!open) return;
    const last = at(index)?.saver.manifest.id ?? null;
    open = false;
    armed = false;
    if (armFrame) cancelAnimationFrame(armFrame);
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = 0;
    disposeInstance();

    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, { capture: true } as EventListenerOptions);
    window.removeEventListener('resize', onResize);

    stage.hidden = true;
    stage.classList.remove('pv-idle', 'pv-passthrough');
    document.body.classList.remove('pv-open');
    setViewsInert(false);
    index = -1;
    if (last) opts.onExit?.(last);
  }

  function openAt(id: string): void {
    const i = entries.findIndex((e) => e.saver.manifest.id === id);
    if (i < 0) return;

    if (!stage.contains(surface)) stage.append(surface, chrome, hint);
    stage.hidden = false;
    document.body.classList.add('pv-open');
    // Without this, Tab walks into the gallery cards / Engine buttons behind
    // the overlay and you can trigger them blind.
    setViewsInert(true);

    if (!open) {
      open = true;
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('pointerdown', onPointerDown, true);
      window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
      window.addEventListener('resize', onResize);
    }

    // Arm on the SECOND frame: the pointerup/click of the gesture that opened
    // the preview must not be read as the gesture that closes it.
    armed = false;
    if (armFrame) cancelAnimationFrame(armFrame);
    armFrame = requestAnimationFrame(() => {
      armFrame = requestAnimationFrame(() => {
        armFrame = 0;
        armed = true;
      });
    });

    show(i);
  }

  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  closeBtn.addEventListener('click', () => close());
  devBtn.addEventListener('click', () => {
    const id = at(index)?.saver.manifest.id;
    close();
    if (id) opts.onOpenInDev?.(id);
  });

  return {
    open: openAt,
    close,
    isOpen: () => open,
    current: () => at(index)?.saver.manifest.id ?? null,
  };
}

// ---------------------------------------------------------------------------

/** Everything the preview covers, so Tab can't reach behind it. */
const INERT_TARGETS = '#topbar, #view-gallery, #view-dev, #view-evals, #view-docs';

function setViewsInert(on: boolean): void {
  for (const el of document.querySelectorAll<HTMLElement>(INERT_TARGETS)) el.inert = on;
}

function chromeButton(text: string, title: string, extra?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = ['pv-btn', extra].filter(Boolean).join(' ');
  b.textContent = text;
  b.title = title;
  return b;
}

function renderBadges(mount: HTMLElement, saver: SaverPlugin): void {
  const m = saver.manifest;
  const chips: Array<{ text: string; title: string; tone?: string }> = [
    { text: m.minBackend ?? 'css', title: 'Minimum rendering backend' },
    { text: m.costTier ?? 'idle', title: 'Cost tier' },
    { text: m.motionIntensity ?? 'calm', title: 'Motion intensity' },
  ];
  if (m.passthrough) chips.push({ text: 'passthrough', title: 'Renders over the live page', tone: 'accent' });
  if (m.workerReady) chips.push({ text: 'worker', title: 'OffscreenCanvas + Web Worker ready', tone: 'accent' });
  if (m.a11y?.flashSafe === false) chips.push({ text: 'flash', title: 'Not certified flash-safe', tone: 'warn' });

  mount.replaceChildren(
    ...chips.map((c) => {
      const el = document.createElement('span');
      el.className = ['pv-badge', c.tone && `pv-badge-${c.tone}`].filter(Boolean).join(' ');
      el.textContent = c.text;
      el.title = c.title;
      return el;
    }),
  );
}
