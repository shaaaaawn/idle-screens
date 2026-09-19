/**
 * The three.js half of crystals: instanced shards, their halo, one glow card
 * per cluster, and the light pools they throw on the floor.
 *
 * Draw-call budget for ANY number of clusters: one per shard variant (≤3),
 * the same again for halos, one for every glow card. Nothing here allocates
 * per frame — `setFrame` writes a handful of uniforms.
 *
 * No scene lights. The tank's identity is unlit (overhaul plan §9); crystals
 * shade themselves from their own facet normals, and "light" reaching the
 * floor is the closed-form field in `crystals.ts` mirrored as a shader loop.
 */

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
  type IUniform,
  type Material,
} from 'three';
import { MAX_CLUSTERS, type Cluster, type Emitter, type ShardGeometry } from './crystals';

/** Floor-pool slots: every cluster, plus the glowing fish nearest the floor. */
export const MAX_POOLS = MAX_CLUSTERS + 6;

const FOG_PARS = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
`;

const SHARD_VERT = /* glsl */ `
  attribute vec3 aSmooth;
  attribute vec3 aColor;
  attribute vec2 aLook; // x: 0 glow / 1 glass, y: pulse phase
  uniform float uPush;
  varying vec3 vColor;
  varying vec2 vLook;
  varying vec3 vN;
  varying vec3 vW;
  varying float vH;
  varying float vDepth;
  void main() {
    vec3 p = position + aSmooth * uPush;
    vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
    // Instances scale (near-)uniformly — the 4:1 aspect is in the geometry and
    // only spires thin it further — so the upper 3x3 is close enough for facet
    // shading without paying for an inverse-transpose per vertex.
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vW = w.xyz;
    vH = position.y;
    vColor = aColor;
    vLook = aLook;
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const SHARD_FRAG = /* glsl */ `
  ${FOG_PARS}
  uniform float uTime;
  uniform float uGlow;
  uniform float uPulse;
  varying vec3 vColor;
  varying vec2 vLook;
  varying vec3 vN;
  varying vec3 vW;
  varying float vH;
  varying float vDepth;
  void main() {
    // The camera orbits INSIDE the crystal ring at close distances, so a
    // cluster will pass the lens. Dissolve it (ordered dither, still opaque —
    // no sorting, no blending) instead of letting it wall off the tank.
    float keep = smoothstep(22.0, 70.0, vDepth);
    vec2 cell = floor(mod(gl_FragCoord.xy, 4.0));
    float bayer = fract(dot(cell, vec2(0.25, 0.5)) + cell.x * cell.y * 0.125) ;
    if (keep < 1.0 && bayer >= keep) discard;
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    float fres = pow(1.0 - abs(dot(n, v)), 2.5);
    // Same fixed key as the terrain bake, so crystal and hill agree on where
    // "up-left" is without a light in the scene.
    float key = max(0.0, dot(n, normalize(vec3(-0.45, 0.78, -0.43))));
    // A per-facet offset keyed on the facet's own normal: two faces that
    // catch the key equally still separate, which is what reads as "cut".
    float facet = fract(sin(dot(n, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float shade = 0.46 + 0.5 * key + (facet - 0.5) * 0.36;
    float beat = 1.0 - uPulse * 0.15 * (0.5 + 0.5 * sin(uTime * 0.754 + vLook.y));
    // Emissive without HDR: white-hot at the root, saturated at the tip.
    float hot = (1.0 - vH) * (1.0 - vH) * 0.9 * (0.55 + 0.45 * key);
    vec3 glow = mix(vColor, vec3(1.0), hot) * shade * (0.85 + 0.4 * fres) * beat * (0.5 + 0.5 * uGlow);
    // Glass: a dark body that only shows where it grazes the eye — facets
    // flare one at a time as the camera orbits.
    float rim = fres * fres;
    vec3 glass = vColor * (0.03 + 0.07 * shade) + vColor * rim * 1.7
      + vec3(smoothstep(0.62, 0.95, facet) * rim * 1.4 + pow(fres, 6.0));
    vec3 col = mix(glow, glass, vLook.x);
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
    #include <colorspace_fragment>
  }
`;

const HALO_FRAG = /* glsl */ `
  ${FOG_PARS}
  uniform float uTime;
  uniform float uGlow;
  uniform float uPulse;
  varying vec3 vColor;
  varying vec2 vLook;
  varying float vDepth;
  void main() {
    float beat = 1.0 - uPulse * 0.15 * (0.5 + 0.5 * sin(uTime * 0.754 + vLook.y));
    float fog = smoothstep(uFogNear, uFogFar, vDepth) ;
    fog = max(fog, 1.0 - smoothstep(22.0, 70.0, vDepth));
    // Additive, so fog FADES it rather than mixing toward the fog colour.
    gl_FragColor = vec4(vColor * 0.11 * uGlow * beat * (1.0 - vLook.x) * (1.0 - fog), 1.0);
    #include <colorspace_fragment>
  }
`;

const CARD_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute vec2 aLook;
  varying vec3 vColor;
  varying vec2 vLook;
  varying vec2 vUv;
  uniform float uLift;
  varying float vDepth;
  void main() {
    // Billboard: take the instance's translation and uniform scale, spend
    // the quad's own xy in VIEW space so the card always faces the lens.
    vec4 c = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float s = length(instanceMatrix[0].xyz);
    c.xy += position.xy * s;
    // Lifted toward the lens by a fraction of its size, a depth-tested card
    // clears the body it surrounds — so the glow spills OVER the fish, the
    // way bloom does — while anything genuinely nearer still occludes it.
    c.z += s * uLift;
    vUv = position.xy * 2.0;
    vColor = aColor;
    vLook = aLook;
    vDepth = -c.z;
    gl_Position = projectionMatrix * c;
  }
`;

const CARD_FRAG = /* glsl */ `
  ${FOG_PARS}
  uniform float uTime;
  uniform float uGlow;
  uniform float uPulse;
  varying vec3 vColor;
  varying vec2 vLook;
  uniform vec2 uNear;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    float d = length(vUv);
    if (d > 1.0) discard;
    float fall = (1.0 - d) * (1.0 - d);
    float beat = 1.0 - uPulse * 0.15 * (0.5 + 0.5 * sin(uTime * 0.754 + vLook.y));
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    // Pale palettes (ice) would sum to a white-out where cards overlap, and a
    // cluster the camera orbits past would fill the lens: normalise by the
    // colour's own brightness and let the card die away up close.
    float lum = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
    float near = smoothstep(uNear.x, uNear.y, vDepth);
    gl_FragColor = vec4(vColor * fall * sqrt(fall) * (0.3 / (0.55 + 1.6 * lum)) * uGlow * beat * near
      * (1.0 - 0.75 * vLook.x) * (1.0 - fog), 1.0);
    #include <colorspace_fragment>
  }
