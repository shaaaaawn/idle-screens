/**
 * Pure helpers for LIVE steering of compiled specs (setParam / applyTrack).
 * A track's deltas address spec fields by dot-path ("layers.0.count",
 * "background.stops.1.color") or layer key ("fireflies.count"). Steering
 * changes existing values only — unknown paths are ignored (the server
 * validates and rejects them; the runtime stays lenient).
 */
import { LIMITS, type IdleSequence, type SaverSpec, type SpriteSpec } from './types';
// Cycle (validate.ts imports structuralSignature from here) is safe: neither
// module touches the other's exports at load time, only inside functions.
import { ignoredPropertyPaths } from './validate';

interface PathTarget {
  parent: Record<string, unknown> | unknown[];
  key: string | number;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const STEERABLE_ROOT_KEYS = new Set(['ghosting', 'referenceViewport', 'finish', 'groups']);

/** Resolve a dot-path (key-aware) to its parent + final key; null if absent. */
export function resolveSpecPath(spec: unknown, path: string): PathTarget | null {
  if (!spec || typeof spec !== 'object' || !path) return null;
  const parts = path.split('.');
  if (parts.some((p) => UNSAFE_KEYS.has(p))) return null;
  const s = spec as { layers?: Array<Record<string, unknown>> };
  if (parts[0] !== 'layers' && parts[0] !== 'background' && Array.isArray(s.layers)) {
    // A layer's own key wins over a root field of the same name — a layer
    // named "ghosting" or "referenceViewport" must still resolve to itself,
    // not get shadowed by the identically-named root scalar.
    const idx = s.layers.findIndex((l) => l && l.key === parts[0]);
    if (idx !== -1) {
      parts.splice(0, 1, 'layers', String(idx));
    } else if (!STEERABLE_ROOT_KEYS.has(parts[0]!)) {
      return null;
    }
  }
  // Group membership and a transform's `origin` are enums that can only step
  // — a steer or key on them would jump — so they are not steer targets.
  if (parts[0] === 'layers' && parts.length === 3 && parts[2] === 'group') return null;
  if (parts.length >= 2 && parts[parts.length - 1] === 'origin' && parts[parts.length - 2] === 'transform') return null;
  let node: unknown = spec;
  for (let i = 0; i < parts.length - 1; i++) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[parts[i]!];
  }
  if (node === null || typeof node !== 'object') return null;
  const last = parts[parts.length - 1]!;
  const key: string | number = Array.isArray(node) ? Number(last) : last;
  const exists = Array.isArray(node)
    ? Number.isInteger(key as number) && (key as number) >= 0 && (key as number) < node.length
    : last in (node as Record<string, unknown>);
  return exists ? { parent: node as PathTarget['parent'], key } : null;
}

/**
 * The index form of a key-aware dot-path (`fireflies.sprite.color` →
 * `layers.3.sprite.color`), or null when it does not resolve. Two paths that
 * address the same field compare equal after this — how a live steer finds
 * out whether a `timeline` key animates the field it touches.
 */
export function canonicalSpecPath(spec: unknown, path: string): string | null {
  if (!resolveSpecPath(spec, path)) return null;
  const parts = path.split('.');
  const s = spec as { layers?: Array<Record<string, unknown>> };
  if (parts[0] !== 'layers' && parts[0] !== 'background' && Array.isArray(s.layers)) {
    const idx = s.layers.findIndex((l) => l && l.key === parts[0]);
    if (idx !== -1) parts.splice(0, 1, 'layers', String(idx));
  }
  return parts.join('.');
}

/** Read the value at a dot-path, or undefined when it does not resolve. */
export function readSpecPath(spec: unknown, path: string): unknown {
  const loc = resolveSpecPath(spec, path);
  return loc ? (loc.parent as Record<string | number, unknown>)[loc.key] : undefined;
}

const TRANSFORM_IDENTITY: Record<string, number> = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0 };

