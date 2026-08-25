import type { Rng } from '@idle-screens/core';
import {
  AdditiveBlending,
  Color,
  MeshBasicMaterial,
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

function isGlow(m: Material): boolean {
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
export function applyNpcMaterials(root: Object3D, rng: Rng): void {
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
      const body = new MeshBasicMaterial({ color: new Color(coat) });
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
  const shells: readonly (readonly [number, number])[] =
    parts.length <= 3 ? [[0.045, 0.34], [0.11, 0.16]] : [[0.07, 0.3]];
  let added = 0;
  for (const mesh of parts) {
    const stored = (mesh.material as Material).userData.mqGlowColor as number | undefined;
    const color = stored !== undefined ? new Color(stored) : glowColorOf(mesh.material as Material, rng);
    mesh.geometry.computeBoundingSphere();
    const radius = mesh.geometry.boundingSphere?.radius ?? 1;
    for (const [k, opacity] of shells) {
      const halo = mesh.clone();
      halo.material = haloMaterial(color, radius * k, opacity);
      halo.userData.mqHalo = true;
      halo.renderOrder = 2;
      mesh.parent?.add(halo);
      added++;
    }
  }
  return added;
}
