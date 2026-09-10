/**
 * The two agent-loop experiment switches as form controls, shared by the
 * Agent run… modal and the New run dialog so both offer exactly the same
 * options and parse them the same way. Defaults reproduce today's behaviour.
 */
import { ALL_AGENT_TOOLS } from './agent-loop';
import type { AgentToolName, SchemaMode } from './types';

export interface AgentSwitches {
  tools: AgentToolName[];
  schemaMode: SchemaMode;
}

export const AGENT_TOOL_PRESETS: ReadonlyArray<{ id: string; label: string; tools: readonly AgentToolName[] }> = [
  { id: 'all', label: 'submit + perceive + score + finish (default)', tools: ALL_AGENT_TOOLS },
  { id: 'no-score', label: 'no score — honest baseline (TR2)', tools: ['submit_spec', 'perceive', 'finish'] },
  { id: 'submit-only', label: 'submit + finish only', tools: ['submit_spec', 'finish'] },
];

const SCHEMA_MODES: ReadonlyArray<{ id: SchemaMode; label: string }> = [
  { id: 'full', label: 'full FORMAT.md (default)' },
  { id: 'allowlist', label: 'allowlist — per-style subset (TR1)' },
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** Two `<label class="evals-field">` selects, `name="agentTools"` and `name="schemaMode"`. */
export function agentSwitchesMarkup(): string {
  const tools = AGENT_TOOL_PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
  const modes = SCHEMA_MODES.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('');
  return `
      <div class="evals-field-row">
        <label class="evals-field">Tools
          <select name="agentTools">${tools}</select>
        </label>
        <label class="evals-field">Format reference
          <select name="schemaMode">${modes}</select>
        </label>
      </div>`;
}

/** Parse the selects back; anything missing or unknown falls back to the default. */
export function readAgentSwitches(root: ParentNode): AgentSwitches {
  const toolsId = root.querySelector<HTMLSelectElement>('select[name="agentTools"]')?.value;
  const modeId = root.querySelector<HTMLSelectElement>('select[name="schemaMode"]')?.value;
  const preset = AGENT_TOOL_PRESETS.find((p) => p.id === toolsId) ?? AGENT_TOOL_PRESETS[0]!;
  const mode = SCHEMA_MODES.find((m) => m.id === modeId)?.id ?? 'full';
  return { tools: [...preset.tools], schemaMode: mode };
}
