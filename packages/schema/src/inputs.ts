/**
 * `inputs` — live data a host feeds a scene, declared by the scene itself.
 *
 * A scene says what data it takes and how that data paints it; a host (the
 * Mac app watching local coding agents, a dashboard, a build light) says
 * nothing about the scene and just calls `inputTrack(spec, name, value)` then
 * `instance.applyTrack(track)`. Everything happens in the page — the same
 * steering path a channel uses, so local feeding and remote steering compose.
 *
 * Every binding must be PAINT (colours, glyphs, strings, bar values…): an
 * input moves a scene between looks, it never rebuilds it. `checkInputs`
 * proves that once, at compile time; `validateSpec` checks only shape, so a
 * per-steer validation stays cheap.
 *
 * Privacy is structural: a roster item carries `slot`, `state`, `label`,
 * `count` and `level` and nothing else, and a binding may template only
 * `{i}`, `{label}`, `{verb}` and `{count}`.
 */
import type { ControlTrack } from '@idle-screens/core';
import { applyDeltasToSpec, resolveSpecPath, structuralSignature, type SteerDelta } from './steer';
import type { InputBinding, RosterInput, RosterItem, SaverSpec, SpecError } from './types';

export const INPUT_LIMITS = {
  maxInputs: 4,
  maxSlots: 64,
  maxStates: 32,
  maxBindingsPerState: 64,
  maxLabel: 24,
  maxVerb: 40,
  maxCount: 8,
} as const;

const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const TOKEN = /\{([a-z]+)\}/g;
const PATH_TOKENS = new Set(['i']);
const VALUE_TOKENS = new Set(['label', 'verb', 'count']);

type Err = (path: string, message: string) => void;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function tokensOf(s: string): string[] {
  return [...s.matchAll(TOKEN)].map((m) => m[1]!);
}

function validateBindings(list: unknown, path: string, err: Err, allowSlotTokens: boolean): void {
  if (!Array.isArray(list)) return err(path, 'must be an array of {path, value}');
  if (list.length > INPUT_LIMITS.maxBindingsPerState) err(path, `at most ${INPUT_LIMITS.maxBindingsPerState} bindings`);
  list.forEach((b, k) => {
    const p = `${path}[${k}]`;
    if (!isObj(b)) return err(p, 'must be {path, value}');
    if (typeof b.path !== 'string' || b.path.length === 0 || b.path.length > 200) err(`${p}.path`, 'must be a dot-path string');
    else for (const t of tokensOf(b.path)) {
      if (!allowSlotTokens || !PATH_TOKENS.has(t)) err(`${p}.path`, `unknown token {${t}} — paths may use {i}${allowSlotTokens ? '' : ' only in per-slot bindings'}`);
    }
    const v = b.value;
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') err(`${p}.value`, 'must be a string, number or boolean');
    else if (typeof v === 'string') for (const t of tokensOf(v)) {
      if (!allowSlotTokens || !VALUE_TOKENS.has(t)) err(`${p}.value`, `unknown token {${t}} — values may use {label}, {verb}, {count}`);
    }
  });
}

