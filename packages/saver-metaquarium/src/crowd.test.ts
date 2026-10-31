import { describe, expect, it } from 'vitest';
import { buildStageSet, CLUB } from './club';
import { CROWD, crowdSeat, OPEN_MARKS, parseVignette, poseOf, VIGNETTES, type Vignette } from './vignette';

/** The open mic as the recipe casts it: three comics (a b c), then eleven in the house. */
const AUDIENCE = Array.from({ length: 11 }, (_, i) => 3 + i);
const show = (): Vignette => parseVignette(VIGNETTES.openmic!, OPEN_MARKS, AUDIENCE);
const beatAt = (v: Vignette, i: number): { t0: number; dur: number } => v.beats[i]!;
/** The first beat whose actors include `gesture`, from beat `from` on. */
const firstWith = (v: Vignette, gesture: string, from = 0): number => v.beats.findIndex((b, i) => i >= from && b.actors.some((a) => a.gesture === gesture));
const doing = (v: Vignette, t: number): string[] => AUDIENCE.map((s) => poseOf(v, s, t)!.doing);

describe('the audience', () => {
  it('seats the @audience slots the script does not name, front row first, out in front of the stage', () => {
    const v = parseVignette(VIGNETTES.openmic!, OPEN_MARKS, [1, ...AUDIENCE]);
    // Slot 1 is b, a comic: the script's, not a seat.
    expect(v.seats.has(1)).toBe(false);
    expect([...v.seats.keys()]).toEqual(AUDIENCE);
    expect([...v.seats.values()]).toEqual(AUDIENCE.map((_, i) => i));
    const seats = AUDIENCE.map((_, i) => crowdSeat(v, i));
    for (const p of seats) {
      // Out front (toward the camera at azimuth 0), below the stage's eyeline.
      expect(p.z).toBeGreaterThan(v.centre.z + 30);
      expect(p.y).toBeLessThan(v.centre.y - 5);
    }
    // No two in one seat.
    for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) {
      expect(Math.hypot(seats[i]!.x - seats[j]!.x, seats[i]!.z - seats[j]!.z)).toBeGreaterThan(6);
    }
    // The front row is filled from the middle out: its first two seats sit either side of the middle.
    expect(Math.abs(seats[0]!.x)).toBeLessThan(15);
    expect(Math.sign(seats[0]!.x)).not.toBe(Math.sign(seats[1]!.x));
    // Rows rise as they go back.
    expect(seats[CROWD.rows[0]!.n]!.y).toBeGreaterThan(seats[0]!.y);
  });

  it('no seats without a show, and none for a slot past the cast', () => {
    expect(parseVignette('', OPEN_MARKS, AUDIENCE).seats.size).toBe(0);
    expect(poseOf(show(), 40, 10)).toBeNull();
  });

  it('watches whoever holds the stage: the comic at the mic, then the next one', () => {
    const v = show();
    for (const comic of [0, 1, 2]) {
      const b = v.beats.findIndex((beat) => beat.actors[comic]!.gesture === 'talk');
      const t = beatAt(v, b).t0 + beatAt(v, b).dur * 0.5;
      const at = poseOf(v, comic, t)!;
      for (const s of AUDIENCE) {
        const p = poseOf(v, s, t)!;
        expect(p.doing).toBe('watching');
        const tx = at.x - p.x, tz = at.z - p.z, tl = Math.hypot(tx, tz);
        // Facing the comic, within ~25°.
        expect((p.fx * tx + p.fz * tz) / (Math.hypot(p.fx, p.fz) * tl)).toBeGreaterThan(0.9);
        expect(p.lookAt).not.toBeNull();
      }
    }
  });

  it('laughs as a talk ends — not before — and a few only chuckle', () => {
    const v = show();
    const b = firstWith(v, 'talk');
    const end = beatAt(v, b).t0 + beatAt(v, b).dur;
    // Mid-joke: the room waits.
    expect(doing(v, end - 2.5).every((d) => d === 'watching')).toBe(true);
    // Just after the punchline: the room laughs.
    const laughing = doing(v, end + 0.7).filter((d) => d === 'laughing').length;
    expect(laughing).toBeGreaterThanOrEqual(AUDIENCE.length - 1);
    // Not in lockstep: at one moment the seats are at different heights in their laugh.
    const ys = AUDIENCE.map((s) => poseOf(v, s, end + 0.9)!.y - crowdSeat(v, v.seats.get(s)!).y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
    // And it dies away.
    expect(doing(v, end + CROWD.laugh * 1.4 + CROWD.late).every((d) => d === 'watching')).toBe(true);
  });

  it('applauds a bow', () => {
    const v = show();
    const b = firstWith(v, 'bow');
    const mid = beatAt(v, b).t0 + beatAt(v, b).dur * 0.55;
    expect(doing(v, mid).filter((d) => d === 'applauding').length).toBeGreaterThanOrEqual(AUDIENCE.length - 2);
  });

  it('lets a laugh\'s bubble go once per laugh, per loop; the next loop laughs the same laugh', () => {
    const v = show();
    const b = firstWith(v, 'talk');
    const end = beatAt(v, b).t0 + beatAt(v, b).dur;
    const keys = new Set<string>();
    for (const s of AUDIENCE) {
      const p = poseOf(v, s, end + 0.9)!;
      if (p.burst) keys.add(p.burst.key);
      // The next loop's laugh is the same laugh (the idle bob runs on, unlooped), with its own bubble.
      const q = poseOf(v, s, end + 0.9 + v.duration)!;
      expect(q.doing).toBe(p.doing);
      expect(q.fx).toBeCloseTo(p.fx, 6);
      expect(poseOf(v, s, end + 0.9)!.y).toBe(p.y);
      if (p.burst) { expect(q.burst!.key).not.toBe(p.burst.key); expect(q.burst!.t - p.burst.t).toBeCloseTo(v.duration, 6); }
    }
    // Most laugh out loud; one in CROWD.tough chuckles, without a bubble.
    expect(keys.size).toBeGreaterThanOrEqual(Math.floor(AUDIENCE.length * 0.6));
    expect(keys.size).toBeLessThan(AUDIENCE.length + 1);
  });
});

