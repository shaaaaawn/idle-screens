/**
 * The near fade: a creature that comes too close to the camera dissolves
 * instead of slicing through the lens.
 *
 * The camera never avoids the cast. A turtle cruising past the orbit, a
 * snail the follow camera rides up against, a blowfish nosing the glass:
 * each one fills a third of the screen, cut flat by the near plane. Games
 * fade what crowds the lens; this does it the way they do, with a screen-door
 * dissolve (an ordered 4×4 dither, discarded per pixel by its depth), so the
 * fish stays opaque — no sorting, no transparency pass — and a frame is still
 * a function of t.
 *
 * Patched onto every built-in material on the cast the first frame
 * `nearFade` goes above 0 (hooks.ts stacks it with the other patches); at 0
 * nothing is installed, so the tank draws exactly as before.
 */

import type { Material } from 'three';
import { Vector2 } from 'three';
import { stackPatch } from './hooks';

const NEAR_FADE_TAG = 'mq-near-fade';

/** (gone, whole): view depths at which a fragment is fully dissolved, and fully there. Shared by every patched material. */
export const NEAR_FADE = { value: new Vector2(0, 0) };

/**
 * The fade's depths for `nearFade` (0..1): at 1 a fragment is whole beyond
 * 22 units (about a fish and a half) and gone inside 8; lower values pull
 * both in toward the lens. 0 → (0, 0): nothing fades.
 *
 * `follow`: the follow camera's distance, when it has a subject. The subject
 * is the shot, so it never fades — the whole range stays inside 0.55 of the
 * way to it (its nearest parts, a snail's eyes on stalks, stand out toward
 * the lens by a third of that). In the fish's own eye (under ~16) it is hidden anyway.
 */
export function nearFadeRange(amount: number, follow: number | null = null): [gone: number, whole: number] {
  if (!(amount > 0)) return [0, 0];
  let whole = 6 + 16 * Math.min(1, amount);
  if (follow !== null && follow > 0) whole = Math.min(whole, 0.55 * follow);
  return [whole * 0.36, whole];
}

const VERT_PARS = 'varying float vMqNearDepth;\n';
const VERT = '#include <project_vertex>\n  vMqNearDepth = -mvPosition.z;';
const FRAG_PARS = /* glsl */ `
uniform vec2 uMqNearFade;
varying float vMqNearDepth;
// The 4x4 ordered-dither threshold, 0..15/16 (+1/32 to sit mid-step): bayer2 nested in itself. bayer4() below is its twin.
float mqBayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float mqBayer4(vec2 p) { return mqBayer2(0.5 * p) * 0.25 + mqBayer2(p) + 1.0 / 32.0; }
`;
const FRAG = /* glsl */ `#include <clipping_planes_fragment>
  if (uMqNearFade.y > 0.0) {
    float mqNearK = smoothstep(uMqNearFade.x, uMqNearFade.y, vMqNearDepth);
    if (mqNearK < 1.0 && mqBayer4(gl_FragCoord.xy) >= mqNearK) discard;
  }`;

const fract = (x: number): number => x - Math.floor(x);
const bayer2 = (x: number, y: number): number => { x = Math.floor(x); y = Math.floor(y); return fract(x / 2 + y * y * 0.75); };
/** The shader's dither threshold at pixel (x, y), for tests: the 16 cells of a 4×4 tile take 16 distinct steps. */
export function bayer4(x: number, y: number): number { return bayer2(0.5 * x, 0.5 * y) * 0.25 + bayer2(x, y) + 1 / 32; }

/** Patch one material (true when it took the patch now). Shader materials without the built-in chunks are left alone. */
export function patchNearFade(material: Material): boolean {
  return stackPatch(material, NEAR_FADE_TAG, (shader) => {
    if (!shader.vertexShader.includes('#include <project_vertex>') || !shader.fragmentShader.includes('#include <clipping_planes_fragment>')) return;
    shader.uniforms.uMqNearFade = NEAR_FADE;
    shader.vertexShader = VERT_PARS + shader.vertexShader.replace('#include <project_vertex>', VERT);
    shader.fragmentShader = FRAG_PARS + shader.fragmentShader.replace('#include <clipping_planes_fragment>', FRAG);
  });
}
