/**
 * Gallery view — the browse surface. One card per saver, grouped by the npm
 * package it ships in (same spine as the Dev Tools outliner, so the two tabs
 * agree on how the catalog is organised).
 *
 * Playback is capped by visibility rather than by a global timer: cards that
 * are on screen run, everything else is paused. That keeps the wall of ~33
 * live canvases down to the dozen you can actually see, and it resumes as you
 * scroll instead of leaving a grid of frozen stills.
 */
import { createRng, type SaverInstance, type SaverPlugin } from '@idle-screens/core';
import { readPreviewBackend } from './preview-backend';

/**
 * Logical viewport handed to each saver, and the backing-store size.
 *
 * Savers are authored against a full screen: classic ones use absolute pixel
 * constants (`STAR_COUNT = 520` 1px stars, `RADIUS = 120`), and schema ones
 * scale their entity COUNT by `min(w,h) / referenceViewport`. Mounting at
 * 320×200 therefore broke proportion in both directions at once — warp read
 * 20× too dense, polygons 100× too sparse.
 *
 * The fix costs nothing, because `dpr` is a backing-store multiplier, not a
 * device fact: every saver does `canvas.width = w * dpr; setTransform(dpr,…)`.
 * A dpr BELOW 1 hands the saver the viewport it expects while allocating a
 * card-sized buffer. `min(dpr, 2)` caps the top and never floors it, so this
 * is within the existing contract.
 *
 * Raising CARD_* toward `cssWidth * devicePixelRatio` would sharpen thumbnails
 * on retina at a proportional memory cost; it is deliberately left at the
 * card's CSS size so this change is memory-neutral.
 */
const REF_W = 1280;
const REF_H = 800;
const CARD_W = 320;
/** Cards this far outside the viewport are warmed up before you reach them. */
const PREROLL = '240px';

export interface GalleryGroup {
  id: string;
  /** Full package name, e.g. `@idle-screens/savers-classic`. */
  label: string;
  /** Short label for the section header. */
  short: string;
  savers: SaverPlugin[];
}

export interface GalleryOptions {
  /** Primary action — open the fullscreen preview. */
  onOpen: (id: string) => void;
  /** Secondary action — jump to the workbench with this saver selected. */
  onOpenInDev: (id: string) => void;
  activeId?: string;
}

export interface GalleryHandle {
  /** Mark a card as the engine's current saver. */
  setActive(id: string): void;
  /**
   * Global playback gate. Turned off while the fullscreen preview is up or the
   * tab is hidden; turning it back on restores per-visibility playback.
   */
  setPlaying(on: boolean): void;
}

interface CardRec {
  id: string;
  group: string;
  saver: SaverPlugin;
  el: HTMLElement;
  section: HTMLElement;
  inst: SaverInstance | null;
  visible: boolean;
}

