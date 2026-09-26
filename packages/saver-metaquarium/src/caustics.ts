/**
 * Caustics (the Amano study): the net of light a rippled surface throws on
 * everything under it — the floor, the rocks, the plants and the fish's backs.
 *
 * Procedural, the Amano low-tier way: two layers of animated Voronoi cells,
 * and the light is the F2 − F1 EDGE — bright, thin lines where cells meet,
 * dark cell interiors — so it reads as focused light, not as a blotchy
 * texture. Mean ≈ 1, so turning it up redistributes light instead of simply
 * brightening. It is:
 *
 * - projected down from the surface along a slightly slanted sun, so a rock's
 *   top and the floor beside it share one net;
 * - softer and weaker with depth (a floor far below the surface gets broad,
 *   dim bands; a fish near the top gets sharp ones);
 * - strongest on faces that look up, a third as strong on walls, absent
 *   underneath — the face normal comes from screen derivatives, so it works on
 *   every material, voxel or GLB, with or without normals;
 * - closed-form in t, on `t mod 1200` with every rate a whole number of
 *   cycles per window, so a TV that has been up a week stays exact.
 *
 * One module uniform (like water), set in the scene's onBeforeRender, so two
 * tanks crossfading on a page each draw with their own.
 */

import { Vector4, type Material, type Scene } from 'three';
import { stackPatch } from './hooks';

export const CAUSTICS_TAG = 'mq-caustics-v1';
/** The loop every rate divides. */
export const CAUSTIC_WINDOW = 1200;
/** (strength, cell size in world units, time mod window, surface y). */
export const CAUSTIC = { value: new Vector4(0, 12, 0, 132) };

const W = (m: number): string => ((Math.PI * 2 * m) / CAUSTIC_WINDOW).toFixed(8);

export const CAUSTIC_GLSL = /* glsl */ `
  uniform vec4 uMqCaustic;
  varying vec3 vMqCausticW;
  vec2 mqCausticHash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float mqVoronoiEdge(vec2 x, float t) {
    vec2 n = floor(x), f = fract(x);
    float f1 = 8.0, f2 = 8.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = 0.5 + 0.42 * sin(t + 6.2831 * mqCausticHash(n + g));
      vec2 r = g + o - f; float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
    return sqrt(f2) - sqrt(f1);
  }
  // Mean ~1: 0.4 + 1.25 × (two edge layers, each ~0.24 on average).
  float mqCaustic(vec3 wp, vec3 n) {
    float depth = max(0.0, uMqCaustic.w - wp.y);
    // Down a slightly slanted sun: a rock top and the floor beside it share one net.
    vec2 s = (wp.xz + vec2(0.22, 0.13) * depth) / uMqCaustic.y;
    float t = uMqCaustic.z;
    s += 0.35 * vec2(sin(s.y * 0.35 + t * ${W(134)}), cos(s.x * 0.31 - t * ${W(115)}));
    float sharp = mix(10.0, 4.0, clamp(depth / 160.0, 0.0, 1.0));
    float c = exp(-mqVoronoiEdge(s, t * ${W(172)}) * sharp);
    #if MQ_CAUSTIC_LAYERS > 1
      c += exp(-mqVoronoiEdge(s * 1.37 + 3.1, t * ${W(216)} + 1.7) * sharp);
    #else
      c *= 2.0;
    #endif
    float up = clamp(n.y, 0.0, 1.0);
    float face = n.y < -0.25 ? 0.0 : mix(0.33, 1.0, up);
    float k = uMqCaustic.x * face * exp(-depth / 260.0);
    return mix(1.0, 0.4 + 1.25 * c, k);
  }
`;

const VERTEX = /* glsl */ `
  #include <project_vertex>
  {
    vec4 mqW = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      mqW = batchingMatrix * mqW;
    #endif
    #ifdef USE_INSTANCING
      mqW = instanceMatrix * mqW;
    #endif
    vMqCausticW = (modelMatrix * mqW).xyz;
  }
`;

