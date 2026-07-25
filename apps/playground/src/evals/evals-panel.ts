import { createRng, type SaverInstance } from '@idle-screens/core';
import { compileSaver } from '@idle-screens/schema';
import { getCatalog } from './catalog';
import { scoreSuite } from './score';
import type { EvalScreen, RunSummary, ScreenScore } from './types';

export interface EvalsPanelHandle {
  dispose(): void;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function gapsMarkdown(summary: RunSummary): string {
  const lines = [
    `# Gaps — ${summary.runId}`,
    '',
    `Suite median: **${summary.suiteMedian.toFixed(3)}**`,
    '',
    '## Next cycle',
    `- Weak artists: ${summary.nextCycle.weakArtists.join(', ') || '(none)'}`,
    `- Collapsed benchmarks: ${summary.nextCycle.collapsedBenchmarks.join(', ') || '(none)'}`,
    '',
    '## Top schema gaps',
    ...summary.nextCycle.topGaps.map((g, i) => `${i + 1}. ${g}`),
    '',
    '## Failures',
    ...(summary.failures.length
      ? summary.failures.map((f) => `- \`${f.screenId}\`: ${f.reason}`)
      : ['- (none)']),
  ];
  return lines.join('\n');
}

/** Mount the Evals workbench into #view-evals. */
export function buildEvalsPanel(mount: HTMLElement): EvalsPanelHandle {
  const catalog = getCatalog();
  let artistId = catalog.artists[0]?.id ?? 'monet';
  let screen: EvalScreen | null = null;
  let preview: SaverInstance | null = null;
  let lastResults: ScreenScore[] | null = null;
  let lastSummary: RunSummary | null = null;

  mount.innerHTML = `
    <div class="evals-shell">
      <aside class="evals-artists" aria-label="Artists"></aside>
      <section class="evals-main">
        <header class="evals-toolbar">
          <div class="evals-toolbar-meta">
            <h1 class="evals-title">Style Evals</h1>
            <p class="evals-sub">15 artists × 5 benchmarks × 5 signatures — StyleDNA as durable objects</p>
          </div>
          <div class="evals-toolbar-actions">
            <button type="button" class="evals-btn" data-act="run">Run suite</button>
            <button type="button" class="evals-btn secondary" data-act="export" disabled>Export run</button>
          </div>
        </header>
        <div class="evals-body">
          <div class="evals-screens">
            <div class="evals-section-label">Benchmarks <span class="evals-hint">(shared intents)</span></div>
            <div class="evals-grid" data-kind="benchmark"></div>
            <div class="evals-section-label">Signatures <span class="evals-hint">(artist-owned)</span></div>
            <div class="evals-grid" data-kind="signature"></div>
          </div>
          <div class="evals-preview-col">
            <div class="evals-preview" id="evals-preview-host">
              <span class="evals-preview-label">Select a screen</span>
            </div>
            <div class="evals-scorecard" hidden></div>
          </div>
          <div class="evals-dna">
            <div class="evals-section-label">StyleDNA</div>
            <pre class="evals-dna-pre"></pre>
          </div>
        </div>
        <div class="evals-runlog" hidden>
          <div class="evals-section-label">Last run</div>
          <pre class="evals-runlog-pre"></pre>
        </div>
      </section>
    </div>
  `;

  const artistsEl = mount.querySelector('.evals-artists') as HTMLElement;
  const benchGrid = mount.querySelector('.evals-grid[data-kind="benchmark"]') as HTMLElement;
  const sigGrid = mount.querySelector('.evals-grid[data-kind="signature"]') as HTMLElement;
  const previewHost = mount.querySelector('#evals-preview-host') as HTMLElement;
  const dnaPre = mount.querySelector('.evals-dna-pre') as HTMLElement;
  const scorecard = mount.querySelector('.evals-scorecard') as HTMLElement;
  const runlog = mount.querySelector('.evals-runlog') as HTMLElement;
  const runlogPre = mount.querySelector('.evals-runlog-pre') as HTMLElement;
  const exportBtn = mount.querySelector('[data-act="export"]') as HTMLButtonElement;

  const disposePreview = (): void => {
    if (preview) {
      preview.dispose();
      preview = null;
    }
    previewHost.querySelectorAll(':scope > :not(.evals-preview-label)').forEach((n) => n.remove());
  };

  const showDna = (): void => {
    const a = catalog.artists.find((x) => x.id === artistId);
    if (!a) return;
    dnaPre.textContent = [
      `${a.artist} — ${a.movement} (${a.years})`,
      '',
      a.research.thesis,
      '',
      'Principles:',
      ...a.research.visualPrinciples.map((p) => `• ${p}`),
      '',
      'Anti-patterns:',
      ...a.research.antiPatterns.map((p) => `• ${p}`),
      '',
      `Tempo: ${a.research.tempo} · Depth: ${a.research.depth}`,
      `Sprites: ${a.markMaking.primarySprites.join(', ')}`,
      `Motions: ${a.motionDialect.preferred.join(', ')}`,
      `Blend: ${a.markMaking.blend} · Density×${a.composition.densityScale}`,
      '',
      'Durable keys:',
      ...a.durableKeys.map((k) => `• ${k}`),
      '',
      'Schema gaps:',
      ...a.schemaGaps.map((g) => `• ${g}`),
    ].join('\n');
  };

  const mountPreview = (s: EvalScreen): void => {
    disposePreview();
    screen = s;
    const label = previewHost.querySelector('.evals-preview-label') as HTMLElement | null;
    if (label) label.textContent = s.spec.label;
    try {
      const plugin = compileSaver(s.spec);
      const rect = previewHost.getBoundingClientRect();
      void Promise.resolve(
        plugin.mount({
          host: previewHost,
          dpr: devicePixelRatio || 1,
          width: Math.round(rect.width) || 640,
          height: Math.round(rect.height) || 360,
          rng: createRng((s.spec.seed ?? 42) >>> 0 || 1),
          seed: s.spec.seed ?? 42,
          reducedMotion: false,
        }),
      ).then((inst) => {
        preview = inst;
        inst.setPaused(false);
      });
    } catch (err) {
      if (label) label.textContent = `compile failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    const scored = lastResults?.find((r) => r.screenId === s.id);
    if (scored) {
      scorecard.hidden = false;
      scorecard.innerHTML = [
        `<div><b>score</b> ${scored.score.toFixed(3)}</div>`,
        `<div><b>style-fit</b> ${scored.styleFit.toFixed(3)}</div>`,
        `<div><b>intent-fit</b> ${scored.intentFit.toFixed(3)}</div>`,
        `<div><b>coverage</b> ${pct(scored.perception.coverage)}</div>`,
        `<div><b>valid</b> ${scored.valid ? 'yes' : 'no'}</div>`,
        scored.notes.length ? `<div class="evals-notes">${scored.notes.join(' · ')}</div>` : '',
      ].join('');
    } else {
      scorecard.hidden = true;
      scorecard.innerHTML = '';
    }
  };

  const renderScreens = (): void => {
    const list = catalog.screensByArtist.get(artistId) ?? [];
    const fill = (el: HTMLElement, kind: 'benchmark' | 'signature'): void => {
      el.replaceChildren();
      for (const s of list.filter((x) => x.kind === kind)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'evals-card';
        if (screen?.id === s.id) btn.classList.add('active');
        const scored = lastResults?.find((r) => r.screenId === s.id);
        btn.innerHTML = `
          <span class="evals-card-title">${s.title}</span>
          <span class="evals-card-meta">${s.recipe}${scored ? ` · ${scored.score.toFixed(2)}` : ''}</span>
        `;
        btn.addEventListener('click', () => {
          el.parentElement
            ?.querySelectorAll('.evals-card')
            .forEach((c) => c.classList.remove('active'));
          mount.querySelectorAll('.evals-card').forEach((c) => c.classList.remove('active'));
          btn.classList.add('active');
          mountPreview(s);
        });
        el.append(btn);
      }
    };
    fill(benchGrid, 'benchmark');
    fill(sigGrid, 'signature');
    const first = list[0];
    if (first && (!screen || screen.artistId !== artistId)) mountPreview(first);
    showDna();
  };

  for (const a of catalog.artists) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'evals-artist';
    btn.dataset.id = a.id;
    if (a.id === artistId) btn.classList.add('active');
    btn.innerHTML = `<span class="evals-artist-name">${a.artist}</span><span class="evals-artist-move">${a.movement}</span>`;
    btn.addEventListener('click', () => {
      artistId = a.id;
      artistsEl.querySelectorAll('.evals-artist').forEach((b) => {
        b.classList.toggle('active', (b as HTMLElement).dataset.id === artistId);
      });
      renderScreens();
    });
    artistsEl.append(btn);
  }

  mount.querySelector('[data-act="run"]')?.addEventListener('click', () => {
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}-playground`;
    const { results, summary } = scoreSuite(catalog.screens, catalog.artists, runId);
    lastResults = results;
    lastSummary = summary;
    exportBtn.disabled = false;
    runlog.hidden = false;
    runlogPre.textContent = [
      `runId: ${summary.runId}`,
      `suiteMedian: ${summary.suiteMedian.toFixed(3)}`,
      `screens: ${results.length} (invalid: ${results.filter((r) => !r.valid).length})`,
      '',
      'perArtist median:',
      ...summary.perArtist.map((a) => `  ${a.artistId.padEnd(12)} ${a.median.toFixed(3)}`),
      '',
      'perBenchmark:',
      ...summary.perBenchmark.map(
        (b) => `  ${b.benchmarkId.padEnd(18)} med=${b.median.toFixed(3)} var=${b.variance.toFixed(4)}`,
      ),
      '',
      'nextCycle.weakArtists: ' + (summary.nextCycle.weakArtists.join(', ') || '(none)'),
      'nextCycle.collapsedBenchmarks: ' + (summary.nextCycle.collapsedBenchmarks.join(', ') || '(none)'),
      '',
      'topGaps:',
      ...summary.nextCycle.topGaps.map((g) => `  • ${g}`),
    ].join('\n');
    renderScreens();
  });

  exportBtn.addEventListener('click', () => {
    if (!lastSummary || !lastResults) return;
    downloadJson(`${lastSummary.runId}-summary.json`, lastSummary);
    downloadJson(`${lastSummary.runId}-results.json`, lastResults);
    const blob = new Blob([gapsMarkdown(lastSummary)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lastSummary.runId}-gaps.md`;
    a.click();
    URL.revokeObjectURL(url);
  });

  renderScreens();

  return {
    dispose(): void {
      disposePreview();
      mount.replaceChildren();
    },
  };
}
