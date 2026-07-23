import {
  createRng,
  type ControlTrack,
  type SaverContext,
  type SaverInstance,
  type SaverManifest,
  type SaverPlugin,
} from '@idle-screens/core';
import { assertValidSpec, validateSpec } from './validate';
import { alphaAt, buildEntities, headingAt, lifeAlphaAt, linkEdges, positionAt, rotationAt, sizeAt, spriteIndexAt, type Entity } from './simulate';
import {
  applyDeltasToSpec,
  easeSmooth,
  lerpSpec,
  structuralSignature,
  type SteerDelta,
} from './steer';
import type { LayerSpec, SaverSpec } from './types';
import { LIMITS } from './types';

const DEFAULT_STEER_DUR = 1000;

/** Expand #rgb/#rrggbb to an rgba() string — needed for gradient stops with alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Derive a manifest so a compiled spec composes with @idle-screens/capabilities. */
export function manifestFor(spec: SaverSpec): SaverManifest {
  const total = spec.layers.reduce((n, l) => n + l.count, 0);
  const costTier = total < 30 ? 'idle' : total < 150 ? 'low' : total < 400 ? 'medium' : 'high';
  return {
    id: spec.id,
    label: spec.label,
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

class SpecInstance implements SaverInstance {
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
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
  private transition: { from: SaverSpec; to: SaverSpec; startT: number; dur: number } | null = null;
  private lastStructural = '';

  constructor(
    private readonly spec: SaverSpec,
    ctx: SaverContext,
  ) {
    this.effSpec = spec;
    this.saverCtx = ctx;
    this.seed = ((spec.seed ?? ctx.seed) >>> 0) || 1;
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (ctx.surface) {
      canvas = ctx.surface;
    } else {
      const el = document.createElement('canvas');
      el.style.cssText = 'display:block;width:100%;height:100%';
      el.setAttribute('aria-hidden', 'true');
      ctx.host.appendChild(el);
      canvas = el;
    }
    this.canvas = canvas;
    const c2d = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!c2d) throw new Error('schema saver: no 2d context');
    this.ctx = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();
    this.rebuild();

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderFrame(0, this.seed);
    else this.start();
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.saverCtx.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Resizing clears the canvas — force a ghosting warm-up on the next frame.
    this.lastRenderT = Number.NEGATIVE_INFINITY;
  }

  /** (Re)seed and place all entities — deterministic for the seed + viewport. */
  private rebuild(): void {
    const rng = createRng(this.seed);
    const scale = this.effSpec.units === 'px' ? 1 : Math.min(this.w, this.h);
    const refVp = this.effSpec.referenceViewport ?? LIMITS.referenceViewport;
    let countScale = scale > 1 ? Math.min(this.w, this.h) / refVp : 1;
    if (countScale > 1) {
      const rawTotal = this.effSpec.layers.reduce((s, l) => s + Math.round(l.count * countScale), 0);
      if (rawTotal > LIMITS.maxTotal) countScale *= LIMITS.maxTotal / rawTotal;
    }
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
    const fade = trail.fade ?? 1;
    const n = Math.min(Math.ceil(trail.length / 50), LIMITS.maxTrailSamples);
    const headAlpha = alphaAt(e, t) * lifeA;
    const headSize = sizeAt(e, t);
    const sprite = built.layer.sprite;
    const resolvedColor = sprite.kind === 'circle' || sprite.kind === 'ring' || sprite.kind === 'streak' || sprite.kind === 'rect'
      ? (sprite.colors?.[e.colorIndex] ?? sprite.color)
      : sprite.kind === 'text' ? (sprite.color ?? '#e6e8ef') : '#e6e8ef';
    const isSoft = sprite.kind === 'circle' && sprite.soft;
    const wrap = built.layer.wrap !== false;

    const head = this.entityPos(e, t, parentE);
    let prevX = head.x;
    let prevY = head.y;

    for (let s = 1; s <= n; s++) {
      const k = s / n;
      const pastT = t - k * trail.length;
      if (pastT < 0) break;
      const pos = this.entityPos(e, pastT, parentE);

      if (wrap) {
        const dx = pos.x - prevX;
        const dy = pos.y - prevY;
        if (Math.abs(dx) > w / 2 || Math.abs(dy) > h / 2) break;
      }
      prevX = pos.x;
      prevY = pos.y;

      const a = headAlpha * (1 - k * fade);
      if (a <= 0) break;
      const r = (headSize / 2) * (1 - k * 0.7);
      if (r < 0.2) break;

      ctx.globalAlpha = a;
      if (isSoft) {
        const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, r);
        g.addColorStop(0, resolvedColor);
        g.addColorStop(0.35, hexToRgba(resolvedColor, 0.75));
        g.addColorStop(1, hexToRgba(resolvedColor, 0));
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = resolvedColor;
      }
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawEntity(built: Built, e: Entity, t: number, lifeA: number, parentE: Entity | null): void {
    const { ctx } = this;
    const p = this.entityPos(e, t, parentE);
    const sprite = built.layer.sprite;
    const sz = sizeAt(e, t);
    const rot = rotationAt(e, t);
    const unitScale = this.effSpec.units === 'px' ? 1 : Math.min(this.w, this.h);
    ctx.globalAlpha = alphaAt(e, t) * lifeA;
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
      const heading = headingAt(e, t, this.w, this.h) ?? 0;
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
      ctx.save();
      ctx.translate(p.x, p.y);
      if (rot) ctx.rotate(rot);
      ctx.fillStyle = resolvedColor;
      ctx.fillRect(-sz / 2, -rh / 2, sz, rh);
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
        ? (/\dpx/.test(sprite.font) ? sprite.font : `${sz}px ${sprite.font}`)
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
    this.effSpec = k >= 1 ? tr.to : lerpSpec(tr.from, tr.to, easeSmooth(k));
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
    if (this.paused) {
      // No frames will run the glide — jump straight to the target.
      this.transition = null;
      this.effSpec = target;
      if (structuralSignature(this.effSpec) !== this.lastStructural) this.rebuild();
      else this.layers.forEach((b, i) => { b.layer = this.effSpec.layers[i] ?? b.layer; });
      this.renderFrame(this.lastT, this.seed);
    }
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
    const maxDistPx = links.maxDist * (this.effSpec.units === 'px' ? 1 : Math.min(this.w, this.h));
    const edges = linkEdges(links, positions, maxDistPx, wrap, this.w, this.h);
    const lw = (links.width ?? 1) * (this.effSpec.units === 'px' ? 1 : Math.min(this.w, this.h));
    ctx.lineWidth = lw;
    ctx.lineCap = 'butt'; // streak sprites set 'round'; reset so link ends stay crisp

    for (const { i, j, dist } of edges) {
      const pi = positions[i]!;
      const pj = positions[j]!;
      const ei = built.entities[i]!;
      let resolvedColor = links.color;
      if (!resolvedColor) {
        const sprite = built.layer.sprite;
        if (sprite.kind === 'circle' || sprite.kind === 'ring' || sprite.kind === 'streak' || sprite.kind === 'rect') {
          resolvedColor = sprite.colors?.[ei.colorIndex] ?? sprite.color;
        } else resolvedColor = '#e6e8ef';
      }
      let a = links.alpha ?? alphaAt(ei, t);
      if (links.falloff) a *= Math.max(0, 1 - dist / maxDistPx);
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
    ctx.globalAlpha = bgAlpha;
    ctx.globalCompositeOperation = 'source-over';
    this.drawBackground(t);
    ctx.globalAlpha = 1;
    for (const built of this.layers) {
      const lifeA = lifeAlphaAt(built.layer.life, t);
      if (lifeA <= 0) continue;
      const parentE = this.parentEntityFor(built);
      ctx.globalCompositeOperation = built.layer.blend ?? 'source-over';
      this.drawLinks(built, t, lifeA, parentE);
      for (const e of built.entities) {
        this.drawTrail(built, e, t, lifeA, parentE);
        this.drawEntity(built, e, t, lifeA, parentE);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
    const g = this.effSpec.ghosting ?? 0;
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

  dispose(): void {
    this.stop();
    if (typeof HTMLCanvasElement !== 'undefined' && this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
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
    mount: (ctx: SaverContext) => new SpecInstance(valid, ctx),
    spec: valid,
  };
}
