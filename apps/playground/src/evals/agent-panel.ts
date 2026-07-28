/**
 * Agent-run modal: configure (model / scope / tool-call budget) → watch the
 * loop work (per-screen progress + event log) → inspect the artifacts
 * (initial vs final, locally scored) and export the training set.
 *
 * Self-contained on purpose: the only touchpoint with the evals panel is one
 * toolbar button calling `openAgentPanel` with the current selection context.
 */
import { createRng, type SaverInstance } from '@idle-screens/core';
import { compileSaver, type SaverSpec } from '@idle-screens/schema';
import { chatCompletion, cachedModels, fetchModels, hasKey, type OpenRouterModel } from './openrouter';
import { getRunDefaults } from './run-defaults';
import {
  downloadText,
  runAgentBatch,
  saveAgentRun,
  sftJsonl,
  trainingJsonl,
  type AgentRun,
  type AgentRunTarget,
} from './agent-run';
import { persistAgentRun, SINK_ENABLED } from './artifact-sink';
import type { AgentScreenArtifact } from './agent-artifact';
import {
  mountAgentScopeControls,
  resolveAgentTargets,
  type AgentTargetContext,
} from './agent-targets';
import type { AgentScope } from './types';

export type AgentPanelContext = AgentTargetContext;
export type { AgentScope };
export { resolveAgentTargets };

function shortId(screenId: string): string {
  // monet--benchmark--calm-horizon → monet / calm-horizon
  const [artist, , id] = screenId.split('--');
  return id ? `${artist} / ${id}` : screenId;
}

/**
 * Run the OpenRouter agent loop with a progress UI. Resolves with the AgentRun
 * (partial if aborted) or null if the user cancelled before any screen finished.
 * Used by both the Agent run… button and New run (agent mode).
 */
