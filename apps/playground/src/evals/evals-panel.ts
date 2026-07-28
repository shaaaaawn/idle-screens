import { createRng, type SaverInstance } from '@idle-screens/core';
import { compileSaver } from '@idle-screens/schema';
import { bridgeAgentRunToTimeline } from './agent-bridge';
import { runAgentEvalInteractive } from './agent-panel';
import { getCatalog } from './catalog';
import { createChamber, type ChamberEntry } from './chamber';
import { buildInspector } from './inspector';
import { hasKey } from './openrouter';
import {
  buildProvenance,
  compareVersions,
  driftedScreens,
  fingerprintScreens,
} from './provenance';
import { listRuns, loadRun, saveBrowserRun } from './run-store';
import {
  authoredCountByArtist,
  type EvidenceMode,
  screensForArtistRun,
  screensForCompareRun,
} from './screens-view';
import {
  buildRunTimeline,
  promptRunRequest,
  type RunTimelineHandle,
  type ScreenDrift,
} from './run-timeline';
import { scoreSuite } from './score';
import type { BenchmarkIntent, EvalScreen, RunSummary, ScreenScore } from './types';

declare global {
  interface Window {
    __evalsCatalog?: ReturnType<typeof getCatalog>;
  }
}

export interface EvalsPanelHandle {
  dispose(): void;
}

export interface EvalsPanelOptions {
  /**
   * Called when the chamber takes over the screen. The host uses it to suppress
   * the idle screensaver, which would otherwise drop a saver over the artwork
   * after the idle timeout.
   */
  onFullscreenChange?: (open: boolean) => void;
}