/** Two layer `transform` objects with each one's missing fields filled with the identity, so a glide between them never steps (inputs returned as-is otherwise). */
function alignTransform(a: unknown, b: unknown): [unknown, unknown] {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(a) || !isObj(b)) return [a, b];
  let fa: Record<string, unknown> | null = null;
  let fb: Record<string, unknown> | null = null;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const id = TRANSFORM_IDENTITY[key];
    if (id === undefined) continue;
    if (a[key] === undefined) (fa ??= { ...a })[key] = id;
    if (b[key] === undefined) (fb ??= { ...b })[key] = id;
  }
  return [fa ?? a, fb ?? b];
}

/**
 * When only one end of a spec lerp declares a layer's paint `opacity` or
 * `transform`, give the other end the identity value (opacity 1, x/y/rotate 0,
 * scale/scaleX/scaleY 1) so the lerp glides from how the layer actually looks
 * instead of stepping. Returns the inputs themselves when no layer differs —
 * every spec without these fields lerps exactly as it always has.
 */
function alignPaintFields(a: unknown, b: unknown): [unknown, unknown] {
  const la = (a as { layers?: unknown[] } | null)?.layers;
  const lb = (b as { layers?: unknown[] } | null)?.layers;
  if (!Array.isArray(la) || !Array.isArray(lb)) return [a, b];
  let outA: unknown[] | null = null;
  let outB: unknown[] | null = null;
  const n = Math.min(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    const x = la[i] as Record<string, unknown> | null;
    const y = lb[i] as Record<string, unknown> | null;
    if (!x || !y || typeof x !== 'object' || typeof y !== 'object') continue;
    let nx = x;
    let ny = y;
    // A layer that joins or leaves a group keeps the membership through the
    // lerp; the group branch below gives the end without that group an
    // identity entry, so the group's paint glides instead of dropping.
    if ((x.group === undefined) !== (y.group === undefined)) {
      if (x.group === undefined) nx = { ...nx, group: y.group };
      else ny = { ...ny, group: x.group };
    }
    if ((x.opacity === undefined) !== (y.opacity === undefined)) {
      if (x.opacity === undefined) nx = { ...nx, opacity: 1 };
      else ny = { ...ny, opacity: 1 };
    }
    const tx = x.transform as Record<string, unknown> | undefined;
    const ty = y.transform as Record<string, unknown> | undefined;
    if (tx || ty) {
      const fx: Record<string, unknown> = { ...(tx ?? {}) };
      const fy: Record<string, unknown> = { ...(ty ?? {}) };
      let changed = !tx || !ty;
      for (const key of new Set([...Object.keys(fx), ...Object.keys(fy)])) {
        const id = TRANSFORM_IDENTITY[key];
        if (id === undefined) continue;
        if (fx[key] === undefined) { fx[key] = id; changed = true; }
        if (fy[key] === undefined) { fy[key] = id; changed = true; }
      }
      if (changed) { nx = { ...nx, transform: fx }; ny = { ...ny, transform: fy }; }
    }
    if (nx !== x) (outA ??= la.slice())[i] = nx;
    if (ny !== y) (outB ??= lb.slice())[i] = ny;
  }
  let ra: unknown = outA ? { ...(a as object), layers: outA } : a;
  let rb: unknown = outB ? { ...(b as object), layers: outB } : b;
  // Groups: a group present on only one end glides from the identity (no
  // transform, opacity 1); so does a group opacity set on one end only.
  const ga = (a as { groups?: Record<string, Record<string, unknown>> }).groups;
  const gb = (b as { groups?: Record<string, Record<string, unknown>> }).groups;
  if (ga || gb) {
    const na: Record<string, Record<string, unknown>> = { ...(ga ?? {}) };
    const nb: Record<string, Record<string, unknown>> = { ...(gb ?? {}) };
    let changed = !ga || !gb;
    for (const name of new Set([...Object.keys(na), ...Object.keys(nb)])) {
      const x = na[name] ?? {};
      const y = nb[name] ?? {};
      if (!na[name] || !nb[name]) changed = true;
      let nx = x;
      let ny = y;
      if ((x.opacity === undefined) !== (y.opacity === undefined)) {
        if (x.opacity === undefined) nx = { ...nx, opacity: 1 };
        else ny = { ...ny, opacity: 1 };
        changed = true;
      }
      if (!x.transform !== !y.transform) {
        if (!x.transform) nx = { ...nx, transform: {} };
        else ny = { ...ny, transform: {} };
        changed = true;
      }
      na[name] = nx;
      nb[name] = ny;
    }
    if (changed) {
      ra = { ...(ra as object), groups: na };
      rb = { ...(rb as object), groups: nb };
    }
  }
  return [ra, rb];
}

