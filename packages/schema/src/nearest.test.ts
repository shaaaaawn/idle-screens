/**
 * #122 step 1: "did you mean" in validator messages — the `nearest` /
 * `nearestPath` rule, then every way validate.ts appends it. Each message is
 * the original wording plus a suffix, never a rewrite: idle-server's smoke
 * greps the original text.
 */
import { describe, expect, it } from 'vitest';
import { nearest, nearestPath } from './nearest';
import { steerablePaths, suggestSpecPath } from './steer';
import { ignoredPropertyPaths, validateSequence, validateSpec } from './validate';

const scene = (layers: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 1, id: 'dym', label: 'Did you mean', background: { type: 'solid', color: '#0a0f1e' }, layers, ...extra,
});
const dots = (extra: Record<string, unknown> = {}, sprite: Record<string, unknown> = {}, motion: Record<string, unknown> = {}): Record<string, unknown> => ({
  count: 10,
  sprite: { kind: 'circle', radius: [0.004, 0.01], color: '#ffd9a0', ...sprite },
  motion: { type: 'drift', speed: [0.01, 0.03], ...motion },
  ...extra,
});
const warning = (spec: unknown, path: string): string | undefined =>
  (validateSpec(structuredClone(spec)).warnings ?? []).find((w) => w.path === path)?.message;
const error = (spec: unknown, path: string): string | undefined =>
  validateSpec(structuredClone(spec)).errors.find((e) => e.path === path)?.message;

describe('nearest', () => {
  it('suggests the one close name for a typo', () => {
    expect(nearest('radus', ['radius', 'color', 'soft'])).toBe('radius');
    expect(nearest('speeed', ['speed', 'angle', 'bob'])).toBe('speed');
  });

  it('counts a transposed pair as one edit', () => {
    expect(nearest('aplha', ['alpha', 'blend'])).toBe('alpha');
    expect(nearest('drfit', ['drift', 'rise', 'orbit'])).toBe('drift');
  });

  it('ignores case, so a lower-cased camelCase name finds its field', () => {
    expect(nearest('fontsize', ['fontSize', 'font', 'lineHeight'])).toBe('fontSize');
    expect(nearest('maxwidth', ['maxWidth', 'width'])).toBe('maxWidth');
  });

  it('suggests nothing when two names are equally close — a wrong hint is worse than none', () => {
    expect(nearest('sise', ['size', 'side'])).toBeUndefined();
    expect(nearest('rat', ['rate', 'rap'])).toBeUndefined();
    // Not a tie: `colour` is one edit from `color`, two from `colors`.
    expect(nearest('colour', ['color', 'colors'])).toBe('color');
  });

  it('suggests nothing for a far-off name', () => {
    expect(nearest('zorp', ['speed', 'angle', 'bidirectional', 'bob', 'ease'])).toBeUndefined();
    expect(nearest('blending', ['blend'])).toBeUndefined();
  });

  it('suggests nothing for a short name but a case variant', () => {
    expect(nearest('dz', ['x', 'y', 'dx', 'dy'])).toBeUndefined();
    expect(nearest('z', ['x'])).toBeUndefined();
    expect(nearest('X', ['x', 'y'])).toBe('x');
  });

  it('suggests nothing for a name that is already a candidate', () => {
    expect(nearest('speed', ['speed', 'sped'])).toBeUndefined();
  });

  it('takes any iterable, a Set included, and does not count a repeated candidate as a tie', () => {
    expect(nearest('sped', new Set(['speed', 'angle']))).toBe('speed');
    expect(nearest('sped', ['speed', 'speed'])).toBe('speed');
  });
});

describe('nearestPath', () => {
  const spec = scene([dots(), dots({}, { kind: 'ring', width: 0.002 }, { type: 'orbit', speed: [0.1, 0.2], radius: [0.1, 0.2] })]);
  const paths = steerablePaths(spec);

  it('finds the missing parent: layers.0.speed → layers.0.motion.speed (the setParam case)', () => {
    expect(nearestPath('layers.0.speed', paths)).toBe('layers.0.motion.speed');
  });

  it('finds the extra parent: layers.0.sprite.alpha → layers.0.alpha', () => {
    const withAlpha = scene([dots({ alpha: [0.4, 0.8] })]);
    expect(nearestPath('layers.0.sprite.alpha', steerablePaths(withAlpha))).toBe('layers.0.alpha');
  });

  it('fixes one misspelt segment, with brackets read as dots', () => {
    expect(nearestPath('layers.0.sprite.radious', paths)).toBe('layers.0.sprite.radius');
    expect(nearestPath('layers[0].sprite.raduis', paths)).toBe('layers.0.sprite.radius');
    expect(nearestPath('background.colour', paths)).toBe('background.color');
  });

  it('never changes an index or the leaf', () => {
    expect(nearestPath('layers.2.motion.speed', paths)).toBeUndefined();
    expect(nearestPath('layers.0.motion', paths)).toBeUndefined();
  });

  it('suggests nothing when two paths are equally close', () => {
    // Layer 1 has both sprite.radius and motion.radius (orbit).
    expect(nearestPath('layers.1.radius', paths)).toBeUndefined();
  });

  it('suggests nothing for a path that resolves, or one far from every candidate', () => {
    expect(nearestPath('layers.0.motion.speed', paths)).toBeUndefined();
    expect(nearestPath('layers.0.zorp.blah', paths)).toBeUndefined();
  });
});

