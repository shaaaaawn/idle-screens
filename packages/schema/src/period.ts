/**
 * The scene's own repeat period — how long until every frame comes round
 * again — read analytically from the spec, never by rendering.
 *
 * A scene is a pure function of time, so it repeats exactly when every
 * time-varying part does: each periodic part contributes its period, and the
 * scene's is their least common multiple (in whole ms). Anything that never
 * repeats — a seeded speed range, a drift that wraps at a per-entity speed,
 * a `life` build, a non-looping timeline, a self-typing reveal, animated
 * grain — makes the scene aperiodic, and the reason says which part. A scene
 * with nothing time-varying is static: every frame is the same (period 0).
 *
 * Who reads it: an export that wants an exact loop (#84), and the
 * `loop-seam` advisory, which fires only when a scene declares a looping
 * timeline whose lap the rest of the scene does not divide.
 */
import type { LayerSpec, SaverSpec, SpriteSpec } from './types';
import { FIELD_BUCKET_MS } from './field';
import { DEFAULT_POLYGON_SIDES, drawSpan, isPathPolygon, pathParts } from './shapes';
import { spriteVariants } from './simulate';
import { withoutTimeline } from './timeline';

/** Periods that share no cycle shorter than this are reported as aperiodic. */
export const MAX_SCENE_PERIOD = 3_600_000; // ms — an hour

export interface ScenePeriod {
  /** ms until the scene repeats exactly; 0 for a static scene; null when it never does (within an hour). */
  period: number | null;
  /** One line per part that sets or breaks the period, e.g. `layers[2] pulse: 4000 ms`. */
  parts: string[];
  /** What drives each of `parts`, index for index: `pulse`, `grow`, `rock`, `spin`, `path`, `orbit`, `emit`, `cycle`, `caret`, `background`, `timeline`. */
  kinds: PeriodKind[];
  /** Why it is null (empty otherwise). */
  reasons: string[];
}

export type PeriodKind = 'timeline' | 'background' | 'pulse' | 'grow' | 'rock' | 'emit' | 'spin' | 'cycle' | 'caret' | 'path' | 'orbit';

/**
 * Periodic parts that run on scene time and change smoothly, so a looping
 * timeline's wrap never makes them jump: they carry on through it. A lap
 * that does not divide their period still loops seamlessly on screen — only
 * an exact export of one lap would differ (F145, X725, X823).
 */
export const SEAMLESS_PERIOD_KINDS: ReadonlySet<PeriodKind> = new Set(['spin', 'rock', 'pulse', 'grow']);

/** Spec-path leaves that set how fast or how often something repeats (a key on one makes the period itself time-varying). */
const PERIOD_LEAF = /(^|\.)(period|rate|every|duration|spin|speed|blink|drift)$/;

const gcd = (a: number, b: number): number => { while (b) [a, b] = [b, a % b]; return a; };

/** ms as a reduced ratio [num, den], den ≤ 1000 — or null when it is not one (an irrational-looking rate). */
function toRatio(ms: number): [number, number] | null {
  for (let q = 1; q <= 1000; q++) {
    const p = ms * q;
    if (Math.abs(p - Math.round(p)) < 1e-6) {
      const n = Math.round(p);
      const g = gcd(n, q);
      return [n / g, q / g];
    }
  }
  return null;
}

const range = (r: number | [number, number] | undefined): number | null =>
  r === undefined ? null : typeof r === 'number' ? r : r[0] === r[1] ? r[0] : NaN;

/**
 * The repeat period of `spec` — see the module comment. `skip` leaves out the
 * periodic parts of those kinds, as if they were static (the loop-seam
 * advisory passes `SEAMLESS_PERIOD_KINDS`).
 */