// On the LIT colour, just before output: the floor's light is its pools
// (added after the base colour), a fish's is its lighting — the net has to
// modulate the light, not the paint under it.
const FRAGMENT = /* glsl */ `
  if (uMqCaustic.x > 0.0) {
    vec3 mqN = normalize(cross(dFdx(vMqCausticW), dFdy(vMqCausticW)));
    if (dot(mqN, cameraPosition - vMqCausticW) < 0.0) mqN = -mqN;
    outgoingLight *= mqCaustic(vMqCausticW, mqN);
  }
  #include <opaque_fragment>
`;

/**
 * Put the caustic net on a material. Skips hand-rolled shaders and anything
 * transparent or additive (glow shells, bubbles, shafts, the water ceiling:
 * light, not surfaces). Stacks with every other patch; returns whether it
 * patched.
 */
export function patchCaustics(material: Material, layers: 1 | 2): boolean {
  const m = material as Material & { isShaderMaterial?: boolean; isPointsMaterial?: boolean; isSpriteMaterial?: boolean };
  if (m.isShaderMaterial || m.isPointsMaterial || m.isSpriteMaterial || m.transparent || m.blending !== 1) return false;
  return stackPatch(m, `${CAUSTICS_TAG}-${layers}`, (shader) => {
    if (!shader.vertexShader.includes('#include <project_vertex>') || !shader.fragmentShader.includes('#include <opaque_fragment>')) return;
    if (shader.fragmentShader.includes('mqVoronoiEdge')) return;
    shader.uniforms.uMqCaustic = CAUSTIC;
    shader.vertexShader = 'varying vec3 vMqCausticW;\n' + shader.vertexShader.replace('#include <project_vertex>', VERTEX);
    shader.fragmentShader = `#define MQ_CAUSTIC_LAYERS ${layers}\n${CAUSTIC_GLSL}\n` + shader.fragmentShader.replace('#include <opaque_fragment>', FRAGMENT);
  });
}

/** Patch every surface in the scene (cheap once patched: a tag check per material). */
export function applyCaustics(scene: Scene, layers: 1 | 2): number {
  let n = 0;
  scene.traverse((o) => {
    const mat = (o as { material?: Material | Material[] }).material;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) if (patchCaustics(m, layers)) n++;
  });
  return n;
}

// --- the JS twin, for tests ---------------------------------------------------

const fract = (x: number): number => x - Math.floor(x);
function hash2(x: number, y: number): [number, number] {
  const a = x * 127.1 + y * 311.7, b = x * 269.5 + y * 183.3;
  return [fract(Math.sin(a) * 43758.5453), fract(Math.sin(b) * 43758.5453)];
}
export function voronoiEdge(x: number, y: number, t: number): number {
  const nx = Math.floor(x), ny = Math.floor(y), fx = x - nx, fy = y - ny;
  let f1 = 8, f2 = 8;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const [hx, hy] = hash2(nx + i, ny + j);
    const ox = 0.5 + 0.42 * Math.sin(t + 6.2831 * hx), oy = 0.5 + 0.42 * Math.sin(t + 6.2831 * hy);
    const rx = i + ox - fx, ry = j + oy - fy, d = rx * rx + ry * ry;
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return Math.sqrt(f2) - Math.sqrt(f1);
}
/** The caustic factor at a point, for an upward face (the shader's `mqCaustic` with n = up). */
export function causticAt(x: number, y: number, z: number, u: { strength: number; cell: number; t: number; surface: number }, layers: 1 | 2 = 2): number {
  const depth = Math.max(0, u.surface - y);
  let sx = (x + 0.22 * depth) / u.cell, sy = (z + 0.13 * depth) / u.cell;
  const w = (m: number): number => (Math.PI * 2 * m) / CAUSTIC_WINDOW;
  const ox = 0.35 * Math.sin(sy * 0.35 + u.t * w(134)), oy = 0.35 * Math.cos(sx * 0.31 - u.t * w(115));
  sx += ox; sy += oy;
  const sharp = 10 + (4 - 10) * Math.min(1, Math.max(0, depth / 160));
  let c = Math.exp(-voronoiEdge(sx, sy, u.t * w(172)) * sharp);
  c = layers > 1 ? c + Math.exp(-voronoiEdge(sx * 1.37 + 3.1, sy * 1.37 + 3.1, u.t * w(216) + 1.7) * sharp) : c * 2;
  const k = u.strength * Math.exp(-depth / 260);
  return 1 + (0.4 + 1.25 * c - 1) * k;
}