/** Shape-level validation of `spec.inputs` (cheap; called by validateSpec). */
export function validateInputs(inputs: unknown, err: Err): void {
  if (!isObj(inputs)) return err('inputs', 'must be an object of named inputs');
  const names = Object.keys(inputs);
  if (names.length > INPUT_LIMITS.maxInputs) err('inputs', `at most ${INPUT_LIMITS.maxInputs} inputs`);
  for (const name of names) {
    const p = `inputs.${name}`;
    if (!NAME.test(name)) err(p, 'input names are lowercase letters, digits and dashes');
    const inp = inputs[name];
    if (!isObj(inp)) { err(p, 'must be an object'); continue; }
    if (inp.kind !== 'roster') { err(`${p}.kind`, "must be 'roster'"); continue; }
    if (!Number.isInteger(inp.slots) || (inp.slots as number) < 1 || (inp.slots as number) > INPUT_LIMITS.maxSlots) {
      err(`${p}.slots`, `must be an integer 1..${INPUT_LIMITS.maxSlots}`);
    }
    if (!isObj(inp.states) || Object.keys(inp.states).length === 0) { err(`${p}.states`, 'must name at least one state'); continue; }
    const states = Object.keys(inp.states);
    if (states.length > INPUT_LIMITS.maxStates) err(`${p}.states`, `at most ${INPUT_LIMITS.maxStates} states`);
    for (const st of states) {
      if (!NAME.test(st)) err(`${p}.states.${st}`, 'state names are lowercase letters, digits and dashes');
      validateBindings(inp.states[st], `${p}.states.${st}`, err, true);
    }
    if (typeof inp.default !== 'string' || !states.includes(inp.default)) err(`${p}.default`, 'must name one of the states');
    if (inp.verbs !== undefined) {
      if (!isObj(inp.verbs)) err(`${p}.verbs`, 'must map state names to text');
      else for (const [st, v] of Object.entries(inp.verbs)) {
        if (!states.includes(st)) err(`${p}.verbs.${st}`, 'names no state');
        if (typeof v !== 'string' || v.length > INPUT_LIMITS.maxVerb) err(`${p}.verbs.${st}`, `must be text of at most ${INPUT_LIMITS.maxVerb} characters`);
      }
    }
    if (inp.count !== undefined) {
      const c = inp.count;
      if (!isObj(c) || typeof c.glyph !== 'string' || c.glyph.length === 0 || c.glyph.length > 16) err(`${p}.count.glyph`, 'must be a short string');
      else if (c.max !== undefined && (!Number.isInteger(c.max) || (c.max as number) < 1 || (c.max as number) > INPUT_LIMITS.maxCount)) {
        err(`${p}.count.max`, `must be an integer 1..${INPUT_LIMITS.maxCount}`);
      }
    }
    if (inp.level !== undefined) {
      const l = inp.level;
      if (!isObj(l) || typeof l.path !== 'string' || !l.path.includes('{i}')) err(`${p}.level.path`, 'must be a dot-path using {i}');
      else if (typeof l.max !== 'number' || !(l.max > 0)) err(`${p}.level.max`, 'must be a positive number');
    }
    if (inp.alert !== undefined) {
      const a = inp.alert;
      if (!isObj(a) || !Array.isArray(a.states) || a.states.length === 0) err(`${p}.alert.states`, 'must list at least one state');
      else {
        for (const st of a.states) if (typeof st !== 'string' || !states.includes(st)) err(`${p}.alert.states`, `'${String(st)}' names no state`);
        validateBindings(a.on, `${p}.alert.on`, err, false);
        validateBindings(a.off, `${p}.alert.off`, err, false);
      }
    }
  }
}

/** Coerce whatever a host sent into well-formed roster items (unknown states fall to `default`). */
export function normalizeRoster(input: RosterInput, value: unknown): RosterItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const out: RosterItem[] = [];
  const maxCount = input.count?.max ?? 4;
  for (const raw of value) {
    if (!isObj(raw)) continue;
    const slot = Number(raw.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= input.slots || seen.has(slot)) continue;
    seen.add(slot);
    const state = typeof raw.state === 'string' && Object.hasOwn(input.states, raw.state) ? raw.state : input.default;
    const item: RosterItem = { slot, state };
    if (raw.label !== undefined) item.label = String(raw.label).replace(/[\u0000-\u001f\u007f{}]/g, ' ').slice(0, INPUT_LIMITS.maxLabel);
    if (raw.count !== undefined) item.count = Math.max(0, Math.min(maxCount, Math.floor(Number(raw.count) || 0)));
    if (raw.level !== undefined && input.level) item.level = Math.max(0, Math.min(input.level.max, Number(raw.level) || 0));
    out.push(item);
  }
  return out;
}

function fill(template: string, tokens: Record<string, string>): string {
  return template.replace(TOKEN, (_, k: string) => tokens[k] ?? '');
}

