import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { buildEntities } from './simulate';
import { resolveSegment, segmentStart } from './sequence';
import { validateSequence } from './validate';
import type { IdleSequence } from './types';

/**
 * Sequence determinism baseline — the "absent field ⇒ byte-identical output"
 * gate for every ambient-presentation phase (idle-mono
 * docs/ambient-presentation-implementation-plan.md). Two stored sequences
 * that use none of the fields those phases add:
 *
 * - `snow-white` — the morph-chained triptych tvOS pins in
 *   `apps/ios/IdleScreensTVTests/SequenceSubsetTests.swift` (`nobleGroveJSON`).
 * - `deck` — the five-slide `advance: 'input'` deck from
 *   idle-mono `docs/experiments/deck/deck-sequence.json`.
 *
 * Snapshots: `resolveSegment` one millisecond either side of every boundary
 * (and at the boundary itself), and each segment's entity stream built with
 * the seed the runtime would hand that child. A change to either snapshot
 * means a stored sequence renders differently — a major, not a patch.
 */

const W = 1920;
const H = 1080;

// Same rounding as determinism-baseline.test.ts: 12 significant digits hide
// cross-platform trig ULP noise while any RNG stream shift still shows.
function stabilize(v: unknown): unknown {
  if (typeof v === 'number') return +v.toPrecision(12);
  if (Array.isArray(v)) return v.map(stabilize);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = stabilize(val);
    return out;
  }
  return v;
}

function loadFixture(name: string): IdleSequence {
  const path = fileURLToPath(new URL(`./__fixtures__/${name}.sequence.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as IdleSequence;
}

/** The seed SequenceInstance.childSeed / childScene resolve for segment `i`. */
function childSeed(seq: IdleSequence, i: number): number {
  const seg = seq.segments[i]!;
  if (seg.scene.seed != null) return seg.scene.seed;
  if (seq.seed != null) return seq.seed + i;
  return 42;
}

function snapshotSegment(seq: IdleSequence, i: number) {
  const rng = createRng(childSeed(seq, i));
  return stabilize(seq.segments[i]!.scene.layers.map((layer) => buildEntities(layer, rng, W, H)));
}

/**
 * Every boundary at ±1 ms plus the boundary itself; the end of a timed tail
 * too. Resolved twice: as a bare timeline (every `advance: 'input'` hold
 * armed — the deck parks on slide 0) and with every hold released (the
 * presenter has clicked through — the deck's later boundaries are reached).
 */
function boundaryProbe(seq: IdleSequence) {
  const probes: Array<{ T: number; armed: unknown; released: unknown }> = [];
  const push = (T: number) => probes.push({
    T,
    armed: resolveSegment(seq, T),
    released: resolveSegment(seq, T, { releasedBelow: seq.segments.length }),
  });
  push(0);
  for (let i = 1; i < seq.segments.length; i++) {
    const b = segmentStart(seq, i);
    push(b - 1);
    push(b);
    push(b + 1);
  }
  const last = seq.segments[seq.segments.length - 1]!;
  if (last.duration != null) {
    const end = segmentStart(seq, seq.segments.length - 1) + last.duration;
    push(end - 1);
    push(end);
    push(end + 1);
  }
  return probes;
}

const FIXTURES = ['snow-white', 'deck'] as const;

describe('sequence determinism baseline — stored sequences must not shift', () => {
  for (const name of FIXTURES) {
    const seq = loadFixture(name);

    it(`${name}: validates today`, () => {
      const r = validateSequence(seq);
      expect(r.errors).toEqual([]);
      expect(r.valid).toBe(true);
    });

    it(`${name}: resolveSegment at every boundary ±1 ms matches snapshot`, () => {
      expect(boundaryProbe(seq)).toMatchSnapshot();
    });

    for (let i = 0; i < seq.segments.length; i++) {
      const key = seq.segments[i]!.key;
      it(`${name}/${key}: entity stream is deterministic`, () => {
        expect(snapshotSegment(seq, i)).toEqual(snapshotSegment(seq, i));
      });

      it(`${name}/${key}: entity stream matches snapshot`, () => {
        expect(snapshotSegment(seq, i)).toMatchSnapshot();
      });
    }
  }
});