export function scenePeriod(spec: SaverSpec, skip?: ReadonlySet<PeriodKind>): ScenePeriod {
  // Each part's period as an exact ratio num/den ms, so a part that repeats
  // between whole milliseconds (`spin: 7` → 360000/7) still combines exactly.
  const parts: Array<[string, number, number, PeriodKind]> = [];
  const reasons: string[] = [];
  const add = (label: string, ms: number, kind: PeriodKind): void => {
    if (!(ms > 0) || !Number.isFinite(ms) || skip?.has(kind)) return;
    const ratio = toRatio(ms);
    if (!ratio) reasons.push(`${label} repeats every ${Number(ms.toFixed(3))} ms, which has no exact ratio to combine`);
    else parts.push([label, ratio[0], ratio[1], kind]);
  };

  const tl = spec.timeline;
  if (tl && tl.keys.length > 0) {
    // A key that moves a period, rate or speed changes where the scene is in
    // its cycle for as long as it glides, so one lap is no longer one cycle.
    const keyed = tl.keys.filter((k) => PERIOD_LEAF.test(String(k.path)));
    if (keyed.length > 0) reasons.push(`timeline keys animate ${[...new Set(keyed.map((k) => String(k.path)))].join(', ')}, which sets the scene's own period`);
    if (tl.loop && (tl.duration ?? 0) > 0) add('timeline', tl.duration!, 'timeline');
    else reasons.push('timeline does not loop (it plays once, then holds)');
  }
  const bg = spec.background;
  // A field with `drift.amount: 0` is held still (one raster, ever), so its
  // drift period moves nothing. A gradient's amount is always > 0.
  if (bg && bg.type !== 'solid' && bg.drift && !(bg.type === 'field' && bg.drift.amount === 0)) {
    // A field is rastered once per bucket and held, so it repeats only on a
    // whole number of buckets as well as of drift periods; a gradient's
    // drift is sampled continuously.
    const { period } = bg.drift;
    const r = bg.type === 'field' ? toRatio(period) : null;
    add('background drift', r ? (r[0] / gcd(r[0], FIELD_BUCKET_MS)) * FIELD_BUCKET_MS : period, 'background');
  }
  if (spec.finish?.animate && ((spec.finish.grain ?? 0) > 0 || (spec.finish.dither ?? 0) > 0)) reasons.push('finish.animate steps the grain without repeating');

  spec.layers.forEach((layer: LayerSpec, i) => {
    const at = `layers[${i}]${layer.key ? ` (${layer.key})` : ''}`;
    const rate = layer.clock?.rate ?? 1;
    const life = layer.life;
    // `stagger` shifts entity i's enter by i × stagger, so even an instant
    // enter at 0 builds the layer up once when it draws more than one entity.
    // The drawn count is round(count × countScale), which depends on the
    // viewport (a `count: 1` layer draws several at 4K, `count: 2` draws one
    // small), and this period is viewport-independent, so any stagger counts.
    const staggered = (life?.stagger ?? 0) > 0;
    if (life && (life.exit !== undefined || (life.enter !== undefined && ((life.enter ?? 0) > 0 || (life.fade ?? 1000) > 0 || staggered)))) reasons.push(`${at} life builds in or out once`);
    if (layer.pulse && layer.pulse.amp !== 0) add(`${at} pulse`, layer.pulse.period / rate, 'pulse');
    if (layer.grow) add(`${at} grow`, layer.grow.period / rate, 'grow');
    if (layer.rock) add(`${at} rock`, layer.rock.period / rate, 'rock');
    if (layer.emit) add(`${at} emit`, layer.emit.every, 'emit');
    const spin = range(layer.spin);
    // A drawing that is n-fold symmetric about its pivot looks the same every 360°/n
    // of spin (X709); a circle or ring never shows its spin at all.
    const fold = spin !== null && spin !== 0 ? spinSymmetry(layer.sprite) : 1;
    if (spin !== null && fold !== Infinity) {
      if (Number.isNaN(spin)) reasons.push(`${at} spin range gives each entity its own speed`);
      else if (spin !== 0) add(`${at} spin${fold > 1 ? ` (${fold}-fold)` : ''}`, 360000 / Math.abs(spin) / fold, 'spin');
    }
    const sp = layer.sprite;
    if ((sp.kind === 'emoji' || sp.kind === 'text') && sp.cycle && spriteVariants(sp) > 1) add(`${at} cycle`, (sp.cycle.period * spriteVariants(sp)) / rate, 'cycle');
    if (sp.kind === 'textBlock' && sp.reveal) {
      if ((sp.reveal.speed ?? 0) > 0) reasons.push(`${at} reveal types itself once`);
      if (sp.reveal.caret) {
        const hz = Math.min(3, sp.reveal.caret === true ? 1.2 : sp.reveal.caret.blink ?? 1.2);
        if (hz > 0) add(`${at} caret`, 1000 / hz, 'caret');
      }
    }
    const m = layer.motion;
    if (m.type === 'path') add(`${at} path`, m.duration, 'path');
    else if (m.type === 'orbit') {
      const s = range(m.speed);
      if (s === null || Number.isNaN(s)) reasons.push(`${at} orbit speed range gives each entity its own lap`);
      else if (s !== 0) add(`${at} orbit`, 360000 / Math.abs(s), 'orbit');
    } else if (m.type !== 'static') {
      if (m.type === 'drift' && m.ease?.type === 'settle' && !layer.emit) reasons.push(`${at} drift settles once`);
      else reasons.push(`${at} ${m.type} motion travels at seeded per-entity speeds`);
    }
  });

  const labelled = parts.map(([l, n, d]) => `${l}: ${Number((n / d).toFixed(3))} ms`);
  const kinds = parts.map(([, , , k]) => k);
  if (reasons.length > 0) return { period: null, parts: labelled, kinds, reasons };
  const combined = combinePeriods(parts);
  return { ...combined, parts: labelled, kinds };
}

