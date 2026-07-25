/**
 * The Evals inspector — the right-hand column that turns a picture into a
 * legible experiment.
 *
 * The panel used to show StyleDNA prose and, only after you pressed "Run
 * suite", five terse numbers. That reads as "here is some art" rather than
 * "here is a test and its result". Scoring is pure and cheap (validate +
 * advise + perceive, no rendering), so everything here recomputes on selection:
 *
 *   Test        the hypothesis, the rubric, and each check's actual vs expected
 *   Score       the headline number decomposed into its weighted terms
 *   Perception  what a non-vision agent actually sees — braille map, dominance,
 *               motion, advisories. This is the signal the scores are built on,
 *               so it should be inspectable, not implicit.
 *   StyleDNA    the durable artist profile
 *
 * Every tab is exportable as JSON: one screen's inspection is one labelled
 * training example.
 */
import { inspectScreen, type ScoreTerm, type ScreenInspection } from './score';
import type { ArtistStyleProfile, EvalScreen } from './types';

type Tab = 'test' | 'score' | 'perception' | 'dna';

export interface InspectorHandle {
  /** Show a screen, or clear the panel when null. */
  setScreen(screen: EvalScreen | null, profile: ArtistStyleProfile | null): void;
  /** The inspection currently on screen, for export. */
  current(): { screen: EvalScreen; inspection: ScreenInspection } | null;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'test', label: 'Test' },
  { id: 'score', label: 'Score' },
  { id: 'perception', label: 'Perception' },
  { id: 'dna', label: 'StyleDNA' },
];

export function buildInspector(
  mount: HTMLElement,
  opts: { dnaText: (artistId: string) => string; onExport: (screen: EvalScreen, inspection: ScreenInspection) => void },
): InspectorHandle {
  let tab: Tab = 'test';
  let screen: EvalScreen | null = null;
  let inspection: ScreenInspection | null = null;

  const tabsEl = document.createElement('div');
  tabsEl.className = 'insp-tabs';
  tabsEl.setAttribute('role', 'tablist');
  for (const t of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'insp-tab';
    b.dataset.tab = t.id;
    b.textContent = t.label;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = t.id;
      render();
    });
    tabsEl.append(b);
  }

  const bodyEl = document.createElement('div');
  bodyEl.className = 'insp-body';

  const footEl = document.createElement('div');
  footEl.className = 'insp-foot';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'evals-btn secondary';
  exportBtn.textContent = 'Export example';
  exportBtn.title = 'Download this screen as one labelled JSON training example';
  exportBtn.addEventListener('click', () => {
    if (screen && inspection) opts.onExport(screen, inspection);
  });
  footEl.append(exportBtn);

  mount.replaceChildren(tabsEl, bodyEl, footEl);

  function render(): void {
    for (const b of tabsEl.querySelectorAll<HTMLElement>('.insp-tab')) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    exportBtn.disabled = !inspection;

    if (!screen || !inspection) {
      bodyEl.innerHTML = '<p class="insp-empty">Select a screen to inspect its test, score and perception.</p>';
      return;
    }
    if (tab === 'test') bodyEl.replaceChildren(renderTest(screen, inspection));
    else if (tab === 'score') bodyEl.replaceChildren(renderScore(inspection));
    else if (tab === 'perception') bodyEl.replaceChildren(renderPerception(inspection));
    else bodyEl.replaceChildren(renderDna(opts.dnaText(screen.artistId)));
  }

  return {
    setScreen(next, nextProfile) {
      screen = next;
      inspection = next && nextProfile ? safeInspect(next, nextProfile) : null;
      render();
    },
    current: () => (screen && inspection ? { screen, inspection } : null),
  };
}

