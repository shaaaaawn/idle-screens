/**
 * Compact, per-profile SaverSpec reference for the agent loop's `allowlist`
 * schema mode (mono `docs/training-a-saverspec-author.md`, TR1).
 *
 * Everything here is DERIVED from `packages/schema/saver-spec.schema.json` at
 * call time — the top-level fields, the background variants, the layer fields,
 * and only the sprite kinds / motion types the StyleDNA profile actually uses
 * (plus `circle` and `drift`, the two every style can fall back on). There is
 * no hand-written prose about the format in this file: a field, range or enum
 * printed here is one the validator enforces, so the reference cannot drift.
 *
 * The full FORMAT.md is ~40 KB (~54k prompt tokens per call). This aims for
 * roughly 150 lines and leaves the long tail to the validator, whose error
 * messages name the field — the model asks for a fix, not the manual.
 */
import specSchemaJson from '../../../../packages/schema/saver-spec.schema.json';
import type { ArtistStyleProfile, BenchmarkIntent } from './types';

type Node = Record<string, unknown>;

const ROOT = specSchemaJson as unknown as Node;

/** Definitions that get their own section instead of a one-line type alias. */
const SECTIONS = new Set(['saverSpec', 'background', 'layer', 'sprite', 'motion']);

// ---------------------------------------------------------------------------
// JSON-schema walking

/** Follow a local JSON pointer (`#/definitions/x`, `#/$defs/x`, …). */
export function resolveRef(ref: string, root: Node = ROOT): Node {
  if (!ref.startsWith('#/')) throw new Error(`schema-allowlist: unsupported $ref ${ref}`);
  let cur: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!cur || typeof cur !== 'object') throw new Error(`schema-allowlist: $ref not found ${ref}`);
    cur = (cur as Node)[seg];
  }
  if (!cur || typeof cur !== 'object') throw new Error(`schema-allowlist: $ref not found ${ref}`);
  return cur as Node;
}

function deref(node: Node, root: Node): Node {
  let n = node;
  for (let guard = 0; typeof n.$ref === 'string' && guard < 16; guard++) n = resolveRef(n.$ref, root);
  return n;
}

function definition(name: string, root: Node): Node {
  const defs = (root.definitions ?? root.$defs) as Node | undefined;
  const d = defs?.[name] as Node | undefined;
  if (!d) throw new Error(`schema-allowlist: no definition ${name}`);
  return d;
}

function variants(node: Node, root: Node): Node[] {
  const n = deref(node, root);
  const list = (n.oneOf ?? n.anyOf) as Node[] | undefined;
  return list ? list.map((v) => deref(v, root)) : [n];
}

