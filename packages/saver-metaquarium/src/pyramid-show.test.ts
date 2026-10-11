import { analyzeFlashes, redness, relativeLuminance, type FlashSample } from '@idle-screens/validator';
import { Color } from 'three';
import { PYRAMID_MATERIALS } from './pyramid-mix';
import { describe, expect, it } from 'vitest';
import {
  BEAT_LIFT, lampColor, lampLevel, lampLightIn, MAX_BPM, pyramidGlowLevel, soloState, parsePyramidShow, PYRAMID_SHOWS, SHOW_FADE, SHOW_GLSL, SHOW_HOLD, showLamp, showState, showTime, smallShow,
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

/** A stone's palette, linear, as the shader has it (three's Color takes the hex as sRGB). */
const paletteOf = (stone: 'led' | 'neon'): { main: number[]; acc: number[]; cap: number[] } => {
  const [main, , acc, cap] = PYRAMID_MATERIALS[stone].pal.map((h) => new Color(h).toArray());
  return { main: main!, acc: acc!, cap: cap! };
};
/** Linear 0..1 → the display's sRGB 8-bit, which is what the validator reads. */
const toSrgb8 = (c: number): number => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * The colour viewers see — hue, palette, gain, the display's clamp — through the validator's WCAG rule, luminance and
 * redness both, every lamp a tile judged as if it filled the frame. Lit faces at full (top) shade, the brightest.
 */
function displayedFlashes(plan: ShowPlan, bpm: number, top: number, seconds: number, stone: 'led' | 'neon'): ReturnType<typeof analyzeFlashes> {
  const lamps = lampsOf(top), samples: FlashSample[] = [], pal = paletteOf(stone), led = stone === 'led' ? 1 : 2;
  for (let t = 0; t < seconds; t += 1 / 30) {
    const lum: number[] = [], red: number[] = [];
    for (const [x, y, z] of lamps) {
      const st = plan.mode === 'solo' ? soloState(0.61, t) : showState(plan, t);
      const [level, hueA, hueB, mix] = lampLightIn(plan.mode === 'solo' ? { a: -1, b: -1, mix: 0 } : st, bpm, 0.37, 0.61, x, y, z, top, t);
      const [r, g, b] = lampColor(level, hueA, led, pal, 1, hueB, mix).map(toSrgb8) as [number, number, number];
      lum.push(relativeLuminance(r, g, b)); red.push(redness(r, g, b));
    }
    samples.push({ t: t * 1000, lum, red });
  }
  return analyzeFlashes(samples, { areaThreshold: 1e-9 });
}

/**
 * The lamps' light over time through the validator's WCAG 2.3.1 rule, every
 * lamp a tile — and every lamp judged as if it filled the frame (`areaThreshold`
 * 0: one flashing lamp fails), far stricter than the small part of a frame a
 * lamp is.
 */
function flashes(plan: ShowPlan, bpm: number, top: number, seconds: number, from = 0): ReturnType<typeof analyzeFlashes> {
  const lamps = lampsOf(top), samples: FlashSample[] = [];
  // 30 samples a second: more than twice the fastest change here (a beat at 140 bpm is 2.33 Hz), so no flash slips between.
  for (let t = from; t < from + seconds; t += 1 / 30) {
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
    }, 60_000);
  }

  it('through the field\'s sequence — every routine and every crossfade — and solo, for five minutes', () => {
    // 11 routines × 24 s is 264 s: five minutes covers the whole sequence and its crossfades.
    for (const plan of [parsePyramidShow('auto').plan, parsePyramidShow('solo').plan]) {
      for (const bpm of [0, 128]) {
        const r = flashes(plan, bpm, 10, 300);
        expect(r.general.worstTileFlashesPerSecond, `${plan.mode} bpm ${bpm}`).toBeLessThanOrEqual(3);
      }
    }
  }, 120_000);

  it('a beat lifts the lamps by less than a flash needs (10%), and steps the motion: move half a beat, hold half', () => {
    expect(BEAT_LIFT).toBeLessThan(0.1);
    const a = showTime(10, 120), b = showTime(10.26, 120), c = showTime(10.49, 120);
    expect(b.t).toBeCloseTo(c.t, 9); // held through the second half of the beat
    expect(a.t).toBeLessThan(b.t);
    expect(showTime(10, 0)).toEqual({ t: 10, lift: 0 });
    expect(showTime(10, 400).t).toBeCloseTo(showTime(10, MAX_BPM).t, 9);
  });
});

describe('pyramid shows: the colour a viewer sees', () => {
  it('no lamp flashes in luminance or in red — led and neon, every routine, at the fastest beat, large and small', () => {
    for (const stone of ['led', 'neon'] as const) for (const name of PYRAMID_SHOWS) for (const top of [4, 14]) {
      const r = displayedFlashes(parsePyramidShow(name).plan, MAX_BPM, top, 20, stone);
      expect(r.general.worstTileFlashesPerSecond, `${stone} ${name} top ${top}`).toBeLessThanOrEqual(3);
      expect(r.red.worstTileFlashesPerSecond, `${stone} ${name} top ${top} red`).toBeLessThanOrEqual(3);
      expect(r.passes, `${stone} ${name} top ${top}`).toBe(true);
    }
  }, 120_000);

  it('through the whole sequence and its crossfades, and solo, in the colour shown', () => {
    for (const stone of ['led', 'neon'] as const) for (const plan of [parsePyramidShow('auto').plan, parsePyramidShow('solo').plan]) {
      expect(displayedFlashes(plan, 128, 10, 280, stone).passes, `${stone} ${plan.mode}`).toBe(true);
    }
  }, 120_000);

  it('crossfades colours, not hues: halfway between two hues a full turn apart, the colour is their blend, not a third', () => {
    const pal = paletteOf('led');
    // Hue 0.25 and hue 5.25 are the same colour: their blend is that colour, whatever the mix.
    for (const mix of [0, 0.3, 0.5, 0.9]) expect(lampColor(0.8, 0.25, 1, pal, 1, 5.25, mix)).toEqual(lampColor(0.8, 0.25, 1, pal));
  });

  it('the colour model is the shader\'s: a dark lamp is the housing, a full one runs toward white, neon between its tubes', () => {
    const pal = paletteOf('led');
    expect(lampColor(0, 0.3, 1, pal).map((c, i) => c / (pal.main[i]! * 1.6 || 1))).toEqual([1, 1, 1]);
    // Full red: its own channel clamps at 1, the others lifted toward white by the peak (0.2 → 0.48 of the tone).
    const full = lampColor(1, 0, 1, pal);
    expect(full[0]).toBe(1);
    expect(Math.min(full[1], full[2])).toBeGreaterThan(0.8);
    const neon = paletteOf('neon');
    const tubeA = lampColor(0.5, 0.75, 2, neon), tubeB = lampColor(0.5, 0.25, 2, neon);
    expect(tubeA[0]).toBeGreaterThan(tubeA[1]); // toward the magenta tube
    expect(tubeB[2]).toBeGreaterThan(tubeB[0]); // toward the cyan
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
  }, 60_000);
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