/** A steering delta as carried on a channel control-track. */
export interface SteerDelta {
  t: number;
  path: string;
  value: unknown;
  ease?: string;
  dur?: number;
}

/** Apply deltas to a deep copy of the spec (last-wins, target values). */
export function applyDeltasToSpec(spec: SaverSpec, deltas: SteerDelta[]): SaverSpec {
  const copy = JSON.parse(JSON.stringify(spec)) as SaverSpec;
  for (const d of deltas) {
    const loc = resolveSpecPath(copy, d.path);
    if (loc) (loc.parent as Record<string | number, unknown>)[loc.key] = d.value;
  }
  return copy;
}

/**
 * `applyDeltasToSpec` for read-only callers: the same result, but every
 * subtree a delta does not touch is shared with `spec` — only the containers
 * on each delta's path are copied. The validator checks a timeline by applying
 * each key, and the composed keys at every sample time, to the whole spec; a
 * full deep copy per check was most of the cost of validating a long timeline
 * (a 132 KB scene spent ~60% of its CPU in JSON round-trips). The result
 * aliases `spec`, so it must never be mutated.
 */
export function applyDeltasShared(spec: SaverSpec, deltas: SteerDelta[]): SaverSpec {
  const out = { ...spec } as Record<string, unknown>;
  const copied = new WeakSet<object>([out]);
  for (const d of deltas) {
    const cp = canonicalSpecPath(out, d.path);
    if (!cp) continue;
    const parts = cp.split('.');
    let node = out as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i]!;
      const child = node[k];
      if (!child || typeof child !== 'object') { node = null as never; break; }
      if (!copied.has(child)) {
        const clone = Array.isArray(child) ? child.slice() : { ...(child as Record<string, unknown>) };
        copied.add(clone);
        node[k] = clone;
      }
      node = node[k] as Record<string, unknown>;
    }
    if (node) {
      // An array's final segment is an index, as in resolveSpecPath ('01' is index 1).
      const last = parts[parts.length - 1]!;
      (node as unknown as Record<string | number, unknown>)[Array.isArray(node) ? Number(last) : last] = d.value;
    }
  }
  return out as unknown as SaverSpec;
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpHex(a: string, b: string, k: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const mix = ca.map((v, i) => Math.round(v + (cb[i]! - v) * k));
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Interpolate between two structurally-similar specs at progress k (0..1).
 * Numbers lerp, hex colours lerp per channel, everything else steps to the
 * target immediately (k > 0). Layer counts, and a field background's
 * `octaves` / `quantize`, round to whole values.
 */
export function lerpSpec(from: SaverSpec, to: SaverSpec, k: number): SaverSpec {
  const kk = Math.max(0, Math.min(1, k));
  const out = lerpValue(from, to, kk, true) as SaverSpec;
  return out;
}

/**
 * The walk behind `lerpSpec`, for any value: numbers lerp, hex colours lerp
 * per channel, equal-length arrays and objects recurse, everything else steps
 * to the target at k > 0 (`count` rounds). At a spec's root a `timeline` steps
 * too — two timelines' key times must never blend. No existing spec carries a
 * timeline, so every stored morph and glide is unchanged.
 */
export function lerpValue(from: unknown, to: unknown, k: number, specRoot = false, rootKey?: string): unknown {
  if (specRoot) [from, to] = alignPaintFields(from, to);
  if (rootKey === 'transform') [from, to] = alignTransform(from, to);
  const kk = Math.max(0, Math.min(1, k));
  const walk = (a: unknown, b: unknown, key?: string | number, root = false): unknown => {
    if (typeof a === 'number' && typeof b === 'number') {
      const v = a + (b - a) * kk;
      if (key === 'count') return Math.max(1, Math.round(v));
      // A field background's level counts are integers (X477): a glide steps
      // through whole levels, as the painter already reads them. `quantize`
      // below 1.5 is smooth (0) — never the invalid 1 — matching `fieldRgb`,
      // which paints any level count under 2 as the smooth ramp.
      if (key === 'octaves') return Math.round(v);
      if (key === 'quantize') { const q = Math.round(v); return q < 2 ? 0 : q; }
      return v;
    }
    if (typeof a === 'string' && typeof b === 'string' && HEX.test(a) && HEX.test(b)) {
      return lerpHex(a, b, kk);
    }
    if (key === 'path' && typeof a === 'string' && typeof b === 'string' && a !== b) {
      // Two SVG paths with the same commands (Lottie's rule: same letters,
      // same number count) morph number by number; otherwise they step.
      const m = lerpPathD(a, b, kk);
      if (m !== null) return m;
    }
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      return b.map((bv, i) => walk(a[i], bv, i));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const out: Record<string, unknown> = {};
      for (const kName of Object.keys(b as Record<string, unknown>)) {
        const av = (a as Record<string, unknown>)[kName];
        const bv = (b as Record<string, unknown>)[kName];
        out[kName] = root && kName === 'timeline' ? (kk > 0 ? bv : av) : kName === 'transform' ? walk(...alignTransform(av, bv), kName) : walk(av, bv, kName);
      }
      return out;
    }
    return kk > 0 ? b : a; // non-interpolable → step to target
  };
  return walk(from, to, rootKey, specRoot);
}

