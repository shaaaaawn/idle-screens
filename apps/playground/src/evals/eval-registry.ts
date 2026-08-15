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
  | 'style-authoring-holdout-v1'
  | 'preset-recipe-v1';

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
  /**
   * Fixture axes, JSON-encoded on ONE line. A string, deliberately: the
   * idle-mono planner reads this file with anchored regexes rather than a TS
   * toolchain (parse-don't-execute), and a single-quoted one-line JSON string
   * is the shape that contract can carry losslessly. Each axis:
   *   { "key": string,          // param name a launcher passes
   *     "label": string,        // picker label
   *     "source": "artists" | "savers-steerable" | "inline",
   *     "values"?: string[],    // when source is "inline"
   *     "all"?: boolean }       // offer a full-matrix option
   * A launcher renders one picker per axis and scopes the run prompt with the
   * chosen values — no launcher code is specific to any one eval.
   */
  axes?: string;
  /** Playbook the run must follow — a repo-relative doc/skill path. */
  runner?: string;
  /** What the run needs to touch: nothing, or a disposable local channel. */
  runTarget?: 'none' | 'local-channel';
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
    axes: '[{"key":"artist","label":"style","source":"artists","all":true}]',
    runner: 'idle-screens/.claude/skills/artistic-style-schema-eval',
    runTarget: 'none',
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
    // No artist axis on purpose: the house styles are the held-out secret, so
    // a launcher may only offer the full set, never name one.
    runner: 'idle-screens/.claude/skills/artistic-style-schema-eval',
    runTarget: 'none',
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
    runner: 'idle-mono/.pi/skills/idle-steering/SKILL.md',
    runTarget: 'local-channel',
  },
  {
    id: 'preset-recipe-v1',
    title: 'Preset recipes for steerable savers',
    measures:
      'Given only a saver’s paramSpace, can a model author a wardrobe of named presets that are valid, diverse, and use the space?',
    harness: 'agent-loop',
    // 14 steerable savers x 5 presets each. The fixture axis is the saver;
    // the deliverable per fixture is a preset set, scored mechanically.
    fixtures: 14,
    // paramSpaces ship in this repo and the scorer is pure arithmetic, so
    // there is nothing to contaminate: the eval measures whether a model can
    // read a parameter contract and exercise it, not whether it has seen one.
    visibility: 'public',
    baseline: null,
    // Winning presets become the saver's shelf — that is the showcase.
    channelEligible: true,
    datasetLicense: 'CC-BY-4.0',
    axes: '[{"key":"saver","label":"saver","source":"savers-steerable","all":true}]',
    runner: 'idle-screens/apps/playground/src/evals/preset-recipe/README.md',
    runTarget: 'none',
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