export function buildGallery(mount: HTMLElement, groups: GalleryGroup[], opts: GalleryOptions): GalleryHandle {
  const cards: CardRec[] = [];
  const byId = new Map<string, CardRec>();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let playing = true;
  let query = '';
  let groupFilter = 'all';

  // ---- toolbar -----------------------------------------------------------
  const toolbar = document.createElement('div');
  toolbar.className = 'gal-toolbar';

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'gal-search';
  search.id = 'gallery-search';
  search.placeholder = 'Filter savers…';
  search.setAttribute('aria-label', 'Filter savers by name');

  const chips = document.createElement('div');
  chips.className = 'gal-chips';
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Filter by package');

  const count = document.createElement('span');
  count.className = 'gal-count';

  const chipFor = (id: string, text: string, title: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gal-chip';
    b.dataset.group = id;
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-pressed', String(id === groupFilter));
    b.addEventListener('click', () => {
      groupFilter = id;
      chips.querySelectorAll('.gal-chip').forEach((c) =>
        c.setAttribute('aria-pressed', String((c as HTMLElement).dataset.group === id)),
      );
      applyFilter();
    });
    return b;
  };

  chips.append(
    chipFor('all', 'All', 'Every saver'),
    ...groups.map((g) => chipFor(g.id, g.short, g.label)),
  );

  const hint = document.createElement('span');
  hint.className = 'gal-hint';
  hint.textContent = 'Click a card to preview fullscreen · Esc exits';

  toolbar.append(search, chips, count, hint);

  const body = document.createElement('div');
  body.className = 'gal-body';

  const empty = document.createElement('p');
  empty.className = 'gal-empty';
  empty.hidden = true;
  empty.textContent = 'No savers match that filter.';

  mount.replaceChildren(toolbar, body, empty);

  // ---- sections + cards --------------------------------------------------
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'gal-section';
    section.dataset.group = group.id;

    const head = document.createElement('h2');
    head.className = 'gal-section-head';
    const short = document.createElement('span');
    short.className = 'gal-section-name';
    short.textContent = group.short;
    const pkg = document.createElement('span');
    pkg.className = 'gal-section-pkg';
    pkg.textContent = group.label;
    head.append(short, pkg);

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';

    for (const saver of group.savers) {
      const rec = buildCard(saver, group.id, section, opts);
      grid.append(rec.el);
      cards.push(rec);
      byId.set(rec.id, rec);
    }

    section.append(head, grid);
    body.append(section);
  }

  if (opts.activeId) byId.get(opts.activeId)?.el.classList.add('active');

  // ---- playback gating ---------------------------------------------------
  const sync = (rec: CardRec): void => {
    const on = playing && rec.visible && !document.hidden;
    rec.inst?.setPaused(!on);
    // Mirrored onto the DOM so playback state is assertable from e2e without
    // pixel-diffing canvases.
    rec.el.dataset.playing = String(on && !!rec.inst);
  };
  const syncAll = (): void => {
    for (const rec of cards) sync(rec);
  };

  const io = new IntersectionObserver(
    (records) => {
      for (const r of records) {
        const rec = byId.get((r.target as HTMLElement).dataset.id ?? '');
        if (!rec) continue;
        rec.visible = r.isIntersecting;
        sync(rec);
      }
    },
    // The scroller is #view-gallery, not the document. rootMargin is only
    // applied to the root's own rect — leaving root null would silently make
    // PREROLL a no-op against the real clipping ancestor.
    { root: mount.closest('#view-gallery'), rootMargin: PREROLL, threshold: 0 },
  );
  for (const rec of cards) io.observe(rec.el);

  document.addEventListener('visibilitychange', syncAll);

  /*
   * Cards are uniform width, so one measurement drives every stage's scale.
   * Without this the transform would be a guess that breaks whenever the grid
   * reflows (window resize, filter change, a new saver package landing).
   */
  const syncStageScale = (): void => {
    const first = cards[0]?.el.querySelector('.gallery-card-preview');
    const w = first?.getBoundingClientRect().width ?? 0;
    if (w > 0) mount.style.setProperty('--thumb-scale', String(w / REF_W));
  };
  mount.style.setProperty('--thumb-ref-w', `${REF_W}px`);
  mount.style.setProperty('--thumb-ref-h', `${REF_H}px`);
  syncStageScale();
  if (cards[0]) new ResizeObserver(syncStageScale).observe(cards[0].el);

  // ---- mount every saver -------------------------------------------------
  for (const rec of cards) {
    const preview = rec.el.querySelector('.gallery-card-stage') as HTMLElement;
    const meta = rec.el.querySelector('.gallery-card-backend') as HTMLElement;
    void Promise.resolve(
      rec.saver.mount({
        host: preview,
        // Backing store stays card-sized; the saver still thinks it has a
        // REF_W×REF_H stage, so its absolute sizes and entity counts land in
        // the same proportion they would on a real screen.
        dpr: CARD_W / REF_W,
        width: REF_W,
        height: REF_H,
        rng: createRng(42),
        seed: 42,
        reducedMotion,
      }),
    )
      .then((inst) => {
        rec.inst = inst;
        sync(rec);
        const min = rec.saver.manifest.minBackend ?? 'css';
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const active = readPreviewBackend(rec.id, preview);
            meta.textContent = active && active !== min ? active : min;
          }),
        );
      })
      .catch((err) => {
        console.warn(`[gallery] ${rec.id} failed to mount:`, err);
        rec.el.classList.add('failed');
      });
  }

  // Reduced motion: honour the old behaviour — show a settled frame, then stop.
  if (reducedMotion) {
    setTimeout(() => {
      playing = false;
      syncAll();
    }, 2000);
  }

  // ---- filtering ---------------------------------------------------------
  function applyFilter(): void {
    const q = query.trim().toLowerCase();
    let shown = 0;
    // The All view is one dense wall (see CSS): section headers only earn
    // their row breaks once a package chip narrows the field.
    body.dataset.filter = groupFilter;
    for (const rec of cards) {
      const m = rec.saver.manifest;
      const hit =
        (groupFilter === 'all' || rec.group === groupFilter) &&
        (q === '' || m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
      rec.el.hidden = !hit;
      if (hit) shown += 1;
    }
    for (const section of body.querySelectorAll<HTMLElement>('.gal-section')) {
      const any = section.querySelector('.gallery-card:not([hidden])');
      section.hidden = !any;
    }
    empty.hidden = shown > 0;
    count.textContent = shown === cards.length ? `${cards.length} savers` : `${shown} of ${cards.length}`;
  }

  search.addEventListener('input', () => {
    query = search.value;
    applyFilter();
  });
  applyFilter();

  return {
    setActive(id) {
      for (const rec of cards) rec.el.classList.toggle('active', rec.id === id);
    },
    setPlaying(on) {
      playing = on;
      syncAll();
    },
  };
}

