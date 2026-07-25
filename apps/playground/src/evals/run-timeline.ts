import { nextCycleBrief } from './run-store';
import type { RunIndexEntry, RunSummary } from './types';

export interface RunTimelineHandle {
  setRuns(runs: RunIndexEntry[]): void;
  select(runId: string | null): void;
  setProvenance(summary: RunSummary | null): void;
  selectedId(): string | null;
  dispose(): void;
}

export interface RunTimelineOptions {
  onSelect: (runId: string) => void;
  onNewRun: () => void;
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
    selectedId: () => selected,
    dispose() {
      mount.replaceChildren();
    },
  };
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
            <input name="model" placeholder="e.g. claude-opus-4 / gpt-5 / none" />
          </label>
          <label class="evals-field">Provider
            <input name="provider" placeholder="anthropic / openai / …" />
          </label>
        </div>
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
