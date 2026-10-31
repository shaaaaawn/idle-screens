import { describe, expect, it } from 'vitest';
import { CHOREO_MARKS, choreoAt, choreoLine, parseChoreography, STARFISH_MOVE_NAMES } from './choreo';
import { STARFISH_CLIPS, STARFISH_MOVES } from './starfish';

const MOVES = STARFISH_MOVE_NAMES;

describe('choreography: the sheet', () => {
  it('parses actors, cues and every modifier', () => {
    const { lines, problems } = parseChoreography('a: 8:lie, 4:rise >right @cam, 2:spin ~360, 2:jacks ^0.6 | *: 2.5:march >1,-0.5 @90', MOVES);
    expect(problems).toEqual([]);
    expect([...lines.keys()]).toEqual([0, '*']);
    const a = lines.get(0)!;
    expect(a.beats).toBe(16);
    expect(a.cues.map((c) => [c.b0, c.beats, c.move])).toEqual([[0, 8, 'lie'], [8, 4, 'rise'], [12, 2, 'spin'], [14, 2, 'jacks']]);
    expect(a.cues[1]).toMatchObject({ to: CHOREO_MARKS.right, face: 'cam' });
    expect(a.cues[2]!.turn).toBe(360);
    expect(a.cues[3]!.lift).toBe(0.6);
    expect(lines.get('*')!.cues[0]).toMatchObject({ beats: 2.5, move: 'march', to: [1, -0.5], face: 90 });
  });
  it('anything after a cue that is not a modifier is named', () => {
    expect(parseChoreography('4:march, x:jacks', MOVES).problems[0]).toMatch(/"x:jacks" is not >to/);
  });
  it('a sheet with no actor is everyone’s', () => {
    expect([...parseChoreography('4:march, 4:jacks', MOVES).lines.keys()]).toEqual(['*']);
  });

  it('parses a cue with a long run of spaces after the move (CodeQL polynomial ReDoS), the same as a short one', () => {
    const long = parseChoreography(`0.5:march${' '.repeat(20000)}>right`, MOVES);
    const short = parseChoreography('0.5:march >right', MOVES);
    expect(long.lines.get('*')).toEqual(short.lines.get('*'));
    expect(long.problems).toEqual(short.problems);
  });
  it('a bad token is a problem and is dropped, never fatal', () => {
    const { lines, problems } = parseChoreography('a: 4:moonwalk, x:march, 0:jacks, 4:kick >nowhere ?, 4:reach', MOVES);
    expect(lines.get(0)!.cues.map((c) => c.move)).toEqual(['kick', 'reach']);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/no move "moonwalk"/);
    expect(problems.join(' ')).toMatch(/travel to "nowhere"/);
  });
  it('names every kind of bad modifier, a repeated dancer and an empty line', () => {
    const { lines, problems } = parseChoreography('a: 4:march @upward ~twice ^-1 ^high, 4:jacks | a: 2:hold | b: 0:march', MOVES);
    expect(problems.join(' ')).toMatch(/face "upward"/);
    expect(problems.join(' ')).toMatch(/turn "twice" is not degrees/);
    expect(problems.join(' ')).toMatch(/leap "-1" is not a height/);
    expect(problems.join(' ')).toMatch(/dancer a has two lines/);
    expect(problems.join(' ')).toMatch(/has no cues/);
    expect(lines.get(0)!.cues.map((c) => c.move)).toEqual(['hold']);
  });
  it('a cue without beats is named; a line stops at 256 cues', () => {
    expect(parseChoreography('march', MOVES).problems[0]).toMatch(/"march" is not <beats>:<move>/);
    const long = parseChoreography(Array.from({ length: 300 }, () => '1:march').join(', '), MOVES);
    expect(long.lines.get('*')!.cues).toHaveLength(256);
    expect(long.problems[0]).toMatch(/more than 256 cues/);
  });
  it('a dancer that went to the centre stays there for the next cue, and leaves it for the next mark', () => {
    const l = parseChoreography('4:walk >centre, 4:hold, 4:walk >left', MOVES).lines.get('*')!;
    expect(choreoAt(l, 6).centre).toBe(1);
    expect(choreoAt(l, 12 - 1e-6)).toMatchObject({ centre: expect.closeTo(0, 4), side: expect.closeTo(-2, 4) });
  });
  it('reads a lean and a crouch, and names bad ones', () => {
    const { lines, problems } = parseChoreography('4:hold /15 %0.7, 4:hold /back %0', MOVES);
    expect(lines.get('*')!.cues[0]).toMatchObject({ lean: 15, squash: 0.7 });
    expect(problems.join(' ')).toMatch(/lean "back" is not degrees/);
    expect(problems.join(' ')).toMatch(/crouch "0" is not a height scale/);
  });
  it('what a cue is arrives on its first beat; what it does lands at its end', () => {
    const l = parseChoreography('4:hold, 4:hold @90 /10 >right ~360', MOVES).lines.get('*')!;
    expect(choreoAt(l, 3.45).ahead).toBe(0); // half a beat ahead, no more
    expect(choreoAt(l, 3.8).ahead).toBeGreaterThan(0);
    expect(choreoAt(l, 4)).toMatchObject({ face: 90, lean: 10, side: 0, turn: 0 }); // turned and leaning on the beat, not yet travelled
    expect(choreoAt(l, 8 - 1e-6).side).toBeCloseTo(2, 4);
    expect(choreoAt(l, 8 - 1e-6).turn).toBeCloseTo(360, 3);
  });
  it('a groove dips into every beat, lowest on it', () => {
    const l = parseChoreography('8:reach *0.1', MOVES).lines.get('*')!;
    expect(choreoAt(l, 3).squash).toBeCloseTo(0.9, 9);
    expect(choreoAt(l, 3.5).squash).toBeCloseTo(1, 9);
    expect(choreoAt(l, 2.9).squash).toBeGreaterThan(choreoAt(l, 3).squash);
    expect(choreoAt(l, 3.1).squash).toBeGreaterThan(choreoAt(l, 3).squash);
    expect(parseChoreography('4:reach *x', MOVES).problems[0]).toMatch(/groove "x"/);
  });
  it('clamps a long cue, a big turn and a high leap', () => {
    const c = parseChoreography('9999:march ~9000 ^9 >99,-99', MOVES).lines.get('*')!.cues[0]!;
    expect(c).toMatchObject({ beats: 512, turn: 1440, lift: 3, to: [6, -6] });
  });
  it('every starfish move plays a clip the rig has', () => {
    for (const name of STARFISH_MOVE_NAMES) expect(STARFISH_CLIPS).toContain(STARFISH_MOVES[name].clip);
  });
});

