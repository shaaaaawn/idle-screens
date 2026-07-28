import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getCatalog } from './catalog';
import { hashStyleDna } from './provenance';
import { scoreScreen } from './score';
import { publicCredit, researchCredit, specLabel } from './public-identity';

const catalog = getCatalog();

describe('public identity', () => {
  /**
   * The regression that matters. A spec's `label` travels INSIDE the spec, so
   * it survives export and publication and ends up on whatever channel plays
   * it — long after it left the playground. Before `specLabel` existed the
   * label was built as `${profile.artist}: ${title}`, which put a living
   * artist's name into a published artifact.
   *
   * Adding a profile without a `publicName` is the way this comes back.
   */
  it('no descriptive-only artist is named in any generated spec label', () => {
    const leaks = catalog.screens
      .filter((s) => {
        const p = catalog.artists.find((a) => a.id === s.artistId)!;
        return p.publicNaming === 'descriptive-only' && s.spec.label.includes(p.artist);
      })
      .map((s) => `${s.id}: ${s.spec.label}`);
    expect(leaks).toEqual([]);
  });

  it('every profile carries a public identity and a channel id', () => {
    for (const p of catalog.artists) {
      expect(p.publicName, p.id).toBeTruthy();
      expect(p.channelId, p.id).toMatch(/^evals-[a-z0-9-]+$/);
      expect(p.publicNamingNote, p.id).toBeTruthy();
    }
  });

  it('channel ids are unique', () => {
    const ids = catalog.artists.map((a) => a.channelId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('spec labels use the public name, never the artist', () => {
    const kusama = catalog.artists.find((a) => a.id === 'kusama')!;
    expect(specLabel(kusama, 'Some Screen')).toBe('Infinity Field: Some Screen');
    expect(specLabel(kusama, 'Some Screen')).not.toContain(kusama.artist);
  });

  it('public credit names the movement always, the artist only when reviewed', () => {
    const monet = catalog.artists.find((a) => a.id === 'monet')!;
    const riley = catalog.artists.find((a) => a.id === 'riley')!;
    expect(publicCredit(monet)).toContain(monet.artist);
    expect(publicCredit(riley)).not.toContain(riley.artist);
    expect(publicCredit(riley)).toContain(riley.movement);
  });

  it('research credit names every artist — accreditation is not suppression', () => {
    for (const p of catalog.artists) {
      expect(researchCredit(p), p.id).toContain(p.artist);
    }
  });

  /**
   * Cover identity is presentation and must not enter the DNA hash, or adding
   * a `publicName` would mark every prior run incomparable for no reason.
   *
   * Signature TITLES were the same problem and were the reason `hashStyleDna`
   * now reduces each prompt to id/intent/recipe. Measured at the time of the
   * rename: the old formula over the renamed titles gives `db7eb366`, so the
   * renames really would have moved the hash while leaving all 150 scores
   * byte-identical — a false "these runs aren't comparable" signal.
   *
   * One-time consequence: baseline-v0's stored `styleDnaHash` is `1d6b1654`,
   * computed by the old formula. It is the SAME DNA — titles are the only
   * thing that changed and the new formula ignores them — so under today's
   * formula that run would also hash to the value pinned here.
   *
   * Pinned so a future change to what the hash covers has to be deliberate.
   */
  it('the StyleDNA hash is stable and excludes presentation', () => {
    expect(hashStyleDna(catalog.artists)).toBe('773845e7');
  });

  /**
   * Lock against *accidental* score drift from presentation-only catalog edits
   * (public names, titles, labels). When perception/scoring intentionally
   * changes, refresh `runs/latest` via `WRITE_STYLE_EVAL_BASELINE=1` and land
   * that artifact in the same PR — do not weaken this assertion.
   */
  it('scores match the committed baseline', () => {
    const prior = new Map(
      readFileSync(new URL('./runs/latest/results.jsonl', import.meta.url), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { screenId: string; score: number })
        .map((r) => [r.screenId, r.score] as const),
    );
    expect(prior.size).toBe(150);
    const moved = catalog.screens
      .map((s) => {
        const p = catalog.artists.find((a) => a.id === s.artistId)!;
        const now = scoreScreen(s, p).score;
        const then = prior.get(s.id);
        return then !== undefined && Math.abs(now - then) > 1e-12
          ? `${s.id}: ${then} -> ${now}`
          : null;
      })
      .filter(Boolean);
    expect(moved).toEqual([]);
  });
});