const PATH_TOKEN = /[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/**
 * Interpolate two SVG path d strings that share their structure — the same
 * command letters in the same order and the same count of numbers — by
 * lerping every number; null when they differ in structure (the morph then
 * steps). Arc flags (0/1) round, so a half-way arc stays a valid arc.
 */
export function lerpPathD(a: string, b: string, k: number): string | null {
  const ta = a.match(PATH_TOKEN) ?? [];
  const tb = b.match(PATH_TOKEN) ?? [];
  if (ta.length !== tb.length) return null;
  const out: string[] = [];
  let cmd = '';
  let argIndex = 0;
  for (let i = 0; i < ta.length; i++) {
    const x = ta[i]!, y = tb[i]!;
    const isCmdA = /^[a-zA-Z]$/.test(x), isCmdB = /^[a-zA-Z]$/.test(y);
    if (isCmdA !== isCmdB) return null;
    if (isCmdA) {
      if (x !== y) return null;
      cmd = x.toUpperCase();
      argIndex = 0;
      out.push(x);
      continue;
    }
    const va = Number(x), vb = Number(y);
    const flag = cmd === 'A' && (argIndex % 7 === 3 || argIndex % 7 === 4);
    argIndex++;
    const v = va + (vb - va) * k;
    out.push(flag ? String(Math.round(v)) : String(+v.toFixed(5)));
  }
  return out.join(' ');
}

/**
 * The string(s) a text layer paints — `strings` of a `text` sprite, `text`
 * of a `textBlock` — or null for every other sprite.
 */
export function textStringsOf(sprite: SpriteSpec): string[] | null {
  if (sprite.kind === 'text') return sprite.strings;
  // A counter's label is its prefix and suffix: the digits glide on their
  // own, so only a changed label is a change of words.
  if (sprite.kind === 'textBlock') return [sprite.number ? `${sprite.number.prefix ?? ''}\u0000${sprite.number.suffix ?? ''}` : sprite.text];
  return null;
}

/**
 * Whether the text layer at index `i` paints different words in `a` and
 * `b` — the layers a morph `text: 'crossfade'` draws twice. False for
 * non-text layers and when the strings match.
 */
export function textStringsDiffer(a: SaverSpec, b: SaverSpec, i: number): boolean {
  const sa = a.layers[i]?.sprite;
  const sb = b.layers[i]?.sprite;
  if (!sa || !sb) return false;
  const ta = textStringsOf(sa);
  const tb = textStringsOf(sb);
  if (!ta || !tb) return false;
  return ta.length !== tb.length || ta.some((s, j) => s !== tb[j]);
}

/**
 * True when a morph from `a` to `b` has nothing to interpolate: the two specs
 * differ, yet every difference is a value lerpSpec steps (strings such as
 * `textBlock.text`, mismatched arrays) rather than a number or hex colour it
 * glides. Such a morph looks exactly like a cut. Identical specs return
 * false: a no-op morph is continuity, not a cut. Under `textCrossfade`
 * (the transition declared `text: 'crossfade'`) differing text is something
 * to morph — the words cross-fade — so such twins return false too.
 *
 * Walks `a`/`b` directly rather than sampling `lerpSpec(a, b, 0.5)`: two hex
 * colours a single 8-bit step apart (`#000000` → `#010101`) round their
 * midpoint to the target channel-for-channel, which would make a genuine
 * (if subtle) colour glide look identical to a step. `id`/`label`/
 * `schemaVersion`/layer `key` are identification metadata, never rendered
 * (excluded from `structuralSignature`/`steerablePaths` for the same reason)
 * — a segment pair that differs only there renders identically and is not a
 * morph at all.
 */
const NON_RENDERED_KEYS = new Set(['id', 'label', 'schemaVersion', 'key']);

export function morphNothingMorphable(a: SaverSpec, b: SaverSpec, opts: { textCrossfade?: boolean } = {}): boolean {
  if (opts.textCrossfade && a.layers.some((_, i) => textStringsDiffer(a, b, i))) return false;
  let hasDiff = false;
  let hasGlide = false;
  const walk = (x: unknown, y: unknown, key?: string): void => {
    if (key !== undefined && NON_RENDERED_KEYS.has(key)) return;
    if (x === y) return;
    if (typeof x === 'number' && typeof y === 'number') {
      hasDiff = true;
      hasGlide = true;
      return;
    }
    if (typeof x === 'string' && typeof y === 'string' && HEX.test(x) && HEX.test(y)) {
      const ca = hexToRgb(x);
      const cb = hexToRgb(y);
      if (ca.some((v, i) => v !== cb[i])) {
        hasDiff = true;
        hasGlide = true;
      }
      // else: same colour under a different spelling (case, 3- vs 6-digit) — a no-op, not a difference.
      return;
    }
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) {
      for (let i = 0; i < y.length; i++) walk(x[i], y[i]);
      return;
    }
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
      const keys = new Set([...Object.keys(x as Record<string, unknown>), ...Object.keys(y as Record<string, unknown>)]);
      for (const k of keys) {
        walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], k);
      }
      return;
    }
    hasDiff = true; // non-interpolable → steps to target
  };
  walk(a, b);
  return hasDiff && !hasGlide;
}