export async function runAgentEvalInteractive(opts: {
  ctx: AgentPanelContext;
  model: string;
  maxToolCalls: number;
  scope: AgentScope;
  operator?: string;
  runId?: string;
}): Promise<AgentRun | null> {
  if (!hasKey()) {
    window.alert(
      'OpenRouter API key required. Add one in Settings (or set OPENROUTER_API_KEY for the Vite env fallback).',
    );
    return null;
  }
  const targets = resolveAgentTargets(opts.ctx, opts.scope);
  if (targets.length === 0) return null;

  const backdrop = document.createElement('div');
  backdrop.className = 'evals-modal-backdrop';
  const abort = new AbortController();
  let disposed = false;
  document.body.append(backdrop);

  const modal = document.createElement('div');
  modal.className = 'evals-modal evals-agent-modal evals-agent-wide';
  modal.innerHTML = `
    <h2 class="evals-modal-title">Authoring via OpenRouter — <span data-role="model"></span></h2>
    <p class="evals-modal-sub">
      ${targets.length} screen${targets.length === 1 ? '' : 's'}, serial tool loop.
      Specs from the model become this run’s evidence; scores are computed locally.
    </p>
    <div class="evals-agent-rows" data-role="rows"></div>
    <div class="evals-agent-log" data-role="log" aria-live="polite"></div>
    <div class="evals-modal-actions">
      <button type="button" class="evals-btn secondary" data-act="abort">Abort</button>
    </div>
  `;
  modal.querySelector('[data-role="model"]')!.textContent = opts.model;
  backdrop.append(modal);
  modal.querySelector('[data-act="abort"]')?.addEventListener('click', () => abort.abort());

  const rowsHost = modal.querySelector<HTMLElement>('[data-role="rows"]')!;
  const log = modal.querySelector<HTMLElement>('[data-role="log"]')!;
  const rowEls = new Map<string, HTMLElement>();
  const logLines: string[] = [];
  for (const t of targets) {
    const row = document.createElement('div');
    row.className = 'evals-agent-row';
    row.dataset.state = 'queued';
    row.innerHTML = `<span class="evals-agent-row-name">${shortId(t.screen.id)}</span><span class="evals-agent-row-state">queued</span>`;
    rowsHost.append(row);
    rowEls.set(t.screen.id, row);
  }
  const setRow = (screenId: string, state: string, text: string): void => {
    const row = rowEls.get(screenId);
    if (!row) return;
    row.dataset.state = state;
    row.querySelector('.evals-agent-row-state')!.textContent = text;
  };
  const addLog = (line: string): void => {
    logLines.push(line);
    log.textContent = logLines.slice(-50).join('\n');
    log.scrollTop = log.scrollHeight;
  };

  try {
    const run = await runAgentBatch({
      runId: opts.runId ?? `agent-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`,
      model: opts.model,
      maxToolCalls: opts.maxToolCalls,
      operator: opts.operator,
      targets,
      profiles: opts.ctx.catalog.artists,
      chat: chatCompletion,
      signal: abort.signal,
      onProgress: (p) => {
        if (disposed) return;
        if (p.type === 'screen-start') {
          setRow(p.screenId, 'running', `running · 0/${opts.maxToolCalls} calls`);
          addLog(`\n▶ ${shortId(p.screenId)} (${p.index + 1}/${p.total})`);
        } else if (p.type === 'screen-event') {
          const e = p.event;
          if (e.type === 'tool') {
            const row = rowEls.get(p.screenId);
            if (row) {
              const m = /· (\d+)\//.exec(row.querySelector('.evals-agent-row-state')!.textContent ?? '');
              const n = (m ? Number(m[1]) : 0) + (e.name === 'finish' ? 0 : 1);
              setRow(p.screenId, 'running', `running · ${n}/${opts.maxToolCalls} calls`);
            }
            addLog(`  ${e.ok ? '✓' : '✕'} ${e.name} — ${e.summary}`);
          } else if (e.type === 'assistant') {
            addLog(`  “${e.text.slice(0, 120)}${e.text.length > 120 ? '…' : ''}”`);
          }
        } else if (p.type === 'screen-done') {
          const a = p.artifact;
          const delta =
            a.initial && a.final
              ? `${a.initial.score.score.toFixed(2)} → ${a.final.score.score.toFixed(2)}`
              : 'no spec';
          setRow(a.screenId, a.outcome === 'finished' ? 'done' : 'warn', `${a.outcome} · ${delta}`);
          addLog(`  ■ ${a.outcome} · ${delta} (${a.toolCallsUsed} calls)`);
        }
      },
    });
    saveAgentRun(run);
    // localStorage keeps 5 runs and evicts silently; disk is the durable copy.
    void persistAgentRun(run).then((r) => {
      if (r.ok) addLog(`  ▪ saved to ${r.path}`);
      else if (SINK_ENABLED) addLog(`  ▪ disk save failed: ${r.error}`);
    });
    return run.artifacts.length ? run : null;
  } finally {
    disposed = true;
    backdrop.remove();
  }
}