`;

type Uniforms = Record<string, IUniform>;

export interface CrystalField {
  group: Group;
  /** Shared by the floor patch — the same emitters the fish sample. */
  poolUniforms: Uniforms;
  drawCalls: number;
  triangles: number;
  setFrame(tSec: number, glow: number, pulse: number, fog: { color: Color; near: number; far: number }): void;
}

function shardBufferGeometry(g: ShardGeometry): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(g.positions, 3));
  geo.setAttribute('normal', new BufferAttribute(g.normals, 3));
  geo.setAttribute('aSmooth', new BufferAttribute(g.smooth, 3));
  geo.userData.mqOwned = true;
  return geo;
}

function owned<T extends Material>(m: T): T {
  m.userData.mqOwned = true;
  return m;
}

/**
 * Build every cluster into one group. `halo` is the tier's call: the shell
 * doubles the shard draw calls, so the weakest tier goes without.
 */
export function buildCrystalField(
  clusters: readonly Cluster[],
  variants: readonly ShardGeometry[],
  emitters: readonly Emitter[],
  opts: { halo: boolean },
  poolUniforms: Uniforms,
): CrystalField {
  const group = new Group();
  const shared: Uniforms = {
    uTime: { value: 0 },
    uGlow: { value: 1 },
    uPulse: { value: 0 },
    uFogColor: { value: new Color() },
    uFogNear: { value: 60 },
    uFogFar: { value: 500 },
  };
  const shardMat = owned(new ShaderMaterial({
    uniforms: { ...shared, uPush: { value: 0 } },
    vertexShader: SHARD_VERT,
    fragmentShader: SHARD_FRAG,
  }));
  const haloMat = owned(new ShaderMaterial({
    // Push is in SHARD units (length 1), so the shell is proportional to each
    // shard — the model-proportional rule the fish halos learned the hard way.
    uniforms: { ...shared, uPush: { value: 0.045 } },
    vertexShader: SHARD_VERT,
    fragmentShader: HALO_FRAG,
    side: BackSide,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  }));

  const m = new Matrix4();
  const q = new Quaternion();
  const roll = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const axis = new Vector3();
  const pos = new Vector3();
  const scl = new Vector3();
  const col = new Color();
  const accent = new Color();
  let drawCalls = 0;
  let triangles = 0;

  variants.forEach((variant, vi) => {
    const list: Array<{ c: Cluster; s: Cluster['shards'][number] }> = [];
    for (const c of clusters) for (const s of c.shards) if (s.variant === vi) list.push({ c, s });
    if (!list.length) return;
    const geo = shardBufferGeometry(variant);
    const colors = new Float32Array(list.length * 3);
    const looks = new Float32Array(list.length * 2);
    const mesh = new InstancedMesh(geo, shardMat, list.length);
    list.forEach(({ c, s }, i) => {
      axis.set(s.ax, s.ay, s.az);
      q.setFromUnitVectors(up, axis);
      roll.setFromAxisAngle(up, s.roll);
      q.multiply(roll);
      pos.set(c.x + s.x, c.y + s.y, c.z + s.z);
      scl.set(s.length * s.girth, s.length, s.length * s.girth);
      mesh.setMatrixAt(i, m.compose(pos, q, scl));
      // Two-tone: a shard drifts toward the cluster's accent by its tone and
      // varies in brightness, so no two shards are the same paint.
      col.set(c.color).lerp(accent.set(c.accent), Math.max(0, s.tone) * 0.55);
      const gain = 1 + 0.16 * s.tone;
      colors.set([col.r * gain, col.g * gain, col.b * gain], i * 3);
      looks.set([c.glass ? 1 : 0, c.phase], i * 2);
    });
    geo.setAttribute('aColor', new InstancedBufferAttribute(colors, 3));
    geo.setAttribute('aLook', new InstancedBufferAttribute(looks, 2));
    mesh.frustumCulled = false;
    group.add(mesh);
    drawCalls += 1;
    triangles += variant.triangles * list.length;
    if (opts.halo) {
      const halo = new InstancedMesh(geo, haloMat, list.length);
      halo.instanceMatrix = mesh.instanceMatrix;
      halo.frustumCulled = false;
      halo.renderOrder = 2;
      group.add(halo);
      drawCalls += 1;
    }
  });

  // One glow card per cluster: the wide bloom a thin shell cannot give.
  if (clusters.length) {
    const quad = new PlaneGeometry(1, 1);
    quad.userData.mqOwned = true;
    const cardMat = owned(new ShaderMaterial({
      // A cluster the camera orbits past would fill the lens: fade 45→150.
      uniforms: { ...shared, uLift: { value: 0 }, uNear: { value: new Vector2(45, 150) } },
      vertexShader: CARD_VERT,
      fragmentShader: CARD_FRAG,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      // A card is a flat quad standing in a 3D floor: depth-tested, the floor
      // slices it along a hard horizontal line. It is light, not an object.
      depthTest: false,
    }));
    const cards = new InstancedMesh(quad, cardMat, clusters.length);
    const colors = new Float32Array(clusters.length * 3);
    const looks = new Float32Array(clusters.length * 2);
    clusters.forEach((c, i) => {
      pos.set(c.x, c.y + c.height * 0.4, c.z);
      // Sized to where the falloff is still visible: every pixel past that is
      // additive overdraw that adds nothing (8 clusters cost 13 fps at 2.6).
      scl.setScalar(Math.max(c.radius, c.height) * 1.9);
      cards.setMatrixAt(i, m.compose(pos, q.identity(), scl));
      col.set(c.color);
      colors.set([col.r, col.g, col.b], i * 3);
      looks.set([c.glass ? 1 : 0, c.phase], i * 2);
    });
    quad.setAttribute('aColor', new InstancedBufferAttribute(colors, 3));
    quad.setAttribute('aLook', new InstancedBufferAttribute(looks, 2));
    cards.frustumCulled = false;
    cards.renderOrder = 3;
    group.add(cards);
    drawCalls += 1;
  }

  // Floor pools: the emitters, written into the tank's one stable uniform
  // set so a re-layout never forces the floor program to recompile.
  fillPoolUniforms(poolUniforms, emitters);

  return {
    group,
    poolUniforms,
    drawCalls,
    triangles,
    setFrame(tSec, glow, pulse, fog) {
      shared.uTime!.value = tSec;
      shared.uGlow!.value = glow;
      shared.uPulse!.value = pulse;
      (shared.uFogColor!.value as Color).copy(fog.color);
      shared.uFogNear!.value = fog.near;
      shared.uFogFar!.value = fog.far;
      poolUniforms.uMqPoolGain!.value = 0.4 * glow;
      poolUniforms.uMqPoolTime!.value = tSec;
      poolUniforms.uMqPoolPulse!.value = pulse;
    },
  };
}

/** Uniforms for a floor with no crystals — the patched shader adds zero. */
export function emptyPoolUniforms(): Uniforms {
  return {
    uMqPoolN: { value: 0 },
    uMqPoolPos: { value: new Float32Array(MAX_POOLS * 4) },
    uMqPoolCol: { value: new Float32Array(MAX_POOLS * 3) },
    uMqPoolPhase: { value: new Float32Array(MAX_POOLS) },
    uMqPoolGain: { value: 0 },
    uMqPoolTime: { value: 0 },
    uMqPoolPulse: { value: 0 },
  };
}

/** Write emitters into slots [from, from + n). Returns the slot after the last. */
export function writePoolSlots(u: Uniforms, emitters: readonly Emitter[], from: number): number {
  const pos4 = u.uMqPoolPos!.value as Float32Array;
  const col3 = u.uMqPoolCol!.value as Float32Array;
  const phases = u.uMqPoolPhase!.value as Float32Array;
  let i = from;
  for (const e of emitters) {
    if (i >= MAX_POOLS) break;
    const k = 1 / (0.55 + 1.6 * (0.2126 * e.r + 0.7152 * e.g + 0.0722 * e.b));
    pos4.set([e.x, e.y, e.z, e.reach * 0.55], i * 4);
    col3.set([e.r * k, e.g * k, e.b * k], i * 3);
    phases[i] = e.phase;
    i += 1;
  }
  u.uMqPoolN!.value = i;
  return i;
}

export function fillPoolUniforms(u: Uniforms, emitters: readonly Emitter[]): void {
  writePoolSlots(u, emitters, 0);
}

/**
 * Teach a floor material to receive the light field. Installed LAZILY — only
 * once a scene actually grows crystals — so a tank without props compiles the
 * stock MeshBasicMaterial program, byte for byte what it always did.
 *
 * `pools` is the tank's one stable uniform set: a re-layout rewrites its
 * arrays in place, so no recompile follows.
 */
export function installFloorPools(mat: Material, pools: Uniforms): void {
  if (mat.userData.mqPools) return;
  mat.userData.mqPools = true;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, pools);
    shader.vertexShader = `varying vec3 vMqW;\n${shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n\tvMqW = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    )}`;
    shader.fragmentShader = `
      varying vec3 vMqW;
      uniform int uMqPoolN;
      uniform vec4 uMqPoolPos[${MAX_POOLS}];
      uniform vec3 uMqPoolCol[${MAX_POOLS}];
      uniform float uMqPoolPhase[${MAX_POOLS}];
      uniform float uMqPoolGain;
      uniform float uMqPoolTime;
      uniform float uMqPoolPulse;
      ${shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        for (int i = 0; i < ${MAX_POOLS}; i++) {
          if (i >= uMqPoolN) break;
          vec3 dv = vMqW - uMqPoolPos[i].xyz;
          float q = dot(dv, dv) / (uMqPoolPos[i].w * uMqPoolPos[i].w);
          float beat = 1.0 - uMqPoolPulse * 0.15 * (0.5 + 0.5 * sin(uMqPoolTime * 0.754 + uMqPoolPhase[i]));
          // Same falloff as sampleLight() (crystals.ts): 1/(1+q), not 1/(1+q^2)
          // — squaring q a second time made the floor pools disagree with the
          // fish tint they are supposed to match (too bright at the core,
          // gone well inside the emitter's own reach).
          diffuseColor.rgb += uMqPoolCol[i] * (uMqPoolGain * beat / (1.0 + q));
        }`,
      )}`;
  };
  mat.customProgramCacheKey = () => 'mq-floor-pools';
  mat.needsUpdate = true;
}