function safeInspect(screen: EvalScreen, profile: ArtistStyleProfile): ScreenInspection | null {
  try {
    return inspectScreen(screen, profile);
  } catch (err) {
    console.warn('[evals] inspection failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// tabs

function renderTest(screen: EvalScreen, insp: ScreenInspection): DocumentFragment {
  const frag = document.createDocumentFragment();
  const isSignature = screen.kind === 'signature';

  frag.append(
    section(
      isSignature ? 'Signature prompt' : 'Hypothesis',
      para(insp.intent?.intent ?? screen.intent),
      kvRow('Screen', screen.title),
      kvRow('Kind', isSignature ? 'signature — artist-owned' : 'benchmark — shared across all artists'),
      kvRow('Recipe', screen.recipe),
      kvRow('Seed', String(screen.spec.seed ?? 42)),
    ),
  );

  if (isSignature) {
    frag.append(
      section(
        'Rubric',
        note(
          'Signature screens carry no shared rubric — intent-fit is 1.0 by definition. ' +
            'They exist to show what the style does when it is not constrained by a common prompt.',
        ),
      ),
    );
  } else if (insp.intentTerms.length) {
    frag.append(section('Rubric — what this benchmark checks', termTable(insp.intentTerms, false)));
  }

  if (insp.score.validationErrors.length) {
    frag.append(
      section(
        'Validation errors',
        list(insp.score.validationErrors, 'insp-bad'),
      ),
    );
  }
  return frag;
}

function renderScore(insp: ScreenInspection): DocumentFragment {
  const frag = document.createDocumentFragment();
  const s = insp.score;

  const headline = document.createElement('div');
  headline.className = 'insp-headline';
  headline.innerHTML = `<span class="insp-score ${toneFor(s.score)}"></span><span class="insp-score-of">/ 1.000</span>`;
  headline.querySelector('.insp-score')!.textContent = s.score.toFixed(3);
  frag.append(headline);

  frag.append(
    section(
      'How this number is built',
      termTable(insp.topTerms, true),
      formula(
        `score = (${insp.topTerms.map((t) => `${t.weight}×${t.value.toFixed(2)}`).join(' + ')})` +
          (s.advisoryPenalty > 0 ? ` × (1 − ${s.advisoryPenalty.toFixed(2)} advisory penalty)` : '') +
          ` = ${s.score.toFixed(3)}`,
      ),
    ),
  );

  frag.append(section('Style fit — 0.35 of the score', termTable(insp.styleTerms, true)));

  if (insp.intentTerms.length) {
    frag.append(section('Intent fit — 0.30 of the score', termTable(insp.intentTerms, false)));
  }

  if (s.notes.length) frag.append(section('Notes', list(s.notes, 'insp-warn')));
  return frag;
}

function renderPerception(insp: ScreenInspection): DocumentFragment {
  const frag = document.createDocumentFragment();
  const { scene, score } = insp;

  const pic = document.createElement('pre');
  pic.className = 'insp-braille';
  pic.textContent = scene.braille;
  frag.append(
    section(
      'What the agent sees',
      note(`Braille luminance map at t=${scene.t}ms — each character is a 2×4 pixel cell.`),
      pic,
    ),
  );

  frag.append(
    section(
      'Signal',
      kvRow('Coverage', `${(scene.coverage * 100).toFixed(2)}%`),
      kvRow('Mean luminance', scene.meanLuminance.toFixed(3)),
      kvRow(
        'Centroid',
        scene.centroid ? `${scene.centroid.x.toFixed(2)}, ${scene.centroid.y.toFixed(2)}` : '— (blank)',
      ),
      kvRow('Layers', String(score.perception.layerCount)),
      kvRow('Entities', String(score.perception.entityCount)),
    ),
  );

  if (scene.dominance.length) {
    frag.append(
      section(
        'Dominance — which layer owns the frame',
        bars(
          scene.dominance.map((d) => ({
            label: d.key ?? `layer ${d.layerIndex}`,
            value: d.share,
          })),
        ),
      ),
    );
  }

  if (scene.motion.length) {
    const rows = scene.motion.map((m) => [
      m.key ?? `layer ${m.layerIndex}`,
      m.moving ? 'moving' : 'static',
      `${m.meanSpeed.toFixed(1)} / ${m.maxSpeed.toFixed(1)}`,
    ]);
    frag.append(section('Motion — px per second', table(['layer', 'state', 'mean / max'], rows)));
  }

  if (scene.text.length) {
    frag.append(
      section(
        'Text on screen',
        note('Glyphs are invisible in the luminance maps, so they are listed separately.'),
        list(scene.text.map((t) => `${t.strings.map((s) => `“${s}”`).join(', ')} — ×${t.count} @ ${Math.round(t.sizePx)}px`)),
      ),
    );
  }

  frag.append(
    scene.advisories.length
      ? section(
          `Advisories (${scene.advisories.length})`,
          list(scene.advisories.map((a) => `${a.code}: ${a.message}`), 'insp-warn'),
        )
      : section('Advisories', note('None — the spec raised no warnings.')),
  );
  return frag;
}

function renderDna(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const pre = document.createElement('pre');
  pre.className = 'insp-dna';
  pre.textContent = text;
  frag.append(pre);
  return frag;
}

// ---------------------------------------------------------------------------
// primitives

function section(title: string, ...children: Node[]): HTMLElement {
  const el = document.createElement('section');
  el.className = 'insp-section';
  const h = document.createElement('h3');
  h.className = 'insp-section-title';
  h.textContent = title;
  el.append(h, ...children);
  return el;
}

function para(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'insp-lead';
  p.textContent = text;
  return p;
}

function note(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'insp-note';
  p.textContent = text;
  return p;
}

function formula(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'insp-formula';
  p.textContent = text;
  return p;
}

function kvRow(k: string, v: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'insp-kv';
  const kEl = document.createElement('span');
  kEl.className = 'insp-k';
  kEl.textContent = k;
  const vEl = document.createElement('span');
  vEl.className = 'insp-v';
  vEl.textContent = v;
  row.append(kEl, vEl);
  return row;
}

function list(items: string[], tone?: string): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = ['insp-list', tone].filter(Boolean).join(' ');
  for (const i of items) {
    const li = document.createElement('li');
    li.textContent = i;
    ul.append(li);
  }
  return ul;
}

function table(headers: string[], rows: string[][]): HTMLElement {
  const t = document.createElement('table');
  t.className = 'insp-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    htr.append(th);
  }
  thead.append(htr);
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const c of r) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.append(td);
    }
    tbody.append(tr);
  }
  t.append(thead, tbody);
  return t;
}

