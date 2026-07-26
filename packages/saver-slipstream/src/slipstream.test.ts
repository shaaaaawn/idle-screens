import { describe, it, expect } from 'vitest';
import { slipstream, slipstreamManifest, demoTrack } from './index';
import { sampleTrack, defaultParams } from '@idle-screens/core';

describe('slipstream manifest + track (M1, C-integration)', () => {
  it('M1: manifest is a passthrough saver with a paramSpace and mount factory', () => {
    expect(slipstreamManifest.id).toBe('slipstream');
    expect(slipstreamManifest.label).toMatch(/\S/);
    expect(slipstreamManifest.passthrough).toBe(true);
    expect(slipstreamManifest.paramSpace).toBeTruthy();
    expect(typeof slipstream.mount).toBe('function');
    expect(slipstream.manifest).toBe(slipstreamManifest);
  });

  it('declares flash safety and a canvas2d floor', () => {
    expect(slipstreamManifest.a11y?.flashSafe).toBe(true);
    expect(slipstreamManifest.minBackend).toBe('canvas2d');
    expect(slipstreamManifest.reducedMotionFallback).toBe('static');
  });

  it('demoTrack targets the slipstream program with a seed and valid param paths', () => {
    expect(demoTrack.program).toBe('slipstream');
    expect(Number.isInteger(demoTrack.seed)).toBe(true);
    const space = slipstreamManifest.paramSpace!;
    for (const d of demoTrack.deltas) {
      expect(space[d.path], `delta path "${d.path}" must exist in paramSpace`).toBeTruthy();
    }
  });

  it('demoTrack pins veer to zero so a steered wind vane is absolute', () => {
    const at = sampleTrack(slipstreamManifest.paramSpace!, demoTrack, 9000);
    expect(at.veer).toBe(0);
  });

  it('sampling the demoTrack against the paramSpace is deterministic and defaults-consistent', () => {
    const space = slipstreamManifest.paramSpace!;
    expect(sampleTrack(space, demoTrack, 11000)).toEqual(sampleTrack(space, demoTrack, 11000));
    const out = sampleTrack(space, demoTrack, 0);
    const defaults = defaultParams(space);
    expect(Object.keys(out).sort()).toEqual(Object.keys(defaults).sort());
  });

  it('every numeric param declares a bounded, default-in-range span', () => {
    const space = slipstreamManifest.paramSpace!;
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
