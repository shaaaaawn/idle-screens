import { describe, expect, it } from 'vitest';
import { parseChoreography, STARFISH_MOVE_NAMES } from './choreo';
import { parseFloorCover } from './floor-cover-mix';
import { validateMetaquariumParams } from './guide';
import { parsePyramidMix } from './pyramid-mix';
import { OPEN_MARKS, parseVignette } from './vignette';

// Agent-written names were looked up with `name in table` or `table[name]`,
// which follow the prototype chain: "constructor" or "toString" passed as a
// real kind, mark or material. floorCover "constructor/x" then threw
// (`Object.includes is not a function`) inside validateMetaquariumParams and
// on every frame of the tank. Each lookup is an own-property check now.
describe('param mini-languages refuse inherited names (constructor, toString, …)', () => {
  it('floorCover: an inherited kind is a problem, not a throw', () => {
    expect(() => parseFloorCover('constructor/x')).not.toThrow();
    expect(parseFloorCover('constructor/x').problems).toHaveLength(1);
    expect(parseFloorCover('tostring').problems).toHaveLength(1);
    expect(() => validateMetaquariumParams({ floorCover: 'constructor/x' })).not.toThrow();
    expect(validateMetaquariumParams({ floorCover: 'constructor/x' }).map((p) => p.path)).toContain('floorCover');
  });

  it('vignette: an inherited mark is "no mark", not a function used as a point', () => {
    const v = parseVignette('5s: a >constructor | 3s: a =toString', OPEN_MARKS);
    expect(v.problems.join(' ')).toMatch(/no mark "constructor"/);
    expect(v.problems.join(' ')).toMatch(/toString/);
  });

  it('choreography: an inherited travel mark or facing is refused', () => {
    const p = parseChoreography('a: 4:march >constructor @constructor', STARFISH_MOVE_NAMES).problems;
    expect(p.join(' ')).toMatch(/travel to "constructor"/);
    expect(p.join(' ')).toMatch(/face "constructor"/);
  });

  it('pyramidMix: an inherited stone and a non-finite weight are refused', () => {
    expect(parsePyramidMix('constructor').problems).toHaveLength(1);
    expect(parsePyramidMix(`giza:${'9'.repeat(400)}`).problems).toHaveLength(1);
    // Each finite, but their sum overflows the picker's total.
    expect(parsePyramidMix(`giza:${'9'.repeat(308)}, mayan:${'9'.repeat(308)}`).problems).toHaveLength(2);
    expect(parsePyramidMix('giza:1000000').problems).toEqual([]);
    expect(parsePyramidMix('giza:3, obsidian').problems).toEqual([]);
  });
});

// Vignettes name four actors (a–d), but the guide expanded only three cast
// slots, so actor d always read as "fish" and a valid octopus gesture on d was
// flagged.
describe('vignette breed check covers all four actors', () => {
  it('reads actor d from the fourth slot', () => {
    const params = { fishMix: 'dori:1, dori:1, dori:1, octopus:1', vignette: '5s: a =centre, b =left, c =right, d =centre | 3s: d ink' };
    expect(validateMetaquariumParams(params).filter((p) => p.path === 'vignette')).toEqual([]);
  });
});
