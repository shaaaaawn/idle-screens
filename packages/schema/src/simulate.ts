import type { Rng } from '@idle-screens/core';
import type { CycleSpec, LayerSpec, SpriteSpec, TextBlockAnchor } from './types';
import { LIMITS } from './types';
import { isShapedSprite } from './shapes';

/** Near plane for warp motion. z lives in [WARP_NEAR, 1]; screen scale is 1/z. */
export const WARP_NEAR = 0.08;
/** Cap on the 1/z size multiplier so near stars don't blow out. */
const WARP_MAX_SCALE = 8;

/** One axis-pair of seeded harmonic octaves for wander motion (amps px, freqs rad/ms). */
export interface WanderOsc {
  ax: number[];
  fx: number[];
  phx: number[];
  ay: number[];
  fy: number[];
  phy: number[];
}

/** A seeded entity: initial state + resolved velocity. `positionAt` is a pure function
 *  of this + time, so the rAF loop and renderFrame(t) produce identical results.
 *  IMPORTANT (determinism/compat): fields for newer features are OPTIONAL and only
 *  set when the feature is declared, so older specs snapshot byte-identically. */
export interface Entity {
  x0: number;
  y0: number;
  size: number;
  spriteIndex: number;
  phase: number;
  vx: number; // px/sec
  vy: number; // px/sec
  bob: number; // vertical bob / horizontal sway amplitude (px)
  motion: 'drift' | 'rise' | 'bounce' | 'static' | 'orbit' | 'wander' | 'warp' | 'path';
  headingLeft: boolean;
  alpha: number; // resolved base opacity (default 1)
  pulseAmp: number; // opacity breathing amplitude (0 = none)
  pulsePeriod: number; // ms
  pulsePhase: number;
  spinSpeed: number; // degrees/sec (0 = no rotation)
  spinPhase: number; // seeded starting angle (radians)
  growAmp: number; // size breathing amplitude as fraction (0 = none)
  growPeriod: number; // ms
  growPhase: number;
  orbitR: number; // orbit radius (px, 0 = not orbiting)
  orbitCx: number; // orbit center x (px)
  orbitCy: number; // orbit center y (px)
  colorIndex: number; // index into sprite colors[] (-1 = use sprite.color)
  cyclePeriod: number; // ms (0 = no cycling)
  /** Rect sprite second dimension (height px), or bar thickness. Only set for rect / bar sprites. */
  size2?: number;
  /** Reading-order index into `bar.values`. Only set for bar sprites. */
  barIndex?: number;
  /** Placed by a list/table layout: variants cycle from the ordered base index, in step. Only set for data layouts. */
  ordered?: true;
  /** Orbit parent layer key (motion.center = { layer }). Center resolved at render time. */
  orbitParent?: string;
  /** Present only when the layer explicitly disables edge wrapping. */
  wrapDisabled?: true;
  /** Harmonic drift params. Only set for wander motion. */
  wander?: { own: WanderOsc; shared: WanderOsc; coherence: number; margin: number };
  /** Depth-axis params. Only set for warp motion. */
  warp?: { ux: number; uy: number; z0: number; vz: number; cx: number; cy: number };
  /** Sparse-event window. Only set when `layer.emit` is declared. `phase` ms offset. */
  emit?: { every: number; life: number; phase: number; growFrom: number; growTo: number };
  /** Shared-clock time multiplier for pulse/grow/cycle. Only set when `layer.clock` is declared. */
  clockRate?: number;
  /** Shared cycle phase (radians). Only set when `layer.clock` is declared. */
  cyclePhase?: number;
  /** Velocity easing. Only set when the motion declares `ease`. */
  ease?: { type: 'settle' | 'buoyant'; tau: number };
  /** Spline params (pts in px, shared per layer). Only set for path motion. */
  path?: {
    pts: Array<{ x: number; y: number }>;
    duration: number;
    closed: boolean;
    smooth: boolean;
    phase: number; // 0..1 offset along the path
    offX: number; // per-entity scatter (px)
    offY: number;
  };
}

export interface Placed {
  x: number;
  y: number;
  flip: boolean;
}

export function spriteVariants(sprite: SpriteSpec): number {
  if (sprite.kind === 'emoji') return sprite.glyphs.length;
  if (sprite.kind === 'text') return sprite.strings.length;
  return 1;
}

const OCT_AMP = [1, 0.5, 0.25];
const OCT_PERIOD: Array<[number, number]> = [
  [6000, 14000],
  [3000, 7000],
  [1500, 4000],
];

/** Draw one set of 3 harmonic octaves per axis (18 rng draws). `amp` in px. */
function drawOsc(rng: Rng, amp: number): WanderOsc {
  const osc: WanderOsc = { ax: [], fx: [], phx: [], ay: [], fy: [], phy: [] };
  for (let i = 0; i < 3; i++) {
    osc.ax.push(amp * OCT_AMP[i]! * rng.range(0.6, 1.4));
    osc.fx.push((2 * Math.PI) / rng.range(OCT_PERIOD[i]![0], OCT_PERIOD[i]![1]));
    osc.phx.push(rng.range(0, Math.PI * 2));
  }
  for (let i = 0; i < 3; i++) {
    osc.ay.push(amp * OCT_AMP[i]! * rng.range(0.6, 1.4));
    osc.fy.push((2 * Math.PI) / rng.range(OCT_PERIOD[i]![0], OCT_PERIOD[i]![1]));
    osc.phy.push(rng.range(0, Math.PI * 2));
  }
  return osc;
}

const GOLDEN = 0.6180339887498949;

/**
 * Per-entity sparse-event parameters. NO rng draws: the scattered offset is a
 * fixed low-discrepancy (golden-ratio) sequence over the entity index, so
 * declaring `emit` never disturbs this layer's — or any later layer's —
 * seeded stream, and the same spec times its events identically under every
 * seed (event timing is composition, like a grid, not scatter). `jitter`
 * blends an even stagger (entity i at i/n of the period — a metronome) with
 * that scattered offset.
 */