/**
 * Enumerate all steerable leaf paths in a (resolved) spec. Returns dot-paths
 * like "layers.0.count", "background.stops.1.color", "background.bands.2", etc. Metadata fields
 * (id, label, schemaVersion, seed, units, kind, type, key) are excluded —
 * they describe structure, not tuneable values.
 *
 * Properties the validator flags as unknown or misplaced (e.g. `angle` on a
 * gradient background, `blend` inside a sprite) are excluded too: the
 * renderer never reads them, so advertising them invites a steer that
 * silently does nothing. Same source of truth as validateSpec's
 * "will be ignored" warnings (`ignoredPropertyPaths`).
 *
 * Layer keys are NOT substituted: paths always use numeric indices.
 * Consumers can map to key-based paths via resolveSpecPath if needed.
 */
export function steerablePaths(spec: unknown): string[] {
  if (!spec || typeof spec !== 'object') return [];
  // `group` (membership) and `origin` are enums that step, not knobs; the
  // `timeline` is authored structure, not a steer target (resolveSpecPath
  // refuses it), so none of them are advertised.
  const SKIP = new Set(['kind', 'type', 'key', 'schemaVersion', 'id', 'label', 'seed', 'units', 'motionIntensity', 'mode', 'curve', 'layer', 'group', 'origin']);
  const SKIP_ROOT = new Set(['timeline']);
  // `bands` (a field background's palette) is indexed like `stops`, so
  // `background.bands.2` is a hex paint path that glides.
  const INDEXED = new Set(['layers', 'stops', 'bands', 'parts']);
  // Mirror resolveSpecPath's layer-key precedence: a root field named the
  // same as a layer's key resolves to that layer, not the scalar, so don't
  // advertise a root path we can't actually deliver a delta to.
  const layers = (spec as { layers?: unknown }).layers;
  const shadowedRootKeys = new Set(
    Array.isArray(layers)
      ? layers
          .map((l) => (l && typeof l === 'object' ? (l as Record<string, unknown>).key : undefined))
          .filter((k): k is string => typeof k === 'string' && STEERABLE_ROOT_KEYS.has(k))
      : [],
  );
  const out: string[] = [];
  const walk = (node: unknown, prefix: string, key: string): void => {
    if (Array.isArray(node) && INDEXED.has(key)) {
      node.forEach((child, i) => walk(child, `${prefix}.${i}`, ''));
      return;
    }
    if (Array.isArray(node)) {
      if (prefix) out.push(prefix);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        // Group names are user-chosen: a group called `label` is still a group.
        if (SKIP.has(k) && prefix !== 'groups') continue;
        if (!prefix && (shadowedRootKeys.has(k) || SKIP_ROOT.has(k))) continue;
        walk(v, prefix ? `${prefix}.${k}` : k, k);
      }
      return;
    }
    if (prefix) out.push(prefix);
  };
  walk(spec, '', '');
  const ignored = ignoredPropertyPaths(spec);
  if (ignored.length === 0) return out;
  return out.filter((p) => !ignored.some((ig) => p === ig || p.startsWith(`${ig}.`)));
}