/**
 * The common period of parts given as reduced ratios n/d ms: lcm(nᵢ) / gcd(dᵢ).
 * 0 for no parts; null (with the reason) past an hour or off whole milliseconds.
 */
function combinePeriods(parts: ReadonlyArray<readonly [string, number, number, ...unknown[]]>): { period: number | null; reasons: string[] } {
  if (parts.length === 0) return { period: 0, reasons: [] };
  let num = 1;
  let den = 0;
  for (const [, n, d] of parts) {
    num = (num / gcd(num, n)) * n;
    den = gcd(den, d);
    if (num / den > MAX_SCENE_PERIOD) {
      return { period: null, reasons: [`its parts share no cycle shorter than ${MAX_SCENE_PERIOD / 60000} min`] };
    }
  }
  if (num % den !== 0) return { period: null, reasons: [`its parts repeat together every ${Number((num / den).toFixed(3))} ms, not a whole number of milliseconds`] };
  return { period: num / den, reasons: [] };
}

/**
 * The period of everything in the scene except its timeline — what a
 * looping timeline's lap has to be a multiple of for one lap to loop
 * seamlessly.
 */
export function periodWithoutTimeline(spec: SaverSpec, skip?: ReadonlySet<PeriodKind>): ScenePeriod {
  return scenePeriod(withoutTimeline(spec), skip);
}

/** Largest n tried for a drawing's rotational symmetry. */
const MAX_SYMMETRY = 64;
/** Outline segments a symmetry check will look at; past it a drawing is taken as asymmetric. */
const MAX_SYMMETRY_POINTS = 8192;

type Seg = [number, number, number, number];

/**
 * How many-fold rotationally symmetric a sprite's drawing is about the point
 * `spin` turns it on: a spinning layer looks the same again after 360°/n,
 * so its spin repeats n times a lap (X709). `Infinity` for a circle or ring
 * (spin never shows); 1 when no symmetry is found, or the drawing has
 * something the check does not model (a gradient, a part-drawn stroke, a
 * stretched `span`, a soft fill off its pivot) — 1 is the old behaviour, a
 * period that is never too short.
 *
 * Regular `sides` n-gons are n-fold. For `points` and path drawings, each
 * paint (fill colour and rule, stroke colour and width, opacity) is checked
 * on its own: every vertex and segment midpoint of its outline, turned by
 * ±360°/n, must lie on that same paint's outline, to within 0.2 % of the
 * drawing's radius — sub-pixel, past the path flattener's own error. Draw
 * order between overlapping parts is not modelled.
 */
