/**
 * Water, not fog. Three's fog mixes every channel toward the fog colour on
 * one smoothstep between `fogNear` and `fogFar`. Real water absorbs red
 * first, green next, blue last, so with distance a red fish goes blue-green
 * before it goes into the murk. `water` (0..1) does exactly that and nothing
 * else: each channel runs the SAME smoothstep, over a span shortened by its
 * own ratio. Blue keeps ratio 1, so its curve — and where everything finally
 * meets the background, at `fogFar` — is today's fog unchanged. At water 0
 * every ratio is 1 and the result is today's fog to the bit.
 *
 * Two ways in:
 *  - `patchWater(material)` for three's own materials: wraps (never replaces)
 *    an existing onBeforeCompile, swaps only the `fog_fragment` chunk, and
 *    extends the program cache key. Installed lazily by the tank the first
 *    time water is on, and on materials with `fog` off it does nothing.
 *  - `WATER_FOG_GLSL` for the hand-rolled shaders (crystals, glow cards),
 *    which compute their own fog: `mqWaterFog(depth, near, far)` → vec3.
 *
 * The strength lives in ONE module uniform (`WATER`). Each tank writes it at
 * the top of its frame, before it renders, so two tanks on a page (the Dev
 * Tools crossfade) each render with their own value.
 */

import type { Material } from 'three';

/** How much faster each channel runs out than blue, at full water. Red is
 *  gone in 40 % of the fog span, green in 70 %. */
export const WATER_RATIO: readonly [number, number, number] = [2.5, 1.45, 1];

export const WATER = { value: 0 };
const RATIO = { value: [...WATER_RATIO] };

/** GLSL: per-channel fog factor. Needs `uniform float uMqWater; uniform vec3 uMqWaterRatio;`. */
export const WATER_FOG_GLSL = /* glsl */ `
  uniform float uMqWater;
  uniform vec3 uMqWaterRatio;
  vec3 mqWaterFog(float d, float near, float far) {
    vec3 k = mix(vec3(1.0), uMqWaterRatio, uMqWater);
    return smoothstep(vec3(near), vec3(near) + vec3(max(far - near, 1e-3)) / k, vec3(d));
  }
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #else
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, mqWaterFog( vFogDepth, fogNear, fogFar ) );
  #endif
#endif
`;

/** The uniforms a hand-rolled shader shares to use `WATER_FOG_GLSL`. */
export function waterUniforms(): { uMqWater: typeof WATER; uMqWaterRatio: { value: number[] } } {
  return { uMqWater: WATER, uMqWaterRatio: RATIO };
}

/** Same as the GLSL, for tests and for anything placed on the CPU. */
export function waterFog(d: number, near: number, far: number, amount: number): [number, number, number] {
  const span = Math.max(far - near, 1e-3);
  return WATER_RATIO.map((r) => {
    const k = 1 + (r - 1) * amount;
    const x = Math.min(1, Math.max(0, (d - near) / (span / k)));
    return x * x * (3 - 2 * x);
  }) as [number, number, number];
}

/**
 * Teach one of three's materials the water fog. Idempotent. Returns whether
 * it patched (false for `fog: false` materials and ShaderMaterials, which do
 * their own fog). Also turns on three's output dither when `dither` is set:
 * it is the cheap cure for banding in dark fogged gradients on TV panels.
 */
/** Three's output dither on one of its own materials (±½ LSB, in the shader: free). */
export function setDither(material: Material, on: boolean): void {
  const m = material as Material & { isShaderMaterial?: boolean };
  if (m.isShaderMaterial || m.dithering === on) return;
  m.dithering = on;
  m.needsUpdate = true;
}

export function patchWater(material: Material, dither: boolean): boolean {
  const m = material as Material & { fog?: boolean; isShaderMaterial?: boolean };
  if (m.isShaderMaterial) return false;
  setDither(m, dither);
  if (m.fog === false) return false;
  // Patched, and still ours? Other parts of the tank ASSIGN a material's hook
  // later (the floor's light pools once glowing fish arrive, the eye rig when
  // eyeLife is steered on). That drops this wrap silently, so a flag alone
  // would leave the material on plain fog for good. Compare the hook itself.
  if (m.userData.mqWaterHook && m.onBeforeCompile === m.userData.mqWaterHook) return false;
  const before = m.onBeforeCompile;
  // The key the material had. Three's default is `onBeforeCompile.toString()`
  // evaluated LATE — after this wrap it would be the wrapper's own text for
  // every material, merging different patches into one program. So: the
  // material's own key function if it set one (and it is not our previous
  // wrap's), else its current hook's text.
  const ownKey = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey : null;
  const own = ownKey && ownKey !== m.userData.mqWaterKey ? ownKey : null;
  const beforeText = before.toString();
  const hook: Material['onBeforeCompile'] = (shader, renderer) => {
    before.call(m, shader, renderer);
    if (!shader.fragmentShader.includes('#include <fog_fragment>')) return;
    shader.uniforms.uMqWater = WATER;
    shader.uniforms.uMqWaterRatio = RATIO;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${WATER_FOG_GLSL}`)
      .replace('#include <fog_fragment>', FOG_FRAGMENT);
  };
  const key = (): string => `${own ? own.call(m) : beforeText}|mq-water-v1`;
  m.onBeforeCompile = hook;
  m.customProgramCacheKey = key;
  m.userData.mqWaterHook = hook;
  m.userData.mqWaterKey = key;
  m.needsUpdate = true;
  return true;
}
