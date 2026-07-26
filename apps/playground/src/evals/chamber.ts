/**
 * The evaluation chamber — step out of the grid and look at one screen properly.
 *
 * The compare grid is for scanning; thumbnails at 320×200 can't settle an
 * argument about whether Seurat's dab density reads as atmosphere. The chamber
 * gives one screen the whole viewport at a fixed aspect (so every artist is
 * judged at identical dimensions), keeps the StyleDNA readable beside it, and
 * makes stepping between artists a single keypress — which is what actually
 * makes them comparable.
 *
 * It borrows the preview overlay's interaction language (← / → to browse,
 * mouse-move reveals chrome, armed on the second frame) with one deliberate
 * difference: a click on the stage does NOT exit. The chamber has furniture you
 * are meant to click, so ejecting on a stray click would be hostile. Esc or the
 * Close button, and the hint says so.
 */
import { createRng, type SaverInstance } from '@idle-screens/core';
import { compileSaver } from '@idle-screens/schema';
import type { EvalScreen } from './types';

const IDLE_HIDE_MS = 2600;

export interface ChamberEntry {
  screen: EvalScreen;
  /** Primary label — artist name when comparing, screen title when browsing one artist. */
  title: string;
  /** Movement, or the screen's recipe. */
  subtitle: string;
  /** Pre-rendered StyleDNA block. */
  dna: string;
  /** Optional scored line, shown under the title when a suite has been run. */
  scoreLine?: string;
}

export interface ChamberOptions {
  /** Fired on enter/exit — used to pause the grid behind and suppress the idle screensaver. */
  onOpenChange?: (open: boolean) => void;
  /** Fired whenever the visible screen changes, so the caller can sync selection. */
  onShow?: (screenId: string) => void;
}

export interface ChamberHandle {
  /** Load a set of comparable screens (same intent, or one artist's set). */
  setEntries(entries: ChamberEntry[], contextLabel: string): void;
  open(screenId: string): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createChamber(opts: ChamberOptions = {}): ChamberHandle {
  const root = document.createElement('div');
  root.id = 'evals-chamber';
  root.hidden = true;

  // ---- chrome -----------------------------------------------------------
  const chrome = document.createElement('div');
  chrome.className = 'ch-chrome';

  const ident = document.createElement('div');
  ident.className = 'ch-ident';
  const titleEl = document.createElement('div');
  titleEl.className = 'ch-title';
  const subEl = document.createElement('div');
  subEl.className = 'ch-sub';
  ident.append(titleEl, subEl);

  const contextEl = document.createElement('div');
  contextEl.className = 'ch-context';

  const nav = document.createElement('div');
  nav.className = 'ch-nav';
  const prevBtn = chamberButton('‹', 'Previous (←)');
  const posEl = document.createElement('span');
  posEl.className = 'ch-pos';
  const nextBtn = chamberButton('›', 'Next (→)');
  nav.append(prevBtn, posEl, nextBtn);

  const dnaBtn = chamberButton('StyleDNA', 'Show or hide the StyleDNA column (D)', 'ch-btn-wide');
  dnaBtn.setAttribute('aria-pressed', 'true');
  const closeBtn = chamberButton('Close', 'Leave the chamber (Esc)', 'ch-btn-wide');

  chrome.append(ident, contextEl, nav, dnaBtn, closeBtn);

  // ---- stage ------------------------------------------------------------
  const stageWrap = document.createElement('div');
  stageWrap.className = 'ch-stage-wrap';
  const stageBox = document.createElement('div');
  stageBox.className = 'ch-stage-box';
  const stage = document.createElement('div');
  stage.className = 'ch-stage';
  stageBox.append(stage);

  // Label + key hints share one muted row under the stage, so neither covers
  // the other and neither floats over the artwork.
  const foot = document.createElement('div');
  foot.className = 'ch-foot';
  const stageNote = document.createElement('div');
  stageNote.className = 'ch-stage-note';
  const hint = document.createElement('div');
  hint.className = 'ch-hint';
  hint.textContent = 'Esc to leave · ← → to step · D toggles StyleDNA';
  foot.append(stageNote, hint);
  stageWrap.append(stageBox, foot);

  // ---- StyleDNA ---------------------------------------------------------
  const dnaCol = document.createElement('aside');
  dnaCol.className = 'ch-dna';
  const dnaPre = document.createElement('pre');
  dnaPre.className = 'ch-dna-pre';
  dnaCol.append(dnaPre);

  // ---- filmstrip --------------------------------------------------------
  const strip = document.createElement('div');
  strip.className = 'ch-strip';
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Screens in this comparison');

  root.append(chrome, stageWrap, dnaCol, strip);
  document.body.append(root);

  // ---- state ------------------------------------------------------------
  let entries: ChamberEntry[] = [];
  let index = -1;
  let open = false;
  let armed = false;
  let armFrame = 0;
  let inst: SaverInstance | null = null;
  let mountToken = 0;
  let hideTimer = 0;
  let dnaVisible = true;

  const at = (i: number): ChamberEntry | undefined => entries[i];

  const showChrome = (): void => {
    root.classList.remove('ch-idle');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => root.classList.add('ch-idle'), IDLE_HIDE_MS);
  };

  const disposeInstance = (): void => {
    mountToken += 1;
    if (inst) {
      try {
        inst.dispose();
      } catch (err) {
        console.warn('[chamber] dispose failed:', err);
      }
    }
    inst = null;
    stage.replaceChildren();
  };

  const stageSize = (): { w: number; h: number } => {
    const r = stage.getBoundingClientRect();
    return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
  };