/** The deltas one roster value implies — every slot, plus the alert. */
export function rosterDeltas(input: RosterInput, value: unknown): SteerDelta[] {
  const items = new Map(normalizeRoster(input, value).map((m) => [m.slot, m]));
  const out: SteerDelta[] = [];
  let alerting = false;
  for (let i = 0; i < input.slots; i++) {
    const m = items.get(i) ?? { slot: i, state: input.default };
    if (input.alert?.states.includes(m.state)) alerting = true;
    const count = m.count ?? 0;
    const tokens: Record<string, string> = {
      i: String(i),
      label: m.label ?? '',
      verb: input.verbs?.[m.state] ?? m.state,
      count: input.count && count > 0 ? ` ${input.count.glyph.repeat(count)}` : '',
    };
    for (const b of input.states[m.state] ?? []) {
      out.push({ t: 0, path: fill(b.path, tokens), value: typeof b.value === 'string' ? fill(b.value, tokens) : b.value });
    }
    if (input.level) out.push({ t: 0, path: fill(input.level.path, tokens), value: m.level ?? 0 });
  }
  if (input.alert) for (const b of alerting ? input.alert.on : input.alert.off) out.push({ t: 0, path: b.path, value: b.value });
  return out;
}

/**
 * The control track that feeds `value` to the scene's input `name` — hand it
 * to the mounted instance's `applyTrack`. `null` when the scene has no such
 * input. `dur` is the glide (ms); 0 snaps, which is what a freshly mounted
 * scene wants so it never glides in from its resting look.
 */
export function inputTrack(spec: SaverSpec, name: string, value: unknown, opts: { dur?: number } = {}): ControlTrack | null {
  const input = spec.inputs?.[name];
  if (!input) return null;
  const dur = opts.dur ?? 600;
  return {
    program: spec.id,
    seed: spec.seed ?? 0,
    deltas: rosterDeltas(input, value).map((d) => ({ t: 0, path: d.path, value: d.value as string | number | boolean, dur })),
  };
}

/** The spec as a fed value would leave it — for previews, perception and evals. */
export function applyInput(spec: SaverSpec, name: string, value: unknown): SaverSpec {
  const input = spec.inputs?.[name];
  return input ? applyDeltasToSpec(spec, rosterDeltas(input, value)) : spec;
}

/**
 * Exhaustive binding check, run once at compile time: every state (and the
 * alert, and the level) resolves on this spec for every slot, changes paint
 * only (the structural signature is untouched), and leaves a valid spec.
 * `validate` is passed in to keep this module free of a cycle.
 */
export function checkInputs(spec: SaverSpec, validate: (s: SaverSpec) => { valid: boolean; errors: SpecError[] }): SpecError[] {
  const errors: SpecError[] = [];
  const base = structuralSignature(spec);
  for (const [name, input] of Object.entries(spec.inputs ?? {})) {
    const trial = (label: string, deltas: SteerDelta[]) => {
      for (const d of deltas) {
        if (!resolveSpecPath(spec, d.path)) {
          errors.push({ path: `inputs.${name}.${label}`, message: `path '${d.path}' does not resolve on this scene` });
          return;
        }
      }
      const target = applyDeltasToSpec(spec, deltas);
      if (structuralSignature(target) !== base) {
        errors.push({ path: `inputs.${name}.${label}`, message: 'changes the scene structurally — inputs may only change paint (colours, glyphs, strings, values)' });
        return;
      }
      const r = validate(target);
      if (!r.valid) errors.push({ path: `inputs.${name}.${label}`, message: `leaves an invalid scene: ${r.errors[0]?.path} ${r.errors[0]?.message}` });
    };
    const sample = (state: string): RosterItem[] =>
      Array.from({ length: input.slots }, (_, slot) => ({ slot, state, label: 'label', count: input.count?.max ?? 4, level: input.level?.max ?? 0 }));
    for (const state of Object.keys(input.states)) trial(`states.${state}`, rosterDeltas(input, sample(state)));
    if (input.alert) {
      trial('alert.on', input.alert.on.map((b) => ({ t: 0, path: b.path, value: b.value })));
      trial('alert.off', input.alert.off.map((b) => ({ t: 0, path: b.path, value: b.value })));
    }
  }
  return errors;
}

export type { InputBinding, RosterInput, RosterItem };
