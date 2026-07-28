import type { EvalScreen } from './types';

/** What the stage is showing — catalog DNA, or only this run’s authored evidence. */
export type EvidenceMode = 'catalog' | 'run';

/**
 * Overlay model-authored evidence onto a catalog slice, keeping the catalog
 * shape. Used in Catalog evidence mode so agent specs land in-place.
 */
export function overlayAuthoredScreens(
  base: EvalScreen[],
  authored: EvalScreen[] | null | undefined,
): EvalScreen[] {
  if (!authored?.length) return base;
  const byId = new Map(authored.map((s) => [s.id, s]));
  return base.map((s) => byId.get(s.id) ?? s);
}

/**
 * By artist stage contents.
 * - Catalog: full body of work (authored specs overlaid when present).
 * - This run: only screens the run authored for this artist — no blanks.
 */
export function screensForArtistRun(
  catalogWorks: EvalScreen[],
  authored: EvalScreen[] | null | undefined,
  artistId: string,
  evidence: EvidenceMode = 'run',
): EvalScreen[] {
  if (evidence === 'catalog' || !authored?.length) {
    return overlayAuthoredScreens(catalogWorks, authored);
  }
  return authored.filter((s) => s.artistId === artistId);
}

/**
 * Cross-artist (compare) stage contents.
 * - Catalog: every artist for the benchmark.
 * - This run: only authored tiles for that benchmark.
 */
export function screensForCompareRun(
  catalogSlice: EvalScreen[],
  authored: EvalScreen[] | null | undefined,
  benchmarkId: string,
  evidence: EvidenceMode = 'run',
): EvalScreen[] {
  if (evidence === 'catalog' || !authored?.length) {
    return overlayAuthoredScreens(catalogSlice, authored);
  }
  return authored.filter((s) => s.kind === 'benchmark' && s.screenId === benchmarkId);
}

/** How many authored screens a run produced for each artist (nav badges). */
export function authoredCountByArtist(
  authored: EvalScreen[] | null | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!authored?.length) return map;
  for (const s of authored) {
    map.set(s.artistId, (map.get(s.artistId) ?? 0) + 1);
  }
  return map;
}
