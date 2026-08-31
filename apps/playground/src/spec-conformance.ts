/**
 * Conformance — does the ANALYTIC perception agree with the real canvas?
 *
 * `perceiveScene` / `luminanceGrid` walk a SaverSpec and compute luminance from
 * geometry, never rasterizing. Every agent that authors a scene judges it on
 * those numbers, and nothing has ever checked the claim they rest on: that the
 * model describes the pixels a viewer actually sees. It is an assertion about
 * two independent implementations agreeing, and we have already shipped one bug
 * of exactly that shape (`preview-svg` oriented streaks by spin instead of
 * heading, so warp previewed as horizontal lines while perception showed the
 * true starburst — idle-server `preview-svg.ts`, fixed 2026-07-30).
 *
 * This module closes the loop *without* a server-side browser: compile the spec
 * with `compileSaver`, mount it, read the canvas back through the same
 * `gridFromImageData` the pixel path already uses, and compare the two
 * `LuminanceGrid`s cell for cell. Both grids are 80×48 with the same 0.03
 * coverage epsilon, so they are directly comparable — that was designed in, not
 * discovered here.
 *
 * ## What agreement means, and what it deliberately does not
 *
 * The analytic model is a MODEL. Two of its constants (`GLOW_SPREAD`,
 * `LINE_SALIENCE` in `packages/schema/src/perceive.ts`) are explicitly
 * "tuned by intuition rather than measurement", and three spec features are
 * known to diverge from the canvas: `ghosting`/`trail` persistence (the canvas
 * accumulates frames, the model samples one instant), additive saturation
 * clipping, and exotic blend modes. So this measures *correlation of structure*,
 * not equality of numbers:
 *
 * | Metric | What a bad value means |
 * | --- | --- |
 * | `cellCorrelation` | the model puts light in different PLACES than the canvas |
 * | `rowCorrelation` / `colCorrelation` | the composition's 1D skeleton disagrees |
 * | `centroidDistance` | the visual centre of mass is somewhere else |
 * | `coverageRatio` | the model systematically over/under-reports how much is lit |
 *
 * Structure metrics are the load-bearing ones. `coverageRatio` is a calibration
 * reading (it is what `future-ideas.md` G1 wants measured), not a pass/fail.
 */
import {
  compileSaver,
  luminanceGrid,
  renderBrailleMap,
  type LuminanceGrid,
  type SaverSpec,
} from '@idle-screens/schema';
import { perceiveSaverFrame, type PerceiveFrameOptions } from './frame-perception';

export interface GridSummary {
  coverage: number;
  meanLuminance: number;
  centroid: { x: number; y: number } | null;
}

export interface ConformanceAgreement {
  /** Pearson correlation of the two grids' cells, -1..1. The structural test. */
  cellCorrelation: number;
  /** Pearson correlation of the row luminance profiles. */
  rowCorrelation: number;
  /** Pearson correlation of the column luminance profiles. */
  colCorrelation: number;
  /** Euclidean distance between the centroids, in viewport fractions. */
  centroidDistance: number | null;
  /** pixel coverage / analytic coverage. 1 is perfect; this is a calibration reading. */
  coverageRatio: number;
  /** Mean |analytic - pixel| over all cells, 0..1. */
  meanAbsCellDelta: number;
}

export interface SpecConformance {
  cols: number;
  rows: number;
  analytic: GridSummary;
  pixel: GridSummary;
  agreement: ConformanceAgreement;
  /** Braille of each grid, side by side — the human/agent-readable evidence. */
  braille: { analytic: string; pixel: string };
  /** Set when the canvas could not be read at all (CSS saver, blocked readback). */
  unsupported?: string;
}

/** Pearson correlation. Returns 0 for a constant series — no signal, not perfect agreement. */
export function correlate(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 1e-12 ? num / den : 0;
}

/**
 * Compare two grids of the same shape.
 *
 * Deviation-from-background is used for the structural correlations rather than
 * raw luminance: the analytic grid knows its declared background while the pixel
 * grid infers one per row, so raw values carry a constant offset the correlation
 * would otherwise have to absorb.
 */
export function compareGrids(analytic: LuminanceGrid, pixel: LuminanceGrid): ConformanceAgreement {
  const dev = (g: LuminanceGrid): number[] => {
    const out = new Array<number>(g.cells.length);
    for (let r = 0; r < g.rows; r++) {
      const bg = g.background?.[r] ?? 0;
      for (let c = 0; c < g.cols; c++) {
        const i = r * g.cols + c;
        out[i] = Math.abs((g.cells[i] ?? 0) - bg);
      }
    }
    return out;
  };
  const a = dev(analytic);
  const b = dev(pixel);

  let sumAbs = 0;
  const n = Math.min(a.length, b.length) || 1;
  for (let i = 0; i < n; i++) sumAbs += Math.abs(a[i]! - b[i]!);

  const ca = analytic.centroid;
  const cp = pixel.centroid;

  return {
    cellCorrelation: correlate(a, b),
    rowCorrelation: correlate(analytic.rowProfile, pixel.rowProfile),
    colCorrelation: correlate(analytic.colProfile, pixel.colProfile),
    centroidDistance: ca && cp ? Math.hypot(ca.x - cp.x, ca.y - cp.y) : null,
    coverageRatio: analytic.coverage > 1e-6 ? pixel.coverage / analytic.coverage : 0,
    meanAbsCellDelta: sumAbs / n,
  };
}

const summarize = (g: LuminanceGrid): GridSummary => ({
  coverage: g.coverage,
  meanLuminance: g.meanLuminance,
  centroid: g.centroid,
});

/**
 * Render one spec both ways at the same (viewport, seed, t) and report agreement.
 *
 * Requires a DOM: the pixel half mounts a real saver on a real canvas. That is
 * the point — it is the only reading in the system that is not a model.
 */
export async function specConformance(
  spec: SaverSpec,
  opts: Pick<PerceiveFrameOptions, 'width' | 'height' | 'seed' | 't'> = {},
): Promise<SpecConformance> {
  const width = opts.width ?? 640;
  const height = opts.height ?? 400;
  const seed = opts.seed ?? spec.seed ?? 42;
  const t = opts.t ?? 5000;

  const frame = await perceiveSaverFrame(compileSaver(spec), { width, height, seed, t, includeGrid: true });
  const analytic = luminanceGrid(spec, { viewport: { width, height }, seed, t });

  if (!frame.grid) {
    return {
      cols: analytic.cols,
      rows: analytic.rows,
      analytic: summarize(analytic),
      pixel: { coverage: 0, meanLuminance: 0, centroid: null },
      agreement: {
        cellCorrelation: 0,
        rowCorrelation: 0,
        colCorrelation: 0,
        centroidDistance: null,
        coverageRatio: 0,
        meanAbsCellDelta: 0,
      },
      braille: { analytic: '', pixel: '' },
      unsupported: frame.reason ?? 'no readable canvas',
    };
  }

  return {
    cols: analytic.cols,
    rows: analytic.rows,
    analytic: summarize(analytic),
    pixel: summarize(frame.grid),
    agreement: compareGrids(analytic, frame.grid),
    braille: { analytic: renderBrailleMap(analytic), pixel: frame.braille },
  };
}
