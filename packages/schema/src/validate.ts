import { LIMITS, SCHEMA_VERSION, type SaverSpec, type SpecError, type SpecWarning, type ValidationResult } from './types';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRange = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[0] <= v[1];

// Known properties at each level — used to detect unknown/misplaced fields
const KNOWN_TOP = new Set(['schemaVersion', 'id', 'label', 'seed', 'motionIntensity', 'units', 'background', 'layers']);
const KNOWN_LAYER = new Set([
  'count', 'sprite', 'motion', 'size', 'wrap', 'flip', 'alpha', 'blend',
  'region', 'pulse', 'spin', 'grow', 'key', 'position', 'trail', 'links',
]);
const KNOWN_CIRCLE = new Set(['kind', 'radius', 'color', 'soft', 'colors']);
const KNOWN_EMOJI = new Set(['kind', 'glyphs', 'cycle']);
const KNOWN_TEXT = new Set(['kind', 'strings', 'color', 'font', 'align', 'baseline', 'maxWidth', 'cycle']);
const KNOWN_DRIFT = new Set(['type', 'speed', 'angle', 'bidirectional', 'bob']);
const KNOWN_RISE = new Set(['type', 'speed', 'sway']);
const KNOWN_BOUNCE = new Set(['type', 'speed']);
const KNOWN_STATIC = new Set(['type']);
const KNOWN_ORBIT = new Set(['type', 'speed', 'radius', 'center']);
const KNOWN_BG_SOLID = new Set(['type', 'color']);
const KNOWN_BG_GRADIENT = new Set(['type', 'stops', 'band', 'drift']);

