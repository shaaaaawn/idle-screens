/**
 * Layer cohesion — does a layer read as ONE form, or as N separate marks?
 *
 * The gap this closes: every other perception channel reports a heavily
 * overlapping layer identically whether its sprites merge into a silhouette or
 * stay legible as individual discs. Luminance, coverage, dominance and the
 * braille map are all blind to it, because they measure ink, not edges. An
 * agent drawing a *shape* out of sprites therefore cannot tell success from
 * failure without publishing and looking at real pixels.
 *
 * Two independent facts decide it, so both are reported:
 *
 * - `overlap` — geometry. What fraction of a typical entity's outline is buried
 *   inside a sibling. Scattered fields sit near 0; a deliberate mass sits high.
 * - `seamless` — paint. Whether an overlap between two of this layer's entities
 *   paints as an invisible join. Only a hard-edged, fully opaque, single-colour,
 *   un-blended layer merges; anything else shows every internal edge.
 *
 * Both are analytic, deterministic and renderer-free, like the rest of
 * `perceive.ts`.
 */

import { polygonPoints } from './shapes';
import { lifeAlphaAt, positionAt, rotationAt, sizeAt, type Entity } from './simulate';
import type { LayerSpec } from './types';

/**
 * Above this mean covered-outline fraction a layer is treated as *trying* to be
 * one form rather than a field of marks.
 *
 * Calibrated against the shipped examples rather than picked. Measured across
 * all 42 fillable layers in `src/examples/`, the particle fields top out at
 * 0.167 (`facets/planes`; snowfall, lanterns and constellation are all 0.000,
 * `comets/stars` 0.001, `aquarium` 0.015, `procession/lanterns` 0.083), while
 * a layer authored as a silhouette — circles packed several times over their
 * own area, the idiom that draws a wave or a mountain — measures 0.79 to 0.85.
 * `aurora`'s wander curtains are the one shipped layer in the upper band, at
 * 0.892, and they are a deliberate overlapping wash. Nothing sits between
 * 0.167 and 0.786, so the exact threshold is not delicate.
 */
const MERGE_FLOOR = 0.35;

/**
 * Below this base opacity a heavily overlapping layer is an atmospheric wash by
 * intent — the playbook's own advice is a field of soft circles at alpha ~0.2 —
 * and its visible internal edges are the effect, not a defect. The advisory
 * stays silent there; the numbers are still reported.
 */
const WASH_ALPHA_MAX = 0.45;

/**
 * Sample time for a spec-level cohesion read, matching `perceiveScene`'s own
 * default so the advisory and the reported numbers agree on the usual call.
 * Past all typical `life.enter` staging; `grow` has had time to breathe.
 */
export const COHESION_T = 5000;

/** Outline samples per entity. 24 resolves a half-covered circle to ~4 %. */
const OUTLINE_SAMPLES = 24;

/**
 * Cap on the entities whose outlines are traced. Above this the measured set is
 * a deterministic stride through the layer (every k-th entity); coverage is
 * still tested against *every* sibling, so the estimate stays unbiased.
 */
const MAX_TRACED = 240;

/** What a layer will read as on the wall. */
export type CohesionRead =
  /** Entities merge into a single silhouette — the layer draws a shape. */
  | 'mass'
  /** Entities overlap heavily but every overlap paints a visible edge. */
  | 'seamed'
  /** Entities stand alone — a field of marks, which most layers are. */
  | 'marks';

export interface LayerCohesion {
  layerIndex: number;
  key: string | undefined;
  /**
   * Mean fraction of an entity's outline covered by a same-layer sibling, 0..1.
   * `null` for sprite kinds where a merged silhouette is not a meaningful idea
   * (lines, glyphs and text: ring, streak, stroke, bar, emoji, text, textBlock).
   */
  overlap: number | null;
  /** Do this layer's overlaps paint as invisible joins? */
  seamless: boolean;
  /** Why not, when not — the field to act on. `null` when seamless. */
  seamCause: string | null;
  /** The verdict. `null` when `overlap` is null. */
  reads: CohesionRead | null;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Shape {
  cx: number;
  cy: number;
  /** Bounding radius, for the pairwise prefilter. */
  br: number;
  contains(x: number, y: number): boolean;
  outline(n: number): Array<{ x: number; y: number }>;
}

/**
 * Outline samples are stepped this far INSIDE their own shape, as a fraction of
 * its bounding radius, before being tested. The question asked is then "is the
 * ink just inside my edge also covered?" rather than "is a point exactly on my
 * edge inside a sibling?".
 *
 * Exact-boundary tests are degenerate in both directions: coincident circles
 * sample every point exactly on the sibling's rim, and a polygon point lying on
 * a horizontal edge fails the ray-cast's `(a.y > y) !== (b.y > y)` test — two
 * flat rects sharing a y therefore reported their buried long edges as exposed.
 *
 * The step follows the edge's inward NORMAL, not the direction of the entity
 * centre: a concave polygon can have its centre outside its own filled area, so
 * a centre-directed nudge would push samples across the concavity and out of
 * the shape. Relative, so it holds at any viewport scale, and four orders of
 * magnitude below a pixel for any real sprite.
 */
const EDGE_INSET = 1e-4;

function circleShape(cx: number, cy: number, r: number): Shape {
  return {
    cx, cy, br: r,
    contains: (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r,
    outline: (n) => Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const inner = r * (1 - EDGE_INSET); // inward normal of a circle is its radius
      return { x: cx + inner * Math.cos(a), y: cy + inner * Math.sin(a) };
    }),
  };
}

