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
import type { LayerSpec, SaverSpec } from './types';
import { FIELD_BUCKET_MS } from './field';
import { spriteVariants } from './simulate';
import { withoutTimeline } from './timeline';

/** Periods that share no cycle shorter than this are reported as aperiodic. */
export const MAX_SCENE_PERIOD = 3_600_000; // ms — an hour

export interface ScenePeriod {
  /** ms until the scene repeats exactly; 0 for a static scene; null when it never does (within an hour). */
  period: number | null;
  /** One line per part that sets or breaks the period, e.g. `layers[2] pulse: 4000 ms`. */
  parts: string[];
  /** Why it is null (empty otherwise). */
  reasons: string[];
}

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

/** The repeat period of `spec` — see the module comment. */
export function scenePeriod(spec: SaverSpec): ScenePeriod {
  // Each part's period as an exact ratio num/den ms, so a part that repeats
  // between whole milliseconds (`spin: 7` → 360000/7) still combines exactly.
  const parts: Array<[string, number, number]> = [];
  const reasons: string[] = [];
  const add = (label: string, ms: number): void => {
    if (!(ms > 0) || !Number.isFinite(ms)) return;
    const ratio = toRatio(ms);
    if (!ratio) reasons.push(`${label} repeats every ${Number(ms.toFixed(3))} ms, which has no exact ratio to combine`);
    else parts.push([label, ratio[0], ratio[1]]);
  };

  const tl = spec.timeline;
  if (tl && tl.keys.length > 0) {
    // A key that moves a period, rate or speed changes where the scene is in
    // its cycle for as long as it glides, so one lap is no longer one cycle.
    const keyed = tl.keys.filter((k) => PERIOD_LEAF.test(String(k.path)));
    if (keyed.length > 0) reasons.push(`timeline keys animate ${[...new Set(keyed.map((k) => String(k.path)))].join(', ')}, which sets the scene's own period`);
    if (tl.loop && (tl.duration ?? 0) > 0) add('timeline', tl.duration!);
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
    add('background drift', r ? (r[0] / gcd(r[0], FIELD_BUCKET_MS)) * FIELD_BUCKET_MS : period);
  }
  if (spec.finish?.animate && ((spec.finish.grain ?? 0) > 0 || (spec.finish.dither ?? 0) > 0)) reasons.push('finish.animate steps the grain without repeating');

  spec.layers.forEach((layer: LayerSpec, i) => {
    const at = `layers[${i}]${layer.key ? ` (${layer.key})` : ''}`;
    const rate = layer.clock?.rate ?? 1;
    const life = layer.life;
    // `stagger` shifts entity i's enter by i × stagger, so even an instant
    // enter at 0 builds the layer up once when it has more than one entity.
    const staggered = (life?.stagger ?? 0) > 0 && layer.count > 1;
    if (life && (life.exit !== undefined || (life.enter !== undefined && ((life.enter ?? 0) > 0 || (life.fade ?? 1000) > 0 || staggered)))) reasons.push(`${at} life builds in or out once`);
    if (layer.pulse) add(`${at} pulse`, layer.pulse.period / rate);
    if (layer.grow) add(`${at} grow`, layer.grow.period / rate);
    if (layer.rock) add(`${at} rock`, layer.rock.period / rate);
    if (layer.emit) add(`${at} emit`, layer.emit.every);
    const spin = range(layer.spin);
    if (spin !== null) {
      if (Number.isNaN(spin)) reasons.push(`${at} spin range gives each entity its own speed`);
      else if (spin !== 0) add(`${at} spin`, 360000 / Math.abs(spin));
    }
    const sp = layer.sprite;
    if ((sp.kind === 'emoji' || sp.kind === 'text') && sp.cycle && spriteVariants(sp) > 1) add(`${at} cycle`, (sp.cycle.period * spriteVariants(sp)) / rate);
    if (sp.kind === 'textBlock' && sp.reveal) {
      if ((sp.reveal.speed ?? 0) > 0) reasons.push(`${at} reveal types itself once`);
      if (sp.reveal.caret) {
        const hz = Math.min(3, sp.reveal.caret === true ? 1.2 : sp.reveal.caret.blink ?? 1.2);
        if (hz > 0) add(`${at} caret`, 1000 / hz);
      }
    }
    const m = layer.motion;
    if (m.type === 'path') add(`${at} path`, m.duration);
    else if (m.type === 'orbit') {
      const s = range(m.speed);
      if (s === null || Number.isNaN(s)) reasons.push(`${at} orbit speed range gives each entity its own lap`);
      else if (s !== 0) add(`${at} orbit`, 360000 / Math.abs(s));
    } else if (m.type !== 'static') {
      if (m.type === 'drift' && m.ease?.type === 'settle' && !layer.emit) reasons.push(`${at} drift settles once`);
      else reasons.push(`${at} ${m.type} motion travels at seeded per-entity speeds`);
    }
  });

  const labelled = parts.map(([l, n, d]) => `${l}: ${Number((n / d).toFixed(3))} ms`);
  if (reasons.length > 0) return { period: null, parts: labelled, reasons };
  if (parts.length === 0) return { period: 0, parts: labelled, reasons };
  // The common period of n₁/d₁, n₂/d₂ … (each reduced) is lcm(nᵢ) / gcd(dᵢ).
  let num = 1;
  let den = 0;
  for (const [, n, d] of parts) {
    num = (num / gcd(num, n)) * n;
    den = gcd(den, d);
    if (num / den > MAX_SCENE_PERIOD) {
      return { period: null, parts: labelled, reasons: [`its parts share no cycle shorter than ${MAX_SCENE_PERIOD / 60000} min`] };
    }
  }
  if (num % den !== 0) return { period: null, parts: labelled, reasons: [`its parts repeat together every ${Number((num / den).toFixed(3))} ms, not a whole number of milliseconds`] };
  return { period: num / den, parts: labelled, reasons };
}

/**
 * The period of everything in the scene except its timeline — what a
 * looping timeline's lap has to be a multiple of for one lap to loop
 * seamlessly.
 */
export function periodWithoutTimeline(spec: SaverSpec): ScenePeriod {
  return scenePeriod(withoutTimeline(spec));
}
