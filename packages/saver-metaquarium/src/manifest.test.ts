import { describe, it, expect } from 'vitest';
import {
  METAQUARIUM_PARAMS,
  metaquariumManifest,
  paramSpaceWith,
  withDefaults,
} from './manifest';

describe('metaquarium manifest', () => {
  it('declares the full kit: webgl2 floor, medium cost, closed-form time, attribution', () => {
    expect(metaquariumManifest.minBackend).toBe('webgl2');
    // capabilities blocks costTier 'high' on every non-WebGPU device — the
    // tank must stay 'medium' and scale quality internally instead.
    expect(metaquariumManifest.costTier).toBe('medium');
    expect(metaquariumManifest.timeModel).toBe('closed-form');
    expect(metaquariumManifest.attribution?.source).toContain('Metaquarium');
    expect(metaquariumManifest.a11y?.flashSafe).toBe(true);
  });

  it('withDefaults overrides defaults, ignores unknown keys, keeps types', () => {
    const space = withDefaults(METAQUARIUM_PARAMS, {
      fishCount: 3,
      farmUrl: '/farm/y2k/stream/cache',
      nonsense: 1,
    });
    expect(space.fishCount?.default).toBe(3);
    expect(space.fishCount?.type).toBe('number');
    expect(space.farmUrl?.default).toBe('/farm/y2k/stream/cache');
    expect(space.nonsense).toBeUndefined();
    // No overrides → same object back.
    expect(withDefaults(METAQUARIUM_PARAMS)).toBe(METAQUARIUM_PARAMS);
  });

  it('paramSpaceWith is the manifest-typed wrapper', () => {
    const space = paramSpaceWith({ bloomStrength: 0.45 });
    expect(space.bloomStrength?.default).toBe(0.45);
    expect(space.cameraAzimuth?.default).toBe(METAQUARIUM_PARAMS.cameraAzimuth.default);
  });
});
