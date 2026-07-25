import { ARTISTS, getArtist } from './artists';
import { BENCHMARK_INTENTS } from './benchmarks';
import { buildArtistScreens } from './style-apply';
import type { ArtistStyleProfile, EvalScreen } from './types';

export interface EvalCatalog {
  artists: ArtistStyleProfile[];
  benchmarks: typeof BENCHMARK_INTENTS;
  screens: EvalScreen[];
  screensByArtist: Map<string, EvalScreen[]>;
}

let cached: EvalCatalog | null = null;

/** Build (and memoize) the full 15×10 eval catalog. */
export function getCatalog(): EvalCatalog {
  if (cached) return cached;
  const screens = ARTISTS.flatMap((a) => buildArtistScreens(a, BENCHMARK_INTENTS));
  const screensByArtist = new Map<string, EvalScreen[]>();
  for (const s of screens) {
    const list = screensByArtist.get(s.artistId) ?? [];
    list.push(s);
    screensByArtist.set(s.artistId, list);
  }
  cached = {
    artists: ARTISTS,
    benchmarks: BENCHMARK_INTENTS,
    screens,
    screensByArtist,
  };
  return cached;
}

export { ARTISTS, BENCHMARK_INTENTS, getArtist };
export type { ArtistStyleProfile, EvalScreen };
