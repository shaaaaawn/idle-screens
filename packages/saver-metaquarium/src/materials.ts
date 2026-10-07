import type { Rng } from '@idle-screens/core';
import {
  AdditiveBlending,
  Color,
  DataTexture,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshMatcapMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Box3,
  type Material,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { MIAMI_VICE_COLORS, BLOOM_COLORS } from './manifest';
import { isScreen, PHOSPHORS, screenMaterial } from './screen';

export { MIAMI_VICE_COLORS, BLOOM_COLORS };

const BODY_COATS = MIAMI_VICE_COLORS.filter((c) => c !== '#1c1c1c');
/**
 * A catchlight in a pupil (EYES-Sparkle, the babyfish's): ONE soft-edged
 * white square per eye, high on the face that looks out of the head — the
 * light caught in a bright eye. Placed in the pupils' own box (`box`, the
 * rest-pose bounds of the mesh, both eyes): "out" is the axis the two eyes
 * spread along, "up" is y. Drawn from the rest-pose position (before
 * skinning), so it rides the eye as it turns and squashes with a blink.
 *
 * Not on every face (two or three squares an eye read as spots), and its
 * edges are antialiased and it fades out when the pupil is a few pixels
 * across, so it never shimmers.
 */
export function sparkle(eye: MeshBasicMaterial, box: Box3): void {
  eye.userData.mqSparkle = true;
  const size = box.getSize(new Vector3());
  // The axis the eyes spread along (left eye to right eye) is the widest.
  const out = size.x >= size.y && size.x >= size.z ? 0 : size.z >= size.y ? 2 : 1;
  const up = out === 1 ? 2 : 1;
  const along = 3 - out - up;
  const axis = ['x', 'y', 'z'] as const;
  const lo = new Vector2(box.min[axis[along]], box.min[axis[up]]);
  const span = new Vector2(Math.max(1e-6, size[axis[along]]), Math.max(1e-6, size[axis[up]]));
  const mid = (box.min[axis[out]] + box.max[axis[out]]) / 2;
  eye.onBeforeCompile = (shader) => {
    shader.uniforms.uSpkLo = { value: lo };
    shader.uniforms.uSpkSpan = { value: span };
    shader.uniforms.uSpkMid = { value: mid };
    const a = axis[along], u = axis[up], o = axis[out];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSpkP;\nvarying vec3 vSpkN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSpkP = position;\nvSpkN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSpkP;\nvarying vec3 vSpkN;\nuniform vec2 uSpkLo;\nuniform vec2 uSpkSpan;\nuniform float uSpkMid;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        // Only the face that looks out of the head: its normal along the
        // eyes' axis, pointing away from the middle.
        float outward = step(0.5, abs(vSpkN.${o})) * step(0.0, vSpkN.${o} * (vSpkP.${o} - uSpkMid));
        vec2 uv = (vec2(vSpkP.${a}, vSpkP.${u}) - uSpkLo) / uSpkSpan;
        vec2 w = max(fwidth(uv) * 0.6, vec2(1e-4));
        vec2 inA = smoothstep(vec2(0.42, 0.5) - w, vec2(0.42, 0.5) + w, uv);
        vec2 inB = 1.0 - smoothstep(vec2(0.82, 0.88) - w, vec2(0.82, 0.88) + w, uv);
        float s = inA.x * inA.y * inB.x * inB.y * outward;
        // A pupil a few pixels across: no catchlight to flicker.
        s *= 1.0 - smoothstep(0.12, 0.3, max(w.x, w.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), s);
      }`);
  };
  eye.customProgramCacheKey = () => `mq-eye-sparkle-v2-${axis[along]}${axis[up]}${axis[out]}`;
}

/** A VIVID- coat glows this much of its own colour: candy-bright in dark water too. */
export const VIVID_GLOW = 0.22;
/** A PAINT- part glows this much of its own colour (it shades to mud under blue light otherwise). */
export const PAINT_GLOW = 0.4;
/**
 * A candy-bright step between two coats (the VIVID-<n> role). The two ends are
 * held at least 70° apart in hue — two near neighbours (lavender, periwinkle)
 * make a gradient nobody sees — the steps run round the colour wheel between
 * them, and every step is saturated and kept out of the very light and the
 * very dark, where colour reads as white or mud.
 */
export function vividOf(a: string, b: string, t: number): Color {
  const ha = { h: 0, s: 0, l: 0 }, hb = { h: 0, s: 0, l: 0 };
  new Color(a).getHSL(ha); new Color(b).getHSL(hb);
  let dh = hb.h - ha.h;
  dh -= Math.round(dh);                       // the short way round the wheel
  if (Math.abs(dh) < 70 / 360) dh = (dh >= 0 ? 1 : -1) * 0.3;
  // Round the colour wheel, not through grey: a straight mix of two far hues
  // goes muddy in the middle.
  const h = (ha.h + dh * t + 1) % 1;
  const sat = Math.min(1, Math.max(ha.s, hb.s) * 1.15 + 0.15);
  const l = Math.min(0.62, Math.max(0.45, ha.l + (hb.l - ha.l) * t));
  return new Color().setHSL(h, sat, l);
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function isEyes(m: Material): boolean {
  return m.name.startsWith('EYES-') || /eye/i.test(m.name);
}

/** The neon look's lights, one per fish: acid, aqua, magenta, sodium, violet, ember. */
export const NEON_COLORS = ['#b6ff00', '#00ffd5', '#ff2bd6', '#ffe600', '#8f5bff', '#ff6a00'] as const;
/** What the neon look paints dark: not pure black, so a lit face still turns. */
const NEON_DARK = new Color('#06040c');

/**
 * A part painted ON the body — an eye, a mouth, teeth — wins any tie for depth
 * with the body face it lies on. Where the two share voxel cells the intake
 * drops the face underneath; but some models' parts sit off the lattice (the
 * shark's eyes and teeth overlap body faces by fractions of a voxel), and there
 * only a depth bias stops the black-white z-fight. A pupil outranks its white.
 */
function decal(m: Material, rank: number): void {
  m.polygonOffset = true;
  m.polygonOffsetFactor = -rank;
  m.polygonOffsetUnits = -rank;
}

export function isGlow(m: Material): boolean {
  return m.name.startsWith('GLOW-') || /glow/i.test(m.name);
}

/**
 * Colors the GLOW material names spell out. The collection has three naming
 * generations — `GLOW-Orange` (betafish, textured), `GLOW Blue.001` (later
 * breeds, authored emissive), `GLOW-FINS`/`GLOW-claws` (NPC set) — and for
 * the textured generation the NAME is the only color signal the material
 * carries, so this table is how those fins get an honest halo instead of a
 * random one. Longest-prefix wins so `darkblue` beats `blue`.
 */
const GLOW_NAME_COLORS: readonly (readonly [string, string])[] = [
  ['darkblue', '#2244ff'],
  ['lightblue', '#7fd4ff'],
  ['crystal', '#cfeaff'],
  ['orange', '#ff7a00'],
  ['purple', '#a45dff'],
  ['yellow', '#ffe93c'],
  ['white', '#ffffff'],
  ['green', '#3bff6e'],
  ['blue', '#2266ff'],
  ['teal', '#00ffc8'],
  ['pink', '#ff5ad0'],
  ['red', '#ff3b30'],
];

/**
 * The color a GLOW material should bloom with, in trust order: the authored
 * emissive (the later minted generations carry the real color there), then
 * the color spelled in the name, then a seeded pick — never a hardcoded
 * default, so two fish never share a fallback by accident.
 */
export function glowColorOf(m: Material, rng: Rng): Color {
  const em = (m as Partial<MeshStandardMaterial>).emissive;
  if (em && em.r + em.g + em.b > 0.02) return em.clone();
  const token = m.name.toLowerCase().replace(/^glow[\s_-]*/, '').replace(/[^a-z]/g, '');
  for (const [word, hex] of GLOW_NAME_COLORS) {
    if (token.startsWith(word)) return new Color(hex);
  }
  return new Color(rng.pick(BLOOM_COLORS));
}

export function forceOpaque(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    for (const m of materialsOf(mesh)) {
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
      m.alphaTest = 0;
      m.needsUpdate = true;
    }
  });
}

export function eyeNoseSign(root: Object3D, axis: 'x' | 'z'): number {
  let eyeSum = 0;
  let eyeN = 0;
  let bodySum = 0;
  let bodyN = 0;
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material || !mesh.geometry) return;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (!bb) return;
    const centerLocal = bb.min.clone().add(bb.max).multiplyScalar(0.5);
    const center = mesh.localToWorld(centerLocal);
    const v = axis === 'x' ? center.x : center.z;
    if (materialsOf(mesh).some(isEyes)) {
      eyeSum += v;
      eyeN++;
    } else {
      bodySum += v;
      bodyN++;
    }
  });
  if (eyeN === 0 || bodyN === 0) return 0;
  return Math.sign(eyeSum / eyeN - bodySum / bodyN);
}

/** Rec. 709 luminance of a material's own color — how `eyes`/`eyes2` (the NPC
 *  set names neither white nor black) get sorted into sclera vs pupil. */
function colorLuminance(m: Material): number {
  const c = (m as Partial<MeshStandardMaterial>).color;
  return c ? 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b : 1;
}

/**
 * Seeded palette coat, informed by what the materials actually are:
 *
 * - EYE/EYES → unlit pure white (sclera) or pure black (pupil). The GLBs ship
 *   these as 0.8-gray PBR materials, which the hemisphere light renders dim
 *   gray — eyes should read as the brightest point on a fish. Name decides
 *   (`EYE-WHITE`/`EYE-Black`); when the name says neither (NPC `eyes`/`eyes2`)
 *   the authored color's luminance does.
 * - GLOW (untextured) → unlit basic in the material's OWN color: authored
 *   emissive first, name-spelled color second, seeded pick last.
 * - GLOW (textured, the betafish generation) → texture kept; the halo pass
 *   (addGlowHalos) still blooms it by its name color.
 * - PrimaryColor/SecondaryColor (NPC set) → a two-tone coat: two DISTINCT
 *   seeded picks, so an NPC reads as one animal in two colors rather than a
 *   patchwork of independent picks.
 * - KEEP-<part> → the authored colour, kept (the breed intake names these).
 * - SCREEN-<part> → a display (screen.ts): a hackerfish's face, in a phosphor of its own.
 * - METAL <Colour> (the minted designs) → polished metal in that colour: the
 *   design's own blue or black chrome.
 * - METAL-<part> → polished metal (a glowfish's teeth): a reflective plate
 *   that takes the studio environment when lit, chrome matcap when flat;
 *   `reflective` off (fishMetal: 'off') keeps it the authored colour, matte.
 * - other untextured → seeded palette coat; textured → untouched (the atlas
 *   IS the look).
 */
export function applyNpcMaterials(root: Object3D, rng: Rng, reflective = true, lit = false, neon = false): void {
  const coatA = rng.pick(BODY_COATS);
  const coatB = rng.pick(BODY_COATS.filter((c) => c !== coatA));
  // Drawn only for the neon look, so a natural fish's picks are what they always were.
  const neonColor = neon ? new Color(rng.pick(NEON_COLORS)) : null;
  // A screen's phosphor (screen.ts), drawn once, on the first SCREEN- part:
  // a fish without a screen draws nothing extra.
  let phosphor: Color | null = null;
  const glows = new Map<Material, MeshBasicMaterial>();
  // Neon keeps SMALL glow lit (a lure, a fin's accent) and darkens a glow part
  // that is a big piece of the animal (a crab's claws): in blacklight the
  // light is the eyes, not the armour.
  let modelR = 0;
  if (neonColor) root.traverse((o) => {
    const g = (o as Mesh).isMesh ? (o as Mesh).geometry : null;
    if (g) { g.computeBoundingSphere(); modelR = Math.max(modelR, g.boundingSphere?.radius ?? 0); }
  });
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const replaced = materialsOf(mesh).map((m) => {
      if (isScreen(m)) {
        phosphor ??= new Color(rng.pick(PHOSPHORS));
        return screenMaterial(m.name, phosphor);
      }
      if (isEyes(m) && neonColor) {
        // Neon: the dark of the eye glows (and so does a crab's mouth, which
        // shares its material); the light of it goes dark with the coat. Light,
        // not an eye display — named GLOW so the halo and bloom passes take it.
        const white = /black/i.test(m.name) ? false : /white/i.test(m.name) || colorLuminance(m) >= 0.5;
        const part = new MeshBasicMaterial({ color: white ? NEON_DARK : neonColor });
        part.name = white ? `${m.name}-dark` : 'GLOW-Neon';
        part.userData.mqOwned = true;
        part.userData.mqNoCaustic = true;
        if (!white) part.userData.mqGlowColor = neonColor.getHex();
        decal(part, white ? 1 : 2); // the same bias as a natural eye: a pupil outranks its white
        return part;
      }
      if (isEyes(m)) {
        const white = /black/i.test(m.name)
          ? false
          : /white/i.test(m.name) || colorLuminance(m) >= 0.5;
        const eye = new MeshBasicMaterial({ color: white ? 0xffffff : 0x000000 });
        eye.name = m.name;
        eye.userData.mqOwned = true;
        // What `rigEyes` looks for: the white blinks and widens, the black looks and dilates.
        eye.userData.mqEye = white ? 'sclera' : 'pupil';
        eye.userData.mqNoCaustic = true; // a display, not a surface
        if (!white && /sparkle/i.test(m.name)) {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          sparkle(eye, mesh.geometry.boundingBox!);
        }
        decal(eye, white ? 1 : 2);
        return eye;
      }
      if (isGlow(m) && neonColor && !(m as Partial<MeshBasicMaterial>).map
        && (mesh.geometry.boundingSphere?.radius ?? 0) > modelR * 0.35) {
        // Darker than a coat: the neon's own light sits right beside it.
        const dark = glowColorOf(m, rng).multiplyScalar(0.05).lerp(NEON_DARK, 0.75);
        const part = lit ? new MeshLambertMaterial({ color: dark }) : new MeshBasicMaterial({ color: dark });
        // Not GLOW any more: no halo, no bloom, no light of its own.
        part.name = `DARK-${m.name.replace(/^glow[\s_-]*/i, '')}`;
        part.userData.mqOwned = true;
        return part;
      }
      // A textured glow part keeps its template material; it is still light, not a lit surface.
      if (isGlow(m)) m.userData.mqNoCaustic = true;
      if (isGlow(m) && !(m as Partial<MeshBasicMaterial>).map) {
        // One light, however many meshes share it (the starfish's five tips):
        // one colour, drawn once.
        const shared = glows.get(m);
        if (shared) return shared;
        const glow = new MeshBasicMaterial({ color: glowColorOf(m, rng) });
        glows.set(m, glow);
        glow.name = m.name;
        glow.userData.mqNoCaustic = true;
        // The halo pass reads this back so shell and core NEVER disagree —
        // resolving twice would replay the rng differently in the fallback.
        glow.userData.mqGlowColor = glow.color.getHex();
        // Ours to dispose at fish teardown. Textured materials stay the
        // template's — disposing those would corrupt every other clone.
        glow.userData.mqOwned = true;
        return glow;
      }
      const map = (m as Partial<MeshBasicMaterial>).map;
      if (map) {
        // The metal trap: glTF's DEFAULT metallicFactor is 1.0, and a pure
        // metal under our hemisphere light (no environment map) renders
        // BLACK — the jellyfish shipped that way. Unlit-basic the atlas so
        // the texture reads at full brightness; non-metal atlases keep their
        // authored material untouched.
        const metalness = (m as Partial<import('three').MeshStandardMaterial>).metalness ?? 0;
        if (metalness >= 0.5) {
          // …and make it READ as metal. A matcap is reflection without an
          // environment or a light: each face looks up a painted chrome ball
          // by its view-space normal, so the voxel plates flash as the fish
          // turns. One texture lookup, skinning intact.
          // LIT: the scene carries a studio environment, so the authored PBR
          // metal finally has something to reflect — real reflections that
          // slide across the plates as the fish turns. Polished a little past
          // glTF's default roughness of 1, which reflects nothing sharp.
          if (lit && !reflective) {
            // Opted out of metal: the same atlas as an ordinary lit surface.
            const matte = new MeshLambertMaterial({ map });
            matte.name = m.name;
            matte.userData.mqOwned = true;
            return matte;
          }
          if (lit) {
            const src = m as MeshStandardMaterial;
            const plate = src.clone();
            plate.roughness = Math.min(src.roughness ?? 1, 0.3);
            // glTF's default metalness is 1 — a mirror with no diffuse at all,
            // which in a dark room is a BLACK fish, and at 0.6 a GREY one (the
            // jellyfish did both). 0.35 keeps the atlas's colour and lays the
            // reflections over it as a sheen.
            plate.metalness = Math.min(src.metalness ?? 1, 0.35);
            plate.envMapIntensity = 1.3;
            plate.userData.mqOwned = true;
            return plate;
          }
          if (reflective) {
            const metal = new MeshMatcapMaterial({ map, matcap: chromeMatcap() });
            metal.name = m.name;
            metal.userData.mqOwned = true;
            return metal;
          }
          const atlas = new MeshBasicMaterial({ map });
          atlas.name = m.name;
          atlas.userData.mqOwned = true;
          return atlas;
        }
        return m;
      }
      // METAL-: polished, whatever its authored colour — which only tints it.
      if (/^METAL-/.test(m.name) && reflective) {
        const own = (m as Partial<MeshStandardMaterial>).color?.clone() ?? new Color(0x888888);
        const steel = new Color('#e4e8f2').lerp(own, 0.15);
        // Not a mirror: a flat voxel face reflects ONE direction of the room, so
        // a polished one flips sky-white ↔ floor-black as the jaw swings. A
        // satin roughness blurs that, and a little light of its own sets a floor.
        const metal = lit
          ? new MeshStandardMaterial({ color: steel, metalness: 0.75, roughness: 0.38, envMapIntensity: 1.3, emissive: steel.clone().multiplyScalar(0.28) })
          : new MeshMatcapMaterial({ color: steel, matcap: chromeMatcap() });
        metal.name = m.name;
        metal.userData.mqOwned = true;
        decal(metal, 1);
        return metal;
      }
      // `METAL <Colour>` (the minted designs' own naming, a space where the
      // intake's roles have a hyphen): metal IN that colour — the design's blue
      // chrome, its black chrome — not steel with a tint. Polished: it takes
      // the studio environment when lit (its authored roughness, kept satin
      // so a flat voxel face never flips sky-white to black), chrome when flat.
      if (/^METAL\s/.test(m.name) && reflective) {
        const src = m as Partial<MeshStandardMaterial>;
        const own = src.color?.clone() ?? new Color(0x888888);
        const rough = Math.min(0.45, Math.max(0.2, src.roughness ?? 0.3));
        const metal = lit
          ? new MeshStandardMaterial({ color: own, metalness: 0.85, roughness: rough, envMapIntensity: 1.4, emissive: own.clone().multiplyScalar(0.12) })
          : new MeshMatcapMaterial({ color: own.clone().lerp(new Color('#ffffff'), 0.12), matcap: chromeMatcap() });
        metal.name = m.name;
        metal.userData.mqOwned = true;
        return metal;
      }
      // KEEP-: the intake (breeds/breeds.json) said this part's authored
      // colour IS the look — a hacker fish's black screen, a shark's teeth.
      // A metal with `fishMetal: 'off'` is its authored colour, matte.
      if (/^(KEEP|METAL)[-\s]/.test(m.name)) {
        const own = (m as Partial<MeshStandardMaterial>).color?.clone() ?? new Color(0x888888);
        const kept = lit ? new MeshLambertMaterial({ color: own }) : new MeshBasicMaterial({ color: own });
        kept.name = m.name;
        kept.userData.mqOwned = true;
        decal(kept, 1);
        return kept;
      }
      // PAINT-#rrggbb: a part in a colour of the intake's choosing, the same on
      // every fish (the babyfish's stripe, sunny yellow on its candy coat).
      const paint = /^PAINT-(#[0-9a-f]{6})$/i.exec(m.name);
      if (paint && !neonColor) {
        // It glows a little more than a VIVID coat: a yellow under blue water
        // light shades to olive, and a stripe is meant to pop.
        const pc = new Color(paint[1]);
        const painted = lit ? new MeshLambertMaterial({ color: pc, emissive: pc.clone().multiplyScalar(PAINT_GLOW) }) : new MeshBasicMaterial({ color: pc });
        painted.name = m.name;
        painted.userData.mqOwned = true;
        return painted;
      }
      // VIVID-<n>: n% of the way from coat A to coat B, candy-bright (a baby's
      // coat: the babyfish's bands run head to tail as one gradient).
      const vivid = /^VIVID-(\d{1,3})$/.exec(m.name);
      if (vivid && !neonColor) {
        const c = vividOf(coatA, coatB, Math.min(100, Number(vivid[1])) / 100);
        const candy = lit
          ? new MeshLambertMaterial({ color: c, emissive: c.clone().multiplyScalar(VIVID_GLOW) })
          : new MeshBasicMaterial({ color: c });
        candy.name = m.name;
        candy.userData.mqOwned = true;
        return candy;
      }
      const coat = vivid
        ? vividOf(coatA, coatB, Math.min(100, Number(vivid[1])) / 100)
        : /primary/i.test(m.name)
        ? coatA
        : /secondary/i.test(m.name)
        ? coatB
        : rng.pick(BODY_COATS);
      if (neonColor) {
        // Near black, with a breath of the coat's hue so the two tones still read.
        const dark = new Color(coat).multiplyScalar(0.07).lerp(NEON_DARK, 0.4);
        const body = lit ? new MeshLambertMaterial({ color: dark }) : new MeshBasicMaterial({ color: dark });
        body.name = m.name;
        body.userData.mqOwned = true;
        return body;
      }
      // LIT: a coat that takes light, so every voxel face shades by where it
      // points — the single biggest difference between our flat fish and the
      // original renders. Lambert: one dot product, no specular to fight the
      // palette.
      const body = lit
        ? new MeshLambertMaterial({ color: new Color(coat) })
        : new MeshBasicMaterial({ color: new Color(coat) });
      body.name = m.name;
      body.userData.mqOwned = true;
      return body;
    });
    mesh.material = Array.isArray(mesh.material) ? replaced : replaced[0]!;
  });
}

/** Shells a glow part may cast. Few parts → two shells (tight + wide) for a
 *  soft falloff; many parts → one, so a five-fin fish costs five extra draws,
 *  not ten. */
const HALO_PART_CAP = 6;

function haloMaterial(color: Color, push: number, opacity: number): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    // NOT fogged: additive blending MIXES toward the fog color, and against a
    // lit environment fog (lagoon pink) a distant shell would ADD pink boxes.
    fog: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHaloPush = { value: push };
    shader.vertexShader = `uniform float uHaloPush;\n${shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\ttransformed += normal * uHaloPush;',
    )}`;
  };
  // One program for every halo — only the uniform differs.
  mat.customProgramCacheKey = () => 'mq-glow-halo';
  mat.userData.mqOwned = true;
  return mat;
}

/**
 * Selective bloom, the cheap honest way: for each mesh wearing a GLOW
 * material, add additive shells of the same geometry pushed out along the
 * vertex normals. No EffectComposer, no extra render target — the cost is a
 * couple of extra draws per glow part, and it composes with fog and the
 * governor untouched. Shells share the source's geometry (template-owned,
 * never tagged), so only the halo materials are ours to dispose.
 *
 * Runs AFTER applyNpcMaterials, so untextured glow parts already carry their
 * resolved color — the shell samples the same resolution order and matches.
 */
export function addGlowHalos(root: Object3D, rng: Rng): number {
  const glowMeshes: Mesh[] = [];
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material || mesh.userData.mqHalo) return;
    // Multi-material meshes are skipped: a single-material shell over grouped
    // geometry would bloom the whole body, not the glow slots. GLTF primitives
    // arrive single-material, so in practice this skips nothing.
    if (Array.isArray(mesh.material)) return;
    if (isGlow(mesh.material)) glowMeshes.push(mesh);
  });
  const parts = glowMeshes.slice(0, HALO_PART_CAP);
  if (parts.length === 0) return 0;
  // Push is quoted against the WHOLE MODEL, never the part. Crystal-finned
  // breeds carry a glow part LARGER than their body (seahorse: 27.7 vs 15.3
  // half-diagonal), and part-proportional shells turned those into a
  // displaced ghost of the entire fish — the "shadow" a viewer reported from
  // the wall. Against the model, the rim stays a rim: ~1.5% and 3.5% of the
  // fish, well under one voxel, so the cube-normal face separation is
  // subpixel too.
  let modelR = 0;
  for (const mesh of parts) {
    mesh.geometry.computeBoundingSphere();
    modelR = Math.max(modelR, mesh.geometry.boundingSphere?.radius ?? 1);
  }
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh && mesh.geometry) {
      mesh.geometry.computeBoundingSphere();
      modelR = Math.max(modelR, mesh.geometry.boundingSphere?.radius ?? 0);
    }
  });
  const shells: readonly (readonly [number, number])[] =
    parts.length <= 3 ? [[0.015, 0.3], [0.035, 0.14]] : [[0.025, 0.26]];
  let added = 0;
  for (const mesh of parts) {
    const stored = (mesh.material as Material).userData.mqGlowColor as number | undefined;
    const color = stored !== undefined ? new Color(stored) : glowColorOf(mesh.material as Material, rng);
    const partR = mesh.geometry.boundingSphere?.radius ?? 1;
    // A glow part that IS most of the silhouette gets one faint veil, not a
    // bright double — its shell already traces the whole fish.
    const large = partR > modelR * 0.55;
    const partShells = large ? [shells[0]!] : shells;
    const dim = large ? 0.55 : 1;
    for (const [k, opacity] of partShells) {
      const halo = mesh.clone();
      halo.material = haloMaterial(color, modelR * k, opacity * dim);
      halo.userData.mqHalo = true;
      halo.userData.mqHaloOf = (mesh.material as Material).name; // whose light it is (a rig's light animation)
      halo.renderOrder = 2;
      mesh.parent?.add(halo);
      added++;
    }
  }
  return added;
}


let CHROME: DataTexture | null = null;
/**
 * The painted chrome ball behind every reflective plate: a cool sky over a
 * darker ground, one hard highlight up-left, dark toward the rim. Generated
 * (64², 16 KB) — nothing fetched — and shared by every fish. Never tagged
 * `mqOwned`: it outlives any one tank.
 */
export function chromeMatcap(): DataTexture {
  if (CHROME) return CHROME;
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const x = (i + 0.5) / N * 2 - 1;
      const y = (j + 0.5) / N * 2 - 1;
      const r2 = Math.min(1, x * x + y * y);
      const z = Math.sqrt(1 - r2);
      const sky = 0.7 + 0.26 * y;
      const horizon = 0.16 * Math.exp(-((y - 0.04) ** 2) / 0.012);
      const hot = Math.max(0, -0.5 * x + 0.6 * y + 0.62 * z) ** 14 * 0.75;
      const v = Math.min(1, (sky + horizon) * (0.6 + 0.4 * z) + hot);
      const o = (j * N + i) * 4;
      data[o] = Math.round(255 * Math.min(1, v * 0.94));
      data[o + 1] = Math.round(255 * Math.min(1, v * 0.99));
      data[o + 2] = Math.round(255 * Math.min(1, v * 1.08));
      data[o + 3] = 255;
    }
  }
  CHROME = new DataTexture(data, N, N);
  CHROME.colorSpace = SRGBColorSpace;
  CHROME.needsUpdate = true;
  return CHROME;
}

/** What a fish's GLOW parts add up to — the source the bloom card, the core
 *  pulse and the light field all read. */
export interface FishGlow {
  /** Linear RGB of the dominant glow colour (largest part wins). */
  r: number; g: number; b: number;
  /** Centre and radius of the glowing parts, in the BODY's local space. */
  cx: number; cy: number; cz: number; radius: number;
  /** 0..1 — how much bloom this source earns. A glow part that IS the whole
   *  silhouette, or a colour with no saturation, would bloom as grey fog. */
  gain: number;
  /** Untextured glow materials this fish owns, with their authored colour —
   *  the ones the core pulse may repaint. Textured glow keeps its atlas. */
  cores: Array<{ mat: MeshBasicMaterial; base: Color }>;
  /** The halo shells, with their own opacity and the glow material they bloom:
   *  a rig's light animation dims them with their part. */
  halos: Array<{ mat: MeshBasicMaterial; opacity: number; of: string }>;
  /** The glowing parts themselves, largest first (body-local), each in its own
   *  colour — bloom hugs the fin that glows, not the fish that owns it. */
  parts: Array<{
    x: number; y: number; z: number; radius: number; r: number; g: number; b: number; coat: boolean;
    /** The glow material's name: a rig's light animation picks its parts by it. */
    name: string;
    /** A rigged part that rides one bone (a glowfish's lure): its centre in that
     *  bone's frame, so its bloom and its light follow the bone, not the bind pose. */
    bone?: Object3D;
    offset?: Vector3;
  }>;
}

/** The bone a skinned part rides, if at least 80% of its vertices ride one —
 *  and the part's centre in that bone's frame. */
function partBone(mesh: Mesh, centre: Vector3): { bone: Object3D; offset: Vector3 } | null {
  const sk = mesh as unknown as SkinnedMesh;
  if (!sk.isSkinnedMesh || !sk.skeleton) return null;
  const idx = mesh.geometry.getAttribute('skinIndex'), wt = mesh.geometry.getAttribute('skinWeight');
  if (!idx || !wt) return null;
  const count = new Map<number, number>();
  for (let i = 0; i < idx.count; i++) if (wt.getX(i) > 0.5) count.set(idx.getX(i), (count.get(idx.getX(i)) ?? 0) + 1);
  let best = -1, most = 0;
  for (const [j, c] of count) if (c > most) { best = j; most = c; }
  const bone = sk.skeleton.bones[best];
  if (!bone || most < idx.count * 0.8) return null;
  // Skinned world = bone.matrixWorld · boneInverse · bindMatrix · position.
  const offset = centre.clone().applyMatrix4(sk.bindMatrix).applyMatrix4(sk.skeleton.boneInverses[best]!);
  return { bone, offset };
}

/** Runs after applyNpcMaterials. null = this fish has nothing that glows. */
export function collectFishGlow(root: Object3D, rng: Rng): FishGlow | null {
  const cores: FishGlow['cores'] = [];
  const parts: FishGlow['parts'] = [];
  const halos: FishGlow['halos'] = [];
  const seen = new Set<Material>();
  let cx = 0, cy = 0, cz = 0, w = 0, radius = 0;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const centre = new Vector3();
  let modelR = 0;
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.geometry || mesh.userData.mqHalo) return;
    mesh.geometry.computeBoundingSphere();
    modelR = Math.max(modelR, (mesh.geometry.boundingSphere?.radius ?? 0)
      * mesh.matrixWorld.getMaxScaleOnAxis() / (root.matrixWorld.getMaxScaleOnAxis() || 1));
  });
  let accent = false, lamps = false;
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh && mesh.userData.mqHalo) {
      const mat = mesh.material as MeshBasicMaterial;
      halos.push({ mat, opacity: mat.opacity, of: String(mesh.userData.mqHaloOf ?? '') });
      return;
    }
    if (!mesh.isMesh || !mesh.material || mesh.userData.mqHalo || Array.isArray(mesh.material)) return;
    const m = mesh.material as MeshBasicMaterial;
    // A screen is light too: its bloom and the light it throws (no halo shells —
    // they would trace the glass, not what it shows).
    if (!isGlow(m) && !isScreen(m)) return;
    mesh.geometry.computeBoundingSphere();
    const sphere = mesh.geometry.boundingSphere;
    if (!sphere) return;
    const scale = mesh.matrixWorld.getMaxScaleOnAxis() / (root.matrixWorld.getMaxScaleOnAxis() || 1);
    const r = sphere.radius * scale;
    centre.copy(sphere.center).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
    cx += centre.x * r; cy += centre.y * r; cz += centre.z * r; w += r;
    // Same rule as the halo pass: a part that is most of the silhouette is a
    // coat, not an accent. Whitening it bleaches the fish (the seahorse went
    // chalk white); it keeps its colour and earns a fainter bloom.
    const large = r > modelR * 0.55;
    if (!large) accent = true;
    {
      const stored = m.userData.mqGlowColor as number | undefined;
      const pc = stored !== undefined ? new Color(stored) : glowColorOf(m, rng);
      // Bloom is earned by SATURATION, per part: a white or grey glow blooms
      // as fog around the fish, which is the opposite of a light source.
      const hi = Math.max(pc.r, pc.g, pc.b);
      const sat = hi > 0 ? (hi - Math.min(pc.r, pc.g, pc.b)) / hi : 0;
      let k = 0.06 + 0.94 * sat ** 1.5;
      // …except a SMALL WHITE part: that is a lamp (the glowfish's angler
      // lure is `GLOW-White`). It cannot fog the fish — it is a few voxels —
      // so it blooms, a touch warm, like the bulb it is. White by name or by
      // colour, and only white: a pale tint (`GLOW-Crystal`, `GLOW-LightBlue`)
      // is a colour that earns little bloom, not a bulb.
      const lamp = r < modelR * 0.3 && hi > 0.5 && (sat < 0.12 || /white/i.test(m.name));
      if (lamp) { k = 1.15; pc.lerp(new Color('#ffe9c4'), 0.35); lamps = true; }
      parts.push({
        x: centre.x, y: centre.y, z: centre.z, radius: r, r: pc.r * k, g: pc.g * k, b: pc.b * k, coat: large, name: m.name,
        ...partBone(mesh, sphere.center),
      });
    }
    radius = Math.max(radius, r);
    if (!large && !m.map && m.userData.mqOwned && !seen.has(m)) {
      seen.add(m);
      cores.push({ mat: m, base: m.color.clone() });
    }
  });
  if (!parts.length || w === 0) return null;
  parts.sort((p, q) => q.radius - p.radius);
  parts.length = Math.min(parts.length, 4);
  const c = parts[0]!;
  const hi = Math.max(c.r, c.g, c.b);
  const sat = hi > 0 ? (hi - Math.min(c.r, c.g, c.b)) / hi : 0;
  const gain = (accent ? 1 : 0.45) * (0.08 + 0.92 * Math.max(sat, lamps ? 0.8 : 0));
  return { gain, parts, r: c.r, g: c.g, b: c.b, cx: cx / w, cy: cy / w, cz: cz / w, radius, cores, halos };
}
