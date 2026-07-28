/**
 * Loader for the HELD-OUT style suite.
 *
 * The published suite has a confound it cannot shake: `artists.ts`, the rubric
 * and the scorer are all in this public repo, and the style names are ones
 * every frontier model has deep priors about. A high score on `seurat` might
 * mean the model read the StyleDNA, or might mean it recognised the name. The
 * two are indistinguishable from the score.
 *
 * Held-out styles are original, unpublished, and carry no prior. Only
 * DNA-following can score well on them — so they measure the capability the
 * suite claims to measure, and the gap between the two suites estimates how
 * much of a published score is recall (see `originGap`).
 *
 * That only holds while the fixtures stay unpublished, which is why NO profile
 * data lives in this file. This repo carries the loader; the data lives outside
 * it and is supplied at dev-server start via `IDLE_EVAL_HOLDOUT_DIR`. Unset —
 * and always in a build — the suite is simply absent.
 */
import { BENCHMARK_INTENTS } from './benchmarks';
import { buildArtistScreens } from './style-apply';
import type { ArtistStyleProfile, EvalScreen } from './types';

/**
 * Supplied by the `eval-holdout` Vite plugin. Resolves to `null` when no
 * holdout directory is configured, which is the normal case.
 */
import HOLDOUT_DATA from 'virtual:idle-eval-holdout';

export interface HoldoutCatalog {
  profiles: ArtistStyleProfile[];
  screens: EvalScreen[];
}

const REQUIRED = [
  'id', 'origin', 'artist', 'movement', 'years', 'publicName', 'channelId',
  'publicNaming', 'publicNamingNote', 'research', 'palette', 'markMaking',
  'motionDialect', 'composition', 'schemaGaps', 'durableKeys', 'signaturePrompts',
] as const;

/**
 * Validate hand-authored JSON into profiles.
 *
 * These fixtures are written by hand in a file no compiler sees, so a typo
 * would otherwise surface as a scoring anomaly hours later rather than as an
 * error. Throwing here — loudly, naming the profile — is the cheaper failure.
 */
export function parseHoldoutProfiles(raw: unknown): ArtistStyleProfile[] {
  if (raw === null || typeof raw !== 'object') throw new Error('holdout: not an object');
  const { profiles } = raw as { profiles?: unknown };
  if (!Array.isArray(profiles)) throw new Error('holdout: missing `profiles` array');
  return profiles.map((p, i) => {
    if (p === null || typeof p !== 'object') throw new Error(`holdout: profile ${i} is not an object`);
    const rec = p as Record<string, unknown>;
    for (const key of REQUIRED) {
      if (rec[key] === undefined) {
        throw new Error(`holdout: profile ${i} (${String(rec.id ?? '?')}) is missing \`${key}\``);
      }
    }
    if (rec.origin !== 'house') {
      throw new Error(`holdout: profile ${String(rec.id)} must be origin:'house', got '${String(rec.origin)}'`);
    }
    if (!Array.isArray(rec.signaturePrompts) || rec.signaturePrompts.length === 0) {
      throw new Error(`holdout: profile ${String(rec.id)} has no signaturePrompts`);
    }
    return rec as unknown as ArtistStyleProfile;
  });
}

let cached: HoldoutCatalog | null | undefined;

/** The held-out catalog, or null when no fixtures are configured. */
export function getHoldoutCatalog(): HoldoutCatalog | null {
  if (cached !== undefined) return cached;
  if (!HOLDOUT_DATA) {
    cached = null;
    return null;
  }
  const profiles = parseHoldoutProfiles(HOLDOUT_DATA);
  const ids = new Set(profiles.map((p) => p.id));
  if (ids.size !== profiles.length) throw new Error('holdout: duplicate profile ids');
  cached = {
    profiles,
    screens: profiles.flatMap((p) => buildArtistScreens(p, BENCHMARK_INTENTS)),
  };
  return cached;
}

export const HOLDOUT_AVAILABLE: boolean = HOLDOUT_DATA !== null;

/**
 * The number the whole two-suite design exists to produce.
 *
 * Same model, same rubric, same scorer — one suite whose style names it has
 * priors for, one it cannot possibly have seen. The difference is an estimate
 * of how much of a published score is recall rather than instruction-following.
 *
 * Positive `gap` means the model did better on the styles it already knew.
 */
export function originGap(
  studyScores: number[],
  houseScores: number[],
): { study: number; house: number; gap: number; n: { study: number; house: number } } {
  const median = (xs: number[]): number => {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  };
  const study = median(studyScores);
  const house = median(houseScores);
  return { study, house, gap: study - house, n: { study: studyScores.length, house: houseScores.length } };
}
