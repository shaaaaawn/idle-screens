import { describe, it, expect } from 'vitest';
import { tide, tideManifest, demoTrack } from './index';
import { sampleTrack, defaultParams } from '@idle-screens/core';

describe('tide manifest + track (M1, C-integration)', () => {
  it('M1: manifest is a passthrough saver with a paramSpace and mount factory', () => {
    expect(tideManifest.id).toBe('tide');
    expect(tideManifest.label).toMatch(/\S/);
    expect(tideManifest.passthrough).toBe(true);
    expect(tideManifest.paramSpace).toBeTruthy();
    expect(typeof tide.mount).toBe('function');
    expect(tide.manifest).toBe(tideManifest);
  });

  it('declares flash safety and a canvas2d floor', () => {
    expect(tideManifest.a11y?.flashSafe).toBe(true);
    expect(tideManifest.minBackend).toBe('canvas2d');
    expect(tideManifest.reducedMotionFallback).toBe('static');
  });

  it('demoTrack targets the tide program with a seed and valid param paths', () => {
    expect(demoTrack.program).toBe('tide');
    expect(Number.isInteger(demoTrack.seed)).toBe(true);
    const space = tideManifest.paramSpace!;
    for (const d of demoTrack.deltas) {
      expect(space[d.path], `delta path "${d.path}" must exist in paramSpace`).toBeTruthy();
    }
  });

  it('sampling the demoTrack against the paramSpace is deterministic and defaults-consistent', () => {
    const space = tideManifest.paramSpace!;
    expect(sampleTrack(space, demoTrack, 5000)).toEqual(sampleTrack(space, demoTrack, 5000));
    const out = sampleTrack(space, demoTrack, 0);
    const defaults = defaultParams(space);
    expect(Object.keys(out).sort()).toEqual(Object.keys(defaults).sort());
  });

  it('every numeric param declares a bounded, default-in-range span', () => {
    const space = tideManifest.paramSpace!;
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