/**
 * Every path a sequence accepts on its track: `sequence.segment` (the
 * clicker), the bed's paths under the `bed.` prefix, and the union of every
 * segment's paths (a segment path lands on whichever segment owns it — see
 * `SequenceInstance.applyTrack`). Deduplicated, numeric layer indices as in
 * `steerablePaths`.
 */
export function sequenceSteerablePaths(seq: IdleSequence): string[] {
  const out = new Set<string>(['sequence.segment']);
  if (seq.bed) for (const p of steerablePaths(seq.bed)) out.add(`bed.${p}`);
  for (const seg of seq.segments) for (const p of steerablePaths(seg.scene)) out.add(p);
  return [...out];
}

/** Smooth (ease-in-out) progress curve used for glides. */
export function easeSmooth(k: number): number {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
}

/** ω of the `spring` ease: settles to within 0.3 % of its target by the glide's end. */
const SPRING_OMEGA = 8;
const SPRING_END = 1 - (1 + SPRING_OMEGA) * Math.exp(-SPRING_OMEGA);

/**
 * A glide's progress curve, by name (`GlideEase`), for progress `k` (0..1).
 * Every curve is monotone and runs 0 → 1, so an eased value never leaves the
 * range its two endpoints bound. `spring` is the critically damped step
 * response 1 − (1 + ωk)e^(−ωk), normalised to land exactly on 1 at k = 1.
 * Anything unknown is `smooth` (today's default).
 */