function emitParams(
  emit: NonNullable<LayerSpec['emit']>,
  i: number,
  n: number,
): NonNullable<Entity['emit']> {
  const every = emit.every;
  const jitter = Math.max(0, Math.min(1, emit.jitter ?? 1));
  const scattered = (((i + 0.5) * GOLDEN) % 1) * every;
  const even = (i / Math.max(1, n)) * every;
  const phase = ((even * (1 - jitter) + scattered * jitter) % every + every) % every;
  return {
    every,
    life: Math.min(emit.life, every),
    phase,
    growFrom: emit.grow?.[0] ?? 1,
    growTo: emit.grow?.[1] ?? 1,
  };
}

/** Weighted index pick from a single uniform draw. Weights are validated positive. */
function weightedIndex(u: number, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]! / total;
    if (u < acc) return i;
  }
  return weights.length - 1;
}

/** Deterministically place a layer's entities using the seeded RNG (never Math.random).
 *  `scale` multiplies every dimensional draw (default 1). Used for viewport units.
 *  `countScale` multiplies entity count for density-aware scaling (default 1). */
export function buildEntities(layer: LayerSpec, rng: Rng, w: number, h: number, scale = 1, countScale = 1): Entity[] {
  // Grid layers are EXEMPT from count scaling. A grid is an exact lattice —
  // columns × rows, authored cell by cell — and scaling its count doesn't thin
  // it like a scatter field, it TRUNCATES it row-major: the last cells simply
  // never spawn. Found live (Entablature, 2026-08-14): on a viewport at
  // countScale ≈ 0.67, an 18-column single-row grid rendered 12 cells and died
  // at two-thirds width, while the analytic perception path (countScale 1)
  // showed it full-width — a renderer-vs-perception split that burned four
  // publishes to isolate. Upscaling is equally wrong: it invents phantom cells
  // beyond the authored lattice. Grid cost is already bounded by maxPerLayer.
  const effectiveCount = countScale === 1 || layer.layout !== undefined
    ? layer.count
    : Math.max(1, Math.min(
        Math.round(layer.count * countScale),
        layer.links ? LIMITS.maxLinkLayerCount : LIMITS.maxPerLayer,
      ));
  // Defaults are authored as their 1080p-equivalent viewport fractions. Using
  // the legacy px defaults directly would multiply 20..40 by the viewport.
  const defaultSize = scale === 1
    ? [20, 40] as const
    : [20 / LIMITS.referenceViewport, 40 / LIMITS.referenceViewport] as const;
  const [smin, smax] = layer.size ?? defaultSize;
  const variants = spriteVariants(layer.sprite);
  const sprite = layer.sprite;
  const spriteColors = isShapedSprite(sprite) ? sprite.colors : undefined;
  const colorWeights = isShapedSprite(sprite) ? sprite.colorWeights : undefined;
  const colorsLen = spriteColors?.length ?? 0;
  const cycle: CycleSpec | undefined = (sprite.kind === 'emoji' || sprite.kind === 'text') ? sprite.cycle : undefined;

  // Layer-level draws for new motion types happen BEFORE the entity loop, guarded by
  // the motion type so pre-existing specs keep bit-identical entity streams.
  const mSpec = layer.motion;
  let sharedOsc: WanderOsc | null = null;
  let meanderPx = 0;
  if (mSpec.type === 'wander') {
    meanderPx = (mSpec.meander ?? (scale === 1 ? 60 : 0.05)) * scale;
    sharedOsc = drawOsc(rng, meanderPx);
  }
  let pathPts: Array<{ x: number; y: number }> | null = null;
  if (mSpec.type === 'path') {
    pathPts = mSpec.points.map((p) => ({ x: p.x * w, y: p.y * h }));
  }
  const ease = (mSpec.type === 'drift' || mSpec.type === 'rise' || mSpec.type === 'wander') ? mSpec.ease : undefined;
  const clockPhase = layer.clock ? ((layer.clock.phase ?? 0) % 1) * Math.PI * 2 : 0;

  // Grid layout geometry (pure — no draws).
  const layout = layer.layout;
  // Data layouts (list / table): reading order from an anchor, no scatter.
  const ordered = layout?.type === 'list' || layout?.type === 'table';
  let gapX = 0;
  let gapY = 0;
  let listX0 = 0;
  let listY0 = 0;
  let listCols = 1;
  if (layout?.type === 'list' || layout?.type === 'table') {
    const dflt = scale === 1 ? LIMITS.defaultListGapPx : LIMITS.defaultListGap;
    const g = layout.gap ?? dflt;
    gapX = (typeof g === 'number' ? g : g.x ?? dflt) * scale;
    gapY = (typeof g === 'number' ? g : g.y ?? dflt) * scale;
    listCols = layout.type === 'list' ? 1 : Math.max(1, Math.round(layout.columns));
    const rows = Math.max(1, Math.ceil(effectiveCount / listCols));
    if (layer.position) {
      listX0 = layer.position.x * w;
      listY0 = layer.position.y * h;
    } else {
      const [rx0, rx1] = layer.region?.x ?? [0, 1];
      const [ry0, ry1] = layer.region?.y ?? [0, 1];
      listX0 = ((rx0 + rx1) / 2) * w - ((listCols - 1) * gapX) / 2;
      listY0 = ((ry0 + ry1) / 2) * h - ((rows - 1) * gapY) / 2;
    }
  }
  let gridCols = 0;
  let cellW = 0;
  let cellH = 0;
  let gridX0 = 0;
  let gridY0 = 0;
  if (layout?.type === 'grid') {
    const [rx0, rx1] = layer.region?.x ?? [0, 1];
    const [ry0, ry1] = layer.region?.y ?? [0, 1];
    const gw = Math.max(1, (rx1 - rx0) * w);
    const gh = Math.max(1, (ry1 - ry0) * h);
    gridCols = Math.min(
      layout.columns ?? Math.max(1, Math.round(Math.sqrt(effectiveCount * (gw / gh)))),
      LIMITS.maxGridColumns,
    );
    const gridRows = Math.max(1, Math.ceil(effectiveCount / gridCols));
    cellW = gw / gridCols;
    cellH = gh / gridRows;
    gridX0 = rx0 * w;
    gridY0 = ry0 * h;
  }

  const out: Entity[] = [];
  for (let i = 0; i < effectiveCount; i++) {
    const size =
      sprite.kind === 'textBlock'
        ? sprite.fontSize * scale
        : sprite.kind === 'circle' || sprite.kind === 'ring' || sprite.kind === 'polygon'
          ? rng.range(sprite.radius[0], sprite.radius[1]) * 2 * scale
          : sprite.kind === 'streak' || sprite.kind === 'stroke'
            ? rng.range(sprite.length[0], sprite.length[1]) * scale
            : sprite.kind === 'rect'
              ? rng.range(sprite.width[0], sprite.width[1]) * scale
              : sprite.kind === 'bar'
                ? sprite.length * scale
                : rng.range(smin, smax) * scale;
    // Guarded extra draw: only rect sprites with an aspect range consume it.
    const size2 = sprite.kind === 'rect'
      ? size * (sprite.aspect ? rng.range(sprite.aspect[0], sprite.aspect[1]) : 1)
      : sprite.kind === 'bar'
        ? sprite.thickness * scale
        : undefined;

    let vx = 0;
    let vy = 0;
    let bob = 0;
    let motion: Entity['motion'] = 'drift';
    let warpParams: Entity['warp'];
    let pathPhase = 0;
    let pathOffX = 0;
    let pathOffY = 0;
    const m = layer.motion;
    if (m.type === 'static') {
      motion = 'static';
    } else if (m.type === 'drift') {
      const s = rng.range(m.speed[0], m.speed[1]) * scale;
      let angle = ((m.angle ?? 0) * Math.PI) / 180;
      if (m.bidirectional && rng.next() < 0.5) angle = Math.PI - angle;
      vx = s * Math.cos(angle);
      vy = s * Math.sin(angle);
      bob = (m.bob ?? 0) * scale;
    } else if (m.type === 'rise') {
      motion = 'rise';
      vy = -rng.range(m.speed[0], m.speed[1]) * scale; // upward
      bob = (m.sway ?? 0) * scale;
    } else if (m.type === 'bounce') {
      motion = 'bounce';
      const s = rng.range(m.speed[0], m.speed[1]) * scale;
      const a = rng.range(0, Math.PI * 2);
      vx = s * Math.cos(a);
      vy = s * Math.sin(a);
    } else if (m.type === 'orbit') {
      motion = 'orbit';
      vx = rng.range(m.speed[0], m.speed[1]); // angular speed in deg/sec, stored in vx (not scaled)
    } else if (m.type === 'wander') {
      motion = 'wander';
      const s = rng.range(m.speed[0], m.speed[1]) * scale;
      const heading = m.angle !== undefined ? (m.angle * Math.PI) / 180 : rng.range(0, Math.PI * 2);
      vx = s * Math.cos(heading);
      vy = s * Math.sin(heading);
    } else if (m.type === 'warp') {
      motion = 'warp';
      const vz = rng.range(m.speed[0], m.speed[1]); // depth-units/sec (not scaled)
      const theta = rng.range(0, Math.PI * 2);
      const r = rng.range(0.15, 1); // radial offset in the projection plane
      warpParams = {
        ux: Math.cos(theta) * r,
        uy: Math.sin(theta) * r,
        z0: rng.range(WARP_NEAR, 1),
        vz,
        cx: (m.center?.x ?? 0.5) * w,
        cy: (m.center?.y ?? 0.5) * h,
      };
    } else if (m.type === 'path') {
      motion = 'path';
      pathPhase = rng.next();
      if (m.scatter) {
        pathOffX = rng.range(-1, 1) * m.scatter * scale;
        pathOffY = rng.range(-1, 1) * m.scatter * scale;
      }
    }

    let x0: number;
    let y0: number;
    if (layer.position && layer.count === 1) {
      x0 = layer.position.x * w;
      y0 = layer.position.y * h;
    } else if (layout?.type === 'list' || layout?.type === 'table') {
      // Reading order from the anchor. Burn the two scatter draws so toggling a
      // data layout on or off leaves the rest of this layer's stream intact.
      rng.next();
      rng.next();
      x0 = listX0 + (i % listCols) * gapX;
      y0 = listY0 + Math.floor(i / listCols) * gapY;
    } else if (layout?.type === 'grid') {
      // Grid cells row-major; same 2-draw budget as scatter so toggling layout
      // shifts only THIS layer's stream (layout is structural — rebuild anyway).
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);
      const j = layout.jitter ?? 0;
      const jx = typeof j === 'number' ? j : j.x ?? 0;
      const jy = typeof j === 'number' ? j : j.y ?? 0;
      x0 = gridX0 + (col + 0.5) * cellW + rng.range(-0.5, 0.5) * jx * cellW;
      y0 = gridY0 + (row + 0.5) * cellH + rng.range(-0.5, 0.5) * jy * cellH;
    } else {
      // Spawn window defaults to the full viewport. IMPORTANT (determinism/compat):
      // optional features must only consume EXTRA rng draws when declared, so specs
      // written before a feature existed keep bit-identical entity streams.
      const [rx0, rx1] = layer.region?.x ?? [0, 1];
      const [ry0, ry1] = layer.region?.y ?? [0, 1];
      x0 = rng.range(rx0 * w, rx1 * w);
      y0 = rng.range(ry0 * h, ry1 * h);
    }

    const orbitParent = m.type === 'orbit' && m.center && 'layer' in m.center ? m.center.layer : undefined;

    out.push({
      x0,
      y0,
      size,
      // Data layouts read variants in order — strings[i] beside bar i. The
      // seeded draw is still consumed so a layout is placement only: toggling
      // list/table never disturbs the layer's alpha, pulse or spin stream.
      spriteIndex: variants > 1 ? (ordered ? (rng.int(0, variants - 1), i % variants) : rng.int(0, variants - 1)) : 0,
      phase: rng.range(0, Math.PI * 2),
      vx,
      vy,
      bob,
      motion,
      headingLeft: vx < 0,
      alpha: layer.alpha ? rng.range(layer.alpha[0], layer.alpha[1]) : 1,
      pulseAmp: layer.pulse?.amp ?? 0,
      pulsePeriod: layer.pulse?.period ?? 1000,
      pulsePhase: layer.pulse ? rng.range(0, Math.PI * 2) : 0,
      // New draws AFTER pulsePhase — guarded so existing specs keep identical streams.
      // Scalar spin: no draw here, one phase draw below (unchanged). Range spin
      // (new): one seeded speed draw here, then the phase draw — array form is new
      // so the extra draw can't perturb any existing spec's entity stream.
      spinSpeed:
        typeof layer.spin === 'number'
          ? (layer.spin * Math.PI) / 180 // deg/sec → rad/sec
          : Array.isArray(layer.spin)
            ? (rng.range(layer.spin[0], layer.spin[1]) * Math.PI) / 180
            : 0,
      spinPhase: layer.spin ? rng.range(0, Math.PI * 2) : 0,
      growAmp: layer.grow?.amp ?? 0,
      growPeriod: layer.grow?.period ?? 1000,
      growPhase: layer.grow ? rng.range(0, Math.PI * 2) : 0,
      orbitR: m.type === 'orbit' ? rng.range(m.radius[0], m.radius[1]) * scale : 0,
      orbitCx: m.type === 'orbit' && !orbitParent ? ((m.center as { x?: number } | undefined)?.x ?? 0.5) * w : 0,
      orbitCy: m.type === 'orbit' && !orbitParent ? ((m.center as { y?: number } | undefined)?.y ?? 0.5) * h : 0,
      // New draws AFTER orbit — guarded so existing specs keep identical streams.
      colorIndex: colorsLen > 0
        ? (colorWeights && colorWeights.length === colorsLen
            ? weightedIndex(rng.next(), colorWeights)
            : ordered
              ? (rng.int(0, colorsLen - 1), i % colorsLen) // data layouts: palette in reading order; draw burned for stream parity
              : rng.int(0, colorsLen - 1))
        : -1,
      cyclePeriod: cycle ? cycle.period : 0,
      // Optional feature fields last (guarded draws inside — wander draws 18 here).
      ...(size2 !== undefined ? { size2 } : {}),
      ...(sprite.kind === 'bar' ? { barIndex: i } : {}),
      ...(ordered ? { ordered: true as const } : {}),
      ...(orbitParent ? { orbitParent } : {}),
      ...(layer.wrap === false ? { wrapDisabled: true as const } : {}),
      ...(m.type === 'wander'
        ? {
            wander: {
              own: drawOsc(rng, meanderPx),
              shared: sharedOsc!,
              coherence: Math.max(0, Math.min(1, m.coherence ?? 0)),
              margin: meanderPx * (OCT_AMP[0]! + OCT_AMP[1]! + OCT_AMP[2]!) * 1.4,
            },
          }
        : {}),
      ...(warpParams ? { warp: warpParams } : {}),
      ...(m.type === 'path' && pathPts
        ? {
            path: {
              pts: pathPts,
              duration: m.duration,
              closed: m.closed !== false,
              smooth: m.curve !== 'linear',
              phase: pathPhase,
              offX: pathOffX,
              offY: pathOffY,
            },
          }
        : {}),
      // Time-structure fields (2026-09): ease draws nothing; emit's one draw
      // per entity happens in a pass AFTER this loop (see below).
      ...(ease ? { ease: { type: ease.type, tau: ease.tau } } : {}),
    });

    if (layer.clock) {
      // Phase-lock: the seeded pulse/grow phases were drawn above (stream
      // stays put); the shared phase replaces them here. Cycle gets its own
      // field — `phase` also drives bob/sway/orbit, which must stay per-entity.
      const ent = out[out.length - 1]!;
      ent.pulsePhase = clockPhase;
      ent.growPhase = clockPhase;
      ent.cyclePhase = clockPhase;
      ent.clockRate = layer.clock.rate ?? 1;
    }
    if (layer.pulse?.wave) {
      // Position-derived phase: sin(ωt + phase) becomes a traveling wave along
      // `angle`. Patched AFTER the push so the seeded pulsePhase draw stays in its
      // historical stream position (toggling wave must not shift other draws).
      // A clock's phase offsets the wave rather than flattening it.
      const wl = Math.max(1e-6, layer.pulse.wave.wavelength * scale);
      const ang = ((layer.pulse.wave.angle ?? 0) * Math.PI) / 180;
      out[out.length - 1]!.pulsePhase = clockPhase - ((x0 * Math.cos(ang) + y0 * Math.sin(ang)) / wl) * Math.PI * 2;
    }
  }
  if (layer.emit) {
    // Assigned after the loop and without any rng draw (see emitParams), so
    // toggling `emit` rearranges nothing — not this layer, not the ones after.
    for (let i = 0; i < out.length; i++) out[i]!.emit = emitParams(layer.emit, i, out.length);
  }
  return out;
}