/** The `oneOf` member whose `properties[disc].const === value`, if any. */
function variantByConst(node: Node, disc: string, value: string, root: Node): Node | null {
  for (const v of variants(node, root)) {
    const d = (v.properties as Node | undefined)?.[disc] as Node | undefined;
    if (d && d.const === value) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// rendering a node as a compact type expression

interface Ctx {
  root: Node;
  /** Every property path printed, `section[disc=value].a.b` — for the test. */
  fields: string[];
  /** Shared `$ref` aliases used somewhere — rendered once in a Types section. */
  aliases: Set<string>;
}

function numberType(node: Node, kind: string): string {
  const exMin = node.exclusiveMinimum;
  const exMax = node.exclusiveMaximum;
  const lo = typeof exMin === 'number' ? `>${exMin}` : typeof node.minimum === 'number' ? `${node.minimum}` : null;
  const hi = typeof exMax === 'number' ? `<${exMax}` : typeof node.maximum === 'number' ? `${node.maximum}` : null;
  if (lo != null && hi != null) return `${kind} ${lo}..${hi}`;
  if (lo != null) return typeof exMin === 'number' ? `${kind} ${lo}` : `${kind} ≥${lo}`;
  if (hi != null) return typeof exMax === 'number' ? `${kind} ${hi}` : `${kind} ≤${hi}`;
  return kind;
}

function typeOf(node: Node, ctx: Ctx, path: string): string {
  if (typeof node.$ref === 'string') {
    const name = node.$ref.split('/').pop() ?? node.$ref;
    if (!SECTIONS.has(name)) ctx.aliases.add(name);
    return name;
  }
  if ('const' in node) return JSON.stringify(node.const);
  if (Array.isArray(node.enum)) return node.enum.map((v) => JSON.stringify(v)).join(' | ');
  const alts = (node.oneOf ?? node.anyOf) as Node[] | undefined;
  if (alts) return alts.map((a) => typeOf(a, ctx, path)).join(' | ');
  const t = node.type;
  if (t === 'number' || t === 'integer') return numberType(node, t);
  if (t === 'boolean') return 'boolean';
  if (t === 'string') {
    const parts = ['string'];
    if (typeof node.pattern === 'string' && node.pattern !== '\\S') parts.push(`matching ${node.pattern}`);
    if (typeof node.maxLength === 'number') parts.push(`≤${node.maxLength} chars`);
    return parts.join(' ');
  }
  if (t === 'array') {
    const inner = typeOf((node.items ?? {}) as Node, ctx, path);
    const min = typeof node.minItems === 'number' ? node.minItems : null;
    const max = typeof node.maxItems === 'number' ? node.maxItems : null;
    if (min != null && min === max) return `[${inner} ×${min}]`;
    const wrapped = /[ |]/.test(inner) ? `(${inner})` : inner;
    const bounds = min != null || max != null ? ` (${min ?? 0}..${max ?? '∞'})` : '';
    return `${wrapped}[]${bounds}`;
  }
  if (t === 'object' || node.properties) return objectType(node, ctx, path);
  return 'any';
}

function fieldEntries(node: Node, ctx: Ctx, path: string): string[] {
  const props = (node.properties ?? {}) as Record<string, Node>;
  const required = new Set((node.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, sub]) => {
    ctx.fields.push(`${path}.${name}`);
    return `${name}${required.has(name) ? '' : '?'}: ${typeOf(sub, ctx, `${path}.${name}`)}`;
  });
}

function objectType(node: Node, ctx: Ctx, path: string): string {
  const entries = fieldEntries(node, ctx, path);
  return entries.length ? `{ ${entries.join(', ')} }` : '{}';
}

/**
 * The schema's own `description`, cut to its first sentence and capped, so a
 * bullet can carry the one fact the type expression cannot (what a unit means,
 * what a default is) without this file writing any prose of its own.
 */
function blurb(node: Node, root: Node): string {
  const d = deref(node, root).description;
  if (typeof d !== 'string') return '';
  const first = d.split(/(?<=[.!?])\s/)[0] ?? d;
  const cut = first.length > 120 ? `${first.slice(0, 117).trimEnd()}…` : first;
  return ` — ${cut}`;
}

/** One `- name: type — description` bullet per property of `node`. */
function bullets(node: Node, ctx: Ctx, path: string): string[] {
  const props = (node.properties ?? {}) as Record<string, Node>;
  const entries = fieldEntries(node, ctx, path);
  return Object.keys(props).map((name, i) => `- ${entries[i]}${blurb(props[name]!, ctx.root)}`);
}

// ---------------------------------------------------------------------------
// the reference

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/** `kind: [circle, …]` from the profile's sprites, `type: [drift, …]` from its motions. */
function kindSection(
  title: string,
  defName: string,
  disc: string,
  kinds: string[],
  ctx: Ctx,
): string[] {
  const def = definition(defName, ctx.root);
  const out = [`### ${title} — ${disc}s for this style: ${kinds.join(', ')}`];
  for (const kind of kinds) {
    const v = variantByConst(def, disc, kind, ctx.root);
    out.push('', `#### ${kind}`);
    if (!v) {
      out.push(`- (no schema entry for ${disc} "${kind}" — use another)`);
      continue;
    }
    out.push(...bullets(v, ctx, `${defName}[${disc}=${kind}]`));
  }
  return out;
}

/**
 * Which schema fields each rubric check reads. Every path here is verified to
 * exist by the same test that checks the rest of the allowlist, so the
 * mapping is derived-and-checked rather than free text.
 */
function benchmarkSection(benchmark: BenchmarkIntent, ctx: Ctx): string[] {
  const c = benchmark.checks;
  const rows: Array<[string, string]> = [];
  if (c.minLayers != null || c.maxLayers != null) rows.push(['layer count', 'saverSpec.layers']);
  if (c.minCoverage != null || c.maxCoverage != null) rows.push(['coverage', 'layer.count, layer.size, layer.alpha']);
  if (c.requirePulse) rows.push(['pulse', 'layer.pulse']);
  if (c.requireSpeedSeparation) rows.push(['speed separation', 'motion[type=drift].speed (each type has one)']);
  if (c.requireFocalDominance) rows.push(['focal dominance', 'layer.size, layer.count, layer.alpha']);
  if (!rows.length) return [];
  for (const [, paths] of rows) {
    for (const p of paths.split(',')) ctx.fields.push(p.trim().replace(/\s.*$/, ''));
  }
  return [
    '',
    `### Where the benchmark rubric looks (${benchmark.title})`,
    ...rows.map(([check, paths]) => `- ${check} → ${paths}`),
  ];
}

function collect(
  profile: ArtistStyleProfile,
  benchmark: BenchmarkIntent | null,
  root: Node,
): { markdown: string; fields: string[] } {
  const ctx: Ctx = { root, fields: [], aliases: new Set() };
  const sprites = uniq([...profile.markMaking.primarySprites, 'circle']);
  const motions = uniq([...profile.motionDialect.preferred, 'drift']);

  const lines: string[] = [
    'Derived from saver-spec.schema.json — `name:` is required, `name?:` optional. Only the sprite kinds and motion types this style uses are expanded.',
    '',
    '### Spec (top level)',
    ...bullets(definition('saverSpec', root), ctx, 'saverSpec'),
    '',
    '### background',
  ];
  for (const v of variants(definition('background', root), root)) {
    const type = ((v.properties as Node | undefined)?.type as Node | undefined)?.const;
    lines.push(`- ${objectType(v, ctx, `background[type=${String(type)}]`)}`);
  }
  lines.push('', '### layer', ...bullets(definition('layer', root), ctx, 'layer'));
  lines.push('', ...kindSection('sprite', 'sprite', 'kind', sprites, ctx));
  lines.push('', ...kindSection('motion', 'motion', 'type', motions, ctx));

  // Aliases referenced above (hexColor, range01, …). Rendering one may pull
  // in another (cycle → nothing, textReveal → hexColor), so drain to a fixpoint.
  const rendered = new Map<string, string>();
  for (let pending = [...ctx.aliases]; pending.length; pending = [...ctx.aliases].filter((a) => !rendered.has(a))) {
    for (const name of pending) rendered.set(name, typeOf(deref(definition(name, root), root), ctx, name));
  }
  if (rendered.size) {
    lines.push('', '### Types');
    for (const [name, type] of [...rendered.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`- ${name}: ${type}`);
    }
  }

  if (benchmark) lines.push(...benchmarkSection(benchmark, ctx));
  lines.push(
    '',
    'Anything not listed here is still valid SaverSpec — the validator names the field when you get it wrong.',
  );
  return { markdown: lines.join('\n'), fields: uniq(ctx.fields) };
}

/**
 * The markdown that replaces FORMAT.md under `## SaverSpec v1 format` when the
 * agent loop runs with `schemaMode: 'allowlist'`.
 */
export function buildSchemaAllowlist(
  profile: ArtistStyleProfile,
  benchmark: BenchmarkIntent | null,
  root: Node = ROOT,
): string {
  return collect(profile, benchmark, root).markdown;
}

/**
 * Every field path the allowlist mentions, as `definition[disc=value].a.b`
 * (e.g. `sprite[kind=circle].radius`, `layer.pulse.amp`, `saverSpec.seed`).
 * Exists so a test can walk the raw JSON schema and prove each one is real.
 */
export function listAllowlistFields(
  profile: ArtistStyleProfile,
  benchmark: BenchmarkIntent | null,
  root: Node = ROOT,
): string[] {
  return collect(profile, benchmark, root).fields;
}
