import { describe, expect, it } from 'vitest';
import { INTERIOR_MARKS, OPEN_MARKS, parseVignette, poseOf, VIGNETTES } from './vignette';

/**
 * The shipped presets, pinned: every actor's pose every half second across a
 * loop, rounded and hashed. A change to the parser or the poser that moves a
 * preset by a hundredth of a unit fails here — the presets are live scenes.
 */
const marksFor = (name: string): typeof OPEN_MARKS => (name === 'duet' || name === 'trio' || name === 'openmic' ? OPEN_MARKS : INTERIOR_MARKS);

function digest(name: string): string {
  const v = parseVignette(VIGNETTES[name]!, marksFor(name));
  let h = 2166136261;
  const mix = (s: string): void => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; };
  for (let a = 0; a < v.actors; a++) {
    for (let t = 0; t <= v.duration; t += 0.5) {
      const p = poseOf(v, a, t)!;
      mix([p.x, p.y, p.z, p.fx, p.fy, p.fz, p.roll].map((n) => n.toFixed(2)).join(',') + p.doing);
    }
  }
  return `${v.duration.toFixed(3)}:${h.toString(16)}`;
}

describe('vignette presets', () => {
  it('play exactly as they always have', () => {
    expect(Object.fromEntries(Object.keys(VIGNETTES).map((n) => [n, digest(n)]))).toEqual(GOLDEN);
  });
});

const GOLDEN: Record<string, string> = {
  bedtime: '63.253:72384a13',
  duet: '53.000:5e4a0262',
  openmic: '88.000:1badf75a',
  seek: '109.783:fc0279a4',
  tea: '97.185:bdc03515',
  trio: '61.000:f9628336',
};
