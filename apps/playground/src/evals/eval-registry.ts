/**
 * The canonical list of evals. One entry per suite, stable ids, never renamed
 * once published.
 *
 * This is the spine: the dataset envelope stamps `evalId` on every record, and
 * public channel ids derive from `channelEligible` entries. Without it, two
 * suites invent two record shapes and a channel id is whatever someone typed.
 *
 * Spec: `idle-mono/docs/eval-publishing-spec.md` §2.
 */
import type { EvalHarness } from './types';

export type EvalId =
  | 'style-authoring-v1'
  | 'mcp-comprehension-v1'
  | 'style-authoring-holdout-v1';

export interface EvalDefinition {
  id: EvalId;
  title: string;
  /** One sentence a non-expert can read. */
  measures: string;
  harness: EvalHarness;
  fixtures: number;
  /**
   * `public`   — fixtures AND rubric are in this repo. Assume every frontier
   *              model has seen them; scores measure instruction-following,
   *              not recall.
   * `held-out` — fixtures live outside any published repo and never ship. Only
   *              aggregate scores are published. This is the contamination
   *              control, and it only works if it is never relaxed.
   */
  visibility: 'public' | 'held-out';
  /** Locked once recorded. Re-measured, never edited. */
  baseline: { runId: string; median: number; recordedAt: string } | null;
  /** Whether this eval's output may drive a public channel. */
  channelEligible: boolean;
  datasetLicense: 'CC-BY-4.0' | 'none';
}

export const EVALS: readonly EvalDefinition[] = [
  {
    id: 'style-authoring-v1',
    title: 'Artistic style authoring',
    measures:
      'Given a style profile and a composition brief, can a model author a valid SaverSpec that reads as that style?',
    harness: 'agent-loop',
    fixtures: 150,
    // The rubric (benchmarks.ts), the scorer (score.ts) and the style profiles
    // (artists.ts) are all in this public repo, and agent-loop.ts injects the
    // whole of FORMAT.md into the system prompt. Contaminated by construction —
    // which is fine, as long as nobody reads the scores as latent knowledge.
    visibility: 'public',
    baseline: {
      runId: 'run-2026-07-25T1908-baseline-v0',
      median: 0.9288333333333333,
      recordedAt: '2026-07-25T19:08:43.280Z',
    },
    channelEligible: true,
    datasetLicense: 'CC-BY-4.0',
  },
  {
    id: 'style-authoring-holdout-v1',
    title: 'House style authoring (held out)',
    measures:
      'The same task on original house styles no model can have priors for — so only DNA-following can score well.',
    harness: 'agent-loop',
    // 6 house styles x (5 shared benchmarks + 5 signatures). The DNA lives in
    // idle-mono/evals-holdout/ and is loaded via IDLE_EVAL_HOLDOUT_DIR; this
    // repo carries the loader only.
    fixtures: 60,
    visibility: 'held-out',
    // Applicator calibration (not a model score): house median 0.936 vs the
    // published suite's 0.929, so the two sets are equally hard to satisfy
    // mechanically. That is what licenses reading a model's gap as priors.
    baseline: null,
    // Playing held-out fixtures on a public channel would publish them, which
    // is the one thing that destroys this eval.
    channelEligible: false,
    datasetLicense: 'none',
  },
  {
    id: 'mcp-comprehension-v1',
    title: 'MCP scene comprehension',
    measures:
      'Can a non-vision agent understand and steer a scene through the MCP perception surface?',
    harness: 'mcp',
    fixtures: 0,
    visibility: 'held-out',
    baseline: null,
    // Its output is prose about a scene, not a scene.
    channelEligible: false,
    datasetLicense: 'none',
  },
];

const BY_ID = new Map(EVALS.map((e) => [e.id, e]));

export function getEval(id: EvalId): EvalDefinition {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown evalId: ${id}`);
  return found;
}

/**
 * Guard for the publish path. A held-out eval reaching a channel would leak the
 * fixtures it exists to protect, so this is a correctness check, not a policy
 * preference.
 */
export function isChannelEligible(id: EvalId): boolean {
  return BY_ID.get(id)?.channelEligible === true;
}
