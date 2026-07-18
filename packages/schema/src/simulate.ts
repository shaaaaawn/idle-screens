import type { Rng } from '@idle-screens/core';
import type { CycleSpec, LayerSpec, SpriteSpec } from './types';

/** A seeded entity: initial state + resolved velocity. `positionAt` is a pure function
 *  of this + time, so the rAF loop and renderFrame(t) produce identical results. */
export interface Entity {
  x0: number;
  y0: number;
  size: number;
  spriteIndex: number;
  phase: number;
  vx: number; // px/sec
  vy: number; // px/sec
  bob: number; // vertical bob / horizontal sway amplitude (px)
  motion: 'drift' | 'rise' | 'bounce' | 'static' | 'orbit';
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
  colorIndex: number; // index into circle colors[] (-1 = use sprite.color)
  cyclePeriod: number; // ms (0 = no cycling)
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

/** Deterministically place a layer's entities using the seeded RNG (never Math.random).
 *  `scale` multiplies every dimensional draw (default 1). Used for viewport units. */
export function buildEntities(layer: LayerSpec, rng: Rng, w: number, h: number, scale = 1): Entity[] {
  const [smin, smax] = layer.size ?? [20, 40];
  const variants = spriteVariants(layer.sprite);
  const colorsLen = layer.sprite.kind === 'circle' && layer.sprite.colors ? layer.sprite.colors.length : 0;
  const cycle: CycleSpec | undefined = (layer.sprite.kind === 'emoji' || layer.sprite.kind === 'text') ? layer.sprite.cycle : undefined;
  const out: Entity[] = [];
  for (let i = 0; i < layer.count; i++) {
    const size =
      layer.sprite.kind === 'circle'
        ? rng.range(layer.sprite.radius[0], layer.sprite.radius[1]) * 2 * scale
        : rng.range(smin, smax) * scale;

    let vx = 0;
    let vy = 0;
    let bob = 0;
    let motion: Entity['motion'] = 'drift';
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
    }

    let x0: number;
    let y0: number;
    if (layer.position && layer.count === 1) {
      x0 = layer.position.x * w;
      y0 = layer.position.y * h;
    } else {
      // Spawn window defaults to the full viewport. IMPORTANT (determinism/compat):
      // optional features must only consume EXTRA rng draws when declared, so specs
      // written before a feature existed keep bit-identical entity streams.
      const [rx0, rx1] = layer.region?.x ?? [0, 1];
      const [ry0, ry1] = layer.region?.y ?? [0, 1];
      x0 = rng.range(rx0 * w, rx1 * w);
      y0 = rng.range(ry0 * h, ry1 * h);
    }

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
      orbitCx: m.type === 'orbit' ? (m.center?.x ?? 0.5) * w : 0,
      orbitCy: m.type === 'orbit' ? (m.center?.y ?? 0.5) * h : 0,
      // New draws AFTER orbit — guarded so existing specs keep identical streams.
      colorIndex: colorsLen > 0 ? rng.int(0, colorsLen - 1) : -1,
      cyclePeriod: cycle ? cycle.period : 0,
    });
  }
  return out;
}

/** Analytic opacity of an entity at logical time `t` (ms). Pure, clamped to 0..1. */
export function alphaAt(e: Entity, t: number): number {
  if (!e.pulseAmp) return e.alpha;
  const a = e.alpha + e.pulseAmp * Math.sin((t * 2 * Math.PI) / e.pulsePeriod + e.pulsePhase);
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/** Analytic size multiplier at time `t` (ms). Pure, clamped to > 0. */
export function sizeAt(e: Entity, t: number): number {
  if (!e.growAmp) return e.size;
  const s = e.size * (1 + e.growAmp * Math.sin((t * 2 * Math.PI) / e.growPeriod + e.growPhase));
  return s > 0 ? s : 0.1;
}

/** Analytic rotation angle at time `t` (ms) in radians. Pure. */
export function rotationAt(e: Entity, t: number): number {
  if (!e.spinSpeed) return 0;
  return e.spinPhase + e.spinSpeed * (t / 1000);
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
  // drift
  const x = wrap(e.x0 + e.vx * dt, -m, w + m);
  let y = e.vy !== 0 ? wrap(e.y0 + e.vy * dt, -m, h + m) : e.y0;
  if (e.bob) y += e.bob * Math.sin(t / 500 + e.phase);
  return { x, y, flip: e.headingLeft };
}

/** Time-varying sprite index for text/emoji cycling. Returns static index when cyclePeriod is 0. */
export function spriteIndexAt(e: Entity, t: number, variants: number): number {
  if (!e.cyclePeriod || variants <= 1) return e.spriteIndex;
  return Math.floor(t / e.cyclePeriod + e.phase / (2 * Math.PI)) % variants;
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
