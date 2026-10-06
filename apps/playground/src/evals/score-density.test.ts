import { describe, expect, it } from 'vitest';
import type { SaverSpec } from '@idle-screens/schema';
import { getCatalog } from './catalog';
import { adviseSpec } from '@idle-screens/schema';
import { isCoverageBand, perceptionGateFloor, scoreScreen } from './score';
import type { ArtistStyleProfile, EvalScreen } from './types';

/**
 * A style whose premise is emptiness must not be scored as broken for
 * following its own DNA. Two doors open the perception gate: the profile
 * declares an expected coverage band, or the spec declares `density: 'sparse'`.
 * Neither door is a free pass — a declared-sparse spec that measures dense
 * trips adviseSpec's `density-mismatch`, which the advisory penalty reads.
 */
const oneMark: SaverSpec = {
  schemaVersion: 1,
  id: 'one-mark',
  label: 'One mark',
  seed: 7,
  background: { type: 'solid', color: '#03060a' },
  layers: [
    {
      count: 1,
      sprite: { kind: 'ring', radius: [0.04, 0.04], color: '#4fb3a8', width: 0.004 },
      alpha: [0.35, 0.35],
      blend: 'lighter',
      motion: { type: 'static' },
      position: { x: 0.5, y: 0.5 },
    },
  ],
};

function screenFor(spec: SaverSpec, profile: ArtistStyleProfile): EvalScreen {
  return {
    id: `${profile.id}--signature--gate`,
    artistId: profile.id,
    kind: 'signature',
    screenId: 'gate',
    title: 'Gate',
    intent: 'one faint mark, nothing else',
    recipe: 'focal-orb',
    spec,
  };
}

describe('perception gate honours declared density', () => {
  const profile = getCatalog().artists.find((a) => a.id === 'rothko')!;
  const sparseProfile: ArtistStyleProfile = {
    ...profile,
    composition: { ...profile.composition, coverageBand: [0.0001, 0.01] },
  };

  it('the default floor is the historical 0.2 %', () => {
    expect(perceptionGateFloor(oneMark, profile)).toBe(0.002);
  });

  it('a profile coverage band lowers the floor to its lower bound', () => {
    expect(perceptionGateFloor(oneMark, sparseProfile)).toBe(0.0001);
  });

  it('a band can lower the gate but never raise it — a higher minimum is an intent constraint, not a gate', () => {
    const dense = { ...profile, composition: { ...profile.composition, coverageBand: [0.01, 0.05] as [number, number] } };
    expect(perceptionGateFloor(oneMark, dense)).toBe(0.002);
  });

  it('a spec-declared sparse lowers the floor a decade, clamped', () => {
    expect(perceptionGateFloor({ ...oneMark, density: 'sparse' }, profile)).toBe(0.0002);
    expect(perceptionGateFloor({ ...oneMark, density: 'sparse' }, sparseProfile)).toBe(0.0001);
    expect(perceptionGateFloor({ ...oneMark, density: 'dense' }, profile)).toBe(0.002);
  });

  it('the spec door stays shut when the declaration is contradicted (density-mismatch)', () => {
    const mismatch = [{ path: 'density', code: 'density-mismatch', message: 'x' }];
    expect(perceptionGateFloor({ ...oneMark, density: 'sparse' }, profile, mismatch)).toBe(0.002);
    // The profile door is a statement about the style, not the spec — it still opens.
    expect(perceptionGateFloor({ ...oneMark, density: 'sparse' }, sparseProfile, mismatch)).toBe(0.0001);
  });

  it('a malformed profile band is ignored rather than trusted', () => {
    for (const bad of [[0, 0.01], [0.02, 0.01], [-0.1, 0.5], [0.001, 2], [0.001], ['a', 'b'], 0.001]) {
      expect(isCoverageBand(bad)).toBe(false);
      const broken = { ...profile, composition: { ...profile.composition, coverageBand: bad as never } };
      expect(perceptionGateFloor(oneMark, broken)).toBe(0.002);
    }
    expect(isCoverageBand([0.0001, 0.01])).toBe(true);
  });

  it('a faithful one-mark scene passes the gate under either declaration and fails it under neither', () => {
    const undeclared = scoreScreen(screenFor(oneMark, profile), profile);
    expect(undeclared.perceptionOk).toBeLessThan(1);
    expect(undeclared.notes).toContain('weak perception signal');

    const viaProfile = scoreScreen(screenFor(oneMark, sparseProfile), sparseProfile);
    expect(viaProfile.perceptionOk).toBe(1);

    const viaSpec = scoreScreen(screenFor({ ...oneMark, density: 'sparse' }, profile), profile);
    expect(viaSpec.perceptionOk).toBe(1);
    expect(viaSpec.score).toBeGreaterThan(undeclared.score);
  });

  it('a declared-sparse field pays the mismatch penalty instead of gaining from the declaration', () => {
    const field: SaverSpec = {
      ...oneMark,
      id: 'field',
      density: 'sparse',
      layers: [
        {
          count: 200,
          sprite: { kind: 'circle', radius: [0.03, 0.05], color: '#4fb3a8', soft: true },
          motion: { type: 'drift', speed: [0.01, 0.02] },
        },
      ],
    };
    const advisories = adviseSpec(field);
    expect(advisories.some((a) => a.code === 'density-mismatch')).toBe(true);
    // The contradicted declaration buys no gate relief at all …
    expect(perceptionGateFloor(field, profile, advisories)).toBe(0.002);
    const honest = scoreScreen(screenFor({ ...field, density: undefined }, profile), profile);
    const gamed = scoreScreen(screenFor(field, profile), profile);
    expect(gamed.perceptionOk).toBe(honest.perceptionOk);
    // … and pays the mismatch penalty on top.
    expect(gamed.advisoryPenalty).toBeGreaterThan(honest.advisoryPenalty);
    expect(gamed.score).toBeLessThan(honest.score);
  });
});
