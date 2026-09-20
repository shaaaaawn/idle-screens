import { describe, expect, it } from 'vitest';
import { MAX_SPOTS, parseSpotCues, parseSpotRig, SPOT_FADE, spotLevels } from './spots';
import { OPEN_MARKS, parseVignette, VIGNETTE_CUES, VIGNETTES } from './vignette';

describe('spot rig', () => {
  it('parses slot/color*radius, defaults the rest, and stops at three', () => {
    const { spots, problems } = parseSpotRig('4/#ff3f9e*26, 1, 2/#7fdcff, 3, nonsense');
    expect(spots).toHaveLength(MAX_SPOTS);
    expect(spots[0]).toEqual({ slot: 4, color: '#ff3f9e', radius: 26 });
    // The defaults are by POSITION in the rig, not by slot: the second spot
    // is pink, the third cyan, whichever fish they follow.
    expect(spots[1]).toEqual({ slot: 1, color: '#ff8ad0', radius: 28 });
    expect(spots[2]).toEqual({ slot: 2, color: '#7fdcff', radius: 28 });
    expect(problems).toEqual([
      'more than 3 spots — "3" dropped',
      '"nonsense" is not slot[/color][*radius]',
    ]);
    expect(parseSpotRig('').spots).toEqual([]);
    expect(parseSpotRig('0').spots[0]).toEqual({ slot: 0, color: '#fff2cf', radius: 28 }); // the first is warm white
  });

  it('clamps: radius 12–60, slots to the cast, one spot per performer; cues 2–120 s', () => {
    const { spots, problems } = parseSpotRig('0*4, 0/#fff, 1*999, 99');
    expect(spots.map(s => s.radius)).toEqual([12, 60, 28]);
    expect(spots[2]!.slot).toBe(23); // the last fish slot there is
    expect(problems).toEqual(['slot 0 is already spotted — "0/#fff" dropped']);
    expect(spots).toHaveLength(3); // the duplicate did not take a place in the rig
    const sheet = parseSpotCues('0.5s:a, 999s:b', 2);
    expect(sheet.problems).toEqual([]);
    expect(sheet.cues.map(c => c.dur)).toEqual([2, 120]);
    expect(sheet.duration).toBe(122);
  });

  it('with no cue sheet every spot in the rig is up', () => {
    const out: number[] = [];
    spotLevels(null, 2, 12, out);
    expect(out).toEqual([1, 1, 0]);
  });

  it('cues loop, cross-fade at the boundary, and are pure in t', () => {
    const sheet = parseSpotCues('8s:a, 8s:b, 10s:a+b, 4s:-', 2);
    expect(sheet.problems).toEqual([]);
    expect(sheet.duration).toBe(30);
    const at = (t: number): number[] => { const o: number[] = []; spotLevels(sheet, 2, t, o); return o; };
    expect(at(5)).toEqual([1, 0, 0]);
    expect(at(12)).toEqual([0, 1, 0]);
    expect(at(20)).toEqual([1, 1, 0]);
    expect(at(29)).toEqual([0, 0, 0]);
    const mid = at(8 + SPOT_FADE / 2); // a going out as b comes up
    expect(mid[0]!).toBeCloseTo(0.5, 5);
    expect(mid[1]!).toBeCloseTo(0.5, 5);
    expect(at(35)).toEqual(at(5));
    expect(at(-25)).toEqual(at(5));
    expect(parseSpotCues('5s:c', 2).problems).toHaveLength(1);
    expect(parseSpotCues('soon:a', 2).problems).toHaveLength(1);
  });

  it('the staged presets and their cue sheets are the same length, beat for beat', () => {
    for (const name of ['duet', 'trio']) {
      const v = parseVignette(VIGNETTES[name]!, OPEN_MARKS);
      expect(v.problems, name).toEqual([]);
      const sheet = parseSpotCues(VIGNETTE_CUES[name]!, v.actors);
      expect(sheet.problems, name).toEqual([]);
      expect(sheet.duration, name).toBeCloseTo(v.duration, 6);
      expect(sheet.cues.map(c => c.t0), name).toEqual(v.beats.map(b => b.t0));
    }
  });
});
