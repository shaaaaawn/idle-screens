/**
 * Pure helpers for LIVE steering of compiled specs (setParam / applyTrack).
 * A track's deltas address spec fields by dot-path ("layers.0.count",
 * "background.stops.1.color") or layer key ("fireflies.count"). Steering
 * changes existing values only — unknown paths are ignored (the server
 * validates and rejects them; the runtime stays lenient).
 */
import { LIMITS, type SaverSpec } from './types';

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
 * Enumerate all steerable leaf paths in a (resolved) spec. Returns dot-paths
 * like "layers.0.count", "background.stops.1.color", etc. Metadata fields
 * (id, label, schemaVersion, seed, units, kind, type, key) are excluded —
 * they describe structure, not tuneable values.
 *
 * Layer keys are NOT substituted: paths always use numeric indices.
 * Consumers can map to key-based paths via resolveSpecPath if needed.
 */
export function steerablePaths(spec: unknown): string[] {
  if (!spec || typeof spec !== 'object') return [];
  const SKIP = new Set(['kind', 'type', 'key', 'schemaVersion', 'id', 'label', 'seed', 'units', 'motionIntensity', 'mode', 'curve', 'layer']);
  const INDEXED = new Set(['layers', 'stops']);
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
              ? [l.sprite.fontSize]
              : undefined,
      ];
    }),
  ]);
}