  const show = (i: number): void => {
    const entry = at(i);
    if (!entry) return;
    index = i;
    const { screen } = entry;

    titleEl.textContent = entry.title;
    subEl.textContent = entry.scoreLine ? `${entry.subtitle} · ${entry.scoreLine}` : entry.subtitle;
    posEl.textContent = `${i + 1} / ${entries.length}`;
    dnaPre.textContent = entry.dna;
    stageNote.textContent = screen.spec.label ?? screen.title;
    syncStrip();
    showChrome();

    disposeInstance();
    const token = mountToken;
    const { w, h } = stageSize();
    try {
      const plugin = compileSaver(screen.spec);
      void Promise.resolve(
        plugin.mount({
          host: stage,
          dpr: Math.min(devicePixelRatio || 1, 2),
          width: w,
          height: h,
          rng: createRng((screen.spec.seed ?? 42) >>> 0 || 1),
          seed: screen.spec.seed ?? 42,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        }),
      ).then((mounted) => {
        if (token !== mountToken) {
          mounted.dispose();
          return;
        }
        inst = mounted;
        mounted.setPaused(false);
      });
    } catch (err) {
      stage.textContent = `compile failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    opts.onShow?.(screen.id);
  };

  const step = (delta: number): void => {
    if (!open || entries.length === 0) return;
    show((index + delta + entries.length) % entries.length);
  };

  function syncStrip(): void {
    for (const btn of strip.querySelectorAll<HTMLElement>('.ch-strip-item')) {
      const on = btn.dataset.screenId === at(index)?.screen.id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
      if (on) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  const setDnaVisible = (on: boolean): void => {
    dnaVisible = on;
    root.classList.toggle('ch-no-dna', !on);
    dnaBtn.setAttribute('aria-pressed', String(on));
  };

  // ---- input ------------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault(); // NOT stopPropagation — the engine's idle detector needs this event
      close();
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
      return;
    }
    if (e.key === 'd' || e.key === 'D') {
      setDnaVisible(!dnaVisible);
      return;
    }
    showChrome();
  };

  const onPointerMove = (): void => {
    if (open) showChrome();
  };

  /**
   * Navigating away (browser back, or a top-bar tab) must not leave a
   * fullscreen chamber over another view — the host's router has no handle on
   * this overlay, and a stranded chamber also leaves #topbar inert and the
   * idle screensaver suppressed indefinitely.
   */
  const onHashChange = (): void => close();

  let resizeTimer = 0;
  const onResize = (): void => {
    if (!open) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = 0;
      const { w, h } = stageSize();
      inst?.resize(w, h, Math.min(devicePixelRatio || 1, 2));
    }, 120);
  };

  // ---- lifecycle --------------------------------------------------------
  function close(): void {
    if (!open) return;
    open = false;
    armed = false;
    if (armFrame) cancelAnimationFrame(armFrame);
    if (hideTimer) clearTimeout(hideTimer);
    if (resizeTimer) clearTimeout(resizeTimer);
    hideTimer = 0;
    disposeInstance();

    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointermove', onPointerMove, { capture: true } as EventListenerOptions);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('hashchange', onHashChange);

    root.hidden = true;
    root.classList.remove('ch-idle');
    document.body.classList.remove('ch-open');
    setChromeInert(false);
    index = -1;
    opts.onOpenChange?.(false);
  }

  function openAt(screenId: string): void {
    const i = entries.findIndex((e) => e.screen.id === screenId);
    if (i < 0) return;

    root.hidden = false;
    document.body.classList.add('ch-open');
    setChromeInert(true);

    if (!open) {
      open = true;
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
      window.addEventListener('resize', onResize);
      window.addEventListener('hashchange', onHashChange);
      opts.onOpenChange?.(true);
    }

    // Arm on the second frame so the click that opened the chamber can't also
    // be read as a click inside it.
    armed = false;
    if (armFrame) cancelAnimationFrame(armFrame);
    armFrame = requestAnimationFrame(() => {
      armFrame = requestAnimationFrame(() => {
        armFrame = 0;
        armed = true;
      });
    });

    // The stage needs a laid-out box before the saver can mount at the right size.
    requestAnimationFrame(() => show(i));
  }

  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  closeBtn.addEventListener('click', () => close());
  dnaBtn.addEventListener('click', () => setDnaVisible(!dnaVisible));
  // Guard against the opening gesture reaching a filmstrip button underneath.
  strip.addEventListener('click', (e) => {
    if (!armed) e.stopPropagation();
  });

  return {
    setEntries(next, contextLabel) {
      entries = next;
      contextEl.textContent = contextLabel;
      strip.replaceChildren(
        ...next.map((entry, i) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ch-strip-item';
          btn.dataset.screenId = entry.screen.id;
          btn.setAttribute('role', 'tab');
          btn.innerHTML = `
            <span class="ch-strip-name"></span>
            <span class="ch-strip-sub"></span>`;
          btn.querySelector('.ch-strip-name')!.textContent = entry.title;
          btn.querySelector('.ch-strip-sub')!.textContent = entry.scoreLine ?? entry.subtitle;
          btn.addEventListener('click', () => show(i));
          return btn;
        }),
      );
      if (open) {
        const stillThere = entries.findIndex((e) => e.screen.id === at(index)?.screen.id);
        if (stillThere >= 0) show(stillThere);
        else close();
      }
    },
    open: openAt,
    close,
    isOpen: () => open,
    dispose(): void {
      close();
      root.remove();
    },
  };
}

// ---------------------------------------------------------------------------

/** The chamber covers the app; keep Tab inside it. */
function setChromeInert(on: boolean): void {
  for (const el of document.querySelectorAll<HTMLElement>('#topbar, #view-evals')) el.inert = on;
}

function chamberButton(text: string, title: string, extra?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = ['ch-btn', extra].filter(Boolean).join(' ');
  b.textContent = text;
  b.title = title;
  return b;
}
