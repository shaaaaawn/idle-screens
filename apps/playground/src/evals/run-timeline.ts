import {
  cachedModels,
  clearKey,
  fetchModels,
  hasKey,
  maskKey,
  providerOf,
  setKey,
  verifyKey,
  type OpenRouterModel,
} from './openrouter';
import type { VersionField } from './provenance';
import { nextCycleBrief } from './run-store';
import type { RunIndexEntry, RunSummary } from './types';

export interface ScreenDrift {
  /** False for runs recorded before per-screen fingerprints existed. */
  supported: boolean;
  changed: string[];
  added: string[];
  removed: string[];
}

export interface RunTimelineHandle {
  setRuns(runs: RunIndexEntry[]): void;
  select(runId: string | null): void;
  setProvenance(summary: RunSummary | null): void;
  /**
   * Render the selected run's versions against today's. This is what makes the
   * eval honest about age: the grid always shows current screens, so anything
   * that drifted has to be visible rather than implied.
   */
  setVersions(summary: RunSummary | null, fields: VersionField[], drift: ScreenDrift | null): void;
  selectedId(): string | null;
  dispose(): void;
}

export interface RunTimelineOptions {
  onSelect: (runId: string) => void;
  onNewRun: () => void;
  /** Re-score today's catalog — creates a NEW run rather than mutating the old. */
  onRescore: () => void;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function harnessBadge(h: string): string {
  if (h === 'playground-ui') return 'ui';
  if (h === 'headless-vitest') return 'headless';
  if (h === 'agent-loop') return 'agent';
  if (h === 'mcp') return 'mcp';
  return h;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * How many positions the rail always shows. Real runs fill from the left; the
 * remainder render as empty slots.
 *
 * A single run card told you nothing about trajectory — you couldn't see that
 * this is a *sequence* until you'd already done several cycles. Reserving the
 * slots makes the array shape visible from run one, and gives every future
 * cycle an obvious place to land.
 */
const TIMELINE_SLOTS = 6;

/** Horizontal run timeline + provenance drawer — core growth UI. */
export function buildRunTimeline(mount: HTMLElement, opts: RunTimelineOptions): RunTimelineHandle {
  mount.innerHTML = `
    <div class="evals-tl">
      <div class="evals-tl-head">
        <span class="evals-tl-title">Run timeline</span>
        <span class="evals-tl-hint">Growth over time — select a run to load scores &amp; next-cycle inputs</span>
        <button type="button" class="evals-btn" data-act="new-run">New run…</button>
      </div>
      <div class="evals-tl-rail" data-role="rail" role="list"></div>
      <div class="evals-tl-versions" data-role="versions"></div>
      <div class="evals-tl-drift" data-role="drift" hidden></div>
      <!-- Collapsed by default: expanded it took the top third of the tab,
           pushing the gallery and inspector below the fold. -->
      <details class="evals-tl-prov" data-role="prov">
        <summary>Provenance &amp; next cycle</summary>
        <pre class="evals-tl-prov-pre" data-role="prov-pre">Select a run on the timeline.</pre>
      </details>
    </div>
  `;

  const rail = mount.querySelector('[data-role="rail"]') as HTMLElement;
  const provPre = mount.querySelector('[data-role="prov-pre"]') as HTMLElement;
  const versionsEl = mount.querySelector('[data-role="versions"]') as HTMLElement;
  const driftEl = mount.querySelector('[data-role="drift"]') as HTMLElement;
  let runs: RunIndexEntry[] = [];
  let selected: string | null = null;

  mount.querySelector('[data-act="new-run"]')?.addEventListener('click', () => opts.onNewRun());

  const addLink = (): void => {
    const link = document.createElement('div');
    link.className = 'evals-tl-link';
    link.setAttribute('aria-hidden', 'true');
    rail.append(link);
  };

  const render = (): void => {
    rail.replaceChildren();

    // Oldest → newest left-to-right so growth reads forward.
    const chronological = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    chronological.forEach((r, i) => {
      if (i > 0) addLink();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'evals-tl-node';
      btn.dataset.runId = r.runId;
      btn.setAttribute('role', 'listitem');
      if (r.runId === selected) btn.classList.add('active');
      btn.innerHTML = `
        <span class="evals-tl-node-index">${i + 1}</span>
        <span class="evals-tl-node-label">${escapeHtml(r.label)}</span>
        <span class="evals-tl-node-median">${r.suiteMedian.toFixed(3)}</span>
        <span class="evals-tl-node-meta">
          <span class="evals-tl-badge">${harnessBadge(r.harness)}</span>
          ${r.model ? `<span class="evals-tl-model">${escapeHtml(r.model)}</span>` : ''}
        </span>
        <span class="evals-tl-node-date">${shortDate(r.createdAt)}</span>
        <span class="evals-tl-node-hash" title="StyleDNA hash">dna:${escapeHtml(r.styleDnaHash.slice(0, 6))}</span>
      `;
      btn.addEventListener('click', () => opts.onSelect(r.runId));
      rail.append(btn);
    });

    // Reserve the remaining positions. The next one up is the live target and
    // reads as such; the rest sit quiet so they suggest capacity without
    // competing with real results.
    for (let i = chronological.length; i < TIMELINE_SLOTS; i++) {
      if (i > 0) addLink();
      const isNext = i === chronological.length;
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = `evals-tl-node evals-tl-slot${isNext ? ' next' : ''}`;
      slot.dataset.slot = String(i + 1);
      slot.setAttribute('role', 'listitem');
      slot.title = isNext
        ? `Run ${i + 1} — start the next cycle`
        : `Run ${i + 1} — open once the previous cycles land`;
      slot.innerHTML = `
        <span class="evals-tl-node-index">${i + 1}</span>
        <span class="evals-tl-slot-label">${isNext ? 'Next run' : 'Empty'}</span>
        <span class="evals-tl-slot-hint">${isNext ? 'start cycle' : ''}</span>
      `;
      slot.addEventListener('click', () => opts.onNewRun());
      rail.append(slot);
    }

    const active = rail.querySelector('.evals-tl-node.active') as HTMLElement | null;
    active?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  };

  return {
    setRuns(next) {
      runs = next;
      render();
    },
    select(runId) {
      selected = runId;
      rail.querySelectorAll('.evals-tl-node').forEach((n) => {
        n.classList.toggle('active', (n as HTMLElement).dataset.runId === runId);
      });
    },
    setProvenance(summary) {
      provPre.textContent = summary ? nextCycleBrief(summary) : 'Select a run on the timeline.';
    },
    setVersions(summary, fields, drift) {
      versionsEl.replaceChildren();
      if (!summary) {
        driftEl.hidden = true;
        return;
      }
      const p = summary.provenance;

      const chip = (label: string, value: string, opts: { drifted?: boolean; title?: string } = {}): void => {
        const el = document.createElement('span');
        el.className = `evals-ver-chip${opts.drifted ? ' is-drift' : ''}`;
        el.dataset.key = label;
        if (opts.title) el.title = opts.title;
        const k = document.createElement('span');
        k.className = 'evals-ver-k';
        k.textContent = label;
        const v = document.createElement('span');
        v.className = 'evals-ver-v';
        v.textContent = value;
        el.append(k, v);
        versionsEl.append(el);
      };

      // What produced this run — the two the user asked to see first.
      chip('model', p.model ? `${p.model.name}${p.model.provider ? ` (${p.model.provider})` : ''}` : 'not recorded');
      chip('harness', p.harness);

      for (const f of fields) {
        const value = f.recorded ?? 'not recorded';
        chip(f.label, f.key === 'styleDna' ? value.slice(0, 8) : value, {
          drifted: f.drifted,
          title: f.drifted
            ? `${f.label}: this run used ${f.recorded}; today's build is ${f.current}`
            : `${f.label}: ${f.recorded ?? 'not recorded by this run'}`,
        });
      }
      if (p.prompts.systemPromptHash) chip('prompt', p.prompts.systemPromptHash.slice(0, 8));
      if (p.parentRunId) chip('parent', p.parentRunId.replace(/^run-/, '').slice(0, 14));

      // The banner: say plainly that what is on screen is not what was scored.
      const versionDrift = fields.filter((f) => f.drifted);
      const changed = drift?.changed.length ?? 0;
      const added = drift?.added.length ?? 0;
      const removed = drift?.removed.length ?? 0;
      const parts: string[] = [];
      if (versionDrift.length) {
        parts.push(
          versionDrift.map((f) => `${f.label} ${f.recorded} → ${f.current}`).join(' · '),
        );
      }
      if (drift && !drift.supported) {
        parts.push('this run predates per-screen fingerprints, so which screens changed is unknown');
      } else if (changed || added || removed) {
        const bits = [
          changed ? `${changed} screen${changed === 1 ? '' : 's'} changed` : '',
          added ? `${added} added` : '',
          removed ? `${removed} removed` : '',
        ].filter(Boolean);
        parts.push(bits.join(', '));
      }

      if (!parts.length) {
        driftEl.hidden = true;
        driftEl.replaceChildren();
        return;
      }
      driftEl.hidden = false;
      driftEl.replaceChildren();
      const text = document.createElement('span');
      text.className = 'evals-tl-drift-text';
      text.textContent = `Showing today's screens with ${p.label}'s scores — ${parts.join('; ')}.`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'evals-btn secondary';
      btn.dataset.act = 'rescore';
      btn.textContent = 'Re-score current';
      btn.title = 'Score today’s catalog as a new run — the old run is left untouched';
      btn.addEventListener('click', () => opts.onRescore());
      driftEl.append(text, btn);
    },
    selectedId: () => selected,
    dispose() {
      mount.replaceChildren();
    },
  };
}

/**
 * Wire the model picker + connection editor. The key half lives in the shared
 * `connection-editor.ts` (the same component the Settings page mounts), so the
 * security shape is maintained in one place: the key never enters the
 * form/FormData, and the form only ever learns the model id and provider.
 */
function wireOpenRouter(root: HTMLElement, form: HTMLFormElement): void {
  const q = <T extends HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
  const modelInput = form.querySelector<HTMLInputElement>('input[name="model"]')!;
  const providerInput = form.querySelector<HTMLInputElement>('input[name="provider"]')!;
  const datalist = form.querySelector<HTMLDataListElement>('#or-model-list')!;
  const hint = q<HTMLElement>('[data-role="model-hint"]')!;
  const state = q<HTMLElement>('[data-role="conn-state"]')!;

  const paint = (models: OpenRouterModel[]): void => {
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
      : 'No model list yet — type a name, or open the connection panel to fetch one.';
  };

  // Derive the provider rather than asking for it twice; free text still works.
  modelInput.addEventListener('input', () => {
    providerInput.value = providerOf(modelInput.value.trim());
  });

  paint(cachedModels());

  buildConnectionEditor(q<HTMLElement>('[data-role="connection"]')!, {
    onModels: paint,
    onKeyChange: (stored) => {
      state.textContent = stored ? `stored · ${maskKey()}` : 'not set';
      state.classList.toggle('is-set', stored);
    },
  });
}

/** Modal form to capture provenance before scoring. */
export function promptRunRequest(defaults: {
  parentRunId?: string;
  parentLabel?: string;
}): Promise<import('./types').RunRequest | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'evals-modal-backdrop';
    backdrop.innerHTML = `
      <form class="evals-modal" data-role="form">
        <h2 class="evals-modal-title">New eval run</h2>
        <p class="evals-modal-sub">Capture harness / model / prompt so this run can feed the next cycle.</p>
        <label class="evals-field">Label
          <input name="label" required placeholder="e.g. after pulse.wave" value="" />
        </label>
        <label class="evals-field">Note (why this run)
          <textarea name="note" rows="2" placeholder="What changed since the parent run?"></textarea>
        </label>
        <div class="evals-field-row">
          <label class="evals-field">Model
            <input name="model" list="or-model-list" autocomplete="off" spellcheck="false"
                   placeholder="type to search OpenRouter models, or 'none'" />
            <datalist id="or-model-list"></datalist>
          </label>
          <label class="evals-field">Provider
            <input name="provider" readonly tabindex="-1" placeholder="derived from model id" />
          </label>
        </div>
        <p class="evals-field-hint" data-role="model-hint"></p>

        <details class="evals-conn">
          <summary>OpenRouter connection <span class="evals-conn-state" data-role="conn-state"></span></summary>
          <div class="evals-conn-body">
            <label class="evals-field">API key
              <!-- Deliberately no name= : FormData must never carry the key, so
                   it cannot reach RunRequest / provenance / exports by accident. -->
              <input type="password" autocomplete="off" spellcheck="false"
                     data-role="or-key" placeholder="sk-or-v1-…" />
            </label>
            <div class="evals-conn-actions">
              <button type="button" class="evals-btn secondary" data-act="key-save">Save key</button>
              <button type="button" class="evals-btn secondary" data-act="key-verify">Verify</button>
              <button type="button" class="evals-btn secondary" data-act="key-clear">Clear</button>
              <button type="button" class="evals-btn secondary" data-act="models-refresh">Refresh models</button>
            </div>
            <p class="evals-conn-note">
              Stored in this browser only (localStorage, this origin) — there is no server here.
              Browsing models sends no credential; the key is transmitted only when you press Verify,
              and never enters run provenance or an exported example. Any script on this origin can
              read localStorage, so treat it like any other browser-stored token.
            </p>
            <p class="evals-conn-msg" data-role="conn-msg"></p>
          </div>
        </details>
        <label class="evals-field">Operator
          <input name="operator" placeholder="your name or agent id" />
        </label>
        <label class="evals-field">System / authoring prompt
          <textarea name="systemPrompt" rows="4" placeholder="Paste the system prompt or authoring brief used for DNA/screens this cycle…"></textarea>
        </label>
        <p class="evals-modal-parent">${
          defaults.parentRunId
            ? `Parent: <code>${defaults.parentLabel ?? defaults.parentRunId}</code>`
            : 'Parent: (none — this becomes a new root)'
        }</p>
        <div class="evals-modal-actions">
          <button type="button" class="evals-btn secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="evals-btn">Run suite</button>
        </div>
      </form>
    `;
    const form = backdrop.querySelector('form') as HTMLFormElement;
    const close = (value: import('./types').RunRequest | null): void => {
      backdrop.remove();
      resolve(value);
    };
    wireOpenRouter(backdrop, form);
    backdrop.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      close({
        label: String(fd.get('label') ?? '').trim() || 'playground run',
        note: String(fd.get('note') ?? '').trim(),
        harness: 'playground-ui',
        modelName: String(fd.get('model') ?? '').trim() || undefined,
        modelProvider: String(fd.get('provider') ?? '').trim() || undefined,
        operator: String(fd.get('operator') ?? '').trim() || undefined,
        systemPrompt: String(fd.get('systemPrompt') ?? '').trim() || undefined,
        parentRunId: defaults.parentRunId,
      });
    });
    document.body.append(backdrop);
    form.querySelector<HTMLInputElement>('input[name="label"]')?.focus();
  });
}
