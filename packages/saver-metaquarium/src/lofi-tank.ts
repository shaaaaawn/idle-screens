import {
  sampleTrack,
  type ControlTrack,
  type ParamSpace,
  type ParamValue,
  type SaverContext,
  type SaverInstance,
  type SaverLayer,
} from '@idle-screens/core';
import type { CapabilityTier } from '@idle-screens/capabilities';
import { breedOf, fishAsset } from './farm';
import { resolveIpfsUrls } from './ipfs';
import { buildLofiField, css, lofiFishPose, lofiRich, type LofiField } from './lofi';
import { withDefaults } from './manifest';
import { LogicalClock } from './runtime';

/**
 * The lofi tank's canvas instance: draws a {@link LofiField} (lofi.ts) with
 * Canvas2D, one pass per layer in the TV's order — water, shafts, dunes, kelp,
 * fish far to near, bubbles. DOM + async icon loading, so it is covered by the
 * playground e2e rather than unit tests, like tank.ts.
 */

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const ICON_TIMEOUT_MS = 8_000;
const ICONS = new Map<number, Promise<ImageBitmap | null>>();

/**
 * One icon through the gateway ladder, decoded from a Blob. Blob-sourced
 * bitmaps never taint the canvas, so thumbnails (`toDataURL`) keep working
 * whichever gateway answered. A fish whose icon never arrives just isn't
 * drawn — the TV does the same with a missing asset.
 */
function loadIcon(id: number): Promise<ImageBitmap | null> {
  let p = ICONS.get(id);
  if (p) return p;
  p = (async () => {
    const url = fishAsset(id, 'transparent_icon');
    if (!url || typeof fetch === 'undefined' || typeof createImageBitmap === 'undefined') return null;
    for (const candidate of resolveIpfsUrls(url)) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), ICON_TIMEOUT_MS);
      try {
        const res = await fetch(candidate, { signal: ctl.signal });
        if (!res.ok) continue;
        return await createImageBitmap(await res.blob());
      } catch {
        // next gateway
      } finally {
        clearTimeout(timer);
      }
    }
    // Forget the failure so a later mount can retry.
    ICONS.delete(id);
    return null;
  })();
  ICONS.set(id, p);
  return p;
}

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

type Ctx2D = CanvasRenderingContext2D;

class LofiTank implements SaverInstance {
  private readonly canvas: HTMLCanvasElement;
  private readonly ownsCanvas: boolean;
  private readonly g: Ctx2D;
  private readonly clock = new LogicalClock();
  private readonly icons = new Map<number, ImageBitmap>();
  private params: Record<string, ParamValue>;
  private track: ControlTrack | null = null;
  private field: LofiField;
  private fieldKey = '';
  private w: number;
  private h: number;
  private dpr: number;
  private t = 0;
  private frameId: number | null = null;
  private paused: boolean;
  private rendered = false;
  private disposed = false;

  constructor(
    private readonly ctx: SaverContext,
    private readonly space: ParamSpace,
    private readonly rich: boolean,
  ) {
    this.params = Object.fromEntries(Object.entries(space).map(([k, d]) => [k, d.default]));
    this.w = ctx.width;
    this.h = ctx.height;
    this.dpr = ctx.dpr;
    if (ctx.surface instanceof HTMLCanvasElement) {
      this.canvas = ctx.surface;
      this.ownsCanvas = false;
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText = 'display:block;width:100%;height:100%';
      ctx.host.appendChild(this.canvas);
      this.ownsCanvas = true;
    }
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('[metaquarium] lofi backend needs a 2d canvas context');
    this.g = g;
    this.field = this.refreshField();
    this.applySize();
    ctx.host.dataset.mqBackend = 'lofi';
    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  private str(key: string): string | undefined {
    const v = this.params[key];
    return typeof v === 'string' ? v : undefined;
  }

  /** Rebuild the tank only when what defines it changes; fetch its icons. */
  private refreshField(): LofiField {
    const env = this.str('environment');
    const mix = this.str('fishMix');
    const key = `${env ?? ''}\u0000${mix ?? ''}`;
    if (key === this.fieldKey && this.field) return this.field;
    this.fieldKey = key;
    this.field = buildLofiField(this.ctx.seed, this.rich, env, mix);
    for (const id of new Set(this.field.fish.map((f) => f.id))) {
      if (this.icons.has(id)) continue;
      void loadIcon(id).then((bmp) => {
        if (!bmp || this.disposed) return;
        this.icons.set(id, bmp);
        this.ctx.host.dataset.mqFish = String(this.icons.size);
        if (this.paused) this.renderStill();
      });
    }
    return this.field;
  }

  private applySize(): void {
    this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
  }

  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.clock.resume();
    this.frameId = requestAnimationFrame((now) => this.loop(now));
  }

