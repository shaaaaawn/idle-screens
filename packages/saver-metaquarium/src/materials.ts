import type { Rng } from '@idle-screens/core';
import {
  AdditiveBlending,
  Color,
  DataTexture,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshMatcapMaterial,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { MIAMI_VICE_COLORS, BLOOM_COLORS } from './manifest';

export { MIAMI_VICE_COLORS, BLOOM_COLORS };

const BODY_COATS = MIAMI_VICE_COLORS.filter((c) => c !== '#1c1c1c');

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function isEyes(m: Material): boolean {
  return m.name.startsWith('EYES-') || /eye/i.test(m.name);
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
 * - other untextured → seeded palette coat; textured → untouched (the atlas
 *   IS the look).
 */
export function applyNpcMaterials(root: Object3D, rng: Rng, reflective = true, lit = false): void {
  const coatA = rng.pick(BODY_COATS);
  const coatB = rng.pick(BODY_COATS.filter((c) => c !== coatA));
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const replaced = materialsOf(mesh).map((m) => {
      if (isEyes(m)) {
        const white = /black/i.test(m.name)
          ? false
          : /white/i.test(m.name) || colorLuminance(m) >= 0.5;
        const eye = new MeshBasicMaterial({ color: white ? 0xffffff : 0x000000 });
        eye.name = m.name;
        eye.userData.mqOwned = true;
        return eye;
      }
      if (isGlow(m) && !(m as Partial<MeshBasicMaterial>).map) {
        const glow = new MeshBasicMaterial({ color: glowColorOf(m, rng) });
        glow.name = m.name;
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
      const coat = /primary/i.test(m.name)
        ? coatA
        : /secondary/i.test(m.name)
        ? coatB
        : rng.pick(BODY_COATS);
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
  /** The glowing parts themselves, largest first (body-local), each in its own
   *  colour — bloom hugs the fin that glows, not the fish that owns it. */
  parts: Array<{ x: number; y: number; z: number; radius: number; r: number; g: number; b: number }>;
}

/** Runs after applyNpcMaterials. null = this fish has nothing that glows. */
export function collectFishGlow(root: Object3D, rng: Rng): FishGlow | null {
  const cores: FishGlow['cores'] = [];
  const parts: FishGlow['parts'] = [];
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
  let accent = false;
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material || mesh.userData.mqHalo || Array.isArray(mesh.material)) return;
    const m = mesh.material as MeshBasicMaterial;
    if (!isGlow(m)) return;
    mesh.geometry.computeBoundingSphere();
    const sphere = mesh.geometry.boundingSphere;
    if (!sphere) return;
    const scale = mesh.matrixWorld.getMaxScaleOnAxis() / (root.matrixWorld.getMaxScaleOnAxis() || 1);
    const r = sphere.radius * scale;
    centre.copy(sphere.center).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
    cx += centre.x * r; cy += centre.y * r; cz += centre.z * r; w += r;
    {
      const stored = m.userData.mqGlowColor as number | undefined;
      const pc = stored !== undefined ? new Color(stored) : glowColorOf(m, rng);
      // Bloom is earned by SATURATION, per part: a white or grey glow blooms
      // as fog around the fish, which is the opposite of a light source.
      const hi = Math.max(pc.r, pc.g, pc.b);
      const k = hi > 0 ? 0.06 + 0.94 * ((hi - Math.min(pc.r, pc.g, pc.b)) / hi) ** 1.5 : 0;
      parts.push({ x: centre.x, y: centre.y, z: centre.z, radius: r, r: pc.r * k, g: pc.g * k, b: pc.b * k });
    }
    radius = Math.max(radius, r);
    // Same rule as the halo pass: a part that is most of the silhouette is a
    // coat, not an accent. Whitening it bleaches the fish (the seahorse went
    // chalk white); it keeps its colour and earns a fainter bloom.
    const large = r > modelR * 0.55;
    if (!large) accent = true;
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
  const gain = (accent ? 1 : 0.45) * (0.08 + 0.92 * sat);
  return { gain, parts, r: c.r, g: c.g, b: c.b, cx: cx / w, cy: cy / w, cz: cz / w, radius, cores };
}
