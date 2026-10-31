/**
 * The floor's detail (`floorDetail`): a seabed, not a coloured plane.
 *
 * The floor is one colour (the flat disc) or one colour shaded by its hills
 * (the terrain), so a room without plants or a floor cover is a flat plane of
 * maroon, grey or blue — snail-garden, pyramids, the citadel — and where the
 * fog reaches past it (citadel's fogFar is 1000; the disc ends at 600) its rim
 * is a hard line against the background.
 *
 *   ripples   sand the current has combed: long low ridges, bent by a slow
 *             warp so they never run ruler-straight
 *   sediment  broad patches a little lighter and darker (silt, algae, shell
 *             grit), and a fine grain under them
 *   rim       the floor's last stretch fades into the fog's colour, which is
 *             the background's, so the edge is gone
 *
 * World-space and closed-form (a frame is still a function of t), faded with
 * distance so far ripples do not shimmer. Patched onto the floor disc and the
 * terrain the first frame `floorDetail` is on; at 0 nothing is installed.
 */

import type { Material } from 'three';
import { stackPatch } from './hooks';

const TAG = 'mq-floor-detail';

/** 0..1, `floorDetail`. Shared by the disc and the terrain. */
export const FLOOR_DETAIL = { value: 0 };

/** Where the floor stops (disc 600, terrain 620): the rim fades over the last stretch before it. */
export const FLOOR_RIM: readonly [number, number] = [430, 590];

const VERT_PARS = 'varying vec3 vMqFloorW;\n';
const VERT = '#include <project_vertex>\n  vMqFloorW = (modelMatrix * vec4(transformed, 1.0)).xyz;';

const FRAG_PARS = /* glsl */ `
uniform float uMqFloorDetail;
varying vec3 vMqFloorW;
float mqFdHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mqFdNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mqFdHash(i), mqFdHash(i + vec2(1.0, 0.0)), u.x), mix(mqFdHash(i + vec2(0.0, 1.0)), mqFdHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// The seabed's shade at p (around 1): ripples, sediment patches and grain, fading with distance d.
float mqFloorShade(vec2 p, float d) {
  float near = 1.0 - smoothstep(140.0, 420.0, d);
  vec2 w = p + 9.0 * vec2(mqFdNoise(p * 0.011), mqFdNoise(p * 0.011 + 7.3));
  float ripple = sin(dot(w, vec2(0.26, 0.17)) + 1.7 * mqFdNoise(p * 0.03));
  float patches = mqFdNoise(p * 0.018) * 0.6 + mqFdNoise(p * 0.05) * 0.4;
  float grain = mqFdHash(floor(p * 1.6));
  return 1.0 + 0.11 * ripple * near + 0.18 * (patches - 0.5) + 0.06 * (grain - 0.5) * near;
}
`;
const FRAG_COLOR = /* glsl */ `#include <color_fragment>
  if (uMqFloorDetail > 0.0) {
    float mqD = distance(vMqFloorW, cameraPosition);
    diffuseColor.rgb *= mix(1.0, mqFloorShade(vMqFloorW.xz, mqD), uMqFloorDetail);
  }`;
const FRAG_RIM = /* glsl */ `#include <fog_fragment>
  #ifdef USE_FOG
    if (uMqFloorDetail > 0.0) {
      float mqRim = smoothstep(${FLOOR_RIM[0].toFixed(1)}, ${FLOOR_RIM[1].toFixed(1)}, length(vMqFloorW.xz));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, mqRim * uMqFloorDetail);
    }
  #endif`;

/** Patch a floor material (the disc or the terrain): true when it took the patch now. */
export function patchFloorDetail(material: Material): boolean {
  return stackPatch(material, TAG, (shader) => {
    if (!shader.vertexShader.includes('#include <project_vertex>') || !shader.fragmentShader.includes('#include <color_fragment>')) return;
    shader.uniforms.uMqFloorDetail = FLOOR_DETAIL;
    shader.vertexShader = VERT_PARS + shader.vertexShader.replace('#include <project_vertex>', VERT);
    shader.fragmentShader = FRAG_PARS + shader.fragmentShader
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <fog_fragment>', FRAG_RIM);
  });
}

const fract = (x: number): number => x - Math.floor(x);
const hash = (x: number, y: number): number => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
const noise = (x: number, y: number): number => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
};
const smooth = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** The shader's shade at (x, z), seen from `d` away — its CPU twin, for tests. */
export function floorShade(x: number, z: number, d: number): number {
  const near = 1 - smooth(140, 420, d);
  const wx = x + 9 * noise(x * 0.011, z * 0.011), wz = z + 9 * noise(x * 0.011 + 7.3, z * 0.011 + 7.3);
  const ripple = Math.sin(wx * 0.26 + wz * 0.17 + 1.7 * noise(x * 0.03, z * 0.03));
  const patches = noise(x * 0.018, z * 0.018) * 0.6 + noise(x * 0.05, z * 0.05) * 0.4;
  const grain = hash(Math.floor(x * 1.6), Math.floor(z * 1.6));
  return 1 + 0.11 * ripple * near + 0.18 * (patches - 0.5) + 0.06 * (grain - 0.5) * near;
}
