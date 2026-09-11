/**
 * Pure helpers for LIVE steering of compiled specs (setParam / applyTrack).
 * A track's deltas address spec fields by dot-path ("layers.0.count",
 * "background.stops.1.color") or layer key ("fireflies.count"). Steering
 * changes existing values only — unknown paths are ignored (the server
 * validates and rejects them; the runtime stays lenient).
 */
import { LIMITS, type IdleSequence, type SaverSpec, type SpriteSpec } from './types';

interface PathTarget {
  parent: Record<string, unknown> | unknown[];
  key: string | number;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const STEERABLE_ROOT_KEYS = new Set(['ghosting', 'referenceViewport']);

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
 * target immediately (k > 0). Layer counts round to integers.
 */
export function lerpSpec(from: SaverSpec, to: SaverSpec, k: number): SaverSpec {
  const kk = Math.max(0, Math.min(1, k));
  const walk = (a: unknown, b: unknown, key?: string | number): unknown => {
    if (typeof a === 'number' && typeof b === 'number') {
      const v = a + (b - a) * kk;
      return key === 'count' ? Math.max(1, Math.round(v)) : v;
    }
    if (typeof a === 'string' && typeof b === 'string' && HEX.test(a) && HEX.test(b)) {
      return lerpHex(a, b, kk);
    }
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      return b.map((bv, i) => walk(a[i], bv, i));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const out: Record<string, unknown> = {};
      for (const kName of Object.keys(b as Record<string, unknown>)) {
        out[kName] = walk((a as Record<string, unknown>)[kName], (b as Record<string, unknown>)[kName], kName);
      }
      return out;
    }
    return kk > 0 ? b : a; // non-interpolable → step to target
  };
  return walk(from, to) as SaverSpec;
}

/**
 * The string(s) a text layer paints — `strings` of a `text` sprite, `text`
 * of a `textBlock` — or null for every other sprite.
 */
export function textStringsOf(sprite: SpriteSpec): string[] | null {
  if (sprite.kind === 'text') return sprite.strings;
  if (sprite.kind === 'textBlock') return [sprite.text];
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
 * Layer keys are NOT substituted: paths always use numeric indices.
 * Consumers can map to key-based paths via resolveSpecPath if needed.
 */
export function steerablePaths(spec: unknown): string[] {
  if (!spec || typeof spec !== 'object') return [];
  const SKIP = new Set(['kind', 'type', 'key', 'schemaVersion', 'id', 'label', 'seed', 'units', 'motionIntensity', 'mode', 'curve', 'layer']);
  // `bands` (a field background's palette) is indexed like `stops`, so
  // `background.bands.2` is a hex paint path that glides.
  const INDEXED = new Set(['layers', 'stops', 'bands']);
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
        if (SKIP.has(k)) continue;
        if (!prefix && shadowedRootKeys.has(k)) continue;
        walk(v, prefix ? `${prefix}.${k}` : k, k);
      }
      return;
    }
    if (prefix) out.push(prefix);
  };
  walk(spec, '', '');
  return out;
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

/**
 * Fields that require re-seeding entities when they change (placement/motion
 * are baked at build time). Colour/alpha/pulse-only changes redraw in place.
 */
export function structuralSignature(spec: SaverSpec): string {
  return JSON.stringify([
    spec.units,
    // Normalized against the same default every renderer uses — an omitted
    // referenceViewport and an explicit 1080 render identically, so they must
    // hash identically or a same-sizing morph gets rejected as structural.
    spec.referenceViewport ?? LIMITS.referenceViewport,
    spec.layers.map((l) => {
      const s = l.sprite as Record<string, unknown>;
      return [
        l.count,
        l.size,
        l.region,
        l.position,
        l.motion,
        l.wrap,
        l.flip,
        l.alpha,
        l.pulse,
        l.spin,
        l.grow,
        l.layout,
        l.emit,
        l.clock,
        l.sprite.kind,
        // Dimensional draws baked into entities: radius (circle/ring), length
        // (streak), width+aspect (rect), palette pick (all shaped sprites).
        s.radius,
        s.length,
        l.sprite.kind === 'rect' ? [s.width, s.aspect] : l.sprite.kind === 'bar' ? [s.length, s.thickness] : undefined,
        Array.isArray(s.colors) ? s.colors.length : undefined,
        s.colorWeights,
        l.sprite.kind === 'emoji'
          ? [l.sprite.glyphs.length, l.sprite.cycle?.period]
          : l.sprite.kind === 'text'
            ? [l.sprite.strings.length, l.sprite.cycle?.period]
            : l.sprite.kind === 'textBlock'
              // `anchor` is placement (in); `font`/`opacity`/`text` are paint
              // (out — opacity must glide). Appended only when set so every
              // existing spec's signature string is byte-identical.
              ? (l.sprite.anchor ? [l.sprite.fontSize, l.sprite.anchor] : [l.sprite.fontSize])
              : undefined,
      ];
    }),
  ]);
}
