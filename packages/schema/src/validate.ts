import { LIMITS, SCHEMA_VERSION, type IdleSequence, type SaverSpec, type SpecError, type SpecWarning, type ValidationResult } from './types';
import { morphNothingMorphable, structuralSignature } from './steer';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRange = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[0] <= v[1];

// Known properties at each level — used to detect unknown/misplaced fields
const KNOWN_TOP = new Set(['schemaVersion', 'id', 'label', 'seed', 'motionIntensity', 'density', 'units', 'referenceViewport', 'background', 'layers', 'ghosting']);
const KNOWN_LAYER = new Set([
  'count', 'sprite', 'motion', 'size', 'wrap', 'flip', 'alpha', 'blend',
  'region', 'pulse', 'spin', 'grow', 'key', 'position', 'trail', 'links',
  'layout', 'life', 'emit', 'clock',
]);
const KNOWN_CIRCLE = new Set(['kind', 'radius', 'color', 'soft', 'colors', 'colorWeights']);
const KNOWN_RING = new Set(['kind', 'radius', 'color', 'width', 'colors', 'colorWeights']);
const KNOWN_STREAK = new Set(['kind', 'length', 'color', 'width', 'colors', 'colorWeights']);
const KNOWN_RECT = new Set(['kind', 'width', 'aspect', 'color', 'feather', 'colors', 'colorWeights']);
const KNOWN_BAR = new Set(['kind', 'values', 'length', 'thickness', 'color', 'max', 'direction', 'colors', 'colorWeights']);
const KNOWN_POLYGON = new Set(['kind', 'radius', 'color', 'sides', 'points', 'soft', 'colors', 'colorWeights']);
const KNOWN_STROKE = new Set(['kind', 'length', 'points', 'color', 'width', 'curve', 'taper', 'orient', 'colors', 'colorWeights']);
const KNOWN_EMOJI = new Set(['kind', 'glyphs', 'cycle']);
const KNOWN_TEXT = new Set(['kind', 'strings', 'color', 'font', 'align', 'baseline', 'maxWidth', 'cycle']);
const KNOWN_TEXT_BLOCK = new Set(['kind', 'text', 'maxWidth', 'fontSize', 'lineHeight', 'align', 'color', 'reveal', 'anchor', 'font', 'opacity']);
const TEXT_BLOCK_ANCHORS = new Set(['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']);
/**
 * A CSS length inside a textBlock `font` — size belongs to `fontSize`. Uses a
 * lookahead instead of `\b`: `%` is not a word character, so `\b` never
 * matches right after it (there's no word/non-word transition), letting
 * "50% monospace" slip past a `\b`-based check.
 */
const FONT_SIZE_RE = /\d(?:px|pt|pc|em|rem|ex|ch|vw|vh|vmin|vmax|%)(?![a-zA-Z0-9])/i;
const KNOWN_REVEAL = new Set(['progress', 'mode', 'speed', 'caret', 'fade']);
const KNOWN_REVEAL_CARET = new Set(['blink', 'color']);
const KNOWN_DRIFT = new Set(['type', 'speed', 'angle', 'bidirectional', 'bob', 'ease']);
const KNOWN_RISE = new Set(['type', 'speed', 'sway', 'ease']);
const KNOWN_BOUNCE = new Set(['type', 'speed']);
const KNOWN_STATIC = new Set(['type']);
const KNOWN_ORBIT = new Set(['type', 'speed', 'radius', 'center']);
const KNOWN_WANDER = new Set(['type', 'speed', 'angle', 'meander', 'coherence', 'ease']);
const KNOWN_WARP = new Set(['type', 'speed', 'center']);
const KNOWN_PATH = new Set(['type', 'points', 'duration', 'curve', 'closed', 'scatter']);
const KNOWN_BG_SOLID = new Set(['type', 'color']);
const KNOWN_BG_GRADIENT = new Set(['type', 'stops', 'band', 'drift']);

// Layer-level properties that models commonly misplace inside sprite
const LAYER_PROPS_ON_SPRITE = new Set(['blend', 'trail', 'alpha', 'pulse', 'spin', 'grow', 'region', 'links', 'flip', 'wrap', 'key', 'emit', 'clock', 'life', 'layout']);

function unknownKeys(obj: Record<string, unknown>, known: Set<string>): string[] {
  return Object.keys(obj).filter((k) => !known.has(k));
}

/**
 * Validate an untrusted (agent- or JSON-authored) spec structurally + semantically.
 * Returns typed errors and warnings; never throws. `compileSaver` refuses to run an invalid spec.
 *
 * Warnings are non-blocking advisories about unknown/misplaced properties and
 * near-zero speeds. They don't prevent compilation but indicate likely authoring mistakes.
 */
/**
 * Normalize: if a sprite has `colors[]` but no `color`, default `color` to
 * `colors[0]`. Author intent is unambiguous (pick from the palette), and
 * requiring both is a known footgun (F3). Mutates the spec in place — the
 * added field is always correct.
 */
function normalizeColors(spec: unknown): void {
  if (!isObj(spec) || !Array.isArray(spec.layers)) return;
  for (const layer of spec.layers) {
    if (!isObj(layer)) continue;
    const sprite = (layer as Record<string, unknown>).sprite;
    if (!isObj(sprite)) continue;
    const sp = sprite as Record<string, unknown>;
    if (Array.isArray(sp.colors) && sp.colors.length > 0 && sp.color === undefined) {
      sp.color = sp.colors[0];
    }
  }
}

