/**
 * Living bubbles (the Amano study): the opt-in successor to the vent puffs.
 *
 * Every bubble is an EMISSION with a life — it grows clinging to where it was
 * born, lets go, rises, sits at the water surface a moment and pops — rather
 * than a particle wrapping round a loop with a fade to hide the seam.
 *
 *   streams  vents and seeps emit a bubble every P seconds, in coughs, and go
 *            quiet for a minute or two now and then (`bubbleStyle: 'live'`).
 *   pearls   oxygen beads grow on the flora's leaves over half a minute or
 *            more, ride the leaf as it sways, then let go (`pearling`).
 *   mist     a fine CO₂ haze of tiny bubbles from the vents, drifting on a
 *            current (`co2Mist`).
 *
 * All closed-form in t, in ONE draw. The slot cycle: a stream with period P
 * and a longest life of `life` seconds is drawn by n = ceil(life / P) + 1
 * point instances; instance `slot` shows emission floor((t + phi) / P) - slot,
 * whose age is (fract((t + phi) / P) + slot) · P. Every live emission is
 * shown by exactly one instance, and a stream's on/off gate is read at the
 * EMISSION time, so a bubble already in flight is never cut off.
 *
 * Long uptime: every period is W / an integer and every gate rate a multiple
 * of 2π / W, so the tank can feed `t mod W` — f32 stays exact on a TV that has
 * been up for a week, and the wrap is invisible because nothing changes at it.
 *
 * Small sprites: a bubble smaller than `MIN_PX` on screen is drawn at MIN_PX
 * with its alpha scaled by (true / drawn)^1.5 — nearly energy-conserving, so a
 * distant fizz dims instead of turning into a field of fat 3-px dots, and
 * below ~3 px it is a soft bead instead of rim-and-glint noise.
 */

import { BufferAttribute, BufferGeometry, Color, Points, PointsMaterial, Vector2, type Vector3, type Vector4 } from 'three';
import type { CrystalRng } from './crystals';
import { FLORA_SWAY } from './flora';

/** The loop every period divides: 20 minutes. */
export const WINDOW = 1200;
/** Smallest sprite drawn, in device pixels. */
export const MIN_PX = 2;
/** How far a vent bubble can rise with no surface above it (× scene scale). */
export const RISE_CAP = 118;
/** Longest a bubble sits at the surface before it pops. */
const LINGER_MAX = 0.75;
/** Acceleration as a fraction of launch speed per second: a bubble leaves slowly and speeds up as it grows. */
const ACCEL = 0.08;

export const KIND = { stream: 0, pearl: 1, mist: 2 } as const;

/** Snap a period so it divides the window exactly. */
export function snapPeriod(p: number): number { return WINDOW / Math.max(1, Math.round(WINDOW / p)); }
/** A gate rate (rad/s) that repeats exactly in the window: `m` whole cycles per window. */
export const gateRate = (m: number): number => (Math.PI * 2 * m) / WINDOW;

/** Seconds to rise `h` at launch speed `v` with the shared acceleration. */
export function riseTime(h: number, v: number): number {
  const c = ACCEL * v;
  return (-v + Math.sqrt(v * v + 2 * c * Math.max(0, h))) / c;
}

/** The same hash as the GLSL (`mqBubbleHash`). */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export interface BubbleSite { x: number; y: number; z: number; color: string }
export interface PearlSite extends BubbleSite { sway: [number, number, number] }

/** One point instance. `p` = (P, phi, R0, v0); `q` = (slot, gateM, seed, kind); `s` = sway or mist extras. */
export interface Instance { site: [number, number, number]; p: [number, number, number, number]; q: [number, number, number, number]; s: [number, number, number]; color: string }

export interface BubbleOptions {
  /** 0..1 — vent streams (the `bubbleVents` amount, when `bubbleStyle` is live). */
  streams: number;
  /** 0..1 — pearls on the flora. */
  pearling: number;
  /** 0..1 — CO₂ mist. */
  mist: number;
  cap: number;
  scale: number;
  /** Rise room above a vent when there is no surface: indoors this is the room, not the sea. */
  riseCap?: number;
}

/**
 * Lay out the instances. Pure: the same sites, rng and options give the same
 * array, and it is what the tests read.
 */