  private stop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.clock.pause();
  }

  private loop(now: number): void {
    this.frameId = requestAnimationFrame((n) => this.loop(n));
    this.t = this.clock.sample(now);
    this.draw(this.t);
  }

  private renderStill(): void {
    this.draw(this.t);
  }

  private draw(t: number): void {
    if (this.disposed) return;
    if (this.track) this.params = sampleTrack(this.space, this.track, t);
    const field = this.refreshField();
    const g = this.g;
    const w = this.w;
    const h = this.h;
    const pal = field.palette;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Water: a deep vertical gradient, lighter up top where the surface is.
    const water = g.createLinearGradient(0, 0, 0, h);
    water.addColorStop(0, css(pal.top));
    water.addColorStop(0.45, css(pal.mid));
    water.addColorStop(1, css(pal.deep));
    g.fillStyle = water;
    g.fillRect(0, 0, w, h);

    // Light shafts: two slow, faint wedges.
    for (let i = 0; i < 2; i++) {
      const phase = t * 0.000021 + i * 2.4;
      const cx = w * (0.3 + 0.4 * i) + Math.sin(phase) * w * 0.05;
      const grad = g.createLinearGradient(cx, 0, cx, h);
      grad.addColorStop(0, css(pal.shaft, pal.shaftAlpha));
      grad.addColorStop(0.85, css(pal.shaft, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(cx - w * 0.02, -8);
      g.lineTo(cx + w * 0.02, -8);
      g.lineTo(cx + w * 0.16, h);
      g.lineTo(cx - w * 0.16, h);
      g.closePath();
      g.fill();
    }

    // Seabed: two dune bands in the room's ground colour.
    for (const [i, tone] of [[0, 0.55], [1, 1]] as const) {
      const baseY = h * (0.88 + 0.05 * i);
      g.fillStyle = css(pal.dune, tone);
      g.beginPath();
      g.moveTo(0, h);
      g.lineTo(0, baseY);
      for (let x = 0; x <= w; x += 24) {
        g.lineTo(x, baseY + Math.sin(x * 0.004 + i * 2.1) * h * 0.018);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    }

    // Kelp: swaying strands rooted in the seabed.
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = css(pal.kelp, 0.85);
    for (const strand of field.kelp) {
      const rootX = strand.x * w;
      const rootY = h * 0.94;
      const top = rootY - strand.height * h;
      g.lineWidth = strand.width * (h / 1080);
      g.beginPath();
      g.moveTo(rootX, rootY);
      for (let s = 1; s <= strand.segments; s++) {
        const f = s / strand.segments;
        const sway = Math.sin(t * 0.00045 + strand.swayPhase + f * 1.8) * strand.height * h * 0.12 * f;
        g.lineTo(rootX + sway, rootY - f * (rootY - top));
      }
      g.stroke();
    }

    // Fish: far to near.
    for (const f of field.fish) {
      const icon = this.icons.get(f.id);
      if (!icon) continue;
      const p = lofiFishPose(f, t, w, h);
      g.save();
      g.globalAlpha = p.alpha;
      g.translate(p.x, p.y);
      if (p.mirror) g.scale(-1, 1);
      g.rotate(p.rotation);
      g.drawImage(icon, -p.side / 2, -p.side / 2, p.side, p.side);
      g.restore();
    }

    // Bubbles: columns of rising rings, each addressed by emission index.
    const unit = h / 1080;
    const riseMs = 6_000;
    const count = field.rich ? 5 : 3;
    g.lineWidth = 1.4 * unit;
    for (const col of field.bubbles) {
      const baseX = col.x * w;
      const span = riseMs / col.period;
      for (let b = 0; b < count; b++) {
        const cycle = t / col.period + col.phase + b * (span / count);
        const f = (cycle % span) / span;
        if (!(f > 0)) continue;
        const y = h * 0.92 * (1 - f);
        const x = baseX + Math.sin(f * 9 + col.phase * 6) * col.drift * w;
        const r = (2.5 + f * 5.5) * unit;
        g.strokeStyle = `rgba(255,255,255,${0.28 * (1 - f * 0.6)})`;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
      }
    }
    this.rendered = true;
  }

  // ---- SaverInstance ----

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.stop();
      this.renderStill();
    } else {
      this.start();
    }
  }

  resize(width: number, height: number, dpr?: number): void {
    this.w = width;
    this.h = height;
    if (dpr !== undefined) this.dpr = dpr;
    this.applySize();
    this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
    if (this.paused) this.renderStill();
  }

  renderFrame(t: number, _seed: number): void {
    this.t = t;
    this.clock.seek(t);
    this.draw(t);
  }

  async capture(): Promise<ImageBitmap | null> {
    if (this.disposed) return null;
    this.renderStill();
    try {
      return await createImageBitmap(this.canvas);
    } catch {
      return null;
    }
  }

  inspect(): Record<string, unknown> | null {
    if (!this.rendered) return null;
    return {
      saver: 'metaquarium',
      backend: 'lofi',
      t: this.t,
      environment: this.str('environment') ?? 'void',
      fishMix: this.str('fishMix') ?? '',
      iconsLoaded: this.icons.size,
      fish: this.field.fish.map((f) => {
        const p = lofiFishPose(f, this.t, this.w, this.h);
        return {
          id: f.id,
          breed: breedOf(f.id),
          depth: +f.depth.toFixed(3),
          x: +(p.x / this.w).toFixed(3),
          y: +(p.y / this.h).toFixed(3),
          dir: f.dir,
          drawn: this.icons.has(f.id),
        };
      }),
    };
  }

  composition(): SaverLayer[] {
    return [
      {
        id: 'tank',
        label: 'Tank (lofi)',
        kind: 'surface',
        el: this.canvas,
        description: 'Canvas2D After Dark aquarium: transparent-icon fish, kelp, bubbles — the Apple TV renderer',
      },
    ];
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.icons.clear();
    if (this.ownsCanvas) this.canvas.remove();
    delete this.ctx.host.dataset.mqFish;
    delete this.ctx.host.dataset.mqBackend;
  }
}

export function mountLofi(ctx: SaverContext, space: ParamSpace, tier: CapabilityTier): SaverInstance {
  return new LofiTank(ctx, withDefaults(space, ctx.params), lofiRich(tier));
}