/** Each rubric row: what was wanted, what was measured, and the verdict. */
function termTable(terms: ScoreTerm[], showWeight: boolean): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'insp-terms';
  for (const t of terms) {
    const row = document.createElement('div');
    row.className = 'insp-term';

    const head = document.createElement('div');
    head.className = 'insp-term-head';
    const name = document.createElement('span');
    name.className = 'insp-term-name';
    name.textContent = showWeight ? `${t.label} · ×${t.weight}` : t.label;
    const verdict = document.createElement('span');
    verdict.className = `insp-verdict ${verdictTone(t.value)}`;
    verdict.textContent = verdictLabel(t.value);
    head.append(name, verdict);

    const meter = document.createElement('div');
    meter.className = 'insp-meter';
    const fill = document.createElement('span');
    fill.className = `insp-meter-fill ${verdictTone(t.value)}`;
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, t.value)) * 100)}%`;
    meter.append(fill);

    const detail = document.createElement('div');
    detail.className = 'insp-term-detail';
    const got = document.createElement('span');
    got.textContent = `measured ${t.actual}`;
    const want = document.createElement('span');
    want.className = 'insp-want';
    want.textContent = `wanted ${t.expected}`;
    detail.append(got, want);

    row.append(head, meter, detail);
    wrap.append(row);
  }
  return wrap;
}

function bars(items: Array<{ label: string; value: number }>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'insp-bars';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'insp-bar-row';
    const label = document.createElement('span');
    label.className = 'insp-bar-label';
    label.textContent = it.label;
    const track = document.createElement('span');
    track.className = 'insp-bar-track';
    const fill = document.createElement('span');
    fill.className = 'insp-bar-fill';
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, it.value)) * 100)}%`;
    track.append(fill);
    const val = document.createElement('span');
    val.className = 'insp-bar-val';
    val.textContent = `${(it.value * 100).toFixed(0)}%`;
    row.append(label, track, val);
    wrap.append(row);
  }
  return wrap;
}

function verdictLabel(v: number): string {
  if (v >= 0.999) return 'pass';
  if (v >= 0.5) return 'partial';
  return 'fail';
}

function verdictTone(v: number): string {
  if (v >= 0.999) return 'is-pass';
  if (v >= 0.5) return 'is-partial';
  return 'is-fail';
}

function toneFor(score: number): string {
  if (score >= 0.7) return 'is-pass';
  if (score >= 0.45) return 'is-partial';
  return 'is-fail';
}