export function openAgentPanel(ctx: AgentPanelContext): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'evals-modal-backdrop';
  const instances: SaverInstance[] = [];
  const abort = new AbortController();
  let disposed = false;

  const close = (): void => {
    if (disposed) return;
    disposed = true;
    abort.abort();
    for (const inst of instances) inst.dispose();
    backdrop.remove();
  };

  const defaults = getRunDefaults();

  // ------------------------------------------------------------------ config
  const renderConfig = (): void => {
    backdrop.innerHTML = '';
    const modal = document.createElement('div');
    modal.className = 'evals-modal evals-agent-modal';
    const keyed = hasKey();
    modal.innerHTML = `
      <h2 class="evals-modal-title">Agent run</h2>
      <p class="evals-modal-sub">
        A model authors screens through tools — submit → perceive → score → refine.
        Each screen becomes a training artifact: prompt, trajectory, initial and final spec.
      </p>
      <div class="evals-field-row">
        <label class="evals-field">Model
          <input name="model" list="agent-model-list" autocomplete="off" spellcheck="false"
                 placeholder="type to search OpenRouter models" />
          <datalist id="agent-model-list"></datalist>
        </label>
        <label class="evals-field">Max tool calls per screen
          <input name="maxCalls" type="number" min="1" max="100" value="20" />
        </label>
      </div>
      <p class="evals-field-hint" data-role="model-hint"></p>
      <div data-role="scope-controls"></div>
      ${
        keyed
          ? ''
          : `<p class="evals-agent-nokey">
               Agent runs call OpenRouter chat completions — that needs an API key.
               <a href="#settings" data-act="open-settings">Add one in Settings →</a>
             </p>`
      }
      <div class="evals-modal-actions">
        <button type="button" class="evals-btn secondary" data-act="cancel">Cancel</button>
        <button type="button" class="evals-btn" data-act="start" ${keyed ? '' : 'disabled'}>Start run</button>
      </div>
    `;
    backdrop.append(modal);

    const modelInput = modal.querySelector<HTMLInputElement>('input[name="model"]')!;
    const maxCallsInput = modal.querySelector<HTMLInputElement>('input[name="maxCalls"]')!;
    const datalist = modal.querySelector<HTMLDataListElement>('#agent-model-list')!;
    const hint = modal.querySelector<HTMLElement>('[data-role="model-hint"]')!;
    const scopeHost = modal.querySelector<HTMLElement>('[data-role="scope-controls"]')!;

    modelInput.value = defaults.model ?? '';

    const paintModels = (models: OpenRouterModel[]): void => {
      datalist.replaceChildren(
        ...models.map((m) => {
          const o = document.createElement('option');
          o.value = m.id;
          o.label = m.contextLength ? `${m.name} · ${Math.round(m.contextLength / 1000)}k ctx` : m.name;
          return o;
        }),
      );
      hint.textContent = models.length
        ? `${models.length} models from OpenRouter — free text is still accepted.`
        : 'No cached model list — type a model id like deepseek/deepseek-chat.';
    };
    paintModels(cachedModels());
    void fetchModels().then(paintModels).catch(() => { /* cached stands */ });

    const scopeControls = mountAgentScopeControls(
      scopeHost,
      ctx.catalog,
      {
        scope: 'benchmark',
        artistId: ctx.artistId,
        benchmarkId: ctx.benchmarkId,
        screenId: ctx.screenId,
      },
      { maxCallsInput },
    );

    modal.querySelector('[data-act="cancel"]')?.addEventListener('click', close);
    modal.querySelector('[data-act="open-settings"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      close();
      location.hash = 'settings';
    });
    modal.querySelector('[data-act="start"]')?.addEventListener('click', () => {
      const model = modelInput.value.trim();
      if (!model) {
        hint.textContent = 'Pick a model first.';
        return;
      }
      const maxToolCalls = Math.min(100, Math.max(1, Number(maxCallsInput.value) || 20));
      const sel = scopeControls.read();
      const targets = resolveAgentTargets(
        {
          catalog: ctx.catalog,
          artistId: sel.artistId,
          benchmarkId: sel.benchmarkId,
          screenId: sel.screenId,
        },
        sel.scope,
      );
      void runBatch(model, maxToolCalls, targets);
    });
  };

  // ---------------------------------------------------------------- progress
  const renderProgress = (model: string, targets: AgentRunTarget[]): HTMLElement => {
    backdrop.innerHTML = '';
    const modal = document.createElement('div');
    modal.className = 'evals-modal evals-agent-modal evals-agent-wide';
    modal.innerHTML = `
      <h2 class="evals-modal-title">Agent run — <span data-role="model"></span></h2>
      <p class="evals-modal-sub">${targets.length} screen${targets.length === 1 ? '' : 's'}, serial. Scores are computed locally, never self-reported.</p>
      <div class="evals-agent-rows" data-role="rows"></div>
      <div class="evals-agent-log" data-role="log" aria-live="polite"></div>
      <div class="evals-modal-actions">
        <button type="button" class="evals-btn secondary" data-act="abort">Abort</button>
      </div>
    `;
    // Model ids arrive from the OpenRouter catalogue and the search box, so
    // they're untrusted strings — set them as text, never as markup.
    modal.querySelector('[data-role="model"]')!.textContent = model;
    backdrop.append(modal);
    modal.querySelector('[data-act="abort"]')?.addEventListener('click', () => abort.abort());
    return modal;
  };

  const runBatch = async (model: string, maxToolCalls: number, targets: AgentRunTarget[]): Promise<void> => {
    const modal = renderProgress(model, targets);
    const rowsHost = modal.querySelector<HTMLElement>('[data-role="rows"]')!;
    const log = modal.querySelector<HTMLElement>('[data-role="log"]')!;
    const rowEls = new Map<string, HTMLElement>();
    const logLines: string[] = [];

    for (const t of targets) {
      const row = document.createElement('div');
      row.className = 'evals-agent-row';
      row.dataset.state = 'queued';
      row.innerHTML = `<span class="evals-agent-row-name">${shortId(t.screen.id)}</span><span class="evals-agent-row-state">queued</span>`;
      rowsHost.append(row);
      rowEls.set(t.screen.id, row);
    }

    const setRow = (screenId: string, state: string, text: string): void => {
      const row = rowEls.get(screenId);
      if (!row) return;
      row.dataset.state = state;
      row.querySelector('.evals-agent-row-state')!.textContent = text;
    };
    const addLog = (line: string): void => {
      logLines.push(line);
      log.textContent = logLines.slice(-40).join('\n');
      log.scrollTop = log.scrollHeight;
    };

    const run = await runAgentBatch({
      runId: `agent-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`,
      model,
      maxToolCalls,
      operator: getRunDefaults().operator,
      targets,
      profiles: ctx.catalog.artists,
      chat: chatCompletion,
      signal: abort.signal,
      onProgress: (p) => {
        if (disposed) return;
        if (p.type === 'screen-start') {
          setRow(p.screenId, 'running', `running · 0/${maxToolCalls} calls`);
          addLog(`\n▶ ${shortId(p.screenId)} (${p.index + 1}/${p.total})`);
        } else if (p.type === 'screen-event') {
          const e = p.event;
          if (e.type === 'tool') {
            const row = rowEls.get(p.screenId);
            if (row) {
              const m = /· (\d+)\//.exec(row.querySelector('.evals-agent-row-state')!.textContent ?? '');
              const n = (m ? Number(m[1]) : 0) + (e.name === 'finish' ? 0 : 1);
              setRow(p.screenId, 'running', `running · ${n}/${maxToolCalls} calls`);
            }
            addLog(`  ${e.ok ? '✓' : '✕'} ${e.name} — ${e.summary}`);
          } else if (e.type === 'assistant') {
            addLog(`  “${e.text.slice(0, 120)}${e.text.length > 120 ? '…' : ''}”`);
          }
        } else if (p.type === 'screen-done') {
          const a = p.artifact;
          const delta =
            a.initial && a.final
              ? `${a.initial.score.score.toFixed(2)} → ${a.final.score.score.toFixed(2)}`
              : 'no spec';
          setRow(a.screenId, a.outcome === 'finished' ? 'done' : 'warn', `${a.outcome} · ${delta}`);
          addLog(`  ■ ${a.outcome} · ${delta} (${a.toolCallsUsed} calls)`);
        }
      },
    });

    if (!disposed) {
      saveAgentRun(run);
      void persistAgentRun(run).then((r) => {
        if (r.ok) addLog(`  ▪ saved to ${r.path}`);
        else if (SINK_ENABLED) addLog(`  ▪ disk save failed: ${r.error}`);
      });
      renderResults(run);
    }
  };

  // ----------------------------------------------------------------- results
  const mountSpec = (host: HTMLElement, spec: SaverSpec): void => {
    try {
      const plugin = compileSaver(spec);
      void Promise.resolve(
        plugin.mount({
          host,
          dpr: Math.min(devicePixelRatio || 1, 1.25),
          width: 280,
          height: 175,
          rng: createRng((spec.seed ?? 42) >>> 0 || 1),
          seed: spec.seed ?? 42,
          reducedMotion: false,
        }),
      ).then((inst) => instances.push(inst));
    } catch {
      host.textContent = 'compile failed';
    }
  };

  const artifactRow = (a: AgentScreenArtifact): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'evals-agent-result';
    const head = document.createElement('div');
    head.className = 'evals-agent-result-head';
    const delta =
      a.initial && a.final
        ? `${a.initial.score.score.toFixed(3)} → ${a.final.score.score.toFixed(3)}`
        : a.final
          ? `— → ${a.final.score.score.toFixed(3)}`
          : 'no valid spec';
    head.innerHTML = `
      <span class="evals-agent-row-name">${shortId(a.screenId)}</span>
      <span class="evals-agent-outcome" data-outcome="${a.outcome}">${a.outcome}</span>
      <span class="evals-agent-delta">${delta}</span>
      <span class="evals-agent-calls">${a.toolCallsUsed}/${a.maxToolCalls} calls</span>
    `;
    row.append(head);
    if (a.initial || a.final) {
      const pair = document.createElement('div');
      pair.className = 'evals-agent-pair';
      for (const [label, v] of [
        ['initial (v1)', a.initial],
        ['final', a.final],
      ] as const) {
        const cell = document.createElement('div');
        cell.className = 'evals-agent-cell';
        const cap = document.createElement('div');
        cap.className = 'evals-agent-cell-cap';
        cap.textContent = v ? `${label} · ${v.score.score.toFixed(3)}` : label;
        const stage = document.createElement('div');
        stage.className = 'evals-agent-cell-stage';
        cell.append(cap, stage);
        if (v) mountSpec(stage, v.spec);
        pair.append(cell);
      }
      row.append(pair);
    }
    return row;
  };

  const renderResults = (run: AgentRun): void => {
    backdrop.innerHTML = '';
    const modal = document.createElement('div');
    modal.className = 'evals-modal evals-agent-modal evals-agent-wide';
    const finished = run.artifacts.filter((a) => a.final).length;
    modal.innerHTML = `
      <h2 class="evals-modal-title">Run complete — <span data-role="model"></span></h2>
      <p class="evals-modal-sub">
        ${finished}/${run.artifacts.length} screens produced a final spec · saved to this browser
        (last 5 agent runs are kept).
      </p>
      <div class="evals-agent-results" data-role="results"></div>
      <div class="evals-modal-actions">
        <button type="button" class="evals-btn secondary" data-act="export-training">Training JSONL</button>
        <button type="button" class="evals-btn secondary" data-act="export-sft">SFT JSONL</button>
        <button type="button" class="evals-btn secondary" data-act="export-full">Full JSON</button>
        <button type="button" class="evals-btn" data-act="close">Close</button>
      </div>
    `;
    modal.querySelector('[data-role="model"]')!.textContent = run.model;
    backdrop.append(modal);
    const results = modal.querySelector<HTMLElement>('[data-role="results"]')!;
    for (const a of run.artifacts) results.append(artifactRow(a));

    modal.querySelector('[data-act="export-training"]')?.addEventListener('click', () =>
      downloadText(`${run.runId}-training.jsonl`, trainingJsonl(run) + '\n', 'application/x-ndjson'),
    );
    modal.querySelector('[data-act="export-sft"]')?.addEventListener('click', () =>
      downloadText(`${run.runId}-sft.jsonl`, sftJsonl(run) + '\n', 'application/x-ndjson'),
    );
    modal.querySelector('[data-act="export-full"]')?.addEventListener('click', () =>
      downloadText(`${run.runId}.json`, JSON.stringify(run, null, 2)),
    );
    modal.querySelector('[data-act="close"]')?.addEventListener('click', close);
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.body.append(backdrop);
  renderConfig();
}
