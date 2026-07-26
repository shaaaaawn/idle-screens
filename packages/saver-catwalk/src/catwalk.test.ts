import { describe, it, expect } from 'vitest';
import { catwalk, catwalkManifest, demoTrack } from './index';
import { sampleTrack, defaultParams } from '@idle-screens/core';

describe('catwalk manifest + track (M1, C-integration)', () => {
  it('M1: manifest is a passthrough saver with a paramSpace and mount factory', () => {
    expect(catwalkManifest.id).toBe('catwalk');
    expect(catwalkManifest.label).toMatch(/\S/);
    expect(catwalkManifest.passthrough).toBe(true);
    expect(catwalkManifest.paramSpace).toBeTruthy();
    expect(typeof catwalk.mount).toBe('function');
    expect(catwalk.manifest).toBe(catwalkManifest);
  });

  it('declares flash safety and a canvas2d floor', () => {
    expect(catwalkManifest.a11y?.flashSafe).toBe(true);
    expect(catwalkManifest.minBackend).toBe('canvas2d');
    expect(catwalkManifest.reducedMotionFallback).toBe('static');
  });

  it('demoTrack targets the catwalk program with a seed and valid param paths', () => {
    expect(demoTrack.program).toBe('catwalk');
    expect(Number.isInteger(demoTrack.seed)).toBe(true);
    const space = catwalkManifest.paramSpace!;
    for (const d of demoTrack.deltas) {
      expect(space[d.path], `delta path "${d.path}" must exist in paramSpace`).toBeTruthy();
    }
  });

  it('sampling the demoTrack against the paramSpace is deterministic and defaults-consistent', () => {
    const space = catwalkManifest.paramSpace!;
    expect(sampleTrack(space, demoTrack, 8000)).toEqual(sampleTrack(space, demoTrack, 8000));
    const out = sampleTrack(space, demoTrack, 0);
    const defaults = defaultParams(space);
    expect(Object.keys(out).sort()).toEqual(Object.keys(defaults).sort());
  });

  it('every numeric param declares a bounded, default-in-range span', () => {
    const space = catwalkManifest.paramSpace!;
    for (const [key, def] of Object.entries(space)) {
      expect(def.type, `${key} type`).toBe('number');
      expect(typeof def.min, `${key} min`).toBe('number');
      expect(typeof def.max, `${key} max`).toBe('number');
      expect(def.min!, `${key} span`).toBeLessThan(def.max!);
      expect(def.default as number, `${key} default >= min`).toBeGreaterThanOrEqual(def.min!);
      expect(def.default as number, `${key} default <= max`).toBeLessThanOrEqual(def.max!);
    }
  });
});