export function layoutBubbles(vents: readonly BubbleSite[], pearls: readonly PearlSite[], rng: CrystalRng, o: BubbleOptions): Instance[] {
  const s = o.scale, out: Instance[] = [];
  const hCap = (o.riseCap ?? RISE_CAP) * s;
  const budget = o.cap * 100;
  // --- streams: every vent, a period from the amount, stretched to the budget.
  if (o.streams > 0 && vents.length) {
    const r = rng.fork(1);
    const streams = vents.map((v) => {
      const seed = r.next(), size = 0.35 + 2.4 * r.next() ** 3.2;
      // Launch speed in units/s. Big bubbles are faster — which spreads a cough out as it climbs.
      const v0 = 3 * s * r.range(0.7, 1.05) * (0.75 + size * 0.22);
      return { v, seed, R0: size * 1.7 * s, v0, gateM: 8 + Math.floor(seed * 11) };
    });
    let P = 1.2 - 0.9 * o.streams;
    const life = (st: (typeof streams)[number], p: number): number => p + riseTime(hCap, st.v0 * 0.88) + LINGER_MAX;
    const slots = (p: number): number => streams.reduce((n, st) => n + Math.ceil(life(st, p) / p) + 1, 0);
    while (slots(P) > budget && P < 6) P *= 1.25;
    for (const st of streams) {
      const p = snapPeriod(P * (0.85 + 0.3 * st.seed));
      const n = Math.ceil(life(st, p) / p) + 1;
      const phi = st.seed * p;
      for (let j = 0; j < n; j++) {
        out.push({ site: [st.v.x, st.v.y, st.v.z], p: [p, phi, st.R0, st.v0], q: [j, st.gateM, st.seed, KIND.stream], s: [0, 0, 0], color: st.v.color });
      }
    }
  }
  // --- pearls: a bead on a leaf every half minute to two minutes.
  if (o.pearling > 0 && pearls.length) {
    const r = rng.fork(2);
    const want = Math.min(pearls.length, Math.round(o.pearling * o.cap * 6));
    const pool = [...pearls];
    for (let i = 0; i < want; i++) {
      const site = pool.splice(Math.floor(r.next() * pool.length), 1)[0]!;
      const seed = r.next();
      const p = snapPeriod(Math.exp(Math.log(25) + (Math.log(110) - Math.log(25)) * r.next()));
      // A bead you can see on a voxel leaf: a quarter to half a leaf wide.
      const R0 = (1.1 + 1.3 * r.next() ** 1.4) * s;
      const v0 = (2.4 + 0.9 * (R0 / s - 1.1)) * s;
      const n = Math.ceil((p + riseTime(hCap, v0 * 0.88) + LINGER_MAX) / p) + 1;
      for (let j = 0; j < n; j++) {
        out.push({ site: [site.x, site.y, site.z], p: [p, seed * p, R0, v0], q: [j, 3 + Math.floor(seed * 5), seed, KIND.pearl], s: site.sway, color: '#dff4ff' });
      }
    }
  }
  // --- mist: single-cycle motes from the vents, 15–30 s each.
  if (o.mist > 0 && vents.length) {
    const r = rng.fork(3);
    // Mostly motes a pixel or so across, and one in eight a soft puff of haze
    // that widens as it goes — the plume you see before you see its bubbles.
    const n = Math.round(o.mist * o.cap * 120);
    for (let i = 0; i < n; i++) {
      const v = vents[i % vents.length]!;
      const a = r.next() * Math.PI * 2, jr = Math.sqrt(r.next()) * 2.6 * s;
      const puff = r.next() < 0.125;
      const L = snapPeriod(puff ? 8 + 8 * r.next() : 15 + 15 * r.next());
      out.push({
        site: [v.x + Math.cos(a) * jr, v.y, v.z + Math.sin(a) * jr],
        p: [L, r.next() * L, (puff ? 3 + 4 * r.next() : 0.22 + 0.25 * r.next()) * s, (puff ? 0.5 + 0.6 * r.next() : 0.8 + 1.2 * r.next()) * s],
        q: [0, 0, r.next(), KIND.mist], s: [puff ? 1 : 0, 0, 0], color: '#eef6ff',
      });
    }
  }
  return out;
}

