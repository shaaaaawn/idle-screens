import {
  createRng,
  type ControlTrack,
  type ParamDelta,
  type SaverContext,
  type SaverInstance,
  type SaverManifest,
  type SaverPlugin,
} from '@idle-screens/core';
import { assertValidSpec, assertValidSequence, validateSpec } from './validate';
import { alphaAt, breakTextBlock, buildEntities, graphemeClusters, headingAt, lifeAlphaAt, linkEdges, positionAt, revealState, rotationAt, sizeAt, spriteIndexAt, textBlockAnchorOffset, textMetricsClassFor, type Entity } from './simulate';
import {
  applyDeltasToSpec,
  easeSmooth,
  lerpSpec,
  resolveSpecPath,
  structuralSignature,
  type SteerDelta,
} from './steer';
import type { IdleSequence, LayerSpec, SaverSpec } from './types';
import { LIMITS } from './types';
import { resolveSegment, segmentStart } from './sequence';
import { FEATHER_STEPS, barBox, barFraction, featherAlphas, isShapedSprite, polygonPoints, strokeSamples, strokeTaper, strokeWidthPx } from './shapes';

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

class SpecInstance implements SaverInstance {
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly ownsCanvas: boolean;
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
      this.ownsCanvas = false;
    } else {
      const el = document.createElement('canvas');
      el.style.cssText = 'display:block;width:100%;height:100%';
      el.setAttribute('aria-hidden', 'true');
      ctx.host.appendChild(el);
      canvas = el;
      this.ownsCanvas = true;
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

  /** Viewport factor for absolute px sizes — 1 for `units: 'px'` specs. */
  private fontScale(): number {
    if (this.effSpec.units === 'px') return 1;
    return Math.min(this.w, this.h) / (this.effSpec.referenceViewport ?? LIMITS.referenceViewport);
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
    const resolvedColor = isShapedSprite(sprite)
      ? (sprite.colors?.[e.colorIndex] ?? sprite.color)
      : sprite.kind === 'text' || sprite.kind === 'textBlock' ? (sprite.color ?? '#e6e8ef') : '#e6e8ef';
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
      const feather = sprite.feather ?? 0;
      if (feather > 0) {
        // Soft edge: nested fills from the OUTSIDE IN — the full-size rect
        // first at the faintest alpha, the core last at full — so the
        // composited alpha ramps linearly across the feathered band (see
        // featherAlphas). Only `lighter` sums alphas; `screen` still
        // composites source-over, so it takes the source-over schedule.
        const base = ctx.globalAlpha;
        const additive = built.layer.blend === 'lighter';
        const alphas = featherAlphas(FEATHER_STEPS, additive);
        for (let j = 1; j <= FEATHER_STEPS; j++) {
          const f = 1 - (feather * (j - 1)) / FEATHER_STEPS; // j=1 full size … j=K the core
          const fw = sz * f;
          const fh = rh * f;
          ctx.globalAlpha = base * alphas[j - 1]!;
          ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
        }
        ctx.globalAlpha = base;
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
      const pts = polygonPoints(sprite, r);
      ctx.save();
      ctx.translate(p.x, p.y);
      if (rot) ctx.rotate(rot);
      if (sprite.soft) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, resolvedColor);
        g.addColorStop(0.35, hexToRgba(resolvedColor, 0.75));
        g.addColorStop(1, hexToRgba(resolvedColor, 0));
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = resolvedColor;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }
    if (sprite.kind === 'stroke') {
      const resolvedColor = sprite.colors?.[e.colorIndex] ?? sprite.color;
      const pts = strokeSamples(sprite, sz / 2);
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
        // A brush mark: each sampled segment at its own width.
        for (let i = 1; i < pts.length; i++) {
          ctx.lineWidth = Math.max(0.5, lw * strokeTaper((i - 0.5) / (pts.length - 1)));
          ctx.beginPath();
          ctx.moveTo(pts[i - 1]!.x, pts[i - 1]!.y);
          ctx.lineTo(pts[i]!.x, pts[i]!.y);
          ctx.stroke();
        }
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
      const lines = breakTextBlock(sprite.text, maxWEm, textMetricsClassFor(sprite.font));
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
            ctx.fillText(clusters[gi]!, x0 + ctx.measureText(prefix).width, li * lh);
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

  /**
   * Apply steering deltas immediately: no glide, no frame painted. Each delta
   * is routed by `applyRetainedDeltas` (unresolvable or invalid ones are
   * skipped on this spec alone). `SequenceInstance` uses this to hand a
   * freshly created child the track the sequence has retained, so a steer
   * made while another segment was active lands on the segment that owns the
   * path. Not painting matters: a child is created inside the parent's
   * renderFrame, and a stray t=0 paint here would make the real frame that
   * follows look "contiguous" to the ghosting warm-up.
   */
  applyDeltasNow(deltas: Iterable<SteerDelta>): void {
    const next = applyRetainedDeltas(this.effSpec, deltas);
    if (next === this.effSpec) return;
    this.transition = null;
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
    const maxDistPx = links.maxDist * (this.effSpec.units === 'px' ? 1 : Math.min(this.w, this.h));
    const edges = linkEdges(links, positions, maxDistPx, wrap, this.w, this.h);
    const unitScale = this.effSpec.units === 'px' ? 1 : Math.min(this.w, this.h);
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

  /**
   * Replace the rendered spec without triggering a transition glide.
   * Checks structural signature — use `hotSwapPaint` when the caller
   * already knows the signature is unchanged (e.g. mid-morph lerp).
   */
  hotSwapSpec(spec: SaverSpec): void {
    this.effSpec = spec;
    const sig = structuralSignature(this.effSpec);
    if (sig !== this.lastStructural) this.rebuild();
    else this.layers.forEach((b, i) => { b.layer = this.effSpec.layers[i] ?? b.layer; });
  }

  /** Paint-only hot-swap: skips structuralSignature (caller guarantees match). */
  hotSwapPaint(spec: SaverSpec): void {
    this.effSpec = spec;
    this.layers.forEach((b, i) => { b.layer = this.effSpec.layers[i] ?? b.layer; });
  }

  dispose(): void {
    this.stop();
    if (this.ownsCanvas && typeof HTMLCanvasElement !== 'undefined' && this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
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
export interface SequenceMountContext extends SaverContext {
  /** ms already elapsed on the shared sequence clock. Ignored unless `sync: 'epoch'`. */
  sequenceBaseT?: number;
  /**
   * The device's compute tier (`computeTier` from `@idle-screens/capabilities`;
   * the string union is repeated here so schema does not depend on that
   * package). A `fade` transition keeps two segments live for `dur`, which
   * `basic` (canvas2d only) and `minimal` cannot afford: on those tiers fade
   * renders as `cut`. Absent ⇒ fade enabled.
   */
  capabilityTier?: 'minimal' | 'basic' | 'standard' | 'high';
}

/** A live `fade`: the outgoing segment on its own canvas, composited over the incoming one. */
interface FadingChild {
  index: number;
  child: SpecInstance;
  canvas: HTMLCanvasElement | OffscreenCanvas;
}

class SequenceInstance implements SaverInstance {
  private readonly seq: IdleSequence;
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
  /** The outgoing segment while a `fade` runs; null otherwise. */
  private fading: FadingChild | null = null;
  /** False on the `basic`/`minimal` capability tiers — fade renders as cut. */
  private readonly fadeEnabled: boolean;

  constructor(seq: IdleSequence, ctx: SequenceMountContext) {
    this.seq = seq;
    const { sequenceBaseT, capabilityTier, ...plainCtx } = ctx;
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
    // Children are always parent-driven: reducedMotion:true keeps SpecInstance
    // from starting its own rAF. SequenceInstance.loop is the only clock.
    this.childCtx = { ...plainCtx, surface: surface!, reducedMotion: true };
    this.children = new Array(seq.segments.length).fill(null) as (SpecInstance | null)[];
    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderFrame(this.baseT, this.seed);
    else this.start();
  }

  private childSeed(index: number, fallback: number): number {
    return this.seq.segments[index]!.scene.seed ?? this.seq.seed ?? fallback;
  }

  private childScene(index: number): SaverSpec {
    const seg = this.seq.segments[index]!;
    if (seg.scene.seed != null) return seg.scene;
    if (this.seq.seed != null) return { ...seg.scene, seed: this.seq.seed + index };
    return seg.scene;
  }

  /** Whether the boundary from `from` to `from+1` should morph. */
  private canMorph(from: number): boolean {
    const seg = this.seq.segments[from];
    if (!seg || seg.transition?.type !== 'morph') return false;
    const next = this.seq.segments[from + 1];
    if (!next) return false;
    return structuralSignature(seg.scene) === structuralSignature(next.scene);
  }

  /** Walk back through consecutive morph boundaries to find the chain origin. */
  private morphChainRoot(index: number): number {
    let i = index;
    while (i > 0 && this.canMorph(i - 1)) i--;
    return i;
  }

  private morphDur(from: number): number {
    const tr = this.seq.segments[from]?.transition;
    return tr?.type === 'morph' ? tr.dur : 0;
  }

  /** Length of the fade out of segment `from`, or 0 (no fade, or a tier that plays it as cut). */
  private fadeDur(from: number): number {
    const tr = this.seq.segments[from]?.transition;
    return this.fadeEnabled && tr?.type === 'fade' ? tr.dur : 0;
  }

  /** Sum of every timed segment — the lap length under `loop: true`. */
  private timedTotal(): number {
    const last = this.seq.segments.length - 1;
    return segmentStart(this.seq, last) + (this.seq.segments[last]!.duration ?? 0);
  }

  private releaseFading(): void {
    if (!this.fading) return;
    this.fading.child.dispose();
    this.fading = null;
  }

  /**
   * Cross-fade: the outgoing segment `from` stays alive on a canvas of its own,
   * keeps animating at `duration(from) + localT` (it does not freeze — and if
   * it was an `advance: 'input'` hold it resumes from its duration, not from
   * wherever the hold had reached), and is composited over the incoming frame
   * already on the shared surface at `1 − easeSmooth(localT / dur)`. Two live
   * segments for `dur` only; the outgoing one is disposed when the fade ends.
   * Like a morph, the outgoing child mounts on its morph chain root's scene
   * and seed so its entities are the ones the viewer was watching.
   */
  private compositeFade(from: number, localT: number, seed: number): void {
    const dur = this.fadeDur(from);
    if (this.fading && this.fading.index !== from) this.releaseFading();
    if (!this.fading) {
      const canvas: HTMLCanvasElement | OffscreenCanvas = typeof document !== 'undefined'
        ? document.createElement('canvas')
        : new OffscreenCanvas(Math.max(1, this.childCtx.width), Math.max(1, this.childCtx.height));
      const root = this.morphChainRoot(from);
      const child = new SpecInstance(this.childScene(root), { ...this.childCtx, surface: canvas });
      child.setPaused(true);
      if (root !== from) child.hotSwapSpec(this.childScene(from));
      if (this.retainedDeltas.size > 0) child.applyDeltasNow(this.retainedDeltas.values());
      this.fading = { index: from, child, canvas };
    }
    const outDur = this.seq.segments[from]!.duration ?? 0;
    this.fading.child.renderFrame(outDur + localT, this.childSeed(this.morphChainRoot(from), seed));

    const main = this.childCtx.surface?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
    if (!main) return;
    main.save();
    main.globalAlpha = 1 - easeSmooth(localT / dur);
    main.globalCompositeOperation = 'source-over';
    main.drawImage(this.fading.canvas, 0, 0, this.childCtx.width, this.childCtx.height);
    main.restore();
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
   * was up is already in effect on this child's first frame.
   */
  private ensureChild(index: number, rootScene?: SaverSpec): SpecInstance {
    if (index < 0 || index >= this.seq.segments.length) index = 0;
    let child = this.children[index];
    if (!child) {
      child = new SpecInstance(rootScene ?? this.childScene(index), this.childCtx);
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

  renderFrame(T: number, seed: number): void {
    this.renderedT = T;
    const resolved = resolveSegment(this.seq, T + this.clockOffset, { releasedBelow: this.releasedBelow });
    const { index, localT } = resolved;

    // Check if the *previous* segment has a morph into this one
    const prevIdx = index > 0 ? index - 1 : -1;
    const morphActive = prevIdx >= 0
      && this.canMorph(prevIdx)
      && localT < this.morphDur(prevIdx);

    // A fade comes from the previous segment in the list — or, under
    // `loop: true`, from the last segment when the lap wraps to 0, so the
    // last segment's `fade` is the wrap's transition. Cut and morph paths
    // are untouched: fadeDur is 0 for them.
    const lastIdx = this.seq.segments.length - 1;
    const wrapped = this.seq.loop && index === 0 && lastIdx > 0
      && (T + this.clockOffset >= this.timedTotal() || this.pendingWrapFade);
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
      this.morphFromIndex = prevIdx;
      this.activeIndex = index;

      // Release all children except the chain root's slot
      for (let i = 0; i < this.children.length; i++) {
        if (i !== chainRoot) this.releaseChild(i);
      }

      const child = this.ensureChild(chainRoot);
      const dur = this.morphDur(prevIdx);
      const k = easeSmooth(localT / dur);
      // The lerp endpoints carry the retained track: hotSwapPaint replaces the
      // child's whole effSpec every morph frame, so without this a steered
      // colour would vanish for `dur` and snap back when the morph finalises.
      const specA = this.steeredScene(this.childScene(prevIdx));
      const specB = this.steeredScene(this.childScene(index));
      child.hotSwapPaint(lerpSpec(specA, specB, k));
      child.renderFrame(localT, this.childSeed(chainRoot, seed));
    } else {
      // No morph (or morph complete). If we were morphing, finalize.
      if (this.morphFromIndex >= 0) {
        // Morph just completed — release the chain-root child.
        const oldRoot = this.morphChainRoot(this.morphFromIndex);
        this.releaseChild(oldRoot);
        if (oldRoot !== this.morphFromIndex) this.releaseChild(this.morphFromIndex);
        this.morphFromIndex = -1;
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

      // If using morph seed, mount the child with the chain root's scene+seed
      // but immediately hot-swap to the current segment's spec.
      const child = useMorphSeed ? this.ensureChild(index, this.childScene(chainRoot)) : this.ensureChild(index);
      child.renderFrame(localT, effSeed);
      if (fadeActive) this.compositeFade(fadeFrom, localT, seed);
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
    for (const child of this.children) {
      child?.resize(width, height, dpr);
    }
    this.fading?.child.resize(width, height, dpr);
  }

  applyTrack(track: ControlTrack): void {
    const deltas = (track?.deltas ?? []) as unknown as SteerDelta[];
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
        // hotSwapPaint on the very next frame regardless, so a transition
        // glide on this path can't coexist with the morph's own cross-fade.
        // The delta is already retained above, so a re-render is all that's
        // needed to reach it via steeredScene: it takes effect this frame,
        // immediately rather than gliding over its own `dur`. Skip only when
        // the segDelta branch above already re-rendered with these deltas
        // retained.
        if (!switchedSegment) this.renderFrame(this.renderedT, this.seed);
      } else if (this.activeIndex >= 0) {
        // Not mid-morph: the active child still gets the track directly, as
        // before retention — a steer to a path it owns glides on this call
        // rather than snapping at the next boundary.
        const child = this.children[this.activeIndex];
        child?.applyTrack({ ...track, deltas: childDeltas as unknown as ParamDelta[] });
      }
      // The outgoing segment during a fade is a standalone SpecInstance, not
      // one of `this.children` — without this it would freeze at whatever it
      // last rendered instead of picking up a mid-fade steer like the
      // incoming segment does. Independent of the morph/active branching
      // above: fade and morph are mutually exclusive per-frame states.
      this.fading?.child.applyTrack({ ...track, deltas: childDeltas as unknown as ParamDelta[] });
    }
  }

  dispose(): void {
    this.stop();
    this.releaseFading();
    for (let i = 0; i < this.children.length; i++) {
      this.releaseChild(i);
    }
    if (this.canvas) this.canvas.remove();
  }
}

function sequenceManifest(seq: IdleSequence): SaverManifest {
  const maxTotal = seq.segments.reduce((max, s) => {
    const t = s.scene.layers.reduce((n, l) => n + l.count, 0);
    return Math.max(max, t);
  }, 0);
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

export function compileSequence(spec: unknown): SaverPlugin {
  const valid = assertValidSequence(spec);
  return {
    manifest: sequenceManifest(valid),
    mount: (ctx: SaverContext) => new SequenceInstance(valid, ctx),
    spec: valid,
  };
}
