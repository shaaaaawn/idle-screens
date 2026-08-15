import { describe, it, expect } from 'vitest';
import {
  coerceNum,
  METAQUARIUM_PARAMS,
  metaquariumManifest,
  paramSpaceWith,
  withDefaults,
} from './manifest';

describe('metaquarium manifest', () => {
  it('declares the full kit: webgl2 floor, medium cost, closed-form time, attribution', () => {
    expect(metaquariumManifest.minBackend).toBe('webgl2');
    expect(metaquariumManifest.costTier).toBe('medium');
    expect(metaquariumManifest.timeModel).toBe('closed-form');
    expect(metaquariumManifest.attribution?.source).toContain('Metaquarium');
    expect(metaquariumManifest.a11y?.flashSafe).toBe(true);
  });

  it('withDefaults overrides defaults, ignores unknown keys, keeps types', () => {
    const space = withDefaults(METAQUARIUM_PARAMS, {
      fishCount: 3,
      nonsense: 1,
    });
    expect(space.fishCount?.default).toBe(3);
    expect(space.fishCount?.type).toBe('number');
    expect(space.nonsense).toBeUndefined();
    expect(withDefaults(METAQUARIUM_PARAMS)).toBe(METAQUARIUM_PARAMS);
  });

  it('paramSpaceWith is the manifest-typed wrapper', () => {
    const space = paramSpaceWith({ swimSpeed: 1.5 });
    expect(space.swimSpeed?.default).toBe(1.5);
    expect(space.cameraAzimuth?.default).toBe(METAQUARIUM_PARAMS.cameraAzimuth.default);
  });
});

describe('coerceNum', () => {
  const def = { default: 1, min: 0.2, max: 3 };
  it('passes finite numbers and clamps to the declared range', () => {
    expect(coerceNum(def, 2)).toBe(2);
    expect(coerceNum(def, 999)).toBe(3);
    expect(coerceNum(def, -5)).toBe(0.2);
  });
  it('coerces finite numeric strings (MCP stringification)', () => {
    expect(coerceNum(def, '2.5')).toBe(2.5);
    expect(coerceNum(def, ' 2 ')).toBe(2);
  });
  it('falls back to the default on junk, and still clamps defaults', () => {
    expect(coerceNum(def, 'fast')).toBe(1);
    expect(coerceNum(def, undefined)).toBe(1);
    expect(coerceNum(def, true)).toBe(1);
    expect(coerceNum(def, Number.NaN)).toBe(1);
    expect(coerceNum({ default: 99, max: 3 }, undefined)).toBe(3);
  });
  it('survives a missing def', () => {
    expect(coerceNum(undefined, undefined)).toBe(0);
  });
});

it('coerceNum coerces a numeric-string default before the zero fallback', () => {
  expect(coerceNum({ default: '1.5', min: 0.2, max: 3 }, undefined)).toBe(1.5);
  expect(coerceNum({ default: 'junk' }, undefined)).toBe(0);
});