export interface BubbleState { visible: boolean; x: number; y: number; z: number; r: number; age: number; emission: number }

/** The JS twin of the stream/pearl part of the vertex shader (no sway: pearls are placed at their site). */
export function streamAt(inst: Instance, t: number, surface: number | null, hCap: number, out: BubbleState): BubbleState {
  const [P, phi, R0, v0] = inst.p, [slot, gateM, seed, kind] = inst.q;
  const cyc = (t + phi) / P;
  const k = Math.floor(cyc) - slot;
  const age = (cyc - Math.floor(cyc) + slot) * P;
  const N = Math.round(WINDOW / P);
  const hk = hash((((k % N) + N) % N) * 1.618 + seed * 97);
  const tEm = t - age;
  out.age = age; out.emission = k;
  const r = R0 * (0.8 + 0.4 * hk), v = v0 * (0.88 + 0.24 * ((hk * 3.7) % 1));
  const room = surface === null ? hCap : Math.min(hCap, surface - inst.site[1] - r);
  const riseT = riseTime(room, v);
  const linger = surface === null || surface - inst.site[1] - r > hCap ? 0 : 0.08 + 0.45 * ((hk * 7.31) % 1);
  out.visible = gateOpen(kind, gateM, seed, tEm) && age < P + riseT + linger;
  const a = Math.max(0, Math.min(age - P, riseT));
  out.x = inst.site[0]; out.z = inst.site[2];
  out.y = inst.site[1] + (age < P ? 0 : v * a + 0.5 * ACCEL * v * a * a);
  out.r = r;
  return out;
}

/** Is this emission's stream on? Read at the emission time. */
export function gateOpen(kind: number, gateM: number, seed: number, tEm: number): boolean {
  const act = Math.sin(tEm * gateRate(gateM) + seed * 41) + 0.55 * Math.sin(tEm * gateRate(gateM * 2 + 5) + seed * 13);
  if (kind === KIND.pearl) return act > -1.1;
  const cough = Math.sin(tEm * gateRate(240 + Math.floor(seed * 80)) + seed * 7);
  return act > -0.6 && cough > -0.2;
}

// ---------------------------------------------------------------------------
// GLSL. Mirrors streamAt/gateOpen line for line; keep them in step.
// ---------------------------------------------------------------------------

const GLSL_PARS = /* glsl */ `
  uniform float uBubbleTime; uniform float uSwayTime; uniform float uSurface; uniform float uRiseCap;
  uniform float uScale; uniform vec2 uDrift;
  uniform vec4 uMineralPosition[12]; uniform vec3 uMineralColor[12];
  attribute vec4 aP; attribute vec4 aQ; attribute vec3 aS;
  varying float vFade; varying vec2 vShape; varying float vSize; varying float vEnergy; varying float vKind;
  ${FLORA_SWAY}
  float mqBubbleHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
  float mqRiseTime(float h, float v) { float c = ${ACCEL.toFixed(3)} * v; return (-v + sqrt(v * v + 2.0 * c * max(0.0, h))) / c; }
  float mqGate(float kind, float m, float seed, float tEm) {
    const float W = ${(Math.PI * 2 / WINDOW).toFixed(10)};
    float act = sin(tEm * W * m + seed * 41.0) + 0.55 * sin(tEm * W * (m * 2.0 + 5.0) + seed * 13.0);
    if (kind > 0.5) return step(-1.1, act);
    float cough = sin(tEm * W * (240.0 + floor(seed * 80.0)) + seed * 7.0);
    return step(-0.6, act) * step(-0.2, cough);
  }
`;

