/**
 * Resolve which screens an agent run should author, and the shared scope
 * picker UI used by New run + Agent run modals.
 *
 * Targets are always chosen explicitly in the dialog (artist / benchmark /
 * screen) — never implied by "whatever happens to be selected in the grid".
 */
import type { getCatalog } from './catalog';
import type { AgentScope } from './types';
import type { AgentRunTarget } from './agent-run';

export type EvalCatalog = ReturnType<typeof getCatalog>;

export interface AgentTargetContext {
  catalog: EvalCatalog;
  screenId: string | null;
  benchmarkId: string;
  artistId: string;
}

export interface AgentTargetSelection {
  scope: AgentScope;
  artistId: string;
  benchmarkId: string;
  screenId: string | null;
}

const SCOPE_OPTIONS: Array<{ id: AgentScope; label: string }> = [
  { id: 'benchmark', label: 'One benchmark × every artist' },
  { id: 'artist', label: "One artist's benchmarks" },
  { id: 'screen', label: 'One screen' },
  { id: 'suite', label: 'Full suite (expensive)' },
];

export function resolveAgentTargets(
  ctx: AgentTargetContext,
  scope: AgentScope,
): AgentRunTarget[] {
  const { catalog } = ctx;
  const profileOf = (artistId: string) => catalog.artists.find((a) => a.id === artistId)!;
  const benchOf = (screenId: string) =>
    catalog.benchmarks.find((b) => b.id === screenId) ?? null;
  const toTarget = (s: (typeof catalog.screens)[number]): AgentRunTarget => ({
    screen: s,
    profile: profileOf(s.artistId),
    benchmark: s.kind === 'benchmark' ? benchOf(s.screenId) : null,
  });
  if (scope === 'screen') {
    const s = catalog.screens.find((x) => x.id === ctx.screenId) ?? catalog.screens[0]!;
    return [toTarget(s)];
  }
  if (scope === 'benchmark') {
    return catalog.screens
      .filter((s) => s.kind === 'benchmark' && s.screenId === ctx.benchmarkId)
      .map(toTarget);
  }
  if (scope === 'artist') {
    return (catalog.screensByArtist.get(ctx.artistId) ?? [])
      .filter((s) => s.kind === 'benchmark')
      .map(toTarget);
  }
  return catalog.screens.map(toTarget);
}

function fillSelect(
  select: HTMLSelectElement,
  options: Array<{ value: string; label: string }>,
  selected: string | null,
): void {
  select.replaceChildren(
    ...options.map((o) => {
      const el = document.createElement('option');
      el.value = o.value;
      el.textContent = o.label;
      if (o.value === selected) el.selected = true;
      return el;
    }),
  );
}

/**
 * Mount scope + target pickers into `host`. Returns a `read()` that always
 * reflects the current form state, and syncs visibility / estimate on change.
 */
export function mountAgentScopeControls(
  host: HTMLElement,
  catalog: EvalCatalog,
  initial: AgentTargetSelection,
  opts: { maxCallsInput?: HTMLInputElement | null; estimateHost?: HTMLElement | null } = {},
): { read: () => AgentTargetSelection; sync: () => void } {
  host.replaceChildren();
  host.classList.add('evals-agent-targets');

  const scopeField = document.createElement('label');
  scopeField.className = 'evals-field';
  scopeField.innerHTML = `What to author<select name="agentScope"></select>`;
  const scopeSelect = scopeField.querySelector('select')!;
  fillSelect(
    scopeSelect,
    SCOPE_OPTIONS.map((o) => ({ value: o.id, label: o.label })),
    initial.scope,
  );

  const artistField = document.createElement('label');
  artistField.className = 'evals-field';
  artistField.dataset.role = 'target-artist';
  artistField.innerHTML = `Artist<select name="targetArtist"></select>`;
  const artistSelect = artistField.querySelector('select')!;
  fillSelect(
    artistSelect,
    catalog.artists.map((a) => ({ value: a.id, label: `${a.artist} · ${a.movement}` })),
    initial.artistId,
  );

  const benchField = document.createElement('label');
  benchField.className = 'evals-field';
  benchField.dataset.role = 'target-benchmark';
  benchField.innerHTML = `Benchmark<select name="targetBenchmark"></select>`;
  const benchSelect = benchField.querySelector('select')!;
  fillSelect(
    benchSelect,
    catalog.benchmarks.map((b) => ({ value: b.id, label: b.title })),
    initial.benchmarkId,
  );

  const screenField = document.createElement('label');
  screenField.className = 'evals-field';
  screenField.dataset.role = 'target-screen';
  screenField.innerHTML = `Screen<select name="targetScreen"></select>`;
  const screenSelect = screenField.querySelector('select')!;

  const row = document.createElement('div');
  row.className = 'evals-field-row evals-agent-target-row';
  row.append(artistField, benchField, screenField);

  const estimate =
    opts.estimateHost ??
    (() => {
      const p = document.createElement('p');
      p.className = 'evals-agent-estimate';
      p.dataset.role = 'scope-estimate';
      return p;
    })();

  host.append(scopeField, row);
  if (!opts.estimateHost) host.append(estimate);

  const paintScreens = (): void => {
    const artistId = artistSelect.value;
    const works = catalog.screensByArtist.get(artistId) ?? [];
    const preferred =
      screenSelect.value ||
      initial.screenId ||
      works.find((s) => s.kind === 'benchmark' && s.screenId === benchSelect.value)?.id ||
      works[0]?.id ||
      null;
    fillSelect(
      screenSelect,
      works.map((s) => ({
        value: s.id,
        label: `${s.kind === 'benchmark' ? 'Bench' : 'Sig'} · ${s.title}`,
      })),
      preferred,
    );
  };

  const read = (): AgentTargetSelection => ({
    scope: (scopeSelect.value as AgentScope) || 'benchmark',
    artistId: artistSelect.value || catalog.artists[0]!.id,
    benchmarkId: benchSelect.value || catalog.benchmarks[0]!.id,
    screenId: screenSelect.value || null,
  });

  const sync = (): void => {
    const sel = read();
    artistField.hidden = sel.scope !== 'artist' && sel.scope !== 'screen';
    benchField.hidden = sel.scope !== 'benchmark';
    screenField.hidden = sel.scope !== 'screen';
    if (sel.scope === 'screen') paintScreens();

    const ctx: AgentTargetContext = {
      catalog,
      artistId: sel.artistId,
      benchmarkId: sel.benchmarkId,
      screenId: sel.screenId,
    };
    const n = resolveAgentTargets(ctx, sel.scope).length;
    const calls = Math.max(1, Number(opts.maxCallsInput?.value) || 20);
    estimate.textContent =
      `${n} screen${n === 1 ? '' : 's'} · up to ${calls} tool calls each (serial, abortable). ` +
      `Scores stay local.`;
  };

  scopeSelect.addEventListener('change', sync);
  artistSelect.addEventListener('change', () => {
    paintScreens();
    sync();
  });
  benchSelect.addEventListener('change', sync);
  screenSelect.addEventListener('change', sync);
  opts.maxCallsInput?.addEventListener('input', sync);

  paintScreens();
  sync();
  return { read, sync };
}