/** A convex or concave polygon given by absolute vertices. */
function polyShape(cx: number, cy: number, abs: Array<{ x: number; y: number }>): Shape {
  let br = 0;
  for (const p of abs) br = Math.max(br, Math.hypot(p.x - cx, p.y - cy));
  const inside = (x: number, y: number): boolean => {
    let hit = false;
    for (let i = 0, j = abs.length - 1; i < abs.length; j = i++) {
      const a = abs[i]!;
      const b = abs[j]!;
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  const seg = abs.map((p, i) => {
    const q = abs[(i + 1) % abs.length]!;
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
  const perimeter = seg.reduce((a, b) => a + b, 0);
  const step = br * EDGE_INSET;
  return {
    cx, cy, br,
    contains: inside,
    /**
     * `n` points spread along the perimeter by ARC LENGTH, not one share per
     * edge — a long skinny rectangle has two edges carrying almost all of its
     * perimeter, and an equal-per-edge split would report a fully buried long
     * side as only a quarter covered. Each point is then stepped along its
     * edge's inward normal, whichever of the two candidates lands inside.
     */
    outline: (n) => {
      if (!(perimeter > 0)) return abs.slice(0, n);
      const out: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < n; i++) {
        let d = (i / n) * perimeter;
        let k = 0;
        while (k < seg.length - 1 && d > seg[k]!) { d -= seg[k]!; k++; }
        const a = abs[k]!;
        const b = abs[(k + 1) % abs.length]!;
        const len = seg[k]!;
        const f = len > 0 ? d / len : 0;
        const px = a.x + (b.x - a.x) * f;
        const py = a.y + (b.y - a.y) * f;
        if (len <= 0) { out.push({ x: px, y: py }); continue; }
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        let qx = px - uy * step;
        let qy = py + ux * step;
        if (!inside(qx, qy)) { qx = px + uy * step; qy = py - ux * step; }
        out.push({ x: qx, y: qy });
      }
      return out;
    },
  };
}

function rectShape(cx: number, cy: number, halfW: number, halfH: number, rot: number): Shape {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const corner = (lx: number, ly: number) => ({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
  return polyShape(cx, cy, [
    corner(-halfW, -halfH), corner(halfW, -halfH), corner(halfW, halfH), corner(-halfW, halfH),
  ]);
}

function polygonShape(cx: number, cy: number, pts: Array<{ x: number; y: number }>, rot: number): Shape {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return polyShape(cx, cy, pts.map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos })));
}

/** The shape an entity paints at `t`, or null for kinds with no fillable area. */
function shapeOf(layer: LayerSpec, e: Entity, t: number, w: number, h: number): Shape | null {
  const s = layer.sprite;
  if (s.kind !== 'circle' && s.kind !== 'rect' && s.kind !== 'polygon') return null;
  const p = positionAt(e, t, w, h);
  const sz = sizeAt(e, t);
  if (!(sz > 0)) return null;
  if (s.kind === 'circle') return circleShape(p.x, p.y, sz / 2);
  const rot = rotationAt(e, t);
  if (s.kind === 'rect') {
    const h2 = e.size2 !== undefined ? e.size2 * (e.size > 0 ? sz / e.size : 1) : sz;
    return rectShape(p.x, p.y, sz / 2, h2 / 2, rot);
  }
  return polygonShape(p.x, p.y, polygonPoints(s, sz / 2), rot);
}

// ---------------------------------------------------------------------------
// Paint: will an overlap show?
// ---------------------------------------------------------------------------

/**
 * Why this layer's overlaps paint a visible edge, or null when they vanish.
 *
 * Opacity is judged over the whole timeline, not this instant: a layer that
 * breathes with `pulse` is translucent at some point in every cycle, so its
 * seams appear even if the sampled frame happens to catch it at full alpha.
 */
export function seamCauseOf(layer: LayerSpec): string | null {
  const s = layer.sprite;
  if ((s.kind === 'circle' || s.kind === 'polygon') && s.soft) {
    return 'sprite.soft — radial falloff never forms a hard union';
  }
  if (s.kind === 'rect' && s.feather) {
    return 'rect.feather — a feathered edge never forms a hard union';
  }
  if (layer.blend) {
    return `blend: ${layer.blend} — overlaps composite instead of covering`;
  }
  const [lo, hi] = layer.alpha ?? [1, 1];
  if (lo < 1 || hi < 1) {
    return `alpha ${lo === hi ? lo : `${lo}..${hi}`} — every overlap paints a darker patch`;
  }
  if (layer.pulse && layer.pulse.amp > 0) {
    return 'pulse — the layer is translucent for part of every cycle';
  }
  // Only palette entries the seeded pick can actually reach count: a
  // `colorWeights` entry of 0 means that colour is never drawn, so it cannot
  // put a seam between two neighbours.
  const palette = 'colors' in s && Array.isArray(s.colors) ? s.colors : null;
  const weights = 'colorWeights' in s && Array.isArray(s.colorWeights) ? s.colorWeights : null;
  if (palette) {
    const aligned = weights !== null && weights.length === palette.length;
    const reachable = new Set(palette.filter((_, i) => !aligned || (weights![i] ?? 0) > 0));
    if (reachable.size > 1) {
      return `sprite.colors has ${reachable.size} reachable colours — neighbours of unlike colour show their join`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Per-layer cohesion for an already-built scene. Takes entities rather than a
 * spec so `perceiveScene` and `adviseSpec` can each pass the scene they already
 * built instead of building a third one.
 */
export function cohesionOf(
  layers: Array<{ layer: LayerSpec; entities: Entity[] }>,
  t: number,
  w: number,
  h: number,
): LayerCohesion[] {
  return layers.map(({ layer, entities }, layerIndex) => {
    const seamCause = seamCauseOf(layer);
    const base: Omit<LayerCohesion, 'overlap' | 'reads'> = {
      layerIndex,
      key: layer.key,
      seamless: seamCause === null,
      seamCause,
    };

    // A layer staged out by `life` paints nothing at this instant, so asking
    // what it reads as has no answer — same as an unsupported sprite kind.
    if (lifeAlphaAt(layer.life, t) <= 0) return { ...base, overlap: null, reads: null };

    const shapes: Array<Shape | null> = entities.map((e) => shapeOf(layer, e, t, w, h));
    const solid = shapes.filter((x): x is Shape => x !== null);
    // A single entity has no sibling to merge with, and unsupported kinds have
    // no fillable outline — in both cases the question does not apply.
    if (solid.length < 2) return { ...base, overlap: null, reads: null };

    const stride = Math.max(1, Math.ceil(solid.length / MAX_TRACED));
    let covered = 0;
    let traced = 0;
    for (let i = 0; i < solid.length; i += stride) {
      const self = solid[i]!;
      const pts = self.outline(OUTLINE_SAMPLES);
      let hit = 0;
      for (const p of pts) {
        for (let j = 0; j < solid.length; j++) {
          if (j === i) continue;
          const other = solid[j]!;
          const dx = p.x - other.cx;
          const dy = p.y - other.cy;
          if (dx * dx + dy * dy > other.br * other.br) continue; // cheap reject
          if (other.contains(p.x, p.y)) { hit++; break; }
        }
      }
      covered += hit / pts.length;
      traced++;
    }

    const overlap = Number((covered / traced).toFixed(4));
    const reads: CohesionRead = overlap < MERGE_FLOOR ? 'marks' : seamCause === null ? 'mass' : 'seamed';
    return { ...base, overlap, reads };
  });
}

/**
 * True when a `seamed` layer is worth warning about: dense enough to be
 * deliberate, and opaque enough that it cannot be an atmospheric wash. Keeps
 * the advisory off the soft low-alpha glow fields the playbook recommends.
 */
export function seamsWorthWarning(layer: LayerSpec, c: LayerCohesion, entityCount: number): boolean {
  if (c.reads !== 'seamed' || entityCount < 6) return false;
  const [lo, hi] = layer.alpha ?? [1, 1];
  if ((lo + hi) / 2 < WASH_ALPHA_MAX) return false;
  return layer.blend !== 'lighter' && layer.blend !== 'screen';
}
