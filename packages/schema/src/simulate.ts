import type { Rng } from '@idle-screens/core';
import type { CycleSpec, LayerSpec, SpriteSpec } from './types';
import { LIMITS } from './types';

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
  /** Rect sprite second dimension (height px). Only set for rect sprites. */
  size2?: number;
  /** Orbit parent layer key (motion.center = { layer }). Center resolved at render time. */
  orbitParent?: string;
  /** Harmonic drift params. Only set for wander motion. */
  wander?: { own: WanderOsc; shared: WanderOsc; coherence: number; margin: number };
  /** Depth-axis params. Only set for warp motion. */
  warp?: { ux: number; uy: number; z0: number; vz: number; cx: number; cy: number };
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
  const effectiveCount = countScale === 1
    ? layer.count
    : Math.max(1, Math.min(
        Math.round(layer.count * countScale),
        layer.links ? LIMITS.maxLinkLayerCount : LIMITS.maxPerLayer,
      ));
  const [smin, smax] = layer.size ?? [20, 40];
  const variants = spriteVariants(layer.sprite);
  const sprite = layer.sprite;
  const spriteColors = (sprite.kind === 'circle' || sprite.kind === 'ring' || sprite.kind === 'streak' || sprite.kind === 'rect')
    ? sprite.colors
    : undefined;
  const colorWeights = (sprite.kind === 'circle' || sprite.kind === 'ring' || sprite.kind === 'streak' || sprite.kind === 'rect')
    ? sprite.colorWeights
    : undefined;
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

  // Grid layout geometry (pure — no draws).
  const layout = layer.layout;
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
      sprite.kind === 'circle' || sprite.kind === 'ring'
        ? rng.range(sprite.radius[0], sprite.radius[1]) * 2 * scale
        : sprite.kind === 'streak'
          ? rng.range(sprite.length[0], sprite.length[1]) * scale
          : sprite.kind === 'rect'
            ? rng.range(sprite.width[0], sprite.width[1]) * scale
            : rng.range(smin, smax) * scale;
    // Guarded extra draw: only rect sprites with an aspect range consume it.
    const size2 = sprite.kind === 'rect'
      ? size * (sprite.aspect ? rng.range(sprite.aspect[0], sprite.aspect[1]) : 1)
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
      spriteIndex: variants > 1 ? rng.int(0, variants - 1) : 0,
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
      spinSpeed: layer.spin ? (layer.spin * Math.PI) / 180 : 0, // deg/sec → rad/sec
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
            : rng.int(0, colorsLen - 1))
        : -1,
      cyclePeriod: cycle ? cycle.period : 0,
      // Optional feature fields last (guarded draws inside — wander draws 18 here).
      ...(size2 !== undefined ? { size2 } : {}),
      ...(orbitParent ? { orbitParent } : {}),
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
    });

    if (layer.pulse?.wave) {
      // Position-derived phase: sin(ωt + phase) becomes a traveling wave along
      // `angle`. Patched AFTER the push so the seeded pulsePhase draw stays in its
      // historical stream position (toggling wave must not shift other draws).
      const wl = Math.max(1e-6, layer.pulse.wave.wavelength * scale);
      const ang = ((layer.pulse.wave.angle ?? 0) * Math.PI) / 180;
      out[out.length - 1]!.pulsePhase = -((x0 * Math.cos(ang) + y0 * Math.sin(ang)) / wl) * Math.PI * 2;
    }
  }
  return out;
}

/** Depth of a warp entity at time t: wraps from far (1) to near (WARP_NEAR). Pure. */
function warpZ(e: Entity, t: number): number {
  const wp = e.warp!;
  return wrap(wp.z0 - wp.vz * (t / 1000), WARP_NEAR, 1);
}

/** Analytic opacity of an entity at logical time `t` (ms). Pure, clamped to 0..1. */
export function alphaAt(e: Entity, t: number): number {
  let a = e.alpha;
  if (e.pulseAmp) a = e.alpha + e.pulseAmp * Math.sin((t * 2 * Math.PI) / e.pulsePeriod + e.pulsePhase);
  if (e.motion === 'warp') {
    // Fade in over the first 20% of depth after respawning at the far plane,
    // masking the wrap pop-in.
    const z = warpZ(e, t);
    a *= Math.max(0, Math.min(1, (1 - z) / 0.2));
  }
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/** Analytic size multiplier at time `t` (ms). Pure, clamped to > 0. */
export function sizeAt(e: Entity, t: number): number {
  let s = e.size;
  if (e.growAmp) s = e.size * (1 + e.growAmp * Math.sin((t * 2 * Math.PI) / e.growPeriod + e.growPhase));
  if (e.motion === 'warp') s *= Math.min(1 / warpZ(e, t), WARP_MAX_SCALE);
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
  const dt = t / 1000;
  const m = e.size;
  if (e.motion === 'bounce') {
    return {
      x: reflect(e.x0 + e.vx * dt, m / 2, w - m / 2),
      y: reflect(e.y0 + e.vy * dt, m / 2, h - m / 2),
      flip: false,
    };
  }
  if (e.motion === 'rise') {
    return {
      x: e.x0 + (e.bob ? e.bob * Math.sin(t / 700 + e.phase) : 0),
      y: wrap(e.y0 + e.vy * dt, -m, h + m),
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
    return {
      x: wrap(e.x0 + e.vx * dt + hx, -margin, w + margin),
      y: wrap(e.y0 + e.vy * dt + hy, -margin, h + margin),
      flip: e.headingLeft,
    };
  }
  // drift
  const x = wrap(e.x0 + e.vx * dt, -m, w + m);
  let y = e.vy !== 0 ? wrap(e.y0 + e.vy * dt, -m, h + m) : e.y0;
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
  return Math.floor(t / e.cyclePeriod + e.phase / (2 * Math.PI)) % variants;
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
