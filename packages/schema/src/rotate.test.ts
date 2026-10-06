import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { createRng } from '@idle-screens/core';
import schema from '../saver-spec.schema.json';
import { buildEntities, rotationAt } from './simulate';
import { validateSpec } from './validate';
import { structuralSignature } from './steer';
import type { LayerSpec, SaverSpec } from './types';

/**
 * The `rotate` check (idle-mono docs/aesthetics/primitives-wanted.md, "Static
 * per-entity rotation — verify spin: [0, 0] first"). Answer: `spin: [0, 0]`
 * does NOT hold the seeded start angle — `rotationAt` returns 0 whenever the
 * spin speed is 0, so the seeded phase is drawn but never applied. `rotate`
 * is the static rotation; these tests pin both halves.
 */

const layer = (over: Partial<LayerSpec> = {}): LayerSpec => ({
  count: 12,
  sprite: { kind: 'rect', width: [0.02, 0.05], color: '#ffffff' },
  motion: { type: 'static' },
  ...over,
});

const spec = (l: LayerSpec): SaverSpec => ({ schemaVersion: 1, id: 'r', label: 'R', seed: 3, layers: [l] });

const build = (l: LayerSpec) => buildEntities(l, createRng(3), 1920, 1080, 1080, 1);
/** An entity without its `rotate` field, for stream comparisons. */
const withoutRotate = (e: ReturnType<typeof build>[number]): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...e };
  delete copy.rotate;
  return copy;
};

describe('spin: [0, 0] (the check)', () => {
  it('renders every entity at angle 0 — the seeded start angle is not held', () => {
    const ents = build(layer({ spin: [0, 0] }));
    // The phase IS drawn (seeded), but a zero speed never applies it.
    expect(ents.some((e) => e.spinPhase !== 0)).toBe(true);
    for (const e of ents) for (const t of [0, 1000, 60000]) expect(rotationAt(e, t)).toBe(0);
  });
});

describe('rotate', () => {
  it('a scalar rotates every entity by that angle, constant over time, and consumes no RNG draw', () => {
    const plain = JSON.stringify(build(layer()));
    const ents = build(layer({ rotate: 45 }));
    for (const e of ents) for (const t of [0, 1000, 60000]) expect(rotationAt(e, t)).toBeCloseTo(Math.PI / 4, 12);
    // Every other field is byte-identical: the scalar form draws nothing.
    expect(JSON.stringify(ents.map(withoutRotate))).toBe(plain);
  });

  it('a range gives each entity its own seeded angle, deterministic, constant over time', () => {
    const a = build(layer({ rotate: [-90, 90] }));
    const b = build(layer({ rotate: [-90, 90] }));
    expect(a.map((e) => e.rotate)).toEqual(b.map((e) => e.rotate));
    expect(new Set(a.map((e) => e.rotate)).size).toBeGreaterThan(1);
    for (const e of a) {
      expect(Math.abs(e.rotate!)).toBeLessThanOrEqual(Math.PI / 2);
      expect(rotationAt(e, 0)).toBe(rotationAt(e, 30000));
    }
  });

  it('the range draw is last: an entity\'s other fields are untouched by it; absent rotate ⇒ no field on the entity', () => {
    // One entity, so the extra draw cannot shift a later entity's stream (a
    // per-entity seeded draw always does that — range `spin` too).
    const l = layer({ count: 1, spin: [-10, 10], alpha: [0.2, 0.8], pulse: { amp: 0.2, period: 2000 }, motion: { type: 'wander', speed: [0.01, 0.02] } });
    const plain = build(l);
    const withRotate = build({ ...l, rotate: [0, 360] });
    expect(withRotate.map(withoutRotate)).toEqual(plain);
    expect(plain.every((e) => !('rotate' in e))).toBe(true);
  });

  it('composes with spin: base angle + seeded start + speed × t', () => {
    const [e] = build(layer({ count: 1, rotate: 90, spin: 36 }));
    expect(rotationAt(e!, 0)).toBeCloseTo(Math.PI / 2 + e!.spinPhase, 12);
    expect(rotationAt(e!, 1000)).toBeCloseTo(Math.PI / 2 + e!.spinPhase + (36 * Math.PI) / 180, 12);
  });

  it('is structural: the signature changes when rotate does, and existing signatures are byte-identical', () => {
    const base = structuralSignature(spec(layer()));
    expect(structuralSignature(spec(layer({ rotate: 30 })))).not.toBe(base);
    expect(structuralSignature(spec(layer({ rotate: [0, 10] })))).not.toBe(structuralSignature(spec(layer({ rotate: [0, 20] }))));
    // No rotate: nothing appended to the per-layer array; with it, one entry more.
    const layerSig = (s: SaverSpec): unknown[] => (JSON.parse(structuralSignature(s)) as unknown[][])[2]![0] as unknown[];
    expect(layerSig(spec(layer({ rotate: 30 }))).length).toBe(layerSig(spec(layer())).length + 1);
    expect(layerSig(spec(layer({ rotate: 30 }))).at(-1)).toBe(30);
  });

  it('validates within ±360 degrees on both validators', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const check = ajv.compile(schema);
    for (const ok of [0, 360, -360, [-45, 45], [0, 0]] as const) {
      const s = spec(layer({ rotate: ok as never }));
      expect(validateSpec(s)).toEqual({ valid: true, errors: [], warnings: [] });
      expect(check(s)).toBe(true);
    }
    for (const bad of [361, -361, [0, 400], 'x', [1]] as const) {
      const s = spec(layer({ rotate: bad as never }));
      expect(validateSpec(s).errors.map((e) => e.path)).toContain('layers[0].rotate');
      expect(check(s)).toBe(false);
    }
  });

  it('is flagged as misplaced when written inside sprite', () => {
    const s = spec(layer({ sprite: { kind: 'rect', width: [0.02, 0.05], color: '#fff', rotate: 30 } as never }));
    expect((validateSpec(s).warnings ?? []).map((w) => w.code)).toContain('misplaced-property');
  });
});
