import { describe, it, expect } from 'vitest';
import { analyzeFlashes, type FlashSample } from './flash';

const FPS = 60;
const SECONDS = 3;

/** Build per-tile samples; `lumAt(frame,tile)` returns relative luminance 0..1. */
function makeSamples(
  tiles: number,
  lumAt: (frame: number, tile: number) => number,
  redAt?: (frame: number, tile: number) => number,
): FlashSample[] {
  const frames = FPS * SECONDS;
  const dt = 1000 / FPS;
  const out: FlashSample[] = [];
  for (let f = 0; f < frames; f++) {
    const lum = new Array<number>(tiles);
    for (let tile = 0; tile < tiles; tile++) lum[tile] = lumAt(f, tile);
    const s: FlashSample = { t: f * dt, lum };
    if (redAt) {
      const red = new Array<number>(tiles);
      for (let tile = 0; tile < tiles; tile++) red[tile] = redAt(f, tile);
      s.red = red;
    }
    out.push(s);
  }
  return out;
}

/** Square wave at `hz` Hz between `high` and `low`. */
const square = (hz: number, high: number, low: number) => (f: number): number => {
  const halfFrames = FPS / (2 * hz);
  return Math.floor(f / halfFrames) % 2 === 0 ? high : low;
};

describe('analyzeFlashes — general flash (WCAG 2.3.1)', () => {
  it('steady content passes with zero flashes', () => {
    const r = analyzeFlashes(makeSamples(64, () => 0.5));
    expect(r.passes).toBe(true);
    expect(r.general.worstTileFlashesPerSecond).toBe(0);
    expect(r.general.flashingAreaFraction).toBe(0);
  });

  // The boundary oracle: 3 flashes/sec is allowed, 4 is not.
  it('3 Hz full-field black<->white PASSES (exactly 3 flashes/sec)', () => {
    const r = analyzeFlashes(makeSamples(64, square(3, 1, 0)));
    expect(r.general.worstTileFlashesPerSecond).toBe(3);
    expect(r.general.fails).toBe(false);
    expect(r.passes).toBe(true);
  });

  it('4 Hz full-field black<->white FAILS', () => {
    const r = analyzeFlashes(makeSamples(64, square(4, 1, 0)));
    expect(r.general.worstTileFlashesPerSecond).toBe(4);
    expect(r.general.fails).toBe(true);
    expect(r.passes).toBe(false);
  });

  it('catches the peak-sensitivity 15 Hz strobe', () => {
    const r = analyzeFlashes(makeSamples(64, square(15, 1, 0)));
    expect(r.general.worstTileFlashesPerSecond).toBeGreaterThan(3);
    expect(r.passes).toBe(false);
  });

  it('a bright flash where the darker level is >= 0.80 does NOT count (dark guard)', () => {
    // swing 0.15 (>= 0.10) but darker = 0.85 (>= 0.80) -> not a flash at any frequency
    const r = analyzeFlashes(makeSamples(64, square(10, 1.0, 0.85)));
    expect(r.general.worstTileFlashesPerSecond).toBe(0);
    expect(r.passes).toBe(true);
  });

  // Audit 2026-11-18 #3: the first move was measured from the first sample only,
  // so a strobe whose first frame sat between its two levels read as 0 flashes.
  it('catches a strobe whose first sample sits mid-swing (10 Hz, 0.21 <-> 0.39, starting at 0.30)', () => {
    const wave = square(10, 0.39, 0.21);
    const r = analyzeFlashes(makeSamples(64, (f) => (f === 0 ? 0.3 : wave(f))));
    expect(r.general.worstTileFlashesPerSecond).toBe(10);
    expect(r.passes).toBe(false);
    // The same wave starting on a peak: the two must agree.
    expect(analyzeFlashes(makeSamples(64, wave)).general.worstTileFlashesPerSecond).toBe(10);
  });

  it('mid-swing start still respects the area and dark guards', () => {
    // Darker level 0.85: never a flash, wherever it starts.
    const bright = square(10, 1.0, 0.85);
    expect(analyzeFlashes(makeSamples(64, (f) => (f === 0 ? 0.92 : bright(f)))).passes).toBe(true);
    // Swing 0.08 around a 0.5 start: below threshold either way.
    const small = square(10, 0.54, 0.46);
    expect(analyzeFlashes(makeSamples(64, (f) => (f === 0 ? 0.5 : small(f)))).general.worstTileFlashesPerSecond).toBe(0);
  });

  it('a slow drift then a reversal counts the same as before (one rise, one fall)', () => {
    // 0.5 -> 0.62 (a rise of 0.12), then -> 0.45 (a fall of 0.17): two transitions, one flash.
    const series = [0.5, 0.56, 0.62, 0.45];
    const r = analyzeFlashes(series.map((v, i) => ({ t: i * 100, lum: [v] })));
    expect(r.general.worstTileFlashesPerSecond).toBe(1);
  });

  it('a swing below 0.10 does NOT count', () => {
    const r = analyzeFlashes(makeSamples(64, square(10, 0.5, 0.45)));
    expect(r.general.worstTileFlashesPerSecond).toBe(0);
    expect(r.passes).toBe(true);
  });
});

describe('analyzeFlashes — localized strobe + area threshold (the anti-masking case)', () => {
  // A 10 Hz strobe in a fraction of tiles; whole-frame AVERAGING would mask this,
  // per-tile analysis catches it once the flashing AREA is large enough.
  const strobeFraction = (frac: number) => (f: number, tile: number): number =>
    tile < Math.round(64 * frac) ? square(10, 1, 0)(f) : 0.5;

  it('a strobe over 10% of the frame passes (below the 25% area threshold)', () => {
    const r = analyzeFlashes(makeSamples(64, strobeFraction(0.1)));
    expect(r.general.worstTileFlashesPerSecond).toBeGreaterThan(3); // the tiles DO strobe
    expect(r.general.flashingAreaFraction).toBeLessThan(0.25); // ...over a small area
    expect(r.passes).toBe(true); // ...too small to be dangerous (area exemption)
  });

  it('a strobe over 30% of the frame FAILS (above the area threshold)', () => {
    const r = analyzeFlashes(makeSamples(64, strobeFraction(0.3)));
    expect(r.general.flashingAreaFraction).toBeGreaterThanOrEqual(0.25);
    expect(r.general.fails).toBe(true);
    expect(r.passes).toBe(false);
  });
});

describe('analyzeFlashes — approximate red flash', () => {
  it('a saturated-red strobe flags the (approximate) red channel while luminance is steady', () => {
    const r = analyzeFlashes(
      makeSamples(
        64,
        () => 0.5, // steady luminance -> general passes
        square(10, 0.8, 0), // red strobes
      ),
    );
    expect(r.general.fails).toBe(false);
    expect(r.red.fails).toBe(true);
    expect(r.red.approximate).toBe(true);
    expect(r.passes).toBe(false);
  });
});

describe('analyzeFlashes — edge inputs', () => {
  it('passes an empty sample list instead of throwing', () => {
    expect(() => analyzeFlashes([])).not.toThrow();
    expect(analyzeFlashes([]).passes).toBe(true);
  });

  it('does not fail a static clip when areaThreshold is 0', () => {
    const still = Array.from({ length: 30 }, (_, i) => ({ t: i * 33, lum: [0.5, 0.5, 0.5, 0.5], red: [0, 0, 0, 0] }));
    const r = analyzeFlashes(still, { areaThreshold: 0 });
    expect(r.general.fails).toBe(false);
    expect(r.passes).toBe(true);
  });
});
