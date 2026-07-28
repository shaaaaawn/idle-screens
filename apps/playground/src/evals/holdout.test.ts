import { describe, expect, it } from 'vitest';
import { getCatalog } from './catalog';
import { scoreScreen } from './score';
import { getHoldoutCatalog, HOLDOUT_AVAILABLE, originGap, parseHoldoutProfiles } from './holdout';

describe('holdout loader', () => {
  it('is absent unless fixtures are configured', () => {
    // Both states are correct; what must never happen is fixtures shipping in
    // this repo, so the default has to be "off".
    if (!HOLDOUT_AVAILABLE) expect(getHoldoutCatalog()).toBeNull();
    else expect(getHoldoutCatalog()).not.toBeNull();
  });

  it('rejects malformed fixture files with a message naming the profile', () => {
    expect(() => parseHoldoutProfiles(null)).toThrow(/not an object/);
    expect(() => parseHoldoutProfiles({})).toThrow(/missing `profiles`/);
    expect(() => parseHoldoutProfiles({ profiles: [{ id: 'x', origin: 'house' }] })).toThrow(
      /profile 0 \(x\) is missing/,
    );
  });

  it('refuses a study profile smuggled into the holdout set', () => {
    const study = { ...getCatalog().artists[0]! };
    expect(() => parseHoldoutProfiles({ profiles: [study] })).toThrow(/must be origin:'house'/);
  });
});

describe('originGap', () => {
  it('is positive when a model does better on styles it has priors for', () => {
    const g = originGap([0.9, 0.92, 0.94], [0.7, 0.72, 0.74]);
    expect(g.study).toBeCloseTo(0.92);
    expect(g.house).toBeCloseTo(0.72);
    expect(g.gap).toBeCloseTo(0.2);
    expect(g.n).toEqual({ study: 3, house: 3 });
  });

  it('is zero when both suites score alike — no measurable recall advantage', () => {
    expect(originGap([0.8, 0.8], [0.8, 0.8]).gap).toBe(0);
  });

  it('handles an empty suite without dividing by zero', () => {
    expect(originGap([], []).gap).toBe(0);
  });
});

// Only meaningful with IDLE_EVAL_HOLDOUT_DIR set; skipped otherwise so the
// public repo's own CI stays green without the fixtures.
describe.skipIf(!HOLDOUT_AVAILABLE)('holdout catalog (fixtures present)', () => {
  it('builds scoreable screens from house DNA', () => {
    const holdout = getHoldoutCatalog()!;
    expect(holdout.profiles.length).toBeGreaterThan(0);
    expect(holdout.screens.length).toBe(holdout.profiles.length * 10);
    for (const p of holdout.profiles) expect(p.origin).toBe('house');
  });

  it('every house screen produces a valid spec', () => {
    const holdout = getHoldoutCatalog()!;
    const invalid = holdout.screens
      .map((s) => {
        const p = holdout.profiles.find((x) => x.id === s.artistId)!;
        const sc = scoreScreen(s, p);
        return sc.valid ? null : `${s.id}: ${sc.validationErrors.join('; ')}`;
      })
      .filter(Boolean);
    expect(invalid).toEqual([]);
  });

  /**
   * The calibration check — this is what makes the two-suite comparison mean
   * anything.
   *
   * The applicator is a mechanical DNA reader with no priors whatsoever. If it
   * scores both suites alike, the house fixtures are no harder and no easier to
   * satisfy than the published ones, so a MODEL scoring differently on them is
   * evidence about priors rather than about fixture difficulty.
   *
   * Measured when the house set was authored: study 0.929, house 0.936. The
   * tolerance is deliberately loose — this guards against a house style that is
   * badly mismatched to the rubric, not against small drift.
   */
  it('the applicator scores both suites alike — fixtures are calibrated', () => {
    const holdout = getHoldoutCatalog()!;
    const published = getCatalog();
    const median = (xs: number[]): number => {
      const s = [...xs].sort((a, b) => a - b);
      return s[s.length >> 1]!;
    };
    const study = median(
      published.screens.map((s) => scoreScreen(s, published.artists.find((a) => a.id === s.artistId)!).score),
    );
    const house = median(
      holdout.screens.map((s) => scoreScreen(s, holdout.profiles.find((a) => a.id === s.artistId)!).score),
    );
    expect(Math.abs(study - house)).toBeLessThan(0.08);
  });

  /**
   * A style whose median is a perfect 1.0 isn't being measured — the rubric
   * can't tell a good attempt from a great one, so it contributes no signal.
   * `interference` sat at exactly 1.000 when authored; this fails if a second
   * style joins it, which would mean the benchmark checks need tightening.
   */
  it('at most one house style saturates the rubric', () => {
    const holdout = getHoldoutCatalog()!;
    const saturated = holdout.profiles.filter((p) => {
      const xs = holdout.screens
        .filter((s) => s.artistId === p.id)
        .map((s) => scoreScreen(s, p).score)
        .sort((a, b) => a - b);
      return xs[xs.length >> 1]! >= 1;
    });
    expect(saturated.map((p) => p.id).length).toBeLessThanOrEqual(1);
  });

  it('house styles share no channel id or profile id with the published suite', () => {
    const holdout = getHoldoutCatalog()!;
    const published = getCatalog().artists;
    for (const h of holdout.profiles) {
      expect(published.some((a) => a.id === h.id), h.id).toBe(false);
      expect(published.some((a) => a.channelId === h.channelId), h.channelId).toBe(false);
    }
  });
});
