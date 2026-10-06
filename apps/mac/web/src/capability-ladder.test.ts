import { describe, expect, it } from 'vitest';
import type { Capabilities } from '@idle-screens/capabilities';
import { clampCapabilities, gateSavers, isBackendName } from './capability-ladder';

/** A capable desktop: everything available, no reduced motion. */
function caps(over: Partial<Capabilities> = {}): Capabilities {
  return {
    backends: { css: true, canvas2d: true, webgl2: true, webgpu: true },
    reducedMotion: false,
    ...over,
  } as Capabilities;
}

const saver = (id: string, manifest: Record<string, unknown> = {}) => ({
  manifest: { id, ...manifest },
});

const WARP = saver('warp', { minBackend: 'canvas2d', costTier: 'low' });
const TOASTERS = saver('toasters', { minBackend: 'css', costTier: 'idle' });
const METAQUARIUM = saver('metaquarium', { minBackend: 'webgl2', costTier: 'medium' });
const FLUID_GPU = saver('fluid-gpu', { minBackend: 'webgpu', costTier: 'high' });

describe('clampCapabilities', () => {
  it('is a no-op without a ceiling', () => {
    const c = caps();
    expect(clampCapabilities(c, null)).toBe(c);
  });

  it('removes backends above the ceiling and keeps those at or below', () => {
    const c = clampCapabilities(caps(), 'canvas2d');
    expect(c.backends).toMatchObject({ css: true, canvas2d: true, webgl2: false, webgpu: false });
  });

  it('never promotes a backend the device does not actually have', () => {
    // The host may claim a high ceiling; detection still wins downward.
    const c = clampCapabilities(caps({ backends: { css: true, canvas2d: true, webgl2: false, webgpu: false } }), 'webgpu');
    expect(c.backends.webgl2).toBe(false);
    expect(c.backends.webgpu).toBe(false);
  });
});

describe('gateSavers', () => {
  it('offers everything on a capable device', () => {
    const r = gateSavers([TOASTERS, WARP, METAQUARIUM, FLUID_GPU], caps());
    expect(r.playable.map((s) => s.manifest.id)).toEqual([
      'toasters',
      'warp',
      'metaquarium',
      'fluid-gpu',
    ]);
    expect(r.blocked).toEqual([]);
    expect(r.fallback).toBe(false);
  });

  it('blocks WebGL savers once the host declares a canvas2d ceiling — the Pi case', () => {
    // The whole point: V3D reports webgl2 truthfully, so only the host's
    // declared ceiling keeps metaquarium off a Raspberry Pi.
    const r = gateSavers([TOASTERS, WARP, METAQUARIUM, FLUID_GPU], clampCapabilities(caps(), 'canvas2d'));
    expect(r.playable.map((s) => s.manifest.id)).toEqual(['toasters', 'warp']);
    expect(r.blocked.map((b) => b.id)).toEqual(['metaquarium', 'fluid-gpu']);
    expect(r.blocked[0]?.reasons.join(' ')).toMatch(/webgl2/);
  });

  it('preserves the original order of the savers it keeps', () => {
    const r = gateSavers([METAQUARIUM, TOASTERS, FLUID_GPU, WARP], clampCapabilities(caps(), 'canvas2d'));
    expect(r.playable.map((s) => s.manifest.id)).toEqual(['toasters', 'warp']);
  });

  it('keeps the cheapest saver rather than returning nothing', () => {
    // A screensaver rendering badly beats one rendering nothing.
    const r = gateSavers([METAQUARIUM, FLUID_GPU], clampCapabilities(caps(), 'css'));
    expect(r.fallback).toBe(true);
    expect(r.playable).toHaveLength(1);
    expect(r.playable[0]?.manifest.id).toBe('metaquarium'); // medium < high
    expect(r.blocked.map((b) => b.id)).toEqual(['metaquarium', 'fluid-gpu']);
  });

  it('reports the tier and budget it decided on', () => {
    const full = gateSavers([WARP], caps());
    const clamped = gateSavers([WARP], clampCapabilities(caps(), 'canvas2d'));
    expect(full.tier).toBe('high');
    expect(clamped.tier).toBe('basic');
    // The budget must fall with the tier, or gating by cost means nothing.
    expect(['idle', 'low']).toContain(clamped.budget);
  });

  it('keeps a reduced-motion saver that declares a non-hide fallback', () => {
    // 'degraded' is the manifest's own accessibility intent; dropping it would
    // override that intent rather than respect it.
    const energetic = saver('warp', {
      minBackend: 'canvas2d',
      costTier: 'low',
      motionIntensity: 'energetic',
      reducedMotionFallback: 'slow',
    });
    const r = gateSavers([energetic], caps({ reducedMotion: true }));
    expect(r.playable.map((s) => s.manifest.id)).toEqual(['warp']);
  });

  it('blocks a reduced-motion saver that declares it hides', () => {
    const hides = saver('strobe', {
      minBackend: 'canvas2d',
      costTier: 'low',
      motionIntensity: 'energetic',
      reducedMotionFallback: 'hide',
    });
    const r = gateSavers([hides, WARP], caps({ reducedMotion: true }));
    expect(r.playable.map((s) => s.manifest.id)).toEqual(['warp']);
    expect(r.blocked.map((b) => b.id)).toEqual(['strobe']);
  });

  it('handles an empty list without inventing a fallback', () => {
    const r = gateSavers([], caps());
    expect(r.playable).toEqual([]);
    expect(r.fallback).toBe(false);
  });
});

describe('isBackendName', () => {
  it('accepts the four backends and rejects anything else', () => {
    for (const ok of ['css', 'canvas2d', 'webgl2', 'webgpu']) expect(isBackendName(ok)).toBe(true);
    for (const bad of ['', 'webgl', 'WEBGPU', 'metal']) expect(isBackendName(bad)).toBe(false);
  });
});