export function spinSymmetry(sp: SpriteSpec): number {
  if (sp.kind === 'circle' || sp.kind === 'ring') return Infinity;
  if (sp.kind !== 'polygon' || sp.gradient) return 1;
  if (!isPathPolygon(sp)) {
    if (sp.points && sp.points.length >= 3) return largestSymmetry(new Map([['fill', closedSegs(sp.points)]]));
    return Math.max(3, Math.round(sp.sides ?? DEFAULT_POLYGON_SIDES));
  }
  if ((sp.span ?? 'box') !== 'box') return 1;
  const [ox, oy] = sp.origin ?? [0, 0];
  // A soft fill is a radial ramp about the drawing's own (0, 0), not the pivot.
  if (sp.soft && !sp.parts && (ox !== 0 || oy !== 0)) return 1;
  const groups = new Map<string, Seg[]>();
  const add = (key: string, segs: Seg[]): void => {
    const list = groups.get(key);
    if (list) list.push(...segs);
    else groups.set(key, segs);
  };
  const shift = (pts: Array<[number, number]>): Array<[number, number]> => pts.map(([x, y]) => [x - ox, y - oy]);
  for (const part of pathParts(sp)) {
    if (part.gradient || (part.stroke && drawSpan(part.stroke.draw) !== null)) return 1;
    const colour = part.color ?? '*';
    if (part.fill && part.flat.points.length >= 3) {
      for (const l of part.flat.lines) if (l.points.length >= 3) add(`F|${colour}|${part.rule}|${part.opacity}`, closedSegs(shift(l.points)));
    }
    const st = part.stroke;
    if (st) {
      const key = `S|${st.color}|${st.width}|${st.opacity ?? 1}|${st.join ?? ''}|${st.cap ?? ''}|${part.opacity}`;
      for (const l of part.flat.lines) {
        const pts = shift(l.points);
        add(key, l.closed ? closedSegs(pts) : openSegs(pts));
      }
    }
  }
  return largestSymmetry(groups);
}

function closedSegs(pts: Array<[number, number]>): Seg[] {
  return pts.map(([x, y], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    return [x, y, x2, y2];
  });
}

function openSegs(pts: Array<[number, number]>): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]]);
  return out;
}

/** The largest n in 2..64 that maps every paint's outline onto itself (see `spinSymmetry`), else 1. */
function largestSymmetry(groups: Map<string, Seg[]>): number {
  let radius = 0;
  let total = 0;
  for (const segs of groups.values()) {
    total += segs.length;
    for (const [ax, ay, bx, by] of segs) radius = Math.max(radius, Math.hypot(ax, ay), Math.hypot(bx, by));
  }
  if (radius === 0 || total === 0 || total > MAX_SYMMETRY_POINTS) return 1;
  const eps = Math.max(2e-3 * radius, 2e-3);
  const indexed = [...groups.values()].map((segs) => ({ grid: segGrid(segs, radius, eps), probes: segs.flatMap(([ax, ay, bx, by]): Array<[number, number]> => [[ax, ay], [(ax + bx) / 2, (ay + by) / 2]]) }));
  for (let n = MAX_SYMMETRY; n >= 2; n--) {
    const a = (2 * Math.PI) / n;
    if (indexed.every(({ grid, probes }) => [a, -a].every((t) => {
      const c = Math.cos(t);
      const s = Math.sin(t);
      return probes.every(([x, y]) => grid.near(x * c - y * s, x * s + y * c));
    }))) return n;
  }
  return 1;
}

/** A uniform grid over [−radius, radius]² holding each segment in every cell its ε-widened box touches. */
function segGrid(segs: Seg[], radius: number, eps: number): { near: (x: number, y: number) => boolean } {
  const n = Math.max(1, Math.min(128, Math.ceil(Math.sqrt(segs.length) * 2)));
  const lo = -radius - eps;
  const size = (2 * (radius + eps)) / n;
  const cellOf = (v: number): number => Math.max(0, Math.min(n - 1, Math.floor((v - lo) / size)));
  const cells: Seg[][] = Array.from({ length: n * n }, () => []);
  for (const sg of segs) {
    const [ax, ay, bx, by] = sg;
    for (let cy = cellOf(Math.min(ay, by) - eps); cy <= cellOf(Math.max(ay, by) + eps); cy++) {
      for (let cx = cellOf(Math.min(ax, bx) - eps); cx <= cellOf(Math.max(ax, bx) + eps); cx++) cells[cy * n + cx]!.push(sg);
    }
  }
  return {
    near: (x, y) => {
      if (x < lo || y < lo || x > -lo || y > -lo) return false;
      for (const [ax, ay, bx, by] of cells[cellOf(y) * n + cellOf(x)]!) {
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
        if (Math.hypot(x - ax - u * dx, y - ay - u * dy) <= eps) return true;
      }
      return false;
    },
  };
}
