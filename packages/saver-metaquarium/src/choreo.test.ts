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
  it('a bad token is a problem and is dropped, never fatal', () => {
    const { lines, problems } = parseChoreography('a: 4:moonwalk, x:march, 0:jacks, 4:kick >nowhere ?, 4:reach', MOVES);
    expect(lines.get(0)!.cues.map((c) => c.move)).toEqual(['kick', 'reach']);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/no move "moonwalk"/);
    expect(problems.join(' ')).toMatch(/travel to "nowhere"/);
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
