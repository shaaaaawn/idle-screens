import type { ChatMessage, ChatServed } from './openrouter';
import type { SaverSpec } from '@idle-screens/schema';
import type { ScreenScore } from './types';

/** One accepted candidate: v1 is the initial artifact, the last is the final. */
export interface AgentSpecVersion {
  n: number;
  spec: SaverSpec;
  /** Locally computed — never the model's self-assessment. */
  score: ScreenScore;
}

/**
 * A submission that never became a version.
 *
 * These are the cheapest negatives the loop will ever produce: a spec, the
 * validator's exact complaint, and usually the corrected spec a few messages
 * later. For a model learning to author SaverSpec that triple teaches more than
 * any success does — so it is recorded structurally instead of being left
 * buried in the trajectory as a tool-result string.
 *
 * Deliberately NOT folded into `versions[]`. The model is told "each valid
 * submission is versioned (v1, v2, …)" and sees those numbers come back in tool
 * results, so `versions` has to keep meaning exactly that. Downstream consumers
 * (`agent-bridge`, the compare grid) also render `final.spec` directly and must
 * never be handed something that failed validation.
 */
export interface AgentRejection {
  /** How many versions existed when this was rejected — locates it in the run. */
  afterVersion: number;
  /** The submitted value. `unknown` because it may not be a well-formed spec. */
  spec: unknown;
  reason: 'invalid-json' | 'schema';
  /** `path: message`, exactly as the model saw them. */
  validationErrors: string[];
}

export type AgentOutcome = 'finished' | 'max-calls' | 'aborted' | 'error';

/**
 * The training-set record for one screen: what the model was asked, every
 * step it took, and the scored artifacts of the loop.
 */
export interface AgentScreenArtifact {
  screenId: string;
  artistId: string;
  benchmarkId: string;
  /** The model id REQUESTED. See `served` for what actually answered. */
  model: string;
  /**
   * What the API reported serving, merged across rounds. Absent for scripted
   * transports and for artifacts recorded before this was captured.
   */
  served?: ChatServed;
  /** 0-based repeat index when a target is run more than once. */
  trial: number;
  maxToolCalls: number;
  toolCallsUsed: number;
  startedAt: string;
  finishedAt: string;
  prompt: { system: string; user: string };
  trajectory: ChatMessage[];
  versions: AgentSpecVersion[];
  /** Submissions the validator refused. */
  rejections: AgentRejection[];
  initial: AgentSpecVersion | null;
  /**
   * The LAST accepted version — what the model chose to end on.
   *
   * Not necessarily its best: a model can refine v2 into a worse v3 and finish
   * there. Kept because what it settled on is a real signal about its own
   * judgement, and losing that would hide a genuine failure mode.
   */
  final: AgentSpecVersion | null;
  /**
   * The HIGHEST-scoring accepted version — ties go to the earlier one.
   *
   * This is the one to train on and the one a channel should play. Conflating
   * it with `final` means publishing regressions and labelling them the answer.
   */
  best: AgentSpecVersion | null;
  outcome: AgentOutcome;
  error?: string;
}
