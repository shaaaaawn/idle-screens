import {
  createRng,
  type ControlTrack,
  type SaverContext,
  type SaverInstance,
  type SaverManifest,
  type SaverPlugin,
} from '@idle-screens/core';
import { assertValidSpec } from './validate';
import { alphaAt, buildEntities, positionAt, type Entity } from './simulate';
import {
  applyDeltasToSpec,
  easeSmooth,
  lerpSpec,
  structuralSignature,
  type SteerDelta,
} from './steer';
import type { LayerSpec, SaverSpec } from './types';

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
  }

  /** (Re)seed and place all entities — deterministic for the seed + size. */
  private rebuild(): void {
    const rng = createRng(this.seed);
    this.layers = this.effSpec.layers.map((layer) => ({ layer, entities: buildEntities(layer, rng, this.w, this.h) }));
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

  private drawBackground(): void {
    const { ctx, w, h } = this;
    const bg = this.effSpec.background;
    if (!bg || bg.type === 'solid') {
      ctx.fillStyle = bg?.color ?? '#05050a';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const g = ctx.createLinearGradient(0, 0, 0, h);
    for (const s of bg.stops) g.addColorStop(Math.max(0, Math.min(1, s.at)), s.color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (bg.band) {
      ctx.fillStyle = bg.band.color;
      ctx.fillRect(0, h - bg.band.height, w, bg.band.height);
    }
  }

  private drawEntity(built: Built, e: Entity, t: number): void {
    const { ctx } = this;
    const p = positionAt(e, t, this.w, this.h);
    const sprite = built.layer.sprite;
    ctx.globalAlpha = alphaAt(e, t);
    if (sprite.kind === 'circle') {
      const r = e.size / 2;
      if (sprite.soft) {
        // Glow orb: solid core fading radially to transparent (pairs with blend:'lighter').
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, sprite.color);
        g.addColorStop(0.35, hexToRgba(sprite.color, 0.75));
        g.addColorStop(1, hexToRgba(sprite.color, 0));
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = sprite.color;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.flip && built.layer.flip) ctx.scale(-1, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (sprite.kind === 'emoji') {
      ctx.font = `${e.size}px serif`;
      ctx.fillText(sprite.glyphs[e.spriteIndex] ?? sprite.glyphs[0]!, 0, 0);
    } else {
      ctx.textAlign = sprite.align ?? 'center';
      ctx.textBaseline = sprite.baseline ?? 'middle';
      ctx.font = sprite.font ?? `${e.size}px system-ui, sans-serif`;
      ctx.fillStyle = sprite.color ?? '#e6e8ef';
      const text = sprite.strings[e.spriteIndex] ?? sprite.strings[0]!;
      if (sprite.maxWidth) ctx.fillText(text, 0, 0, sprite.maxWidth);
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
    const target = applyDeltasToSpec(this.spec, deltas);
    const dur = deltas.reduce((m, d) => Math.max(m, d.dur ?? 1000), 0) || 1000;
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

  /** Deterministic, frame-addressable render (shared by the rAF loop). */
  renderFrame(t: number, _seed: number): void {
    this.stepTransition(t);
    const { ctx } = this;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.drawBackground();
    for (const built of this.layers) {
      ctx.globalCompositeOperation = built.layer.blend ?? 'source-over';
      for (const e of built.entities) this.drawEntity(built, e, t);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