describe('choreography: the pose at a beat', () => {
  const line = parseChoreography('8:lie, 4:rise >right, 2:spin ~360, 2:jacks ^0.5 >home', MOVES).lines.get('*')!;
  it('is the cue it is on, how far into it, and loops over the line', () => {
    expect(choreoAt(line, 0)).toMatchObject({ beat: 0, u: 0 });
    expect(choreoAt(line, 0).cue.move).toBe('lie');
    expect(choreoAt(line, 10).cue.move).toBe('rise');
    expect(choreoAt(line, 10).u).toBeCloseTo(0.5);
    expect(choreoAt(line, 15).cue.move).toBe('jacks');
    expect(choreoAt(line, 16 + 10)).toEqual(choreoAt(line, 10));
    expect(choreoAt(line, 10)).toEqual(choreoAt(line, 10)); // a pure function of the beat
  });
  it('travels over a cue and holds there after it', () => {
    expect(choreoAt(line, 8).side).toBeCloseTo(0);
    expect(choreoAt(line, 12).side).toBeCloseTo(CHOREO_MARKS.right![0] as number);
    expect(choreoAt(line, 13).side).toBeCloseTo(2); // the spin stays where the rise went
    expect(choreoAt(line, 15.999).side).toBeCloseTo(0, 2); // and >home brings it back by the line's end
  });
  it('turns over its cue and leaps in an arc that lands as the cue ends', () => {
    expect(choreoAt(line, 12).turn).toBeCloseTo(0);
    expect(choreoAt(line, 13).turn).toBeCloseTo(180);
    expect(choreoAt(line, 14).turn % 360).toBeCloseTo(0);
    expect(choreoAt(line, 15).lift).toBeCloseTo(0.5);
    expect(choreoAt(line, 14).lift).toBeCloseTo(0);
    expect(choreoAt(line, 15.999).lift).toBeLessThan(0.01);
  });
  it('a line that ends where it began loops without a jump', () => {
    const end = choreoAt(line, 16 - 1e-6), start = choreoAt(line, 0);
    expect(end.side).toBeCloseTo(start.side, 4);
    expect(end.depth).toBeCloseTo(start.depth, 4);
    expect((end.turn - start.turn) % 360).toBeCloseTo(0, 3);
  });
  it('a lap starts at home whatever the last one ended on', () => {
    const away = parseChoreography('4:lie, 4:crawl >right', MOVES).lines.get('*')!;
    expect(choreoAt(away, 0).side).toBe(0);
    expect(choreoAt(away, 8 - 1e-6).side).toBeCloseTo(2, 4);
    expect(choreoAt(away, 8).side).toBe(0);
  });
  it('faces the room, a heading or the camera, gliding over the first beat', () => {
    const f = parseChoreography('2:hold @90, 2:hold @cam, 4:hold @room', MOVES).lines.get('*')!;
    expect(choreoAt(f, 1).face).toBeCloseTo(90);
    expect(choreoAt(f, 3).faceCam).toBeCloseTo(1);
    expect(choreoAt(f, 5)).toMatchObject({ face: 0, faceCam: 0 });
  });
  it('a dancer without a line of its own dances `*`, and none without either', () => {
    const sheet = parseChoreography('a: 4:march | *: 4:jacks', MOVES);
    expect(choreoLine(sheet, 0)!.cues[0]!.move).toBe('march');
    expect(choreoLine(sheet, 3)!.cues[0]!.move).toBe('jacks');
    expect(choreoLine(parseChoreography('b: 4:march', MOVES), 0)).toBeNull();
  });
});
