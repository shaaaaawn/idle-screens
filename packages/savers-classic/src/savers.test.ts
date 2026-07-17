import { describe, it, expect } from 'vitest';
import { CLASSIC_SAVERS } from './index';

const EXPECTED_IDS = [
  'toasters', 'dvd', 'warp', 'fish', 'rainstorm', 'hard-rain', 'globe',
  'spotlight', 'fade-out', 'bouncing-ball', 'logo', 'messages', 'messages2',
  'pipes', 'bsod', 'flurry', 'fluid', 'reaction-diffusion', 'mystify',
];

describe('CLASSIC_SAVERS manifests (M1/M2)', () => {
  it('M2: exports exactly the expected 19 saver ids', () => {
    expect(CLASSIC_SAVERS.map((s) => s.manifest.id)).toEqual(EXPECTED_IDS);
  });

  it('M1: every manifest has a unique id and a non-empty label', () => {
    const ids = CLASSIC_SAVERS.map((s) => s.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of CLASSIC_SAVERS) {
      expect(s.manifest.id).toMatch(/\S/);
      expect(s.manifest.label).toMatch(/\S/);
      expect(typeof s.mount).toBe('function');
    }
  });

  it('M2: no classic saver collides with "black-hole"', () => {
    expect(CLASSIC_SAVERS.some((s) => s.manifest.id === 'black-hole')).toBe(false);
  });
});