/** Two lenses on the active evidence set — Gallery was retired (collided with playground Gallery). */
type ViewMode = 'compare' | 'artist';

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
  const p = summary.provenance;
  const lines = [
    `# Gaps — ${summary.runId}`,
    '',
    `Label: **${p.label}** · Median **${summary.suiteMedian.toFixed(3)}**`,
    `Harness: \`${p.harness}\`` + (p.model ? ` · Model: \`${p.model.name}\`` : ''),
    `StyleDNA: \`${p.versions.styleDnaLabel}\` · \`${p.versions.styleDnaHash}\``,
    `Scorer: \`${p.versions.scorer}\` · Skill: \`${p.versions.skill}\``,
    p.note ? `\nNote: ${p.note}\n` : '',
    '',
    '## Next cycle actions',
    ...summary.nextCycle.suggestedActions.map((a, i) => `${i + 1}. ${a}`),
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

/** The benchmark's checks as readable chips — the test, stated up front. */
function describeChecks(c: BenchmarkIntent['checks']): string[] {
  const out: string[] = [];
  if (c.minLayers != null) out.push(`≥ ${c.minLayers} layers`);
  if (c.maxLayers != null) out.push(`≤ ${c.maxLayers} layers`);
  if (c.minCoverage != null) out.push(`coverage ≥ ${(c.minCoverage * 100).toFixed(1)}%`);
  if (c.maxCoverage != null) out.push(`coverage ≤ ${(c.maxCoverage * 100).toFixed(1)}%`);
  if (c.requirePulse) out.push('pulse required');
  if (c.requireSpeedSeparation) out.push('speed separation ≥ 1.6×');
  if (c.requireFocalDominance) out.push('focal dominance ≥ 28%');
  return out;
}

function dnaText(artistId: string, catalog: ReturnType<typeof getCatalog>): string {
  const a = catalog.artists.find((x) => x.id === artistId);
  if (!a) return '';
  return [
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
}

/** Mount the Evals workbench into #view-evals. */
export function buildEvalsPanel(mount: HTMLElement, opts: EvalsPanelOptions = {}): EvalsPanelHandle {
  const catalog = getCatalog();
  // Debug hook, in the same spirit as core's `window.__idleScreens`. e2e needs
  // the catalog to synthesize a run, and reaching it via `import('/src/…')`
  // means a live Vite transform mid-test — which fails under CI dep
  // re-optimization ("Failed to fetch dynamically imported module") in a way
  // retries don't absorb. The panel already holds the catalog; hand it over.
  window.__evalsCatalog = catalog;
  let mode: ViewMode = 'compare';
  let artistId = catalog.artists[0]?.id ?? 'monet';
  let benchmarkId = catalog.benchmarks[0]?.id ?? 'calm-horizon';
  let screen: EvalScreen | null = null;
  const compareByScreen = new Map<string, SaverInstance>();
  let lastResults: ScreenScore[] | null = null;
  let lastSummary: RunSummary | null = null;
  /** Model-authored screens from the selected agent run (null = catalog / rescore). */
  let activeScreens: EvalScreen[] | null = null;
  /** Catalog = full DNA wall; Run = only authored evidence from the selected run. */
  let evidenceMode: EvidenceMode = 'catalog';
  /** Only this tile + the selection keep a live rAF loop; everything else is a still. */
  let hoveredTile: string | null = null;
  let gridLive = true;
  /** Which screens changed since the selected run scored them (null = no run). */
  let screenDrift: ScreenDrift | null = null;

  mount.innerHTML = `
    <div class="evals-shell">
      <aside class="evals-nav" aria-label="Eval navigation">
        <div class="evals-mode">
          <button type="button" class="evals-mode-btn active" data-mode="compare">Cross-artist</button>
          <button type="button" class="evals-mode-btn" data-mode="artist">By artist</button>
        </div>
        <div class="evals-nav-list" data-nav="compare"></div>
        <div class="evals-nav-list" data-nav="artist" hidden></div>
      </aside>
      <section class="evals-main">
        <div class="evals-timeline-host" data-role="timeline"></div>
        <div class="evals-hero" data-role="hero" hidden></div>
        <header class="evals-toolbar">
          <div class="evals-toolbar-meta">
            <h1 class="evals-title">Style Evals</h1>
            <p class="evals-sub" data-role="subtitle">Same benchmark × every artist — contrast StyleDNA side by side</p>
          </div>
          <div class="evals-toolbar-actions">
            <div class="evals-evidence" data-role="evidence" role="group" aria-label="Evidence source">
              <button type="button" class="evals-evidence-btn active" data-evidence="catalog">Catalog</button>
              <button type="button" class="evals-evidence-btn" data-evidence="run" disabled title="Select an agent run with authored screens">This run</button>
            </div>
            <button type="button" class="evals-btn" data-act="chamber">Enter chamber</button>
            <button type="button" class="evals-btn secondary" data-act="export" disabled>Export pack</button>
          </div>
        </header>

        <div class="evals-body">
          <div class="evals-compare-wrap">
            <div class="evals-intent" data-role="intent"></div>
            <div class="evals-compare-grid" data-role="compare-grid"></div>
          </div>
          <aside class="evals-inspect" data-role="inspector"></aside>
        </div>
      </section>
    </div>
  `;

  const compareNav = mount.querySelector('[data-nav="compare"]') as HTMLElement;
  const artistNav = mount.querySelector('[data-nav="artist"]') as HTMLElement;
  const compareGrid = mount.querySelector('[data-role="compare-grid"]') as HTMLElement;
  const intentEl = mount.querySelector('[data-role="intent"]') as HTMLElement;
  const subtitleEl = mount.querySelector('[data-role="subtitle"]') as HTMLElement;
  const heroEl = mount.querySelector('[data-role="hero"]') as HTMLElement;
  const timelineHost = mount.querySelector('[data-role="timeline"]') as HTMLElement;
  const exportBtn = mount.querySelector('[data-act="export"]') as HTMLButtonElement;
  const evidenceBtns = [...mount.querySelectorAll<HTMLButtonElement>('.evals-evidence-btn')];

  const syncEvidenceChrome = (): void => {
    const hasAuthored = !!activeScreens?.length;
    for (const btn of evidenceBtns) {
      const id = btn.dataset.evidence as EvidenceMode;
      btn.classList.toggle('active', id === evidenceMode);
      if (id === 'run') {
        btn.disabled = !hasAuthored;
        btn.title = hasAuthored
          ? 'Show only screens this run authored'
          : 'Select an agent run with authored screens';
      }
    }
  };

  const paintHero = (): void => {
    if (!lastSummary) {
      heroEl.hidden = true;
      heroEl.replaceChildren();
      return;
    }
    heroEl.hidden = false;
    const p = lastSummary.provenance;
    const authoredN = activeScreens?.length ?? 0;
    const scoredN = lastResults?.length ?? 0;
    const validN = lastResults?.filter((r) => r.valid).length ?? 0;
    const delta = lastSummary.delta;
    const deltaTxt =
      delta != null
        ? `${delta.suiteMedianDelta >= 0 ? '+' : ''}${delta.suiteMedianDelta.toFixed(3)} vs prior`
        : 'root run';
    const gaps = lastSummary.nextCycle.topGaps.slice(0, 2);
    heroEl.innerHTML = `
      <div class="evals-hero-main">
        <div class="evals-hero-label">${escapeHtml(p.label)}</div>
        <div class="evals-hero-median">${lastSummary.suiteMedian.toFixed(3)}</div>
        <div class="evals-hero-delta">${escapeHtml(deltaTxt)}</div>
      </div>
      <div class="evals-hero-stats">
        <span><b>${p.harness === 'agent-loop' ? authoredN : scoredN}</b> ${p.harness === 'agent-loop' ? 'authored' : 'scored'}</span>
        <span><b>${validN}</b> valid</span>
        ${p.model ? `<span class="evals-hero-model">${escapeHtml(p.model.name)}</span>` : ''}
        <span class="evals-hero-dna" title="StyleDNA hash">dna:${escapeHtml(p.versions.styleDnaHash.slice(0, 8))}</span>
      </div>
      <div class="evals-hero-gaps" data-role="hero-gaps"></div>
    `;
    const gapsHost = heroEl.querySelector('[data-role="hero-gaps"]')!;
    if (gaps.length) {
      for (const g of gaps) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'evals-hero-gap';
        chip.textContent = g;
        chip.title = 'Top schema gap from this run';
        gapsHost.append(chip);
      }
    } else {
      gapsHost.textContent = 'No open schema gaps';
    }
  };

  const refreshArtistNavBadges = (): void => {
    const counts = authoredCountByArtist(activeScreens);
    artistNav.querySelectorAll<HTMLElement>('.evals-nav-item').forEach((el) => {
      const id = el.dataset.id ?? '';
      const meta = el.querySelector('.evals-nav-meta');
      if (!meta) return;
      const artist = catalog.artists.find((a) => a.id === id);
      const n = counts.get(id);
      if (activeScreens?.length && n != null) {
        meta.textContent = `${artist?.movement ?? ''} · ${n} in run`;
        el.classList.toggle('evals-nav-item--empty', n === 0);
      } else if (activeScreens?.length) {
        meta.textContent = `${artist?.movement ?? ''} · —`;
        el.classList.add('evals-nav-item--empty');
      } else {
        meta.textContent = artist?.movement ?? '';
        el.classList.remove('evals-nav-item--empty');
      }
    });
  };

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const inspector = buildInspector(mount.querySelector('[data-role="inspector"]') as HTMLElement, {
    dnaText: (id) => dnaText(id, catalog),
    onExport: (s, inspection) => {
      // One screen's inspection is one labelled training example: the prompt,
      // the rubric it was held to, what the agent perceived, and the verdict.
      downloadJson(`${s.id}.example.json`, {
        screenId: s.id,
        artistId: s.artistId,
        kind: s.kind,
        prompt: { title: s.title, intent: s.intent, recipe: s.recipe },
        spec: s.spec,
        rubric: inspection.intentTerms,
        styleTerms: inspection.styleTerms,
        topTerms: inspection.topTerms,
        perception: inspection.scene,
        score: inspection.score,
        runId: lastSummary?.runId ?? null,
        styleDnaHash: lastSummary?.provenance.versions.styleDnaHash ?? null,
      });
    },
  });

  const showInspector = (s: EvalScreen | null): void => {
    const profile = s ? (catalog.artists.find((a) => a.id === s.artistId) ?? null) : null;
    inspector.setScreen(s, profile);
  };

  /** Filled once renderGrid exists — avoids TDZ on applyRun. */
  let refreshView: () => void = () => {};

  const refreshTimeline = (): void => {
    timeline.setRuns(listRuns());
  };

  const applyRun = (
    summary: RunSummary,
    results: ScreenScore[],
    authored?: EvalScreen[] | null,
  ): void => {
    lastSummary = summary;
    lastResults = results;
    activeScreens = authored?.length ? authored : null;
    // Agent evidence defaults to "This run"; rescore stays on Catalog.
    evidenceMode = activeScreens?.length ? 'run' : 'catalog';
    exportBtn.disabled = false;
    timeline.select(summary.runId);
    timeline.setProvenance(summary);

    // Compare what this run recorded against what this build would produce now.
    // Agent runs render their own authoredScreens — fingerprint those instead.
    const fingerprintSource = activeScreens ?? catalog.screens;
    const currentVersions = buildProvenance(catalog.artists, {
      label: '',
      note: '',
      harness: 'playground-ui',
    }, { saverSpecFormat: catalog.screens[0]?.spec.schemaVersion ?? 1 }).versions;
    screenDrift = driftedScreens(summary.screenFingerprints, fingerprintScreens(fingerprintSource));
    timeline.setVersions(summary, compareVersions(summary.provenance.versions, currentVersions), screenDrift);
    syncEvidenceChrome();
    paintHero();
    refreshArtistNavBadges();
    // After refreshView, not before: renderGrid unconditionally rewrites the
    // subtitle, so setting it first meant the provenance line never showed.
    refreshView();
    const p = summary.provenance;
    const evidence =
      p.harness === 'agent-loop'
        ? ` · ${results.filter((r) => r.valid).length}/${results.length} authored`
        : '';
    subtitleEl.textContent =
      `${p.label} · median ${summary.suiteMedian.toFixed(3)}` +
      (p.model ? ` · ${p.model.name}` : '') +
      ` · dna:${p.versions.styleDnaHash.slice(0, 6)}` +
      evidence;
  };

  const selectRun = (runId: string): void => {
    const stored = loadRun(runId);
    if (!stored) return;
    // Disk baselines may ship summary without results — still show provenance.
    applyRun(stored.summary, stored.results, stored.authoredScreens);
  };

  const startNewRun = async (): Promise<void> => {
    const newestId = listRuns()[0]?.runId;
    const parent =
      lastSummary ?? (newestId ? (loadRun(newestId)?.summary ?? null) : null);
    const req = await promptRunRequest({
      parentRunId: parent?.runId,
      parentLabel: parent?.provenance.label,
      catalog,
      artistId,
      benchmarkId,
      screenId: screen?.id ?? null,
    });
    if (!req) return;

    // ---- Agent mode: hit OpenRouter, author SaverSpecs, land on timeline ----
    if (req.mode === 'agent') {
      if (!hasKey()) {
        window.alert(
          'OpenRouter API key required for agent runs. Open Settings and add a key (or set OPENROUTER_API_KEY for the Vite env fallback).',
        );
        return;
      }
      if (!req.modelName) {
        window.alert('Pick an OpenRouter model for agent mode.');
        return;
      }
      const runId = `run-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}-agent`;
      // Targets come from the dialog pickers — not whatever tile happens to be active.
      const agent = await runAgentEvalInteractive({
        ctx: {
          catalog,
          screenId: req.targetScreenId ?? screen?.id ?? null,
          benchmarkId: req.targetBenchmarkId ?? benchmarkId,
          artistId: req.targetArtistId ?? artistId,
        },
        model: req.modelName,
        maxToolCalls: req.maxToolCalls ?? 20,
        scope: req.agentScope ?? 'benchmark',
        operator: req.operator,
        runId,
      });
      if (!agent) return;
      const bridged = bridgeAgentRunToTimeline(
        agent,
        catalog.screens,
        catalog.artists,
        req,
        parent,
      );
      saveBrowserRun(bridged.stored.summary, bridged.stored.results, {
        authoredScreens: bridged.screens,
        agentRunId: agent.runId,
      });
      refreshTimeline();
      applyRun(bridged.stored.summary, bridged.stored.results, bridged.screens);
      return;
    }

    // ---- Re-score mode: local only, no network ----
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}-ui`;
    const { results, summary } = scoreSuite(catalog.screens, catalog.artists, {
      runId,
      request: { ...req, harness: 'playground-ui', mode: 'rescore' },
      parentSummary: parent,
    });
    saveBrowserRun(summary, results);
    refreshTimeline();
    applyRun(summary, results, null);
  };

  const timeline: RunTimelineHandle = buildRunTimeline(timelineHost, {
    onSelect: selectRun,
    onNewRun: () => {
      void startNewRun();
    },
    // Re-scoring produces a NEW run; the drifted one stays as the record of
    // what was true when it was taken.
    onRescore: () => {
      void startNewRun();
    },
  });
  refreshTimeline();

  const disposeCompare = (): void => {
    hoveredTile = null;
    for (const inst of compareByScreen.values()) inst.dispose();
    compareByScreen.clear();
    compareGrid.replaceChildren();
  };

  /**
   * Tile playback. 10–15 Canvas2D savers all looping is what makes Compare /
   * By artist feel janky. Mount paints a still (`reducedMotion`), then only the
   * selected tile and the hovered tile run — everything else stays on its last
   * frame. The whole grid freezes while the chamber is up.
   */
  const syncTiles = (): void => {
    for (const [id, inst] of compareByScreen) {
      const on = gridLive && (id === screen?.id || id === hoveredTile);
      inst.setPaused(!on);
      const tile = compareGrid.querySelector<HTMLElement>(
        `.evals-tile[data-screen-id="${CSS.escape(id)}"]`,
      );
      if (tile) tile.dataset.playing = String(on);
    }
  };

  const setGridLive = (on: boolean): void => {
    gridLive = on;
    syncTiles();
  };

  const selectScreen = (s: EvalScreen): void => {
    screen = s;
    if (mode === 'compare') artistId = s.artistId;
    compareGrid.querySelectorAll('.evals-tile').forEach((t) => {
      t.classList.toggle('active', (t as HTMLElement).dataset.screenId === s.id);
    });
    showInspector(s);
    syncTiles();
  };

  // ---- chamber ----------------------------------------------------------
  const chamber = createChamber({
    onOpenChange: (isOpen) => {
      setGridLive(!isOpen);
      opts.onFullscreenChange?.(isOpen);
    },
    onShow: (screenId) => {
      const s = catalog.screens.find((x) => x.id === screenId);
      if (s) selectScreen(s);
    },
  });

  const scoreLineFor = (s: EvalScreen): string | undefined => {
    const scored = lastResults?.find((r) => r.screenId === s.id);
    return scored ? `score ${scored.score.toFixed(2)}` : undefined;
  };

  /** Compare mode: one intent, every artist — that set IS the comparison. */
  const chamberEntriesForCompare = (screens: EvalScreen[]): ChamberEntry[] =>
    screens.map((s) => {
      const artist = catalog.artists.find((a) => a.id === s.artistId);
      return {
        screen: s,
        title: artist?.artist ?? s.artistId,
        subtitle: artist?.movement ?? '',
        dna: dnaText(s.artistId, catalog),
        scoreLine: scoreLineFor(s),
      };
    });

  /** Artist mode: one artist, all of their screens. */
  const chamberEntriesForArtist = (screens: EvalScreen[]): ChamberEntry[] =>
    screens.map((s) => ({
      screen: s,
      title: s.title,
      subtitle: s.recipe,
      dna: dnaText(s.artistId, catalog),
      scoreLine: scoreLineFor(s),
    }));

  /**
   * Mount a saver into a tile stage as a still frame, then let syncTiles unpause
   * only the hot tile. `reducedMotion` paints t=0 immediately so paused tiles
   * never sit black waiting for a rAF they will not get.
   */
  const mountStage = (stage: HTMLElement, s: EvalScreen): void => {
    try {
      const plugin = compileSaver(s.spec);
      void Promise.resolve(
        plugin.mount({
          host: stage,
          dpr: Math.min(devicePixelRatio || 1, 1.25),
          width: 320,
          height: 200,
          rng: createRng((s.spec.seed ?? 42) >>> 0 || 1),
          seed: s.spec.seed ?? 42,
          reducedMotion: true,
        }),
      ).then((inst) => {
        compareByScreen.set(s.id, inst);
        syncTiles();
      });
    } catch (err) {
      stage.textContent = err instanceof Error ? err.message : String(err);
    }
  };

  /** Build one live tile. Both modes use the same card — only the labels differ. */
  const buildTile = (s: EvalScreen, name: string, meta: string): HTMLElement => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'evals-tile';
    tile.dataset.screenId = s.id;
    if (screen?.id === s.id) tile.classList.add('active');

    const head = document.createElement('div');
    head.className = 'evals-tile-head';
    const scored = lastResults?.find((r) => r.screenId === s.id);
    const nameEl = document.createElement('span');
    nameEl.className = 'evals-tile-name';
    nameEl.textContent = name;
    const metaEl = document.createElement('span');
    metaEl.className = 'evals-tile-meta';
    metaEl.textContent = scored ? `${meta} · ${scored.score.toFixed(2)}` : meta;
    head.append(nameEl, metaEl);

    // This tile is not the one the selected run measured — say so on the tile
    // itself, because the score badge next to it is from the old screen.
    if (scored && screenDrift?.changed.includes(s.id)) {
      tile.dataset.drift = 'changed';
      const flag = document.createElement('span');
      flag.className = 'evals-tile-drift';
      flag.textContent = 'changed since scored';
      flag.title = 'This spec differs from the one the selected run scored — the number beside it is stale.';
      head.append(flag);
    }

    const stage = document.createElement('div');
    stage.className = 'evals-tile-stage';
    const enter = document.createElement('span');
    enter.className = 'evals-tile-enter';
    enter.textContent = 'Enter chamber';
    stage.append(enter);

    tile.append(head, stage);
    // One click selects (inspector follows); a second click on an already
    // selected tile steps into the chamber, as does double-click.
    tile.addEventListener('click', () => {
      if (screen?.id === s.id) chamber.open(s.id);
      else selectScreen(s);
    });
    tile.addEventListener('dblclick', () => chamber.open(s.id));
    tile.addEventListener('pointerenter', () => {
      hoveredTile = s.id;
      syncTiles();
    });
    tile.addEventListener('pointerleave', () => {
      if (hoveredTile === s.id) hoveredTile = null;
      syncTiles();
    });

    mountStage(stage, s);
    return tile;
  };

  /**
   * Stage contents for the active lens × evidence mode.
   * Catalog = full DNA wall (authored overlaid). This run = authored only.
   */
  const screensForView = (): EvalScreen[] => {
    if (mode === 'compare') {
      return screensForCompareRun(
        catalog.screens.filter((s) => s.kind === 'benchmark' && s.screenId === benchmarkId),
        activeScreens,
        benchmarkId,
        evidenceMode,
      );
    }
    return screensForArtistRun(
      catalog.screensByArtist.get(artistId) ?? [],
      activeScreens,
      artistId,
      evidenceMode,
    );
  };

  const renderGrid = (): void => {
    disposeCompare();
    compareGrid.classList.remove('evals-compare-grid--sparse');

    const screens = screensForView();
    // Sparse agent reviews get larger tiles — a focused hanging, not a tiny grid.
    if (screens.length > 0 && screens.length <= 6) {
      compareGrid.classList.add('evals-compare-grid--sparse');
    }

    if (mode === 'compare') {
      const bench = catalog.benchmarks.find((b) => b.id === benchmarkId);
      intentEl.innerHTML = '';
      if (bench) {
        const title = document.createElement('div');
        title.className = 'evals-intent-title';
        title.textContent = `${bench.title} — shared intent`;
        const body = document.createElement('div');
        body.className = 'evals-intent-body';
        body.textContent = bench.intent;
        const chips = document.createElement('div');
        chips.className = 'evals-intent-chips';
        const evidenceChip = document.createElement('span');
        evidenceChip.className = 'evals-check-chip evals-check-chip--evidence';
        evidenceChip.textContent = evidenceMode === 'run' ? 'evidence · this run' : 'evidence · catalog';
        chips.append(evidenceChip);
        for (const c of describeChecks(bench.checks)) {
          const chip = document.createElement('span');
          chip.className = 'evals-check-chip';
          chip.textContent = c;
          chips.append(chip);
        }
        intentEl.append(title, body, chips);
      }
      if (!lastSummary) {
        subtitleEl.textContent =
          `${bench?.title ?? benchmarkId} × ${screens.length} artists — catalog baseline`;
      }
      chamber.setEntries(
        chamberEntriesForCompare(screens),
        `${bench?.title ?? benchmarkId} — ${screens.length} artists, one intent`,
      );
      if (!screens.length) {
        const empty = document.createElement('div');
        empty.className = 'evals-grid-empty';
        empty.textContent =
          evidenceMode === 'run'
            ? 'This run didn’t author this benchmark for any artist.'
            : 'No screens for this benchmark.';
        compareGrid.append(empty);
      }
      for (const s of screens) {
        const artist = catalog.artists.find((a) => a.id === s.artistId);
        compareGrid.append(buildTile(s, artist?.artist ?? s.artistId, artist?.movement ?? ''));
      }
    } else {
      const a = catalog.artists.find((x) => x.id === artistId);
      intentEl.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'evals-intent-title';
      title.textContent = `${a?.artist ?? artistId} — ${a?.movement ?? ''} (${a?.years ?? ''})`;
      const body = document.createElement('div');
      body.className = 'evals-intent-body';
      body.textContent = a?.research.thesis ?? '';
      const chips = document.createElement('div');
      chips.className = 'evals-intent-chips';
      const benches = screens.filter((s) => s.kind === 'benchmark').length;
      const sigs = screens.filter((s) => s.kind === 'signature').length;
      for (const c of [
        evidenceMode === 'run' ? 'evidence · this run' : 'evidence · catalog',
        `${benches} benchmarks`,
        `${sigs} signatures`,
        `tempo ${a?.research.tempo ?? '—'}`,
      ]) {
        const chip = document.createElement('span');
        chip.className = 'evals-check-chip';
        if (c.startsWith('evidence')) chip.classList.add('evals-check-chip--evidence');
        chip.textContent = c;
        chips.append(chip);
      }
      intentEl.append(title, body, chips);
      if (!lastSummary) {
        subtitleEl.textContent = `${a?.artist ?? artistId} — ${screens.length} screens`;
      }
      chamber.setEntries(
        chamberEntriesForArtist(screens),
        `${a?.artist ?? artistId} — ${screens.length} screens`,
      );
      if (!screens.length) {
        const empty = document.createElement('div');
        empty.className = 'evals-grid-empty';
        empty.textContent =
          evidenceMode === 'run'
            ? 'This run didn’t author any screens for this artist. Switch to Catalog, or pick another artist.'
            : 'No screens for this artist.';
        compareGrid.append(empty);
      }
      for (const kind of ['benchmark', 'signature'] as const) {
        const group = screens.filter((s) => s.kind === kind);
        if (!group.length) continue;
        const label = document.createElement('div');
        label.className = 'evals-grid-label';
        label.textContent = kind === 'benchmark' ? 'Benchmarks — shared intents' : 'Signatures — artist-owned';
        compareGrid.append(label);
        for (const s of group) compareGrid.append(buildTile(s, s.title, s.recipe));
      }
    }

    const focus =
      screens.find((s) => s.id === screen?.id) ??
      (mode === 'compare'
        ? screens.find((s) => s.artistId === artistId)
        : screens.find((s) => s.screenId === benchmarkId)) ??
      screens[0];
    if (focus) selectScreen(focus);
    else showInspector(null);
  };

  const setMode = (next: ViewMode): void => {
    mode = next;
    mount.querySelectorAll('.evals-mode-btn').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.mode === mode);
    });
    compareNav.hidden = mode !== 'compare';
    artistNav.hidden = mode === 'compare';
    renderGrid();
  };

  const setEvidenceMode = (next: EvidenceMode): void => {
    if (next === 'run' && !activeScreens?.length) return;
    evidenceMode = next;
    syncEvidenceChrome();
    renderGrid();
  };

  // ---- nav lists ----
  for (const b of catalog.benchmarks) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'evals-nav-item';
    btn.dataset.id = b.id;
    if (b.id === benchmarkId) btn.classList.add('active');
    btn.innerHTML = `<span class="evals-nav-name">${b.title}</span><span class="evals-nav-meta">× ${catalog.artists.length} artists</span>`;
    btn.addEventListener('click', () => {
      benchmarkId = b.id;
      compareNav.querySelectorAll('.evals-nav-item').forEach((el) => {
        el.classList.toggle('active', (el as HTMLElement).dataset.id === benchmarkId);
      });
      renderGrid();
    });
    compareNav.append(btn);
  }

  for (const a of catalog.artists) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'evals-nav-item';
    btn.dataset.id = a.id;
    if (a.id === artistId) btn.classList.add('active');
    btn.innerHTML = `<span class="evals-nav-name">${a.artist}</span><span class="evals-nav-meta">${a.movement}</span>`;
    btn.addEventListener('click', () => {
      artistId = a.id;
      artistNav.querySelectorAll('.evals-nav-item').forEach((el) => {
        el.classList.toggle('active', (el as HTMLElement).dataset.id === artistId);
      });
      renderGrid();
    });
    artistNav.append(btn);
  }

  mount.querySelectorAll('.evals-mode-btn').forEach((b) =>
    b.addEventListener('click', () => {
      const m = (b as HTMLElement).dataset.mode as ViewMode;
      if (m === 'compare' || m === 'artist') setMode(m);
    }),
  );

  for (const btn of evidenceBtns) {
    btn.addEventListener('click', () => {
      const next = btn.dataset.evidence as EvidenceMode;
      if (next) setEvidenceMode(next);
    });
  }

  mount.querySelector('[data-act="chamber"]')?.addEventListener('click', () => {
    if (screen) chamber.open(screen.id);
  });

  exportBtn.addEventListener('click', () => {
    if (!lastSummary) return;
    // Research / training pack: summary + scores + authored specs + gaps brief.
    downloadJson(`${lastSummary.runId}-summary.json`, lastSummary);
    if (lastResults?.length) {
      downloadJson(`${lastSummary.runId}-results.json`, lastResults);
    }
    if (activeScreens?.length) {
      downloadJson(
        `${lastSummary.runId}-authored.json`,
        activeScreens.map((s) => ({
          id: s.id,
          artistId: s.artistId,
          kind: s.kind,
          screenId: s.screenId,
          title: s.title,
          intent: s.intent,
          recipe: s.recipe,
          spec: s.spec,
        })),
      );
    }
    const blob = new Blob([gapsMarkdown(lastSummary)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lastSummary.runId}-gaps.md`;
    a.click();
    URL.revokeObjectURL(url);
  });

  refreshView = renderGrid;

  setMode('compare');
  syncEvidenceChrome();

  // Open on the newest run so provenance / next-cycle inputs are visible immediately.
  const newest = listRuns()[0];
  if (newest) selectRun(newest.runId);

  return {
    dispose(): void {
      disposeCompare();
      chamber.dispose();
      timeline.dispose();
      mount.replaceChildren();
    },
  };
}
