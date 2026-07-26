import diskIndex from './runs/index.json' with { type: 'json' };
import baselineSummary from './runs/run-2026-07-25T1908-baseline-v0/summary.json' with { type: 'json' };
import { toIndexEntry } from './provenance';
import type { EvalScreen, RunIndexEntry, RunSummary, ScreenScore } from './types';

export { toIndexEntry };

const LS_INDEX = 'idle-screens:style-eval:run-index';
const LS_RUN_PREFIX = 'idle-screens:style-eval:run:';

export interface StoredRun {
  summary: RunSummary;
  results: ScreenScore[];
  /**
   * Model-authored screens from an OpenRouter agent-loop run. When present,
   * the compare grid renders THESE specs (the run's evidence), not today's
   * catalog applicator output.
   */
  authoredScreens?: EvalScreen[];
  /** Cross-link to the full trajectory store (`agent-run.ts`). */
  agentRunId?: string;
}

type DiskIndexFile = { runs: RunIndexEntry[] };

const DISK_INDEX = diskIndex as DiskIndexFile;
const DISK_SUMMARIES: Record<string, RunSummary> = {
  [baselineSummary.runId]: baselineSummary as RunSummary,
};

function readBrowserIndex(): RunIndexEntry[] {
  try {
    const raw = localStorage.getItem(LS_INDEX);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RunIndexEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBrowserIndex(entries: RunIndexEntry[]): void {
  localStorage.setItem(LS_INDEX, JSON.stringify(entries));
}

/** Merge disk catalog + browser-local runs, newest first. */
export function listRuns(): RunIndexEntry[] {
  const disk = DISK_INDEX.runs.map((r) => ({ ...r, storage: 'disk' as const }));
  const browser = readBrowserIndex().map((r) => ({ ...r, storage: 'browser' as const }));
  const byId = new Map<string, RunIndexEntry>();
  for (const r of [...disk, ...browser]) byId.set(r.runId, r);
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function loadRun(runId: string): StoredRun | null {
  const disk = DISK_SUMMARIES[runId];
  if (disk) {
    // Results for disk baselines are large; scores in the UI can re-derive or
    // stay empty until a fresh suite run. Index still shows the median.
    return { summary: disk, results: [] };
  }
  try {
    const raw = localStorage.getItem(LS_RUN_PREFIX + runId);
    if (!raw) return null;
    return JSON.parse(raw) as StoredRun;
  } catch {
    return null;
  }
}

export function saveBrowserRun(
  summary: RunSummary,
  results: ScreenScore[],
  extras?: Pick<StoredRun, 'authoredScreens' | 'agentRunId'>,
): RunIndexEntry {
  const entry = toIndexEntry(summary, 'browser');
  const payload: StoredRun = {
    summary,
    results,
    ...(extras?.authoredScreens ? { authoredScreens: extras.authoredScreens } : {}),
    ...(extras?.agentRunId ? { agentRunId: extras.agentRunId } : {}),
  };
  localStorage.setItem(LS_RUN_PREFIX + summary.runId, JSON.stringify(payload));
  const idx = readBrowserIndex().filter((r) => r.runId !== summary.runId);
  idx.unshift(entry);
  writeBrowserIndex(idx.slice(0, 40)); // keep last 40 browser runs
  return entry;
}

/** Format a compact next-cycle brief for the provenance drawer. */
export function nextCycleBrief(summary: RunSummary): string {
  const p = summary.provenance;
  const lines = [
    `# ${p.label} (${summary.runId})`,
    '',
    `Median **${summary.suiteMedian.toFixed(3)}**` +
      (summary.delta
        ? ` · Δ ${summary.delta.suiteMedianDelta >= 0 ? '+' : ''}${summary.delta.suiteMedianDelta.toFixed(3)} vs ${summary.delta.vsRunId}`
        : ''),
    '',
    `Harness: \`${p.harness}\`` + (p.model ? ` · Model: \`${p.model.name}\`` : ''),
    `StyleDNA: \`${p.versions.styleDnaLabel}\` · hash \`${p.versions.styleDnaHash}\``,
    `SaverSpec v${p.versions.saverSpecFormat} · Scorer \`${p.versions.scorer}\` · Skill \`${p.versions.skill}\``,
    '',
    p.note ? `Note: ${p.note}` : 'Note: (none)',
    '',
    '## Next cycle actions',
    ...summary.nextCycle.suggestedActions.map((a, i) => `${i + 1}. ${a}`),
    '',
    '## Weak artists',
    summary.nextCycle.weakArtists.length
      ? summary.nextCycle.weakArtists.map((a) => `- ${a}`).join('\n')
      : '- (none)',
    '',
    '## Collapsed benchmarks',
    summary.nextCycle.collapsedBenchmarks.length
      ? summary.nextCycle.collapsedBenchmarks.map((b) => `- ${b}`).join('\n')
      : '- (none)',
    '',
    '## Top gaps',
    ...summary.nextCycle.topGaps.map((g) => `- ${g}`),
  ];
  if (p.prompts.systemPrompt) {
    lines.push('', '## System prompt (excerpt)', '```', p.prompts.systemPrompt.slice(0, 1200), '```');
  }
  return lines.join('\n');
}
