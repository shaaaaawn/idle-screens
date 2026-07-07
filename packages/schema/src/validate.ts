import { LIMITS, SCHEMA_VERSION, type SaverSpec, type SpecError, type ValidationResult } from './types';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRange = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[0] <= v[1];

/**
 * Validate an untrusted (agent- or JSON-authored) spec structurally + semantically.
 * Returns typed errors; never throws. `compileSaver` refuses to run an invalid spec.
 */
export function validateSpec(spec: unknown): ValidationResult {
  const errors: SpecError[] = [];
  const err = (path: string, message: string): void => void errors.push({ path, message });

  if (!isObj(spec)) return { valid: false, errors: [{ path: '', message: 'spec must be an object' }] };

  if (spec.schemaVersion !== SCHEMA_VERSION) err('schemaVersion', `must be ${SCHEMA_VERSION}`);
  if (!isStr(spec.id) || spec.id.trim() === '') err('id', 'must be a non-empty string');
  if (!isStr(spec.label) || spec.label.trim() === '') err('label', 'must be a non-empty string');
  if (spec.seed !== undefined && !isNum(spec.seed)) err('seed', 'must be a number');
  if (spec.motionIntensity !== undefined && !['calm', 'moderate', 'energetic'].includes(spec.motionIntensity as string)) {
    err('motionIntensity', 'must be calm | moderate | energetic');
  }

  if (spec.background !== undefined) validateBackground(spec.background, err);

  if (!Array.isArray(spec.layers) || spec.layers.length === 0) {
    err('layers', 'must be a non-empty array');
  } else {
    if (spec.layers.length > LIMITS.maxLayers) err('layers', `at most ${LIMITS.maxLayers} layers`);
    let total = 0;
    spec.layers.forEach((layer, i) => {
      total += isObj(layer) && isNum(layer.count) ? layer.count : 0;
      validateLayer(layer, `layers[${i}]`, err);
    });
    if (total > LIMITS.maxTotal) err('layers', `total entities ${total} exceeds cap ${LIMITS.maxTotal}`);
  }

  return { valid: errors.length === 0, errors };
}

function color(v: unknown, path: string, err: (p: string, m: string) => void): void {
  if (!isStr(v) || !HEX.test(v)) err(path, 'must be a hex colour like #0a3a52');
}

function validateBackground(bg: unknown, err: (p: string, m: string) => void): void {
  if (!isObj(bg)) return err('background', 'must be an object');
  if (bg.type === 'solid') {
    color(bg.color, 'background.color', err);
  } else if (bg.type === 'gradient') {
    if (!Array.isArray(bg.stops) || bg.stops.length < 2) {
      err('background.stops', 'gradient needs at least 2 stops');
    } else {
      bg.stops.forEach((s, i) => {
        if (!isObj(s) || !isNum(s.at) || s.at < 0 || s.at > 1) err(`background.stops[${i}].at`, 'must be 0..1');
        color(isObj(s) ? s.color : undefined, `background.stops[${i}].color`, err);
      });
    }
    if (bg.band !== undefined) {
      if (!isObj(bg.band)) err('background.band', 'must be an object');
      else {
        color(bg.band.color, 'background.band.color', err);
        if (!isNum(bg.band.height) || bg.band.height <= 0) err('background.band.height', 'must be > 0');
      }
    }
  } else {
    err('background.type', 'must be solid | gradient');
  }
}

function validateLayer(layer: unknown, path: string, err: (p: string, m: string) => void): void {
  if (!isObj(layer)) return err(path, 'must be an object');
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

  validateSprite(layer.sprite, `${path}.sprite`, err);
  validateMotion(layer.motion, `${path}.motion`, err);
}

function validateSprite(sprite: unknown, path: string, err: (p: string, m: string) => void): void {
  if (!isObj(sprite)) return err(path, 'must be an object');
  if (sprite.kind === 'emoji') {
    if (!Array.isArray(sprite.glyphs) || sprite.glyphs.length === 0 || !sprite.glyphs.every(isStr)) {
      err(`${path}.glyphs`, 'must be a non-empty array of strings');
    }
  } else if (sprite.kind === 'text') {
    if (!Array.isArray(sprite.strings) || sprite.strings.length === 0 || !sprite.strings.every(isStr)) {
      err(`${path}.strings`, 'must be a non-empty array of strings');
    }
    if (sprite.color !== undefined) color(sprite.color, `${path}.color`, err);
  } else if (sprite.kind === 'circle') {
    if (!isRange(sprite.radius) || sprite.radius[0] <= 0) err(`${path}.radius`, 'must be a [min,max] range of positive px');
    color(sprite.color, `${path}.color`, err);
    if (sprite.soft !== undefined && typeof sprite.soft !== 'boolean') err(`${path}.soft`, 'must be a boolean');
  } else {
    err(`${path}.kind`, 'must be emoji | text | circle');
  }
}

function validateMotion(motion: unknown, path: string, err: (p: string, m: string) => void): void {
  if (!isObj(motion)) return err(path, 'must be an object');
  const speedOk = (v: unknown, p: string): void => {
    if (!isRange(v)) err(p, 'must be a [min,max] range');
    else if (v[1] > LIMITS.maxSpeed) err(p, `speed exceeds cap ${LIMITS.maxSpeed} px/sec`);
  };
  if (motion.type === 'drift') {
    speedOk(motion.speed, `${path}.speed`);
    if (motion.angle !== undefined && !isNum(motion.angle)) err(`${path}.angle`, 'must be a number (degrees)');
    if (motion.bidirectional !== undefined && typeof motion.bidirectional !== 'boolean') err(`${path}.bidirectional`, 'must be a boolean');
    if (motion.bob !== undefined && !isNum(motion.bob)) err(`${path}.bob`, 'must be a number');
  } else if (motion.type === 'rise') {
    speedOk(motion.speed, `${path}.speed`);
    if (motion.sway !== undefined && !isNum(motion.sway)) err(`${path}.sway`, 'must be a number');
  } else if (motion.type === 'bounce') {
    speedOk(motion.speed, `${path}.speed`);
  } else {
    err(`${path}.type`, 'must be drift | rise | bounce');
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
