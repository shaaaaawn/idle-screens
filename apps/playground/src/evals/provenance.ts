import type {
  ArtistStyleProfile,
  EvalScreen,
  RunIndexEntry,
  RunProvenance,
  RunRequest,
  RunSummary,
} from './types';

export const SCORER_ID = 'style-eval-score@1';
export const SKILL_ID = 'artistic-style-schema-eval@1';
export const SKILL_PATH = '.claude/skills/artistic-style-schema-eval/SKILL.md';
export const BENCHMARK_SOURCE = 'apps/playground/src/evals/benchmarks.ts@v1';
export const STYLE_DNA_LABEL = 'artists@15';

export const DEFAULT_SCORING_BANDS: RunProvenance['scoringBands'] = {
  minCoverage: 0.002,
  minLuminanceVar: 0.00005,
  weights: { perception: 0.35, styleFit: 0.35, intentFit: 0.3 },
};

/** FNV-1a 32-bit hex — stable, no crypto dependency. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Canonical fingerprint of the StyleDNA catalog (order-stable). */
export function hashStyleDna(profiles: ArtistStyleProfile[]): string {
  const payload = profiles
    .map((p) =>
      JSON.stringify({
        id: p.id,
        artist: p.artist,
        movement: p.movement,
        research: p.research,
        palette: p.palette,
        markMaking: p.markMaking,
        motionDialect: p.motionDialect,
        composition: p.composition,
        schemaGaps: p.schemaGaps,
        durableKeys: p.durableKeys,
        // Titles are display text — they set the spec's `label` and nothing
        // else. Hashing them would move the DNA hash (and so mark every prior
        // run incomparable) on a pure rename, while the geometry, the scores
        // and the measurement are all untouched. Hash what determines a
        // screen: its id, its intent, and its recipe.
        signaturePrompts: p.signaturePrompts.map((s) => ({
          id: s.id,
          intent: s.intent,
          recipe: s.recipe,
        })),
      }),
    )
    .join('\n');
  return fnv1a(payload);
}

/** Injected by vite.config.ts — the @idle-screens/schema version in this build. */
declare const __SCHEMA_PKG_VERSION__: string;

export const SCHEMA_PKG_VERSION: string =
  typeof __SCHEMA_PKG_VERSION__ === 'string' ? __SCHEMA_PKG_VERSION__ : 'unknown';

/** Stable fingerprint of one compiled spec — see RunSummary.screenFingerprints. */
export function hashSpec(spec: unknown): string {
  return fnv1a(JSON.stringify(spec));
}

export function fingerprintScreens(screens: EvalScreen[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of screens) out[s.id] = hashSpec(s.spec);
  return out;
}

export interface VersionField {
  key: string;
  label: string;
  /** What the run recorded; null when it predates the field. */
  recorded: string | null;
  /** What this build would produce today. */
  current: string | null;
  /** Recorded and current disagree — the run is not comparable to today. */
  drifted: boolean;
}

/**
 * Compare a run's recorded versions against the live environment. Anything
 * that drifted means the screens on screen are not the screens that were
 * scored, so the UI marks it rather than quietly showing both together.
 */
export function compareVersions(
  recorded: RunProvenance['versions'],
  current: RunProvenance['versions'],
): VersionField[] {
  const field = (key: string, label: string, a: unknown, b: unknown): VersionField => {
    const rec = a == null ? null : String(a);
    const cur = b == null ? null : String(b);
    return { key, label, recorded: rec, current: cur, drifted: rec != null && cur != null && rec !== cur };
  };
  return [
    field('styleDna', 'StyleDNA', recorded.styleDnaHash, current.styleDnaHash),
    field('styleDnaLabel', 'DNA set', recorded.styleDnaLabel, current.styleDnaLabel),
    field('saverSpecFormat', 'SaverSpec format', `v${recorded.saverSpecFormat}`, `v${current.saverSpecFormat}`),
    field('schemaPackage', 'schema pkg', recorded.schemaPackage, current.schemaPackage),
    field('scorer', 'Scorer', recorded.scorer, current.scorer),
    field('skill', 'Skill', recorded.skill, current.skill),
  ];
}

/** Which screens are no longer the ones the run measured. */
export function driftedScreens(
  recorded: Record<string, string> | undefined,
  current: Record<string, string>,
): { supported: boolean; changed: string[]; added: string[]; removed: string[] } {
  if (!recorded) return { supported: false, changed: [], added: [], removed: [] };
  const changed: string[] = [];
  const added: string[] = [];
  for (const [id, hash] of Object.entries(current)) {
    const was = recorded[id];
    if (was == null) added.push(id);
    else if (was !== hash) changed.push(id);
  }
  const removed = Object.keys(recorded).filter((id) => current[id] == null);
  return { supported: true, changed, added, removed };
}

