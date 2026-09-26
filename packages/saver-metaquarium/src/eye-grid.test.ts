import { describe, expect, it } from 'vitest';
import { analyseEyes, type Vec3 } from './eye-grid';

/** A one-voxel-deep eye slab on the +x side of a fish: `rows` top to bottom, `#` black `.` white. */
function slab(rows: string[], side: 1 | -1, voxel = 0.5, at: Vec3 = [2, 1, 3]): { white: number[]; black: number[] } {
  const white: number[] = [], black: number[] = [];
  const h = rows.length;
  rows.forEach((line, r) => [...line].forEach((ch, k) => {
    if (ch === '_') return;
    const into = ch === '#' ? black : white;
    const x0 = at[0] * side, x1 = x0 + voxel * side;
    const y0 = at[1] + (h - 1 - r) * voxel, y1 = y0 + voxel, z0 = at[2] + k * voxel, z1 = z0 + voxel;
    const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): void => { into.push(...a, ...b, ...c, ...a, ...c, ...d); };
    // outward face (normal ±x), wound to face out, and the inward one
    if (side > 0) quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); else quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]);
    // the slab's exposed rim: a top on the top row, a front on the last column
    if (r === 0) quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
    if (k === line.length - 1) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  }));
  return { white, black };
}
const both = (rows: string[]): { white: number[]; black: number[] } => {
  const l = slab(rows, 1), r = slab(rows, -1);
  return { white: [...l.white, ...r.white], black: [...l.black, ...r.black] };
};
const centre: Vec3 = [0, 1.5, 0];

