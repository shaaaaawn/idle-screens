/**
 * The fish's rim: a thin edge of the water's light round a fish's silhouette.
 *
 * In dark water a dark fish is a hole — neon-abyss's navy shark on black, a
 * night village's blowfish against the fog. Under water the light that
 * reaches the eye along a fish's outline is the bright water behind and
 * above it, scattered round the edge; every polished aquarium shot has that
 * edge, and it is what separates a subject from its ground.
 *
 * A fresnel term — (1 − N·V)⁴ — added to the lit coats' outgoing light, in
 * the water's colour (the sunlit tint, the surface above, the shafts' light),
 * stronger on the top edges where the light comes down from, and dimmed with
 * a follow-spot's house lights so a spotlit stage stays dark outside the spot.
 *
 * N is not the surface normal: the fish are voxels, so their normals are per
 * face, and a fresnel on them lights every little step across the body — a
 * grid of cube edges, not an outline. It is the normal of the fish's
 * envelope instead, an ellipsoid fitted to each mesh's box (`aMqRimN`, worked
 * out once per geometry), so the band follows the silhouette whatever the
 * voxels do.
 *
 * Patched only onto materials tagged `userData.mqFish` (lit coats and plates;
 * never eyes or glow parts), the first frame `fishRim` is on. At 0 nothing is
 * installed.
 */

import { BufferAttribute, Color, Vector3, Vector4, type BufferGeometry, type Material } from 'three';
import { stackPatch } from './hooks';

const RIM_TAG = 'mq-fish-rim-v1';

/** rgb: the rim's colour × strength (linear); w unused. Written by the tank each frame. */
export const FISH_RIM = { value: new Vector4() };

const VERT_PARS = /* glsl */ `
  attribute vec3 aMqRimN;
  varying vec3 vMqRimN;
`;
const VERT = /* glsl */ `#include <beginnormal_vertex>
  // A mesh without the envelope (one added after the patch) falls back to its own normal.
  vec3 mqRn = dot(aMqRimN, aMqRimN) > 0.0 ? aMqRimN : objectNormal;
  #ifdef USE_INSTANCING
    // An instanced shoal turns each fish by its own matrix, which normalMatrix knows nothing of.
    mqRn = mat3(instanceMatrix) * mqRn;
  #endif
  vMqRimN = normalMatrix * mqRn;`;

const PARS = /* glsl */ `
  uniform vec4 uMqRim;
  varying vec3 vMqRimN;
`;

const GLSL = /* glsl */ `
  {
    vec3 mqN = normalize(vMqRimN);
    float mqF = 1.0 - clamp(dot(mqN, normalize(geometryViewDir)), 0.0, 1.0);
    // Brighter on the top edge: the light is the water above.
    vec3 mqNw = inverseTransformDirection(mqN, viewMatrix);
    float mqF2 = mqF * mqF;
    outgoingLight += uMqRim.rgb * (mqF2 * mqF2) * (0.5 + 0.5 * smoothstep(-0.3, 0.8, mqNw.y));
  }
  #include <opaque_fragment>
`;

/** Patch one fish material (true when it took the patch now). Untagged materials are left alone. */
export function patchFishRim(material: Material): boolean {
  if (!material.userData.mqFish) return false;
  return stackPatch(material, RIM_TAG, (shader) => {
    if (!shader.fragmentShader.includes('#include <opaque_fragment>') || !shader.fragmentShader.includes('#include <lights_fragment_begin>')
      || !shader.vertexShader.includes('#include <beginnormal_vertex>')) return;
    shader.uniforms.uMqRim = FISH_RIM;
    shader.vertexShader = VERT_PARS + shader.vertexShader.replace('#include <beginnormal_vertex>', VERT);
    shader.fragmentShader = PARS + shader.fragmentShader.replace('#include <opaque_fragment>', GLSL);
  });
}

const c = new Vector3(), e = new Vector3(), p = new Vector3();
/**
 * Give a geometry its envelope normal (`aMqRimN`): the normal of the
 * ellipsoid through its box, at each vertex — (p − centre) / half-extent².
 * Once per geometry (false when it already has one).
 */
export function addRimNormals(geometry: BufferGeometry): boolean {
  if (geometry.getAttribute('aMqRimN') || !geometry.getAttribute('position')) return false;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  geometry.boundingBox!.getCenter(c);
  geometry.boundingBox!.getSize(e).multiplyScalar(0.5).max(p.set(1e-3, 1e-3, 1e-3));
  const pos = geometry.getAttribute('position');
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(c);
    p.set(p.x / (e.x * e.x), p.y / (e.y * e.y), p.z / (e.z * e.z));
    if (p.lengthSq() > 0) p.normalize();
    out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z;
  }
  geometry.setAttribute('aMqRimN', new BufferAttribute(out, 3));
  return true;
}

export interface FishRimInput {
  /** The sunlit water (`waterTint`), the surface's own colour, or the shafts' — first one set wins. */
  tint: string; surface: string | null; rays: string | null;
  /** 0..1 — the follow-spot's house lights (1 = full). */
  house: number;
  /** 0..1 — `fishRim`. */
  amount: number;
}

const tmp = new Color(), white = new Color(1, 1, 1);
/** The rim's colour for this frame, into `FISH_RIM`: the water's light, lifted toward white, × amount × house. */
export function setFishRim(i: FishRimInput): void {
  tmp.set(i.tint || i.surface || i.rays || '#a8d8ff').lerp(white, 0.35);
  const k = 0.45 * Math.max(0, Math.min(1, i.amount)) * Math.max(0, Math.min(1, i.house));
  FISH_RIM.value.set(tmp.r * k, tmp.g * k, tmp.b * k, 0);
}
