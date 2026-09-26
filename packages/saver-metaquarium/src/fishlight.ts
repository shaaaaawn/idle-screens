/**
 * The fish's in-water light (the Amano study, item 10). A fish in a lit tank
 * is not lit by the room: its back takes the bright water above, its flanks
 * the water around it, its belly the floor below — and a silvered flank
 * MIRRORS all three. Our studio gives the fish a key light and a dim sky/ground
 * hemisphere, so in lit mode they read dark; this adds the water's light.
 *
 * Three colours (up, side, down), mixed by the surface normal, added to the
 * lit materials' indirect diffuse; on the plated (Standard) parts the same
 * field is also mirrored into the indirect specular, weaker, since those
 * plates already reflect the studio environment. Colours come from the
 * scene every frame — the sunlit water (`waterTint`) or the surface above,
 * the in-scatter around, the floor below — and dim with the follow-spot's
 * house lights, so a spotlit stage stays dark outside the spot.
 *
 * Patched only onto materials tagged `userData.mqFish` (coats and plates;
 * never eyes or glow parts), lazily, the first time `fishAmbient` is on.
 */

import { Color, Vector2, Vector3, type Material, type Mesh, type Object3D } from 'three';
import { stackPatch } from './hooks';

export const FISH_LIGHT_TAG = 'mq-fish-water-v1';

/** Module uniforms (linear colour), written by the tank each frame. */
export const FISH_WATER = {
  up: { value: new Vector3() },
  side: { value: new Vector3() },
  down: { value: new Vector3() },
  /** x: diffuse gain, y: specular gain. */
  k: { value: new Vector2() },
};

const GLSL = /* glsl */ `
  #include <lights_fragment_maps>
  {
    // World-space normal (geometryNormal is view space).
    vec3 mqN = inverseTransformDirection(geometryNormal, viewMatrix);
    irradiance += mqFishWaterRad(mqN) * uMqFishK.x;
    #if defined( RE_IndirectSpecular )
      vec3 mqV = inverseTransformDirection(geometryViewDir, viewMatrix);
      radiance += mqFishWaterRad(reflect(-mqV, mqN)) * uMqFishK.y;
    #endif
  }
`;

const PARS = /* glsl */ `
  uniform vec3 uMqFishUp;
  uniform vec3 uMqFishSide;
  uniform vec3 uMqFishDown;
  uniform vec2 uMqFishK;
  vec3 mqFishWaterRad(vec3 d) {
    vec3 c = mix(uMqFishSide, uMqFishUp, smoothstep(0.0, 0.9, d.y));
    return mix(c, uMqFishDown, smoothstep(0.0, -0.7, d.y));
  }
`;

/** The same field on the CPU (tests, and anything placed by hand). */
export function fishWaterRad(dirY: number, up: readonly number[], side: readonly number[], down: readonly number[]): [number, number, number] {
  const ss = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const u = ss(0, 0.9, dirY), w = ss(0, -0.7, dirY);
  return [0, 1, 2].map((i) => { const c = side[i]! + (up[i]! - side[i]!) * u; return c + (down[i]! - c) * w; }) as [number, number, number];
}

/** Teach one fish material the water's light. Only lit materials have the chunk; others are left alone. */
export function patchFishLight(material: Material): boolean {
  if (!material.userData.mqFish) return false;
  return stackPatch(material, FISH_LIGHT_TAG, (shader) => {
    if (!shader.fragmentShader.includes('#include <lights_fragment_maps>')) return;
    Object.assign(shader.uniforms, {
      uMqFishUp: FISH_WATER.up, uMqFishSide: FISH_WATER.side, uMqFishDown: FISH_WATER.down, uMqFishK: FISH_WATER.k,
    });
    shader.fragmentShader = PARS + shader.fragmentShader.replace('#include <lights_fragment_maps>', GLSL);
  });
}

export interface FishWaterInput {
  /** The sunlit water (`waterTint`), the surface's own colour, or the shafts' — first one set wins. */
  tint: string; surface: string | null; rays: string | null;
  fog: Color; floor: Color;
  /** 0..1 — `caustics`: the floor throws back more light where the net lands. */
  caustics: number;
  /** 0..1 — the follow-spot's house lights (1 = full, lower on a spotlit stage). */
  house: number;
  /** 0..1 — `fishAmbient`. */
  amount: number;
}

const tmp = new Color(), tmp2 = new Color();
/** Derive the three colours and the gains, and write them into `FISH_WATER`. */
export function setFishWater(i: FishWaterInput): void {
  const upHex = i.tint || i.surface || i.rays || '#a8d8ff';
  tmp.set(upHex);
  // Up: the light coming down through the surface — bright.
  const up = [tmp.r * 1.1, tmp.g * 1.1, tmp.b * 1.1];
  // Side: the water around — the fog lifted toward the light, never black.
  tmp2.copy(i.fog).lerp(tmp, 0.5);
  const side = [Math.max(0.04, tmp2.r * 1.6), Math.max(0.05, tmp2.g * 1.6), Math.max(0.06, tmp2.b * 1.6)];
  // Down: the floor, lit from above (more of it with caustics on).
  const bounce = 0.55 * (1 + 0.3 * i.caustics);
  const down = [i.floor.r * bounce + up[0]! * 0.08, i.floor.g * bounce + up[1]! * 0.08, i.floor.b * bounce + up[2]! * 0.08];
  const h = Math.min(1, Math.max(0, i.house));
  FISH_WATER.up.value.set(up[0]! * h, up[1]! * h, up[2]! * h);
  FISH_WATER.side.value.set(side[0]! * h, side[1]! * h, side[2]! * h);
  FISH_WATER.down.value.set(down[0]! * h, down[1]! * h, down[2]! * h);
  // Irradiance goes through BRDF_Lambert's 1/π: π·amount makes 1 read as "the fish shows its colour in this light".
  FISH_WATER.k.value.set(Math.PI * 0.85 * i.amount, 0.55 * i.amount);
}

/** Mark a fish's lit coats and plates (not eyes, not glow parts — those are
 *  their own light) as fish, for `patchFishLight`. Clones keep the mark. */
export function tagFishMaterials(root: Object3D): void {
  root.traverse((n) => {
    const mesh = n as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const lit = (m as { isMeshLambertMaterial?: boolean; isMeshStandardMaterial?: boolean }).isMeshLambertMaterial
        || (m as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial;
      if (lit && !m.userData.mqEye && !m.userData.mqNoCaustic) m.userData.mqFish = true;
    }
  });
}