export function easeGlide(ease: string | undefined, k: number): number {
  const c = Math.max(0, Math.min(1, k));
  switch (ease) {
    case 'step': return c >= 1 ? 1 : 0;
    case 'linear': return c;
    case 'in': return c * c * c;
    case 'out': { const u = 1 - c; return 1 - u * u * u; }
    case 'spring': return c >= 1 ? 1 : (1 - (1 + SPRING_OMEGA * c) * Math.exp(-SPRING_OMEGA * c)) / SPRING_END;
    default: return c * c * (3 - 2 * c);
  }
}

/** The named eases a live steer honours (the ones that did not exist before steers carried an ease). */
export const STEER_EASES: ReadonlySet<string> = new Set(['in', 'out', 'spring']);

/**
 * Fields that require re-seeding entities when they change (placement/motion
 * are baked at build time). Colour/alpha/pulse-only changes redraw in place.
 */
export function structuralSignature(spec: SaverSpec): string {
  const f = structuralFields(spec);
  return JSON.stringify([...f.root.map(([, v]) => v), f.layers.map((l) => l.map(([, v]) => v))]);
}

/**
 * One field of the structural signature: its path (relative to the scene, or
 * to the layer) and its value. A tuple slot names each of its elements.
 */
type StructuralField = [name: string | readonly string[], value: unknown];

/**
 * The structural signature's fields, named, in signature order — one list for
 * the scene and one per layer. `structuralSignature` stringifies exactly these
 * values, so `structuralDifferences` names what decides a mismatch and can
 * never drift from it.
 */
function structuralFields(spec: SaverSpec): { root: StructuralField[]; layers: StructuralField[][] } {
  return {
    root: [
      ['units', spec.units],
      // Normalized against the same default every renderer uses — an omitted
      // referenceViewport and an explicit 1080 render identically, so they must
      // hash identically or a same-sizing morph gets rejected as structural.
      ['referenceViewport', spec.referenceViewport ?? LIMITS.referenceViewport],
    ],
    layers: spec.layers.map((l): StructuralField[] => {
      const s = l.sprite as Record<string, unknown>;
      return [
        ['count', l.count],
        ['size', l.size],
        ['region', l.region],
        ['position', l.position],
        ['motion', l.motion],
        ['wrap', l.wrap],
        ['flip', l.flip],
        ['alpha', l.alpha],
        ['pulse', l.pulse],
        ['spin', l.spin],
        ['grow', l.grow],
        ['layout', l.layout],
        ['emit', l.emit],
        ['clock', l.clock],
        ['sprite.kind', l.sprite.kind],
        // Dimensional draws baked into entities: radius (circle/ring), length
        // (streak), width+aspect (rect), palette pick (all shaped sprites).
        ['sprite.radius', s.radius],
        ['sprite.length', s.length],
        l.sprite.kind === 'rect'
          ? [['sprite.width', 'sprite.aspect'], [s.width, s.aspect]]
          : l.sprite.kind === 'bar' ? [['sprite.length', 'sprite.thickness'], [s.length, s.thickness]] : ['sprite.dimensions', undefined],
        ['sprite.colors.length', Array.isArray(s.colors) ? s.colors.length : undefined],
        ['sprite.colorWeights', s.colorWeights],
        l.sprite.kind === 'emoji'
          ? [['sprite.glyphs.length', 'sprite.cycle.period'], [l.sprite.glyphs.length, l.sprite.cycle?.period]]
          : l.sprite.kind === 'text'
            ? [['sprite.strings.length', 'sprite.cycle.period'], [l.sprite.strings.length, l.sprite.cycle?.period]]
            : l.sprite.kind === 'textBlock'
              // `anchor` is placement (in); `font`/`opacity`/`text` are paint
              // (out — opacity must glide). Appended only when set so every
              // existing spec's signature string is byte-identical.
              ? [['sprite.fontSize', 'sprite.anchor'], l.sprite.anchor ? [l.sprite.fontSize, l.sprite.anchor] : [l.sprite.fontSize]]
              : ['sprite.variants', undefined],
        // Static rotation is baked into entities (a range draws a seeded
        // angle). Appended only when set — same rule as `anchor` above.
        ...(l.rotate !== undefined ? [['rotate', l.rotate] as StructuralField] : []),
        // `rock` is baked per entity like `pulse` (and draws a seeded phase).
        ...(l.rock !== undefined ? [['rock', { rock: l.rock }] as StructuralField] : []),
      ];
    }),
  };
}

