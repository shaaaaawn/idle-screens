import type { ChatMessage } from './openrouter';
import type { SaverSpec } from '@idle-screens/schema';
import type { ScreenScore } from './types';

/** One accepted candidate: v1 is the initial artifact, the last is the final. */
export interface AgentSpecVersion {
  n: number;
  spec: SaverSpec;
  /** Locally computed — never the model's self-assessment. */
  score: ScreenScore;
}

export type AgentOutcome = 'finished' | 'max-calls' | 'aborted' | 'error';

/**
 * The training-set record for one screen: what the model was asked, every
 * step it took, and the scored first/last artifacts of the loop.
 */
export interface AgentScreenArtifact {
  screenId: string;
  artistId: string;
  benchmarkId: string;
  model: string;
  maxToolCalls: number;
  toolCallsUsed: number;
  startedAt: string;
  finishedAt: string;
  prompt: { system: string; user: string };
  trajectory: ChatMessage[];
  versions: AgentSpecVersion[];
  initial: AgentSpecVersion | null;
  final: AgentSpecVersion | null;
  outcome: AgentOutcome;
  error?: string;
}