export function validateSpec(spec: unknown): ValidationResult {
  normalizeColors(spec);
  const errors: SpecError[] = [];
  const warnings: SpecWarning[] = [];
  const err = (path: string, message: string): void => void errors.push({ path, message });
  const warn = (path: string, code: string, message: string): void => void warnings.push({ path, code, message });

  if (!isObj(spec)) return { valid: false, errors: [{ path: '', message: 'spec must be an object' }], warnings: [] };

  if (spec.schemaVersion !== SCHEMA_VERSION) err('schemaVersion', `must be ${SCHEMA_VERSION}`);
  if (!isStr(spec.id) || spec.id.trim() === '') err('id', 'must be a non-empty string');
  if (!isStr(spec.label) || spec.label.trim() === '') err('label', 'must be a non-empty string');
  if (spec.seed !== undefined && !isNum(spec.seed)) err('seed', 'must be a number');
  if (spec.motionIntensity !== undefined && !['calm', 'moderate', 'energetic'].includes(spec.motionIntensity as string)) {
    err('motionIntensity', 'must be calm | moderate | energetic');
  }
  if (spec.density !== undefined && !['sparse', 'normal', 'dense'].includes(spec.density as string)) {
    err('density', 'must be sparse | normal | dense');
  }
  if (spec.units !== undefined && spec.units !== 'px' && spec.units !== 'viewport') {
    err('units', "must be 'px' | 'viewport'");
  }
  if (spec.units === 'px' && Array.isArray(spec.layers)) {
    for (const l of spec.layers) {
      if (isObj(l) && isObj((l as Record<string, unknown>).sprite) && ((l as Record<string, unknown>).sprite as Record<string, unknown>).kind === 'textBlock') {
        err('units', "textBlock dimensions are viewport fractions — units: 'px' is not supported with textBlock sprites");
        break;
      }
    }
  }
  if (spec.referenceViewport !== undefined) {
    if (!isNum(spec.referenceViewport) || spec.referenceViewport < 100 || spec.referenceViewport > 8640) {
      err('referenceViewport', 'must be a number between 100 and 8640');
    }
  }
  if (spec.ghosting !== undefined && (!isNum(spec.ghosting) || spec.ghosting < 0 || spec.ghosting > LIMITS.maxGhosting)) {
    err('ghosting', `must be a number 0..${LIMITS.maxGhosting}`);
  }

  for (const k of unknownKeys(spec, KNOWN_TOP)) {
    warn(k, 'unknown-property', `unknown top-level property '${k}' — will be ignored`);
  }

  if (spec.background !== undefined) validateBackground(spec.background, err, warn);

  if (!Array.isArray(spec.layers) || spec.layers.length === 0) {
    err('layers', 'must be a non-empty array');
  } else {
    if (spec.layers.length > LIMITS.maxLayers) err('layers', `at most ${LIMITS.maxLayers} layers`);
    let total = 0;
    spec.layers.forEach((layer, i) => {
      total += isObj(layer) && isNum(layer.count) ? layer.count : 0;
      validateLayer(layer, `layers[${i}]`, err, warn, spec);
    });
    if (total > LIMITS.maxTotal) err('layers', `total entities ${total} exceeds cap ${LIMITS.maxTotal}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function color(v: unknown, path: string, err: (p: string, m: string) => void): void {
  if (!isStr(v) || !HEX.test(v)) err(path, 'must be a hex colour like #0a3a52');
}

type WarnFn = (path: string, code: string, message: string) => void;

function validateBackground(bg: unknown, err: (p: string, m: string) => void, warn: WarnFn): void {
  if (!isObj(bg)) return err('background', 'must be an object');
  if (bg.type === 'solid') {
    color(bg.color, 'background.color', err);
    for (const k of unknownKeys(bg, KNOWN_BG_SOLID)) {
      warn(`background.${k}`, 'unknown-property', `unknown background property '${k}' — will be ignored`);
    }
  } else if (bg.type === 'gradient') {
    if (!Array.isArray(bg.stops) || bg.stops.length < 2) {
      err('background.stops', 'gradient needs at least 2 stops');
    } else {
      bg.stops.forEach((s, i) => {
        if (!isObj(s) || !isNum(s.at) || s.at < 0 || s.at > 1) err(`background.stops[${i}].at`, 'must be 0..1');
        color(isObj(s) ? s.color : undefined, `background.stops[${i}].color`, err);
      });
    }
    if (bg.drift !== undefined) {
      if (!isObj(bg.drift)) err('background.drift', 'must be an object');
      else {
        if (!isNum(bg.drift.period) || bg.drift.period < LIMITS.minDriftPeriod) {
          err('background.drift.period', `must be >= ${LIMITS.minDriftPeriod} ms`);
        }
        if (bg.drift.amount !== undefined && (!isNum(bg.drift.amount) || bg.drift.amount <= 0 || bg.drift.amount > LIMITS.maxDriftAmount)) {
          err('background.drift.amount', `must be > 0 and <= ${LIMITS.maxDriftAmount}`);
        }
      }
    }
    if (bg.band !== undefined) {
      if (!isObj(bg.band)) err('background.band', 'must be an object');
      else {
        color(bg.band.color, 'background.band.color', err);
        if (!isNum(bg.band.height) || bg.band.height <= 0) err('background.band.height', 'must be > 0');
      }
    }
    for (const k of unknownKeys(bg, KNOWN_BG_GRADIENT)) {
      warn(`background.${k}`, 'unknown-property', `unknown background property '${k}' — will be ignored`);
    }
  } else {
    err('background.type', 'must be solid | gradient');
  }
}

function validateLayer(layer: unknown, path: string, err: (p: string, m: string) => void, warn: WarnFn, spec?: unknown): void {
  if (!isObj(layer)) return err(path, 'must be an object');

  for (const k of unknownKeys(layer, KNOWN_LAYER)) {
    if (k === 'id') {
      warn(`${path}.id`, 'misplaced-property', `'id' is not a layer property — did you mean 'key'? Use 'key' to name a layer`);
    } else if (k === 'depth') {
      warn(`${path}.depth`, 'unknown-property', `'depth' is not a layer property — use motion type 'warp' for true perspective depth, or fake parallax with size/speed/alpha across layers`);
    } else {
      warn(`${path}.${k}`, 'unknown-property', `unknown layer property '${k}' — will be ignored`);
    }
  }
  if (!isNum(layer.count) || !Number.isInteger(layer.count) || layer.count < 1) {
    err(`${path}.count`, 'must be a positive integer');
  } else if (layer.count > LIMITS.maxPerLayer) {
    err(`${path}.count`, `at most ${LIMITS.maxPerLayer} per layer`);
  }
  if (layer.size !== undefined && (!isRange(layer.size) || layer.size[0] <= 0)) {
    err(`${path}.size`, 'must be a [min,max] range of positive px');
  }
  if (layer.wrap !== undefined && typeof layer.wrap !== 'boolean') err(`${path}.wrap`, 'must be a boolean');
  if (layer.flip !== undefined && typeof layer.flip !== 'boolean') err(`${path}.flip`, 'must be a boolean');

  if (layer.alpha !== undefined && (!isRange(layer.alpha) || layer.alpha[0] < 0 || layer.alpha[1] > 1)) {
    err(`${path}.alpha`, 'must be a [min,max] range within 0..1');
  }
  if (layer.blend !== undefined && !['lighter', 'screen', 'multiply'].includes(layer.blend as string)) {
    err(`${path}.blend`, "must be 'lighter' | 'screen' | 'multiply' when set");
  }
  if (layer.key !== undefined && (!isStr(layer.key) || layer.key.trim() === '')) {
    err(`${path}.key`, 'must be a non-empty string');
  }
  if (layer.position !== undefined) {
    if (!isObj(layer.position) || !isNum(layer.position.x) || !isNum(layer.position.y)) {
      err(`${path}.position`, 'must be {x, y} with numbers 0..1');
    } else {
      if (layer.position.x < 0 || layer.position.x > 1) err(`${path}.position.x`, 'must be 0..1');
      if (layer.position.y < 0 || layer.position.y > 1) err(`${path}.position.y`, 'must be 0..1');
      const dataLayout = isObj(layer.layout) && (layer.layout.type === 'list' || layer.layout.type === 'table');
      if (isNum(layer.count) && layer.count !== 1 && !dataLayout) {
        err(`${path}.position`, "position requires count: 1 — or a layout of type 'list' / 'table', where it anchors the whole block");
      }
    }
  }
  if (layer.region !== undefined) {
    if (!isObj(layer.region)) err(`${path}.region`, 'must be an object');
    else {
      for (const axis of ['x', 'y'] as const) {
        const r = layer.region[axis];
        if (r !== undefined && (!isRange(r) || r[0] < 0 || r[1] > 1)) {
          err(`${path}.region.${axis}`, 'must be a [min,max] range within 0..1');
        }
      }
    }
  }
  if (layer.pulse !== undefined) {
    if (!isObj(layer.pulse)) err(`${path}.pulse`, 'must be an object');
    else {
      if (!isNum(layer.pulse.amp) || layer.pulse.amp <= 0 || layer.pulse.amp > LIMITS.maxPulseAmp) {
        err(`${path}.pulse.amp`, `must be within 0..${LIMITS.maxPulseAmp}`);
      }
      if (!isNum(layer.pulse.period) || layer.pulse.period < LIMITS.minPulsePeriod) {
        err(`${path}.pulse.period`, `must be >= ${LIMITS.minPulsePeriod} ms (flash-safety floor)`);
      }
      if (layer.pulse.wave !== undefined) {
        if (!isObj(layer.pulse.wave)) err(`${path}.pulse.wave`, 'must be an object');
        else {
          if (!isNum(layer.pulse.wave.wavelength) || layer.pulse.wave.wavelength <= 0) {
            err(`${path}.pulse.wave.wavelength`, 'must be > 0 (px or viewport-units)');
          }
          if (layer.pulse.wave.angle !== undefined && !isNum(layer.pulse.wave.angle)) {
            err(`${path}.pulse.wave.angle`, 'must be a number (degrees)');
          }
        }
      }
    }
  }
  if (layer.spin !== undefined) {
    if (isRange(layer.spin)) {
      if (Math.abs(layer.spin[0]) > LIMITS.maxSpin || Math.abs(layer.spin[1]) > LIMITS.maxSpin) {
        err(`${path}.spin`, `each end of the range must be within ±${LIMITS.maxSpin} deg/sec`);
      }
    } else if (!isNum(layer.spin)) {
      err(`${path}.spin`, 'must be a number or a [min,max] range (degrees/sec)');
    } else if (Math.abs(layer.spin) > LIMITS.maxSpin) {
      err(`${path}.spin`, `must be within ±${LIMITS.maxSpin} deg/sec`);
    }
  }
  if (layer.grow !== undefined) {
    if (!isObj(layer.grow)) err(`${path}.grow`, 'must be an object');
    else {
      if (!isNum(layer.grow.amp) || layer.grow.amp <= 0 || layer.grow.amp > LIMITS.maxGrowAmp) {
        err(`${path}.grow.amp`, `must be within 0..${LIMITS.maxGrowAmp}`);
      }
      if (!isNum(layer.grow.period) || layer.grow.period < LIMITS.minPulsePeriod) {
        err(`${path}.grow.period`, `must be >= ${LIMITS.minPulsePeriod} ms (flash-safety floor)`);
      }
    }
  }

  if (layer.links !== undefined) {
    if (!isObj(layer.links)) err(`${path}.links`, 'must be an object');
    else {
      if (!isNum(layer.links.k) || !Number.isInteger(layer.links.k) || layer.links.k < 1 || layer.links.k > LIMITS.maxLinksK) {
        err(`${path}.links.k`, `must be an integer 1..${LIMITS.maxLinksK}`);
      }
      if (!isNum(layer.links.maxDist) || layer.links.maxDist <= 0) {
        err(`${path}.links.maxDist`, 'must be > 0');
      }
      if (layer.links.color !== undefined) color(layer.links.color, `${path}.links.color`, err);
      if (layer.links.alpha !== undefined && (!isNum(layer.links.alpha) || layer.links.alpha < 0 || layer.links.alpha > 1)) {
        err(`${path}.links.alpha`, 'must be 0..1');
      }
      if (layer.links.width !== undefined && (!isNum(layer.links.width) || layer.links.width <= 0)) {
        err(`${path}.links.width`, 'must be > 0');
      }
      if (layer.links.mode !== undefined && !['nearest', 'chain', 'random'].includes(layer.links.mode as string)) {
        err(`${path}.links.mode`, "must be 'nearest' | 'chain' | 'random'");
      }
      if (layer.links.falloff !== undefined && typeof layer.links.falloff !== 'boolean') {
        err(`${path}.links.falloff`, 'must be a boolean');
      }
      if (layer.links.closed !== undefined && typeof layer.links.closed !== 'boolean') {
        err(`${path}.links.closed`, 'must be a boolean');
      }
      if (isNum(layer.count) && layer.count > LIMITS.maxLinkLayerCount) {
        err(`${path}.links`, `layer count must be <= ${LIMITS.maxLinkLayerCount} when links is set`);
      }
    }
  }

  if (layer.layout !== undefined) {
    if (isObj(layer.layout) && (layer.layout.type === 'list' || layer.layout.type === 'table')) {
      const lay = layer.layout;
      if (lay.type === 'table' && (!isNum(lay.columns) || !Number.isInteger(lay.columns) || lay.columns < 1 || lay.columns > LIMITS.maxGridColumns)) {
        err(`${path}.layout.columns`, `must be an integer 1..${LIMITS.maxGridColumns}`);
      }
      const gapOk = (v: unknown): boolean => isNum(v) && v > 0;
      if (lay.gap !== undefined) {
        if (isNum(lay.gap)) {
          if (!gapOk(lay.gap)) err(`${path}.layout.gap`, 'must be > 0 (viewport units of min(w,h), or px)');
        } else if (lay.type === 'table' && isObj(lay.gap)) {
          if (lay.gap.x !== undefined && !gapOk(lay.gap.x)) err(`${path}.layout.gap.x`, 'must be > 0');
          if (lay.gap.y !== undefined && !gapOk(lay.gap.y)) err(`${path}.layout.gap.y`, 'must be > 0');
          for (const k of unknownKeys(lay.gap, new Set(['x', 'y']))) {
            warn(`${path}.layout.gap.${k}`, 'unknown-property', `unknown gap property '${k}' — will be ignored`);
          }
        } else {
          err(`${path}.layout.gap`, lay.type === 'table' ? 'must be a number > 0 or { x?, y? }' : 'must be a number > 0');
        }
      }
      for (const k of unknownKeys(lay, new Set(lay.type === 'list' ? ['type', 'gap'] : ['type', 'columns', 'gap']))) {
        warn(`${path}.layout.${k}`, 'unknown-property', `unknown layout property '${k}' — will be ignored`);
      }
      // A data layout reads variants in order: N labels want N strings.
      const sp = layer.sprite;
      if (isObj(sp) && isNum(layer.count)) {
        const variants = sp.kind === 'text' && Array.isArray(sp.strings) ? sp.strings.length
          : sp.kind === 'emoji' && Array.isArray(sp.glyphs) ? sp.glyphs.length
            : sp.kind === 'bar' && Array.isArray(sp.values) ? sp.values.length : null;
        if (variants !== null && variants !== layer.count) {
          warn(`${path}.count`, 'list-length-mismatch', `count is ${layer.count} but the sprite carries ${variants} ${sp.kind === 'bar' ? 'values' : 'variants'} — a ${lay.type} layout reads them in order, so they cycle or go unused`);
        }
      }
    } else if (!isObj(layer.layout) || layer.layout.type !== 'grid') {
      err(`${path}.layout`, "must be an object with type: 'grid' | 'list' | 'table'");
    } else {
      if (layer.layout.columns !== undefined && (!isNum(layer.layout.columns) || !Number.isInteger(layer.layout.columns) || layer.layout.columns < 1 || layer.layout.columns > LIMITS.maxGridColumns)) {
        err(`${path}.layout.columns`, `must be an integer 1..${LIMITS.maxGridColumns}`);
      }
      const jit = layer.layout.jitter;
      if (jit !== undefined) {
        const jitterOk = (v: unknown): boolean => isNum(v) && v >= 0 && v <= 1;
        if (isNum(jit)) {
          if (!jitterOk(jit)) err(`${path}.layout.jitter`, 'must be 0..1');
        } else if (isObj(jit)) {
          if (jit.x !== undefined && !jitterOk(jit.x)) err(`${path}.layout.jitter.x`, 'must be 0..1');
          if (jit.y !== undefined && !jitterOk(jit.y)) err(`${path}.layout.jitter.y`, 'must be 0..1');
        } else {
          err(`${path}.layout.jitter`, 'must be a number 0..1 or { x?, y? }');
        }
      }
      if (layer.position !== undefined) {
        warn(`${path}.layout`, 'layout-with-position', 'position overrides layout for the single entity — layout has no effect');
      }
    }
  }

  if (layer.life !== undefined) {
    if (!isObj(layer.life)) err(`${path}.life`, 'must be an object');
    else {
      if (layer.life.enter !== undefined && (!isNum(layer.life.enter) || layer.life.enter < 0)) {
        err(`${path}.life.enter`, 'must be >= 0 (ms)');
      }
      if (layer.life.exit !== undefined && (!isNum(layer.life.exit) || layer.life.exit < 0)) {
        err(`${path}.life.exit`, 'must be >= 0 (ms)');
      }
      if (isNum(layer.life.enter) && isNum(layer.life.exit) && layer.life.exit <= layer.life.enter) {
        err(`${path}.life.exit`, 'must be greater than life.enter');
      }
      if (layer.life.fade !== undefined && (!isNum(layer.life.fade) || layer.life.fade < 0)) {
        err(`${path}.life.fade`, 'must be >= 0 (ms)');
      }
    }
  }

  if (layer.trail !== undefined) {
    if (!isObj(layer.trail)) err(`${path}.trail`, 'must be an object');
    else {
      if (!isNum(layer.trail.length) || layer.trail.length <= 0 || layer.trail.length > LIMITS.maxTrailLength) {
        err(`${path}.trail.length`, `must be > 0 and <= ${LIMITS.maxTrailLength} ms`);
      }
      if (layer.trail.fade !== undefined && (!isNum(layer.trail.fade) || layer.trail.fade < 0 || layer.trail.fade > 1)) {
        err(`${path}.trail.fade`, 'must be 0..1');
      }
    }
  }

  if (layer.emit !== undefined) {
    if (!isObj(layer.emit)) err(`${path}.emit`, 'must be an object { every, life, jitter?, grow? }');
    else {
      const em = layer.emit;
      if (!isNum(em.every) || em.every < LIMITS.minEmitEvery || em.every > LIMITS.maxEmitEvery) {
        err(`${path}.emit.every`, `must be ${LIMITS.minEmitEvery}..${LIMITS.maxEmitEvery} ms (at most one event per second per entity)`);
      }
      if (!isNum(em.life) || em.life < LIMITS.minEmitLife) {
        err(`${path}.emit.life`, `must be >= ${LIMITS.minEmitLife} ms (an event is a smooth envelope, never a cut)`);
      } else if (isNum(em.every) && em.life > em.every) {
        err(`${path}.emit.life`, 'must be <= emit.every (the visible window cannot outlast its period)');
      }
      if (em.jitter !== undefined && (!isNum(em.jitter) || em.jitter < 0 || em.jitter > 1)) {
        err(`${path}.emit.jitter`, 'must be 0..1 (0 = evenly staggered, 1 = scattered by a fixed sequence)');
      }
      if (em.grow !== undefined) {
        if (!Array.isArray(em.grow) || em.grow.length !== 2 || !isNum(em.grow[0]) || !isNum(em.grow[1])) {
          err(`${path}.emit.grow`, 'must be [from, to] size multipliers');
        } else if (em.grow[0] < 0 || em.grow[1] < 0 || em.grow[0] > LIMITS.maxEmitGrow || em.grow[1] > LIMITS.maxEmitGrow) {
          err(`${path}.emit.grow`, `each multiplier must be 0..${LIMITS.maxEmitGrow}`);
        }
      }
      // jitter 0 promises one event at a time; that only holds while a window
      // is shorter than the stagger between entities.
      if (em.jitter === 0 && isNum(em.every) && isNum(em.life) && isNum(layer.count) && layer.count > 1 && em.life > em.every / layer.count) {
        warn(`${path}.emit.life`, 'emit-overlap', `jitter 0 staggers ${layer.count} entities ${(em.every / layer.count).toFixed(0)} ms apart but each stays lit ${em.life} ms — windows overlap, so more than one event is visible at a time. Shorten life or lengthen every`);
      }
      for (const k of unknownKeys(em, new Set(['every', 'life', 'jitter', 'grow']))) {
        warn(`${path}.emit.${k}`, 'unknown-property', `unknown emit property '${k}' — will be ignored`);
      }
    }
  }
  if (layer.clock !== undefined) {
    if (!isObj(layer.clock)) err(`${path}.clock`, 'must be an object { phase?, rate? }');
    else {
      const ck = layer.clock;
      if (ck.phase !== undefined && (!isNum(ck.phase) || ck.phase < 0 || ck.phase > 1)) {
        err(`${path}.clock.phase`, 'must be 0..1 (turns)');
      }
      const rate = ck.rate === undefined ? 1 : ck.rate;
      if (!isNum(rate) || rate < LIMITS.minClockRate || rate > LIMITS.maxClockRate) {
        err(`${path}.clock.rate`, `must be ${LIMITS.minClockRate}..${LIMITS.maxClockRate}`);
      } else {
        // A clocked layer pulses in unison — every entity at once — so the
        // per-entity-phase defence is gone and the period floor doubles.
        const floor = LIMITS.minClockedPeriod * rate;
        if (isObj(layer.pulse) && isNum(layer.pulse.period) && layer.pulse.period < floor) {
          err(`${path}.pulse.period`, `must be >= ${floor} ms when the layer has a clock (period / rate >= ${LIMITS.minClockedPeriod} — the whole layer breathes in unison)`);
        }
        if (isObj(layer.grow) && isNum(layer.grow.period) && layer.grow.period < floor) {
          err(`${path}.grow.period`, `must be >= ${floor} ms when the layer has a clock (period / rate >= ${LIMITS.minClockedPeriod})`);
        }
        const sp = layer.sprite;
        if (isObj(sp) && isObj(sp.cycle) && isNum(sp.cycle.period) && sp.cycle.period < floor) {
          err(`${path}.sprite.cycle.period`, `must be >= ${floor} ms when the layer has a clock (period / rate >= ${LIMITS.minClockedPeriod})`);
        }
      }
      for (const k of unknownKeys(ck, new Set(['phase', 'rate']))) {
        warn(`${path}.clock.${k}`, 'unknown-property', `unknown clock property '${k}' — will be ignored`);
      }
    }
  }
  validateSprite(layer.sprite, `${path}.sprite`, err, warn);
  validateMotion(layer.motion, `${path}.motion`, err, warn, spec);
}

function validateSprite(sprite: unknown, path: string, err: (p: string, m: string) => void, warn: WarnFn): void {
  if (!isObj(sprite)) return err(path, 'must be an object');

  let knownSet: Set<string>;
  if (sprite.kind === 'emoji') {
    knownSet = KNOWN_EMOJI;
    if (!Array.isArray(sprite.glyphs) || sprite.glyphs.length === 0 || !sprite.glyphs.every(isStr)) {
      err(`${path}.glyphs`, 'must be a non-empty array of strings');
    }
    validateCycle(sprite, path, err);
  } else if (sprite.kind === 'text') {
    knownSet = KNOWN_TEXT;
    if (!Array.isArray(sprite.strings) || sprite.strings.length === 0 || !sprite.strings.every(isStr)) {
      err(`${path}.strings`, 'must be a non-empty array of strings');
    }
    if (sprite.color !== undefined) color(sprite.color, `${path}.color`, err);
    if (sprite.font !== undefined && !isStr(sprite.font)) {
      err(`${path}.font`, 'must be a string');
    }
    if (sprite.align !== undefined && !['left', 'center', 'right'].includes(sprite.align as string)) {
      err(`${path}.align`, 'must be left | center | right');
    }
    if (sprite.baseline !== undefined && !['top', 'middle', 'bottom'].includes(sprite.baseline as string)) {
      err(`${path}.baseline`, 'must be top | middle | bottom');
    }
    if (sprite.maxWidth !== undefined && (!isNum(sprite.maxWidth) || sprite.maxWidth <= 0)) {
      err(`${path}.maxWidth`, 'must be a positive number');
    }
    validateCycle(sprite, path, err);
  } else if (sprite.kind === 'circle') {
    knownSet = KNOWN_CIRCLE;
    if (!isRange(sprite.radius) || sprite.radius[0] <= 0) err(`${path}.radius`, 'must be a [min,max] range of positive px');
    color(sprite.color, `${path}.color`, err);
    if (sprite.soft !== undefined && typeof sprite.soft !== 'boolean') err(`${path}.soft`, 'must be a boolean');
    validatePalette(sprite, path, err);
  } else if (sprite.kind === 'ring') {
    knownSet = KNOWN_RING;
    if (!isRange(sprite.radius) || sprite.radius[0] <= 0) err(`${path}.radius`, 'must be a [min,max] range of positive px');
    color(sprite.color, `${path}.color`, err);
    if (sprite.width !== undefined && (!isNum(sprite.width) || sprite.width <= 0)) err(`${path}.width`, 'must be > 0');
    validatePalette(sprite, path, err);
  } else if (sprite.kind === 'streak') {
    knownSet = KNOWN_STREAK;
    if (!isRange(sprite.length) || sprite.length[0] <= 0) err(`${path}.length`, 'must be a [min,max] range of positive px');
    color(sprite.color, `${path}.color`, err);
    if (sprite.width !== undefined && (!isNum(sprite.width) || sprite.width <= 0)) err(`${path}.width`, 'must be > 0');
    validatePalette(sprite, path, err);
  } else if (sprite.kind === 'rect') {
    knownSet = KNOWN_RECT;
    if (!isRange(sprite.width) || sprite.width[0] <= 0) err(`${path}.width`, 'must be a [min,max] range of positive px');
    if (sprite.aspect !== undefined && (!isRange(sprite.aspect) || sprite.aspect[0] <= 0)) {
      err(`${path}.aspect`, 'must be a [min,max] range of positive height/width ratios');
    }
    if (sprite.feather !== undefined && (!isNum(sprite.feather) || sprite.feather < 0 || sprite.feather > 1)) {
      err(`${path}.feather`, 'must be 0..1 (fraction of the half-size that fades out)');
    }
    color(sprite.color, `${path}.color`, err);
    validatePalette(sprite, path, err);
  } else if (sprite.kind === 'bar') {
    knownSet = KNOWN_BAR;
    if (!Array.isArray(sprite.values) || sprite.values.length === 0 || sprite.values.length > LIMITS.maxPerLayer || !sprite.values.every((v) => isNum(v) && v >= 0)) {
      err(`${path}.values`, `must be 1..${LIMITS.maxPerLayer} numbers >= 0`);
    }
    if (!isNum(sprite.length) || sprite.length <= 0) err(`${path}.length`, 'must be > 0 (full-scale bar length)');
    if (!isNum(sprite.thickness) || sprite.thickness <= 0) err(`${path}.thickness`, 'must be > 0');
    if (sprite.max !== undefined && (!isNum(sprite.max) || sprite.max <= 0)) err(`${path}.max`, 'must be > 0');
    if (sprite.direction !== undefined && !['right', 'left', 'up', 'down'].includes(sprite.direction as string)) {
      err(`${path}.direction`, "must be 'right' | 'left' | 'up' | 'down'");
    }
    color(sprite.color, `${path}.color`, err);
    validatePalette(sprite, path, err);
  } else if (sprite.kind === 'polygon') {
    knownSet = KNOWN_POLYGON;
    if (!isRange(sprite.radius) || sprite.radius[0] <= 0) err(`${path}.radius`, 'must be a [min,max] range of positive px (circumradius)');
    if (sprite.sides !== undefined && sprite.points !== undefined) {
      err(`${path}.sides`, 'use sides (a regular polygon) or points (a custom one), not both');
    }
    if (sprite.sides !== undefined && (!isNum(sprite.sides) || !Number.isInteger(sprite.sides) || sprite.sides < LIMITS.minPolygonSides || sprite.sides > LIMITS.maxPolygonSides)) {
      err(`${path}.sides`, `must be an integer ${LIMITS.minPolygonSides}..${LIMITS.maxPolygonSides}`);
    }
    if (sprite.points !== undefined) validateShapePoints(sprite.points, `${path}.points`, 3, err);
    if (sprite.soft !== undefined && typeof sprite.soft !== 'boolean') err(`${path}.soft`, 'must be a boolean');
    color(sprite.color, `${path}.color`, err);
    validatePalette(sprite, path, err);
  } else if (sprite.kind === 'stroke') {
    knownSet = KNOWN_STROKE;
    if (!isRange(sprite.length) || sprite.length[0] <= 0) err(`${path}.length`, 'must be a [min,max] range of positive px (the mark\'s bounding size)');
    validateShapePoints(sprite.points, `${path}.points`, 2, err);
    if (sprite.width !== undefined && (!isNum(sprite.width) || sprite.width <= 0)) err(`${path}.width`, 'must be > 0');
    if (sprite.curve !== undefined && sprite.curve !== 'smooth' && sprite.curve !== 'linear') err(`${path}.curve`, "must be 'smooth' | 'linear'");
    if (sprite.taper !== undefined && typeof sprite.taper !== 'boolean') err(`${path}.taper`, 'must be a boolean');
    if (sprite.orient !== undefined && typeof sprite.orient !== 'boolean') err(`${path}.orient`, 'must be a boolean');
    color(sprite.color, `${path}.color`, err);
    validatePalette(sprite, path, err);
  } else if (sprite.kind === 'textBlock') {
    knownSet = KNOWN_TEXT_BLOCK;
    if (typeof sprite.text !== 'string' || sprite.text.length === 0) {
      err(`${path}.text`, 'must be a non-empty string');
    } else if (sprite.text.length > LIMITS.maxTextBlockLength) {
      err(`${path}.text`, `must be at most ${LIMITS.maxTextBlockLength} characters`);
    }
    if (!isNum(sprite.maxWidth) || sprite.maxWidth <= 0 || sprite.maxWidth > LIMITS.maxTextBlockMaxWidth) {
      err(`${path}.maxWidth`, `must be a positive number up to ${LIMITS.maxTextBlockMaxWidth} (viewport fraction)`);
    }
    if (!isNum(sprite.fontSize) || sprite.fontSize < LIMITS.minTextBlockFontSize || sprite.fontSize > LIMITS.maxTextBlockFontSize) {
      err(`${path}.fontSize`, `must be between ${LIMITS.minTextBlockFontSize} and ${LIMITS.maxTextBlockFontSize} (viewport fraction)`);
    }
    if (sprite.lineHeight !== undefined && (!isNum(sprite.lineHeight) || sprite.lineHeight < 0.5 || sprite.lineHeight > 4)) {
      err(`${path}.lineHeight`, 'must be between 0.5 and 4 (multiplier)');
    }
    if (sprite.align !== undefined && !['left', 'center', 'right'].includes(sprite.align as string)) {
      err(`${path}.align`, "must be 'left' | 'center' | 'right'");
    }
    if (sprite.color !== undefined) color(sprite.color, `${path}.color`, err);
    if (sprite.anchor !== undefined && !TEXT_BLOCK_ANCHORS.has(sprite.anchor as string)) {
      err(`${path}.anchor`, "must be 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'");
    }
    if (sprite.font !== undefined) {
      if (!isStr(sprite.font) || sprite.font.trim() === '') {
        err(`${path}.font`, 'must be a non-empty string (family and/or weight)');
      } else if (FONT_SIZE_RE.test(sprite.font)) {
        err(`${path}.font`, 'must name a family and/or weight only — fontSize owns the size');
      }
    }
    if (sprite.opacity !== undefined && (!isNum(sprite.opacity) || sprite.opacity < 0 || sprite.opacity > 1)) {
      err(`${path}.opacity`, 'must be a number between 0 and 1');
    }
    if (sprite.reveal !== undefined) {
      const rv = sprite.reveal as Record<string, unknown>;
      if (typeof rv !== 'object' || rv === null || Array.isArray(rv)) {
        err(`${path}.reveal`, 'must be an object');
      } else {
        for (const k of Object.keys(rv)) {
          if (!KNOWN_REVEAL.has(k)) err(`${path}.reveal.${k}`, 'unknown reveal field');
        }
        if (rv.progress !== undefined && (!isNum(rv.progress) || rv.progress < 0 || rv.progress > 1)) {
          err(`${path}.reveal.progress`, 'must be a number between 0 and 1');
        }
        if (rv.mode !== undefined && !['typewriter', 'word', 'line', 'glyphFade'].includes(rv.mode as string)) {
          err(`${path}.reveal.mode`, "must be 'typewriter' | 'word' | 'line' | 'glyphFade'");
        }
        if (rv.fade !== undefined && (!isNum(rv.fade) || rv.fade <= 0 || rv.fade > 1)) {
          err(`${path}.reveal.fade`, 'must be between 0 (exclusive) and 1 (fraction of progress)');
        }
        if (rv.speed !== undefined && (!isNum(rv.speed) || rv.speed < 0 || rv.speed > LIMITS.maxRevealSpeed)) {
          err(`${path}.reveal.speed`, `must be between 0 and ${LIMITS.maxRevealSpeed} (graphemes/sec)`);
        }
        if (rv.caret !== undefined && typeof rv.caret !== 'boolean') {
          const caret = rv.caret as Record<string, unknown>;
          if (typeof caret !== 'object' || caret === null || Array.isArray(caret)) {
            err(`${path}.reveal.caret`, 'must be a boolean or an object');
          } else {
            for (const k of Object.keys(caret)) {
              if (!KNOWN_REVEAL_CARET.has(k)) err(`${path}.reveal.caret.${k}`, 'unknown caret field');
            }
            if (caret.blink !== undefined && (!isNum(caret.blink) || caret.blink <= 0 || caret.blink > LIMITS.maxCaretBlinkHz)) {
              err(`${path}.reveal.caret.blink`, `must be between 0 (exclusive) and ${LIMITS.maxCaretBlinkHz} Hz (flash safety)`);
            }
            if (caret.color !== undefined) color(caret.color, `${path}.reveal.caret.color`, err);
          }
        }
      }
    }
  } else {
    err(`${path}.kind`, 'must be emoji | text | circle | ring | streak | rect | bar | polygon | stroke | textBlock');
    return;
  }

  for (const k of unknownKeys(sprite, knownSet)) {
    if (LAYER_PROPS_ON_SPRITE.has(k)) {
      warn(`${path}.${k}`, 'misplaced-property', `'${k}' belongs on the layer, not inside sprite — move it up one level`);
    } else {
      warn(`${path}.${k}`, 'unknown-property', `unknown sprite property '${k}' — will be ignored`);
    }
  }
}

/** Shared colors[] + colorWeights[] validation for circle/ring/streak/rect sprites. */
function validatePalette(sprite: Record<string, unknown>, path: string, err: (p: string, m: string) => void): void {
  if (sprite.colors !== undefined) {
    if (!Array.isArray(sprite.colors) || sprite.colors.length === 0) {
      err(`${path}.colors`, 'must be a non-empty array of hex colours');
    } else {
      sprite.colors.forEach((c: unknown, ci: number) => color(c, `${path}.colors[${ci}]`, err));
    }
  }
  if (sprite.colorWeights !== undefined) {
    if (!Array.isArray(sprite.colors)) {
      err(`${path}.colorWeights`, 'requires colors to be set');
    } else if (!Array.isArray(sprite.colorWeights) || sprite.colorWeights.length !== sprite.colors.length) {
      err(`${path}.colorWeights`, 'must be an array the same length as colors');
    } else if (!sprite.colorWeights.every((v: unknown) => isNum(v) && v >= 0) || !sprite.colorWeights.some((v: unknown) => isNum(v) && v > 0)) {
      err(`${path}.colorWeights`, 'weights must be >= 0 with at least one > 0');
    }
  }
}

function validateCycle(sprite: Record<string, unknown>, path: string, err: (p: string, m: string) => void): void {
  if (sprite.cycle === undefined) return;
  if (!isObj(sprite.cycle)) return err(`${path}.cycle`, 'must be an object');
  if (!isNum(sprite.cycle.period) || sprite.cycle.period < LIMITS.minCyclePeriod) {
    err(`${path}.cycle.period`, `must be >= ${LIMITS.minCyclePeriod} ms (flash-safety floor)`);
  }
}

function validateMotion(motion: unknown, path: string, err: (p: string, m: string) => void, warn: WarnFn, spec?: unknown): void {
  if (!isObj(motion)) return err(path, 'must be an object');
  const isViewport = !isObj(spec) || (spec as Record<string, unknown>).units !== 'px';
  const refVp = isObj(spec) && isNum((spec as Record<string, unknown>).referenceViewport) ? (spec as Record<string, unknown>).referenceViewport as number : LIMITS.referenceViewport;
  const speedCap = isViewport ? LIMITS.maxSpeed / refVp : LIMITS.maxSpeed;
  const speedOk = (v: unknown, p: string): void => {
    if (!isRange(v)) err(p, 'must be a [min,max] range');
    else if (v[0] < 0) err(p, 'speed lower bound must be >= 0');
    else if (v[1] > speedCap) err(p, `speed exceeds cap ${isViewport ? speedCap.toFixed(2) + ' viewport-units/sec' : LIMITS.maxSpeed + ' px/sec'}`);
  };

  let knownSet: Set<string>;
  if (motion.type === 'drift') {
    knownSet = KNOWN_DRIFT;
    speedOk(motion.speed, `${path}.speed`);
    if (motion.angle !== undefined && !isNum(motion.angle)) err(`${path}.angle`, 'must be a number (degrees)');
    if (motion.bidirectional !== undefined && typeof motion.bidirectional !== 'boolean') err(`${path}.bidirectional`, 'must be a boolean');
    if (motion.bob !== undefined && !isNum(motion.bob)) err(`${path}.bob`, 'must be a number');
    validateEase(motion.ease, `${path}.ease`, err, warn);
    if (isRange(motion.speed) && motion.speed[1] < 1 && !isViewport) {
      warn(`${path}.speed`, 'near-zero-speed', `max speed is ${motion.speed[1]} px/sec — entities will appear frozen. Typical range: 10–200 px/sec`);
    }
  } else if (motion.type === 'rise') {
    knownSet = KNOWN_RISE;
    speedOk(motion.speed, `${path}.speed`);
    if (motion.sway !== undefined && !isNum(motion.sway)) err(`${path}.sway`, 'must be a number');
    validateEase(motion.ease, `${path}.ease`, err, warn);
    if (isRange(motion.speed) && motion.speed[1] < 1 && !isViewport) {
      warn(`${path}.speed`, 'near-zero-speed', `max speed is ${motion.speed[1]} px/sec — entities will appear frozen. Typical range: 5–80 px/sec`);
    }
  } else if (motion.type === 'bounce') {
    knownSet = KNOWN_BOUNCE;
    speedOk(motion.speed, `${path}.speed`);
    if (isRange(motion.speed) && motion.speed[1] < 1 && !isViewport) {
      warn(`${path}.speed`, 'near-zero-speed', `max speed is ${motion.speed[1]} px/sec — entities will appear frozen. Typical range: 20–150 px/sec`);
    }
  } else if (motion.type === 'static') {
    knownSet = KNOWN_STATIC;
  } else if (motion.type === 'orbit') {
    knownSet = KNOWN_ORBIT;
    if (!isRange(motion.speed)) err(`${path}.speed`, 'must be a [min,max] range');
    else {
      if (Math.abs(motion.speed[0]) > LIMITS.maxOrbitSpeed || Math.abs(motion.speed[1]) > LIMITS.maxOrbitSpeed) err(`${path}.speed`, `orbit speed exceeds cap ${LIMITS.maxOrbitSpeed} deg/sec`);
      if (Math.max(Math.abs(motion.speed[0]), Math.abs(motion.speed[1])) < 1) {
        warn(`${path}.speed`, 'near-zero-speed', `orbit speed is near zero — entities will appear frozen. Typical range: 5–60 deg/sec`);
      }
    }
    if (!isRange(motion.radius) || motion.radius[0] <= 0) err(`${path}.radius`, 'must be a [min,max] range of positive px');
    if (motion.center !== undefined) {
      if (!isObj(motion.center)) {
        err(`${path}.center`, 'must be {x, y} (0..1) or { layer: key }');
      } else if ('layer' in motion.center) {
        if (!isStr(motion.center.layer) || motion.center.layer.trim() === '') {
          err(`${path}.center.layer`, 'must be a non-empty layer key');
        } else if (isObj(spec) && Array.isArray((spec as Record<string, unknown>).layers)) {
          // Scene-graph lite: parent must exist, be a single entity, and not itself
          // orbit a layer (strictly one level deep — keeps positionAt analytic).
          const layers = (spec as { layers: unknown[] }).layers;
          const parent = layers.find((l) => isObj(l) && l.key === (motion.center as { layer: string }).layer) as Record<string, unknown> | undefined;
          if (!parent) {
            err(`${path}.center.layer`, `no layer with key '${motion.center.layer}'`);
          } else {
            if (parent.count !== 1) err(`${path}.center.layer`, 'parent layer must have count: 1');
            const pm = parent.motion;
            if (isObj(pm) && pm.type === 'orbit' && isObj(pm.center) && 'layer' in pm.center) {
              err(`${path}.center.layer`, 'parent may not itself orbit a layer (one level deep only)');
            }
          }
        }
      } else if (!isNum(motion.center.x) || !isNum(motion.center.y)) {
        err(`${path}.center`, 'must be {x, y} with numbers 0..1');
      } else {
        if (motion.center.x < 0 || motion.center.x > 1) err(`${path}.center.x`, 'must be 0..1');
        if (motion.center.y < 0 || motion.center.y > 1) err(`${path}.center.y`, 'must be 0..1');
      }
    }
  } else if (motion.type === 'wander') {
    knownSet = KNOWN_WANDER;
    validateEase(motion.ease, `${path}.ease`, err, warn);
    speedOk(motion.speed, `${path}.speed`);
    if (motion.angle !== undefined && !isNum(motion.angle)) err(`${path}.angle`, 'must be a number (degrees)');
    const meanderCap = isViewport ? LIMITS.maxMeander / refVp : LIMITS.maxMeander;
    if (motion.meander !== undefined && (!isNum(motion.meander) || motion.meander <= 0 || motion.meander > meanderCap)) {
      err(`${path}.meander`, `must be > 0 and <= ${isViewport ? meanderCap.toFixed(3) + ' viewport-units' : LIMITS.maxMeander + ' px'}`);
    }
    if (motion.coherence !== undefined && (!isNum(motion.coherence) || motion.coherence < 0 || motion.coherence > 1)) {
      err(`${path}.coherence`, 'must be 0..1');
    }
  } else if (motion.type === 'warp') {
    knownSet = KNOWN_WARP;
    if (!isRange(motion.speed) || motion.speed[0] < 0) err(`${path}.speed`, 'must be a [min,max] range >= 0 (depth-units/sec)');
    else if (motion.speed[1] > LIMITS.maxWarpSpeed) err(`${path}.speed`, `warp speed exceeds cap ${LIMITS.maxWarpSpeed} depth-units/sec`);
    if (motion.center !== undefined) {
      if (!isObj(motion.center) || !isNum(motion.center.x) || !isNum(motion.center.y)) {
        err(`${path}.center`, 'must be {x, y} with numbers 0..1');
      } else {
        if (motion.center.x < 0 || motion.center.x > 1) err(`${path}.center.x`, 'must be 0..1');
        if (motion.center.y < 0 || motion.center.y > 1) err(`${path}.center.y`, 'must be 0..1');
      }
    }
  } else if (motion.type === 'path') {
    knownSet = KNOWN_PATH;
    if (!Array.isArray(motion.points) || motion.points.length < LIMITS.minPathPoints || motion.points.length > LIMITS.maxPathPoints) {
      err(`${path}.points`, `must be an array of ${LIMITS.minPathPoints}..${LIMITS.maxPathPoints} points`);
    } else {
      motion.points.forEach((p: unknown, pi: number) => {
        if (!isObj(p) || !isNum(p.x) || !isNum(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
          err(`${path}.points[${pi}]`, 'must be {x, y} with numbers 0..1');
        }
      });
    }
    if (!isNum(motion.duration) || motion.duration < LIMITS.minPathDuration) {
      err(`${path}.duration`, `must be >= ${LIMITS.minPathDuration} ms`);
    }
    if (motion.curve !== undefined && motion.curve !== 'linear' && motion.curve !== 'smooth') {
      err(`${path}.curve`, "must be 'linear' | 'smooth'");
    }
    if (motion.closed !== undefined && typeof motion.closed !== 'boolean') err(`${path}.closed`, 'must be a boolean');
    const scatterCap = isViewport ? LIMITS.maxMeander / refVp : LIMITS.maxMeander;
    if (motion.scatter !== undefined && (!isNum(motion.scatter) || motion.scatter <= 0 || motion.scatter > scatterCap)) {
      err(`${path}.scatter`, `must be > 0 and <= ${isViewport ? scatterCap.toFixed(3) + ' viewport-units' : LIMITS.maxMeander + ' px'}`);
    }
  } else {
    err(`${path}.type`, 'must be drift | rise | bounce | static | orbit | wander | warp | path');
    return;
  }

  for (const k of unknownKeys(motion, knownSet)) {
    warn(`${path}.${k}`, 'unknown-property', `unknown motion property '${k}' — will be ignored`);
  }
}

/** `points` for polygon/stroke: 2..24 (or 3..24) unit pairs inside the −1..1 box. */
function validateShapePoints(points: unknown, path: string, min: number, err: (p: string, m: string) => void): void {
  if (!Array.isArray(points) || points.length < min || points.length > LIMITS.maxShapePoints) {
    return err(path, `must be ${min}..${LIMITS.maxShapePoints} [x, y] pairs in unit coordinates (-1..1)`);
  }
  for (let i = 0; i < points.length; i++) {
    const pt: unknown = points[i]; // by index, so a sparse array's holes are rejected too
    if (!Array.isArray(pt) || pt.length !== 2 || !isNum(pt[0]) || !isNum(pt[1]) || Math.abs(pt[0]) > 1 || Math.abs(pt[1]) > 1) {
      err(`${path}[${i}]`, 'must be an [x, y] pair with each coordinate in -1..1');
    }
  }
}

function validateEase(ease: unknown, path: string, err: (p: string, m: string) => void, warn: WarnFn): void {
  if (ease === undefined) return;
  if (!isObj(ease)) return err(path, "must be an object { type: 'settle' | 'buoyant', tau }");
  if (ease.type !== 'settle' && ease.type !== 'buoyant') err(`${path}.type`, "must be 'settle' | 'buoyant'");
  if (!isNum(ease.tau) || ease.tau < LIMITS.minEaseTau || ease.tau > LIMITS.maxEaseTau) {
    err(`${path}.tau`, `must be ${LIMITS.minEaseTau}..${LIMITS.maxEaseTau} ms`);
  }
  for (const k of unknownKeys(ease, new Set(['type', 'tau']))) {
    warn(`${path}.${k}`, 'unknown-property', `unknown ease property '${k}' — will be ignored`);
  }
}

/** Narrowing helper: validate + cast. Throws with a joined message when invalid. */
export function assertValidSpec(spec: unknown): SaverSpec {
  const r = validateSpec(spec);
  if (!r.valid) {
    throw new Error(`invalid saver spec:\n${r.errors.map((e) => `  ${e.path || '<root>'}: ${e.message}`).join('\n')}`);
  }
  return spec as SaverSpec;
}

/**
 * Validate a sequence envelope. Each segment's `scene` goes through `validateSpec`;
 * sequence-level rules (segment count, duration floors, key uniqueness, transition
 * bounds) are checked here.
 */
export function validateSequence(seq: unknown): ValidationResult {
  // Normalize each segment's scene (F3: colors-without-color auto-default)
  if (isObj(seq) && Array.isArray(seq.segments)) {
    for (const seg of seq.segments) {
      if (isObj(seg) && isObj((seg as Record<string, unknown>).scene)) {
        normalizeColors((seg as Record<string, unknown>).scene);
      }
    }
  }
  const errors: SpecError[] = [];
  const warnings: SpecWarning[] = [];
  const err = (path: string, message: string): void => void errors.push({ path, message });

  if (!isObj(seq)) return { valid: false, errors: [{ path: '', message: 'sequence must be an object' }], warnings: [] };

  if (seq.format !== 'idle-sequence') err('format', "must be 'idle-sequence'");
  if (seq.schemaVersion !== SCHEMA_VERSION) err('schemaVersion', `must be ${SCHEMA_VERSION}`);
  if (!isStr(seq.id) || seq.id.trim() === '') err('id', 'must be a non-empty string');
  if (!isStr(seq.label) || seq.label.trim() === '') err('label', 'must be a non-empty string');
  if (seq.seed !== undefined && !isNum(seq.seed)) err('seed', 'must be a number');
  if (typeof seq.loop !== 'boolean') err('loop', 'must be a boolean');

  if (!Array.isArray(seq.segments) || seq.segments.length === 0) {
    err('segments', 'must be a non-empty array');
    return { valid: false, errors, warnings };
  }

  if (seq.segments.length > LIMITS.maxSegments) {
    err('segments', `at most ${LIMITS.maxSegments} segments`);
  }

  const keys = new Set<string>();
  let hasDurationless = false;

  for (let i = 0; i < seq.segments.length; i++) {
    const s = seq.segments[i];
    const p = `segments[${i}]`;
    if (!isObj(s)) { err(p, 'must be an object'); continue; }

    if (!isStr(s.key) || s.key.trim() === '') {
      err(`${p}.key`, 'must be a non-empty string');
    } else if (keys.has(s.key as string)) {
      err(`${p}.key`, `duplicate key '${s.key}'`);
    } else {
      keys.add(s.key as string);
    }

    if (s.duration !== undefined) {
      if (hasDurationless) {
        err(`${p}.duration`, 'a segment after a durationless segment may not have a duration');
      }
      if (!isNum(s.duration) || s.duration < LIMITS.minSegmentDuration) {
        err(`${p}.duration`, `must be >= ${LIMITS.minSegmentDuration} ms`);
      }
    } else {
      if (i < seq.segments.length - 1) {
        err(`${p}.duration`, 'only the final segment may omit duration');
      }
      hasDurationless = true;
    }

    if (s.advance !== undefined && !['auto', 'input', 'either'].includes(s.advance as string)) {
      err(`${p}.advance`, "must be 'auto' | 'input' | 'either'");
    }

    if (s.transition !== undefined) {
      if (!isObj(s.transition)) {
        err(`${p}.transition`, 'must be an object');
      } else if (s.transition.type === 'morph') {
        if (!isNum(s.transition.dur) || s.transition.dur < LIMITS.minTransitionDur || s.transition.dur > LIMITS.maxTransitionDur) {
          err(`${p}.transition.dur`, `must be a number between ${LIMITS.minTransitionDur} and ${LIMITS.maxTransitionDur}`);
        }
      } else if (s.transition.type !== 'cut') {
        err(`${p}.transition.type`, "must be 'cut' or 'morph'");
      }
    }

    if (isObj(s.scene)) {
      const sceneResult = validateSpec(s.scene);
      for (const e of sceneResult.errors) errors.push({ path: `${p}.scene.${e.path}`, message: e.message });
      if (sceneResult.warnings) {
        for (const w of sceneResult.warnings) warnings.push({ path: `${p}.scene.${w.path}`, code: w.code, message: w.message });
      }
    } else {
      err(`${p}.scene`, 'must be a valid SaverSpec object');
    }
  }

  if (seq.loop === true && hasDurationless) {
    err('loop', 'loop: true requires all segments to have a duration');
  }

  // Warn when morph is requested but signatures differ (will fall back to cut)
  if (errors.length === 0 && Array.isArray(seq.segments)) {
    for (let i = 0; i < seq.segments.length; i++) {
      const s = seq.segments[i];
      if (!isObj(s) || !isObj(s.transition) || s.transition.type !== 'morph') continue;
      const next = seq.segments[i + 1];
      if (!next || !isObj(next) || !isObj(s.scene) || !isObj(next.scene)) continue;
      const sigA = structuralSignature(s.scene as unknown as SaverSpec);
      const sigB = structuralSignature((next as Record<string, unknown>).scene as unknown as SaverSpec);
      if (sigA !== sigB) {
        warnings.push({
          path: `segments[${i}].transition`,
          code: 'morph-structural-mismatch',
          message: `segments ${i}→${i + 1} differ structurally: morph will fall back to cut`,
        });
      } else if (morphNothingMorphable(s.scene as unknown as SaverSpec, (next as Record<string, unknown>).scene as unknown as SaverSpec)) {
        // Structural twins whose only differences are values lerpSpec steps
        // (strings — textBlock.text above all). The morph runs, but every
        // frame of it shows segment i+1: it reads as a cut. A warning, never
        // an error, so every stored sequence stays valid.
        warnings.push({
          path: `segments[${i}].transition`,
          code: 'morph-nothing-morphable',
          message: `segments ${i}→${i + 1} differ only in values morph cannot interpolate (strings such as textBlock.text step on the first frame): the morph will look like a cut — fade text via colour or reveal.progress`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function assertValidSequence(seq: unknown): IdleSequence {
  const r = validateSequence(seq);
  if (!r.valid) {
    throw new Error(`invalid sequence:\n${r.errors.map((e) => `  ${e.path || '<root>'}: ${e.message}`).join('\n')}`);
  }
  return seq as IdleSequence;
}
