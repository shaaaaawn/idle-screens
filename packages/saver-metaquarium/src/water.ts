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

import { Vector4, type Material } from 'three';
import { stackPatch } from './hooks';

/** How much faster each channel runs out than blue, at full water. Red is
 *  gone in 40 % of the fog span, green in 70 %. */
export const WATER_RATIO: readonly [number, number, number] = [2.5, 1.45, 1];

export const WATER = { value: 0 };
/** The per-channel ratio for this tank's clarity; written by the tank each frame. */
export const RATIO = { value: [...WATER_RATIO] };
/** The sunlit in-scatter: rgb in LINEAR, w = 1 when a tint is on. Written per tank each frame. */
export const TINT = { value: new Vector4(0, 0, 0, 0) };

/**
 * Clarity (`waterClarity`, 0..1; 0.5 is the water as it has always been):
 * how selective the absorption is and how far you can see. Murky water eats
 * red and green hard and closes in; clear water loses colour gently and
 * reaches further. Exact at 0.5 — the ratio is WATER_RATIO and the reach ×1.
 */
export function clarityStrength(clarity: number): number {
  const c = Math.min(1, Math.max(0, clarity));
  return c <= 0.5 ? 1 + ((0.5 - c) / 0.5) * 0.8 : 1 - ((c - 0.5) / 0.5) * 0.75;
}
export function clarityRatio(clarity: number): [number, number, number] {
  const k = clarityStrength(clarity);
  return WATER_RATIO.map((r) => (clarity === 0.5 ? r : 1 + (r - 1) * k)) as [number, number, number];
}
export function clarityReach(clarity: number): number {
  const c = Math.min(1, Math.max(0, clarity));
  return c === 0.5 ? 1 : c < 0.5 ? 0.7 + 0.3 * (c / 0.5) : 1 + 0.5 * ((c - 0.5) / 0.5);
}

/** How much of the tint a view ray sees: all of it looking up toward the
 *  light, half on the level, none looking down into the deep. */
export function tintWeight(dirY: number): number {
  const x = Math.min(1, Math.max(0, (dirY + 0.35) / 0.7));
  return x * x * (3 - 2 * x);
}

/**
 * GLSL for the in-scatter. `mqTintWeight(dir)` mirrors `tintWeight`;
 * `mqToDisplay` is the sRGB transfer, for fog that three mixes in display
 * space (its own materials, the background dome).
 */
export const WATER_INSCATTER_GLSL = /* glsl */ `
  #ifndef MQ_WATER_INSCATTER
  #define MQ_WATER_INSCATTER
  uniform vec4 uMqTint;
  // w: 0 off, 1 on, 2 on and seen in the surface mirror — where the light's
  // real path looks UP into the lit water though the mirror camera looks down.
  float mqTintWeight(vec3 dir) {
    float y = uMqTint.w > 1.5 ? -dir.y : dir.y;
    return step(0.5, uMqTint.w) * smoothstep(-0.35, 0.35, y);
  }
  vec3 mqToDisplay(vec3 c) {
    c = max(c, vec3(0.0));
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }
  #endif
`;

/** GLSL: per-channel fog factor. Needs `uniform float uMqWater; uniform vec3 uMqWaterRatio;`. */
export const WATER_FOG_GLSL = /* glsl */ `
  ${WATER_INSCATTER_GLSL}
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
    // Toward the fog colour — or, with a tint, toward the lit water the view
    // ray looks into (display space: three mixes its fog after encoding).
    vec3 mqFogTarget = fogColor;
    if (uMqTint.w > 0.0) mqFogTarget = mix(fogColor, mqToDisplay(uMqTint.rgb), mqTintWeight(normalize(vMqWaterW - cameraPosition)));
    gl_FragColor.rgb = mix( gl_FragColor.rgb, mqFogTarget, mqWaterFog( vFogDepth, fogNear, fogFar ) );
  #endif
#endif
`;

/** The uniforms a hand-rolled shader shares to use `WATER_FOG_GLSL`. */
export function waterUniforms(): { uMqWater: typeof WATER; uMqWaterRatio: { value: number[] }; uMqTint: typeof TINT } {
  return { uMqWater: WATER, uMqWaterRatio: RATIO, uMqTint: TINT };
}

/** The world position the tinted fog needs (instancing- and batching-aware). */
const FOG_VERTEX = /* glsl */ `
  #include <fog_vertex>
  {
    vec4 mqW = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      mqW = batchingMatrix * mqW;
    #endif
    #ifdef USE_INSTANCING
      mqW = instanceMatrix * mqW;
    #endif
    vMqWaterW = (modelMatrix * mqW).xyz;
  }
`;

/** Same as the GLSL, for tests and for anything placed on the CPU. */
export function waterFog(d: number, near: number, far: number, amount: number, ratio: readonly number[] = WATER_RATIO): [number, number, number] {
  const span = Math.max(far - near, 1e-3);
  return ratio.map((r) => {
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

export const WATER_TAG = 'mq-water-v2';

export function patchWater(material: Material, dither: boolean): boolean {
  const m = material as Material & { fog?: boolean; isShaderMaterial?: boolean };
  if (m.isShaderMaterial) return false;
  setDither(m, dither);
  if (m.fog === false) return false;
  // Stacked, not assigned: the eyes and the swim wave patch the same fish
  // materials. And other parts of the tank ASSIGN a material's hook later
  // (the floor's light pools once glowing fish arrive, the eye rig when
  // eyeLife is steered on), dropping this wrap — `stackPatch` sees the tag
  // is gone from the chain and wraps again; a chain that has it is left alone.
  return stackPatch(m, WATER_TAG, (shader) => {
    if (!shader.fragmentShader.includes('#include <fog_fragment>') || !shader.vertexShader.includes('#include <fog_vertex>')) return;
    shader.uniforms.uMqWater = WATER;
    shader.uniforms.uMqWaterRatio = RATIO;
    shader.uniforms.uMqTint = TINT;
    shader.vertexShader = 'varying vec3 vMqWaterW;\n' + shader.vertexShader.replace('#include <fog_vertex>', FOG_VERTEX);
    shader.fragmentShader = 'varying vec3 vMqWaterW;\n' + shader.fragmentShader
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${WATER_FOG_GLSL}`)
      .replace('#include <fog_fragment>', FOG_FRAGMENT);
  });
}
