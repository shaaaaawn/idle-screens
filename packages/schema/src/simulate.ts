import type { Rng } from '@idle-screens/core';
import type { LayerSpec, SpriteSpec } from './types';

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
  motion: 'drift' | 'rise' | 'bounce';
  headingLeft: boolean;
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

/** Deterministically place a layer's entities using the seeded RNG (never Math.random). */
export function buildEntities(layer: LayerSpec, rng: Rng, w: number, h: number): Entity[] {
  const [smin, smax] = layer.size ?? [20, 40];
  const variants = spriteVariants(layer.sprite);
  const out: Entity[] = [];
  for (let i = 0; i < layer.count; i++) {
    const size =
      layer.sprite.kind === 'circle'
        ? rng.range(layer.sprite.radius[0], layer.sprite.radius[1]) * 2
        : rng.range(smin, smax);

    let vx = 0;
    let vy = 0;
    let bob = 0;
    let motion: Entity['motion'] = 'drift';
    const m = layer.motion;
    if (m.type === 'drift') {
      const s = rng.range(m.speed[0], m.speed[1]);
      let angle = ((m.angle ?? 0) * Math.PI) / 180;
      if (m.bidirectional && rng.next() < 0.5) angle = Math.PI - angle;
      vx = s * Math.cos(angle);
      vy = s * Math.sin(angle);
      bob = m.bob ?? 0;
    } else if (m.type === 'rise') {
      motion = 'rise';
      vy = -rng.range(m.speed[0], m.speed[1]); // upward
      bob = m.sway ?? 0;
    } else {
      motion = 'bounce';
      const s = rng.range(m.speed[0], m.speed[1]);
      const a = rng.range(0, Math.PI * 2);
      vx = s * Math.cos(a);
      vy = s * Math.sin(a);
    }

    out.push({
      x0: rng.range(0, w),
      y0: rng.range(0, h),
      size,
      spriteIndex: variants > 1 ? rng.int(0, variants - 1) : 0,
      phase: rng.range(0, Math.PI * 2),
      vx,
      vy,
      bob,
      motion,
      headingLeft: vx < 0,
    });
  }
  return out;
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
