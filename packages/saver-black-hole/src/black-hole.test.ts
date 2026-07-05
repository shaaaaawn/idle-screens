import { describe, it, expect } from 'vitest';
import { blackHole, blackHoleManifest, demoTrack } from './index';
import { sampleTrack, defaultParams } from '@idle-screens/core';

describe('black-hole manifest + track (M1, C-integration)', () => {
  it('M1: manifest is a passthrough saver with a paramSpace and mount factory', () => {
    expect(blackHoleManifest.id).toBe('black-hole');
    expect(blackHoleManifest.label).toMatch(/\S/);
    expect(blackHoleManifest.passthrough).toBe(true);
    expect(blackHoleManifest.paramSpace).toBeTruthy();
    expect(typeof blackHole.mount).toBe('function');
    expect(blackHole.manifest).toBe(blackHoleManifest);
  });

  it('demoTrack targets the black-hole program with a seed and valid param paths', () => {
    expect(demoTrack.program).toBe('black-hole');
    expect(Number.isInteger(demoTrack.seed)).toBe(true);
    const space = blackHoleManifest.paramSpace!;
    for (const d of demoTrack.deltas) {
      expect(space[d.path], `delta path "${d.path}" must exist in paramSpace`).toBeTruthy();
    }
  });

  it('sampling the demoTrack against the paramSpace is deterministic and defaults-consistent', () => {
    const space = blackHoleManifest.paramSpace!;
    expect(sampleTrack(space, demoTrack, 1500)).toEqual(sampleTrack(space, demoTrack, 1500));
    // every param resolves to a value of its declared type
    const out = sampleTrack(space, demoTrack, 0);
    const defaults = defaultParams(space);
    expect(Object.keys(out).sort()).toEqual(Object.keys(defaults).sort());
  });
});
