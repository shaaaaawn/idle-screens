import {
  createRng,
  type ControlTrack,
  type ParamDelta,
  type SaverContext,
  type SaverInstance,
  type SaverManifest,
  type SaverPlugin,
} from '@idle-screens/core';
import { assertValidSpec, assertValidSequence, validateSpec, validateSpecPaths } from './validate';
import { alphaAt, breakTextBlock, textBlockText, buildEntities, entityScales, graphemeClusters, headingAt, lifeAlphaAt, lifeStaggerAt, linkEdges, linkMaxDistPx, positionAt, revealState, rotationAt, sizeAt, spriteIndexAt, textBlockAnchorOffset, textMetricsClassFor, type Entity } from './simulate';
import {
  applyDeltasToSpec,
  canonicalSpecPath,
  easeGlide,
  easeSmooth,
  lerpSpec,
  lerpValue,
  readSpecPath,
  resolveSpecPath,
  STEER_EASES,
  structuralSignature,
  textStringsDiffer,
  type SteerDelta,
} from './steer';
import { transformOrigin } from './paint';
import { nextKeyAfter, resolveTimelineAt, timelineSampleTimesAfter } from './timeline';
import type { FieldBackground, IdleSequence, LayerSpec, LayerTransform, PathGradient, SaverSpec, SpriteSpec, WipeTransition } from './types';
import { LIMITS } from './types';
import { FIELD_RASTER_SHORT_SIDE, FIELD_RASTER_SHORT_SIDE_LOW, fieldRgbAt, fieldSampleTime } from './field';
import { createFinishPass, createSceneCanvas, presentWithFinish, type FinishPass } from './finish';
import { canMorph, canWrapMorph, morphChainRoot, normalizeSeed, resolveSegment, segmentRenderSeed, segmentStart, sequenceSwapCompatible, sequenceWantsFinish } from './sequence';
import { FEATHER_MASK_SIZE, barBox, barFraction, featherRamp, isPathPolygon, isShapedSprite, pathDrawCost, pathFrame, pathPaintSig, pathParts, polygonFillRule, polygonPoints, ribbonSides, strokeDrawnSamples, strokeLines, strokeOutline, strokeWidthPx, type PolygonSprite } from './shapes';
import { trailEchoes, trailFillBudget } from './trail';

const DEFAULT_STEER_DUR = 1000;

/**
 * Apply steering deltas to a spec one at a time, keeping each only if its
 * path resolves on this spec AND the result validates. This is the routing
 * rule for a sequence's retained track: a key path (`bars.sprite.values`) lands on
 * whichever segment owns the key and is a no-op on the others, and one delta
 * that is out of bounds for a given segment does not take the rest down with
 * it. Returns `spec` itself (same reference) when nothing applied, so callers
 * can skip work — and so a sequence with no track is byte-identical.
 */
function applyRetainedDeltas(spec: SaverSpec, deltas: Iterable<SteerDelta>): SaverSpec {
  let out = spec;
  for (const d of deltas) {
    if (!resolveSpecPath(out, d.path)) continue;
    const next = applyDeltasToSpec(out, [d]);
    if (validateSpec(next).valid) out = next;
  }
  return out;
}

/** Expand #rgb/#rrggbb to an rgba() string — needed for gradient stops with alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const FONT_PREFIX_RE = /^((?:(?:italic|oblique|bold|bolder|lighter|normal|\d{3})\s+)+)/;

/**
 * Matches the size token in a CSS font shorthand ("bold 26px monospace").
 *
 * The digit runs are bounded on purpose. This ran as `(\d*\.?\d+)px`, where
 * `\d*` and `\d+` can split the same digit run many ways, so a long run that
 * never reaches "px" makes the engine retry every split at every start
 * position. `sprite.font` comes straight from an authored SaverSpec, so that
 * input is reachable by anyone who can publish a scene: 1 000 digits took
 * 600 ms and 5 000 took 62 SECONDS, which is a denial of service rather than
 * a slow path. Bounding each run makes the work per start position constant —
 * 200 000 chars now costs about 4 ms.
 *
 * The bounds are far past anything real: no CSS font size needs more than
 * five integer digits or four decimals. `.5px` still parses via the second
 * branch.
 */
const FONT_PX_RE = /(\d{1,5}(?:\.\d{1,4})?|\.\d{1,4})px/;

/**
 * Rescale an explicit px size inside a font shorthand.
 *
 * A spec in the default `viewport` units expresses every other dimension as a
 * fraction of `min(w, h)`, so a font pinned to absolute pixels is the one thing
 * that does NOT adapt: `bold 26px monospace` renders 26px whether the canvas is
 * 1920 or 320 wide, which is how the dashboard's text came to overlap itself at
 * thumbnail size. Scaling it by `min(w, h) / referenceViewport` makes it behave
 * like the rest of the spec. Specs that opt into `units: 'px'` are asking for
 * absolute sizes and are left alone.
 */
function scaleFontPx(font: string, factor: number): string {
  if (factor === 1) return font;
  return font.replace(FONT_PX_RE, (_m, n: string) => `${(Number(n) * factor).toFixed(2)}px`);
}

/** Build a valid CSS font shorthand: weight/style tokens must precede the size. */
function composeFontShorthand(sz: number, font: string): string {
  const m = FONT_PREFIX_RE.exec(font);
  if (m) return `${m[1].trim()} ${sz}px ${font.slice(m[0].length)}`;
  return `${sz}px ${font}`;
}

/** Derive a manifest so a compiled spec composes with @idle-screens/capabilities. */
export function manifestFor(spec: SaverSpec): SaverManifest {
  const total = spec.layers.reduce((n, l) => n + l.count, 0);
  const costTier = total < 30 ? 'idle' : total < 150 ? 'low' : total < 400 ? 'medium' : 'high';
  return {
    id: spec.id,
    label: spec.label,
    // Declarative specs are closed-form by construction: every entity is a
    // pure function of (seed, t), which is the whole point of the format.
    timeModel: 'closed-form',
    passthrough: false,
    minBackend: 'canvas2d',
    costTier,
    motionIntensity: spec.motionIntensity ?? 'moderate',
    reducedMotionFallback: 'static',
    // Flash-safe by construction: static background + bounded sprites, no strobe
    // primitive. Proven by sampling a compiled spec through @idle-screens/validator.
    a11y: { flashSafe: true },
    workerReady: true,
  };
}

interface Built {
  layer: LayerSpec;
  entities: Entity[];
}

/**
 * Internal, per-layer: paint the layer twice for a window — the `outgoing`
 * sprite (the same sprite with the previous words) at `1 − k`, the layer's
 * own sprite at `k`. Set by a `SequenceInstance` for the `text` / `textBlock`
 * layers of a morph declared `text: 'crossfade'`; never from a spec field.
 * Only text sprites are ever drawn this way.
 */
interface LayerPaintOverride {
  outgoing: SpriteSpec;
  k: number;
  /**
   * `crossfade` (absent): outgoing at `1 − k` over incoming at `k`, both
   * strings on screen mid-morph. `dip`: outgoing fades out over the first
   * half, incoming fades in over the second — never two strings at once.
   */
  mode?: 'crossfade' | 'dip';
}

/** One draw's paint override: which sprite to paint, and an alpha multiplier on top of the entity's own. */
interface PaintPass {
  sprite?: SpriteSpec;
  alpha: number;
}

/**
 * The device's compute tier (`computeTier` from `@idle-screens/capabilities`;
 * the string union is repeated here so schema does not depend on that
 * package). Hosts pass it on the mount context; a compiled scene reads it to
 * step down work that a `basic` / `minimal` device cannot afford.
 */
export type CapabilityTier = 'minimal' | 'basic' | 'standard' | 'high';

/**
 * Mount context for a compiled spec. A plain `SaverContext` works — every
 * field here is optional. `capabilityTier` `basic` / `minimal` halves a
 * `field` background's raster resolution (48 px short side instead of 96).
 * Absent ⇒ full resolution.
 */
export interface SpecMountContext extends SaverContext {
  capabilityTier?: CapabilityTier;
}

/**
 * A `field` background's cached raster: the field sampled once per cell at
 * the bucketed time, kept until the bucket, the config or the canvas size
 * changes. Drawing a frame is one `drawImage` of this, scaled to the canvas.
 */
interface FieldRaster {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  cols: number;
  rows: number;
  /** `JSON.stringify` of the config plus dims plus the sample time it was painted for. */
  key: string;
}

/** Per-instance options a host (today: `SequenceInstance`) sets; a plain compileSaver mount sets none. */
interface SpecInstanceOptions {
  /** See `SpecMountContext.capabilityTier`. */
  capabilityTier?: CapabilityTier;
  /**
   * The host presents the frame and applies any `finish` itself (a
   * `SequenceInstance` does, once per composed frame), so this instance
   * never opens a presentation pass of its own — its spec's `finish` is the
   * host's to honour. A plain compileSaver mount presents itself.
   */
  hostPresents?: boolean;
  /**
   * Draw over whatever is already on the surface: `drawBackground` is skipped,
   * the frame is not cleared to a colour, and `ghosting` is ignored (a smear
   * needs an opaque ground to decay into — the surface owner may declare its
   * own). The instance never clears the surface either; the owner does.
   * A sequence's segment children over a `bed` render this way.
   */
  transparent?: boolean;
  /**
   * Skip the constructor's own eager paused-mount paint. For a transparent
   * instance whose owner is about to call `renderFrame` again immediately
   * with paint overrides already set (a morph chain-root child, mounted
   * mid-morph) — the constructor's plain paint would otherwise leave a
   * stray full-opacity frame on the shared surface underneath, which a
   * partial-alpha override pass (`text: 'crossfade'`) then composites over
   * rather than replaces.
   */
  skipInitialPaint?: boolean;
}

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** A live steer held on a timeline scene — see `SpecInstance.overrides`. */
interface TimelineOverride {
  /** The path's last segment — lets a whole-`transform` glide fill identity fields (see `lerpValue`). */
  leaf: string;
  from: unknown;
  to: unknown;
  t0: number;
  dur: number;
  until: number;
  outDur: number;
  /** A named steer ease (`in` / `out` / `spring`) for the glide in; absent ⇒ smooth, as before eases were honoured. */
  ease?: string;
}
const EXPIRED = Symbol('expired');

/** An override's glide-in value at scene time `t` (before `until`). */
function overrideHeldAt(o: TimelineOverride, t: number): unknown {
  const k = o.dur > 0 ? easeGlide(o.ease, clamp01((t - o.t0) / o.dur)) : 1;
  return k >= 1 ? o.to : lerpValue(o.from, o.to, k, false, o.leaf);
}

/**
 * An override's value at scene time `t`: glide in, hold, glide back to the
 * timeline, then expire. The glide back starts from wherever the glide in
 * had reached at `until` — a key that lands mid-glide takes the path back
 * from there, not from the steer's target (which would be a jump).
 */
function overrideValueAt(o: TimelineOverride, t: number, timelineValue: () => unknown): unknown {
  if (t < o.until) return overrideHeldAt(o, t);
  if (o.outDur > 0 && t < o.until + o.outDur) return lerpValue(overrideHeldAt(o, o.until), timelineValue(), easeSmooth((t - o.until) / o.outDur), false, o.leaf);
  return EXPIRED;
}

/** A steer's identity across re-sends: the server's stamp and the value (see `SpecInstance.seenSteers`). */
const steerId = (d: SteerDelta): string => `${d.t}|${JSON.stringify(d.value)}`;

/** Arm one steer on a timeline scene at scene time `now` — the steering rule: held until the path's next key, or sticky when no key will touch it. */
function armOverride(authored: SaverSpec, path: string, from: unknown, to: unknown, now: number, glide: number, ease?: string): TimelineOverride {
  const next = nextKeyAfter(authored, path, now);
  const o: TimelineOverride = { leaf: path.slice(path.lastIndexOf('.') + 1), from, to, t0: now, dur: glide, until: next ? next.at : Number.POSITIVE_INFINITY, outDur: next ? next.dur : 0 };
  if (ease) o.ease = ease;
  return o;
}

/**
 * The ease a live steer glides with: the named ease (`in` / `out` /
 * `spring`) of its longest delta, else undefined (smooth). The older names
 * (`step` / `linear` / `smooth`) were carried on tracks before steers read an
 * ease at all, so they keep meaning smooth — honouring them now would change
 * how every stored track replays.
 */
function steerEase(deltas: readonly SteerDelta[]): string | undefined {
  let best: SteerDelta | undefined;
  for (const d of deltas) if (!best || (d.dur ?? DEFAULT_STEER_DUR) > (best.dur ?? DEFAULT_STEER_DUR)) best = d;
  return best?.ease !== undefined && STEER_EASES.has(best.ease) ? best.ease : undefined;
}

/**
 * `resolved` (a timeline resolved at `t`) with the live overrides layered on.
 * `expired` collects the paths whose override has run out, so an owner can
 * drop them; nothing is mutated here.
 */
function applyOverridesAt(resolved: SaverSpec, overrides: ReadonlyMap<string, TimelineOverride>, t: number, expired?: string[]): SaverSpec {
  if (overrides.size === 0) return resolved;
  const deltas: SteerDelta[] = [];
  for (const [path, o] of overrides) {
    const v = overrideValueAt(o, t, () => readSpecPath(resolved, path));
    if (v === EXPIRED) { expired?.push(path); continue; }
    deltas.push({ t: 0, path, value: v });
  }
  return deltas.length > 0 ? applyDeltasToSpec(resolved, deltas) : resolved;
}

/**
 * Whether a timeline scene stays valid with these overrides on it — now, and
 * at every key boundary still ahead (a sticky steer outlives the keys, and
 * two values each valid alone can break a flash-safety ratio together).
 */
function overridesStayValid(authored: SaverSpec, overrides: ReadonlyMap<string, TimelineOverride>, now: number): boolean {
  // Only the layers (or background/finish) the overrides live in can be broken
  // by them — the timeline alone was validated with the spec — so judge just
  // those, and only at states not already judged.
  const paths = [...overrides.keys()];
  if (paths.length === 0) return true;
  const groupOf = (p: string): string => p.split('.').slice(0, p.startsWith('layers.') ? 2 : 1).join('.');
  const groups = [...new Set(paths.map(groupOf))];
  // The keys that can combine with these steers are those in the same
  // groups (or any, when a steer falls back to the full check).
  const full = paths.some((p) => /^layers\.\d+(\.(key|count|motion)(\.|$)|$)/.test(p) || p === 'groups' || !/^(layers|background|finish|groups)(\.|$)/.test(p));
  const only = full ? undefined : (p: string): boolean => groups.includes(groupOf(p));
  const seen = new Set<string>();
  for (const t of [now, ...timelineSampleTimesAfter(authored, now, false, only)]) {
    const held = new Map<string, TimelineOverride>();
    // Judge each override at its held value (the glide-back runs between two valid values).
    for (const [p, o] of overrides) if (t < o.until) held.set(p, { ...o, t0: Number.NEGATIVE_INFINITY });
    const r = applyOverridesAt(resolveTimelineAt(authored, t), held, t);
    const state = JSON.stringify(groups.map((g) => readSpecPath(r, g))) + '|' + [...held.keys()].join(',');
    if (seen.has(state)) continue;
    seen.add(state);
    if (!validateSpecPaths(r, paths, true)) return false;
  }
  return true;
}

type PathFrameT = { sx: number; sy: number; ox: number; oy: number; uniform: boolean };

/** Path polygons with at least this many outline points draw from a render-once bitmap. */
const PATH_BLIT_MIN_POINTS = 128;
/** A run of static path layers earns a full-frame plate only past this many outline points — below it, the plate copy costs more than the fills it saves. */
const PLATE_MIN_POINTS = 2500;
/** Distinct bitmaps one path sprite may hold before it is judged "changing" and flushed. */
const PATH_BLIT_PER_SPRITE = 8;
/** Distinct drawings (by content) the path caches remember at once. */
const PATH_SLOT_MAX = 96;
/** Colour × size-step bitmaps one drawing may hold in the moving-sprite cache. */
const PATH_SPRITE_PER_SPRITE = 96;
/** Largest moving-sprite bitmap (device px): beyond it a resampled (and maybe rotated) copy costs more than the fills — big moving drawings draw directly. */
const PATH_SPRITE_MAX_PIXELS = 512 * 512;
/** Outline points per million device pixels a bitmap must carry to beat a direct fill: big simple shapes (a skyline wall) fill faster than they blit. */
const PATH_BLIT_MIN_DENSITY = 1500;
/** Device pixels all path bitmaps together may hold (~64 MB of RGBA). */
const PATH_BLIT_MAX_PIXELS = 16_000_000;

/** A Path2D of polylines (unit coordinates), closing the closed ones. */
function ringPath2D(lines: Array<{ points: Array<[number, number]>; closed: boolean }>): Path2D {
  const p2 = new Path2D();
  for (const l of lines) {
    if (l.points.length < 2) continue;
    p2.moveTo(l.points[0]![0], l.points[0]![1]);
    for (let i = 1; i < l.points.length; i++) p2.lineTo(l.points[i]![0], l.points[i]![1]);
    if (l.closed) p2.closePath();
  }
  return p2;
}

/** The same polylines traced on the context's current path (no Path2D). */
function traceLines(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, lines: Array<{ points: Array<[number, number]>; closed: boolean }>): void {
  g.beginPath();
  for (const l of lines) {
    if (l.points.length < 2) continue;
    g.moveTo(l.points[0]![0], l.points[0]![1]);
    for (let i = 1; i < l.points.length; i++) g.lineTo(l.points[i]![0], l.points[i]![1]);
    if (l.closed) g.closePath();
  }
}

/** A path gradient as a canvas gradient in unit-box coordinates (the caller has scaled by the radius). */
function pathGradientFill(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, gr: PathGradient): CanvasGradient {
  const grad = gr.type === 'linear'
    ? g.createLinearGradient(gr.from[0], gr.from[1], gr.to[0], gr.to[1])
    : g.createRadialGradient((gr.focus ?? gr.center)[0], (gr.focus ?? gr.center)[1], 0, gr.center[0], gr.center[1], gr.radius);
  for (const st of gr.stops) grad.addColorStop(st.at, st.opacity === undefined ? st.color : hexToRgba(st.color, st.opacity));
  return grad;
}

