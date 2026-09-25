import { MeshBasicMaterial, MeshLambertMaterial, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { patchWater, WATER, WATER_FOG_GLSL, WATER_RATIO, waterFog } from './water';

const shader = (): { uniforms: Record<string, unknown>; fragmentShader: string; vertexShader: string } => ({
  uniforms: {}, vertexShader: '',
  fragmentShader: '#include <fog_pars_fragment>\nvoid main(){\n#include <fog_fragment>\n}',
});

describe('water', () => {
  it('at water 0 is today\'s fog exactly, on every channel', () => {
    for (const d of [0, 59, 60, 120, 300, 499, 500, 900]) {
      const s = Math.min(1, Math.max(0, (d - 60) / 440)), old = s * s * (3 - 2 * s);
      for (const c of waterFog(d, 60, 500, 0)) expect(c).toBeCloseTo(old, 12);
    }
  });

  it('red goes first, green next, blue keeps today\'s curve and meets the background at fogFar', () => {
    const mid = waterFog(200, 60, 500, 1);
    expect(mid[0]).toBeGreaterThan(mid[1]);
    expect(mid[1]).toBeGreaterThan(mid[2]);
    const s = (200 - 60) / 440;
    expect(mid[2]).toBeCloseTo(s * s * (3 - 2 * s), 12);
    expect(waterFog(500, 60, 500, 1)).toEqual([1, 1, 1]);
    expect(waterFog(59, 60, 500, 1)).toEqual([0, 0, 0]); // nothing changes before fogNear
    expect(WATER_RATIO[2]).toBe(1);
  });

  it('patches three\'s fog chunk only, wraps an existing hook, and keeps distinct programs distinct', () => {
    const a = new MeshBasicMaterial(), b = new MeshBasicMaterial(), c = new MeshBasicMaterial();
    let ran = 0;
    b.onBeforeCompile = () => { ran++; };
    c.onBeforeCompile = (sh) => { sh.fragmentShader += '\n// c'; };
    for (const m of [a, b, c]) expect(patchWater(m, true)).toBe(true);
    expect(patchWater(a, true)).toBe(false); // idempotent
    const sh = shader();
    b.onBeforeCompile(sh as never, null as never);
    expect(ran).toBe(1); //                   the old hook still runs
    expect(sh.fragmentShader).toContain('mqWaterFog( vFogDepth, fogNear, fogFar )');
    expect(sh.fragmentShader).not.toContain('#include <fog_fragment>');
    expect(sh.uniforms.uMqWater).toBe(WATER);
    // b and c had different hooks: they must not share a program after patching.
    expect(b.customProgramCacheKey()).not.toBe(c.customProgramCacheKey());
    expect(a.customProgramCacheKey()).toContain('mq-water-v1');
    expect(a.dithering).toBe(true);
  });

  it('keeps a material\'s own cache key, and leaves fog-less and hand-rolled materials alone', () => {
    const m = new MeshLambertMaterial();
    m.customProgramCacheKey = () => 'flora-v3';
    patchWater(m, false);
    expect(m.customProgramCacheKey()).toBe('flora-v3|mq-water-v1');
    expect(m.dithering).toBe(false);
    expect(patchWater(new MeshBasicMaterial({ fog: false }), false)).toBe(false);
    expect(patchWater(new ShaderMaterial(), false)).toBe(false);
  });

  it('exports a GLSL function the hand-rolled shaders can share', () => {
    expect(WATER_FOG_GLSL).toMatch(/vec3 mqWaterFog\(float d, float near, float far\)/);
  });
});
