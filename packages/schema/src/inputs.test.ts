import { describe, expect, it } from 'vitest';
import { applyInput, checkInputs, inputTrack, normalizeRoster, rosterDeltas } from './inputs';
import { compileSaver } from './compile';
import { validateSpec } from './validate';
import { structuralSignature } from './steer';
import { OUTPOST_SPEC } from './examples/outpost';
import type { RosterInput, SaverSpec } from './types';

/** A two-slot build board: each light is lit by its build's state. */
function board(input: Partial<RosterInput> = {}): SaverSpec {
  return {
    schemaVersion: 1,
    id: 'builds',
    label: 'Builds',
    background: { type: 'solid', color: '#101018' },
    layers: [
      {
        key: 'lights', count: 2,
        layout: { type: 'table', columns: 2, gap: 0.3 },
        region: { x: [0.5, 0.5], y: [0.5, 0.5] },
        sprite: { kind: 'circle', radius: [0.05, 0.05], color: '#333344', colors: ['#333344', '#333344'] },
        motion: { type: 'static' },
      },
      {
        key: 'names', count: 2,
        layout: { type: 'table', columns: 2, gap: 0.3 },
        region: { x: [0.5, 0.5], y: [0.62, 0.62] },
        sprite: { kind: 'text', strings: [' ', ' '], color: '#e6e8ef' },
        motion: { type: 'static' },
      },
      {
        key: 'bars', count: 2,
        layout: { type: 'table', columns: 2, gap: 0.3 },
        region: { x: [0.5, 0.5], y: [0.7, 0.7] },
        sprite: { kind: 'bar', values: [0, 0], max: 10, length: 0.1, thickness: 0.01, color: '#5588ff' },
        motion: { type: 'static' },
      },
      { key: 'siren', count: 1, position: { x: 0.5, y: 0.2 }, sprite: { kind: 'circle', radius: [0.03, 0.03], color: '#223322' }, motion: { type: 'static' } },
    ],
    inputs: {
      builds: {
        kind: 'roster',
        slots: 2,
        default: 'unknown',
        states: {
          unknown: [{ path: 'lights.sprite.colors.{i}', value: '#333344' }, { path: 'names.sprite.strings.{i}', value: ' ' }],
          passing: [{ path: 'lights.sprite.colors.{i}', value: '#33cc66' }, { path: 'names.sprite.strings.{i}', value: '{label} {verb}{count}' }],
          failing: [{ path: 'lights.sprite.colors.{i}', value: '#ee3333' }, { path: 'names.sprite.strings.{i}', value: '{label} {verb}' }],
        },
        verbs: { passing: 'green', failing: 'RED' },
        count: { glyph: '★', max: 3 },
        level: { path: 'bars.sprite.values.{i}', max: 10 },
        alert: { states: ['failing'], on: [{ path: 'siren.sprite.color', value: '#ff2222' }], off: [{ path: 'siren.sprite.color', value: '#223322' }] },
        ...input,
      },
    },
  };
}

const valueOf = (spec: SaverSpec, path: string): unknown => {
  const [key, , field, i] = path.split('.');
  const sprite = spec.layers.find((l) => l.key === key)!.sprite as Record<string, unknown>;
  return i === undefined ? sprite[field!] : (sprite[field!] as unknown[])[Number(i)];
};

describe('inputs — a scene declares the live data it takes', () => {
  it('a roster paints each slot by its state, with label, verb, count and level', () => {
    const fed = applyInput(board(), 'builds', [
      { slot: 0, state: 'passing', label: 'api', count: 2, level: 7 },
      { slot: 1, state: 'failing', label: 'web' },
    ]);
    expect(valueOf(fed, 'lights.sprite.colors.0')).toBe('#33cc66');
    expect(valueOf(fed, 'names.sprite.strings.0')).toBe('api green ★★');
    expect(valueOf(fed, 'lights.sprite.colors.1')).toBe('#ee3333');
    expect(valueOf(fed, 'names.sprite.strings.1')).toBe('web RED');
    expect(valueOf(fed, 'bars.sprite.values.0')).toBe(7);
    expect(valueOf(fed, 'bars.sprite.values.1')).toBe(0);
    expect(valueOf(fed, 'siren.sprite.color')).toBe('#ff2222'); // a slot is failing
    expect(valueOf(applyInput(board(), 'builds', [{ slot: 0, state: 'passing' }]), 'siren.sprite.color')).toBe('#223322');
  });

  it('feeding changes paint only: the scene never rebuilds', () => {
    const spec = board();
    const fed = applyInput(spec, 'builds', [{ slot: 0, state: 'failing', label: 'x' }, { slot: 1, state: 'passing', count: 3, level: 10 }]);
    expect(structuralSignature(fed)).toBe(structuralSignature(spec));
  });

  it('empty slots, unknown states, bad slots and oversize values fall back instead of failing', () => {
    const input = board().inputs!.builds!;
    expect(normalizeRoster(input, [
      { slot: 0, state: 'hacking', label: 'a', count: 99, level: 50 },
      { slot: 0, state: 'passing' }, // duplicate slot
      { slot: 2, state: 'passing' }, // out of range
      { slot: -1, state: 'passing' },
      { slot: 1, state: 'constructor' }, // not an own state
      'junk',
    ])).toEqual([
      { slot: 0, state: 'unknown', label: 'a', count: 3, level: 10 },
      { slot: 1, state: 'unknown' },
    ]);
    expect(normalizeRoster(input, 'not a roster')).toEqual([]);
    // Every slot is always written, so a member who leaves is cleared.
    expect(rosterDeltas(input, []).filter((d) => d.path.startsWith('lights')).map((d) => d.value)).toEqual(['#333344', '#333344']);
  });

  it('a label cannot smuggle tokens or control characters into the scene', () => {
    const fed = applyInput(board(), 'builds', [{ slot: 0, state: 'failing', label: '{verb}\n\u0007x'.padEnd(40, 'y') }]);
    const text = valueOf(fed, 'names.sprite.strings.0') as string;
    expect(text).not.toMatch(/[{}\u0000-\u001f]/);
    expect(text.length).toBeLessThanOrEqual(24 + ' RED'.length);
  });

  it('inputTrack is the steering track a host hands applyTrack; null for an input the scene lacks', () => {
    const t = inputTrack(board(), 'builds', [{ slot: 0, state: 'passing' }], { dur: 0 })!;
    expect(t.program).toBe('builds');
    expect(t.deltas.every((d) => d.dur === 0 && d.t === 0)).toBe(true);
    expect(inputTrack(board(), 'nope', [])).toBeNull();
    expect(applyInput(board(), 'nope', [])).toEqual(board());
  });
});