const GLSL_VERTEX = /* glsl */ `
  #include <begin_vertex>
  float P = aP.x, phi = aP.y, R0 = aP.z, v0 = aP.w;
  float slot = aQ.x, gateM = aQ.y, seed = aQ.z, kind = aQ.w;
  float rad = R0; vFade = 1.0; vKind = kind;
  vec3 site = transformed;
  if (kind > 1.5) {
    // Mist: one mote, born, drifting on the current as it slowly rises, gone.
    float cyc = floor((uBubbleTime + phi) / P);
    float age = mod(uBubbleTime + phi, P), u = age / P;
    float N = floor(${WINDOW.toFixed(1)} / P + 0.5);
    float h1 = mqBubbleHash(mod(cyc, N) * 3.1 + seed * 71.0), h2 = mqBubbleHash(mod(cyc, N) * 1.7 + seed * 53.0);
    transformed.y += v0 * (0.7 + 0.6 * h2) * age;
    transformed.xz += uDrift * age * (0.5 + 0.5 * u);
    float tw = sqrt(age) * uScale;
    transformed.x += sin(age * 0.41 + h1 * 20.0) * tw * 1.4;
    transformed.z += cos(age * 0.37 + h2 * 20.0) * tw * 0.9;
    transformed.y = min(transformed.y, uSurface - 0.3 * uScale);
    if (aS.x > 0.5) {
      rad = R0 * (1.0 + 1.6 * u);
      vFade = smoothstep(0.0, 0.1, u) * (1.0 - smoothstep(0.3, 1.0, u)) * 0.22 / (1.0 + 2.5 * u);
      vKind = 3.0;
    } else {
      vFade = smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.6, 1.0, u)) * 0.9;
    }
  } else {
    float cyc = (uBubbleTime + phi) / P;
    float k = floor(cyc) - slot;
    float age = (fract(cyc) + slot) * P;
    float N = floor(${WINDOW.toFixed(1)} / P + 0.5);
    float hk = mqBubbleHash(mod(k, N) * 1.618 + seed * 97.0);
    float tEm = uBubbleTime - age;
    float r = R0 * (0.8 + 0.4 * hk);
    float v = v0 * (0.88 + 0.24 * fract(hk * 3.7));
    float headroom = uSurface - site.y - r;
    float room = min(uRiseCap, headroom);
    float riseT = mqRiseTime(room, v);
    float lingers = step(headroom, uRiseCap);
    float linger = lingers * (0.08 + 0.45 * fract(hk * 7.31));
    vFade = mqGate(kind, gateM, seed, tEm) * step(age, P + riseT + linger);
    // Where it let go: a pearl rides its leaf, so it leaves from wherever the leaf was.
    vec3 from = site;
    if (kind > 0.5) {
      float h = max(0.0, site.y - aS.x);
      float tLeaf = age < P ? uSwayTime : uSwayTime - (age - P);
      vec2 sw = mqFloraSway(h, aS, tLeaf);
      from.xz += sw; from.y -= dot(sw, sw) * 0.012;
    }
    if (age < P) {
      // Clinging and growing: a vent's bead swells fast, a pearl slowly.
      rad = r * (kind > 0.5 ? 0.15 + 0.85 * pow(age / P, 0.4) : 0.3 + 0.7 * sqrt(age / P));
      transformed = from + vec3(0.0, rad * 0.85, 0.0);
    } else {
      float a = min(age - P, riseT);
      float y = v * a + 0.5 * ${ACCEL.toFixed(3)} * v * a * a;
      float frac = y / max(uRiseCap, 1.0);
      // A loose helix that widens as it climbs; small bubbles wander more.
      float wob = (0.6 + frac * 5.5) * uScale / (0.6 + R0 / uScale);
      transformed = from + vec3(0.0, r + y, 0.0);
      transformed.x += sin(a * 0.7 * (1.0 + hk * 0.5) + seed * 40.0) * wob + frac * 9.0 * uScale;
      transformed.z += cos(a * 0.55 * (1.0 + hk * 0.5) + seed * 31.0) * wob;
      // It swells as the pressure drops.
      rad = r * (0.85 + 0.5 * frac);
      if (age - P > riseT) {
        // At the surface: it sits, drifts a touch, and pops.
        float l = age - P - riseT;
        transformed.y = uSurface - rad * 0.8;
        transformed.x += l * 0.6 * uScale;
        rad *= 1.0 - smoothstep(0.7, 1.0, l / max(linger, 1e-3));
      } else if (lingers < 0.5) {
        // No surface in reach: gone in the top of the climb.
        vFade *= 1.0 - smoothstep(0.85, 1.0, frac);
      }
    }
  }
  vShape = vec2(sin(uBubbleTime * (2.2 + seed * 3.0) + seed * 50.0) * 0.1 * min(1.5, R0 / uScale), seed);
  vec3 light = vec3(0.22);
  for (int i = 0; i < 12; i++) {
    vec3 delta = transformed - uMineralPosition[i].xyz;
    float reach = uMineralPosition[i].w;
    light += uMineralColor[i] / (1.0 + dot(delta, delta) / (reach * reach));
  }
  vColor.rgb *= min(vec3(1.8), light);
  if (vFade <= 0.0) transformed = vec3(0.0, -1e5, 0.0);
  // Sprite = the disc plus a margin for its wobble (the fragment's 1.24).
  float mqSprite = 2.48 * rad;
`;

