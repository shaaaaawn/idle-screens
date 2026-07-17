/**
 * The published JSON Schema (saver-spec.schema.json) and the runtime validator
 * (validate.ts) must agree: every shipped example passes both, and specs the
 * runtime rejects for structural reasons fail the schema too. The JSON Schema
 * is deliberately STRICTER in one way — unknown properties are rejected to
 * catch authoring typos — so agreement is asserted one-way for valid specs.
 */
import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import schema from '../saver-spec.schema.json';
import { EXAMPLE_SPECS } from './examples';
import { validateSpec } from './validate';

const ajv = new Ajv({ allErrors: true, strict: false });
const check = ajv.compile(schema);

describe('saver-spec.schema.json', () => {
  it('is itself a valid JSON Schema', () => {
    expect(ajv.validateSchema(schema)).toBe(true);
  });

  for (const spec of EXAMPLE_SPECS) {
    it(`accepts shipped example "${spec.id}" (and so does the runtime validator)`, () => {
      expect(validateSpec(spec).valid).toBe(true);
      const ok = check(spec);
      expect(check.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    });
  }

  it('rejects structural garbage the runtime also rejects', () => {
    const bad = [
      {},
      { schemaVersion: 2, id: 'x', label: 'X', layers: [] },
      { schemaVersion: 1, id: 'x', label: 'X', layers: [] },
      {
        schemaVersion: 1, id: 'x', label: 'X',
        layers: [{ count: 0, sprite: { kind: 'emoji', glyphs: ['🐟'] }, motion: { type: 'static' } }],
      },
      {
        schemaVersion: 1, id: 'x', label: 'X',
        layers: [{ count: 1, sprite: { kind: 'nope' }, motion: { type: 'static' } }],
      },
      {
        schemaVersion: 1, id: 'x', label: 'X',
        layers: [{ count: 1, sprite: { kind: 'circle', radius: [1, 4], color: 'red' }, motion: { type: 'static' } }],
      },
      {
        schemaVersion: 1, id: 'x', label: 'X',
        layers: [{
          count: 1, sprite: { kind: 'circle', radius: [1, 4], color: '#fff' },
          motion: { type: 'drift', speed: [0, 9999] },
        }],
      },
      {
        schemaVersion: 1, id: 'x', label: 'X',
        layers: [{
          count: 1, sprite: { kind: 'circle', radius: [1, 4], color: '#fff' },
          motion: { type: 'static' }, pulse: { amp: 0.9, period: 100 },
        }],
      },
    ];
    for (const spec of bad) {
      expect(check(spec), JSON.stringify(spec)).toBe(false);
      expect(validateSpec(spec).valid).toBe(false);
    }
  });

  it('rejects position with count > 1 (if/then rule)', () => {
    const spec = {
      schemaVersion: 1, id: 'x', label: 'X',
      layers: [{
        count: 2, sprite: { kind: 'emoji', glyphs: ['⭐'] },
        motion: { type: 'static' }, position: { x: 0.5, y: 0.5 },
      }],
    };
    expect(check(spec)).toBe(false);
    expect(validateSpec(spec).valid).toBe(false);
  });

  it('rejects unknown properties (stricter than the runtime, by design)', () => {
    const spec = {
      schemaVersion: 1, id: 'x', label: 'X', typo: true,
      layers: [{ count: 1, sprite: { kind: 'emoji', glyphs: ['⭐'] }, motion: { type: 'static' } }],
    };
    expect(check(spec)).toBe(false);
    expect(validateSpec(spec).valid).toBe(true); // runtime tolerates unknowns
  });
});
