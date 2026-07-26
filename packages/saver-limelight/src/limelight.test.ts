import { describe, it, expect } from 'vitest';
import { limelight, limelightManifest, demoTrack } from './index';
import { sampleTrack, defaultParams } from '@idle-screens/core';

describe('limelight manifest + track (M1, C-integration)', () => {
  it('M1: manifest is a passthrough saver with a paramSpace and mount factory', () => {
    expect(limelightManifest.id).toBe('limelight');
    expect(limelightManifest.label).toMatch(/\S/);
    expect(limelightManifest.passthrough).toBe(true);
    expect(limelightManifest.paramSpace).toBeTruthy();
    expect(typeof limelight.mount).toBe('function');
    expect(limelight.manifest).toBe(limelightManifest);
  });

  it('declares flash safety and a canvas2d floor', () => {
    expect(limelightManifest.a11y?.flashSafe).toBe(true);
    expect(limelightManifest.minBackend).toBe('canvas2d');
    expect(limelightManifest.reducedMotionFallback).toBe('static');
  });

  it('demoTrack targets the limelight program with a seed and valid param paths', () => {
    expect(demoTrack.program).toBe('limelight');
    expect(Number.isInteger(demoTrack.seed)).toBe(true);
    const space = limelightManifest.paramSpace!;
    for (const d of demoTrack.deltas) {
      expect(space[d.path], `delta path "${d.path}" must exist in paramSpace`).toBeTruthy();
    }
  });

  it('demoTrack pins the roam to zero so a steered light is absolute', () => {
    const at = sampleTrack(limelightManifest.paramSpace!, demoTrack, 5000);
    expect(at.roamX).toBe(0);
    expect(at.roamY).toBe(0);
  });

  it('sampling the demoTrack against the paramSpace is deterministic and defaults-consistent', () => {
    const space = limelightManifest.paramSpace!;
    expect(sampleTrack(space, demoTrack, 7000)).toEqual(sampleTrack(space, demoTrack, 7000));
    const out = sampleTrack(space, demoTrack, 0);
    const defaults = defaultParams(space);
    expect(Object.keys(out).sort()).toEqual(Object.keys(defaults).sort());
  });

  it('every numeric param declares a bounded, default-in-range span', () => {
    const space = limelightManifest.paramSpace!;
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
