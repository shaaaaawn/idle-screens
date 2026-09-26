import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { buildEntities } from './simulate';
import { perceiveSequenceFrame, luminanceGrid, renderBrailleMap } from './perceive';
import { adviseSequence, adviseSpec } from './advise';
import { resolveSegment } from './sequence';
import { resolveTimelineAt, timelineTracks } from './timeline';
import { readSpecPath } from './steer';
import { validateSequence, validateSpec } from './validate';
import type { IdleSequence, SaverSpec } from './types';

/**
 * Timed-scenes baseline (#70, #71, #75–#77) — the counterpart of
 * determinism-baseline / sequence-baseline for the NEW fields. One stored
 * fixture per scene type the fields are for:
 *
 * - `timed-sunrise` — a timed piece: one scene on one looping clock, a
 *   camera (`transform`), fades (`opacity`) and a title card (`timeline`).
 * - `ambient-tidepool` — an ambient scene that carries the paint fields with
 *   no timeline (what a live steer glides).
 * - `dx-mark` — a compound mark anchored at the centre and offset with
 *   `position.dx` / `dy`, so it registers on every aspect.
 * - `wrap-ident` — a looping morph chain with `wrapMorph` and `text: 'dip'`.
 *
 * A change to this snapshot means a scene authored with these fields renders
 * differently — review it like a change to the other two baselines.
 */

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/timed/${name}`, import.meta.url)), 'utf8')) as T;

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

const ASPECTS = [[1920, 1080], [1080, 1920]] as const;

function entityStreams(spec: SaverSpec, w: number, h: number): unknown {
  const rng = createRng(spec.seed ?? 42);
  const unit = Math.min(w, h);
  return stabilize(spec.layers.map((l) => buildEntities(l, rng, w, h, unit).map((e) => ({ x0: e.x0, y0: e.y0, size: e.size }))));
}

describe('timed-scenes baseline', () => {
  for (const name of ['timed-sunrise.json', 'ambient-tidepool.json', 'dx-mark.json']) {
    const spec = fixture<SaverSpec>(name);

    it(`${name}: validates clean, no advisories`, () => {
      expect(validateSpec(spec)).toEqual({ valid: true, errors: [], warnings: [] });
      expect(adviseSpec(spec)).toEqual([]);
    });

    it(`${name}: animated values and entity placement match the snapshot`, () => {
      const times = [0, 400, 1600, 3000, 6000, 8000, 11500, 13000, 15999, 16000 + 3000];
      const paths = [...timelineTracks(spec).keys()];
      const values = times.map((t) => {
        const r = resolveTimelineAt(spec, t);
        return [t, Object.fromEntries(paths.map((p) => [p, readSpecPath(r, p)]))];
      });
      expect(stabilize(values)).toMatchSnapshot();
      for (const [w, h] of ASPECTS) expect(entityStreams(spec, w, h)).toMatchSnapshot(`${w}x${h} entities`);
    });

    it(`${name}: perception matches the snapshot on both aspects`, () => {
      for (const [w, h] of ASPECTS) {
        for (const t of [0, 3000, 8000]) {
          const g = luminanceGrid(spec, { t, viewport: { width: w, height: h }, cols: 40, rows: 12 });
          expect({ coverage: +g.coverage.toFixed(4), braille: renderBrailleMap(g) }).toMatchSnapshot(`${w}x${h} t=${t}`);
        }
      }
    });
  }

  it('timed-sunrise: a looping timeline is the same on every lap', () => {
    const spec = fixture<SaverSpec>('timed-sunrise.json');
    for (const t of [0, 777, 5200, 12345]) expect(resolveTimelineAt(spec, t + 16000 * 5)).toEqual(resolveTimelineAt(spec, t));
  });

  it('dx-mark: the mark is rigid on every aspect (each part’s offset from the centre is the same in min(w,h) units)', () => {
    const spec = fixture<SaverSpec>('dx-mark.json');
    const offsets = ASPECTS.map(([w, h]) => {
      const unit = Math.min(w, h);
      return stabilize(spec.layers.map((l) => {
        const [e] = buildEntities(l, createRng(1), w, h, unit);
        return [(e!.x0 - w / 2) / unit, (e!.y0 - h / 2) / unit];
      }));
    });
    expect(offsets[0]).toEqual(offsets[1]);
  });

  describe('wrap-ident.sequence.json', () => {
    const seq = fixture<IdleSequence>('wrap-ident.sequence.json');

    it('validates clean, no advisories', () => {
      expect(validateSequence(seq)).toEqual({ valid: true, errors: [], warnings: [] });
      expect(adviseSequence(seq)).toEqual([]);
    });

    it('segment resolution and composed perception around the boundaries and the wrap match the snapshot', () => {
      const out: unknown[] = [];
      for (const T of [0, 3999, 4000, 4800, 8000, 11999, 12000, 12800, 14000, 24800]) {
        const r = resolveSegment(seq, T);
        const p = perceiveSequenceFrame(seq, T, { cols: 40, rows: 12 });
        out.push({ T, index: r.index, localT: r.localT, coverage: +p.coverage.toFixed(4), braille: p.braille });
      }
      expect(out).toMatchSnapshot();
    });
  });
});
