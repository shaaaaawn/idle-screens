/**
 * The seam between the RESEARCH identity of a style and its PUBLIC identity.
 *
 * `ArtistStyleProfile.artist` names the prompt. That precision is the point of
 * the dataset — a row labelled "Georges Seurat" is what makes the eval legible
 * and citable, and naming an artist to describe an influence is ordinary
 * descriptive use.
 *
 * A consumer channel on a commercial site is a different use. There the risk
 * isn't the pixels — artistic style isn't protected, and these are original
 * generative compositions, not reproductions — it's the *naming*: right of
 * publicity for living artists, marks held by estates, and implied endorsement.
 *
 * So the two identities are kept apart here rather than at each call site:
 *
 * - Everything a viewer sees (spec labels, channel ids, captions) uses
 *   `publicName` / `channelId`, UNIFORMLY, for every style. Uniform matters —
 *   it means no surface depends on a per-artist review flag being correct.
 * - `publicNaming` only gates whether the artist may ALSO be *credited* by
 *   name on that surface. Never whether the composition can appear.
 *
 * Accreditation is not the same as naming, and this file does not suppress it.
 * Every style credits its movement publicly, and the full attribution —
 * including artists we don't name on channels — lives in ACCREDITATION.md and
 * in the dataset. See `idle-mono/docs/eval-publishing-spec.md` §5.
 */
import type { ArtistStyleProfile } from './types';

/**
 * The `label` baked into a generated SaverSpec.
 *
 * This one is load-bearing in a way the others aren't: the label travels
 * *inside* the spec, so it survives export, publication, and any channel that
 * plays it — long after it has left the playground that built it.
 */
export function specLabel(profile: ArtistStyleProfile, title: string): string {
  return `${profile.publicName}: ${title}`;
}

/**
 * The credit shown alongside a screen on a public surface.
 *
 * Movement is always credited; the artist only where reviewed as nameable.
 * Phrased as a study *after* a style, which is what it is — never as a work by,
 * for, or endorsed by anyone.
 */
export function publicCredit(profile: ArtistStyleProfile): string {
  return profile.publicNaming === 'artist-named'
    ? `A ${profile.movement} study, after ${profile.artist} (${profile.years}).`
    : `A ${profile.movement} study (${profile.years}).`;
}

/**
 * Full attribution for research contexts — the methodology page, the dataset,
 * ACCREDITATION.md. Names every artist, including the ones channels don't.
 * Describing the influence accurately is the accreditation; withholding the
 * name here would be worse scholarship for no gain in protection.
 */
export function researchCredit(profile: ArtistStyleProfile): string {
  return `${profile.publicName} — style study after ${profile.artist} (${profile.movement}, ${profile.years}). ${profile.publicNamingNote}`;
}
