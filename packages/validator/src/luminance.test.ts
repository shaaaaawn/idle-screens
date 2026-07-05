import { describe, it, expect } from 'vitest';
import { srgbToLinear, relativeLuminance, redness, tileStatsFromImageData } from './luminance';

describe('srgbToLinear', () => {
  it('maps endpoints 0->0 and 255->1', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBeCloseTo(1, 6);
  });
  it('is monotonic and below the linear line in the mid-range (gamma)', () => {
    expect(srgbToLinear(128)).toBeLessThan(128 / 255);
    expect(srgbToLinear(200)).toBeGreaterThan(srgbToLinear(100));
  });
});

describe('relativeLuminance (WCAG)', () => {
  it('white = 1, black = 0', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 6);
    expect(relativeLuminance(0, 0, 0)).toBe(0);
  });
  it('weights green > red > blue', () => {
    const rL = relativeLuminance(255, 0, 0);
    const gL = relativeLuminance(0, 255, 0);
    const bL = relativeLuminance(0, 0, 255);
    expect(gL).toBeGreaterThan(rL);
    expect(rL).toBeGreaterThan(bL);
    expect(gL).toBeCloseTo(0.7152, 4);
    expect(rL).toBeCloseTo(0.2126, 4);
    expect(bL).toBeCloseTo(0.0722, 4);
  });
});

describe('redness (approximate)', () => {
  it('pure red = 1, white/blue/black = 0', () => {
    expect(redness(255, 0, 0)).toBe(1);
    expect(redness(255, 255, 255)).toBe(0);
    expect(redness(0, 0, 255)).toBe(0);
    expect(redness(0, 0, 0)).toBe(0);
  });
  it('scales with red dominance', () => {
    expect(redness(200, 50, 50)).toBeCloseTo(150 / 255, 5);
  });
});

describe('tileStatsFromImageData', () => {
  it('produces one luminance + redness per pixel (tile)', () => {
    // 2x1 image: white pixel, red pixel.
    const img = { width: 2, height: 1, data: [255, 255, 255, 255, 255, 0, 0, 255] };
    const { lum, red } = tileStatsFromImageData(img);
    expect(lum).toHaveLength(2);
    expect(lum[0]).toBeCloseTo(1, 5);
    expect(lum[1]).toBeCloseTo(0.2126, 4);
    expect(red[0]).toBe(0);
    expect(red[1]).toBe(1);
  });
});
