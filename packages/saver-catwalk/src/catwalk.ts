import {
  sampleTrack,
  defaultParams,
  type ControlTrack,
  type ParamSpace,
  type SaverContext,
  type SaverInstance,
  type SaverLayer,
  type SaverManifest,
  type SaverPlugin,
} from '@idle-screens/core';

/**
 * CATWALK — a cat lives on your page.
 *
 * The page's blocks are its furniture: a silhouette cat parkours across the
 * live content, and every perch reacts like a real object — it dips and rings
 * under the landing, sags while the cat sits, recoils when it springs off,
 * and the cat RIDES the dip (its y is the perch's y). The block the cat
 * occupies is the one lit; everything else falls into the night veil.
 *
 * Determinism: the whole performance is compiled at collect time into a
 * seeded ITINERARY — which perch, when, what the cat does there — so the
 * cat's position, its pose, and every block's spring response are closed-form
 * in `t`. `renderFrame(t, seed)` reproduces any frame, page included; the
 * landing "physics" is a damped cosine evaluated from the landing timestamp,
 * never an integrated state.
 */
const PARAM_SPACE = {
  /** Cat body height, px. */
  catSize: { type: 'number', default: 40, min: 18, max: 64, ease: 'smooth' },
  /** Global tempo of the performance. */
  pace: { type: 'number', default: 1, min: 0.3, max: 2.2, ease: 'smooth' },
  /** Jump arc height multiplier. */
  jumpArc: { type: 'number', default: 1, min: 0.4, max: 2, ease: 'smooth' },
  /** How hard perches dip and ring under the cat. */
  bounce: { type: 'number', default: 1, min: 0, max: 2.5, ease: 'smooth' },
  /** Darkness of the night veil over the page. */
  veil: { type: 'number', default: 0.72, min: 0, max: 0.9, ease: 'smooth' },
  /** Radius of the pool of light that follows the cat, fraction of short edge. */
  lightRadius: { type: 'number', default: 0.42, min: 0.15, max: 1, ease: 'smooth' },
  eyeGlow: { type: 'number', default: 1, min: 0, max: 2, ease: 'smooth' },
  /** Fur: 0 = black alley cat, 1 = ginger. */
  tint: { type: 'number', default: 0.08, min: 0, max: 1, ease: 'smooth' },
  /** Landing dust visibility. */
  dust: { type: 'number', default: 0.6, min: 0, max: 1, ease: 'smooth' },
  /** Fraction of stops spent asleep. Read once when the itinerary is compiled. */
  sleepiness: { type: 'number', default: 0.35, min: 0, max: 1 },
} satisfies ParamSpace;

export const catwalkManifest: SaverManifest = {
  id: 'catwalk',
  label: 'Catwalk',
  timeModel: 'closed-form',
  passthrough: true,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  a11y: {
    flashSafe: true,
    notes: 'One small cat on a dim page. No flashing; the light pool drifts with it.',
  },
};

/** Generic content selector a passthrough saver eats. Hosts can override later. */
const VICTIM_SELECTOR =
  'main :is(h1,h2,h3,h4,p,li,img,a,button), nav a, header a, footer a, .card, [data-idle-victim]';

const MAX_VICTIMS = 200;
/** A perch must be wide enough to stand on and tall enough to read as a ledge. */
const MIN_PERCH_W = 56;
const MIN_PERCH_H = 12;

type Action = 'sit' | 'groom' | 'stretch' | 'sleep' | 'knead' | 'bat' | 'pounce' | 'roll';

interface Perch {
  /** Index into `victims`. */
  v: number;
  /** Top-centre anchor, untransformed. */
  x: number;
  y: number;
  halfW: number;
  /** 0..1 — small blocks dip more under the cat. */
  give: number;
  /** Seeded tilt direction for the landing ring. */
  tiltSign: number;
}

interface Visit {
  perch: number;
  /** Arrival (landing) time, ms into the loop. */
  tA: number;
  /** Departure (spring-off) time. */
  tD: number;
  action: Action;
  /** Facing while dwelling: toward where it will jump next. */
  face: number;
  /** Seeded landing offset along the perch, so it never lands dead-centre twice. */
  dx: number;
  /** Per-visit seeded phase — times the look-around, the swats, the moth. */
  quirk: number;
  /** Victim index of the neighbouring block a 'bat' visit swats, or -1. */
  batTarget: number;
  /** Part of a zoomies chain: barely lands before launching again. */
  zoom: boolean;
  /** The return to the favourite perch — greeted with a heart, ends in the long nap. */
  favorite: boolean;
}

/** In-place pounce hop: starts this long before the visit's departure. */
const POUNCE_LEAD = 1150;
/** Sideways nudge a batted block takes. Pure in the age τ (s). */
const swatSpring = (tau: number): number =>
  tau < 0 || tau >= 1 ? 0 : Math.exp(-6 * tau) * Math.sin(14 * tau);

interface Victim {
  el: HTMLElement;
  cx: number;
  cy: number;
  w: number;
  h: number;
  prevTransform: string;
  prevOrigin: string;
  prevWillChange: string;
  prevTransition: string;
  lastTransform: string;
}

/** One evaluated moment of the performance — everything drawCat needs. */
interface CatFrame {
  x: number;
  y: number;
  face: number;
  angle: number;
  state: Action | 'jump' | 'crouch' | 'land' | 'walk' | 'stalk';
  /** 0..1 progress through the state, for pose blending. */
  k: number;
  /** 0..1 — how close to the end of its perch it is sitting. Near 1, the
   *  tail hangs off the ledge instead of curling behind. */
  edge: number;
  visit: Visit;
}

/** Stand-in visit for the floor patrol (no perches to tour). The impossible
 *  times keep every itinerary-relative effect (dust, Zzz) inert. */
const GROUND_VISIT: Visit = { perch: 0, tA: -1e9, tD: -1e9, action: 'sit', face: 1, dx: 0, quirk: 0, batTarget: -1, zoom: false, favorite: false };

type Params = Record<keyof typeof PARAM_SPACE, number>;

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smooth01 = (k: number): number => k * k * (3 - 2 * k);
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Damped ring a perch makes when the cat lands on it. Pure in the age τ (s). */
const landSpring = (tau: number): number =>
  tau < 0 || tau >= 1.5 ? 0 : Math.exp(-4.2 * tau) * Math.cos(10.5 * tau);
/** Upward recoil when the cat springs off. */
const leaveSpring = (tau: number): number =>
  tau < 0 || tau >= 0.9 ? 0 : Math.exp(-5 * tau) * Math.sin(9 * tau) * 0.5;

class CatwalkInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private w = 0;
  private h = 0;

  private victims: Victim[] = [];
  private perches: Perch[] = [];
  private visits: Visit[] = [];
  /** Total loop duration, ms. 0 = no itinerary (not enough perches). */
  private loopD = 0;
  /**
   * The entrance: a one-time prologue before the loop clock starts. At t=0
   * there is no cat — it walks in from the nearest screen edge, gathers with
   * a crouch, and its first leap lands exactly at loop-time 0, so the perch's
   * ordinary landing spring rings on arrival. Null until an itinerary exists.
   */
  private entrance: { xStart: number; xTakeoff: number; walkD: number; crouchD: number; jumpD: number; dur: number } | null = null;

  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  private t = 0;

  private params: Params = defaultParams(PARAM_SPACE) as Params;
  private track: ControlTrack | null = null;

  /**
   * This cat's body, rolled once from a forked stream — every seed is a
   * visibly different animal, not just a different temperament. `tint` (the
   * steerable param) still shifts the fur; these modulate around it.
   */
  private readonly look: {
    /** Left/right eye colours — usually matching, occasionally odd-eyed. */
    eyeL: string;
    eyeR: string;
    /** 0.9..1.15 body scale. Some cats are simply more cat. */
    plump: number;
    /** 0.85..1.2 tail length multiplier. */
    tail: number;
    /** Fur brightness multiplier around the tint param. */
    shade: number;
    /** White chest patch + sock paws, or a solid coat. */
    socks: boolean;
  };

  constructor(ctx: SaverContext) {
    const lookRng = ctx.rng.fork(0xface);
    const EYES = ['rgba(255,214,120,$A)', 'rgba(168,232,150,$A)', 'rgba(255,168,96,$A)', 'rgba(150,214,255,$A)'];
    const eyeL = EYES[Math.floor(lookRng.next() * EYES.length)]!;
    this.look = {
      eyeL,
      // ~6% of cats are odd-eyed. They know they're special.
      eyeR: lookRng.next() < 0.06 ? EYES[Math.floor(lookRng.next() * EYES.length)]! : eyeL,
      plump: 0.9 + lookRng.next() * 0.25,
      tail: 0.85 + lookRng.next() * 0.35,
      shade: 0.75 + lookRng.next() * 0.6,
      socks: lookRng.next() < 0.45,
    };
    this.ctxSaver = ctx;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    ctx.host.appendChild(canvas);
    this.canvas = canvas;
    const c2d = canvas.getContext('2d', { alpha: true });
    if (!c2d) throw new Error('catwalk: no 2d context');
    this.ctx = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();
    this.collectVictims();

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  private applyParams(t: number): void {
    const p = this.track ? sampleTrack(PARAM_SPACE, this.track, t) : this.params;
    for (const k of Object.keys(PARAM_SPACE) as Array<keyof typeof PARAM_SPACE>) {
      const v = p[k];
      this.params[k] = typeof v === 'number' ? v : this.params[k];
    }
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- page victims + the itinerary ----
  private collectVictims(): void {
    this.victims = [];
    this.perches = [];
    this.visits = [];
    this.loopD = 0;
    this.entrance = null;
    const page = this.ctxSaver.page;
    if (!page) return;
    let els = page.victims(VICTIM_SELECTOR);
    els = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
    for (const el of els) {
      if (this.victims.length >= MAX_VICTIMS) break;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 6) continue;
      if (r.bottom < 0 || r.top > this.h) continue;
      if (r.right < 0 || r.left > this.w) continue;
      this.victims.push({
        el,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        w: r.width,
        h: r.height,
        prevTransform: el.style.transform,
        prevOrigin: el.style.transformOrigin,
        prevWillChange: el.style.willChange,
        prevTransition: el.style.transition,
        lastTransform: '\u0000', // sentinel ≠ any real value, forces first write
      });
    }

    // Perches: victims a cat could plausibly stand on, fully on-screen-ish.
    const rng = this.ctxSaver.rng.fork(0xca7);
    for (let i = 0; i < this.victims.length; i++) {
      const v = this.victims[i]!;
      if (v.w < MIN_PERCH_W || v.h < MIN_PERCH_H) continue;
      const top = v.cy - v.h / 2;
      // The cat STANDS ~2 body-heights above the perch top; a perch on the
      // top bar parks it half off-screen.
      if (top < 96 || top > this.h - 12) continue;
      const area = v.w * v.h;
      this.perches.push({
        v: i,
        x: v.cx,
        y: top,
        halfW: v.w / 2,
        give: clamp(1 - (area - 3_000) / 90_000, 0.25, 1),
        tiltSign: rng.next() < 0.5 ? -1 : 1,
      });
    }
    // Selector-poor pages (app shells, card grids in plain divs): the semantic
    // selector can come up nearly empty even though the page is full of
    // perch-sized blocks. Take a structural second pass before giving up.
    if (this.perches.length < 2) this.collectFallbackPerches(rng);

    this.compileItinerary(rng);

    // Style prep only for elements the performance actually touches — the
    // perches, plus any neighbour a 'bat' visit swats. Runs AFTER the
    // itinerary is compiled so the bat targets are known.
    const touched = new Set<number>(this.perches.map((p) => p.v));
    for (const vis of this.visits) if (vis.batTarget >= 0) touched.add(vis.batTarget);
    for (const vi of touched) {
      const el = this.victims[vi]!.el;
      el.style.willChange = 'transform';
      el.style.transition = 'none';
      el.style.transformOrigin = '50% 50%';
    }
  }

  /** A small neighbour within paw's reach of a perch anchor — swattable. */
  private batTargetFor(perchIdx: number): number {
    const here = this.perches[perchIdx]!;
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < this.victims.length; j++) {
      if (j === here.v) continue;
      const v = this.victims[j]!;
      if (v.w < 24 || v.w > 260 || v.h < 10 || v.h > 90) continue;
      const dx = Math.abs(v.cx - here.x);
      const dy = v.cy - here.y;
      if (dx < 46 || dx > 190 || dy < -30 || dy > 120) continue;
      const d = dx + Math.abs(dy);
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  }

  /**
   * Second-chance perch harvest: plain structural blocks of perch size,
   * biggest first, skipping anything that overlaps an accepted perch — no
   * de-nesting needed because overlap rejection keeps ancestors and
   * descendants from both being taken.
   */
  private collectFallbackPerches(rng: { next(): number }): void {
    const page = this.ctxSaver.page;
    if (!page) return;
    const seen = new Set(this.victims.map((v) => v.el));
    const cands: { el: HTMLElement; r: DOMRect }[] = [];
    for (const el of page.victims('div, section, article, figure, li, button, a')) {
      if (seen.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < MIN_PERCH_W || r.width > 720) continue;
      if (r.height < MIN_PERCH_H || r.height > 240) continue;
      if (r.top < 96 || r.top > this.h - 12) continue;
      if (r.right < 0 || r.left > this.w) continue;
      cands.push({ el, r });
    }
    cands.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    const taken: { l: number; t: number; rt: number; b: number }[] = this.perches.map((p) => {
      const v = this.victims[p.v]!;
      return { l: v.cx - v.w / 2, t: v.cy - v.h / 2, rt: v.cx + v.w / 2, b: v.cy + v.h / 2 };
    });
    for (const { el, r } of cands) {
      if (this.perches.length >= 24 || this.victims.length >= MAX_VICTIMS) break;
      if (taken.some((o) => r.left < o.rt && r.right > o.l && r.top < o.b && r.bottom > o.t)) continue;
      taken.push({ l: r.left, t: r.top, rt: r.right, b: r.bottom });
      const vi = this.victims.length;
      this.victims.push({
        el,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        w: r.width,
        h: r.height,
        prevTransform: el.style.transform,
        prevOrigin: el.style.transformOrigin,
        prevWillChange: el.style.willChange,
        prevTransition: el.style.transition,
        lastTransform: ' ',
      });
      const area = r.width * r.height;
      this.perches.push({
        v: vi,
        x: r.left + r.width / 2,
        y: r.top,
        halfW: r.width / 2,
        give: clamp(1 - (area - 3_000) / 90_000, 0.25, 1),
        tiltSign: rng.next() < 0.5 ? -1 : 1,
      });
    }
  }

  /**
   * The seeded random walk: ~a dozen stops, each with an action and a dwell,
   * jumps sized by distance, and the last jump returns HOME so the loop is
   * seamless. All times are absolute ms into the loop.
   */
  private compileItinerary(rng: { next(): number; pick<T>(a: readonly T[]): T }): void {
    const P = this.perches;
    if (P.length < 2) return;

    const stops = Math.min(12, Math.max(5, Math.floor(P.length * 0.8)));
    const order: number[] = [];
    let cur = Math.floor(rng.next() * P.length);
    let prev = -1;
    for (let i = 0; i < stops; i++) {
      order.push(cur);
      // Prefer a hop 90..640px away; never straight back where we came from.
      const cands: number[] = [];
      for (let j = 0; j < P.length; j++) {
        if (j === cur || j === prev) continue;
        const d = Math.hypot(P[j]!.x - P[cur]!.x, P[j]!.y - P[cur]!.y);
        if (d >= 90 && d <= 640) cands.push(j);
      }
      const pool = cands.length
        ? cands
        : [...P.keys()].filter((j) => j !== cur && (P.length <= 2 || j !== prev));
      prev = cur;
      cur = pool[Math.floor(rng.next() * pool.length)]!;
    }

    const sleepy = this.params.sleepiness;
    // Personality: a seeded trait, not a param — every seed is a different
    // cat. A playful one bats and pounces; a placid one mostly sits and naps.
    const playful = 0.35 + rng.next() * 0.55;

    // Perch memory: pick a favourite from the first stops and return to it
    // near the end of the loop. The second visit is greeted with a heart and
    // becomes the long nap — viewers notice "it likes that one".
    let favoriteIdx = -1;
    if (order.length >= 6) {
      const fav = order[Math.floor(rng.next() * 3)]!;
      const at = order.length - 2;
      if (order[at - 1] !== fav && order[at + 1] !== fav && order[at] !== fav) {
        order[at] = fav;
        favoriteIdx = at;
      }
    }

    // The zoomies: a burst of three barely-there landings chained at speed,
    // followed by an embarrassed groom. Only the genuinely playful cats.
    let zoomStart = -1;
    if (playful > 0.78 && order.length >= 7) {
      zoomStart = 2 + Math.floor(rng.next() * (order.length - 6));
      if (favoriteIdx >= 0 && zoomStart + 3 >= favoriteIdx) zoomStart = -1; // never trample the homecoming
    }

    let t = 0;
    for (let i = 0; i < order.length; i++) {
      const perch = order[i]!;
      const next = P[order[(i + 1) % order.length]]!;
      const here = P[perch]!;

      const batTarget = this.batTargetFor(perch);
      const zoom = zoomStart >= 0 && i >= zoomStart && i < zoomStart + 3;
      const favorite = i === favoriteIdx;
      let action: Action;
      const roll = rng.next();
      if (zoom) {
        action = 'sit'; // never reached — a zoomies dwell is all land-and-launch
      } else if (zoomStart >= 0 && i === zoomStart + 3) {
        action = 'groom'; // the post-zoomies composure recovery
      } else if (favorite) {
        action = 'sleep'; // home again — the long nap
      } else if (roll < sleepy) {
        action = 'sleep';
      } else {
        // Weighted pool; 'bat' only when something is in paw's reach.
        const pool: [Action, number][] = [
          ['sit', 0.2],
          ['groom', 0.16],
          ['stretch', 0.12],
          ['knead', 0.14],
          ['pounce', 0.2 * playful],
          // Weighted up: zoomies and the homecoming already claim several
          // of a playful cat's stops, and batting is the crown jewel.
          ['bat', batTarget >= 0 ? 0.42 * playful : 0],
          // Belly-up roll needs room — only on genuinely wide perches.
          ['roll', here.halfW >= 90 ? 0.14 * playful : 0],
        ];
        const total = pool.reduce((s, [, w]) => s + w, 0);
        let pick = rng.next() * total;
        action = 'sit';
        for (const [a, w] of pool) {
          pick -= w;
          if (pick <= 0) { action = a; break; }
        }
      }
      const dwell =
        zoom ? 380 + rng.next() * 140
        : favorite ? 8_000 + rng.next() * 3_500
        : action === 'sleep' ? 6_000 + rng.next() * 4_500
        : action === 'groom' ? 3_200 + rng.next() * 1_800
        : action === 'knead' ? 4_000 + rng.next() * 2_000
        : action === 'bat' ? 3_800 + rng.next() * 1_400
        : action === 'pounce' ? 3_400 + rng.next() * 1_000
        : action === 'roll' ? 3_600 + rng.next() * 1_200
        : action === 'stretch' ? 2_600 + rng.next() * 1_000
        : 2_200 + rng.next() * 1_600;

      const tA = t;
      const tD = tA + dwell;
      this.visits.push({
        perch,
        tA,
        tD,
        action,
        face: next.x >= here.x ? 1 : -1,
        // Spread reaches ~85% of the way to the perch ends, so the outer
        // landings actually read as edge-sits (tail off the ledge).
        dx: (rng.next() - 0.5) * 1.7 * Math.max(0, here.halfW - 26),
        quirk: rng.next(),
        batTarget: action === 'bat' ? batTarget : -1,
        zoom,
        favorite,
      });
      const dist = Math.hypot(next.x - here.x, next.y - here.y);
      // Zoomies jumps are flat-out; normal jumps scale with distance.
      t = tD + (zoom ? 240 + dist * 0.3 : 420 + dist * 0.55);
    }
    this.loopD = t; // the final jump lands at t == 0 of the next loop

    // The entrance. Geometry only — all evaluation lives in entranceAt().
    const first = P[this.visits[0]!.perch]!;
    const xLand = first.x + this.visits[0]!.dx;
    const groundY = this.h - 8;
    const xStart = xLand < this.w / 2 ? -34 : this.w + 34;
    // Take off short of the landing spot so the first leap has a readable arc;
    // clamp on-screen for perches parked near the entry edge.
    const back = clamp((groundY - first.y) * 0.4, 70, 230);
    const xTakeoff = clamp(xLand - Math.sign(xLand - xStart) * back, 24, this.w - 24);
    const walkD = Math.abs(xTakeoff - xStart) / 0.2; // a brisk ~200 px/s arrival
    const crouchD = 620; // gather + butt-wiggle before the first leap
    const jumpD = 420 + Math.hypot(xLand - xTakeoff, first.y - groundY) * 0.55;
    this.entrance = { xStart, xTakeoff, walkD, crouchD, jumpD, dur: walkD + crouchD + jumpD };
  }

  private restoreVictims(): void {
    for (const v of this.victims) {
      v.el.style.transform = v.prevTransform;
      v.el.style.transformOrigin = v.prevOrigin;
      v.el.style.willChange = v.prevWillChange;
      v.el.style.transition = v.prevTransition;
    }
    this.victims = [];
    this.perches = [];
    this.visits = [];
    this.loopD = 0;
    this.entrance = null;
  }

  // ---- the performance, closed-form in tt ----

  /** Perch vertical offset at loop-time `tt`: every landing/dwell/leave it hosts. */
  private perchOffset(pi: number, tt: number): number {
    const D = this.loopD;
    let off = 0;
    for (const vis of this.visits) {
      if (vis.perch !== pi) continue;
      const g = this.perches[pi]!.give * this.params.bounce;
      const tauA = (((tt - vis.tA) % D) + D) % D;
      off += -7.5 * g * landSpring(tauA / 1000);
      // The pounce lands a second, harder hit on the same perch.
      if (vis.action === 'pounce') {
        const tauP = (((tt - (vis.tD - POUNCE_LEAD + 420)) % D) + D) % D;
        off += -10 * g * landSpring(tauP / 1000);
      }
      // Sag while occupied (ramps in over 350ms, releases at departure).
      if (tt >= vis.tA && tt < vis.tD) {
        off += -2.6 * g * smooth01(clamp((tt - vis.tA) / 350, 0, 1));
      }
      const tauD = (((tt - vis.tD) % D) + D) % D;
      off += 3.2 * g * leaveSpring(tauD / 1000);
    }
    return off;
  }

  /** Where the cat is and what it is doing at loop-time `tt`. */
  private catAt(tt: number): CatFrame {
    const V = this.visits;
    const P = this.perches;
    // Find the visit whose [tA, next jump end) window contains tt.
    let i = V.length - 1;
    for (let j = 0; j < V.length; j++) {
      if (tt >= V[j]!.tA) i = j;
    }
    const vis = V[i]!;
    const nextVis = V[(i + 1) % V.length]!;
    const here = P[vis.perch]!;
    const there = P[nextVis.perch]!;
    const x0 = here.x + vis.dx;
    const y0 = here.y + this.perchOffset(vis.perch, tt);

    if (tt < vis.tD) {
      // Dwelling. Last 320ms is the crouch; first 260ms the landing squash.
      const sinceA = tt - vis.tA;
      const untilD = vis.tD - tt;
      // While batting, the cat faces its target, not its next perch.
      let face = vis.face;
      if (vis.action === 'bat' && vis.batTarget >= 0) {
        face = this.victims[vis.batTarget]!.cx >= x0 ? 1 : -1;
      }
      const edge = clamp(Math.abs(vis.dx) / Math.max(1, here.halfW - 26), 0, 1);
      if (sinceA < 260) return { x: x0, y: y0, face, angle: 0, state: 'land', k: sinceA / 260, edge, visit: vis };
      if (untilD < 320) return { x: x0, y: y0, face: vis.face, angle: 0, state: 'crouch', k: 1 - untilD / 320, edge, visit: vis };

      // Pounce: stalk the moth, then a little out-and-back lunge at it.
      if (vis.action === 'pounce') {
        const tP0 = vis.tD - POUNCE_LEAD;
        if (tt < tP0) return { x: x0, y: y0, face, angle: 0, state: 'stalk', k: clamp(sinceA / Math.max(1, tP0 - vis.tA), 0, 1), edge, visit: vis };
        if (tt < tP0 + 420) {
          const u = (tt - tP0) / 420;
          return {
            x: x0 + face * 38 * Math.sin(Math.PI * u),
            y: y0 - 30 * Math.sin(Math.PI * u),
            face, angle: -0.25 * Math.sin(Math.PI * u), state: 'jump', k: u, edge, visit: vis,
          };
        }
        return { x: x0, y: y0, face, angle: 0, state: 'sit', k: 0.5, edge, visit: vis };
      }

      // Waking from a nap always earns the big stretch before moving on.
      if (vis.action === 'sleep' && untilD < 1240) {
        return { x: x0, y: y0, face: vis.face, angle: 0, state: 'stretch', k: (1240 - untilD) / 920, edge, visit: vis };
      }

      // The idle look-around: mid-sit, the cat turns to check the other way.
      if (vis.action === 'sit' || vis.action === 'groom') {
        const fr = sinceA / Math.max(1, vis.tD - vis.tA);
        const w0 = 0.4 + vis.quirk * 0.25;
        if (fr > w0 && fr < w0 + 0.13) face = -face;
      }
      return { x: x0, y: y0, face, angle: 0, state: vis.action, k: clamp((sinceA - 260) / Math.max(1, vis.tD - vis.tA - 580), 0, 1), edge, visit: vis };
    }

    // Airborne toward the next perch (which may be in the next loop).
    const jumpEnd = i === V.length - 1 ? this.loopD : nextVis.tA;
    const u = clamp((tt - vis.tD) / Math.max(1, jumpEnd - vis.tD), 0, 1);
    const x1 = there.x + nextVis.dx;
    const y1 = there.y; // target offset at landing instant is ~0 (spring starts then)
    const ux = lerp(x0, x1, smooth01(u));
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const arc = Math.max(46, dist * 0.32) * this.params.jumpArc + Math.max(0, y0 - y1) * 0.25;
    const uy = lerp(y0, y1, u) - arc * 4 * u * (1 - u);
    // Facing/pitch from the arc's derivative.
    const dyd = (y1 - y0) - arc * 4 * (1 - 2 * u);
    const dxd = (x1 - x0) || 0.001;
    return {
      x: ux, y: uy, face: dxd >= 0 ? 1 : -1,
      angle: clamp(Math.atan2(dyd, Math.abs(dxd)) * 0.5, -0.6, 0.6),
      state: 'jump', k: u, edge: 0, visit: vis,
    };
  }

  /**
   * Fallback performance when even the structural pass finds nothing to perch
   * on: the cat patrols the bottom edge of the screen, pausing to sit at each
   * end. Closed-form in `tt` like everything else — and it means this saver
   * can never degrade to a blank dark page.
   */
  private groundCat(tt: number): CatFrame {
    const half = 14_000; // one crossing
    const u = ((tt % (half * 2)) + half * 2) % (half * 2);
    const k = u < half ? u / half : 2 - u / half;
    const x = lerp(this.w * 0.08, this.w * 0.92, smooth01(k));
    const atEdge = k < 0.035 || k > 0.965;
    const bob = atEdge ? 0 : Math.abs(Math.sin(tt * 0.009)) * 2.4;
    return {
      x,
      y: this.h - 8 - bob,
      face: u < half ? 1 : -1,
      angle: 0,
      state: atEdge ? 'sit' : 'walk',
      k: 1,
      edge: 0,
      visit: GROUND_VISIT,
    };
  }

  /**
   * The prologue, evaluated at raw scaled time `tg` (0 ≤ tg < entrance.dur):
   * walk in from offscreen → crouch and gather → the first leap, whose arc
   * ends at the exact point and instant the loop's first landing begins.
   */
  private entranceAt(tg: number): CatFrame {
    const E = this.entrance!;
    const v0 = this.visits[0]!;
    const first = this.perches[v0.perch]!;
    const xLand = first.x + v0.dx;
    const groundY = this.h - 8;

    if (tg < E.walkD) {
      const k = clamp(tg / E.walkD, 0, 1);
      // Linear stride with a soft final step, so it settles into the crouch.
      const x = lerp(E.xStart, E.xTakeoff, k < 0.85 ? k : 0.85 + 0.15 * smooth01((k - 0.85) / 0.15));
      const bob = Math.abs(Math.sin(tg * 0.009)) * 2.4;
      return { x, y: groundY - bob, face: E.xTakeoff >= E.xStart ? 1 : -1, angle: 0, state: 'walk', k: 1, edge: 0, visit: GROUND_VISIT };
    }
    if (tg < E.walkD + E.crouchD) {
      const u = (tg - E.walkD) / E.crouchD;
      return { x: E.xTakeoff, y: groundY, face: xLand >= E.xTakeoff ? 1 : -1, angle: 0, state: 'crouch', k: u, edge: 0, visit: GROUND_VISIT };
    }
    // Airborne — same arc law as the itinerary jumps.
    const u = clamp((tg - E.walkD - E.crouchD) / E.jumpD, 0, 1);
    const dist = Math.hypot(xLand - E.xTakeoff, first.y - groundY);
    const arc = Math.max(46, dist * 0.32) * this.params.jumpArc + Math.max(0, groundY - first.y) * 0.25;
    const ux = lerp(E.xTakeoff, xLand, smooth01(u));
    const uy = lerp(groundY, first.y, u) - arc * 4 * u * (1 - u);
    const dyd = (first.y - groundY) - arc * 4 * (1 - 2 * u);
    const dxd = (xLand - E.xTakeoff) || 0.001;
    return {
      x: ux, y: uy, face: dxd >= 0 ? 1 : -1,
      angle: clamp(Math.atan2(dyd, Math.abs(dxd)) * 0.5, -0.6, 0.6),
      state: 'jump', k: u, edge: 0, visit: GROUND_VISIT,
    };
  }

  /** Apply perch reactions to the page. Only perches move; only changed strings write.
   *  `calm` holds every block at rest — the stage before the cat has arrived. */
  private applyPage(tt: number, calm = false): void {
    for (let i = 0; i < this.perches.length; i++) {
      const p = this.perches[i]!;
      const v = this.victims[p.v]!;
      const off = calm ? 0 : this.perchOffset(i, tt);
      // Kneading rocks the perch side to side under the alternating paws.
      let rock = 0;
      if (!calm) for (const vis of this.visits) {
        if ((vis.action !== 'knead' && vis.action !== 'roll') || vis.perch !== i) continue;
        if (tt < vis.tA + 400 || tt > vis.tD - 300) continue;
        const env = smooth01(clamp((tt - vis.tA - 400) / 500, 0, 1)) * smooth01(clamp((vis.tD - 300 - tt) / 500, 0, 1));
        // Kneading is a quick paw-rhythm rock; rolling is a slow, deeper sway.
        rock += vis.action === 'knead'
          ? Math.sin((tt - vis.tA) * (TAU / 700)) * 0.4 * p.give * env
          : Math.sin((tt - vis.tA) * (TAU / 1400)) * 0.7 * p.give * env;
      }
      let transform: string;
      if (Math.abs(off) < 0.05 && Math.abs(rock) < 0.02) {
        transform = v.prevTransform;
      } else {
        const rot = off * p.give * 0.06 * p.tiltSign + rock;
        transform = `translateY(${off.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`;
      }
      if (transform !== v.lastTransform) {
        v.el.style.transform = transform;
        v.lastTransform = transform;
      }
    }

    // Batted neighbours: each swat shoves the block sideways and it rings back.
    const D = this.loopD;
    for (const vis of this.visits) {
      if (vis.batTarget < 0) continue;
      const tgt = this.victims[vis.batTarget]!;
      const here = this.perches[vis.perch]!;
      const dir = tgt.cx >= here.x ? 1 : -1;
      let x = 0;
      if (!calm) for (let k = 0; k < 3; k++) {
        const sk = vis.tA + 900 + k * 1150 + 190; // paw contact, not swing start
        if (sk > vis.tD) break;
        const tau = ((((tt - sk) % D) + D) % D) / 1000;
        x += 11 * dir * swatSpring(tau);
      }
      const transform = Math.abs(x) < 0.05
        ? tgt.prevTransform
        : `translateX(${x.toFixed(1)}px) rotate(${(x * 0.45).toFixed(2)}deg)`;
      if (transform !== tgt.lastTransform) {
        tgt.el.style.transform = transform;
        tgt.lastTransform = transform;
      }
    }
  }

  // ---- loop ----
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
  }

  private loop(now: number): void {
    this.frameId = requestAnimationFrame((n) => this.loop(n));
    if (this.startT === 0) this.startT = now;
    this.renderFrame(now - this.startT, this.ctxSaver.seed);
  }

  private renderStill(): void {
    // A paused audience (reduced motion) must never see the empty
    // pre-entrance stage — park the still just after the arrival instead.
    const t = this.t === 0 && this.entrance ? (this.entrance.dur + 900) / Math.max(0.05, this.params.pace) : this.t;
    this.renderFrame(t, this.ctxSaver.seed);
  }

  // ---- draw ----
  private fur(): [number, number, number] {
    const k = this.params.tint;
    const sh = this.look.shade;
    return [
      Math.min(255, Math.round((16 + k * 189) * sh)),
      Math.min(255, Math.round((16 + k * 104) * sh)),
      Math.min(255, Math.round((20 + k * 25) * sh)),
    ];
  }

  private render(tt: number, cat: ReturnType<CatwalkInstance['catAt']> | null): void {
    const ctx = this.ctx;
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'source-over';

    // Night veil…
    const veil = this.params.veil;
    ctx.fillStyle = `rgba(5,7,16,${veil.toFixed(3)})`;
    ctx.fillRect(0, 0, this.w, this.h);

    if (!cat) return;

    // …with the cat's pool of light punched through it. The perch the cat is
    // on is the readable one; the rest of the page waits its turn.
    const R = Math.max(60, Math.min(this.w, this.h) * this.params.lightRadius);
    ctx.globalCompositeOperation = 'destination-out';
    const hole = ctx.createRadialGradient(cat.x, cat.y - 14, 0, cat.x, cat.y - 14, R);
    hole.addColorStop(0, 'rgba(0,0,0,0.96)');
    hole.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(cat.x, cat.y - 14, R, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // Warm lamplight tint inside the pool — and the purr: while the cat
    // kneads or sleeps, the light breathes with it. Kneading purrs at a
    // brisk ~1.2Hz; sleep is a slow ~0.45Hz swell. Closed-form in tt.
    let breathe = 0;
    const vis = cat.visit;
    if ((cat.state === 'sleep' || cat.state === 'knead') && tt >= vis.tA && tt < vis.tD) {
      const env = smooth01(clamp((tt - vis.tA - 600) / 900, 0, 1)) * smooth01(clamp((vis.tD - tt) / 700, 0, 1));
      const hz = cat.state === 'knead' ? 1.2 : 0.45;
      breathe = env * Math.sin(tt * 0.001 * hz * TAU);
    }
    const rw = R * 0.9 * (1 + 0.05 * breathe);
    const wa = 0.1 * (1 + 0.4 * breathe);
    ctx.globalCompositeOperation = 'lighter';
    const warmth = ctx.createRadialGradient(cat.x, cat.y - 14, 0, cat.x, cat.y - 14, rw);
    warmth.addColorStop(0, `rgba(255,214,150,${wa.toFixed(3)})`);
    warmth.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = warmth;
    ctx.beginPath();
    ctx.arc(cat.x, cat.y - 14, rw, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // Grounding shadow while it is on (or near) the perch.
    if (cat.state !== 'jump') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(cat.x, cat.y + 2, this.params.catSize * this.look.plump * 0.72, 3.4, 0, 0, TAU);
      ctx.fill();
    }

    // Paw prints trailing the floor patrol, fading behind it.
    if (cat.state === 'walk') {
      for (let k = 1; k <= 5; k++) {
        const px = cat.x - cat.face * k * 30;
        if (px < this.w * 0.05 || px > this.w * 0.95) continue;
        const a = (1 - k / 6) * 0.22;
        ctx.fillStyle = `rgba(200,218,248,${a.toFixed(3)})`;
        // Two beans per print, alternating left/right of the line of travel.
        const side = k % 2 === 0 ? 3 : -3;
        for (const [ox, oy] of [[0, side], [7 * cat.face, -side]] as const) {
          ctx.beginPath();
          ctx.ellipse(px + ox, cat.y - 2 + oy * 0.4, 2.1, 1.5, 0, 0, TAU);
          ctx.fill();
        }
      }
    }

    this.drawCat(tt, cat);
    this.drawEffects(tt, cat);
  }

  /** The cat itself: a silhouette built from ellipses and a live tail. */
  private drawCat(tt: number, cat: ReturnType<CatwalkInstance['catAt']>): void {
    const ctx = this.ctx;
    const s = this.params.catSize * this.look.plump;
    const [fr, fg, fb] = this.fur();
    const fur = `rgb(${fr},${fg},${fb})`;
    // A black cat on a dark page is invisible without this: a faint cool
    // moonlight rim traced over every fur shape.
    const rim = 'rgba(172,196,240,0.45)';

    // Pose: body length/height multipliers + head placement per state.
    let len = 1.15, ht = 1, headDrop = 0, tailLift = 1;
    if (cat.state === 'crouch') { const k = smooth01(cat.k); len = 1.15 + 0.1 * k; ht = 1 - 0.38 * k; tailLift = 1 + k; }
    else if (cat.state === 'land') { const k = 1 - smooth01(cat.k); len = 1.15 + 0.12 * k; ht = 1 - 0.3 * k; tailLift = 1.6; }
    else if (cat.state === 'jump') { const str = Math.sin(Math.PI * cat.k); len = 1.15 + 0.55 * str; ht = 1 - 0.28 * str; }
    else if (cat.state === 'stretch') { const k = Math.sin(Math.PI * clamp(cat.k, 0, 1)); len = 1.15 + 0.5 * k; ht = 1 - 0.22 * k; headDrop = 6 * k; }
    else if (cat.state === 'groom') { headDrop = 4 + 2.5 * Math.sin(tt * 0.012); }
    else if (cat.state === 'walk') { tailLift = 1.5; }
    else if (cat.state === 'stalk') {
      // Low and locked on, jaw chattering at the moth.
      len = 1.28; ht = 0.8; tailLift = 0.5;
      headDrop = 6 + Math.sin(tt * 0.045) * 1.2;
    }
    else if (cat.state === 'knead') { ht = 0.94 - 0.02 * Math.abs(Math.sin(tt * 0.009)); }
    else if (cat.state === 'bat') { headDrop = 3; }

    ctx.save();
    ctx.translate(cat.x, cat.y);
    ctx.rotate(cat.angle * cat.face);
    ctx.scale(cat.face, 1);

    // The pre-pounce butt-wiggle. Non-negotiable.
    if (cat.state === 'crouch') {
      const k = smooth01(cat.k);
      ctx.translate(Math.sin(tt * 0.026) * 1.7 * k, 0);
      ctx.rotate(Math.sin(tt * 0.026 + 0.8) * 0.045 * k);
    }

    if (cat.state === 'sleep') {
      // Curled: one mound, head tucked, tail wrapped round the front.
      const breathe = 1 + 0.025 * Math.sin(tt * 0.0021);
      ctx.fillStyle = fur;
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.34 * breathe, s * 0.62, s * 0.36 * breathe, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath(); // head resting on the mound's edge
      ctx.arc(s * 0.34, -s * 0.3, s * 0.24, 0, TAU);
      ctx.fill();
      ctx.stroke();
      // ear still up — cats sleep, cats listen
      this.ear(s * 0.4, -s * 0.5, s * 0.13, fur, 0.15 + 0.1 * Math.sin(tt * 0.0009));
      ctx.strokeStyle = fur;
      ctx.lineWidth = s * 0.14;
      ctx.lineCap = 'round';
      // Tail wrap — with a dream twitch every few seconds.
      const dph = (tt % 4200) / 4200;
      const twitch = dph < 0.07 ? Math.sin((dph / 0.07) * Math.PI) * 0.16 : 0;
      ctx.beginPath();
      ctx.arc(0, -s * 0.22, s * 0.58, 0.35, Math.PI * (0.92 + twitch));
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (cat.state === 'roll') {
      // Belly-up on a wide perch, paws in the air. Entry/exit fold the legs.
      const env = smooth01(clamp(Math.min(cat.k / 0.16, (1 - cat.k) / 0.16), 0, 1));
      ctx.fillStyle = fur;
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.32, s * 0.6, s * 0.34, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath(); // head lolling to the side
      ctx.arc(-s * 0.52, -s * 0.34 + (1 - env) * s * 0.1, s * 0.24, 0, TAU);
      ctx.fill();
      ctx.stroke();
      this.ear(-s * 0.62, -s * 0.54, s * 0.12, fur, 0.1);
      if (this.look.socks) {
        ctx.fillStyle = 'rgba(224,220,212,0.55)';
        ctx.beginPath();
        ctx.ellipse(0, -s * 0.3, s * 0.34, s * 0.19, 0, 0, TAU);
        ctx.fill();
      }
      // Four paws up, wiggling — the whole point of the manoeuvre.
      ctx.strokeStyle = fur;
      ctx.lineWidth = s * 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const px = -s * 0.28 + i * s * 0.19;
        const wig = Math.sin(tt * 0.008 + i * 1.9) * s * 0.06 * env;
        ctx.moveTo(px, -s * 0.55);
        ctx.lineTo(px + wig, -s * 0.55 - s * 0.26 * env);
      }
      ctx.stroke();
      // Tail flopped out along the perch.
      ctx.beginPath();
      ctx.moveTo(s * 0.55, -s * 0.24);
      ctx.quadraticCurveTo(s * 0.85, -s * 0.3 - Math.sin(tt * 0.003) * s * 0.08, s * 1.02, -s * 0.12);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const bl = s * len;
    const bh = s * ht;
    // Body.
    ctx.fillStyle = fur;
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(0, -bh * 0.52, bl * 0.5, bh * 0.42, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // Haunch (rear mass) — reads "cat", not "blob".
    ctx.beginPath();
    ctx.ellipse(-bl * 0.3, -bh * 0.48, bl * 0.26, bh * 0.46, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // Head.
    const hx = bl * 0.44;
    const hy = -bh * 0.95 + headDrop;
    const hr = s * 0.27;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, TAU);
    ctx.fill();
    ctx.stroke();
    this.ear(hx - hr * 0.55, hy - hr * 0.72, hr * 0.55, fur, 0);
    this.ear(hx + hr * 0.45, hy - hr * 0.78, hr * 0.55, fur, 0.06 * Math.sin(tt * 0.0013 + 2));
    // Legs.
    if (cat.state === 'walk') {
      // Two visible pairs, swinging in opposite phase — an actual gait.
      ctx.strokeStyle = fur;
      ctx.lineWidth = s * 0.13;
      ctx.lineCap = 'round';
      const step = Math.sin(tt * 0.011);
      ctx.beginPath();
      ctx.moveTo(bl * 0.34, -bh * 0.4);
      ctx.lineTo(bl * 0.34 + step * s * 0.16, 0);
      ctx.moveTo(bl * 0.44, -bh * 0.4);
      ctx.lineTo(bl * 0.44 - step * s * 0.16, 0);
      ctx.moveTo(-bl * 0.3, -bh * 0.4);
      ctx.lineTo(-bl * 0.3 - step * s * 0.14, 0);
      ctx.moveTo(-bl * 0.2, -bh * 0.4);
      ctx.lineTo(-bl * 0.2 + step * s * 0.14, 0);
      ctx.stroke();
    } else if (cat.state === 'groom') {
      // One paw up, working behind an ear; the other planted.
      ctx.strokeStyle = fur;
      ctx.lineWidth = s * 0.13;
      ctx.lineCap = 'round';
      const lick = Math.sin(tt * 0.012);
      ctx.beginPath();
      ctx.moveTo(bl * 0.44, -bh * 0.4);
      ctx.lineTo(bl * 0.46, 0);
      ctx.moveTo(bl * 0.3, -bh * 0.38);
      ctx.quadraticCurveTo(bl * 0.5, -bh * 0.62, hx + hr * 0.2, hy + hr * (0.9 + 0.18 * lick));
      ctx.stroke();
      ctx.fillStyle = fur;
      ctx.beginPath();
      ctx.arc(hx + hr * 0.2, hy + hr * (0.9 + 0.18 * lick), s * 0.09, 0, TAU);
      ctx.fill();
    } else if (cat.state === 'knead') {
      // Making biscuits: the front paws pump alternately.
      ctx.strokeStyle = fur;
      ctx.lineWidth = s * 0.13;
      ctx.lineCap = 'round';
      const pump = Math.sin(tt * 0.009);
      ctx.beginPath();
      ctx.moveTo(bl * 0.3, -bh * 0.4);
      ctx.lineTo(bl * 0.32, -Math.max(0, pump) * s * 0.12);
      ctx.moveTo(bl * 0.44, -bh * 0.4);
      ctx.lineTo(bl * 0.46, -Math.max(0, -pump) * s * 0.12);
      ctx.stroke();
    } else if (cat.state === 'bat') {
      // One paw planted, the other swatting at the neighbour block.
      ctx.strokeStyle = fur;
      ctx.lineWidth = s * 0.13;
      ctx.lineCap = 'round';
      const vis = cat.visit;
      let ext = 0;
      for (let k = 0; k < 3; k++) {
        const sk = vis.tA + 900 + k * 1150;
        ext = Math.max(ext, Math.sin(Math.PI * clamp((tt - sk) / 380, 0, 1)));
      }
      ctx.beginPath();
      ctx.moveTo(bl * 0.28, -bh * 0.4);
      ctx.lineTo(bl * 0.3, 0);
      ctx.moveTo(bl * 0.42, -bh * 0.42);
      ctx.lineTo(bl * (0.48 + ext * 0.5), -bh * (0.12 - ext * 0.04) + ext * s * 0.1);
      ctx.stroke();
      ctx.fillStyle = fur;
      ctx.beginPath();
      ctx.arc(bl * (0.48 + ext * 0.5), -bh * (0.12 - ext * 0.04) + ext * s * 0.1, s * 0.09, 0, TAU);
      ctx.fill();
    } else if (cat.state !== 'jump') {
      ctx.strokeStyle = fur;
      ctx.lineWidth = s * 0.13;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bl * 0.3, -bh * 0.4);
      ctx.lineTo(bl * 0.32, 0);
      ctx.moveTo(bl * 0.44, -bh * 0.4);
      ctx.lineTo(bl * 0.46, 0);
      ctx.stroke();
    }
    // Markings: a white chest patch and sock paws, for the cats that have them.
    if (this.look.socks) {
      ctx.fillStyle = 'rgba(224,220,212,0.8)';
      ctx.beginPath();
      ctx.ellipse(bl * 0.36, -bh * 0.55, s * 0.1, s * 0.15, -0.3, 0, TAU);
      ctx.fill();
      if (cat.state !== 'jump') {
        for (const px of [bl * 0.32, bl * 0.46]) {
          ctx.beginPath();
          ctx.ellipse(px, -s * 0.03, s * 0.065, s * 0.045, 0, 0, TAU);
          ctx.fill();
        }
      }
    }

    // Whiskers — three hairlines catching the moonlight.
    ctx.strokeStyle = 'rgba(200,218,248,0.4)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const dy of [-0.05, 0.08, 0.21]) {
      ctx.moveTo(hx + hr * 0.55, hy + hr * (dy + 0.1));
      ctx.lineTo(hx + hr * 1.75, hy + hr * (dy * 2.6));
    }
    ctx.stroke();
    // Tail: a live quadratic, flicking faster when the cat is locked on.
    const flick = cat.state === 'crouch' ? 0.006 : cat.state === 'stalk' || cat.state === 'bat' ? 0.009 : 0.0022;
    const sway = Math.sin(tt * flick) * 0.55 + Math.sin(tt * flick * 2.7 + 1) * 0.2;
    ctx.strokeStyle = fur;
    ctx.lineWidth = s * 0.12;
    ctx.lineCap = 'round';
    const tl = this.look.tail;
    ctx.beginPath();
    if (cat.state === 'sit' && cat.edge > 0.72) {
      // Sitting on the very end of its perch: the tail hangs off the ledge,
      // swinging slow below the block. Sells the furniture harder than the
      // landing spring does.
      const hang = Math.sin(tt * 0.0016 + cat.visit.quirk * 5) * s * 0.14;
      ctx.moveTo(-bl * 0.5, -bh * 0.5);
      ctx.quadraticCurveTo(
        -bl * 0.72 * tl, -bh * 0.05,
        -bl * 0.66 * tl + hang, s * (0.55 * tl),
      );
    } else {
      ctx.moveTo(-bl * 0.5, -bh * 0.5);
      ctx.quadraticCurveTo(
        -bl * 0.78 * tl, -bh * (0.55 + 0.4 * tailLift) - sway * s * 0.2,
        -bl * (0.86 + 0.08 * sway) * tl, -bh * (0.2 + (0.75 * tailLift + 0.3 * sway) * tl),
      );
    }
    ctx.stroke();

    // Eyes: two lamps in the dark. Blink is a pure function of tt.
    const glow = this.params.eyeGlow;
    const blink = ((tt * 0.00021 + cat.visit.perch * 0.37) % 1) < 0.035;
    // The slow-blink: mid-sit, both eyes narrow to slits for half a second.
    // Cat people know exactly what this means.
    let slitK = 1;
    if (cat.state === 'sit' && cat.visit.tD > cat.visit.tA) {
      const fr = (tt - cat.visit.tA) / (cat.visit.tD - cat.visit.tA);
      const w0 = 0.16 + cat.visit.quirk * 0.18;
      if (fr > w0 && fr < w0 + 0.09) slitK = 0.2 + 0.1 * Math.abs(Math.sin(((fr - w0) / 0.09) * Math.PI));
    }
    if (glow > 0.02 && !blink && cat.state !== 'jump') {
      ctx.globalCompositeOperation = 'lighter';
      const ea = (0.85 * Math.min(1, glow)).toFixed(3);
      for (const [ex, col] of [
        [hx + hr * 0.28, this.look.eyeL],
        [hx + hr * 0.72, this.look.eyeR],
      ] as const) {
        ctx.fillStyle = col.replace('$A', ea);
        ctx.beginPath();
        ctx.ellipse(ex, hy - hr * 0.08, hr * 0.1, hr * 0.16 * slitK, 0, 0, TAU);
        ctx.fill();
      }
      if (glow > 1) {
        ctx.fillStyle = this.look.eyeL.replace('$A', ((glow - 1) * 0.25).toFixed(3));
        ctx.beginPath();
        ctx.arc(hx + hr * 0.5, hy, hr * 0.9, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  private ear(x: number, y: number, r: number, fur: string, tip: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.7, y + r * 0.5);
    ctx.lineTo(x + tip * r, y - r);
    ctx.lineTo(x + r * 0.7, y + r * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  /** Landing dust and sleeping Zzz — both closed-form from itinerary times. */
  private drawEffects(tt: number, cat: ReturnType<CatwalkInstance['catAt']>): void {
    // Floor patrol has no itinerary — no landings, no naps, nothing to draw.
    if (!this.visits.length || !this.loopD) return;
    const ctx = this.ctx;
    const D = this.loopD;
    const vis = cat.visit;
    const here = this.perches[vis.perch]!;

    // Dust puff at the landing point, 500ms of life.
    const dustGain = this.params.dust;
    if (dustGain > 0.02) {
      const tau = ((((tt - vis.tA) % D) + D) % D) / 1000;
      if (tau < 0.5) {
        const k = tau / 0.5;
        const a = (1 - k) * 0.5 * dustGain;
        ctx.fillStyle = `rgba(190,180,160,${a.toFixed(3)})`;
        for (let i = 0; i < 6; i++) {
          const ang = Math.PI + (i / 5) * Math.PI; // fan along the perch top
          const r = 6 + k * 26;
          ctx.beginPath();
          ctx.arc(
            here.x + vis.dx + Math.cos(ang) * r * 1.4,
            here.y - 2 - Math.abs(Math.sin(ang)) * r * 0.35,
            1.6 + k * 2.4, 0, TAU,
          );
          ctx.fill();
        }
      }
    }

    // Zzz while asleep: one glyph every 1.7s, rising and fading.
    if (cat.state === 'sleep') {
      const since = tt - vis.tA - 260;
      ctx.fillStyle = 'rgba(200,220,255,0.0)';
      for (let k = 0; k < 3; k++) {
        const age = ((since / 1700 - k * 0.33) % 1 + 1) % 1;
        if (age < 0 || since < 0) continue;
        const a = Math.sin(age * Math.PI) * 0.55;
        if (a < 0.03) continue;
        const size = 9 + k * 3 + age * 6;
        ctx.font = `${size}px ui-monospace, monospace`;
        ctx.fillStyle = `rgba(200,222,255,${a.toFixed(3)})`;
        ctx.fillText('z', cat.x + 16 + k * 7 + age * 10, cat.y - this.params.catSize - 8 - age * 34 - k * 8);
      }
    }

    // Emotes: a startled "!" when the moth is spotted; a curious "?" during
    // the mid-sit look-around. Both pop, hold, and fade — pure in tt.
    const emote = (ch: string, k: number, color: string): void => {
      const pop = k < 0.25 ? smooth01(k / 0.25) : 1;
      const fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      const a = 0.85 * pop * fade;
      if (a < 0.03) return;
      ctx.font = `bold ${Math.round(11 + pop * 4)}px ui-monospace, monospace`;
      ctx.fillStyle = color.replace('$A', a.toFixed(3));
      ctx.fillText(ch, cat.x + cat.face * 14, cat.y - this.params.catSize - 14 - k * 6);
    };
    if (vis.action === 'pounce') {
      const k = (tt - vis.tA - 320) / 900;
      if (k >= 0 && k <= 1) emote('!', k, 'rgba(255,214,140,$A)');
    }
    if (vis.favorite) {
      const k = (tt - vis.tA - 300) / 1200;
      if (k >= 0 && k <= 1) emote('\u2665', k, 'rgba(255,158,186,$A)');
    }
    if (vis.action === 'sit' || vis.action === 'groom') {
      const fr = (tt - vis.tA) / Math.max(1, vis.tD - vis.tA);
      const w0 = 0.4 + vis.quirk * 0.25;
      if (fr > w0 && fr < w0 + 0.13) emote('?', (fr - w0) / 0.13, 'rgba(190,214,255,$A)');
    }

    // The moth: circles just out of reach while the cat stalks, escapes the
    // pounce, and flutters off. Closed-form from the pounce timeline.
    if (vis.action === 'pounce') {
      const tP0 = vis.tD - POUNCE_LEAD;
      const mx0 = here.x + vis.dx + cat.face * 46;
      const my0 = here.y - 24;
      let mx = -1, my = 0, ma = 0;
      if (tt >= vis.tA + 300 && tt < tP0 + 140) {
        // Orbiting temptation.
        mx = mx0 + Math.cos(tt * 0.004 + vis.quirk * 6) * 11;
        my = my0 + Math.sin(tt * 0.0063 + vis.quirk * 3) * 9;
        ma = 0.75;
      } else if (tt >= tP0 + 140 && tt < tP0 + 1000) {
        // It saw that coming.
        const f = (tt - tP0 - 140) / 860;
        mx = mx0 + cat.face * f * 130;
        my = my0 - f * 90 + Math.sin(f * 22) * 6;
        ma = 0.75 * (1 - f);
      }
      if (ma > 0.03) {
        ctx.fillStyle = `rgba(235,228,180,${ma.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(mx, my, 2, 0, TAU);
        ctx.fill();
        // Wing flicker.
        const wf = Math.sin(tt * 0.05) * 3;
        ctx.strokeStyle = `rgba(235,228,180,${(ma * 0.6).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mx - wf, my - 2.5);
        ctx.lineTo(mx, my);
        ctx.lineTo(mx + wf, my - 2.5);
        ctx.stroke();
      }
    }

    // A contented heart while grooming, one every ~2.6s.
    if (cat.state === 'groom') {
      const since = tt - vis.tA - 260;
      const age = ((since / 2600) % 1 + 1) % 1;
      if (since > 0) {
        const a = Math.sin(age * Math.PI) * 0.5;
        if (a > 0.03) {
          ctx.font = `${10 + age * 5}px ui-monospace, monospace`;
          ctx.fillStyle = `rgba(255,158,186,${a.toFixed(3)})`;
          ctx.fillText('♥', cat.x + cat.face * 20, cat.y - this.params.catSize - 6 - age * 28);
        }
      }
    }
  }

  // ---- SaverInstance ----
  setPaused(paused: boolean): void {
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
    if (dpr !== undefined) this.ctxSaver.dpr = dpr;
    this.restoreVictims();
    this.sizeCanvas();
    this.collectVictims();
    if (this.paused) this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
    if (this.paused) this.renderStill();
  }

  /** The practical composition stack, bottom-up. */
  composition(): SaverLayer[] {
    return [
      { id: 'page', label: 'Stage page', kind: 'page', description: 'Perches spring, sag and rock under the cat; batted neighbours ring back. Fully restored on dispose.' },
      { id: 'surface', label: 'Night canvas', kind: 'surface', el: this.canvas, description: 'Everything the cat adds over the page.' },
      { id: 'veil', label: 'Veil & lamplight pool', kind: 'pass' },
      { id: 'cat', label: 'The cat', kind: 'pass' },
      { id: 'effects', label: 'Dust, Zzz, moth, purr & emotes', kind: 'pass' },
    ];
  }

  /**
   * Pure, frame-addressable render at logical time `t` — canvas AND page.
   * The itinerary is fixed at collect time; everything else is a function of
   * the loop clock, so seeking backwards reproduces the frame exactly.
   */
  renderFrame(t: number, _seed: number): void {
    this.t = t;
    this.applyParams(t);
    if (!this.loopD || this.visits.length === 0) {
      // No perches to tour — the cat still shows up and patrols the floor,
      // so a selector-poor page is never just a dark veil.
      const tg = t * this.params.pace;
      this.render(tg, this.groundCat(tg));
      return;
    }
    const tg = t * this.params.pace;
    const E = this.entrance;
    if (E && tg < E.dur) {
      // The prologue: at t=0 there is no cat. The stage rests until it lands.
      this.applyPage(0, true);
      this.render(tg, this.entranceAt(tg));
      return;
    }
    const tLoop = E ? tg - E.dur : tg;
    const tt = (tLoop % this.loopD + this.loopD) % this.loopD;
    this.applyPage(tt);
    const cat = this.catAt(tt);
    // The cat rides its perch: catAt already reads perchOffset for its y.
    this.render(tt, cat);
  }

  dispose(): void {
    this.stop();
    this.restoreVictims();
    this.canvas.remove();
  }
}

/** The catwalk saver plugin. */
export const catwalk: SaverPlugin = {
  manifest: catwalkManifest,
  mount: (ctx: SaverContext) => new CatwalkInstance(ctx),
};

/** A demo control-track: dusk falls, the pool of light tightens around the cat,
 *  its eyes come up, and the night relaxes again. Deterministic. */
export const demoTrack: ControlTrack = {
  program: 'catwalk',
  seed: 9,
  duration: 24000,
  loop: true,
  deltas: [
    { t: 0, path: 'veil', value: 0.45 },
    { t: 12000, path: 'veil', value: 0.85, ease: 'smooth' },
    { t: 24000, path: 'veil', value: 0.45, ease: 'smooth' },
    { t: 0, path: 'lightRadius', value: 0.7 },
    { t: 12000, path: 'lightRadius', value: 0.24, ease: 'smooth' },
    { t: 24000, path: 'lightRadius', value: 0.7, ease: 'smooth' },
    { t: 0, path: 'eyeGlow', value: 0.5 },
    { t: 12000, path: 'eyeGlow', value: 1.6, ease: 'smooth' },
    { t: 24000, path: 'eyeGlow', value: 0.5, ease: 'smooth' },
    { t: 0, path: 'pace', value: 0.85 },
    { t: 12000, path: 'pace', value: 1.3, ease: 'smooth' },
    { t: 24000, path: 'pace', value: 0.85, ease: 'smooth' },
  ],
};
