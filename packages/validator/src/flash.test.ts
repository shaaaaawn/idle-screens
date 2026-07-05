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