describe('the open mic', () => {
  it('each comic takes the mic itself — a solo mark — not a place round it', () => {
    const v = show();
    const mic = OPEN_MARKS.mic!;
    for (const comic of [0, 1, 2]) {
      const b = v.beats.findIndex((beat) => beat.actors[comic]!.gesture === 'talk');
      const at = poseOf(v, comic, beatAt(v, b).t0 + 1)!;
      expect(Math.hypot(at.x - mic.x, at.z - mic.z)).toBeLessThan(0.01);
    }
  });

  it('loops seamlessly: everyone ends where they began', () => {
    const v = show();
    for (const a of [0, 1, 2]) {
      const p0 = poseOf(v, a, 0.01)!, p1 = poseOf(v, a, v.duration - 0.01)!;
      expect(Math.hypot(p0.x - p1.x, p0.z - p1.z)).toBeLessThan(0.5);
    }
  });

  it('the club: a brick wall behind the stage, the mic stand in front of its mark, a stool; `mic` is the stand alone', () => {
    const flat = (): number => 0;
    expect(buildStageSet('none', flat)).toBeNull();
    const club = buildStageSet('club', flat)!;
    const mic = buildStageSet('mic', flat)!;
    expect(club.obstacles).toHaveLength(3);
    expect(mic.obstacles).toHaveLength(1);
    const stand = mic.obstacles[0]!;
    expect(stand.x).toBeCloseTo(OPEN_MARKS.mic!.x, 6);
    expect(stand.z).toBeCloseTo(OPEN_MARKS.mic!.z + CLUB.mic.ahead, 6);
    // The wall stands behind every stage mark.
    for (const m of Object.values(OPEN_MARKS)) expect(CLUB.wall.z).toBeLessThan(m.z - 15);
    // The mic head is at a standing comic's snout, above the stage's eyeline.
    const head = mic.group.getObjectByName('STAGE-mic-head')!;
    expect(head.position.y).toBeGreaterThan(OPEN_MARKS.mic!.y + 10);
    for (const m of club.materials) expect(m.userData.mqOwned).toBe(true);
  });
});
