import { MeshBasicMaterial, MeshLambertMaterial, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { stackPatch } from './hooks';
import { clarityRatio, clarityReach, patchWater, TINT, tintWeight, WATER, WATER_FOG_GLSL, WATER_INSCATTER_GLSL, WATER_RATIO, waterFog } from './water';
import { roomColor } from './environments';

const shader = (): { uniforms: Record<string, unknown>; fragmentShader: string; vertexShader: string } => ({
  uniforms: {}, vertexShader: 'void main(){\n#include <fog_vertex>\n}',
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
    expect(a.customProgramCacheKey()).toContain('mq-water-v2');
    expect(a.dithering).toBe(true);
  });

  it('keeps a material\'s own cache key, and leaves fog-less and hand-rolled materials alone', () => {
    const m = new MeshLambertMaterial();
    m.customProgramCacheKey = () => 'flora-v3';
    patchWater(m, false);
    expect(m.customProgramCacheKey()).toBe('flora-v3|mq-water-v2');
    expect(m.dithering).toBe(false);
    expect(patchWater(new MeshBasicMaterial({ fog: false }), false)).toBe(false);
    expect(patchWater(new ShaderMaterial(), false)).toBe(false);
  });

  it('survives a hook assigned AFTER it (floor pools, the eye rig): the next pass re-wraps the new hook', () => {
    const floor = new MeshBasicMaterial();
    patchWater(floor, false);
    // what installFloorPools does once glowing fish arrive: assign, not wrap
    let pools = 0;
    floor.onBeforeCompile = () => { pools++; };
    floor.customProgramCacheKey = () => 'mq-floor-pools-v6';
    expect(patchWater(floor, false)).toBe(true);
    const sh = shader();
    floor.onBeforeCompile(sh as never, null as never);
    expect(pools).toBe(1); //                          the pools patch still runs
    expect(sh.fragmentShader).toContain('mqWaterFog('); // and so does the water
    expect(floor.customProgramCacheKey()).toBe('mq-floor-pools-v6|mq-water-v2');
    expect(patchWater(floor, false)).toBe(false); //   and it is stable from there
  });

  it('re-wrapping a hook assigned without its own key keys on that hook, not on the old wrap', () => {
    const m = new MeshBasicMaterial();
    patchWater(m, false);
    m.onBeforeCompile = (sh) => { sh.fragmentShader += '// eyes'; };
    patchWater(m, false);
    expect(m.customProgramCacheKey()).toContain('// eyes');
    expect(m.customProgramCacheKey().match(/mq-water-v2/g)).toHaveLength(1);
  });

  it('settles beside another stacked patch re-applied every frame (the swim wave): no re-wrap, no key growth', () => {
    const m = new MeshBasicMaterial();
    let hook = m.onBeforeCompile, key = '';
    for (let frame = 0; frame < 6; frame++) {
      patchWater(m, false);
      stackPatch(m, 'mq-wave-v1', (sh) => { sh.vertexShader += '//wave'; });
      if (frame > 0) {
        expect(m.onBeforeCompile).toBe(hook);
        expect(m.customProgramCacheKey()).toBe(key);
      }
      hook = m.onBeforeCompile; key = m.customProgramCacheKey();
    }
    const sh = shader();
    m.onBeforeCompile(sh as never, null as never);
    expect(sh.fragmentShader.match(/mqWaterFog\( vFogDepth/g)).toHaveLength(1);
    expect(sh.vertexShader.endsWith('//wave')).toBe(true);
    expect(sh.vertexShader.match(/vMqWaterW = /g)).toHaveLength(1);
  });

  it('exports a GLSL function the hand-rolled shaders can share', () => {
    expect(WATER_FOG_GLSL).toMatch(/vec3 mqWaterFog\(float d, float near, float far\)/);
  });
});

describe('water clarity and tint', () => {
  it('clarity 0.5 is the water as it was, exactly', () => {
    expect(clarityRatio(0.5)).toEqual([...WATER_RATIO]);
    expect(clarityReach(0.5)).toBe(1);
    for (const d of [80, 200, 400]) expect(waterFog(d, 60, 500, 1, clarityRatio(0.5))).toEqual(waterFog(d, 60, 500, 1));
  });
  it('murky eats colour faster and closes in; clear keeps it and reaches further', () => {
    const [r0] = clarityRatio(0), [r5] = clarityRatio(0.5), [r1] = clarityRatio(1);
    expect(r0).toBeGreaterThan(r5); expect(r5).toBeGreaterThan(r1); expect(r1).toBeGreaterThan(1);
    expect(clarityRatio(1)[2]).toBe(1); // blue still meets the background at fogFar
    expect(clarityReach(0)).toBeLessThan(1); expect(clarityReach(1)).toBeGreaterThan(1);
    const red = (c: number) => waterFog(200, 60, 500, 1, clarityRatio(c))[0];
    expect(red(0)).toBeGreaterThan(red(1));
  });
  it('the tint weight: all of it looking up, half on the level, none looking down', () => {
    expect(tintWeight(1)).toBe(1); expect(tintWeight(0)).toBeCloseTo(0.5, 9); expect(tintWeight(-1)).toBe(0);
    for (let y = -1; y < 1; y += 0.05) expect(tintWeight(y + 0.05)).toBeGreaterThanOrEqual(tintWeight(y));
  });
  it('the GLSL weight mirrors the JS one and carries its own include guard', () => {
    expect(WATER_INSCATTER_GLSL).toMatch(/smoothstep\(-0\.35, 0\.35, dir\.y\)/);
    expect(WATER_INSCATTER_GLSL).toMatch(/#ifndef MQ_WATER_INSCATTER/);
    expect(WATER_FOG_GLSL).toContain('MQ_WATER_INSCATTER');
  });
  it('a patched material fogs toward the tint when it is on, and reads the world position it needs', () => {
    const m = new MeshBasicMaterial();
    patchWater(m, false);
    const sh = shader();
    m.onBeforeCompile(sh as never, null as never);
    expect(sh.uniforms.uMqTint).toBe(TINT);
    expect(sh.fragmentShader).toContain('mqTintWeight(normalize(vMqWaterW - cameraPosition))');
    expect(sh.vertexShader).toContain('vMqWaterW = (modelMatrix * mqW).xyz');
  });
});

describe('room palettes', () => {
  const base = { resolvedDefault: '#030009', manifestDefault: '#030009', tracked: false, current: '#030009' };
  it('apply where the author left the colour alone', () => {
    expect(roomColor(base, '#0a3d5c')).toBe('#0a3d5c');
  });
  it('never override an authored or a steered colour', () => {
    expect(roomColor({ ...base, resolvedDefault: '#112233', current: '#112233' }, '#0a3d5c')).toBe('#112233');
    expect(roomColor({ ...base, tracked: true, current: '#445566' }, '#0a3d5c')).toBe('#445566');
  });
  it('a room without a palette keeps the param', () => {
    expect(roomColor(base, undefined)).toBe('#030009');
  });
});