export function buildProvenance(
  profiles: ArtistStyleProfile[],
  req: RunRequest,
  opts: { saverSpecFormat?: number } = {},
): RunProvenance {
  const systemPrompt = req.systemPrompt?.trim() || undefined;
  return {
    harness: req.harness,
    label: req.label.trim() || 'untitled run',
    note: req.note.trim() || '',
    model: req.modelName
      ? { name: req.modelName.trim(), provider: req.modelProvider?.trim() || undefined }
      : undefined,
    operator: req.operator?.trim() || undefined,
    parentRunId: req.parentRunId,
    versions: {
      styleDnaHash: hashStyleDna(profiles),
      styleDnaLabel: STYLE_DNA_LABEL,
      // Read off the specs rather than hardcoded, so a format bump is recorded
      // the moment the catalog emits it.
      saverSpecFormat: opts.saverSpecFormat ?? 1,
      schemaPackage: SCHEMA_PKG_VERSION,
      scorer: SCORER_ID,
      skill: SKILL_ID,
    },
    prompts: {
      systemPrompt: systemPrompt && systemPrompt.length > 4000 ? systemPrompt.slice(0, 4000) : systemPrompt,
      systemPromptHash: systemPrompt ? fnv1a(systemPrompt) : undefined,
      skillPath: SKILL_PATH,
      benchmarkSource: BENCHMARK_SOURCE,
    },
    scoringBands: DEFAULT_SCORING_BANDS,
  };
}

export function suggestedActionsFrom(summary: Pick<RunSummary, 'nextCycle' | 'failures' | 'delta'>): string[] {
  const actions: string[] = [];
  if (summary.nextCycle.collapsedBenchmarks.length) {
    actions.push(
      `Diversify applicator recipes for collapsed benchmarks: ${summary.nextCycle.collapsedBenchmarks.join(', ')}`,
    );
  }
  if (summary.nextCycle.weakArtists.length) {
    actions.push(`Revisit StyleDNA for weak artists: ${summary.nextCycle.weakArtists.join(', ')}`);
  }
  if (summary.nextCycle.topGaps[0]) {
    actions.push(`Graduate top schema gap → spec-feature-pipeline: ${summary.nextCycle.topGaps[0]}`);
  }
  if (summary.failures.length) {
    actions.push(`Inspect ${summary.failures.length} failing screen(s) (validate or score < 0.35)`);
  }
  if (summary.delta && summary.delta.suiteMedianDelta < -0.02) {
    actions.push(`Regressed ${summary.delta.suiteMedianDelta.toFixed(3)} vs ${summary.delta.vsRunId} — bisect DNA/scorer change`);
  }
  if (actions.length === 0) {
    actions.push('Suite healthy — extend catalog or tighten intent checks');
  }
  return actions;
}

export function toIndexEntry(summary: RunSummary, storage: 'disk' | 'browser'): RunIndexEntry {
  return {
    runId: summary.runId,
    createdAt: summary.createdAt,
    label: summary.provenance.label,
    harness: summary.provenance.harness,
    model: summary.provenance.model?.name,
    suiteMedian: summary.suiteMedian,
    styleDnaHash: summary.provenance.versions.styleDnaHash,
    parentRunId: summary.provenance.parentRunId,
    storage,
  };
}

export function computeDelta(current: RunSummary, parent: RunSummary): NonNullable<RunSummary['delta']> {
  const curFail = new Set(current.failures.map((f) => f.screenId));
  const prevFail = new Set(parent.failures.map((f) => f.screenId));
  const newlyFailing = [...curFail].filter((id) => !prevFail.has(id));
  const newlyPassing = [...prevFail].filter((id) => !curFail.has(id));

  const prevGaps = new Map(parent.gapHistogram.map((g) => [g.gap, g.count]));
  const gapDelta = current.gapHistogram.map((g) => ({
    gap: g.gap,
    countDelta: g.count - (prevGaps.get(g.gap) ?? 0),
  }));

  return {
    vsRunId: parent.runId,
    suiteMedianDelta: current.suiteMedian - parent.suiteMedian,
    newlyFailing,
    newlyPassing,
    gapDelta,
  };
}