/** Point size after attenuation, then the minimum-pixel rule. */
const GLSL_SIZE = /* glsl */ `
  #include <fog_vertex>
  float mqTrue = gl_PointSize;
  gl_PointSize = max(mqTrue, ${MIN_PX.toFixed(1)});
  vEnergy = pow(mqTrue / gl_PointSize, 1.5);
  vSize = mqTrue;
  if (vFade <= 0.0) gl_PointSize = 0.0;
`;

const GLSL_FRAGMENT = /* glsl */ `
  #include <color_fragment>
  vec2 uv = (gl_PointCoord - 0.5) * 2.0 * 1.24;
  float r = length(uv);
  // Below ~3 px a bubble is the AVERAGE of its optics — a soft bead — since
  // rim-and-glint shading on a couple of pixels is only noise.
  float detail = vKind > 1.5 ? 0.0 : smoothstep(2.5, 4.5, vSize);
  float g = exp(-2.2 * r * r) * (1.0 - smoothstep(1.0, 1.24, r));
  float bead = vKind > 2.5 ? exp(-3.0 * r * r) * (1.0 - smoothstep(0.85, 1.2, r)) : g * (vKind > 1.5 ? 0.7 : 0.8);
  vec3 beadColor = mix(diffuseColor.rgb, vec3(1.0), 0.45);
  float mask = bead;
  vec3 col = beadColor;
  if (detail > 0.001) {
    vec2 w = uv * vec2(1.0 + vShape.x, 1.0 - vShape.x);
    float rr = length(w);
    float px = 2.48 / max(vSize, 1.0);
    float big = smoothstep(7.0, 42.0, vSize);
    float edge = 1.0 - smoothstep(1.0 - px * 1.5, 1.0, rr);
    float under = 0.5 + 0.5 * w.y;
    float rim = pow(clamp(rr, 0.0, 1.0), mix(2.6, 7.5, big)) * edge;
    float cres = smoothstep(0.62, 0.9, length(w - vec2(-0.2, -0.24))) * (1.0 - smoothstep(0.78, 0.97, rr)) * 0.4 * big;
    float fill = edge * 0.07;
    float glint = max(0.16, px * 1.7);
    float hb = -2.35 + (fract(vShape.y * 7.31) - 0.5) * 1.3 + vShape.x * 2.2;
    float hr = 0.44 + fract(vShape.y * 5.13) * 0.18 + vShape.x * 0.6;
    vec2 hc = vec2(cos(hb), sin(hb)) * hr;
    vec2 hd = w - hc;
    float along = dot(hd, vec2(-sin(hb), cos(hb))), across = dot(hd, vec2(cos(hb), sin(hb)));
    float spec = 1.0 - smoothstep(glint * 0.35, glint, length(vec2(along * mix(1.0, 0.55, big), across * 1.25)));
    float ang = atan(w.y, w.x);
    vec3 film = 0.5 + 0.5 * cos(ang * 2.0 + rr * 3.0 + vShape.y * 40.0 + vec3(0.0, 2.1, 4.2));
    vec3 c = mix(diffuseColor.rgb, film, 0.42 * rim) * (0.85 + 0.7 * under * rim) + film * cres * 0.5;
    float m = clamp(rim * (0.8 + 0.5 * under) + cres + fill + spec, 0.0, 1.0) * edge;
    c = mix(c, vec3(1.0), spec * 0.85);
    col = mix(beadColor, c, detail);
    mask = mix(bead, m, detail);
  }
  diffuseColor.rgb = col;
  diffuseColor.a *= mask * vFade * vEnergy;
`;

export interface BubbleLayer {
  points: Points | null;
  counts: { streams: number; pearls: number; mist: number; instances: number };
  /** `t` is the tank clock; `surface` the water ceiling's height, or null for open water. */
  setFrame(t: number, surface: number | null): void;
}