describe('suggestSpecPath', () => {
  const spec = scene([dots({ key: 'fireflies' })]);

  it('suggests against the spec\'s steerable paths', () => {
    expect(suggestSpecPath(spec, 'layers.0.speed')).toBe('layers.0.motion.speed');
  });

  it('answers a layer-key path in the same form', () => {
    expect(suggestSpecPath(spec, 'fireflies.speed')).toBe('fireflies.motion.speed');
    expect(suggestSpecPath(spec, 'fireflies.sprite.colr')).toBe('fireflies.sprite.color');
  });

  it('is undefined on a classic saver or a path with no close match', () => {
    expect(suggestSpecPath({ id: 'warp' }, 'speed')).toBeUndefined();
    expect(suggestSpecPath(spec, 'layers.0.zorp')).toBeUndefined();
  });
});

describe('validateSpec appends the hint and keeps the original wording', () => {
  it('a typo gets the nearest field (sprite, layer, background)', () => {
    expect(warning(scene([dots({}, { raduis: [0.01, 0.02] })]), 'layers[0].sprite.raduis'))
      .toBe("unknown sprite property 'raduis' — will be ignored — did you mean 'radius'?");
    expect(warning(scene([dots({ blnd: 'lighter' })]), 'layers[0].blnd'))
      .toBe("unknown layer property 'blnd' — will be ignored — did you mean 'blend'?");
    expect(warning(scene([dots()], { background: { type: 'solid', colour: '#000000', color: '#000000' } }), 'background.colour'))
      .toBe("unknown background property 'colour' — will be ignored — did you mean 'color'?");
  });

  it('a far-off name keeps the plain message', () => {
    expect(warning(scene([dots({ zorp: 1 })]), 'layers[0].zorp')).toBe("unknown layer property 'zorp' — will be ignored");
    expect(warning(scene([dots({}, {}, { zorp: 1 })]), 'layers[0].motion.zorp')).toBe("unknown motion property 'zorp' — will be ignored");
  });

  it('a field another motion type owns names that type', () => {
    expect(warning(scene([dots({}, {}, { sway: 0.01 })]), 'layers[0].motion.sway'))
      .toBe("unknown motion property 'sway' — will be ignored — 'sway' belongs to motion type 'rise'");
  });

  it('a field several types own names them all, and a long list is cut', () => {
    expect(warning(scene([dots({}, {}, { center: { x: 0.5, y: 0.5 } })]), 'layers[0].motion.center'))
      .toBe("unknown motion property 'center' — will be ignored — 'center' belongs to motion types 'orbit', 'warp'");
    expect(warning(scene([dots({}, { sides: 6 })]), 'layers[0].sprite.sides'))
      .toBe("unknown sprite property 'sides' — will be ignored — 'sides' belongs to sprite kind 'polygon'");
    const emoji = { count: 4, size: [0.03, 0.05], sprite: { kind: 'emoji', glyphs: ['🌙'], color: '#ffffff' }, motion: { type: 'drift', speed: [0.01, 0.02] } };
    expect(warning(scene([emoji]), 'layers[0].sprite.color'))
      .toMatch(/^unknown sprite property 'color' — will be ignored — 'color' belongs to sprite kinds 'text', 'circle', 'ring', 'streak' and \d+ more$/);
  });

  it('a sprite or motion field on the layer is pointed inside', () => {
    expect(warning(scene([dots({ speed: [0.01, 0.02] })]), 'layers[0].speed'))
      .toBe("unknown layer property 'speed' — will be ignored — 'speed' belongs inside `motion`");
    expect(warning(scene([dots({ color: '#ffffff' })]), 'layers[0].color'))
      .toBe("unknown layer property 'color' — will be ignored — 'color' belongs inside `sprite`");
    expect(warning(scene([dots({ radius: [0.01, 0.02] })]), 'layers[0].radius'))
      .toBe("unknown layer property 'radius' — will be ignored — 'radius' belongs inside `sprite` or `motion`");
  });

  it('another background type owns the field', () => {
    expect(warning(scene([dots()], { background: { type: 'solid', color: '#000000', stops: [] } }), 'background.stops'))
      .toBe("unknown background property 'stops' — will be ignored — 'stops' belongs to background type 'gradient'");
  });

  it('a curated hint wins, alone', () => {
    const sway = warning(scene([dots({ sway: 0.01 })]), 'layers[0].sway')!;
    expect(sway).toBe("unknown layer property 'sway' — will be ignored — use `rock` (a swing back and forth), or `sway` on a rise motion");
    const id = warning(scene([dots({ id: 'a' })]), 'layers[0].id')!;
    expect(id).toBe("'id' is not a layer property — did you mean 'key'? Use 'key' to name a layer");
    const easing = warning(scene([dots({}, {}, { easing: 'out' })]), 'layers[0].motion.easing')!;
    expect(easing.match(/ — /g)).toHaveLength(2);
    expect(easing).not.toContain('did you mean');
  });

  it('keeps the warning codes, so ignoredPropertyPaths reports the same paths', () => {
    const spec = scene([dots({ speed: [0.01, 0.02] }, { raduis: [0.01, 0.02] }, { sway: 0.01 })]);
    const w = validateSpec(structuredClone(spec)).warnings ?? [];
    expect(w.map((x) => `${x.path} ${x.code}`)).toEqual([
      'layers[0].speed unknown-property', 'layers[0].sprite.raduis unknown-property', 'layers[0].motion.sway unknown-property',
    ]);
    expect(ignoredPropertyPaths(spec)).toEqual(['layers.0.speed', 'layers.0.sprite.raduis', 'layers.0.motion.sway']);
  });

  it('an unknown reveal field (an error) gets the nearest one', () => {
    const tb = { count: 1, sprite: { kind: 'textBlock', text: 'hello', fontSize: 0.05, color: '#ffffff', reveal: { mode: 'typewriter', sped: 10 } }, motion: { type: 'static' }, position: { x: 0.5, y: 0.5 } };
    expect(error(scene([tb]), 'layers[0].sprite.reveal.sped')).toBe("unknown reveal field — did you mean 'speed'?");
  });
});