describe('inputs — validation', () => {
  const errorsOf = (spec: SaverSpec) => validateSpec(spec).errors.map((e) => `${e.path}: ${e.message}`);

  it('the example boards validate with no warnings', () => {
    expect(validateSpec(board())).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('rejects unknown tokens: a binding can template only what a roster item carries', () => {
    expect(errorsOf(board({ states: { unknown: [{ path: 'names.sprite.strings.{i}', value: '{cwd}' }] } })).join()).toMatch(/unknown token \{cwd\}/);
    expect(errorsOf(board({ states: { unknown: [{ path: 'names.sprite.strings.{slot}', value: 'x' }] } })).join()).toMatch(/unknown token \{slot\}/);
    expect(errorsOf(board({ alert: { states: ['unknown'], on: [{ path: 'siren.sprite.color', value: '{label}' }], off: [] } })).join()).toMatch(/unknown token \{label\}/);
  });

  it('rejects a default or alert state the input does not declare, and out-of-range slots', () => {
    expect(errorsOf(board({ default: 'missing' })).join()).toMatch(/default: must name one of the states/);
    expect(errorsOf(board({ alert: { states: ['missing'], on: [], off: [] } })).join()).toMatch(/names no state/);
    expect(errorsOf(board({ slots: 0 })).join()).toMatch(/slots: must be an integer 1\.\.64/);
    expect(errorsOf(board({ slots: 65 })).join()).toMatch(/slots/);
    expect(errorsOf({ ...board(), inputs: { builds: { ...board().inputs!.builds!, kind: 'stream' as never } } }).join()).toMatch(/kind: must be 'roster'/);
  });

  it('compile-time check: every state must resolve, stay paint and leave a valid scene', () => {
    expect(checkInputs(board(), validateSpec)).toEqual([]);
    // A binding to a path that doesn't exist on this scene.
    expect(checkInputs(board({ states: { unknown: [{ path: 'lights.sprite.colors.{i}', value: '#333344' }], ghost: [{ path: 'nowhere.sprite.color', value: '#fff' }] } }), validateSpec)
      .map((e) => e.message).join()).toMatch(/does not resolve/);
    // A structural binding: changing a layer's count would rebuild the scene.
    expect(checkInputs(board({ states: { unknown: [{ path: 'lights.count', value: 3 }] } }), validateSpec)
      .map((e) => e.message).join()).toMatch(/structurally/);
    // A value the renderer can't take.
    expect(checkInputs(board({ states: { unknown: [{ path: 'lights.sprite.colors.{i}', value: 'mauve' }] } }), validateSpec)
      .map((e) => e.message).join()).toMatch(/invalid scene/);
  });

  it('compileSaver refuses a scene whose inputs would be silently dropped later', () => {
    expect(() => compileSaver(board({ states: { unknown: [{ path: 'lights.count', value: 3 }] } }))).toThrow(/inputs/);
    expect(() => compileSaver(board())).not.toThrow();
  });
});

describe('Outpost', () => {
  it('declares a crew roster the Mac host can feed', () => {
    const crew = OUTPOST_SPEC.inputs!.crew!;
    expect(crew.slots).toBe(8);
    expect(Object.keys(crew.states)).toEqual(expect.arrayContaining(['absent', 'idle', 'editing', 'waiting', 'error', 'done']));
    expect(checkInputs(OUTPOST_SPEC, validateSpec)).toEqual([]);
  });

  it('a waiting member raises a hand in an amber pod and lights the beacon', () => {
    const fed = applyInput(OUTPOST_SPEC, 'crew', [{ slot: 2, state: 'waiting', label: 'infra' }, { slot: 5, state: 'idle', label: 'mac' }]);
    expect(valueOf(fed, 'crew.sprite.glyphs.2')).toBe('🙋');
    expect(valueOf(fed, 'screen.sprite.colors.2')).toBe('#ffb040');
    expect(valueOf(fed, 'label.sprite.strings.2')).toBe('infra · needs you');
    expect(valueOf(fed, 'beacon.sprite.color')).toBe('#ffb040');
    // Resting crew leave the pod for the lounge.
    expect(valueOf(fed, 'crew.sprite.glyphs.5')).toBe(' ');
    expect(valueOf(fed, 'lounge.sprite.glyphs.5')).toBe('😴');
  });
});