/** Depth of a warp entity at time t: wraps from far (1) to near (WARP_NEAR). Pure. */
function warpZ(e: Entity, t: number): number {
  const wp = e.warp!;
  return wrap(wp.z0 - wp.vz * (t / 1000), WARP_NEAR, 1);
}

function smoothstep(x: number): number {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

/** Fraction of an emit window spent fading in; the rest fades out. */
const EMIT_ATTACK = 0.25;

/**
 * Where entity `e` sits in its current emit window at time `t`: 0..1 across
 * the visible `life` ms, or null while dark (or when the layer has no `emit`).
 * Pure — the window index is `floor((t - phase) / every)`, no state.
 */
export function emitWindow(e: Entity, t: number): number | null {
  const em = e.emit;
  if (!em) return null;
  const local = (((t - em.phase) % em.every) + em.every) % em.every;
  return local < em.life ? local / em.life : null;
}

/** Alpha envelope across an emit window: fast smooth attack, slow smooth decay. */
export function emitEnvelope(u: number): number {
  if (u < 0 || u >= 1) return 0;
  return u < EMIT_ATTACK ? smoothstep(u / EMIT_ATTACK) : 1 - smoothstep((u - EMIT_ATTACK) / (1 - EMIT_ATTACK));
}

/** Scene time as the layer's clock sees it (pulse/grow/cycle only). */
function clockTime(e: Entity, t: number): number {
  return e.clockRate ? t * e.clockRate : t;
}

/**
 * Seconds of travel at time `t` for the velocity-integral motions. Identity
 * without `ease`. `settle`: τ(1 − e^(−t/τ)) — decelerates to rest having
 * travelled speed·τ. `buoyant`: t − τ(1 − e^(−t/τ)) — from rest to terminal
 * speed. With `emit`, t is window-local so every event restarts the travel.
 */
function motionSeconds(e: Entity, t: number): number {
  if (!e.ease) return t / 1000;
  let tl = t;
  if (e.emit) tl = (((t - e.emit.phase) % e.emit.every) + e.emit.every) % e.emit.every;
  const tau = e.ease.tau;
  const k = 1 - Math.exp(-tl / tau);
  return (e.ease.type === 'settle' ? tau * k : tl - tau * k) / 1000;
}

/** Analytic opacity of an entity at logical time `t` (ms). Pure, clamped to 0..1. */
export function alphaAt(e: Entity, t: number): number {
  let a = e.alpha;
  if (e.pulseAmp) a = e.alpha + e.pulseAmp * Math.sin((clockTime(e, t) * 2 * Math.PI) / e.pulsePeriod + e.pulsePhase);
  if (e.motion === 'warp') {
    // Fade in over the first 20% of depth after respawning at the far plane,
    // masking the wrap pop-in.
    const z = warpZ(e, t);
    a *= Math.max(0, Math.min(1, (1 - z) / 0.2));
  }
  if (e.emit) {
    const u = emitWindow(e, t);
    a = u === null ? 0 : a * emitEnvelope(u);
  }
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/** Analytic size multiplier at time `t` (ms). Pure, clamped to > 0. */
export function sizeAt(e: Entity, t: number): number {
  let s = e.size;
  if (e.growAmp) s = e.size * (1 + e.growAmp * Math.sin((clockTime(e, t) * 2 * Math.PI) / e.growPeriod + e.growPhase));
  if (e.motion === 'warp') s *= Math.min(1 / warpZ(e, t), WARP_MAX_SCALE);
  if (e.emit && (e.emit.growFrom !== 1 || e.emit.growTo !== 1)) {
    const u = emitWindow(e, t);
    if (u !== null) s *= e.emit.growFrom + (e.emit.growTo - e.emit.growFrom) * u;
  }
  return s > 0 ? s : 0.1;
}

/** Analytic rotation angle at time `t` (ms) in radians. Pure. */
export function rotationAt(e: Entity, t: number): number {
  if (!e.spinSpeed) return 0;
  return e.spinPhase + e.spinSpeed * (t / 1000);
}

/** Layer lifecycle alpha multiplier at time `t` (ms). Pure. 1 when `life` is unset. */
export function lifeAlphaAt(life: { enter?: number; exit?: number; fade?: number } | undefined, t: number): number {
  if (!life) return 1;
  const fade = life.fade ?? 1000;
  let a = 1;
  if (life.enter !== undefined) {
    if (t < life.enter) return 0;
    a = fade > 0 ? Math.min(1, (t - life.enter) / fade) : 1;
  }
  if (life.exit !== undefined && t >= life.exit) {
    a *= fade > 0 ? Math.max(0, 1 - (t - life.exit) / fade) : 0;
  }
  return a;
}

function wrap(v: number, min: number, max: number): number {
  const range = max - min;
  return ((((v - min) % range) + range) % range) + min;
}

function reflect(v: number, min: number, max: number): number {
  const range = max - min;
  if (range <= 0) return min;
  const period = 2 * range;
  const p = (((v - min) % period) + period) % period;
  return min + (p < range ? p : period - p);
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

function pathPosition(e: Entity, t: number): { x: number; y: number } {
  const p = e.path!;
  const n = p.pts.length;
  let s = ((t / p.duration) + p.phase) % 1;
  if (s < 0) s += 1;
  if (!p.closed) {
    // Ping-pong so open paths reverse smoothly instead of teleporting.
    const pp = s * 2;
    s = pp < 1 ? pp : 2 - pp;
  }
  const segs = p.closed ? n : n - 1;
  const u = Math.min(s * segs, segs - 1e-9);
  const i = Math.floor(u);
  const local = u - i;
  const at = (k: number): { x: number; y: number } =>
    p.closed ? p.pts[((k % n) + n) % n]! : p.pts[Math.max(0, Math.min(n - 1, k))]!;
  const p1 = at(i);
  const p2 = at(i + 1);
  if (!p.smooth) {
    return {
      x: p1.x + (p2.x - p1.x) * local + p.offX,
      y: p1.y + (p2.y - p1.y) * local + p.offY,
    };
  }
  const p0 = at(i - 1);
  const p3 = at(i + 2);
  return {
    x: catmullRom(p0.x, p1.x, p2.x, p3.x, local) + p.offX,
    y: catmullRom(p0.y, p1.y, p2.y, p3.y, local) + p.offY,
  };
}

/** Analytic position of an entity at logical time `t` (ms). Pure & deterministic. */
export function positionAt(e: Entity, t: number, w: number, h: number): Placed {
  if (e.motion === 'static') return { x: e.x0, y: e.y0, flip: false };
  if (e.motion === 'orbit') {
    const angle = e.phase + (e.vx * Math.PI / 180) * (t / 1000);
    return {
      x: e.orbitCx + e.orbitR * Math.cos(angle),
      y: e.orbitCy + e.orbitR * Math.sin(angle),
      flip: false,
    };
  }
  if (e.motion === 'warp') {
    const wp = e.warp!;
    const persp = 1 / warpZ(e, t);
    const halfMin = Math.min(w, h) / 2;
    return {
      x: wp.cx + wp.ux * halfMin * persp,
      y: wp.cy + wp.uy * halfMin * persp,
      flip: false,
    };
  }
  if (e.motion === 'path') {
    const pos = pathPosition(e, t);
    return { x: pos.x, y: pos.y, flip: false };
  }
  const dt = motionSeconds(e, t);
  const m = e.size;
  if (e.motion === 'bounce') {
    return {
      x: reflect(e.x0 + e.vx * dt, m / 2, w - m / 2),
      y: reflect(e.y0 + e.vy * dt, m / 2, h - m / 2),
      flip: false,
    };
  }
  if (e.motion === 'rise') {
    const y = e.y0 + e.vy * dt;
    return {
      x: e.x0 + (e.bob ? e.bob * Math.sin(t / 700 + e.phase) : 0),
      y: e.wrapDisabled ? y : wrap(y, -m, h + m),
      flip: false,
    };
  }
  if (e.motion === 'wander') {
    const wp = e.wander!;
    const c = wp.coherence;
    let hx = 0;
    let hy = 0;
    for (let i = 0; i < 3; i++) {
      if (c < 1) {
        hx += (1 - c) * wp.own.ax[i]! * Math.sin(wp.own.fx[i]! * t + wp.own.phx[i]!);
        hy += (1 - c) * wp.own.ay[i]! * Math.sin(wp.own.fy[i]! * t + wp.own.phy[i]!);
      }
      if (c > 0) {
        hx += c * wp.shared.ax[i]! * Math.sin(wp.shared.fx[i]! * t + wp.shared.phx[i]!);
        hy += c * wp.shared.ay[i]! * Math.sin(wp.shared.fy[i]! * t + wp.shared.phy[i]!);
      }
    }
    const margin = m + wp.margin;
    const x = e.x0 + e.vx * dt + hx;
    const y = e.y0 + e.vy * dt + hy;
    return {
      x: e.wrapDisabled ? x : wrap(x, -margin, w + margin),
      y: e.wrapDisabled ? y : wrap(y, -margin, h + margin),
      flip: e.headingLeft,
    };
  }
  // drift
  const rawX = e.x0 + e.vx * dt;
  const x = e.wrapDisabled ? rawX : wrap(rawX, -m, w + m);
  const rawY = e.y0 + e.vy * dt;
  let y = e.vy !== 0 && !e.wrapDisabled ? wrap(rawY, -m, h + m) : rawY;
  if (e.bob) y += e.bob * Math.sin(t / 500 + e.phase);
  return { x, y, flip: e.headingLeft };
}

/**
 * Analytic heading (radians) at time `t`, from a finite difference of positionAt.
 * Used to orient streak sprites. Returns null across a wrap seam (position jump
 * larger than half the viewport) — callers should skip orientation that frame.
 */
export function headingAt(e: Entity, t: number, w: number, h: number): number | null {
  const dtMs = 32;
  const t1 = t < dtMs ? t + dtMs : t;
  const t0 = t1 - dtMs;
  const a = positionAt(e, t0, w, h);
  const b = positionAt(e, t1, w, h);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > w / 2 || Math.abs(dy) > h / 2) return null;
  if (dx === 0 && dy === 0) return null;
  return Math.atan2(dy, dx);
}

/** Time-varying sprite index for text/emoji cycling. Returns static index when cyclePeriod is 0. */
export function spriteIndexAt(e: Entity, t: number, variants: number): number {
  if (!e.cyclePeriod || variants <= 1) return e.spriteIndex;
  // Under a data layout the rows keep their reading order and advance in
  // step — a marquee — instead of each entity cycling from its own phase.
  if (e.ordered) return (e.spriteIndex + Math.floor(clockTime(e, t) / e.cyclePeriod)) % variants;
  return Math.floor(clockTime(e, t) / e.cyclePeriod + (e.cyclePhase ?? e.phase) / (2 * Math.PI)) % variants;
}

/** An inter-entity link edge with its (wrap-aware) distance, for falloff alpha. */
export interface LinkEdge {
  i: number;
  j: number;
  dist: number;
}

function wrapDist(
  pi: { x: number; y: number },
  pj: { x: number; y: number },
  doWrap: boolean,
  w: number,
  h: number,
): number {
  let dx = pj.x - pi.x;
  let dy = pj.y - pi.y;
  if (doWrap) {
    if (Math.abs(dx) > w / 2) dx = dx > 0 ? dx - w : dx + w;
    if (Math.abs(dy) > h / 2) dy = dy > 0 ? dy - h : dy + h;
  }
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Edge list for a layer's `links`, dispatching on mode:
 * 'nearest' (default) k-nearest within maxDist; 'chain' sequential order
 * (Mystify — ignores k/maxDist, `closed` joins last to first); 'random' a fixed
 * golden-ratio-stride wiring filtered by maxDist (deterministic, no RNG draws).
 */
export function linkEdges(
  links: { k: number; maxDist: number; mode?: 'nearest' | 'chain' | 'random'; closed?: boolean },
  positions: Array<{ x: number; y: number }>,
  maxDistPx: number,
  doWrap: boolean,
  w: number,
  h: number,
): LinkEdge[] {
  const n = positions.length;
  const mode = links.mode ?? 'nearest';
  if (mode === 'chain') {
    const out: LinkEdge[] = [];
    for (let i = 0; i < n - 1; i++) {
      out.push({ i, j: i + 1, dist: wrapDist(positions[i]!, positions[i + 1]!, doWrap, w, h) });
    }
    if (links.closed && n > 2) out.push({ i: n - 1, j: 0, dist: wrapDist(positions[n - 1]!, positions[0]!, doWrap, w, h) });
    return out;
  }
  if (mode === 'random') {
    const stride = Math.max(1, Math.round(n * 0.381966)); // golden-ratio conjugate — spreads partners
    const edges = new Set<string>();
    const out: LinkEdge[] = [];
    for (let i = 0; i < n; i++) {
      for (let mIdx = 1; mIdx <= links.k; mIdx++) {
        const j = (i + mIdx * stride) % n;
        if (j === i) continue;
        const dist = wrapDist(positions[i]!, positions[j]!, doWrap, w, h);
        if (dist > maxDistPx) continue;
        const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
        if (!edges.has(key)) {
          edges.add(key);
          out.push({ i: Math.min(i, j), j: Math.max(i, j), dist });
        }
      }
    }
    return out;
  }
  return linkPairs(positions, links.k, maxDistPx, doWrap, w, h).map(([i, j]) => ({
    i,
    j,
    dist: wrapDist(positions[i]!, positions[j]!, doWrap, w, h),
  }));
}

/** K-nearest-neighbor edge list. Deterministic tie-break: (dist, index).
 *  When `doWrap` is true, uses toroidal distance so links don't streak across wrap seams. */
export function linkPairs(
  positions: Array<{ x: number; y: number }>,
  k: number,
  maxDist: number,
  doWrap: boolean,
  w: number,
  h: number,
): Array<[number, number]> {
  const n = positions.length;
  const edges = new Set<string>();
  const out: Array<[number, number]> = [];

  for (let i = 0; i < n; i++) {
    const pi = positions[i]!;
    const neighbors: Array<{ dist: number; j: number }> = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const pj = positions[j]!;
      let dx = pj.x - pi.x;
      let dy = pj.y - pi.y;
      if (doWrap) {
        if (Math.abs(dx) > w / 2) dx = dx > 0 ? dx - w : dx + w;
        if (Math.abs(dy) > h / 2) dy = dy > 0 ? dy - h : dy + h;
      }
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= maxDist) neighbors.push({ dist, j });
    }
    neighbors.sort((a, b) => a.dist - b.dist || a.j - b.j);
    for (let ni = 0; ni < Math.min(k, neighbors.length); ni++) {
      const j = neighbors[ni]!.j;
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const key = `${lo}:${hi}`;
      if (!edges.has(key)) {
        edges.add(key);
        out.push([lo, hi]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic text-block line breaking
// ---------------------------------------------------------------------------

const CHAR_NARROW = new Set('iIljtf1!|.,;:\'"()[]{}');
const CHAR_WIDE = new Set('mwMWGOQD@%');

/**
 * Which advance table the line-breaker uses. `proportional` is the
 * character-class table below (the default, and the only table until
 * `textBlock.font` existed); `mono` is a uniform 0.6 em advance — the classic
 * monospace cell (Courier, Menlo, SF Mono all sit within a percent of it).
 */
export type TextMetricsClass = 'proportional' | 'mono';

const MONO_FAMILY_RE = /\b(?:ui-)?mono(?:space)?\b|courier|menlo|monaco|sfmono|consolas|inconsolata|fira\s*code|source\s*code|jetbrains|ibm\s*plex\s*mono|roboto\s*mono/i;

/**
 * Metrics class for a `textBlock.font` string: `mono` when the family names
 * a monospace face (the generic `monospace`, or a well-known fixed-pitch
 * family), else `proportional`. Absent font ⇒ proportional, as before.
 */
export function textMetricsClassFor(font?: string): TextMetricsClass {
  return font && MONO_FAMILY_RE.test(font) ? 'mono' : 'proportional';
}

const MONO_ADVANCE_EM = 0.6;

/**
 * Approximate glyph width as a fraction of em. Uses character-class buckets
 * so line breaks are identical across platforms (no measureText). The average
 * across Latin text lands near 0.55, close to perceive.ts's 0.62 heuristic
 * but with per-class refinement. Under `mono` every glyph (space included)
 * advances the same cell.
 */
function charWidthEm(ch: string, metrics: TextMetricsClass = 'proportional'): number {
  if (metrics === 'mono') return MONO_ADVANCE_EM;
  if (ch === ' ' || ch === '\t') return 0.3;
  if (CHAR_NARROW.has(ch)) return 0.35;
  if (CHAR_WIDE.has(ch)) return 0.72;
  return 0.55;
}

/**
 * Em-width of a string under the same character-class table `breakTextBlock`
 * uses. `mono` counts grapheme clusters, not UTF-16 code units — an emoji or
 * combining/ZWJ sequence is one advance-width cell, matching what's painted,
 * not one cell per surrogate half or combining mark.
 */
export function textWidthEm(str: string, metrics: TextMetricsClass = 'proportional'): number {
  if (metrics === 'mono') return graphemeClusters(str).length * MONO_ADVANCE_EM;
  let w = 0;
  for (let i = 0; i < str.length; i++) w += charWidthEm(str[i]!, metrics);
  return w;
}

export interface TextBlockLine {
  text: string;
  widthEm: number;
}

/**
 * Break `text` into lines that fit within `maxWidthEm` em-widths. Splits on
 * whitespace; a single word wider than the limit gets its own line unbroken.
 * Explicit `\n` always forces a break. Pure, deterministic, no canvas needed.
 */
export function breakTextBlock(text: string, maxWidthEm: number, metrics: TextMetricsClass = 'proportional'): TextBlockLine[] {
  const paragraphs = text.split('\n');
  const lines: TextBlockLine[] = [];

  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push({ text: '', widthEm: 0 });
      continue;
    }
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push({ text: '', widthEm: 0 });
      continue;
    }

    let lineText = words[0]!;
    let lineW = textWidthEm(lineText, metrics);
    const spaceW = charWidthEm(' ', metrics);

    for (let i = 1; i < words.length; i++) {
      const word = words[i]!;
      const wordW = textWidthEm(word, metrics);
      if (lineW + spaceW + wordW <= maxWidthEm) {
        lineText += ' ' + word;
        lineW += spaceW + wordW;
      } else {
        lines.push({ text: lineText, widthEm: lineW });
        lineText = word;
        lineW = wordW;
      }
    }
    lines.push({ text: lineText, widthEm: lineW });
  }

  return lines;
}

/**
 * Where an anchored textBlock's layout origin sits relative to `position`:
 * the (dx, dy) to ADD to `position` so that the named point of the rendered
 * text lands on it. The rendered box is the widest line wide (placed inside
 * the `maxWidth` box by `align`) and `lines × lineHeight` tall — so `anchor`
 * says where the block sits and `align` only shapes its ragged edge. Absent
 * anchor ⇒ (0, 0): `position` stays the layout box's top-left, exactly as
 * before the field existed. Renderer, perception and advisories all call
 * this, so their boxes agree by construction.
 */
export function textBlockAnchorOffset(
  s: { anchor?: TextBlockAnchor; align?: 'left' | 'center' | 'right' },
  maxWPx: number,
  maxLineW: number,
  totalH: number,
): { dx: number; dy: number } {
  if (!s.anchor) return { dx: 0, dy: 0 };
  const ax = s.anchor.endsWith('left') ? 0 : s.anchor.endsWith('right') ? 1 : 0.5;
  const ay = s.anchor.startsWith('top') ? 0 : s.anchor.startsWith('bottom') ? 1 : 0.5;
  // Ink left edge relative to the layout origin, as `align` places it.
  const inkX0 = s.align === 'center' ? (maxWPx - maxLineW) / 2 : s.align === 'right' ? maxWPx - maxLineW : 0;
  return { dx: -(inkX0 + ax * maxLineW), dy: -(ay * totalH) };
}

// ---------------------------------------------------------------------------
// Deterministic text reveal (textBlock `reveal` — typing/deleting)
// ---------------------------------------------------------------------------

// Combining/attaching code points that must never be painted without their
// base: combining diacritics, variation selectors, skin-tone modifiers,
// keycap. Deliberately a fixed table rather than Intl.Segmenter, which is
// not required to segment identically across engines — same philosophy (and
// same determinism reason) as the charWidthEm buckets above.
function isClusterExtend(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritics
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    (cp >= 0x1f3fb && cp <= 0x1f3ff) || // skin tones
    cp === 0x20e3 // combining enclosing keycap
  );
}

function isRegionalIndicator(cp: number): boolean {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

const ZWJ = 0x200d;

/**
 * Split a string into paint-safe grapheme clusters: surrogate pairs stay
 * whole, combining marks / variation selectors / skin tones attach to their
 * base, ZWJ joins sequences (emoji families), regional indicators pair up
 * (flags). Deterministic across engines by construction.
 */
export function graphemeClusters(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    let end = i + (cp > 0xffff ? 2 : 1);
    // Flag pair: two regional indicators form one cluster.
    if (isRegionalIndicator(cp) && end < text.length) {
      const next = text.codePointAt(end)!;
      if (isRegionalIndicator(next)) end += next > 0xffff ? 2 : 1;
    }
    // Attach extenders and ZWJ-joined sequences.
    while (end < text.length) {
      const next = text.codePointAt(end)!;
      if (isClusterExtend(next)) {
        end += next > 0xffff ? 2 : 1;
      } else if (next === ZWJ && end + 1 < text.length) {
        const after = text.codePointAt(end + 1)!;
        end += 1 + (after > 0xffff ? 2 : 1);
      } else {
        break;
      }
    }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

export interface TextRevealInput {
  progress?: number;
  mode?: 'typewriter' | 'word' | 'line' | 'glyphFade';
  speed?: number;
  fade?: number;
}

export interface RevealState {
  /** Effective 0..1 progress after combining authored progress and speed at t. */
  progress: number;
  /** Number of fully visible lines. */
  fullLines: number;
  /** Grapheme-safe visible prefix of the next line ('' when none). */
  partialText: string;
  /** Caret anchor: line index and the visible prefix on that line. */
  caretLine: number;
  caretPrefix: string;
  /**
   * `glyphFade` mode only: per-line per-grapheme alpha (0..1), indexed
   * parallel to `graphemeClusters(lines[i].text)`. Alphas only decrease in
   * reading order, so a renderer may stop at the first zero.
   */
  glyphAlphas?: number[][];
}

/**
 * Resolve which glyphs of a broken textBlock are visible at time `tMs`.
 * Pure function of (lines, reveal, tMs) — the renderer paints exactly this,
 * and perceive models exactly this, so agents and pixels agree. `speed` is
 * graphemes/sec regardless of mode; mode only quantizes the frontier.
 */
export function revealState(lines: TextBlockLine[], reveal: TextRevealInput, tMs: number): RevealState {
  const lineClusters = lines.map((l) => graphemeClusters(l.text));
  const totalGraphemes = lineClusters.reduce((n, c) => n + c.length, 0);

  const authored = Math.max(0, Math.min(1, reveal.progress ?? 1));
  const speed = reveal.speed ?? 0;
  const timed = speed > 0 && totalGraphemes > 0 ? Math.min(1, (speed * tMs) / 1000 / totalGraphemes) : 1;
  const progress = Math.min(authored, timed);

  const mode = reveal.mode ?? 'typewriter';
  let fullLines = 0;
  let partialText = '';

  // glyphFade: glyph g starts fading at (g/total)·(1−fade) and ramps to
  // opaque over a `fade`-wide window of progress, so every glyph is 0 at
  // progress 0 and 1 at progress 1. The frontier below (shared with
  // typewriter) still anchors the caret. Pure paint, like everything here.
  let glyphAlphas: number[][] | undefined;
  if (mode === 'glyphFade') {
    // The 0.01 floor is defensive only — validation already enforces the
    // public contract fade ∈ (0, 1] (FORMAT.md). It exists so direct callers
    // that skip validateSpec can't make the divide below infinite, not to
    // remap legal values: anything ≥ 0.01 passes through untouched.
    const f = Math.min(1, Math.max(0.01, reveal.fade ?? 0.15));
    let g = 0;
    glyphAlphas = lineClusters.map((clusters) =>
      clusters.map(() => {
        const start = totalGraphemes > 0 ? (g++ / totalGraphemes) * (1 - f) : 0;
        return Math.max(0, Math.min(1, (progress - start) / f));
      }),
    );
  }

  if (mode === 'line') {
    fullLines = Math.round(progress * lines.length);
  } else if (mode === 'word') {
    const lineWords = lines.map((l) => (l.text.length === 0 ? [] : l.text.split(' ')));
    const totalWords = lineWords.reduce((n, ws) => n + ws.length, 0);
    let remaining = Math.round(progress * totalWords);
    for (const ws of lineWords) {
      if (remaining >= ws.length) {
        remaining -= ws.length;
        fullLines++;
        // A zero-word (empty) line is "full" for free; keep consuming.
        continue;
      }
      if (remaining > 0) partialText = ws.slice(0, remaining).join(' ');
      break;
    }
  } else {
    let remaining = Math.round(progress * totalGraphemes);
    for (const clusters of lineClusters) {
      if (remaining >= clusters.length) {
        remaining -= clusters.length;
        fullLines++;
        continue;
      }
      if (remaining > 0) partialText = clusters.slice(0, remaining).join('');
      break;
    }
  }

  // Caret sits at the reveal frontier: end of the partial line, else end of
  // the last full line, else the start of the block.
  let caretLine: number;
  let caretPrefix: string;
  if (partialText.length > 0) {
    caretLine = fullLines;
    caretPrefix = partialText;
  } else if (fullLines > 0) {
    caretLine = fullLines - 1;
    caretPrefix = lines[fullLines - 1]!.text;
  } else {
    caretLine = 0;
    caretPrefix = '';
  }

  return { progress, fullLines, partialText, caretLine, caretPrefix, glyphAlphas };
}