// Layer-level properties that models commonly misplace inside sprite
const LAYER_PROPS_ON_SPRITE = new Set(['blend', 'trail', 'alpha', 'pulse', 'spin', 'grow', 'region', 'links', 'flip', 'wrap', 'key']);

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
export function validateSpec(spec: unknown): ValidationResult {
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
  if (spec.units !== undefined && spec.units !== 'px' && spec.units !== 'viewport') {
    err('units', "must be 'px' | 'viewport'");
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
          err('background.drift.amount', `must be within 0..${LIMITS.maxDriftAmount}`);
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
      warn(`${path}.depth`, 'unknown-property', `'depth' is not yet supported — fake parallax with size/speed/alpha across layers instead`);
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
  if (layer.blend !== undefined && layer.blend !== 'lighter') err(`${path}.blend`, "must be 'lighter' when set");
  if (layer.key !== undefined && (!isStr(layer.key) || layer.key.trim() === '')) {
    err(`${path}.key`, 'must be a non-empty string');
  }
  if (layer.position !== undefined) {
    if (!isObj(layer.position) || !isNum(layer.position.x) || !isNum(layer.position.y)) {
      err(`${path}.position`, 'must be {x, y} with numbers 0..1');
    } else {
      if (layer.position.x < 0 || layer.position.x > 1) err(`${path}.position.x`, 'must be 0..1');
      if (layer.position.y < 0 || layer.position.y > 1) err(`${path}.position.y`, 'must be 0..1');
      if (isNum(layer.count) && layer.count !== 1) err(`${path}.position`, 'position requires count: 1');
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
    }
  }
  if (layer.spin !== undefined) {
    if (!isNum(layer.spin)) err(`${path}.spin`, 'must be a number (degrees/sec)');
    else if (Math.abs(layer.spin) > LIMITS.maxSpin) err(`${path}.spin`, `must be within ±${LIMITS.maxSpin} deg/sec`);
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
      if (isNum(layer.count) && layer.count > LIMITS.maxLinkLayerCount) {
        err(`${path}.links`, `layer count must be <= ${LIMITS.maxLinkLayerCount} when links is set`);
      }
    }
  }

  if (layer.trail !== undefined) {
    if (!isObj(layer.trail)) err(`${path}.trail`, 'must be an object');
    else {
      if (!isNum(layer.trail.length) || layer.trail.length <= 0 || layer.trail.length > LIMITS.maxTrailLength) {
        err(`${path}.trail.length`, `must be 1..${LIMITS.maxTrailLength} ms`);
      }
      if (layer.trail.fade !== undefined && (!isNum(layer.trail.fade) || layer.trail.fade < 0 || layer.trail.fade > 1)) {
        err(`${path}.trail.fade`, 'must be 0..1');
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
    if (sprite.colors !== undefined) {
      if (!Array.isArray(sprite.colors) || sprite.colors.length === 0) {
        err(`${path}.colors`, 'must be a non-empty array of hex colours');
      } else {
        sprite.colors.forEach((c: unknown, ci: number) => color(c, `${path}.colors[${ci}]`, err));
      }
    }
  } else {
    err(`${path}.kind`, 'must be emoji | text | circle');
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

function validateCycle(sprite: Record<string, unknown>, path: string, err: (p: string, m: string) => void): void {
  if (sprite.cycle === undefined) return;
  if (!isObj(sprite.cycle)) return err(`${path}.cycle`, 'must be an object');
  if (!isNum(sprite.cycle.period) || sprite.cycle.period < LIMITS.minCyclePeriod) {
    err(`${path}.cycle.period`, `must be >= ${LIMITS.minCyclePeriod} ms (flash-safety floor)`);
  }
}

function validateMotion(motion: unknown, path: string, err: (p: string, m: string) => void, warn: WarnFn, spec?: unknown): void {
  if (!isObj(motion)) return err(path, 'must be an object');
  const isViewport = isObj(spec) && (spec as Record<string, unknown>).units === 'viewport';
  const speedCap = isViewport ? LIMITS.maxSpeed / LIMITS.referenceViewport : LIMITS.maxSpeed;
  const speedOk = (v: unknown, p: string): void => {
    if (!isRange(v)) err(p, 'must be a [min,max] range');
    else if (v[1] > speedCap) err(p, `speed exceeds cap ${isViewport ? speedCap.toFixed(2) + ' viewport-units/sec' : LIMITS.maxSpeed + ' px/sec'}`);
  };

  let knownSet: Set<string>;
  if (motion.type === 'drift') {
    knownSet = KNOWN_DRIFT;
    speedOk(motion.speed, `${path}.speed`);
    if (motion.angle !== undefined && !isNum(motion.angle)) err(`${path}.angle`, 'must be a number (degrees)');
    if (motion.bidirectional !== undefined && typeof motion.bidirectional !== 'boolean') err(`${path}.bidirectional`, 'must be a boolean');
    if (motion.bob !== undefined && !isNum(motion.bob)) err(`${path}.bob`, 'must be a number');
    if (isRange(motion.speed) && motion.speed[1] < 1 && !isViewport) {
      warn(`${path}.speed`, 'near-zero-speed', `max speed is ${motion.speed[1]} px/sec — entities will appear frozen. Typical range: 10–200 px/sec`);
    }
  } else if (motion.type === 'rise') {
    knownSet = KNOWN_RISE;
    speedOk(motion.speed, `${path}.speed`);
    if (motion.sway !== undefined && !isNum(motion.sway)) err(`${path}.sway`, 'must be a number');
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
      if (motion.speed[1] < 1) {
        warn(`${path}.speed`, 'near-zero-speed', `max orbit speed is ${motion.speed[1]} deg/sec — entities will appear frozen. Typical range: 5–60 deg/sec`);
      }
    }
    if (!isRange(motion.radius) || motion.radius[0] <= 0) err(`${path}.radius`, 'must be a [min,max] range of positive px');
    if (motion.center !== undefined) {
      if (!isObj(motion.center) || !isNum(motion.center.x) || !isNum(motion.center.y)) {
        err(`${path}.center`, 'must be {x, y} with numbers 0..1');
      } else {
        if (motion.center.x < 0 || motion.center.x > 1) err(`${path}.center.x`, 'must be 0..1');
        if (motion.center.y < 0 || motion.center.y > 1) err(`${path}.center.y`, 'must be 0..1');
      }
    }
  } else {
    err(`${path}.type`, 'must be drift | rise | bounce | static | orbit');
    return;
  }

  for (const k of unknownKeys(motion, knownSet)) {
    warn(`${path}.${k}`, 'unknown-property', `unknown motion property '${k}' — will be ignored`);
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