export function buildBubbles(
  vents: readonly BubbleSite[], pearls: readonly PearlSite[], rng: CrystalRng, o: BubbleOptions,
  light: { positions: Vector4[]; colors: Vector3[] },
): BubbleLayer {
  const inst = layoutBubbles(vents, pearls, rng, o);
  const counts = {
    streams: new Set(inst.filter((i) => i.q[3] === KIND.stream).map((i) => i.site.join())).size,
    pearls: new Set(inst.filter((i) => i.q[3] === KIND.pearl).map((i) => i.site.join())).size,
    mist: inst.filter((i) => i.q[3] === KIND.mist).length,
    instances: inst.length,
  };
  if (!inst.length) return { points: null, counts, setFrame() {} };
  const n = inst.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), aP = new Float32Array(n * 4), aQ = new Float32Array(n * 4), aS = new Float32Array(n * 3);
  const c = new Color();
  inst.forEach((b, i) => {
    pos.set(b.site, i * 3); aP.set(b.p, i * 4); aQ.set(b.q, i * 4); aS.set(b.s, i * 3);
    c.set(b.color); col.set([c.r, c.g, c.b], i * 3);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', new BufferAttribute(col, 3));
  geometry.setAttribute('aP', new BufferAttribute(aP, 4));
  geometry.setAttribute('aQ', new BufferAttribute(aQ, 4));
  geometry.setAttribute('aS', new BufferAttribute(aS, 3));
  geometry.userData.mqOwned = true;
  // `size` 1: the sprite's world size comes from the shader (mqSprite).
  const material = new PointsMaterial({ vertexColors: true, size: 1, transparent: true, depthWrite: false });
  material.userData.mqOwned = true;
  const s = o.scale;
  const r = rng.fork(9), da = r.next() * Math.PI * 2;
  const uniforms = {
    uBubbleTime: { value: 0 }, uSwayTime: { value: 0 }, uSurface: { value: 1e5 },
    uRiseCap: { value: (o.riseCap ?? RISE_CAP) * s }, uScale: { value: s },
    uDrift: { value: new Vector2(Math.cos(da), Math.sin(da)).multiplyScalar(1.1 * s) },
    uMineralPosition: { value: light.positions }, uMineralColor: { value: light.colors },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = GLSL_PARS + shader.vertexShader
      .replace('#include <begin_vertex>', GLSL_VERTEX)
      .replace('gl_PointSize = size;', 'gl_PointSize = size * mqSprite;')
      .replace('#include <fog_vertex>', GLSL_SIZE);
    shader.fragmentShader = 'varying float vFade; varying vec2 vShape; varying float vSize; varying float vEnergy; varying float vKind;\n'
      + shader.fragmentShader.replace('#include <color_fragment>', GLSL_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'mq-bubbles-live-v1';
  const points = new Points(geometry, material);
  points.name = 'bubbles-live';
  points.frustumCulled = false;
  return {
    points, counts,
    setFrame(t, surface) {
      uniforms.uBubbleTime.value = ((t % WINDOW) + WINDOW) % WINDOW;
      uniforms.uSwayTime.value = t;
      uniforms.uSurface.value = surface ?? 1e5;
    },
  };
}

/** Candidate pearl sites: upper vertices of the flora, with the sway they ride. */
export function pearlSites(parts: readonly BufferGeometry[], scale: number, max = 400): PearlSite[] {
  const out: PearlSite[] = [], seen = new Set<string>();
  for (const g of parts) {
    const p = g.getAttribute('position'), sw = g.getAttribute('aSway');
    if (!p || !sw) continue;
    const step = Math.max(1, Math.floor(p.count / 600));
    for (let i = 0; i < p.count; i += step) {
      const y = p.getY(i), root = sw.getX(i);
      if (y - root < 2.5 * scale) continue;
      const key = `${p.getX(i).toFixed(2)},${y.toFixed(2)},${p.getZ(i).toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x: p.getX(i), y, z: p.getZ(i), color: '#dff4ff', sway: [root, sw.getY(i), sw.getZ(i)] });
      if (out.length >= max) return out;
    }
  }
  return out;
}
