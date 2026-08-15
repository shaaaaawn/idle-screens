import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectivePixelRatio, isSoftwareGL, probeSoftwareGL, qualityFor } from './quality';

describe('metaquarium quality tiers', () => {
  it('high tier gets the full tank', () => {
    const q = qualityFor('high');
    expect(q).toEqual({
      maxPixelRatio: 1.25,
      antialias: true,
      fishCap: 24,
      pixelBudget: 1_800_000,
      moteCap: 400,
    });
  });

  it('effectivePixelRatio enforces the pixel budget at fullscreen sizes', () => {
    const q = qualityFor('high');
    expect(effectivePixelRatio(1280, 720, 2, q)).toBeCloseTo(1.25);
    const pr = effectivePixelRatio(2560, 1440, 2, q);
    expect(2560 * pr * (1440 * pr)).toBeLessThanOrEqual(q.pixelBudget * 1.01);
    expect(pr).toBeGreaterThanOrEqual(0.5);
  });

  it('standard tier trades resolution for headroom', () => {
    const q = qualityFor('standard');
    expect(q.maxPixelRatio).toBeLessThan(1.25);
    expect(q.fishCap).toBe(16);
  });

  it('recognizes software rasterizers', () => {
    expect(isSoftwareGL('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)))')).toBe(true);
    expect(isSoftwareGL('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareGL('ANGLE Metal Renderer: Apple M1 Max')).toBe(false);
  });

  it('basic/minimal degrade hard but never block', () => {
    for (const tier of ['basic', 'minimal'] as const) {
      const q = qualityFor(tier);
      expect(q.antialias).toBe(false);
      expect(q.fishCap).toBeLessThanOrEqual(8);
    }
  });
});

describe('probeSoftwareGL', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns false when document is unavailable', () => {
    vi.stubGlobal('document', undefined);
    expect(probeSoftwareGL()).toBe(false);
  });

  it('returns false when no WebGL context can be created', () => {
    const canvas = {
      getContext: vi.fn().mockReturnValue(null),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(canvas),
    });
    expect(probeSoftwareGL()).toBe(false);
    expect(canvas.getContext).toHaveBeenCalledWith('webgl2');
  });

  it('detects SwiftShader via WEBGL_debug_renderer_info', () => {
    const UNMASKED = 0x9246;
    const gl = {
      RENDERER: 0x1f01,
      getExtension: vi.fn().mockReturnValue({ UNMASKED_RENDERER_WEBGL: UNMASKED }),
      getParameter: vi.fn((p: number) =>
        p === UNMASKED
          ? 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)))'
          : 'WebGL',
      ),
    };
    const canvas = {
      getContext: vi.fn().mockImplementation((type: string) => (type === 'webgl2' ? gl : null)),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(canvas),
    });
    expect(probeSoftwareGL()).toBe(true);
  });

  it('returns false for a hardware renderer string', () => {
    const gl = {
      RENDERER: 0x1f01,
      getExtension: vi.fn().mockReturnValue(null),
      getParameter: vi.fn().mockReturnValue('ANGLE Metal Renderer: Apple M1 Max'),
    };
    const canvas = {
      getContext: vi.fn().mockReturnValue(gl),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(canvas),
    });
    expect(probeSoftwareGL()).toBe(false);
  });
});