/** A value as a difference names it: short, and `(unset)` for absent. */
function showValue(v: unknown): string {
  if (v === undefined) return '(unset)';
  if (typeof v === 'string') return v;
  const j = JSON.stringify(v);
  return j.length > 40 ? `${j.slice(0, 37)}…` : j;
}

/** Leaf-level differences between two values, as `path: a → b` (objects descend; arrays and scalars compare whole). */
function leafDifferences(path: string, a: unknown, b: unknown, out: string[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  const isRec = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  if (isRec(a) && isRec(b)) {
    const before = out.length;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) leafDifferences(`${path}.${k}`, a[k], b[k], out);
    // The signature compares JSON text, so the same fields written in another order still differ.
    if (out.length === before) out.push(`${path}: the same fields in a different key order`);
    return;
  }
  out.push(`${path}: ${showValue(a)} → ${showValue(b)}`);
}

/** A field list flattened to one value per name (tuple slots split per element). */
function namedFields(fields: StructuralField[]): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const [name, value] of fields) {
    if (typeof name === 'string') { m.set(name, value); continue; }
    const vs = Array.isArray(value) ? value : [];
    name.forEach((n, i) => m.set(n, vs[i]));
  }
  return m;
}

/**
 * What makes two scenes differ structurally, named field by field — e.g.
 * `layers[2].layout.type: grid → list` — in the order `structuralSignature`
 * reads them. Empty exactly when the signatures agree. A layer whose sprite
 * kind changed reports the kind alone: every sprite field differs with it.
 */
export function structuralDifferences(a: SaverSpec, b: SaverSpec): string[] {
  const fa = structuralFields(a);
  const fb = structuralFields(b);
  const out: string[] = [];
  const ra = namedFields(fa.root);
  const rb = namedFields(fb.root);
  for (const k of new Set([...ra.keys(), ...rb.keys()])) leafDifferences(k, ra.get(k), rb.get(k), out);
  if (fa.layers.length !== fb.layers.length) out.push(`layers.length: ${fa.layers.length} → ${fb.layers.length}`);
  for (let i = 0; i < Math.min(fa.layers.length, fb.layers.length); i++) {
    const la = namedFields(fa.layers[i]!);
    const lb = namedFields(fb.layers[i]!);
    const kindChanged = la.get('sprite.kind') !== lb.get('sprite.kind');
    for (const k of new Set([...la.keys(), ...lb.keys()])) {
      if (kindChanged && k.startsWith('sprite.') && k !== 'sprite.kind') continue;
      leafDifferences(`layers[${i}].${k}`, la.get(k), lb.get(k), out);
    }
  }
  return out;
}

/** `structuralDifferences` as one phrase for a message: the first few, then a count of the rest. */
export function describeStructuralDifferences(a: SaverSpec, b: SaverSpec, max = 3): string {
  const d = structuralDifferences(a, b);
  if (d.length === 0) return '';
  return d.length <= max ? d.join('; ') : `${d.slice(0, max).join('; ')}; +${d.length - max} more`;
}
