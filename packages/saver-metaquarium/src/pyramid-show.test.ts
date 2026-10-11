import { analyzeFlashes, type FlashSample } from '@idle-screens/validator';
import { describe, expect, it } from 'vitest';
import {
  BEAT_LIFT, lampLevel, MAX_BPM, pyramidGlowLevel, parsePyramidShow, PYRAMID_SHOWS, SHOW_FADE, SHOW_GLSL, SHOW_HOLD, showLamp, showState, showTime, smallShow,
  type ShowPlan,
} from './pyramid-show';

/** Lamps on a pyramid of `top` layers: every face, every height, the edges and the middles. */
function lampsOf(top: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let y = 0; y <= top; y++) {
    const w = top - y;
    for (const along of [0, Math.floor(w / 2), w]) {
      out.push([w, y, along], [-w, y, -along], [along, y, w], [-along, y, -w]);
    }
  }
  return out;
}

/**
 * The lamps' light over time through the validator's WCAG 2.3.1 rule, every
 * lamp a tile — and every lamp judged as if it filled the frame (`areaThreshold`
 * 0: one flashing lamp fails), far stricter than the small part of a frame a
 * lamp is.
 */
function flashes(plan: ShowPlan, bpm: number, top: number, seconds: number, from = 0): ReturnType<typeof analyzeFlashes> {
  const lamps = lampsOf(top), samples: FlashSample[] = [];
  for (let t = from; t < from + seconds; t += 1 / 60) {
    samples.push({ t: (t - from) * 1000, lum: lamps.map(([x, y, z]) => lampLevel(plan, bpm, 0.37, 0.61, x, y, z, top, t)) });
  }
  return analyzeFlashes(samples, { areaThreshold: 1e-9 });
}

describe('pyramid shows: a light show, never a strobe', () => {
  for (const [i, name] of PYRAMID_SHOWS.entries()) {
    it(`${name}: no lamp flashes, free or on the fastest beat, large or small`, () => {
      const plan = parsePyramidShow(name).plan;
      for (const bpm of [0, MAX_BPM]) for (const top of [4, 14]) {
        const r = flashes(plan, bpm, top, 40);
        expect(r.general.worstTileFlashesPerSecond, `${name} bpm ${bpm} top ${top}`).toBeLessThanOrEqual(3);
        expect(r.passes, `${name} bpm ${bpm} top ${top}`).toBe(true);
      }
      expect(i).toBeGreaterThanOrEqual(0);
    });
  }

  it('through the field\'s sequence and every crossfade, and solo, over ten minutes', () => {
    for (const plan of [parsePyramidShow('auto').plan, parsePyramidShow('solo').plan]) {
      for (const bpm of [0, 128]) {
        const r = flashes(plan, bpm, 10, 600);
        expect(r.general.worstTileFlashesPerSecond, `${plan.mode} bpm ${bpm}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it('a beat lifts the lamps by less than a flash needs (10%), and steps the motion: move half a beat, hold half', () => {
    expect(BEAT_LIFT).toBeLessThan(0.1);
    const a = showTime(10, 120), b = showTime(10.26, 120), c = showTime(10.49, 120);
    expect(b.t).toBeCloseTo(c.t, 9); // held through the second half of the beat
    expect(a.t).toBeLessThan(b.t);
    expect(showTime(10, 0)).toEqual({ t: 10, lift: 0 });
    expect(showTime(10, 400).t).toBeCloseTo(showTime(10, MAX_BPM).t, 9);
  });
});

describe('pyramid shows: the light on the floor', () => {
  it('rises and falls with the show, and is itself flash-safe at the fastest beat', () => {
    for (const p of [0, 3, 5, 9]) {
      const samples: FlashSample[] = [];
      let lo = 1, hi = 0;
      for (let t = 0; t < 30; t += 1 / 60) {
        const k = pyramidGlowLevel({ a: p, b: p, mix: 0 }, MAX_BPM, 0.2, 0.4, 12, t);
        lo = Math.min(lo, k); hi = Math.max(hi, k);
        samples.push({ t: t * 1000, lum: [k] });
      }
      expect(hi - lo, PYRAMID_SHOWS[p]).toBeGreaterThan(0.02);
      expect(analyzeFlashes(samples, { areaThreshold: 1e-9 }).passes, PYRAMID_SHOWS[p]).toBe(true);
    }
  });
});

describe('pyramid shows: the field\'s choreography', () => {
  it('auto plays every routine in turn, held, then crossfaded', () => {
    const plan = parsePyramidShow('').plan;
    const seen = new Set<number>();
    for (let t = 0; t < SHOW_HOLD * PYRAMID_SHOWS.length; t += 1) seen.add(showState(plan, t).a);
    expect(seen.size).toBe(PYRAMID_SHOWS.length);
    expect(showState(plan, 5).mix).toBe(0);
    expect(showState(plan, SHOW_HOLD - SHOW_FADE / 2).mix).toBeGreaterThan(0);
    expect(showState(plan, SHOW_HOLD - 0.001).mix).toBeCloseTo(1, 2);
  });

  it('a cue sheet loops through its cues; a routine\'s name holds it; solo hands each its own', () => {
    const { plan, problems } = parsePyramidShow('8s:rings, 6s:beam, 10s:equalizer');
    expect(problems).toEqual([]);
    expect([1, 9, 15, 25].map((t) => showState(plan, t).a)).toEqual([0, 1, 3, 0]);
    expect(showState(plan, 7.9).mix).toBeGreaterThan(0);
    expect(showState(parsePyramidShow('twinkle').plan, 1234).a).toBe(PYRAMID_SHOWS.indexOf('twinkle'));
    expect(showState(parsePyramidShow('solo').plan, 3).a).toBe(-1);
    expect(parsePyramidShow('8s:strobe, 1s:rings').problems).toHaveLength(2);
  });

  it('a small pyramid runs what reads on a few cubes; a big one keeps its outline in a dark phase', () => {
    expect([1, 3, 7, 8].map((p) => smallShow(p, 4))).toEqual([6, 9, 5, 0]);
    expect(smallShow(3, 12)).toBe(3);
    // The rain's dark gaps: a big one's edge lamp never goes fully out.
    const plan = parsePyramidShow('rain').plan;
    for (let t = 0; t < 30; t += 0.3) expect(lampLevel(plan, 0, 0, 0.3, 10, 2, 10, 12, t)).toBeGreaterThanOrEqual(0.16);
  });

  it('the GLSL copy carries the same table as the JS one', () => {
    for (const k of ['0.25', '0.14', '0.16', '1.3', '0.7', '1.1', '0.9', '0.35', '0.2', '0.3', '2.00']) expect(SHOW_GLSL).toContain(k);
    // Every routine has a branch.
    expect((SHOW_GLSL.match(/if \(p < /g) ?? []).length).toBe(PYRAMID_SHOWS.length - 1);
    expect(showLamp(0, 0, 0, 0, 0, 0, 10, 0, 0)[0]).toBeGreaterThan(0.99); // the ring's crest at the base at t 0
  });
});
