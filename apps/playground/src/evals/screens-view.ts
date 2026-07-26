import type { EvalScreen } from './types';

/**
 * Overlay model-authored evidence onto a catalog slice, keeping the catalog
 * shape. Used when there is no authored set (rescore / browsing the local
 * catalog) — callers that have agent evidence should prefer the filter helpers
 * below so blank catalog fillers never appear.
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
 * By artist: when a run carries authored evidence, show ONLY what that run
 * generated for this artist — never catalog blanks for screens the agent
 * never touched.
 */
export function screensForArtistRun(
  catalogWorks: EvalScreen[],
  authored: EvalScreen[] | null | undefined,
  artistId: string,
): EvalScreen[] {
  if (!authored?.length) return catalogWorks;
  return authored.filter((s) => s.artistId === artistId);
}

/**
 * Compare: when a run carries authored evidence, show ONLY authored tiles for
 * this benchmark. Artists the run skipped stay off the wall.
 */
export function screensForCompareRun(
  catalogSlice: EvalScreen[],
  authored: EvalScreen[] | null | undefined,
  benchmarkId: string,
): EvalScreen[] {
  if (!authored?.length) return catalogSlice;
  return authored.filter((s) => s.kind === 'benchmark' && s.screenId === benchmarkId);
}
