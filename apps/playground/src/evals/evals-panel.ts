import { createRng, type SaverInstance } from '@idle-screens/core';
import { compileSaver } from '@idle-screens/schema';
import { bridgeAgentRunToTimeline } from './agent-bridge';
import { openAgentPanel, runAgentEvalInteractive } from './agent-panel';
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
  buildRunTimeline,
  promptRunRequest,
  type RunTimelineHandle,
  type ScreenDrift,
} from './run-timeline';
import { scoreSuite } from './score';
import type { BenchmarkIntent, EvalScreen, RunSummary, ScreenScore } from './types';

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

type ViewMode = 'compare' | 'artist' | 'gallery';

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
  let mode: ViewMode = 'compare';
  let artistId = catalog.artists[0]?.id ?? 'monet';
  let benchmarkId = catalog.benchmarks[0]?.id ?? 'calm-horizon';
  /** Gallery mode: true = the index wall of all artists, false = one artist's wall. */
  let galleryIndex = true;
  let screen: EvalScreen | null = null;
  const compareByScreen = new Map<string, SaverInstance>();
  let lastResults: ScreenScore[] | null = null;
  let lastSummary: RunSummary | null = null;
  /** Tiles the observer says are on screen; playback is the intersection of this and `gridLive`. */
  const visibleTiles = new Set<string>();
  let hoveredTile: string | null = null;
  let gridLive = true;
  let tileObserver: IntersectionObserver | null = null;
  /** Which screens changed since the selected run scored them (null = no run). */
  let screenDrift: ScreenDrift | null = null;

  mount.innerHTML = `
    <div class="evals-shell">
      <aside class="evals-nav" aria-label="Eval navigation">
        <div class="evals-mode">
          <button type="button" class="evals-mode-btn active" data-mode="compare">Compare</button>
          <button type="button" class="evals-mode-btn" data-mode="artist">By artist</button>
          <button type="button" class="evals-mode-btn" data-mode="gallery">Gallery</button>
        </div>
        <div class="evals-nav-list" data-nav="compare"></div>
        <div class="evals-nav-list" data-nav="artist" hidden></div>
      </aside>
      <section class="evals-main">
        <div class="evals-timeline-host" data-role="timeline"></div>
        <header class="evals-toolbar">
          <div class="evals-toolbar-meta">
            <h1 class="evals-title">Style Evals</h1>
            <p class="evals-sub" data-role="subtitle">Same benchmark × every artist — contrast StyleDNA side by side</p>
          </div>
          <div class="evals-toolbar-actions">
            <span class="evals-toolbar-hint">Click to select · click again to enter the chamber</span>
            <button type="button" class="evals-btn" data-act="chamber">Enter chamber</button>
            <button type="button" class="evals-btn secondary" data-act="agent">Agent run…</button>
            <button type="button" class="evals-btn secondary" data-act="export" disabled>Export run</button>
          </div>
        </header>

        <!-- One work area for both modes. They used to be two sibling panels
             each carrying its own StyleDNA + scorecard column, which is what
             let them stack on top of each other; a single grid + a single
             inspector makes that failure structurally impossible. -->
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
  const timelineHost = mount.querySelector('[data-role="timeline"]') as HTMLElement;
  const exportBtn = mount.querySelector('[data-act="export"]') as HTMLButtonElement;

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

  /** When a selected run carries model-authored specs, the grid shows those. */
  let activeScreens: EvalScreen[] | null = null;

  const applyRun = (
    summary: RunSummary,
    results: ScreenScore[],
    authored?: EvalScreen[] | null,
  ): void => {
    lastSummary = summary;
    lastResults = results;
    activeScreens = authored?.length ? authored : null;
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
      const agent = await runAgentEvalInteractive({
        ctx: {
          catalog,
          screenId: screen?.id ?? null,
          benchmarkId,
          artistId,
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
    tileObserver?.disconnect();
    tileObserver = null;
    visibleTiles.clear();
    hoveredTile = null;
    for (const inst of compareByScreen.values()) inst.dispose();
    compareByScreen.clear();
    compareGrid.replaceChildren();
  };

  /**
   * Tile playback. The old rule ran all 15 for 4.5s then froze everything but
   * the selection, which left a wall of dead stills — and any saver that paints
   * only inside rAF froze black before its first frame. Now: on-screen tiles
   * run, the selected and hovered tiles always run, and the whole grid stops
   * while the chamber is up.
   */
  const syncTiles = (): void => {
    for (const [id, inst] of compareByScreen) {
      const on = gridLive && (visibleTiles.has(id) || id === screen?.id || id === hoveredTile);
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

  /** Mount a live saver into a tile stage; the instance joins playback sync. */
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
          reducedMotion: false,
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
   * Artist index card (Gallery mode): one live signature work standing in for
   * the artist's whole wall. Click steps into the wall, not the inspector.
   */
  const buildArtistCard = (a: (typeof catalog.artists)[number]): HTMLElement => {
    const works = catalog.screensByArtist.get(a.id) ?? [];
    const showcase = works.find((s) => s.kind === 'signature') ?? works[0];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'evals-tile evals-artist-card';
    if (showcase) card.dataset.screenId = showcase.id;

    const head = document.createElement('div');
    head.className = 'evals-tile-head';
    const nameEl = document.createElement('span');
    nameEl.className = 'evals-tile-name';
    nameEl.textContent = a.artist;
    const metaEl = document.createElement('span');
    metaEl.className = 'evals-tile-meta';
    metaEl.textContent = `${a.movement} · ${a.years}`;
    head.append(nameEl, metaEl);

    const stage = document.createElement('div');
    stage.className = 'evals-tile-stage';
    card.append(head, stage);

    card.addEventListener('click', () => {
      artistId = a.id;
      galleryIndex = false;
      artistNav.querySelectorAll('.evals-nav-item').forEach((el) => {
        el.classList.toggle('active', (el as HTMLElement).dataset.id === artistId);
      });
      renderGrid();
    });
    card.addEventListener('pointerenter', () => {
      if (showcase) {
        hoveredTile = showcase.id;
        syncTiles();
      }
    });
    card.addEventListener('pointerleave', () => {
      if (showcase && hoveredTile === showcase.id) hoveredTile = null;
      syncTiles();
    });

    if (showcase) mountStage(stage, showcase);
    return card;
  };

  /**
   * Both modes render the same thing — a gallery of live screens plus the
   * inspector. Compare holds the intent constant and varies the artist;
   * By artist holds the artist constant and shows their whole body of work.
   */
  const screensForView = (): EvalScreen[] => {
    const pool = activeScreens ?? catalog.screens;
    if (mode === 'compare') {
      return pool.filter((s) => s.kind === 'benchmark' && s.screenId === benchmarkId);
    }
    if (mode === 'gallery') return [];
    return pool.filter((s) => s.artistId === artistId);
  };

  const renderGrid = (): void => {
    disposeCompare();
    compareGrid.classList.remove('evals-compare-grid--wall');

    const screens = screensForView();

    if (mode === 'gallery') {
      compareGrid.classList.add('evals-compare-grid--wall');
      if (galleryIndex) {
        intentEl.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'evals-intent-title';
        title.textContent = 'The gallery — 15 artists, one wall each';
        const body = document.createElement('div');
        body.className = 'evals-intent-body';
        body.textContent =
          'Every StyleDNA profile is a hypothesis about how an artist compiles into SaverSpec. ' +
          'Step into a wall to see the whole body of work — shared benchmarks and signature pieces.';
        intentEl.append(title, body);
        subtitleEl.textContent = `Gallery — ${catalog.artists.length} artists`;
        const showcaseScreens = catalog.artists
          .map((a) => {
            const works = catalog.screensByArtist.get(a.id) ?? [];
            return works.find((s) => s.kind === 'signature') ?? works[0];
          })
          .filter((s): s is EvalScreen => !!s);
        chamber.setEntries(
          chamberEntriesForArtist(showcaseScreens),
          `The gallery — ${catalog.artists.length} artists`,
        );
        for (const a of catalog.artists) compareGrid.append(buildArtistCard(a));
      } else {
        const a = catalog.artists.find((x) => x.id === artistId);
        intentEl.innerHTML = '';
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'evals-gallery-back';
        back.textContent = '← All artists';
        back.addEventListener('click', () => {
          galleryIndex = true;
          renderGrid();
        });
        const title = document.createElement('div');
        title.className = 'evals-intent-title';
        title.textContent = `${a?.artist ?? artistId} — ${a?.movement ?? ''} (${a?.years ?? ''})`;
        const body = document.createElement('div');
        body.className = 'evals-intent-body';
        body.textContent = a?.research.thesis ?? '';
        const chips = document.createElement('div');
        chips.className = 'evals-intent-chips';
        for (const c of [
          `tempo ${a?.research.tempo ?? '—'}`,
          `depth ${a?.research.depth ?? '—'}`,
          `sprites ${a?.markMaking.primarySprites.join(', ') || '—'}`,
          `motions ${a?.motionDialect.preferred.join(', ') || '—'}`,
          `blend ${a?.markMaking.blend ?? '—'}`,
        ]) {
          const chip = document.createElement('span');
          chip.className = 'evals-check-chip';
          chip.textContent = c;
          chips.append(chip);
        }
        intentEl.append(back, title, body, chips);
        subtitleEl.textContent = `${a?.artist ?? artistId} — gallery wall, ${screens.length} works`;
        chamber.setEntries(
          chamberEntriesForArtist(screens),
          `${a?.artist ?? artistId} — ${screens.length} works`,
        );
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
    } else if (mode === 'compare') {
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
        for (const c of describeChecks(bench.checks)) {
          const chip = document.createElement('span');
          chip.className = 'evals-check-chip';
          chip.textContent = c;
          chips.append(chip);
        }
        intentEl.append(title, body, chips);
      }
      subtitleEl.textContent = `${catalog.benchmarks.find((b) => b.id === benchmarkId)?.title ?? benchmarkId} × ${catalog.artists.length} artists — same intent, different StyleDNA`;
      chamber.setEntries(
        chamberEntriesForCompare(screens),
        `${catalog.benchmarks.find((b) => b.id === benchmarkId)?.title ?? benchmarkId} — ${screens.length} artists, one intent`,
      );
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
      for (const c of [`${benches} benchmarks`, `${sigs} signatures`, `tempo ${a?.research.tempo ?? '—'}`, `depth ${a?.research.depth ?? '—'}`]) {
        const chip = document.createElement('span');
        chip.className = 'evals-check-chip';
        chip.textContent = c;
        chips.append(chip);
      }
      intentEl.append(title, body, chips);
      subtitleEl.textContent = `${a?.artist ?? artistId} — ${screens.length} screens`;
      chamber.setEntries(
        chamberEntriesForArtist(screens),
        `${a?.artist ?? artistId} — ${screens.length} screens`,
      );
      // Group the artist's gallery so shared intents read apart from their own work.
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

    // The scroller is .evals-compare-wrap, not the document — rootMargin is
    // only applied to the root's own rect, so leaving this null would make the
    // preroll a no-op against the real clipping ancestor.
    tileObserver = new IntersectionObserver(
      (records) => {
        for (const r of records) {
          const id = (r.target as HTMLElement).dataset.screenId;
          if (!id) continue;
          if (r.isIntersecting) visibleTiles.add(id);
          else visibleTiles.delete(id);
        }
        syncTiles();
      },
      { root: compareGrid.closest('.evals-compare-wrap'), rootMargin: '160px', threshold: 0 },
    );
    for (const tile of compareGrid.querySelectorAll('.evals-tile')) tileObserver.observe(tile);

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
    // The Gallery tab always lands on the index; walls are entered from there.
    if (mode === 'gallery') galleryIndex = true;
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
      if (mode === 'gallery') galleryIndex = false;
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
      if (m) setMode(m);
    }),
  );

  mount.querySelector('[data-act="chamber"]')?.addEventListener('click', () => {
    if (screen) chamber.open(screen.id);
  });

  mount.querySelector('[data-act="agent"]')?.addEventListener('click', () => {
    openAgentPanel({
      catalog,
      screenId: screen?.id ?? null,
      benchmarkId,
      artistId,
    });
  });

  exportBtn.addEventListener('click', () => {
    if (!lastSummary) return;
    downloadJson(`${lastSummary.runId}-summary.json`, lastSummary);
    if (lastResults?.length) {
      downloadJson(`${lastSummary.runId}-results.json`, lastResults);
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