/**
 * Glow cards for MOVING sources — one instanced quad per glowing fish, the
 * same soft additive card a crystal cluster wears. This is the fish's bloom:
 * no composer, no render target, one draw call for the whole cast.
 */
export interface GlowCards {
  mesh: InstancedMesh;
  /** Place card `i`. Colour is linear RGB. */
  set(i: number, x: number, y: number, z: number, size: number, r: number, g: number, b: number, phase: number): void;
  /** Cards in use this frame, then the shared look. */
  commit(count: number, tSec: number, glow: number, pulse: number, fog: { color: Color; near: number; far: number }): void;
}

export function buildGlowCards(capacity: number): GlowCards {
  const quad = new PlaneGeometry(1, 1);
  quad.userData.mqOwned = true;
  const uniforms: Uniforms = {
    uTime: { value: 0 }, uGlow: { value: 1 }, uPulse: { value: 0 },
    uFogColor: { value: new Color() }, uFogNear: { value: 60 }, uFogFar: { value: 500 },
    uLift: { value: 0.42 },
    // A fish is small and SUPPOSED to be seen close; only fade at the lens.
    uNear: { value: new Vector2(10, 34) },
  };
  const mat = owned(new ShaderMaterial({
    uniforms,
    vertexShader: CARD_VERT,
    fragmentShader: CARD_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  }));
  const mesh = new InstancedMesh(quad, mat, capacity);
  const colors = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const looks = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  quad.setAttribute('aColor', colors);
  quad.setAttribute('aLook', looks);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.count = 0;
  const m = new Matrix4();
  return {
    mesh,
    set(i, x, y, z, size, r, g, b, phase) {
      m.makeScale(size, size, size).setPosition(x, y, z);
      mesh.setMatrixAt(i, m);
      colors.setXYZ(i, r, g, b);
      looks.setXY(i, 0, phase);
    },
    commit(count, tSec, glow, pulse, fog) {
      mesh.count = count;
      mesh.visible = count > 0 && glow > 0;
      mesh.instanceMatrix.needsUpdate = true;
      colors.needsUpdate = true;
      looks.needsUpdate = true;
      uniforms.uTime!.value = tSec;
      uniforms.uGlow!.value = glow;
      uniforms.uPulse!.value = pulse;
      (uniforms.uFogColor!.value as Color).copy(fog.color);
      uniforms.uFogNear!.value = fog.near;
      uniforms.uFogFar!.value = fog.far;
    },
  };
}