// ---------------------------------------------------------------------------

function buildCard(
  saver: SaverPlugin,
  group: string,
  section: HTMLElement,
  opts: GalleryOptions,
): CardRec {
  const m = saver.manifest;

  // <article> rather than <button>: the card has two actions (preview, inspect)
  // and nesting a button inside a button is invalid.
  const el = document.createElement('article');
  el.className = 'gallery-card';
  el.dataset.id = m.id;

  const preview = document.createElement('div');
  preview.className = 'gallery-card-preview';

  /*
   * The stage is a real REF_W×REF_H box, visually shrunk with a CSS transform.
   *
   * `dpr` fixes proportion for canvas savers, but CSS/DOM savers have no
   * backing store — they position elements with absolute pixel styles
   * (`.fish { width: 145px }`), so a 145px fish filled half a 289px card no
   * matter what viewport we claimed. Scaling the whole stage is the DOM
   * equivalent of the dpr trick: elements lay out against the viewport they
   * were authored for, then the transform renders them card-sized. Costs
   * nothing — a transform is compositor work, not extra pixels.
   */
  const stage = document.createElement('div');
  stage.className = 'gallery-card-stage';
  preview.append(stage);

  // Full-bleed hit target over the canvas = the primary action, and it is a
  // real <button>, so it is tabbable and fires on Enter/Space for free.
  const hit = document.createElement('button');
  hit.type = 'button';
  hit.className = 'gallery-card-hit';
  hit.setAttribute('aria-label', `Preview ${m.label} fullscreen`);
  hit.addEventListener('click', () => opts.onOpen(m.id));
  preview.append(hit);

  const info = document.createElement('div');
  info.className = 'gallery-card-info';

  const label = document.createElement('span');
  label.className = 'gallery-card-label';
  label.textContent = m.label;

  const tags = document.createElement('span');
  tags.className = 'gallery-card-tags';
  if (m.passthrough) tags.append(tag('PT', 'Passthrough — renders over the live page'));
  if (m.workerReady) tags.append(tag('W', 'Worker-ready (OffscreenCanvas)'));

  const backend = document.createElement('span');
  backend.className = 'gallery-card-meta gallery-card-backend';
  backend.textContent = m.minBackend ?? 'css';
  backend.title = 'Rendering backend';

  const dev = document.createElement('button');
  dev.type = 'button';
  dev.className = 'gallery-card-dev';
  dev.textContent = '↗';
  dev.title = `Inspect ${m.label} in Dev Tools`;
  dev.setAttribute('aria-label', `Inspect ${m.label} in Dev Tools`);
  dev.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.onOpenInDev(m.id);
  });

  info.append(label, tags, backend, dev);
  el.append(preview, info);

  return { id: m.id, group, saver, el, section, inst: null, visible: false };
}

function tag(text: string, title: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'gallery-card-tag';
  s.textContent = text;
  s.title = title;
  return s;
}