describe('eye grid', () => {
  it('reads a betafish eye: a 3x3 pixel grid per side, the pattern as drawn', () => {
    const grids = analyseEyes(both(['...', '.#.', '...']), centre, [0, 1, 0], [0, 0, 1]);
    expect(grids).toHaveLength(2);
    for (const g of grids) {
      expect(g.signature).toBe('3x3 .../.#./...');
      expect(g.cell).toBeCloseTo(0.5, 5);
      expect(g.darkEye).toBe(false);
      expect(Math.abs(g.n[0])).toBeCloseTo(1, 5); // faces out of the head
      expect(g.u[2]).toBeCloseTo(1, 5); //           columns run toward the nose on BOTH sides
      expect(g.v[1]).toBeCloseTo(1, 5);
    }
  });

  it('lets the pupil travel only until it touches the rim', () => {
    const [g] = analyseEyes(slab(['...', '#..', '...'], 1), centre, [0, 1, 0], [0, 0, 1]);
    expect(g!.shiftX).toEqual([0, 2]); // already at the tail end: can only look forward
    expect(g!.shiftY).toEqual([-1, 1]);
    const [wide] = analyseEyes(slab(['###', '...'], 1), centre, [0, 1, 0], [0, 0, 1]);
    expect(wide!.signature).toBe('3x2 ###/...'); // an angelfish
    expect(wide!.shiftX).toEqual([0, 0]); //         as wide as the eye: nowhere to look sideways
    expect(wide!.shiftY).toEqual([-1, 0]);
    const [big] = analyseEyes(slab(['###', '###', '...'], 1), centre, [0, 1, 0], [0, 0, 1]);
    expect(big!.shiftY).toEqual([0, 2]); // (#180) black is the majority here, so the white ROW is the detail…
    const [ell] = analyseEyes(slab(['#..', '##.', '...'], 1), centre, [0, 1, 0], [0, 0, 1]);
    expect(ell!.shiftX).toEqual([0, 0]); // …and an L is a glyph, not a pupil
  });

  it('knows a dark eye from a white one: the catch-light is the detail', () => {
    const [g] = analyseEyes(slab(['###', '#.#', '###'], 1), centre, [0, 1, 0], [0, 0, 1]);
    expect(g!.darkEye).toBe(true);
    expect(g!.shiftX).toEqual([-1, 1]);
    // a glyph (the `%` of betafish #100) keeps its identity: no travel at all
    const [glyph] = analyseEyes(slab(['.##', '#.#', '##.'], 1), centre, [0, 1, 0], [0, 0, 1]);
    expect(glyph!.shiftX).toEqual([0, 0]);
    expect(glyph!.shiftY).toEqual([0, 0]);
  });

  it('joins a white lump and a black lump that only TOUCH (greedy meshes meet at T-junctions)', () => {
    const a = slab(['...', '___'], 1), b = slab(['___', '.#.'], 1);
    // nudge the lower half so no corner is shared exactly
    const lower = { white: b.white.map((v, i) => (i % 3 === 2 ? v + 1e-4 : v)), black: b.black.map((v, i) => (i % 3 === 2 ? v + 1e-4 : v)) };
    const grids = analyseEyes({ white: [...a.white, ...lower.white], black: lower.black }, centre, [0, 1, 0], [0, 0, 1]);
    expect(grids).toHaveLength(1);
    expect(grids[0]!.signature).toBe('3x2 .../.#.');
  });

  it('does not trust winding: a mirrored half reads the same as its twin', () => {
    const good = slab(['#.#', '.##'], 1);
    const flip = (arr: number[]): number[] => { const o = [...arr]; for (let i = 0; i + 8 < o.length; i += 9) for (let k = 0; k < 3; k++) { const t = o[i + 3 + k]!; o[i + 3 + k] = o[i + 6 + k]!; o[i + 6 + k] = t; } return o; };
    const [a] = analyseEyes(good, centre, [0, 1, 0], [0, 0, 1]);
    const [b] = analyseEyes({ white: flip(good.white), black: flip(good.black) }, centre, [0, 1, 0], [0, 0, 1]);
    expect(a!.signature).toBe('3x2 #.#/.##');
    expect(b!.signature).toBe(a!.signature);
  });

  it('refuses things that merely wear the eye material: a belly plate is not an eye', () => {
    const plate = slab(Array.from({ length: 8 }, () => '........'), 1);
    expect(analyseEyes(plate, centre, [0, 1, 0], [0, 0, 1])).toEqual([]);
    expect(analyseEyes({ white: [], black: [] }, centre, [0, 1, 0], [0, 0, 1])).toEqual([]);
  });

  it('takes a one-colour lump for an eye only in a pair: a glowfish\'s two black cubes, never a lone stripe', () => {
    // Two matching black cubes, one a side: each is the other's twin.
    const pair = analyseEyes(both(['##', '##']), centre, [0, 1, 0], [0, 0, 1]);
    expect(pair).toHaveLength(2);
    for (const g of pair) {
      expect(g.signature).toBe('2x2 ##/##');
      expect(g.darkEye).toBe(true);
      expect(g.shiftX).toEqual([0, 0]); // all pupil: nowhere for it to go
    }
    // The same cube alone is a mouth (or a stripe) that wears the eye material.
    expect(analyseEyes(slab(['##', '##'], 1), centre, [0, 1, 0], [0, 0, 1])).toEqual([]);
    // …and a real two-colour eye on the other side is no twin for it.
    const eye = slab(['...', '.#.', '...'], -1), stripe = slab(['##', '##'], 1);
    const grids = analyseEyes({ white: eye.white, black: [...eye.black, ...stripe.black] }, centre, [0, 1, 0], [0, 0, 1]);
    expect(grids.map((g) => g.signature)).toEqual(['3x3 .../.#./...']);
  });

  it('keeps a notched grid honest: absent cells are marked, not guessed', () => {
    const [g] = analyseEyes(slab(['_..', '.#.', '...'], 1), centre, [0, 1, 0], [0, 0, 1]);
    expect(g!.signature).toBe('3x3 _../.#./...');
  });

  it('does not let the pupil travel onto a notch: an absent cell is not a valid gaze', () => {
    // The pupil sits one cell from the RIGHT edge of the 3x3 rectangle, so a
    // bound that only checks the rectangle (not the actual shape) would let
    // it travel one more step right — straight onto the absent corner.
    const [g] = analyseEyes(slab(['...', '.#_', '...'], 1), centre, [0, 1, 0], [0, 0, 1]);
    expect(g!.signature).toBe('3x3 .../.#_/...');
    expect(g!.shiftX).toEqual([-1, 0]); // rightward travel is blocked by the notch, not just the rim
    expect(g!.shiftY).toEqual([-1, 1]); // the row above/below is fully present, so that axis is untouched
  });
});