/** The soft-sprite radial gradient (1 → 0.75 at 0.35 r → 0 at r), centred on the entity. */
function softFill(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, color: string, r: number): CanvasGradient {
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, hexToRgba(color, 0.75));
  grad.addColorStop(1, hexToRgba(color, 0));
  return grad;
}

type Canvas2D = { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D };
/** One entity's pre-rendered feathered rect: the rotated white mask, and its tint. */
interface FeatherBlit {
  shapeKey: string;
  w: number;
  h: number;
  white: Canvas2D;
  tint: Canvas2D;
  tintKey: string;
  tintAt: number;
  /** Phase offset for the first re-tint, spreading a layer's re-tints over frames. */
  stagger?: number;
  /** The shape key seen most recently, and the paintSeq it was first seen at. */
  seenKey: string;
  seenAt: number;
}

/**
 * A wipe's revealed region at progress `k` as a fill: opaque where the
 * incoming segment shows, clear where the outgoing still does, ramping over
 * the feathered edge — in the canvas's own pixels (`cw` × `ch`). The edge
 * starts just outside the frame and ends past its far side (feather
 * included), so k = 0 reveals nothing and k = 1 everything.
 */
export function wipeMask(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: WipeTransition, k: number, cw: number, ch: number): CanvasGradient {
  const f = Math.max(0, Math.min(1, w.feather ?? 0.08));
  if ((w.shape ?? 'circle') === 'line') {
    const a = ((w.angle ?? 0) * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const proj = [0, cw * ux, ch * uy, cw * ux + ch * uy];
    const p0 = Math.min(...proj);
    const span = Math.max(...proj) - p0;
    const fw = Math.max(1, f * span);
    const lead = p0 + k * (span + fw);
    const trail = lead - fw;
    const g2 = g.createLinearGradient(ux * trail, uy * trail, ux * lead, uy * lead);
    g2.addColorStop(0, 'rgba(0,0,0,1)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    return g2;
  }
  const ox = Math.max(0, Math.min(1, w.origin?.x ?? 0.5)) * cw;
  const oy = Math.max(0, Math.min(1, w.origin?.y ?? 0.5)) * ch;
  const reach = Math.max(Math.hypot(ox, oy), Math.hypot(cw - ox, oy), Math.hypot(ox, ch - oy), Math.hypot(cw - ox, ch - oy));
  const fw = Math.max(1, f * reach);
  const outer = Math.max(1e-3, k * (reach + fw));
  const inner = Math.max(0, outer - fw);
  const g2 = g.createRadialGradient(ox, oy, inner, ox, oy, Math.max(outer, inner + 1e-3));
  g2.addColorStop(0, 'rgba(0,0,0,1)');
  g2.addColorStop(1, 'rgba(0,0,0,0)');
  return g2;
}

class SpecInstance implements SaverInstance {
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly ownsCanvas: boolean;
  private readonly transparent: boolean;
  private readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private readonly saverCtx: SaverContext;
  private readonly seed: number;
  private w: number;
  private h: number;
  private layers: Built[] = [];
  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  private baseT = 0; // elapsed logical time carried across pause/resume
  private lastT = 0;
  /** Last time painted — detects non-contiguous seeks for the ghosting warm-up replay. */
  private lastRenderT = Number.NEGATIVE_INFINITY;

  /** The spec currently being rendered (base spec + any applied steering). */
  private effSpec: SaverSpec;
  /** Active glide between two resolved specs (live setParam/applyTrack). */
  private transition: { from: SaverSpec; to: SaverSpec; startT: number; dur: number; ease?: string } | null = null;
  private lastStructural = '';
  /** See `LayerPaintOverride`; null (the default, and every plain mount) draws every layer once. */
  private paintOverrides: ReadonlyMap<number, LayerPaintOverride> | null = null;
  /**
   * The authored spec when it carries a `timeline` (null for every other
   * scene — which then never enters the timeline path). Each painted frame
   * resolves it at that frame's own time, so ghosting's warm-up replay and
   * any seek see the timeline exactly where it was.
   */
  private authored: SaverSpec | null = null;
  /**
   * Live steers on a timeline scene, by index-form path. A steer on a path no
   * key animates holds forever (sticky, exactly as on a scene without a
   * timeline); on an animated path it holds `until` that path's next key,
   * then glides back to the timeline over `outDur`.
   */
  private overrides: Map<string, TimelineOverride> = new Map();
  /**
   * The last registered steer per path, as `t|value`. A host re-sends the
   * whole channel track on every steer (idle-server broadcasts the full track
   * so viewers converge), and a steer's `t` is the server's stamp — stable
   * across re-sends. Without this, an unrelated later steer would re-arm a
   * hold the timeline had already taken back. Keyed by path (not by the full
   * `path|t|value` history) so a long-running instance re-steered thousands
   * of times doesn't accumulate an unbounded set — only the most recent id
   * per path can ever recur.
   */
  private seenSteers = new Map<string, string>();
  /** Raster short side for a `field` background — halved on the low tiers. */
  private readonly fieldShortSide: number;
  /** The `field` background's cached raster; null until a field is first painted. */
  private field: FieldRaster | null = null;
  private readonly featherWhite = new Map<number, HTMLCanvasElement | OffscreenCanvas>();
  /** Per-entity pre-rendered feathered rects (see `blitFeather`), and the device pixels they hold. */
  private readonly featherBlits = new WeakMap<Entity, FeatherBlit>();
  private featherBlitPx = 0;
  private featherBlitN = 0;
  private paintSeq = 0;
  /** Per layer: ribbon area painted this frame (px²), and whether its trails ribbon (see ribbonAllowed). */
  private readonly ribbonBudget = new WeakMap<Built, { seq: number; area: number; ribbon: boolean }>();
  /**
   * Render-once cache for path polygons (polygon.path). A detailed drawing is
   * rasterised once per (colour, device size, rotation, sub-pixel offset)
   * into its own bitmap and copied 1:1 at a whole-pixel offset every frame
   * after — so a static 7,000-point drawing costs a blit, not a re-fill.
   * Keyed by the sprite object, so a steer or republish (a new spec object)
   * starts clean. A drawing whose key keeps changing (spinning, trailing,
   * growing) stops being cached and draws from a reused Path2D instead.
   */
  private readonly pathBlits = new Map<string, { entries: Map<string, { canvas: HTMLCanvasElement | OffscreenCanvas; x0: number; y0: number; px: number }>; flushes: number; off: boolean; parts2d?: Array<{ fill?: Path2D | null; fillPart?: Path2D | null; stroke?: Path2D | null }>; sprite?: boolean }>();
  /** Test/bench switch: `globalThis.__idleNoPathCache = true` before compiling draws every path directly. */
  private readonly noPathCache = (globalThis as { __idleNoPathCache?: boolean }).__idleNoPathCache === true;
  /** Device pixels held by every pathBlits bitmap — capped so a TV never pays more than PATH_BLIT_MAX_PIXELS of memory. */
  private pathBlitPixels = 0;
  private readonly featherTints = new Map<string, { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D }>();
  /**
   * The presentation pass when this instance applies a `finish`: the
   * visible canvas plus the cached screen tiles. When set, `this.canvas` is
   * an offscreen SCENE canvas — the surface every layer (and `ghosting`'s
   * persistence) draws into — and each frame ends by copying it to the
   * visible canvas and screening the finish over the copy. The finish thus
   * never enters the persistence loop. Null (every plain mount without a
   * finish, every sequence child) draws straight onto the visible canvas,
   * exactly as before the field existed.
   */
  private finishPass: FinishPass | null = null;
  /** False on the `basic`/`minimal` tiers — `finish.animate` renders as a static tile. */
  private readonly animateFinish: boolean;

  constructor(
    private readonly spec: SaverSpec,
    ctx: SaverContext,
    opts: SpecInstanceOptions = {},
  ) {
    this.effSpec = spec;
    if (spec.timeline) {
      this.authored = spec;
      this.effSpec = resolveTimelineAt(spec, 0);
    }
    this.saverCtx = ctx;
    this.transparent = opts.transparent === true;
    const tier = opts.capabilityTier;
    this.fieldShortSide = tier === 'basic' || tier === 'minimal' ? FIELD_RASTER_SHORT_SIDE_LOW : FIELD_RASTER_SHORT_SIDE;
    this.animateFinish = tier !== 'basic' && tier !== 'minimal';
    this.seed = normalizeSeed(spec.seed ?? ctx.seed);
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (ctx.surface) {
      canvas = ctx.surface;
      this.ownsCanvas = false;
    } else {
      const el = document.createElement('canvas');
      el.style.cssText = 'display:block;width:100%;height:100%';
      el.setAttribute('aria-hidden', 'true');
      ctx.host.appendChild(el);
      canvas = el;
      this.ownsCanvas = true;
    }
    if (spec.finish !== undefined && !this.transparent && !opts.hostPresents) {
      // Present through a pass: the visible canvas becomes the pass's, and
      // the scene draws offscreen. Decided once, from the mounted spec — a
      // steer can only change a `finish` that already exists.
      const pass = createFinishPass(canvas, this.seed);
      if (pass) {
        this.finishPass = pass;
        canvas = createSceneCanvas(ctx.width, ctx.height);
      }
    }
    this.canvas = canvas;
    // Transparent instances (a bed's own offscreen fade canvas) never paint a
    // background, so their cleared/unpainted pixels must stay actually
    // transparent for `composite()`'s drawImage to blend only the ink onto
    // the bed — an opaque (alpha: false) context turns those pixels solid
    // black instead. Opaque instances keep alpha: false (unchanged).
    const c2d = canvas.getContext('2d', { alpha: this.transparent }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!c2d) throw new Error('schema saver: no 2d context');
    this.ctx = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();
    this.rebuild();

    this.paused = ctx.reducedMotion;
    if (this.paused) {
      if (!opts.skipInitialPaint) this.renderFrame(0, this.seed);
    } else {
      this.start();
    }
  }

  /** Viewport factor for absolute px sizes — 1 for `units: 'px'` specs. */
  private fontScale(): number {
    if (this.effSpec.units === 'px') return 1;
    return Math.min(this.w, this.h) / (this.effSpec.referenceViewport ?? LIMITS.referenceViewport);
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.saverCtx.dpr, 2);
    // Assign only on a real change: writing `width`/`height` wipes a canvas
    // even when the value is the same, and a sequence child shares its
    // parent's surface — a segment mounting over a `bed` used to erase the
    // bed painted a moment earlier, one black frame at every cut. A fresh
    // canvas is blank anyway, and every frame repaints (or, after a resize,
    // the ghosting warm-up below replays from a full clear).
    const cw = Math.max(1, Math.round(this.w * dpr));
    const ch = Math.max(1, Math.round(this.h * dpr));
    if (this.canvas.width !== cw) this.canvas.width = cw;
    if (this.canvas.height !== ch) this.canvas.height = ch;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.finishPass) {
      // The visible canvas mirrors the scene canvas, same size and transform.
      if (this.finishPass.canvas.width !== cw) this.finishPass.canvas.width = cw;
      if (this.finishPass.canvas.height !== ch) this.finishPass.canvas.height = ch;
      this.finishPass.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    // Resizing clears the canvas — force a ghosting warm-up on the next frame.
    this.lastRenderT = Number.NEGATIVE_INFINITY;
  }

  /** (Re)seed and place all entities — deterministic for the seed + viewport. */
  private rebuild(): void {
    const rng = createRng(this.seed);
    const { scale, countScale } = entityScales(this.effSpec, this.w, this.h);
    this.layers = this.effSpec.layers.map((layer) => ({ layer, entities: buildEntities(layer, rng, this.w, this.h, scale, countScale) }));
    this.lastStructural = structuralSignature(this.effSpec);
  }

  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.startT = 0;
    this.frameId = requestAnimationFrame((now) => this.loop(now));
  }

  private stop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    // Freeze elapsed time so resume continues the scene instead of restarting at t=0.
    this.baseT = this.lastT;
  }

  private loop(now: number): void {
    this.frameId = requestAnimationFrame((n) => this.loop(n));
    if (this.startT === 0) this.startT = now;
    this.lastT = now - this.startT + this.baseT;
    this.renderFrame(this.lastT, this.seed);
  }

  private drawBackground(t: number): void {
    const { ctx, w, h } = this;
    const bg = this.effSpec.background;
    if (!bg || bg.type === 'solid') {
      ctx.fillStyle = bg?.color ?? '#05050a';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    if (bg.type === 'field') {
      this.drawField(bg, t);
      return;
    }
    const g = ctx.createLinearGradient(0, 0, 0, h);
    const drift = bg.drift;
    for (let i = 0; i < bg.stops.length; i++) {
      const s = bg.stops[i]!;
      let at = s.at;
      if (drift) {
        const amount = drift.amount ?? 0.15;
        const phase = (i / bg.stops.length) * Math.PI * 2;
        at = Math.max(0, Math.min(1, at + amount * Math.sin((t * 2 * Math.PI) / drift.period + phase)));
      }
      g.addColorStop(at, s.color);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (bg.band) {
      ctx.fillStyle = bg.band.color;
      const bh = bg.band.height * (this.effSpec.units === 'px' ? 1 : Math.min(w, h));
      ctx.fillRect(0, h - bh, w, bh);
    }
  }

  /**
   * Paint a `field` background: sample the field into a low-res raster (short
   * side `fieldShortSide`, the long side by aspect) and draw it scaled to the
   * canvas — nearest-neighbour for quantised bands so contours stay crisp,
   * smoothed for `quantize: 0`. The raster is recomputed only when its key
   * changes: the config (steering glides it), the canvas size, or — while
   * drifting — the 100 ms bucket `t` falls in (`fieldSampleTime`); a static
   * field is sampled exactly once per mount. `luminanceGrid` samples the same
   * function at the same bucketed time, so perception and paint agree.
   */
  private drawField(bg: FieldBackground, t: number): void {
    const { ctx, w, h } = this;
    const short = Math.max(1, Math.min(w, h));
    const cols = Math.max(1, Math.round((this.fieldShortSide * w) / short));
    const rows = Math.max(1, Math.round((this.fieldShortSide * h) / short));
    const ft = fieldSampleTime(bg, t);
    // `w`x`h`, not just the rounded `cols`x`rows`: a resize that changes the
    // aspect ratio without moving the rounded raster size would otherwise
    // reuse a raster sampled for the old aspect ratio.
    const key = `${JSON.stringify(bg)}|${w}x${h}|${cols}x${rows}|${ft}`;
    let raster = this.field;
    if (!raster || raster.key !== key) {
      if (!raster || raster.cols !== cols || raster.rows !== rows) {
        const canvas: HTMLCanvasElement | OffscreenCanvas = typeof document !== 'undefined'
          ? document.createElement('canvas')
          : new OffscreenCanvas(cols, rows);
        canvas.width = cols;
        canvas.height = rows;
        const rctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (!rctx) return;
        raster = { canvas, ctx: rctx, cols, rows, key: '' };
      }
      const img = raster.ctx.createImageData(cols, rows);
      const data = img.data;
      const seed = this.seed;
      let i = 0;
      for (let r = 0; r < rows; r++) {
        // Cell centres in short-side units — the same normalisation perceive uses.
        const v = ((r + 0.5) * h) / rows / short;
        for (let c = 0; c < cols; c++) {
          const u = ((c + 0.5) * w) / cols / short;
          const rgb = fieldRgbAt(u, v, ft, bg, seed);
          data[i++] = rgb[0];
          data[i++] = rgb[1];
          data[i++] = rgb[2];
          data[i++] = 255;
        }
      }
      raster.ctx.putImageData(img, 0, 0);
      raster.key = key;
      this.field = raster;
    }
    const smooth = Math.round(bg.quantize ?? bg.bands.length) < 2;
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = smooth;
    ctx.drawImage(raster.canvas, 0, 0, w, h);
    ctx.imageSmoothingEnabled = prev;
  }

  /** Position with parent-orbit resolution: a layer-parented orbit entity's
   *  positionAt is an offset around (0,0); add the parent's own analytic position. */
  private entityPos(e: Entity, t: number, parentE: Entity | null): { x: number; y: number; flip: boolean } {
    const p = positionAt(e, t, this.w, this.h);
    if (parentE && e.orbitParent) {
      const pp = positionAt(parentE, t, this.w, this.h);
      p.x += pp.x;
      p.y += pp.y;
    }
    return p;
  }

  /** Resolve the single parent entity for a layer-parented orbit layer (or null). */
  private parentEntityFor(built: Built): Entity | null {
    const m = built.layer.motion;
    if (m.type !== 'orbit' || !m.center || !('layer' in m.center)) return null;
    const key = m.center.layer;
    const parent = this.layers.find((b) => b.layer.key === key);
    return parent?.entities[0] ?? null;
  }

  private drawTrail(built: Built, e: Entity, t: number, lifeA: number, parentE: Entity | null): void {
    const trail = built.layer.trail;
    if (!trail) return;
    const { ctx, w, h } = this;
    const headAlpha = alphaAt(e, t) * lifeA;
    const headSize = sizeAt(e, t);
    const sprite = built.layer.sprite;
    const shaped = isShapedSprite(sprite) && sprite.kind !== 'circle';
    const isSoft = sprite.kind === 'circle' && !!sprite.soft;
    const hardCircle = sprite.kind === 'circle' && !sprite.soft;
    const ribbon = hardCircle && this.ribbonAllowed(built);
    const posAt = (pt: number): { x: number; y: number } => this.entityPos(e, pt, parentE);
    // Only soft discs (and glyph trails) are gap-filled: a hard circle's
    // echoes are joined into a ribbon, and a shape's echoes stay at their
    // time samples — so neither draws more than the 24 echoes it always did.
    const fill = shaped || hardCircle ? 0 : trailFillBudget(built.entities.length);
    const echoes = trailEchoes(trail, t, headAlpha, headSize, posAt, w, h, built.layer.wrap !== false, fill, 0, built.layer.blend === 'lighter');
    if (echoes.length === 0) return;
    const head = posAt(t);
    if (hardCircle) {
      // The area this trail's ribbon covers (whether or not it is drawn as one), for the layer's ribbon budget.
      const rb = this.ribbonBudget.get(built)!;
      let prev = head;
      let r0 = headSize / 2;
      for (const ec of echoes) {
        rb.area += Math.hypot(ec.x - prev.x, ec.y - prev.y) * (r0 + ec.r);
        prev = ec;
        r0 = ec.r;
      }
    }
    // A shaped sprite's afterglow is echoes of its own shape (X387: a polygon
    // or stroke used to trail fat discs), at the echo's own time — so a
    // spinning or heading-oriented mark echoes the way it was turned then.
    if (shaped) {
      for (const ec of echoes) this.drawEntity(built, e, ec.t, 1, parentE, undefined, { x: ec.x, y: ec.y, size: ec.r * 2, alpha: ec.alpha });
      return;
    }
    const resolvedColor = isShapedSprite(sprite)
      ? (sprite.colors?.[e.colorIndex] ?? sprite.color)
      : sprite.kind === 'text' || sprite.kind === 'textBlock' ? (sprite.color ?? '#e6e8ef') : '#e6e8ef';
    if (ribbon) {
      // X469: one continuous ribbon from the head back through every echo,
      // tapering with the echoes' radii — each span a quad between two
      // shared cross-sections, so nothing overlaps (no beads under a blend)
      // and a fast mover draws a line, not dots, for the same 24 fills.
      // Spans whose alphas sit within 4 % of the head's are merged into one
      // fill, so a gently fading trail costs a handful of fills, not 24.
      // Each span is subdivided at its own times (≤ ~12 px chords, ≤ 8 per
      // span) so a curving path stays a curve, not 24 straight chords; the
      // extra points are vertices, not fills.
      const pts: Array<{ x: number; y: number }> = [head];
      const radii: number[] = [headSize / 2];
      const alphas: number[] = [headAlpha];
      let prevT = t;
      for (const ec of echoes) {
        const p0 = pts[pts.length - 1]!;
        const r0 = radii[radii.length - 1]!;
        const a0 = alphas[alphas.length - 1]!;
        const sub = Math.max(1, Math.min(8, Math.ceil(Math.hypot(ec.x - p0.x, ec.y - p0.y) / 12)));
        for (let j = 1; j < sub; j++) {
          const f = j / sub;
          pts.push(posAt(prevT + (ec.t - prevT) * f));
          radii.push(r0 + (ec.r - r0) * f);
          alphas.push(a0 + (ec.alpha - a0) * f);
        }
        pts.push(ec);
        radii.push(ec.r);
        alphas.push(ec.alpha);
        prevT = ec.t;
      }
      const { left, right } = ribbonSides(pts, radii);
      ctx.fillStyle = resolvedColor;
      const tol = Math.max(0.004, headAlpha * 0.04);
      let from = 0; // first cross-section of the current chunk
      while (from < pts.length - 1) {
        const a0 = alphas[from + 1]!;
        let to = from + 1;
        let sum = a0;
        while (to < pts.length - 1 && Math.abs(alphas[to + 1]! - a0) <= tol) { sum += alphas[to + 1]!; to++; }
        ctx.globalAlpha = sum / (to - from);
        ctx.beginPath();
        ctx.moveTo(left[from]!.x, left[from]!.y);
        for (let i = from + 1; i <= to; i++) ctx.lineTo(left[i]!.x, left[i]!.y);
        for (let i = to; i >= from; i--) ctx.lineTo(right[i]!.x, right[i]!.y);
        ctx.closePath();
        ctx.fill();
        from = to;
      }
      return;
    }
    for (const ec of echoes) {
      ctx.globalAlpha = ec.alpha;
      if (isSoft) {
        const g = ctx.createRadialGradient(ec.x, ec.y, 0, ec.x, ec.y, ec.r);
        g.addColorStop(0, resolvedColor);
        g.addColorStop(0.35, hexToRgba(resolvedColor, 0.75));
        g.addColorStop(1, hexToRgba(resolvedColor, 0));
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = resolvedColor;
      }
      ctx.beginPath();
      ctx.arc(ec.x, ec.y, ec.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Whether this layer's hard-circle trails draw as ribbons this frame. A
   * ribbon paints its trail's whole length, so a layer of many fast, long
   * trails can paint far more pixels than its dots did — under `lighter` on
   * a CPU rasteriser that was 2.4× the frame time (60 trails, 3 s, 0.4/s).
   * Past a tenth of the viewport's area in ribbon (measured on the
   * previous frame) the layer falls back to the time-sample discs it always
   * drew; it returns to ribbons below 70 % of that, so a layer near the line
   * does not flicker between the two.
   */
  private ribbonAllowed(built: Built): boolean {
    let rb = this.ribbonBudget.get(built);
    if (!rb) {
      rb = { seq: this.paintSeq, area: 0, ribbon: true };
      this.ribbonBudget.set(built, rb);
    }
    if (rb.seq !== this.paintSeq) {
      const budget = 0.1 * this.w * this.h;
      if (rb.ribbon && rb.area > budget) rb.ribbon = false;
      else if (!rb.ribbon && rb.area < 0.7 * budget) rb.ribbon = true;
      rb.seq = this.paintSeq;
      rb.area = 0;
    }
    return rb.ribbon;
  }

  /** A fresh 2D canvas (DOM or Offscreen), or null where none can be made. */
  /**
   * A drawing's cache slot, keyed by what it draws (pathPaintSig), not by the
   * sprite object — glides and timelines replace that object every frame.
   * Least-recently-used slots are evicted past PATH_SLOT_MAX, and their
   * bitmaps' pixels returned to the budget.
   */
  private pathSlot(sprite: PolygonSprite) {
    const sig = pathPaintSig(sprite);
    let slot = this.pathBlits.get(sig);
    if (slot) {
      this.pathBlits.delete(sig);
      this.pathBlits.set(sig, slot);
      return slot;
    }
    if (this.pathBlits.size >= PATH_SLOT_MAX) {
      const [oldSig, old] = this.pathBlits.entries().next().value!;
      for (const ent of old.entries.values()) this.pathBlitPixels -= ent.px;
      this.pathBlits.delete(oldSig);
    }
    slot = { entries: new Map(), flushes: 0, off: false };
    this.pathBlits.set(sig, slot);
    return slot;
  }

  /**
   * Whether a layer's path drawing looks the same as last frame — the caches
   * serve only steady drawings; one that is gliding (colour, gradient, shape)
   * draws directly until it settles, instead of rasterising a bitmap a frame.
   */
  // Keyed by the layer's place in the scene, never the per-layer record: a
  // scene that animates a baked field (alpha, size) rebuilds every record
  // every frame, and a drawing beside it is still steady.
  private readonly pathSteady = new Map<number, { sig: string; seq: number; steady: boolean }>();
  private drawingSteady(built: Built, sprite: PolygonSprite): boolean {
    const sig = pathPaintSig(sprite);
    const li = this.layers.indexOf(built);
    const prev = this.pathSteady.get(li);
    if (prev && prev.seq === this.paintSeq && prev.sig === sig) return prev.steady;
    const steady = prev !== undefined && prev.sig === sig;
    this.pathSteady.set(li, { sig, seq: this.paintSeq, steady });
    return steady;
  }

  /**
   * Draw a path polygon in its own unit box: the caller has moved to the
   * entity and rotated; this scales by r. Parts paint back to front (a single
   * `path` is one part). Each fill is its gradient (drawing-box coordinates,
   * or with units 'part' the part's own box, filled under that box's
   * transform so a radial reads as the part's ellipse), the soft radial
   * falloff, or flat colour; each stroke traces the part's subpaths as drawn,
   * width in unit-box units. Outlines are Path2Ds built once per sprite.
   */
  private drawPathUnit(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, sprite: PolygonSprite, color: string, fr: PathFrameT, r: number): void {
    const slot = this.pathSlot(sprite);
    const parts = pathParts(sprite);
    if (!slot.parts2d) slot.parts2d = parts.map(() => ({}));
    // The frame: origin to the entity position, then per-axis scale (span).
    if (fr.ox || fr.oy) g.translate(-fr.ox * fr.sx, -fr.oy * fr.sy);
    g.scale(fr.sx, fr.sy);
    const a0 = g.globalAlpha;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const cache = slot.parts2d[i]!;
      const pc = part.color ?? color;
      if (part.fill && part.flat.points.length >= 3) {
        g.globalAlpha = a0 * part.opacity;
        if (part.gradient?.units === 'part') {
          // Fill in part space: the gradient's −1..1 is the part's box.
          const { cx, cy, hw, hh } = part.box;
          if (cache.fillPart === undefined) {
            cache.fillPart = typeof Path2D === 'undefined' ? null : ringPath2D([{ points: part.flat.points.map(([x, y]) => [(x - cx) / hw, (y - cy) / hh] as [number, number]), closed: true }]);
          }
          g.save();
          g.transform(hw, 0, 0, hh, cx, cy);
          g.fillStyle = pathGradientFill(g, part.gradient);
          if (cache.fillPart) g.fill(cache.fillPart, part.rule);
          else { traceLines(g, [{ points: part.flat.points.map(([x, y]) => [(x - cx) / hw, (y - cy) / hh] as [number, number]), closed: true }]); g.fill(part.rule); }
          g.restore();
        } else {
          g.fillStyle = part.gradient ? pathGradientFill(g, part.gradient) : sprite.soft && !sprite.parts ? softFill(g, pc, 1) : pc;
          if (cache.fill === undefined) cache.fill = typeof Path2D === 'undefined' ? null : ringPath2D([{ points: part.flat.points, closed: true }]);
          if (cache.fill) g.fill(cache.fill, part.rule);
          else { traceLines(g, [{ points: part.flat.points, closed: true }]); g.fill(part.rule); }
        }
      }
      const st = part.stroke;
      const lines = st ? strokeLines(part) : part.flat.lines;
      if (st && lines.length) {
        g.globalAlpha = a0 * part.opacity * (st.opacity ?? 1);
        g.strokeStyle = st.color;
        g.lineJoin = st.join ?? 'round';
        g.lineCap = st.cap ?? 'round';
        if (fr.uniform) {
          // Width is in unit-box units of the uniform scale r.
          g.lineWidth = (st.width * r) / fr.sx;
          if (lines !== part.flat.lines) { traceLines(g, lines); g.stroke(); }
          else {
            if (cache.stroke === undefined) cache.stroke = typeof Path2D === 'undefined' ? null : ringPath2D(part.flat.lines);
            if (cache.stroke) g.stroke(cache.stroke);
            else { traceLines(g, part.flat.lines); g.stroke(); }
          }
        } else {
          // A stretched drawing: stroke the stretched outline in unscaled space,
          // so the line keeps one width instead of fattening along the long axis.
          const scaled = lines.map((l) => ({ closed: l.closed, points: l.points.map(([x, y]) => [x * fr.sx, y * fr.sy] as [number, number]) }));
          g.save();
          g.scale(1 / fr.sx, 1 / fr.sy);
          g.lineWidth = st.width * r;
          traceLines(g, scaled);
          g.stroke();
          g.restore();
        }
      }
    }
    g.globalAlpha = a0;
  }

  /**
   * Draw a path polygon from its render-once bitmap. False when it cannot be
   * blitted exactly — a rotated or skewed layer transform, a bitmap past the
   * memory cap, a drawing too sparse for its area, or one that keeps
   * changing — and the caller draws it directly.
   */
  private blitPath(sprite: PolygonSprite, p: { x: number; y: number }, r: number, rot: number, color: string, fr: PathFrameT): boolean {
    const ctx = this.ctx;
    const slot = this.pathSlot(sprite);
    if (slot.off) return false;
    if (slot.sprite) return this.spriteBlit(sprite, slot, p, r, rot, color, fr);
    const m = ctx.getTransform();
    // 1:1 copies need an axis-aligned, uniform transform (dpr, layer translate/scale);
    // anything else (a rotated or skewed layer) goes straight to the sprite cache.
    if (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9 || Math.abs(m.a - m.d) > 1e-9 || !(m.a > 0)) {
      slot.sprite = true;
      return this.spriteBlit(sprite, slot, p, r, rot, color, fr);
    }
    const k = m.a;
    const dx = k * p.x + m.e;
    const dy = k * p.y + m.f;
    const ix = Math.floor(dx);
    const iy = Math.floor(dy);
    const fx = Math.round((dx - ix) * 8) / 8;
    const fy = Math.round((dy - iy) * 8) / 8;
    const key = `${color}|${(r * k).toFixed(3)}|${(fr.sx * k).toFixed(3)}|${(fr.sy * k).toFixed(3)}|${fr.ox},${fr.oy}|${rot.toFixed(5)}|${fx}|${fy}`;
    let hit = slot.entries.get(key);
    if (!hit) {
      if (slot.entries.size >= PATH_BLIT_PER_SPRITE) {
        for (const old of slot.entries.values()) this.pathBlitPixels -= old.px;
        slot.entries.clear();
        // The key keeps changing (moving, spinning, growing): exact copies cannot
        // keep up, so this drawing switches to the moving-sprite cache.
        if (++slot.flushes > 1) { slot.sprite = true; slot.flushes = 0; return this.spriteBlit(sprite, slot, p, r, rot, color, fr); }
      }
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      const s = r * k;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const grow = (u: [number, number]): void => {
        const ux = (u[0] - fr.ox) * fr.sx * k, uy = (u[1] - fr.oy) * fr.sy * k;
        const x = ux * c - uy * sn;
        const y = ux * sn + uy * c;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      };
      let sw = 0;
      for (const part of pathParts(sprite)) {
        if (part.fill) for (const u of part.flat.points) grow(u);
        if (part.stroke) { sw = Math.max(sw, part.stroke.width); for (const l of part.flat.lines) for (const u of l.points) grow(u); }
      }
      const pad = 2 + Math.ceil(sw * s);
      const bx = Math.floor(fx + x0) - pad;
      const by = Math.floor(fy + y0) - pad;
      const w = Math.ceil(fx + x1) - bx + pad;
      const h = Math.ceil(fy + y1) - by + pad;
      if (!(w > 0 && h > 0) || !Number.isFinite(w + h)) return false;
      if (pathDrawCost(sprite) / ((w * h) / 1e6) < PATH_BLIT_MIN_DENSITY) { slot.off = true; return false; }
      if (this.pathBlitPixels + w * h > PATH_BLIT_MAX_PIXELS) return false;
      const made = this.makeCanvas(1);
      if (!made) return false;
      made.canvas.width = w;
      made.canvas.height = h;
      const g = made.ctx;
      g.setTransform(k, 0, 0, k, fx - bx, fy - by);
      if (rot) g.rotate(rot);
      this.drawPathUnit(g, sprite, color, fr, r);
      hit = { canvas: made.canvas, x0: bx, y0: by, px: w * h };
      this.pathBlitPixels += hit.px;
      slot.entries.set(key, hit);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(hit.canvas, ix + hit.x0, iy + hit.y0);
    ctx.restore();
    return true;
  }

  /**
   * The moving-sprite cache: for a drawing whose exact key keeps changing. It
   * is rasterised once per colour, UNROTATED, at a device radius rounded UP to
   * the next 1/8-octave step (so it is only ever shrunk, never enlarged), then
   * drawn every frame at its true sub-pixel position, rotation and size under
   * the context's own transform, with smoothing. Not pixel-exact like the
   * still cache (edges resample by well under a pixel), but a 7-part drifting
   * balloon costs one image draw instead of seven fills and strokes.
   */
  private spriteBlit(sprite: PolygonSprite, slot: NonNullable<ReturnType<typeof this.pathBlits.get>>, p: { x: number; y: number }, r: number, rot: number, color: string, fr: PathFrameT): boolean {
    const ctx = this.ctx;
    // Sprites are for uniform, box-sized drawings (particles); a stretched one draws directly.
    if (!fr.uniform || fr.sx !== r) return false;
    const m = ctx.getTransform();
    const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    const s = r * k;
    if (!(s >= 1)) return false;
    const bucket = 2 ** (Math.ceil(Math.log2(s) * 8) / 8);
    const key = `S|${color}|${bucket.toFixed(3)}`;
    let hit = slot.entries.get(key);
    if (!hit) {
      if (slot.entries.size >= PATH_SPRITE_PER_SPRITE) {
        for (const old of slot.entries.values()) this.pathBlitPixels -= old.px;
        slot.entries.clear();
        if (++slot.flushes > 2) { slot.off = true; return false; }
      }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, sw = 0;
      const grow = (u: [number, number]): void => { if (u[0] < x0) x0 = u[0]; if (u[0] > x1) x1 = u[0]; if (u[1] < y0) y0 = u[1]; if (u[1] > y1) y1 = u[1]; };
      for (const part of pathParts(sprite)) {
        if (part.fill) for (const u of part.flat.points) grow([u[0] - fr.ox, u[1] - fr.oy]);
        if (part.stroke) { sw = Math.max(sw, part.stroke.width); for (const l of part.flat.lines) for (const u of l.points) grow([u[0] - fr.ox, u[1] - fr.oy]); }
      }
      const pad = 2 + Math.ceil(sw * bucket);
      const ox = Math.ceil(-x0 * bucket) + pad;
      const oy = Math.ceil(-y0 * bucket) + pad;
      const w = ox + Math.ceil(x1 * bucket) + pad;
      const h = oy + Math.ceil(y1 * bucket) + pad;
      if (!(w > 0 && h > 0) || !Number.isFinite(w + h)) return false;
      if (w * h > PATH_SPRITE_MAX_PIXELS) { slot.off = true; return false; }
      if (this.pathBlitPixels + w * h > PATH_BLIT_MAX_PIXELS) return false;
      const made = this.makeCanvas(1);
      if (!made) return false;
      made.canvas.width = w;
      made.canvas.height = h;
      made.ctx.setTransform(1, 0, 0, 1, ox, oy);
      this.drawPathUnit(made.ctx, sprite, color, { sx: bucket, sy: bucket, ox: fr.ox, oy: fr.oy, uniform: true }, bucket);
      // x0/y0 hold the bitmap's origin offset (px from the drawing's centre) at `bucket` scale.
      hit = { canvas: made.canvas, x0: ox, y0: oy, px: w * h };
      this.pathBlitPixels += hit.px;
      slot.entries.set(key, hit);
    }
    const u = r / bucket; // user units per bitmap pixel
    ctx.save();
    ctx.translate(p.x, p.y);
    if (rot) ctx.rotate(rot);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(hit.canvas, -hit.x0 * u, -hit.y0 * u, hit.canvas.width * u, hit.canvas.height * u);
    ctx.restore();
    return true;
  }

  private makeCanvas(n: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null {
    try {
      const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(n, n);
      canvas.width = n;
      canvas.height = n;
      const c = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      return c ? { canvas, ctx: c } : null;
    } catch {
      return null;
    }
  }

  /**
   * A feathered rect from a per-entity bitmap of it, pre-rendered at device
   * resolution with its rotation baked in, copied 1:1 at a whole-pixel
   * offset. A smooth falloff is a sampled image draw — on a CPU rasteriser
   * (a Raspberry Pi wall) ~3× the six flat fills it replaced, ~10× when
   * rotated and stretched — while a 1:1 integer copy costs about one flat
   * fill. The bitmap is rebuilt only when the rect's size, rotation or
   * feather changes (in device pixels, to a quarter pixel / 0.06°), and
   * re-tinted (one copy + one flat fill) only when its colour changes, so a
   * drifting block or a colour glide stays cheap. A rect whose shape
   * changes every frame (`grow`, `spin`), a canvas under a rotating or
   * mirroring transform, or a scene past the 8 Mpx cache budget draws the
   * stretched mask directly instead. Returns false when it did not draw.
   */
  private blitFeather(e: Entity, p: { x: number; y: number }, sz: number, rh: number, rot: number, color: string, feather: number): boolean {
    const ctx = this.ctx;
    const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    if (!m || m.b !== 0 || m.c !== 0 || m.a <= 0 || m.d <= 0) return false;
    const cos = Math.abs(Math.cos(rot));
    const sin = Math.abs(Math.sin(rot));
    const bw = Math.ceil((cos * sz + sin * rh) * m.a) + 2;
    const bh = Math.ceil((sin * sz + cos * rh) * m.d) + 2;
    const shapeKey = `${feather}|${Math.round(sz * m.a * 4)}|${Math.round(rh * m.d * 4)}|${Math.round(rot * 1000)}|${bw}x${bh}`;
    let b = this.featherBlits.get(e);
    if (!b || b.shapeKey !== shapeKey) {
      // A shape that changed since the previous frame is animating: draw it
      // directly rather than rebuild a bitmap every frame. Rebuild once it
      // has held still for a frame (or on first sight, so a static rect is
      // cached from its first paint).
      if (b) {
        if (b.seenKey !== shapeKey) { b.seenKey = shapeKey; b.seenAt = this.paintSeq; }
        if (b.seenAt === this.paintSeq) return false;
      }
      const px = bw * bh;
      const reuse = b && b.w === bw && b.h === bh;
      if (!reuse && this.featherBlitPx + px - (b ? b.w * b.h : 0) > 8_000_000) return false;
      const white = this.featherWhite.get(feather);
      if (!white) return false; // featherMask builds it; it ran just before this
      const wc = reuse ? b!.white : this.makeCanvas(1);
      const tc = reuse ? b!.tint : this.makeCanvas(1);
      if (!wc || !tc) return false;
      if (!reuse) {
        wc.canvas.width = bw; wc.canvas.height = bh;
        tc.canvas.width = bw; tc.canvas.height = bh;
        this.featherBlitPx += px - (b ? b.w * b.h : 0);
      }
      const w2 = wc.ctx;
      w2.setTransform(1, 0, 0, 1, 0, 0);
      w2.clearRect(0, 0, bw, bh);
      w2.translate(bw / 2, bh / 2);
      w2.scale(m.a, m.d);
      if (rot) w2.rotate(rot);
      w2.imageSmoothingEnabled = true;
      w2.drawImage(white, -sz / 2, -rh / 2, sz, rh);
      w2.setTransform(1, 0, 0, 1, 0, 0);
      b = { shapeKey, w: bw, h: bh, white: wc, tint: tc, tintKey: '', tintAt: 0, stagger: this.featherBlitN++ % 8, seenKey: shapeKey, seenAt: this.paintSeq };
      this.featherBlits.set(e, b);
    }
    // Re-tint on a colour change — at most every 8th frame mid-glide (a
    // ≤ 133 ms colour lag on a glide that takes seconds), immediately for a
    // new bitmap; entities are staggered across those 8 frames so a layer's
    // re-tints never land on one frame together.
    if (b.tintKey !== color && (b.tintKey === '' || this.paintSeq - b.tintAt >= 8)) {
      const t2 = b.tint.ctx;
      t2.setTransform(1, 0, 0, 1, 0, 0);
      t2.globalCompositeOperation = 'copy';
      t2.drawImage(b.white.canvas, 0, 0);
      t2.globalCompositeOperation = 'source-in';
      t2.fillStyle = color;
      t2.fillRect(0, 0, b.w, b.h);
      t2.globalCompositeOperation = 'source-over';
      b.tintKey = color;
      b.tintAt = this.paintSeq - (b.stagger ?? 0);
      b.stagger = 0;
    }
    const cx = m.a * p.x + m.e;
    const cy = m.d * p.y + m.f;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(b.tint.canvas, Math.round(cx - b.w / 2), Math.round(cy - b.h / 2));
    ctx.restore();
    return true;
  }

  /**
   * A feathered rect's mask in `color`: FEATHER_MASK_SIZE² texels of
   * `featherRamp(u) × featherRamp(v)`, drawn stretched to the rect with
   * smoothing on, so the falloff is continuous at any size (X383).
   *
   * The ramp itself is built ONCE per feather (a white alpha mask, the only
   * per-pixel work). A colour is a cheap tint of it — clear, draw the mask,
   * `source-in` fill — into a pooled canvas, cached per colour × feather.
   * A colour glide or a palette larger than the pool re-tints a pooled
   * canvas (three GPU draws) rather than rebuilding pixels in JS.
   */
  private featherMask(color: string, feather: number): HTMLCanvasElement | OffscreenCanvas | null {
    const key = `${color}|${feather}`;
    const hit = this.featherTints.get(key);
    if (hit) {
      // Most recently used last, so eviction takes the stalest tint.
      this.featherTints.delete(key);
      this.featherTints.set(key, hit);
      return hit.canvas;
    }
    const N = FEATHER_MASK_SIZE;
    let white = this.featherWhite.get(feather);
    if (!white) {
      const made = this.makeCanvas(N);
      if (!made) return null;
      const img = made.ctx.createImageData(N, N);
      const data = img.data;
      const ramp: number[] = [];
      for (let i = 0; i < N; i++) ramp.push(featherRamp((i + 0.5) / N, feather));
      let o = 0;
      for (let y = 0; y < N; y++) {
        const ry = ramp[y]!;
        for (let x = 0; x < N; x++) {
          data[o++] = 255;
          data[o++] = 255;
          data[o++] = 255;
          data[o++] = Math.round(255 * ry * ramp[x]!);
        }
      }
      made.ctx.putImageData(img, 0, 0);
      if (this.featherWhite.size >= 8) this.featherWhite.delete(this.featherWhite.keys().next().value!);
      white = made.canvas;
      this.featherWhite.set(feather, white);
    }
    let slot: { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null = null;
    if (this.featherTints.size >= 48) {
      const oldest = this.featherTints.keys().next().value!;
      slot = this.featherTints.get(oldest)!;
      this.featherTints.delete(oldest);
    } else {
      slot = this.makeCanvas(N);
      if (!slot) return null;
    }
    const tctx = slot.ctx;
    tctx.globalCompositeOperation = 'copy';
    tctx.drawImage(white, 0, 0);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, N, N);
    tctx.globalCompositeOperation = 'source-over';
    this.featherTints.set(key, slot);
    return slot.canvas;
  }

  /**
   * Paint one entity at time `t`. `echo` paints a trail echo instead: the
   * entity as it was at `t` (rotation, heading, values), but at the echo's
   * position, size and alpha.
   */
  private drawEntity(built: Built, e: Entity, t: number, lifeA: number, parentE: Entity | null, paint?: PaintPass, echo?: { x: number; y: number; size: number; alpha: number }): void {
    const { ctx } = this;
    const p = echo ? { x: echo.x, y: echo.y, flip: false } : this.entityPos(e, t, parentE);
    const sprite = paint?.sprite ?? built.layer.sprite;
    const sz = echo ? echo.size : sizeAt(e, t);
    const rot = rotationAt(e, t);
    const unitScale = this.effSpec.units === 'px' ? 1 : Math.min(this.w, this.h);
    ctx.globalAlpha = echo ? echo.alpha : alphaAt(e, t) * lifeA * (paint?.alpha ?? 1);
    if (sprite.kind === 'ring') {
      const r = sz / 2;
      const resolvedColor = sprite.colors?.[e.colorIndex] ?? sprite.color;
      ctx.strokeStyle = resolvedColor;
      ctx.lineWidth = Math.max(0.5, (sprite.width ?? (unitScale === 1 ? 2 : 0.002)) * unitScale);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    if (sprite.kind === 'streak') {
      const resolvedColor = sprite.colors?.[e.colorIndex] ?? sprite.color;
      const heading = (headingAt(e, t, this.w, this.h) ?? 0) + rot;
      const tailX = p.x - Math.cos(heading) * sz;
      const tailY = p.y - Math.sin(heading) * sz;
      const g = ctx.createLinearGradient(tailX, tailY, p.x, p.y);
      g.addColorStop(0, hexToRgba(resolvedColor, 0));
      g.addColorStop(1, resolvedColor);
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(0.5, (sprite.width ?? (unitScale === 1 ? 2 : 0.002)) * unitScale);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      return;
    }
    if (sprite.kind === 'rect') {
      const resolvedColor = sprite.colors?.[e.colorIndex] ?? sprite.color;
      const rh = e.size2 !== undefined
        ? e.size2 * (e.size > 0 ? sz / e.size : 1) // grow/warp scale height with width
        : sz;
      const feather = sprite.feather ?? 0;
      const mask = feather > 0 ? this.featherMask(resolvedColor, feather) : null;
      // Drawn from its cached, pre-rotated bitmap when it can be (see blitFeather).
      if (mask && this.blitFeather(e, p, sz, rh, rot, resolvedColor, feather)) return;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (rot) ctx.rotate(rot);
      ctx.fillStyle = resolvedColor;
      if (mask) {
        // Soft edge (X383): one draw of a smooth alpha mask stretched to the
        // rect — the falloff is continuous, and a single draw composites
        // under every blend the way a hard rect does.
        const prevSmooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(mask, -sz / 2, -rh / 2, sz, rh);
        ctx.imageSmoothingEnabled = prevSmooth;
      } else {
        ctx.fillRect(-sz / 2, -rh / 2, sz, rh);
      }
      ctx.restore();
      return;
    }
    if (sprite.kind === 'bar') {
      const len = sz * barFraction(sprite, e.barIndex ?? 0);
      if (len <= 0) return;
      const resolvedColor = sprite.colors?.[e.colorIndex] ?? sprite.color;
      const th = e.size2 !== undefined ? e.size2 * (e.size > 0 ? sz / e.size : 1) : sz * 0.2;
      const box = barBox(sprite.direction ?? 'right', len, th);
      ctx.save();
      ctx.translate(p.x, p.y);
      if (rot) ctx.rotate(rot);
      ctx.fillStyle = resolvedColor;
      ctx.fillRect(box.cx - box.halfX, box.cy - box.halfY, box.halfX * 2, box.halfY * 2);
      ctx.restore();
      return;
    }
    if (sprite.kind === 'polygon') {
      const r = sz / 2;
      const resolvedColor = sprite.colors?.[e.colorIndex] ?? sprite.color;
      if (isPathPolygon(sprite)) {
        const fr = pathFrame(sprite, r, this.w, this.h);
        if (pathDrawCost(sprite) >= PATH_BLIT_MIN_POINTS && !this.noPathCache && this.drawingSteady(built, sprite) && this.blitPath(sprite, p, r, rot, resolvedColor, fr)) return;
        ctx.save();
        ctx.translate(p.x, p.y);
        if (rot) ctx.rotate(rot);
        if (r > 0 && fr.sx > 0 && fr.sy > 0) this.drawPathUnit(ctx, sprite, resolvedColor, fr, r);
        ctx.restore();
        return;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      if (rot) ctx.rotate(rot);
      ctx.fillStyle = sprite.soft ? softFill(ctx, resolvedColor, r) : resolvedColor;
      const pts = polygonPoints(sprite, r);
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
      ctx.closePath();
      ctx.fill(polygonFillRule(sprite));
      ctx.restore();
      return;
    }
    if (sprite.kind === 'stroke') {
      const resolvedColor = sprite.colors?.[e.colorIndex] ?? sprite.color;
      const pts = strokeDrawnSamples(sprite, sz / 2);
      if (pts.length < 2) return;
      const lw = strokeWidthPx(sprite, unitScale);
      ctx.save();
      ctx.translate(p.x, p.y);
      let angle = rot;
      if (sprite.orient) angle += headingAt(e, t, this.w, this.h) ?? 0;
      if (angle) ctx.rotate(angle);
      ctx.strokeStyle = resolvedColor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (sprite.taper) {
        // A brush mark (X386): its tapered outline, filled once — so a
        // translucent stroke composites as one mark instead of beading at
        // every overlapping segment joint.
        const outline = strokeOutline(pts, lw);
        ctx.fillStyle = resolvedColor;
        ctx.beginPath();
        ctx.moveTo(outline[0]!.x, outline[0]!.y);
        for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i]!.x, outline[i]!.y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (sprite.kind === 'circle') {
      const r = sz / 2;
      const resolvedColor = sprite.colors?.[e.colorIndex] ?? sprite.color;
      ctx.save();
      if (rot) {
        ctx.translate(p.x, p.y);
        ctx.rotate(rot);
        ctx.translate(-p.x, -p.y);
      }
      if (sprite.soft) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, resolvedColor);
        g.addColorStop(0.35, hexToRgba(resolvedColor, 0.75));
        g.addColorStop(1, hexToRgba(resolvedColor, 0));
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = resolvedColor;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    if (sprite.kind === 'textBlock') {
      const unitScale = Math.min(this.w, this.h);
      const fsPx = sprite.fontSize * unitScale;
      const lh = (sprite.lineHeight ?? 1.4) * fsPx;
      const maxWPx = sprite.maxWidth * unitScale;
      const maxWEm = maxWPx / fsPx;
      const lines = breakTextBlock(textBlockText(sprite), maxWEm, textMetricsClassFor(sprite.font));
      const align = sprite.align ?? 'left';
      // Reveal masks glyphs; layout above always ran on the full text, so
      // lines never reflow while typing.
      const reveal = sprite.reveal;
      const rs = reveal ? revealState(lines, reveal, t) : null;
      const fullLines = rs ? rs.fullLines : lines.length;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (rot) ctx.rotate(rot);
      if (sprite.anchor) {
        // `position` names a point of the rendered text, not the layout box's
        // top-left. Offset after line-breaking so the block's real extent
        // (widest line × lines) is what gets anchored; rotation stays about
        // the anchor point. Same arithmetic as perceive/advise (simulate.ts).
        const maxLineW = lines.reduce((m, l) => Math.max(m, l.widthEm), 0) * fsPx;
        const { dx, dy } = textBlockAnchorOffset(sprite, maxWPx, maxLineW, lines.length * lh);
        if (dx !== 0 || dy !== 0) ctx.translate(dx, dy);
      }
      // Paint-level alpha for the block only (layer `alpha` is baked per entity).
      if (sprite.opacity !== undefined) ctx.globalAlpha *= sprite.opacity;
      ctx.font = sprite.font ? composeFontShorthand(fsPx, sprite.font) : `${fsPx}px system-ui, sans-serif`;
      ctx.fillStyle = sprite.color ?? '#e6e8ef';
      ctx.textBaseline = 'top';
      ctx.textAlign = align;
      const xOff = align === 'center' ? maxWPx / 2 : align === 'right' ? maxWPx : 0;
      if (rs?.glyphAlphas) {
        // glyphFade: the contiguous fully-opaque leading run draws as ONE
        // fillText — a single draw forms ligatures and pair kerning exactly
        // like the un-revealed path (pixel parity once fully revealed), and it
        // drops the O(n²) per-frame prefix re-measure for glyphs that have
        // finished fading. Only the fading tail draws glyph-by-glyph, each at
        // its full-line prefix advance. measureText is paint-only (the caret's
        // trick) — positions come from the platform's real glyph widths, never
        // the em table, and depend only on the fixed prefix, so glyphs never
        // shift as they fade.
        ctx.textAlign = 'left';
        const baseAlpha = ctx.globalAlpha;
        const riseEm = Math.max(0, Math.min(LIMITS.maxRevealRise, reveal!.rise ?? 0));
        for (let li = 0; li < lines.length; li++) {
          const alphas = rs.glyphAlphas[li] ?? [];
          if (alphas.length > 0 && alphas[0]! <= 0) break;
          const clusters = graphemeClusters(lines[li]!.text);
          const lw = ctx.measureText(lines[li]!.text).width;
          const x0 = align === 'center' ? (maxWPx - lw) / 2 : align === 'right' ? maxWPx - lw : 0;
          let opaque = 0;
          while (opaque < clusters.length && (alphas[opaque] ?? 0) >= 1) opaque++;
          let prefix = '';
          if (opaque > 0) {
            prefix = clusters.slice(0, opaque).join('');
            ctx.globalAlpha = baseAlpha;
            ctx.fillText(prefix, x0, li * lh);
          }
          for (let gi = opaque; gi < clusters.length; gi++) {
            const a = alphas[gi] ?? 0;
            if (a <= 0) break; // alphas only fall in reading order
            ctx.globalAlpha = baseAlpha * a;
            // `reveal.rise`: a fading glyph lifts into its line as it appears.
            ctx.fillText(clusters[gi]!, x0 + ctx.measureText(prefix).width, li * lh + riseEm * fsPx * (1 - a));
            prefix += clusters[gi]!;
          }
        }
        ctx.globalAlpha = baseAlpha;
      } else {
        for (let li = 0; li < fullLines; li++) {
          ctx.fillText(lines[li]!.text, xOff, li * lh);
        }
        if (rs && rs.partialText.length > 0) {
          ctx.fillText(rs.partialText, xOff, fullLines * lh);
        }
      }
      if (rs && reveal!.caret) {
        const cfg = reveal!.caret === true ? {} : reveal!.caret;
        const hz = Math.min(3, cfg.blink ?? 1.2);
        const on = hz <= 0 || Math.floor((t / 1000) * hz * 2) % 2 === 0;
        if (on) {
          // measureText is paint-only here: it positions the caret against the
          // platform's real glyph widths but never influences layout, which
          // stays on the fixed metrics table.
          const pw = ctx.measureText(rs.caretPrefix).width;
          const cx = align === 'center' ? xOff + pw / 2 : align === 'right' ? xOff : pw;
          ctx.fillStyle = cfg.color ?? sprite.color ?? '#e6e8ef';
          ctx.fillRect(cx + fsPx * 0.06, rs.caretLine * lh, Math.max(1, fsPx * 0.08), fsPx);
        }
      }
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    if (rot) ctx.rotate(rot);
    if (p.flip && built.layer.flip) ctx.scale(-1, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (sprite.kind === 'emoji') {
      const idx = spriteIndexAt(e, t, sprite.glyphs.length);
      ctx.font = `${sz}px serif`;
      ctx.fillText(sprite.glyphs[idx] ?? sprite.glyphs[0]!, 0, 0);
    } else {
      ctx.textAlign = sprite.align ?? 'center';
      ctx.textBaseline = sprite.baseline ?? 'middle';
      // A full CSS shorthand (contains a px size) is used verbatim; a family/weight
      // only ('bold monospace') composes with the seeded per-entity size.
      ctx.font = sprite.font
        ? (FONT_PX_RE.test(sprite.font)
          ? scaleFontPx(sprite.font, this.fontScale())
          : composeFontShorthand(sz, sprite.font))
        : `${sz}px system-ui, sans-serif`;
      ctx.fillStyle = sprite.color ?? '#e6e8ef';
      const idx = spriteIndexAt(e, t, sprite.strings.length);
      const text = sprite.strings[idx] ?? sprite.strings[0]!;
      const mw = sprite.maxWidth ? sprite.maxWidth * (this.effSpec.units === 'px' ? 1 : Math.min(this.w, this.h)) : undefined;
      if (mw) ctx.fillText(text, 0, 0, mw);
      else ctx.fillText(text, 0, 0);
    }
    ctx.restore();
  }

  /** Advance any live steering glide; rebuild entities on structural change. */
  private stepTransition(t: number): void {
    const tr = this.transition;
    if (!tr) return;
    const k = tr.dur <= 0 ? 1 : (t - tr.startT) / tr.dur;
    this.effSpec = k >= 1 ? tr.to : lerpSpec(tr.from, tr.to, easeGlide(tr.ease, k));
    if (k >= 1) this.transition = null;
    // Placement/motion fields are baked into entities at build time; rebuild
    // (deterministic — same seed → same stream) only when those change.
    const sig = structuralSignature(this.effSpec);
    if (sig !== this.lastStructural) this.rebuild();
    else this.layers.forEach((b, i) => { b.layer = this.effSpec.layers[i] ?? b.layer; });
  }

  /**
   * Live steering: glide from what's currently rendered to the track's target
   * state (deltas applied last-wins). Duration = the longest delta `dur`.
   */
  applyTrack(track: ControlTrack): void {
    const deltas = (track?.deltas ?? []) as unknown as SteerDelta[];
    if (this.authored) {
      const glide = deltas.length ? deltas.reduce((m, d) => Math.max(m, d.dur ?? DEFAULT_STEER_DUR), 0) : DEFAULT_STEER_DUR;
      if (!this.overrideAuthored(deltas, this.paused ? 0 : glide)) return;
      if (this.paused) this.renderFrame(this.sceneNow(), this.seed);
      return;
    }
    const target = applyDeltasToSpec(this.effSpec, deltas);
    if (!validateSpec(target).valid) return;
    const dur = deltas.length
      ? deltas.reduce((m, d) => Math.max(m, d.dur ?? DEFAULT_STEER_DUR), 0)
      : DEFAULT_STEER_DUR;
    this.transition = {
      from: JSON.parse(JSON.stringify(this.effSpec)) as SaverSpec,
      to: target,
      startT: this.lastT,
      dur,
    };
    const ease = steerEase(deltas);
    if (ease) this.transition.ease = ease;
    if (this.paused) {
      // No frames will run the glide — jump straight to the target.
      this.transition = null;
      this.effSpec = target;
      if (structuralSignature(this.effSpec) !== this.lastStructural) this.rebuild();
      else this.layers.forEach((b, i) => { b.layer = this.effSpec.layers[i] ?? b.layer; });
      this.renderFrame(this.lastT, this.seed);
    }
  }

  /**
   * Apply steering deltas immediately: no glide, no frame painted. Each delta
   * is routed by `applyRetainedDeltas` (unresolvable or invalid ones are
   * skipped on this spec alone). `SequenceInstance` uses this to hand a
   * freshly created child the track the sequence has retained, so a steer
   * made while another segment was active lands on the segment that owns the
   * path. Not painting matters: a child is created inside the parent's
   * renderFrame, and a stray t=0 paint here would make the real frame that
   * follows look "contiguous" to the ghosting warm-up — but the constructor
   * already painted ONE stray t=0 frame of the pre-steer spec (SpecInstance's
   * own mount does an immediate render when paused, which every sequence
   * child is), so `lastRenderT` must be reset too: otherwise, with `ghosting`
   * on, the real frame that follows still finds itself "contiguous" with
   * that stray paint and composites over it at partial alpha, briefly
   * showing a ghost of the un-steered scene.
   */
  applyDeltasNow(deltas: Iterable<SteerDelta>): void {
    if (this.authored) {
      // Retained steers land under the timeline's steering rule — as one
      // batch when they validate together (one composed check), else per
      // delta, skipping any that don't (as `applyRetainedDeltas` does).
      const all = [...deltas];
      if (!this.overrideAuthored(all, 0)) for (const d of all) this.overrideAuthored([d], 0);
      this.transition = null;
      this.lastRenderT = Number.NEGATIVE_INFINITY;
      return;
    }
    const next = applyRetainedDeltas(this.effSpec, deltas);
    if (next === this.effSpec) return;
    this.transition = null;
    this.lastRenderT = Number.NEGATIVE_INFINITY;
    this.effSpec = next;
    if (structuralSignature(this.effSpec) !== this.lastStructural) this.rebuild();
    else this.layers.forEach((b, i) => { b.layer = this.effSpec.layers[i] ?? b.layer; });
  }

  private drawLinks(built: Built, t: number, lifeA: number, parentE: Entity | null): void {
    const { links } = built.layer;
    if (!links) return;
    const { ctx } = this;
    // Toroidal link drawing only makes sense for motions that actually wrap —
    // bounce/orbit/path entities never cross an edge, so a "nearest image" line
    // would cut across the screen.
    const motionWraps = ['drift', 'rise', 'wander'].includes(built.layer.motion.type);
    const wrap = built.layer.wrap !== false && motionWraps;
    const positions = built.entities.map((e) => this.entityPos(e, t, parentE));
    const unitScale = this.effSpec.units === 'px' ? 1 : Math.min(this.w, this.h);
    const maxDistPx = linkMaxDistPx(links, unitScale);
    const edges = linkEdges(links, positions, maxDistPx, wrap, this.w, this.h);
    const defaultWidth = unitScale === 1 ? 1 : 1 / LIMITS.referenceViewport;
    const lw = (links.width ?? defaultWidth) * unitScale;
    ctx.lineWidth = lw;
    ctx.lineCap = 'butt'; // streak sprites set 'round'; reset so link ends stay crisp

    for (const { i, j, dist } of edges) {
      const pi = positions[i]!;
      const pj = positions[j]!;
      const ei = built.entities[i]!;
      let resolvedColor = links.color;
      if (!resolvedColor) {
        const sprite = built.layer.sprite;
        if (isShapedSprite(sprite)) {
          resolvedColor = sprite.colors?.[ei.colorIndex] ?? sprite.color;
        } else resolvedColor = '#e6e8ef';
      }
      let a = links.alpha ?? alphaAt(ei, t);
      if (links.falloff && Number.isFinite(maxDistPx)) a *= Math.max(0, 1 - dist / maxDistPx);
      ctx.globalAlpha = a * lifeA;
      ctx.strokeStyle = resolvedColor;
      // Draw toward nearest image of pj (avoids full-canvas streaks at wrap seams)
      let dx = pj.x - pi.x;
      let dy = pj.y - pi.y;
      if (wrap) {
        if (Math.abs(dx) > this.w / 2) dx = dx > 0 ? dx - this.w : dx + this.w;
        if (Math.abs(dy) > this.h / 2) dy = dy > 0 ? dy - this.h : dy + this.h;
      }
      ctx.beginPath();
      ctx.moveTo(pi.x, pi.y);
      ctx.lineTo(pi.x + dx, pi.y + dy);
      ctx.stroke();
    }
  }

  /** Paint one composite pass at time t. `bgAlpha` < 1 leaves the previous frame
   *  showing through — the ghosting smear. */
  private paintFrame(t: number, bgAlpha: number): void {
    const { ctx } = this;
    this.paintSeq++;
    if (this.authored) this.resolveAuthored(t);
    if (!this.transparent) {
      ctx.globalAlpha = bgAlpha;
      ctx.globalCompositeOperation = 'source-over';
      this.drawBackground(t);
    }
    ctx.globalAlpha = 1;
    const n = this.layers.length;
    for (let li = 0; li < n; li++) {
      // A run of unchanging drawing layers paints from one composited plate.
      if (!this.noPathCache && this.plateable(li, t)) {
        let j = li;
        while (j + 1 < n && this.plateable(j + 1, t)) j++;
        if (j > li && this.runPoints(li, j) >= PLATE_MIN_POINTS && this.paintPlate(li, j, t)) { li = j; continue; }
      }
      this.paintLayer(li, t);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Paint layer `li` at time t onto this.ctx (the scene canvas, or a plate being rebuilt). */
  private paintLayer(li: number, t: number): void {
    const { ctx } = this;
    const built = this.layers[li]!;
    const opacity = built.layer.opacity;
    // A grouped layer paints through its group too (`groups`): opacity
    // multiplies, the group's transform wraps the layer's own. Ungrouped
    // layers take exactly the path they always have.
    const group = built.layer.group === undefined ? undefined : this.effSpec.groups?.[built.layer.group];
    let lifeA = opacity === undefined ? lifeAlphaAt(built.layer.life, t) : lifeAlphaAt(built.layer.life, t) * clamp01(opacity);
    if (group?.opacity !== undefined) lifeA *= clamp01(group.opacity);
    if (lifeA <= 0) return;
    const parentE = this.parentEntityFor(built);
    const tf = built.layer.transform;
    const gtf = group?.transform;
    if (tf || gtf) {
      ctx.save();
      if (gtf) this.applyLayerTransform(gtf, null);
      if (tf) this.applyLayerTransform(tf, built.layer);
    }
    ctx.globalCompositeOperation = built.layer.blend ?? 'source-over';
    this.drawLinks(built, t, lifeA, parentE);
    const override = this.paintOverrides?.get(li) ?? null;
    const life = built.layer.life;
    for (let ei = 0; ei < built.entities.length; ei++) {
      const e = built.entities[ei]!;
      // `life.stagger`: each entity's own shifted envelope (1 without one).
      const entA = life?.stagger ? lifeA * lifeStaggerAt(life, t, ei) : lifeA;
      if (entA <= 0) continue;
      this.drawTrail(built, e, t, entA, parentE);
      if (override === null) {
        this.drawEntity(built, e, t, entA, parentE);
        continue;
      }
      // A text cross-fade: the previous words fading out under the new
      // ones fading in. Either pass at alpha 0 is skipped, so k = 0 and
      // k = 1 each cost exactly one draw, like a plain frame.
      const [aOut, aIn] = override.mode === 'dip'
        ? [Math.max(0, 1 - 2 * override.k), Math.max(0, 2 * override.k - 1)]
        : [1 - override.k, override.k];
      if (aOut > 0) this.drawEntity(built, e, t, entA, parentE, { sprite: override.outgoing, alpha: aOut });
      if (aIn > 0) this.drawEntity(built, e, t, entA, parentE, { alpha: aIn });
    }
    if (tf || gtf) ctx.restore();
  }

  /**
   * Static plates. Consecutive path-polygon layers painted source-over, with
   * no trails, links or text overrides, are composited into ONE full-frame
   * bitmap and copied once per frame while nothing they draw has changed —
   * the change test is the drawn values themselves (each entity's position,
   * size, rotation, alpha and colour, the layer's life alpha and transforms),
   * so anything animated simply repaints its plate that frame. Source-over is
   * associative, so the plate over the frame equals the layers over it.
   */
  private readonly plates = new Map<number, { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D; end: number; sig: string; box: { x: number; y: number; w: number; h: number }; frameW: number; frameH: number }>();

  /** Outline points a run of path layers fills per frame (points × entities). */
  private runPoints(a: number, b: number): number {
    let n = 0;
    for (let li = a; li <= b; li++) {
      const built = this.layers[li]!;
      const sp = built.layer.sprite;
      if (sp.kind === 'polygon' && isPathPolygon(sp)) n += pathDrawCost(sp) * built.entities.length;
    }
    return n;
  }

  /** Last drawn-value signature per layer, for plate stability. */
  private readonly layerSigs = new Map<number, string>();

  /**
   * A layer joins a plate only if it can (path polygon, source-over, no
   * trails/links/text override) AND nothing it draws changed since the last
   * frame — so a pulsing or moving layer splits the run and paints live, while
   * the static layers around it keep their plates.
   */
  private plateable(li: number, t: number): boolean {
    const built = this.layers[li]!;
    const l = built.layer;
    const sp = l.sprite;
    if (!isPathPolygon(sp)) return false;
    if ((l.blend ?? 'source-over') !== 'source-over') return false;
    if (l.trail || l.links || this.paintOverrides?.has(li)) return false;
    if (built.entities.length > 64) return false;
    const sig = this.layerSig(li, t);
    const prev = this.layerSigs.get(li);
    this.layerSigs.set(li, sig);
    return prev === sig;
  }

  private layerSig(li: number, t: number): string {
    const built = this.layers[li]!;
    const group = built.layer.group === undefined ? undefined : this.effSpec.groups?.[built.layer.group];
    const opacity = built.layer.opacity;
    let lifeA = opacity === undefined ? lifeAlphaAt(built.layer.life, t) : lifeAlphaAt(built.layer.life, t) * clamp01(opacity);
    if (group?.opacity !== undefined) lifeA *= clamp01(group.opacity);
    let sig = `${pathPaintSig(built.layer.sprite as PolygonSprite)}:${lifeA.toFixed(4)}:${JSON.stringify(built.layer.transform ?? null)}:${JSON.stringify(group?.transform ?? null)}`;
    const parentE = this.parentEntityFor(built);
    const life = built.layer.life;
    built.entities.forEach((e, ei) => {
      const p = this.entityPos(e, t, parentE);
      const a = life?.stagger ? alphaAt(e, t) * lifeStaggerAt(life, t, ei) : alphaAt(e, t);
      sig += `|${p.x.toFixed(2)},${p.y.toFixed(2)},${sizeAt(e, t).toFixed(3)},${rotationAt(e, t).toFixed(5)},${a.toFixed(4)},${e.colorIndex}`;
    });
    return sig;
  }

  private plateSig(a: number, b: number): string {
    let sig = `${a}-${b}`;
    for (let li = a; li <= b; li++) sig += `#${this.layerSigs.get(li)}`;
    return sig;
  }

  /** Max |point| of a path polygon's unit outline (its reach as a fraction of the entity radius). */
  private readonly pathReach = new WeakMap<object, number>();
  private reachOf(sp: PolygonSprite): number {
    let r = this.pathReach.get(sp);
    if (r === undefined) {
      r = 0;
      let sw = 0;
      for (const part of pathParts(sp)) {
        for (const [x, y] of part.flat.points) r = Math.max(r, Math.hypot(x, y));
        for (const l of part.flat.lines) for (const [x, y] of l.points) r = Math.max(r, Math.hypot(x, y));
        if (part.stroke) sw = Math.max(sw, part.stroke.width);
      }
      r += sw;
      this.pathReach.set(sp, r || 1);
    }
    return r || 1;
  }

  /**
   * Device-pixel box a run of layers can paint into, or null for "the whole
   * frame" (a layer/group transform moves things in ways this does not model).
   */
  private runBox(a: number, b: number, t: number): { x: number; y: number; w: number; h: number } | null {
    const m = this.ctx.getTransform();
    if (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let li = a; li <= b; li++) {
      const built = this.layers[li]!;
      const group = built.layer.group === undefined ? undefined : this.effSpec.groups?.[built.layer.group];
      if (built.layer.transform || group?.transform) return null;
      const reach = this.reachOf(built.layer.sprite as PolygonSprite);
      const parentE = this.parentEntityFor(built);
      for (const e of built.entities) {
        const p = this.entityPos(e, t, parentE);
        const sp = built.layer.sprite as PolygonSprite;
        const fr = pathFrame(sp, sizeAt(e, t) / 2, this.w, this.h);
        const ext = Math.max(fr.sx, fr.sy) * (reach + Math.hypot(fr.ox, fr.oy));
        x0 = Math.min(x0, p.x - ext); x1 = Math.max(x1, p.x + ext);
        y0 = Math.min(y0, p.y - ext); y1 = Math.max(y1, p.y + ext);
      }
    }
    const W = this.canvas.width, H = this.canvas.height;
    const bx = Math.max(0, Math.floor(m.a * x0 + m.e) - 2);
    const by = Math.max(0, Math.floor(m.d * y0 + m.f) - 2);
    const bw = Math.min(W, Math.ceil(m.a * x1 + m.e) + 2) - bx;
    const bh = Math.min(H, Math.ceil(m.d * y1 + m.f) + 2) - by;
    return bw > 0 && bh > 0 ? { x: bx, y: by, w: bw, h: bh } : { x: 0, y: 0, w: 0, h: 0 };
  }

  /** Paint layers a..b from their plate, rebuilding it if anything drawn changed. False = paint them normally. */
  private paintPlate(a: number, b: number, t: number): boolean {
    const sig = this.plateSig(a, b);
    let plate = this.plates.get(a);
    if (!plate || plate.sig !== sig || plate.end !== b || plate.frameW !== this.canvas.width || plate.frameH !== this.canvas.height) {
      const box = this.runBox(a, b, t) ?? { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
      if (!plate) {
        if (this.plates.size >= 4) this.plates.delete(this.plates.keys().next().value!);
        const made = this.makeCanvas(1);
        if (!made) return false;
        plate = { ...made, end: b, sig: '', box, frameW: 0, frameH: 0 };
        this.plates.set(a, plate);
      }
      plate.box = box;
      plate.frameW = this.canvas.width;
      plate.frameH = this.canvas.height;
      if (box.w === 0 || box.h === 0) { plate.sig = sig; plate.end = b; return true; }
      if (plate.canvas.width !== box.w) plate.canvas.width = box.w;
      if (plate.canvas.height !== box.h) plate.canvas.height = box.h;
      const pc = plate.ctx;
      pc.setTransform(1, 0, 0, 1, 0, 0);
      pc.globalAlpha = 1;
      pc.globalCompositeOperation = 'source-over';
      pc.clearRect(0, 0, box.w, box.h);
      const m = this.ctx.getTransform();
      pc.setTransform(m.a, m.b, m.c, m.d, m.e - box.x, m.f - box.y);
      const self = this as unknown as { ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D };
      const main = self.ctx;
      self.ctx = pc;
      try {
        for (let li = a; li <= b; li++) this.paintLayer(li, t);
      } finally {
        self.ctx = main;
      }
      plate.sig = sig;
      plate.end = b;
    }
    if (plate.box.w === 0 || plate.box.h === 0) return true;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(plate.canvas, plate.box.x, plate.box.y);
    ctx.restore();
    return true;
  }

  /**
   * A `transform`, in min(w,h) units (px under `units: 'px'`), about the
   * viewport centre — or, with `origin: 'anchor'`, about `layer`'s own anchor
   * (a group's transform passes no layer: always the viewport centre).
   */
  private applyLayerTransform(tf: LayerTransform, layer: LayerSpec | null): void {
    const { ctx, w, h } = this;
    const unit = this.effSpec.units === 'px' ? 1 : Math.min(w, h);
    const { x: cx, y: cy } = transformOrigin(tf, layer, w, h, unit);
    ctx.translate(cx + (tf.x ?? 0) * unit, cy + (tf.y ?? 0) * unit);
    if (tf.rotate) ctx.rotate((tf.rotate * Math.PI) / 180);
    const s = tf.scale ?? 1;
    ctx.scale(s * (tf.scaleX ?? 1), s);
    ctx.translate(-cx, -cy);
  }

  /** Scene time for a timeline decision: the last painted frame's, else the loop clock's. */
  private sceneNow(): number {
    return this.lastRenderT !== Number.NEGATIVE_INFINITY ? this.lastRenderT : this.lastT;
  }

  /** Resolve the authored timeline at `t`, layer the live overrides on top, and adopt the result. */
  private resolveAuthored(t: number): void {
    const expired: string[] = [];
    const spec = applyOverridesAt(resolveTimelineAt(this.authored!, t), this.overrides, t, expired);
    for (const p of expired) this.overrides.delete(p);
    this.effSpec = spec;
    const sig = structuralSignature(spec);
    if (sig !== this.lastStructural) this.rebuild();
    else this.layers.forEach((b, i) => { b.layer = spec.layers[i] ?? b.layer; });
  }

  /** Register live steers on a timeline scene under the steering rule (see `overrides`). */
  private overrideAuthored(deltas: readonly SteerDelta[], glide: number): boolean {
    const now = this.sceneNow();
    const shown = this.effSpec;
    // One steer per field: a re-sent track can carry several deltas that
    // address the same field (an appended track, key- and index-form paths),
    // and only the last is the steer — otherwise each re-send would flip the
    // dedup id below and re-arm a hold the timeline already took back.
    const latest = new Map<string, SteerDelta>();
    for (const d of deltas) {
      const path = canonicalSpecPath(shown, d.path);
      if (!path) continue;
      latest.delete(path);
      latest.set(path, d);
    }
    const next = new Map(this.overrides);
    const armed: Array<[string, string]> = [];
    for (const [path, d] of latest) {
      const id = steerId(d);
      if (this.seenSteers.get(path) === id) continue;
      armed.push([path, id]);
      next.set(path, armOverride(this.authored!, path, glide > 0 ? readSpecPath(shown, path) : d.value, d.value, now, glide, d.ease !== undefined && STEER_EASES.has(d.ease) ? d.ease : undefined));
    }
    if (armed.length === 0) return true;
    // Validate the scene as it will actually be — every live override, now
    // and at each key still ahead — not the new deltas alone.
    if (!overridesStayValid(this.authored!, next, now)) return false;
    for (const [p, id] of armed) this.seenSteers.set(p, id);
    this.overrides = next;
    return true;
  }

  /** A copy of the live overrides — a sequence carries them into a morph's outgoing endpoint. */
  timelineOverrides(): Map<string, TimelineOverride> | null {
    return this.authored ? new Map(this.overrides) : null;
  }

  /** A copy of which server steers this child already applied, per field (see `seenSteers`). */
  timelineSeen(): Map<string, string> {
    return new Map(this.seenSteers);
  }

  /** The spec painted by the last frame (timeline and overrides resolved). */
  presentedSpec(): SaverSpec {
    return this.effSpec;
  }

  /**
   * Deterministic, frame-addressable render (shared by the rAF loop).
   *
   * With `ghosting` set, contiguous frames composite over the previous frame with a
   * refresh-rate-normalized fade. A non-contiguous seek (pause render, e2e frame
   * addressing) replays a bounded fixed-step warm-up from a full clear, so the
   * accumulated smear at time t is identical on every run — the determinism proof
   * survives statefulness because the "state" is reconstructed from pure history.
   */
  renderFrame(t: number, _seed: number): void {
    this.stepTransition(t);
    const g = this.transparent ? 0 : (this.effSpec.ghosting ?? 0);
    if (g > 0) {
      const dt = 1000 / 60;
      const contiguous = this.lastRenderT !== Number.NEGATIVE_INFINITY
        && t > this.lastRenderT
        && t - this.lastRenderT <= 250;
      if (contiguous) {
        this.paintFrame(t, 1 - Math.pow(g, (t - this.lastRenderT) / dt));
      } else {
        const k = Math.min(Math.ceil(Math.log(1 / 255) / Math.log(g)), LIMITS.maxGhostReplayFrames);
        const t0 = Math.max(0, t - k * dt);
        this.paintFrame(t0, 1);
        for (let ft = t0 + dt; ft < t - dt / 2; ft += dt) this.paintFrame(ft, 1 - g);
        if (t > t0) this.paintFrame(t, 1 - g);
      }
    } else {
      this.paintFrame(t, 1);
    }
    this.lastRenderT = t;
    // Presentation, last of all: the finished scene (ghosting included) is
    // copied to the visible canvas and the finish screened over the copy —
    // after persistence has done its work, and never into it.
    if (this.finishPass) presentWithFinish(this.finishPass, this.canvas, this.w, this.h, t, this.effSpec.finish, this.animateFinish);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.stop();
    } else {
      this.start();
    }
  }

  resize(width: number, height: number, dpr?: number): void {
    this.w = width;
    this.h = height;
    if (dpr !== undefined) this.saverCtx.dpr = dpr;
    this.sizeCanvas();
    this.rebuild();
    if (this.paused) this.renderFrame(0, this.seed);
  }

  /**
   * Replace the rendered spec without triggering a transition glide.
   * Checks structural signature — use `hotSwapPaint` only when the caller
   * already knows the signature is unchanged.
   */
  hotSwapSpec(spec: SaverSpec): void {
    this.adoptAuthored(spec);
    if (this.authored) { this.resolveAuthored(this.sceneNow()); return; }
    this.effSpec = spec;
    const sig = structuralSignature(this.effSpec);
    if (sig !== this.lastStructural) this.rebuild();
    else this.layers.forEach((b, i) => { b.layer = this.effSpec.layers[i] ?? b.layer; });
  }

  /**
   * Track whether `spec` carries a timeline. Live overrides belong to the
   * scene they were made on: a different spec (a new publish, a sequence's
   * re-steered segment, a morph frame) drops them, as a plain hot-swap
   * replaces `effSpec` wholesale; the host re-sends the live track.
   */
  private adoptAuthored(spec: SaverSpec, keepSteers = false): void {
    const next = spec.timeline ? spec : null;
    if (next !== this.authored && !(keepSteers && next && this.authored)) {
      this.overrides.clear();
      this.seenSteers.clear();
    }
    this.authored = next;
  }

  /**
   * A sequence's hot swap of a timeline segment: the new scene replaces the
   * old, but the live steers (and which server steers were already applied)
   * carry over — a steer the timeline already took back stays taken back —
   * and only a steer this child has never seen is armed, now. Frame
   * continuity is kept, so ghosting trails do not restart.
   */
  hotSwapKeepingSteers(spec: SaverSpec, retained: Iterable<SteerDelta>): void {
    if (!spec.timeline) {
      this.hotSwapSpec(spec);
      return;
    }
    if (!this.authored) {
      // The swap adds a timeline: the old scene carried the retained steers
      // baked in, the new one takes them as live steers from here.
      this.hotSwapSpec(spec);
      this.applyDeltasNow(retained);
      return;
    }
    this.adoptAuthored(spec, true);
    for (const d of retained) this.overrideAuthored([d], 0);
    this.resolveAuthored(this.sceneNow());
  }

  /** Arm a steer made while a sequence was mid-morph, on the outgoing end's override set, at that end's scene time. */
  static armInto(authored: SaverSpec, overrides: Map<string, TimelineOverride>, seen: Map<string, string>, deltas: readonly SteerDelta[], now: number): void {
    const at = resolveTimelineAt(authored, now);
    // As `overrideAuthored`: the last delta per field is the steer, and a
    // re-sent one (the host re-broadcasts the whole track) is not re-armed.
    const latest = new Map<string, SteerDelta>();
    for (const d of deltas) {
      const path = canonicalSpecPath(at, d.path);
      if (!path) continue;
      latest.delete(path);
      latest.set(path, d);
    }
    for (const [path, d] of latest) {
      const id = steerId(d);
      if (seen.get(path) === id) continue;
      const trial = new Map(overrides).set(path, armOverride(authored, path, d.value, d.value, now, 0));
      if (overridesStayValid(authored, trial, now)) {
        overrides.set(path, trial.get(path)!);
        seen.set(path, id);
      }
    }
  }

  /** Paint-only hot-swap: skips structuralSignature (caller guarantees match). */
  hotSwapPaint(spec: SaverSpec): void {
    this.adoptAuthored(spec);
    if (this.authored) { this.resolveAuthored(this.sceneNow()); return; }
    this.effSpec = spec;
    this.layers.forEach((b, i) => { b.layer = this.effSpec.layers[i] ?? b.layer; });
  }

  /**
   * Internal (see `LayerPaintOverride`): draw the listed layers twice —
   * outgoing sprite at `1 − k`, own sprite at `k` — until cleared with
   * `null`. Keyed by layer index. A `SequenceInstance` sets it per morph
   * frame under `text: 'crossfade'`; nothing else does.
   */
  setLayerPaintOverrides(overrides: ReadonlyMap<number, LayerPaintOverride> | null): void {
    this.paintOverrides = overrides && overrides.size > 0 ? overrides : null;
  }

  dispose(): void {
    this.stop();
    this.field = null; // the raster canvas was never attached; dropping the reference frees it
    // With a finish, the visible canvas is the pass's and `this.canvas` is
    // the offscreen scene (never attached) — drop the pass and its tiles.
    const visible = this.finishPass?.canvas ?? this.canvas;
    this.finishPass = null;
    if (this.ownsCanvas && typeof HTMLCanvasElement !== 'undefined' && visible instanceof HTMLCanvasElement) visible.remove();
  }
}

/**
 * Compile a declarative spec into a runnable SaverPlugin. Throws if the spec is invalid
 * (so an agent-authored spec is validated before it can run). The result is seeded,
 * deterministic, `renderFrame(t,seed)`-addressable, and flash-safe by construction.
 */
export function compileSaver(spec: unknown): SaverPlugin {
  const valid = assertValidSpec(spec);
  return {
    manifest: manifestFor(valid),
    mount: (ctx: SaverContext) => new SpecInstance(valid, ctx, { capabilityTier: (ctx as SpecMountContext).capabilityTier }),
    spec: valid,
  };
}

// ---------------------------------------------------------------------------
// Sequence — multi-segment timeline compiled as a single SaverPlugin
// ---------------------------------------------------------------------------

/**
 * Mount context for a compiled sequence. A plain `SaverContext` works — the
 * clock starts at 0, as every SaverPlugin's does. `sequenceBaseT` is read
 * only when the sequence declares `sync: 'epoch'`; hosts pass the shared
 * clock's elapsed ms (idlescreens.com: `Date.now() − scene.epoch`) so every
 * viewer of that sequence resolves the same segment.
 */
export interface SequenceMountContext extends SpecMountContext {
  /** ms already elapsed on the shared sequence clock. Ignored unless `sync: 'epoch'`. */
  sequenceBaseT?: number;
  /**
   * See `SpecMountContext.capabilityTier`. A `fade` transition keeps two
   * segments live for `dur`, which `basic` (canvas2d only) and `minimal`
   * cannot afford: on those tiers fade renders as `cut`. The tier is also
   * handed to every child and the bed (a `field` background's raster steps
   * down with it). Absent ⇒ fade enabled, full resolution.
   */
  capabilityTier?: CapabilityTier;
}

/** A segment child on a canvas of its own, composited onto the shared surface during a `fade`. */
interface OffscreenChild {
  index: number;
  child: SpecInstance;
  canvas: HTMLCanvasElement | OffscreenCanvas;
}

/** `bed.<path>` routes a steer to the sequence's bed when one exists. */
const BED_PREFIX = 'bed.';

/**
 * What `compileSequence().mount()` returns: a `SaverInstance` that can also
 * take a republished sequence in place. Hosts feature-detect it with
 * `hasHotSwapSequence` (an older engine's instance simply lacks the method)
 * and fall through to a remount when it returns `false`.
 */
export interface SequenceSaverInstance extends SaverInstance {
  renderFrame(t: number, seed: number): void;
  applyTrack(track: ControlTrack): void;
  /**
   * Swap `next` in for the running sequence without remounting, when the
   * two are `sequenceSwapCompatible`: every live segment child (and the bed)
   * hot-swaps to its new scene, the clock, the active segment, every
   * released hold and the retained track stay exactly where they were, and
   * the next frame resolves to the same `(segment, localT)` as if nothing
   * had happened — a mid-show caption fix that does not send the room back
   * to segment 0. Returns `false` and changes nothing when the sequences are
   * not compatible (a structural or timing edit); the host remounts then.
   */
  hotSwapSequence(next: IdleSequence): boolean;
}

/** `compileSequence`'s plugin: `mount` is typed to the sequence instance and `spec` to the validated sequence. */
export interface SequenceSaverPlugin extends SaverPlugin {
  mount(ctx: SequenceMountContext): SequenceSaverInstance;
  spec: IdleSequence;
}

/** Feature-detect `hotSwapSequence` on any mounted instance (false for a plain scene, or a sequence from an older engine). */
export function hasHotSwapSequence(inst: SaverInstance): inst is SequenceSaverInstance {
  return typeof (inst as { hotSwapSequence?: unknown }).hotSwapSequence === 'function';
}

class SequenceInstance implements SequenceSaverInstance {
  /** Replaced wholesale by `hotSwapSequence`; every per-segment lookup (`segmentStart`, `canMorph`, `childScene`) reads it live, so there are no derived tables to refresh. */
  private seq: IdleSequence;
  private readonly childCtx: SaverContext;
  private readonly canvas: HTMLCanvasElement | null;
  private readonly children: (SpecInstance | null)[];
  private activeIndex = -1;
  private paused = false;
  /**
   * When a morph is active, the child at `morphFromIndex` renders with a
   * lerped spec. The child stays keyed to the *outgoing* segment's slot so
   * its seed (and entity placement) is continuous.
   */
  private morphFromIndex = -1;
  private readonly seed: number;
  private frameId: number | null = null;
  private startT = 0;
  private baseT = 0;
  private lastT = 0;
  /** The T most recently passed to renderFrame — the clock a steer displaces. */
  private renderedT = 0;
  /**
   * The clicker's two pieces of state. `clockOffset` is added to every T so
   * a `sequence.segment` steer lands the timeline at the target segment's
   * start and STAYS there as the wall clock keeps ticking — the steer moves
   * the clock instead of fighting it. `releasedBelow` records that the steer
   * counts as the presenter clicking past every `advance: 'input'` hold
   * before the target (see `resolveSegment`).
   */
  private clockOffset = 0;
  private releasedBelow = 0;
  /**
   * Set by a `sequence.segment` steer that targets segment 0 under `loop:
   * true`: the steer resets the clock to segment 0's own start (localT 0),
   * so `renderFrame`'s wrap check (which compares the raw, ever-increasing
   * clock against `timedTotal()`) can no longer recognize the jump as a
   * wrap. This flag lets the clicker's jump to 0 still count as one, so the
   * last segment's fade plays instead of a hard cut. Cleared once the wrap
   * window (if any) has passed.
   */
  private pendingWrapFade = false;
  /** The morph in progress: its ends, and the override sets each end resolves with (see `morphEndpoint`). */
  private morphEnds: { from: number; to: number; outT: number; out: Map<string, TimelineOverride> | null; seenOut: Map<string, string>; in: Map<string, TimelineOverride> | null } | null = null;
  /**
   * Every non-`sequence.segment` delta this instance has been handed, last
   * wins per path, merged across `applyTrack` calls. Children are created
   * lazily and disposed on every segment switch, so a steer forwarded only
   * to the active child would evaporate at the next boundary — and a steer
   * to a path only a *later* segment owns (`bars.sprite.values` while the title
   * slide is up) would land nowhere. Re-applied to every child on creation
   * and folded into the morph endpoints; each child keeps the deltas that
   * resolve on it (see `applyRetainedDeltas`).
   */
  private readonly retainedDeltas = new Map<string, SteerDelta>();
  /**
   * Every `bed.<path>` delta (prefix stripped, last wins per path). The bed
   * is never re-created, so these are applied to it once on arrival — the
   * map exists only so `hotSwapSequence` can put a steered bed colour back
   * after the bed takes its republished scene. Absent a swap it is never read.
   */
  private readonly retainedBedDeltas = new Map<string, SteerDelta>();
  /** The outgoing segment while a `fade` runs; null otherwise. */
  private fading: OffscreenChild | null = null;
  /**
   * The incoming segment while a `fade` runs over a `bed`. Children over a
   * bed are transparent, so a cross-fade needs both of them on canvases of
   * their own — the incoming composited at k, the outgoing at 1 − k. Without
   * a bed the incoming paints its own opaque ground on the shared surface and
   * this stays null.
   */
  private fadingIn: OffscreenChild | null = null;
  /** False on the `basic`/`minimal` capability tiers — fade renders as cut. */
  private readonly fadeEnabled: boolean;
  /** The mount's tier, handed to every child and the bed. */
  private readonly capabilityTier: CapabilityTier | undefined;
  /**
   * The sequence's presentation pass when it — or any segment — declares a
   * `finish`: children and the bed draw into an offscreen scene canvas
   * (`childCtx.surface`), and every frame ends by copying it to the visible
   * surface with the finish screened over the copy — once per composed
   * frame, bed + segment + fade together. Null when no finish is declared
   * anywhere: children draw straight onto the visible surface, as before.
   */
  private readonly finishPass: FinishPass | null = null;
  /** False on the `basic`/`minimal` tiers — `finish.animate` renders as a static tile. */
  private readonly animateFinish: boolean;
  /**
   * The sequence's `bed`: one scene on the shared surface, drawn first every
   * frame at the sequence clock — WITHOUT `clockOffset`, so a
   * `sequence.segment` steer rewinds the segment and never the bed — and never
   * re-created. Segments render over it transparently. Null when absent.
   */
  private readonly bed: SpecInstance | null;

  constructor(seq: IdleSequence, ctx: SequenceMountContext) {
    this.seq = seq;
    const { sequenceBaseT, capabilityTier, ...plainCtx } = ctx;
    this.capabilityTier = capabilityTier;
    this.fadeEnabled = capabilityTier !== 'basic' && capabilityTier !== 'minimal';
    // `sync: 'epoch'`: seed the clock from the host's shared time, the same
    // way `baseT` carries SpecInstance's clock across pause/resume — the first
    // frame renders at `baseT`, not 0. Absent/`mount` ignores the hint and T
    // starts at 0 exactly as before the field existed. Holds are untouched:
    // `releasedBelow` stays 0, so a late joiner whose clock is past an
    // unreleased `advance: 'input'` hold lands ON the held segment.
    if (seq.sync === 'epoch' && typeof sequenceBaseT === 'number' && Number.isFinite(sequenceBaseT)) {
      this.baseT = Math.max(0, sequenceBaseT);
      this.lastT = this.baseT;
      this.renderedT = this.baseT;
    }

    let surface = ctx.surface ?? null;
    let canvas: HTMLCanvasElement | null = null;
    if (!surface && typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.style.cssText = 'display:block;width:100%;height:100%';
      canvas.setAttribute('aria-hidden', 'true');
      ctx.host.appendChild(canvas);
      surface = canvas;
    }
    this.canvas = canvas;

    // Prefer the sequence's own seed (same precedence SpecInstance uses for
    // scene.seed ?? ctx.seed). Children still resolve per-segment via childSeed.
    this.seed = ((seq.seed ?? ctx.seed ?? 0) >>> 0) || 1;
    this.animateFinish = capabilityTier !== 'basic' && capabilityTier !== 'minimal';
    // A finish anywhere in the sequence moves the children onto an offscreen
    // scene canvas for the sequence's lifetime; which finish applies is
    // decided per frame (see `frameFinish`).
    if (sequenceWantsFinish(seq) && surface) {
      const pass = createFinishPass(surface, this.seed);
      if (pass) {
        this.finishPass = pass;
        surface = createSceneCanvas(ctx.width, ctx.height);
      }
    }
    // Children are always parent-driven: reducedMotion:true keeps SpecInstance
    // from starting its own rAF. SequenceInstance.loop is the only clock.
    // `hostPresents`: a child's own `finish` is this instance's to apply.
    this.childCtx = { ...plainCtx, surface: surface!, reducedMotion: true };
    this.sizeVisible();
    this.children = new Array(seq.segments.length).fill(null) as (SpecInstance | null)[];
    if (seq.bed) {
      this.bed = new SpecInstance(this.bedScene(seq.bed), this.childCtx, { capabilityTier, hostPresents: true });
      this.bed.setPaused(true);
    } else {
      this.bed = null;
    }
    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderFrame(this.baseT, this.seed);
    else this.start();
  }

  private childSeed(index: number, fallback: number): number {
    return this.seq.segments[index]!.scene.seed ?? this.seq.seed ?? fallback;
  }

  /**
   * The bed's seed follows the segment rule (own seed, else the sequence seed)
   * but offset by `maxSegments`, past every segment's `seed + index`, so a bed
   * and segment 0 never share an entity stream and adding a segment does not
   * re-seat the bed.
   */
  private bedScene(bed: SaverSpec): SaverSpec {
    if (bed.seed != null) return bed;
    if (this.seq.seed != null) return { ...bed, seed: this.seq.seed + LIMITS.maxSegments };
    return bed;
  }

  private childScene(index: number): SaverSpec {
    const seg = this.seq.segments[index]!;
    if (seg.scene.seed != null) return seg.scene;
    if (this.seq.seed != null) return { ...seg.scene, seed: this.seq.seed + index };
    return seg.scene;
  }

  /** Whether the boundary from `from` to `from+1` should morph. */
  private canMorph(from: number): boolean {
    return canMorph(this.seq, from);
  }

  /** Walk back through consecutive morph boundaries to find the chain origin. */
  private morphChainRoot(index: number): number {
    return morphChainRoot(this.seq, index);
  }

  private morphDur(from: number): number {
    const tr = this.seq.segments[from]?.transition;
    return tr?.type === 'morph' ? tr.dur : 0;
  }

  /** Whether the morph out of `from` paints its text in two passes — `crossfade` or `dip` (default `step`: strings switch at k > 0). */
  private morphTextCrossfades(from: number): boolean {
    const tr = this.seq.segments[from]?.transition;
    return tr?.type === 'morph' && (tr.text === 'crossfade' || tr.text === 'dip');
  }

  /** The morph out of `from`'s two-pass text mode, for `crossfadeOverrides`. */
  private morphTextMode(from: number): 'crossfade' | 'dip' {
    const tr = this.seq.segments[from]?.transition;
    return tr?.type === 'morph' && tr.text === 'dip' ? 'dip' : 'crossfade';
  }

  /**
   * The paint overrides for one crossfade frame: every text layer whose
   * words differ between the outgoing and incoming specs, painting the
   * outgoing words (in the lerped frame's paint — colour and alpha glide as
   * usual) at `1 − k` under the incoming at `k`. Null when nothing differs,
   * so a crossfade between same-worded twins is a plain morph frame.
   */
  private crossfadeOverrides(specA: SaverSpec, specB: SaverSpec, lerped: SaverSpec, k: number, mode: 'crossfade' | 'dip' = 'crossfade'): Map<number, LayerPaintOverride> | null {
    let map: Map<number, LayerPaintOverride> | null = null;
    for (let i = 0; i < lerped.layers.length; i++) {
      if (!textStringsDiffer(specA, specB, i)) continue;
      const from = specA.layers[i]!.sprite;
      const now = lerped.layers[i]!.sprite;
      const outgoing: SpriteSpec = from.kind === 'text' && now.kind === 'text'
        ? { ...now, strings: from.strings }
        : from.kind === 'textBlock' && now.kind === 'textBlock'
          ? { ...now, text: from.text }
          : now;
      if (outgoing === now) continue;
      // `mode` is only written for `dip`, so a crossfade override is the
      // exact object it has always been.
      (map ??= new Map()).set(i, mode === 'dip' ? { outgoing, k, mode } : { outgoing, k });
    }
    return map;
  }

  /** Length of the fade (or wipe) out of segment `from`, or 0 (none, or a tier that plays it as cut). */
  private fadeDur(from: number): number {
    const tr = this.seq.segments[from]?.transition;
    return this.fadeEnabled && (tr?.type === 'fade' || tr?.type === 'wipe') ? tr.dur : 0;
  }

  /** The wipe out of segment `from`, when that is its transition. */
  private wipeOf(from: number): WipeTransition | null {
    const tr = this.seq.segments[from]?.transition;
    return tr?.type === 'wipe' ? tr : null;
  }

  private wipeScratch: HTMLCanvasElement | OffscreenCanvas | null = null;

  /**
   * Composite one side of a transition out of segment `from` at eased
   * progress `k`. A fade draws the outgoing at 1 − k (and, over a bed, the
   * incoming at k). A wipe draws each side through the moving edge instead:
   * the outgoing everywhere the edge has not yet passed, the incoming where
   * it has — the canvas is masked on a scratch copy (`destination-out` /
   * `destination-in` with the edge's gradient), then drawn.
   */
  private compositeTransition(canvas: HTMLCanvasElement | OffscreenCanvas, k: number, from: number, side: 'out' | 'in'): void {
    const wipe = this.wipeOf(from);
    if (!wipe) return this.composite(canvas, side === 'out' ? 1 - k : k);
    const main = this.childCtx.surface?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
    if (!main) return;
    const cw = Math.max(1, canvas.width);
    const ch = Math.max(1, canvas.height);
    if (!this.wipeScratch) this.wipeScratch = createSceneCanvas(cw, ch);
    const scratch = this.wipeScratch;
    if (scratch.width !== cw) scratch.width = cw;
    if (scratch.height !== ch) scratch.height = ch;
    const g = scratch.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!g) return this.composite(canvas, side === 'out' ? 1 - k : k);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'copy';
    g.drawImage(canvas, 0, 0);
    g.globalCompositeOperation = side === 'out' ? 'destination-out' : 'destination-in';
    g.fillStyle = wipeMask(g, wipe, k, cw, ch);
    g.fillRect(0, 0, cw, ch);
    g.restore();
    main.save();
    main.globalAlpha = 1;
    main.globalCompositeOperation = 'source-over';
    main.drawImage(scratch, 0, 0, this.childCtx.width, this.childCtx.height);
    main.restore();
  }

  /** Sum of every timed segment — the lap length under `loop: true`. */
  private timedTotal(): number {
    const last = this.seq.segments.length - 1;
    return segmentStart(this.seq, last) + (this.seq.segments[last]!.duration ?? 0);
  }

  private releaseFading(): void {
    if (this.fading) {
      this.fading.child.dispose();
      this.fading = null;
    }
    if (this.fadingIn) {
      this.fadingIn.child.dispose();
      this.fadingIn = null;
    }
  }

  /**
   * A segment child on a canvas of its own. Like a morph it mounts on its
   * chain root's scene and seed (so its entities are the ones the viewer was
   * watching) and hot-swaps to the segment's spec; the retained track is
   * applied last. Transparent over a bed, opaque otherwise.
   */
  private offscreenChild(index: number, root: number): OffscreenChild {
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof document !== 'undefined'
      ? document.createElement('canvas')
      : new OffscreenCanvas(Math.max(1, this.childCtx.width), Math.max(1, this.childCtx.height));
    const child = new SpecInstance(this.childScene(root), { ...this.childCtx, surface: canvas }, { transparent: this.bed !== null, capabilityTier: this.capabilityTier, hostPresents: true });
    child.setPaused(true);
    if (root !== index) child.hotSwapSpec(this.childScene(index));
    if (this.retainedDeltas.size > 0) child.applyDeltasNow(this.retainedDeltas.values());
    return { index, child, canvas };
  }

  /** Render an offscreen child; a transparent one never clears, so its owner does here. */
  private renderOffscreen(oc: OffscreenChild, t: number, seed: number): void {
    if (this.bed) {
      const c = oc.canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      c?.clearRect(0, 0, this.childCtx.width, this.childCtx.height);
    }
    oc.child.renderFrame(t, seed);
  }

  /** Draw an offscreen canvas onto the shared surface at `alpha`. */
  private composite(canvas: HTMLCanvasElement | OffscreenCanvas, alpha: number): void {
    const main = this.childCtx.surface?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
    if (!main) return;
    main.save();
    main.globalAlpha = alpha;
    main.globalCompositeOperation = 'source-over';
    main.drawImage(canvas, 0, 0, this.childCtx.width, this.childCtx.height);
    main.restore();
  }

  /**
   * Render the outgoing segment `from` of a live fade onto its own canvas. It
   * keeps animating at `duration(from) + localT` (it does not freeze — and if
   * it was an `advance: 'input'` hold it resumes from its duration, not from
   * wherever the hold had reached). Two live segments for `dur` only; the
   * outgoing one is disposed when the fade ends.
   */
  private renderOutgoing(from: number, localT: number, seed: number): OffscreenChild {
    if (this.fading && this.fading.index !== from) {
      this.fading.child.dispose();
      this.fading = null;
    }
    if (!this.fading) this.fading = this.offscreenChild(from, this.morphChainRoot(from));
    const outDur = this.seq.segments[from]!.duration ?? 0;
    this.renderOffscreen(this.fading, outDur + localT, this.childSeed(this.morphChainRoot(from), seed));
    return this.fading;
  }

  /**
   * One end of a morph at segment time `t`. A scene without a timeline is its
   * steered scene, as always. With a timeline, the retained track follows the
   * same rule a child applies (held until the path's next key, sticky
   * otherwise): the outgoing end uses its child's live overrides when the
   * morph began from one, and otherwise — like the incoming end, whose child
   * does not exist yet — arms the retained steers at segment time 0, as a
   * freshly mounted child would.
   */
  private morphEndpoint(index: number, t: number, side: 'out' | 'in'): SaverSpec {
    const scene = this.childScene(index);
    if (!scene.timeline) return this.steeredScene(scene);
    const ends = this.morphEnds;
    if (ends && side === 'out') ends.outT = t;
    let ov = side === 'out' ? ends?.out ?? null : ends?.in ?? null;
    if (!ov) {
      ov = this.armRetained(scene, side === 'out' ? ends?.seenOut : undefined);
      if (ends) { if (side === 'out') ends.out = ov; else ends.in = ov; }
    }
    return applyOverridesAt(resolveTimelineAt(scene, t), ov, t);
  }

  /** The retained steers that resolve (and validate) on a timeline scene, armed at segment time 0. */
  private armRetained(scene: SaverSpec, seen?: Map<string, string>): Map<string, TimelineOverride> {
    const out = new Map<string, TimelineOverride>();
    if (this.retainedDeltas.size === 0) return out;
    const at0 = resolveTimelineAt(scene, 0);
    for (const d of this.retainedDeltas.values()) {
      const path = canonicalSpecPath(at0, d.path);
      if (!path) continue;
      const trial = new Map(out).set(path, armOverride(scene, path, d.value, d.value, 0, 0));
      if (overridesStayValid(scene, trial, 0)) {
        out.set(path, trial.get(path)!);
        seen?.set(path, steerId(d));
      }
    }
    return out;
  }

  /** A segment's scene with the retained track applied — `scene` itself when nothing resolves on it. */
  private steeredScene(scene: SaverSpec): SaverSpec {
    return this.retainedDeltas.size === 0 ? scene : applyRetainedDeltas(scene, this.retainedDeltas.values());
  }

  /**
   * The child for segment `index`, created paused on the shared surface if
   * the slot is empty. `rootScene` (a morph chain's root) mounts the child
   * with the root's scene so its seed and entity placement are continuous
   * with the chain, then hot-swaps to the segment's own spec. Either way the
   * retained track is applied last, so a steer made while another segment
   * was up is already in effect on this child's first frame. `skipInitialPaint`
   * is for a caller (the morph branch) that is about to render a real frame,
   * paint overrides included, in this same call — see `SpecInstanceOptions`.
   */
  private ensureChild(index: number, rootScene?: SaverSpec, skipInitialPaint?: boolean): SpecInstance {
    if (index < 0 || index >= this.seq.segments.length) index = 0;
    let child = this.children[index];
    if (!child) {
      // Over a bed the child is transparent ink on the shared surface, and
      // every caller renders the real frame right after this — so its
      // constructor paint (t = 0) would only leave a stray frame of ink under
      // it. Transparent children ignore ghosting, so skipping it changes no
      // warm-up. Without a bed the opaque child repaints its ground over it.
      child = new SpecInstance(rootScene ?? this.childScene(index), this.childCtx, { transparent: this.bed !== null, skipInitialPaint: skipInitialPaint || this.bed !== null, capabilityTier: this.capabilityTier, hostPresents: true });
      this.children[index] = child;
      // Belt-and-suspenders: never let a child self-drive, even if childCtx
      // reducedMotion is ever relaxed.
      child.setPaused(true);
      if (rootScene) child.hotSwapSpec(this.childScene(index));
      if (this.retainedDeltas.size > 0) child.applyDeltasNow(this.retainedDeltas.values());
    }
    return child;
  }

  private releaseChild(index: number): void {
    const child = this.children[index];
    if (child) {
      child.dispose();
      this.children[index] = null;
    }
  }

  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.startT = 0;
    this.frameId = requestAnimationFrame((now) => this.loop(now));
  }

  private stop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.baseT = this.lastT;
  }

  private loop(now: number): void {
    this.frameId = requestAnimationFrame((n) => this.loop(n));
    if (this.startT === 0) this.startT = now;
    this.lastT = now - this.startT + this.baseT;
    this.renderFrame(this.lastT, this.seed);
  }

  /**
   * With a presentation pass, size the visible surface like a child sizes
   * the scene canvas (children never touch the visible surface then).
   */
  private sizeVisible(): void {
    const fp = this.finishPass;
    if (!fp) return;
    const dpr = Math.min(this.childCtx.dpr, 2);
    fp.canvas.width = Math.max(1, Math.round(this.childCtx.width * dpr));
    fp.canvas.height = Math.max(1, Math.round(this.childCtx.height * dpr));
    fp.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * The finish this frame applies: the sequence's own overrides; else the
   * active segment's (the incoming one during a fade) — read through
   * `steeredScene` so a retained steer to `finish.grain`/`finish.dither`
   * takes effect immediately instead of the authored value; a bed's is
   * ignored.
   */
  private frameFinish(): SaverSpec['finish'] {
    if (this.seq.finish !== undefined) return this.seq.finish;
    if (this.activeIndex < 0) return undefined;
    const scene = this.childScene(this.activeIndex);
    if (scene.timeline) {
      // A timeline may key `finish.*`: read what the rendering child painted
      // (its chain-root slot mid-morph), not the authored base.
      const live = (this.fadingIn?.index === this.activeIndex ? this.fadingIn.child : null)
        ?? this.children[this.activeIndex] ?? this.children[this.morphChainRoot(this.activeIndex)];
      if (live) return live.presentedSpec().finish;
    }
    return this.steeredScene(scene).finish;
  }

  /**
   * The seed `frameFinish()`'s grain resolves against — the sequence's own
   * for a sequence-level finish, else the active segment's actual render
   * seed (`segmentRenderSeed`: chain-root-aware and normalized exactly like
   * `SpecInstance`, so it agrees with what that segment's entities render
   * with, morph or not).
   */
  private frameFinishSeed(): number {
    if (this.seq.finish !== undefined) return this.seed;
    if (this.activeIndex < 0) return this.seed;
    return segmentRenderSeed(this.seq, this.activeIndex) ?? this.seed;
  }

  renderFrame(T: number, seed: number): void {
    this.renderScene(T, seed);
    // Once per composed frame, after bed, segment and any fade composite.
    if (this.finishPass) {
      presentWithFinish(this.finishPass, this.childCtx.surface!, this.childCtx.width, this.childCtx.height, T, this.frameFinish(), this.animateFinish, this.frameFinishSeed());
    }
  }

  private renderScene(T: number, seed: number): void {
    this.renderedT = T;
    const resolved = resolveSegment(this.seq, T + this.clockOffset, { releasedBelow: this.releasedBelow });
    const { index, localT } = resolved;

    // The bed is the ground: painted first, on the global clock. `T` here is
    // the sequence clock before `clockOffset`, so the clicker never rewinds it.
    this.bed?.renderFrame(T, this.seq.bed?.seed ?? this.seq.seed ?? seed);

    // A fade comes from the previous segment in the list — or, under
    // `loop: true`, from the last segment when the lap wraps to 0, so the
    // last segment's `fade` is the wrap's transition. Cut and morph paths
    // are untouched: fadeDur is 0 for them.
    const lastIdx = this.seq.segments.length - 1;
    const wrapped = this.seq.loop && index === 0 && lastIdx > 0
      && (T + this.clockOffset >= this.timedTotal() || this.pendingWrapFade);

    // Check if the *previous* segment has a morph into this one — or, with
    // `wrapMorph` on a loop that is one morph chain, whether the last
    // segment morphs into segment 0 at the wrap (`canWrapMorph`). Without
    // `wrapMorph` the wrap stays the hard cut it has always been.
    // Only on a natural lap wrap: a clicker jump to segment 0 (`pendingWrapFade`)
    // arrives from wherever the presenter was, not from the last segment, so
    // it cuts — morphing from the last segment would flash a frame of it.
    const naturalWrap = this.seq.loop && index === 0 && lastIdx > 0 && T + this.clockOffset >= this.timedTotal();
    const prevIdx = index > 0 ? index - 1 : -1;
    const morphFrom = prevIdx >= 0 ? prevIdx : naturalWrap && canWrapMorph(this.seq) ? lastIdx : -1;
    const morphActive = morphFrom >= 0
      && (morphFrom === prevIdx ? this.canMorph(prevIdx) : true)
      && localT < this.morphDur(morphFrom);
    const fadeFrom = prevIdx >= 0 ? prevIdx : wrapped ? lastIdx : -1;
    const fadeActive = fadeFrom >= 0 && localT < this.fadeDur(fadeFrom);
    if (!fadeActive && this.fading) this.releaseFading();
    // The flag only needs to survive the frames still inside the wrap fade
    // window; once that ends (or the clock moves off segment 0) it has done
    // its job.
    if (this.pendingWrapFade && (index !== 0 || !fadeActive)) this.pendingWrapFade = false;

    if (morphActive) {
      // Morph in progress: keep the child keyed to the chain root
      // (preserves its seed/entity placement through chained morphs).
      const chainRoot = this.morphChainRoot(index);
      if (this.morphFromIndex !== morphFrom || this.morphEnds?.to !== index) {
        // A new morph: carry the outgoing segment's live steers (held/expired
        // per the timeline rule, on its own clock) into the lerp, before its
        // child is released or hot-swapped to the lerped frame.
        const outChild = this.children[morphFrom];
        this.morphEnds = { from: morphFrom, to: index, outT: 0, out: outChild?.timelineOverrides() ?? null, seenOut: outChild?.timelineSeen() ?? new Map(), in: null };
      }
      this.morphFromIndex = morphFrom;
      this.activeIndex = index;

      // Release all children except the chain root's slot
      for (let i = 0; i < this.children.length; i++) {
        if (i !== chainRoot) this.releaseChild(i);
      }

      // A fresh mount here is about to be repainted for real a few lines
      // down (hotSwapPaint + overrides + renderFrame) within this same call.
      // Only `text: 'crossfade'` needs the constructor's own paint skipped —
      // its partial-alpha passes would otherwise composite over a stray
      // full-opacity frame underneath; `step` (the common case) is left to
      // paint at construction as it always has, so a fresh mount's ghosting
      // contiguity (`lastRenderT`) is unaffected.
      const child = this.ensureChild(chainRoot, undefined, this.morphTextCrossfades(morphFrom));
      const dur = this.morphDur(morphFrom);
      const k = easeSmooth(localT / dur);
      // The lerp endpoints carry the retained track, so without this a
      // steered colour would vanish for `dur` and snap back when the morph
      // finalises. `canMorph` only guarantees specA/specB share structure
      // BEFORE the retained set is applied — a structural delta (`layers.0.
      // count`, a motion change) could validate on one endpoint and not the
      // other, or change both identically but differ from what this child
      // was last built with. hotSwapSpec (not hotSwapPaint) re-checks the
      // signature every frame and rebuilds when it moved, so a structural
      // steer actually takes effect instead of leaving stale entities.
      //
      // A segment with a `timeline` is resolved on its own clock first — the
      // outgoing one at its end (its duration + localT, so a looping
      // timeline keeps cycling through the morph), the incoming at localT —
      // and the timeline-free results are lerped. Without timelines
      // resolveTimelineAt returns its argument, so this is the old frame.
      const outDur = this.seq.segments[morphFrom]!.duration ?? 0;
      const specA = this.morphEndpoint(morphFrom, outDur + localT, 'out');
      const specB = this.morphEndpoint(index, localT, 'in');
      const lerped = lerpSpec(specA, specB, k);
      child.hotSwapSpec(lerped);
      // Default (`step`): no overrides, the frame is what it always was —
      // strings already switched inside `lerped` at k > 0.
      child.setLayerPaintOverrides(this.morphTextCrossfades(morphFrom) ? this.crossfadeOverrides(specA, specB, lerped, k, this.morphTextMode(morphFrom)) : null);
      child.renderFrame(localT, this.childSeed(chainRoot, seed));
    } else {
      // No morph (or morph complete). If we were morphing, finalize.
      if (this.morphFromIndex >= 0) {
        // Morph just completed — release the chain-root child.
        const oldRoot = this.morphChainRoot(this.morphFromIndex);
        this.releaseChild(oldRoot);
        if (oldRoot !== this.morphFromIndex) this.releaseChild(this.morphFromIndex);
        this.morphFromIndex = -1;
        this.morphEnds = null;
      }

      if (index !== this.activeIndex) {
        for (let i = 0; i < this.children.length; i++) {
          if (i !== index) this.releaseChild(i);
        }
        this.activeIndex = index;
      }

      // Determine the effective seed: if this segment was reached via a
      // morph chain, use the chain-root's seed so entity placement is
      // continuous across all morphed segments and seeks match playthrough.
      const chainRoot = this.morphChainRoot(index);
      const useMorphSeed = chainRoot < index;
      const effSeed = useMorphSeed ? this.childSeed(chainRoot, seed) : this.childSeed(index, seed);

      if (fadeActive && this.bed) {
        // Over a bed both segments are transparent ink, so both go to canvases
        // of their own: incoming at k, outgoing over it at 1 − k. The incoming
        // moves to the shared surface (via ensureChild) once the fade ends.
        const k = easeSmooth(localT / this.fadeDur(fadeFrom));
        if (this.fadingIn && this.fadingIn.index !== index) {
          this.fadingIn.child.dispose();
          this.fadingIn = null;
        }
        if (!this.fadingIn) this.fadingIn = this.offscreenChild(index, useMorphSeed ? chainRoot : index);
        this.renderOffscreen(this.fadingIn, localT, effSeed);
        const out = this.renderOutgoing(fadeFrom, localT, seed);
        this.compositeTransition(this.fadingIn.canvas, k, fadeFrom, 'in');
        this.compositeTransition(out.canvas, k, fadeFrom, 'out');
        return;
      }

      // If using morph seed, mount the child with the chain root's scene+seed
      // but immediately hot-swap to the current segment's spec.
      const child = useMorphSeed ? this.ensureChild(index, this.childScene(chainRoot)) : this.ensureChild(index);
      child.renderFrame(localT, effSeed);
      if (fadeActive) {
        // The outgoing segment on its own canvas over the incoming frame at
        // 1 − easeSmooth(k): the incoming's opaque ground fades in beneath it.
        const out = this.renderOutgoing(fadeFrom, localT, seed);
        this.compositeTransition(out.canvas, easeSmooth(localT / this.fadeDur(fadeFrom)), fadeFrom, 'out');
      }
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.stop();
    else this.start();
    // Do NOT forward pause=false to children — that would start SpecInstance
    // rAF loops alongside SequenceInstance.loop (double clock, wrong localT).
    // Children stay paused; the parent loop is the sole driver.
    for (const child of this.children) {
      child?.setPaused(true);
    }
    this.fading?.child.setPaused(true);
    this.fadingIn?.child.setPaused(true);
    this.bed?.setPaused(true);
  }

  resize(width: number, height: number, dpr?: number): void {
    // Children are created lazily (first rAF tick, segment switches, morph
    // finalization), so the new size must outlive the children that exist right
    // now. Without this, a resize while a slot is empty is forgotten and the
    // next child mounts at the stale mount-time size — a viewer that mounted
    // in a hidden/unpainted tab (width 0) stays a 1×1 canvas forever, and a
    // segment cut after any resize snaps back to the old dimensions.
    this.childCtx.width = width;
    this.childCtx.height = height;
    if (dpr !== undefined) this.childCtx.dpr = dpr;
    this.sizeVisible();
    for (const child of this.children) {
      child?.resize(width, height, dpr);
    }
    this.fading?.child.resize(width, height, dpr);
    this.fadingIn?.child.resize(width, height, dpr);
    this.bed?.resize(width, height, dpr);
  }

  applyTrack(track: ControlTrack): void {
    const all = (track?.deltas ?? []) as unknown as SteerDelta[];
    // `bed.<path>` goes to the bed with the prefix stripped — only when a bed
    // exists; otherwise the path reaches the segments as today (a layer keyed
    // `bed` keeps working).
    const isBedPath = (d: SteerDelta): boolean => this.bed !== null && typeof d.path === 'string' && d.path.startsWith(BED_PREFIX);
    const bedDeltas = all.filter(isBedPath).map((d) => ({ ...d, path: d.path.slice(BED_PREFIX.length) }));
    if (bedDeltas.length > 0) {
      for (const d of bedDeltas) this.retainedBedDeltas.set(d.path, d);
      this.bed!.applyTrack({ ...track, deltas: bedDeltas as unknown as ParamDelta[] });
    }
    const deltas = all.filter((d) => !isBedPath(d));
    // Retain first: a `sequence.segment` steer in the same track creates the
    // target child inside renderFrame below, and it must see these deltas.
    for (const d of deltas) {
      if (d.path !== 'sequence.segment' && typeof d.path === 'string') this.retainedDeltas.set(d.path, d);
    }
    const segDelta = deltas.find((d) => d.path === 'sequence.segment');
    let switchedSegment = false;
    if (segDelta !== undefined && typeof segDelta.value === 'number') {
      const idx = Math.max(0, Math.min(this.seq.segments.length - 1, Math.round(segDelta.value as number)));
      // A steer to segment 0 under loop is the clicker doing the same jump
      // the wall clock does on a natural lap wrap — it should trigger the
      // last segment's fade the same way (see `pendingWrapFade`).
      this.pendingWrapFade = this.seq.loop && idx === 0 && this.seq.segments.length > 1;
      // Displace the clock so T + offset == the target segment's start: the
      // segment begins at localT 0 (its `life.enter` build replays) and the
      // next animation frame resolves to the same segment instead of snapping
      // back to whatever the wall clock said. The steer also releases every
      // `advance: 'input'` hold before the target; holds at and after it stay
      // armed, so steering backwards re-arms the ones in between.
      this.clockOffset = segmentStart(this.seq, idx) - this.renderedT;
      this.releasedBelow = idx;
      this.renderFrame(this.renderedT, this.seed);
      switchedSegment = true;
    }

    const childDeltas = deltas.filter((d) => d.path !== 'sequence.segment');
    if (childDeltas.length > 0) {
      if (this.morphFromIndex >= 0) {
        // Mid-morph, the rendered child lives at the chain-root slot, not
        // `children[activeIndex]` — forwarding a child.applyTrack() there
        // would silently no-op AND get overwritten by the morph's own
        // hotSwapSpec on the very next frame regardless, so a transition
        // glide on this path can't coexist with the morph's own cross-fade.
        // The delta is already retained above, so a re-render is all that's
        // needed to reach it via steeredScene: it takes effect this frame,
        // immediately rather than gliding over its own `dur`. Skip only when
        // the segDelta branch above already re-rendered with these deltas
        // retained.
        // Timeline ends resolve through `morphEnds`: arm the new steer on the
        // outgoing set at its current time, and re-arm the incoming side.
        const ends = this.morphEnds;
        if (ends) {
          const outScene = this.childScene(ends.from);
          if (ends.out && outScene.timeline) SpecInstance.armInto(outScene, ends.out, ends.seenOut, childDeltas, ends.outT);
          ends.in = null;
        }
        if (!switchedSegment) this.renderFrame(this.renderedT, this.seed);
      } else if (this.activeIndex >= 0) {
        // Not mid-morph: the active child still gets the track directly, as
        // before retention — a steer to a path it owns glides on this call
        // rather than snapping at the next boundary.
        const child = this.children[this.activeIndex];
        child?.applyTrack({ ...track, deltas: childDeltas as unknown as ParamDelta[] });
      }
      // The outgoing segment during a fade — and, over a bed, the incoming
      // one too, since both are standalone offscreen SpecInstances, not
      // `this.children` — would otherwise freeze at whatever they last
      // rendered instead of picking up a mid-fade steer like the active
      // child does. Independent of the morph/active branching above: fade
      // and morph are mutually exclusive per-frame states.
      this.fading?.child.applyTrack({ ...track, deltas: childDeltas as unknown as ParamDelta[] });
      this.fadingIn?.child.applyTrack({ ...track, deltas: childDeltas as unknown as ParamDelta[] });
    }
  }

  /**
   * See `SequenceSaverInstance.hotSwapSequence`. Nothing that positions the
   * show is touched: `clockOffset`, `releasedBelow`, `activeIndex`,
   * `morphFromIndex`, `pendingWrapFade`, `renderedT` and the retained deltas
   * all keep their values, and the timing terms `sequenceSwapCompatible`
   * pins (durations, advance, transitions, loop) are the same on both sides,
   * so `resolveSegment` at the next frame lands where it would have anyway.
   * Each live child takes its new scene with the retained track re-applied
   * (`steeredScene` — the same routing a fresh child gets), so steered paint
   * survives the swap; `hotSwapSpec` keeps the entities (the signatures
   * match) and does not reset ghosting contiguity, so a drifting entity is
   * where it was 1 ms ago. Children are always paused, so none of them has a
   * glide in flight for the swap to interrupt (`SpecInstance.applyTrack`
   * snaps when paused). A morph in progress is untouched here: its chain-root
   * child is re-lerped from the new endpoints on the very next frame.
   */
  hotSwapSequence(next: IdleSequence): boolean {
    if (!sequenceSwapCompatible(this.seq, next)) return false;
    this.seq = next;
    // Routed like a child's retained set (`applyRetainedDeltas`, not
    // `applyDeltasNow`): the latter resets ghosting contiguity, and the bed's
    // trails must not restart on a swap.
    if (this.bed && next.bed) this.bed.hotSwapSpec(applyRetainedDeltas(this.bedScene(next.bed), this.retainedBedDeltas.values()));
    const swap = (child: SpecInstance | null | undefined, index: number): void => {
      if (!child) return;
      const scene = this.childScene(index);
      if (!scene.timeline) { child.hotSwapSpec(this.steeredScene(scene)); return; }
      // A timeline child keeps its live steers across the swap (the steering
      // rule), rather than having them baked into its base (which would make
      // a steer on an animated path sticky) or re-armed from scratch (which
      // would bring back one the timeline already took back).
      child.hotSwapKeepingSteers(scene, this.retainedDeltas.values());
    };
    for (let i = 0; i < this.children.length; i++) swap(this.children[i], i);
    if (this.fading) swap(this.fading.child, this.fading.index);
    if (this.fadingIn) swap(this.fadingIn.child, this.fadingIn.index);
    this.morphEnds = null;
    // A paused instance (reducedMotion, or a sleeping host) has no next frame
    // to paint the new words with; a running one repaints on its own tick.
    if (this.paused) this.renderFrame(this.renderedT, this.seed);
    return true;
  }

  dispose(): void {
    this.stop();
    this.releaseFading();
    for (let i = 0; i < this.children.length; i++) {
      this.releaseChild(i);
    }
    this.bed?.dispose();
    if (this.finishPass) {
      // The scene canvas was never attached; the pass's visible canvas is
      // `this.canvas` (removed below) or the host's surface.
      this.finishPass.grain = null;
      this.finishPass.dither = null;
    }
    if (this.canvas) this.canvas.remove();
  }
}

function sequenceManifest(seq: IdleSequence): SaverManifest {
  const maxSegment = seq.segments.reduce((max, s) => {
    const t = s.scene.layers.reduce((n, l) => n + l.count, 0);
    return Math.max(max, t);
  }, 0);
  // A bed is live alongside whichever segment is up, so it costs on top of the largest.
  const bedTotal = seq.bed ? seq.bed.layers.reduce((n, l) => n + l.count, 0) : 0;
  const maxTotal = bedTotal + maxSegment;
  const costTier = maxTotal < 30 ? 'idle' : maxTotal < 150 ? 'low' : maxTotal < 400 ? 'medium' : 'high';
  return {
    id: seq.id,
    label: seq.label,
    timeModel: 'closed-form',
    passthrough: false,
    minBackend: 'canvas2d',
    costTier,
    motionIntensity: 'moderate',
    reducedMotionFallback: 'static',
    a11y: { flashSafe: true },
    workerReady: false,
  };
}

export function compileSequence(spec: unknown): SequenceSaverPlugin {
  const valid = assertValidSequence(spec);
  return {
    manifest: sequenceManifest(valid),
    mount: (ctx: SequenceMountContext) => new SequenceInstance(valid, ctx),
    spec: valid,
  };
}