describe('enum errors suggest the nearest option', () => {
  it('quoted options, `when set` included', () => {
    expect(error(scene([dots({ blend: 'lightr' })]), 'layers[0].blend'))
      .toBe("must be 'lighter' | 'screen' | 'multiply' when set — did you mean 'lighter'?");
    expect(error(scene([dots({ blend: 'Lighter' })]), 'layers[0].blend'))
      .toBe("must be 'lighter' | 'screen' | 'multiply' when set — did you mean 'lighter'?");
  });

  it('bare options', () => {
    expect(error(scene([dots({}, {}, { type: 'drfit' })]), 'layers[0].motion.type'))
      .toBe('must be drift | rise | bounce | static | orbit | wander | warp | path — did you mean \'drift\'?');
    expect(error(scene([dots()], { motionIntensity: 'calmm' }), 'motionIntensity'))
      .toBe("must be calm | moderate | energetic — did you mean 'calm'?");
  });

  it('options glossed in parentheses', () => {
    const line = { count: 1, sprite: { kind: 'stroke', length: [0.2, 0.3], color: '#ffffff', width: 0.003, draw: { mode: 'eech' } }, motion: { type: 'static' } };
    expect(error(scene([line]), 'layers[0].sprite.draw.mode'))
      .toBe("must be 'run' (one pen run through every subpath, default) | 'each' (every subpath draws at once) — did you mean 'each'?");
  });

  it('nothing for a far-off value, or one that is not a string', () => {
    expect(error(scene([dots({ blend: 'glow' })]), 'layers[0].blend')).toBe("must be 'lighter' | 'screen' | 'multiply' when set");
    expect(error(scene([dots({ blend: 3 })]), 'layers[0].blend')).toBe("must be 'lighter' | 'screen' | 'multiply' when set");
  });

  it('on the sequence envelope too', () => {
    const s = {
      format: 'idle-sequence', schemaVersion: 1, id: 'seq', label: 'Seq', sync: 'epoc',
      segments: [{ key: 'a', scene: scene([dots()]), duration: 5000 }, { key: 'b', scene: scene([dots()]), duration: 5000 }],
    };
    expect(validateSequence(s).errors.find((e) => e.path === 'sync')?.message).toBe("must be 'mount' | 'epoch' — did you mean 'epoch'?");
  });
});

describe('timeline keys on a path that does not resolve', () => {
  it('suggest the steerable path', () => {
    const spec = scene([dots()], { timeline: { keys: [{ t: 1000, path: 'layers.0.speed', value: [0.02, 0.04], dur: 2000 }] } });
    expect(error(spec, 'timeline.keys[0].path')).toBe(
      "'layers.0.speed' does not resolve on the spec — a key can only animate a field the spec already has — did you mean 'layers.0.motion.speed'?",
    );
  });

  it('for every such key, from one list of the base\'s paths', () => {
    const spec = scene([dots({ key: 'fireflies' })], { timeline: { keys: [
      { t: 1000, path: 'layers.0.speed', value: [0.02, 0.04], dur: 2000 },
      { t: 2000, path: 'fireflies.sprite.colr', value: '#ffffff', dur: 2000 },
    ] } });
    expect(error(spec, 'timeline.keys[0].path')).toContain("did you mean 'layers.0.motion.speed'?");
    expect(error(spec, 'timeline.keys[1].path')).toContain("did you mean 'fireflies.sprite.color'?");
  });

  it('and keep the plain message when nothing is close', () => {
    const spec = scene([dots()], { timeline: { keys: [{ t: 1000, path: 'layers.0.zorp', value: 1, dur: 2000 }] } });
    expect(error(spec, 'timeline.keys[0].path')).toBe("'layers.0.zorp' does not resolve on the spec — a key can only animate a field the spec already has");
  });
});
