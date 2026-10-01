/**
 * Plants that take the light. The garden's colour is baked into its vertices
 * (it works in flat and lit tanks alike), so until this patch a kelp beside a
 * blazing crystal looked the same as one in the dark, and a follow-spot lit
 * the floor under a plant but not the plant. Here the plants receive the same
 * light field the floor does — the crystal pools (and homes) and the three
 * follow-spots — with the same 1/(1+q) falloff and pulse, so the floor and the
 * leaf above it agree.
 *
 * Two rules from looking at it:
 *
 * - Light MULTIPLIES the plant's own colour and is capped. Added the way the
 *   floor adds it, a cyan crystal washed every plant near it cyan and the
 *   species' own hues (red whips, violet anemones) disappeared; multiplied,
 *   a red whip under cyan light is a brighter red whip.
 * - A colour pushed past 1 is scaled back whole, so it keeps its hue
 *   instead of clipping to white beside a blazing crystal.
 * - Leaves are thin: light arriving on the far side still comes through
 *   (a wrap term), so a plant between you and a crystal glows at its edges
 *   instead of going black.
 *
 * And sheen (`aMat.y`): a view-dependent, iridescent gleam — nacre on a rare
 * morph, a wet shine on tentacles and bubble algae. It is computed per vertex,
 * which at 1.7-unit cubes looks the same as per pixel and costs nothing.
 *
 * Mid and high tiers only; the low tier (and the TV) keep the baked colour.
 */

import type { Material } from 'three';
import { MAX_POOLS } from './crystal-mesh';
import { stackPatch } from './hooks';

type Uniforms = Record<string, { value: unknown }>;

export const FLORA_LIGHT_TAG = 'mq-flora-light-v1';

/** How strongly the light field lifts a plant, and the most it may (×1.6): more washed pastel species to chalk. */
export const FLORA_FEED = { gain: 1.5, cap: 0.6 } as const;

const PARS = `
  uniform int uMqPoolN;
  uniform vec4 uMqPoolPos[${MAX_POOLS}];
  uniform vec3 uMqPoolCol[${MAX_POOLS}];
  uniform float uMqPoolPhase[${MAX_POOLS}];
  uniform float uMqPoolGain;
  uniform float uMqPoolTime;
  uniform float uMqPoolPulse;
  uniform vec4 uMqSpot[3];
  uniform vec3 uMqSpotColor[3];
`;

export const FLORA_LIGHT_VERTEX = /* glsl */ `
  #include <project_vertex>
  {
    vec3 mqW = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vec3 mqN = normalize(mat3(modelMatrix) * normal);
    vec3 feed = vec3(0.0);
    for (int i = 0; i < ${MAX_POOLS}; i++) {
      if (i >= uMqPoolN) break;
      vec3 d = uMqPoolPos[i].xyz - mqW;
      float q = dot(d, d) / (uMqPoolPos[i].w * uMqPoolPos[i].w);
      float beat = 1.0 - uMqPoolPulse * 0.15 * (0.5 + 0.5 * sin(uMqPoolTime * 0.754 + uMqPoolPhase[i]));
      // Thin leaves: light on the far side still comes through.
      float wrap = 0.4 + 0.6 * max(dot(mqN, normalize(d)), 0.0);
      feed += uMqPoolCol[i] * (wrap * beat / (1.0 + q));
    }
    feed *= uMqPoolGain;
    for (int k = 0; k < 3; k++) {
      if (uMqSpot[k].w <= 0.0) continue;
      float sd = length(mqW.xz - uMqSpot[k].xy) / uMqSpot[k].z;
      feed += uMqSpotColor[k] * ((1.0 - smoothstep(0.62, 1.0, sd)) * uMqSpot[k].w * (0.35 + 0.65 * max(mqN.y, 0.0)));
    }
    // Light multiplies what the plant is, and is capped…
    vColor.rgb *= 1.0 + min(feed * ${FLORA_FEED.gain.toFixed(2)}, vec3(${FLORA_FEED.cap.toFixed(2)}));
    // …and a colour pushed past 1 is scaled back WHOLE, keeping its hue: a
    // pastel beside a blazing crystal glows brighter pink, not white.
    float mqTop = max(vColor.r, max(vColor.g, vColor.b));
    if (mqTop > 1.0) vColor.rgb /= mqTop;
    #ifdef MQ_SHEEN
    if (aMat.y > 0.0) {
      float fr = pow(1.0 - abs(dot(mqN, normalize(cameraPosition - mqW))), 2.0);
      vec3 irid = 0.5 + 0.5 * cos(6.2832 * (fr * 1.3 + aSway.y * 0.05 + vec3(0.0, 0.33, 0.67)));
      vColor.rgb += aMat.y * fr * irid * 0.55;
    }
    #endif
  }
`;

/**
 * Teach a flora material (which already declares `aSway`/`aMat` and sways) to
 * take the light field in `pools` — the tank's one stable uniform set, so a
 * re-layout never recompiles it. Returns false if it already had the patch.
 */
export function installFloraLight(material: Material, pools: Uniforms, sheen = true): boolean {
  return stackPatch(material, FLORA_LIGHT_TAG + (sheen ? '' : '-plain'), (shader) => {
    if (!shader.vertexShader.includes('#include <project_vertex>') || shader.vertexShader.includes('uMqPoolN')) return;
    for (const k of ['uMqPoolN', 'uMqPoolPos', 'uMqPoolCol', 'uMqPoolPhase', 'uMqPoolGain', 'uMqPoolTime', 'uMqPoolPulse', 'uMqSpot', 'uMqSpotColor']) {
      shader.uniforms[k] = pools[k]!;
    }
    // Sheen reads the flora's aMat; anything else (a geode) takes only the light.
    shader.vertexShader = (sheen ? '#define MQ_SHEEN\n' : '') + PARS + shader.vertexShader.replace('#include <project_vertex>', FLORA_LIGHT_VERTEX);
  });
}
