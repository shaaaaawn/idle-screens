/**
 * The fade-in (`fishFadeIn`): a fish that arrives dissolves into the water
 * instead of popping into it.
 *
 * Fish load over the network, a few seconds into a scene and one by one, and
 * each appears whole the frame its mesh lands. This eases it in over a
 * fraction of a second with the same ordered dither the near fade uses, so
 * the fish stays opaque (no sorting).
 *
 * Each fish is dressed in materials of its own (materials.ts makes them per
 * body), so each fish carries its own amount: one uniform object per fish,
 * bound into its materials when they are patched, set by the tank each frame.
 * When a fish arrived is network time, as the pop always was; once it is in,
 * the frame is a function of t again.
 */

import type { Material, Mesh, Object3D } from 'three';
import { stackPatch } from './hooks';

const TAG = 'mq-spawn-fade';

/** One fish's fade: 0..1, how much of it is there. */
export interface SpawnUniform { value: number }

/** How far into its fade-in a fish is, `since` seconds after it arrived: 0..1 (smootherstep); 1 with no fade or before it arrived. */
export function spawnAmount(since: number, fadeIn: number): number {
  if (!(fadeIn > 0) || since < 0 || since >= fadeIn) return 1;
  const u = since / fadeIn;
  return u * u * u * (u * (u * 6 - 15) + 10);
}

const FRAG_PARS = /* glsl */ `
uniform float uMqSpawn;
float mqSpawnB2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float mqSpawnB4(vec2 p) { return mqSpawnB2(0.5 * p) * 0.25 + mqSpawnB2(p) + 1.0 / 32.0; }
`;
const FRAG = /* glsl */ `#include <clipping_planes_fragment>
  if (uMqSpawn < 1.0 && mqSpawnB4(gl_FragCoord.xy) >= uMqSpawn) discard;`;

/** Patch one material with `fade` (true when it took the patch now). Shader materials without the built-in chunk are left alone. */
export function patchSpawnFade(material: Material, fade: SpawnUniform): boolean {
  return stackPatch(material, TAG, (shader) => {
    if (!shader.fragmentShader.includes('#include <clipping_planes_fragment>')) return;
    shader.uniforms.uMqSpawn = fade;
    shader.fragmentShader = FRAG_PARS + shader.fragmentShader.replace('#include <clipping_planes_fragment>', FRAG);
  });
}

/** Bind one fish's materials (every mesh under `root`) to its fade. Idempotent. */
export function rigSpawnFade(root: Object3D, fade: SpawnUniform): void {
  root.traverse((n) => {
    const mesh = n as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) patchSpawnFade(m, fade);
  });
}
