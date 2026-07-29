import type { Rng } from '@idle-screens/core';
import {
  Color,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import { MIAMI_VICE_COLORS, BLOOM_COLORS } from './manifest';

/**
 * The Metaquarium material contract, ported from the original's
 * `material.system.ts` + `betafish.insertFish`. This is the load-bearing
 * "why the fish are colorful" system the v1 port missed:
 *
 * - NPC / bundled breeds: every material whose name does NOT start with
 *   `GLOW-` or `EYES-` is REPLACED with an unlit palette-colored
 *   MeshBasicMaterial; `GLOW-*` becomes a black-bodied emissive
 *   MeshStandardMaterial on the bloom layer. (Original used Math.random();
 *   here colors come from the seeded rng, so a fish's coat is stable per seed.)
 * - Live farm (NFT) fish: authored materials ship in the GLB and are left
 *   untouched — their body materials are typically unlit MeshBasicMaterial
 *   with a texture atlas, immune to scene lighting by construction.
 */

/** Selective-bloom layer id (matches the original's `threeLayers.BLOOM`). */
export const BLOOM_LAYER = 10;

export { MIAMI_VICE_COLORS, BLOOM_COLORS };

/** Body coats exclude the palette's off-black — a near-black fish is invisible
 *  in a near-black tank (the original used it against brighter exhibits). */
const BODY_COATS = MIAMI_VICE_COLORS.filter((c) => c !== '#1c1c1c');

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function isGlow(m: Material): boolean {
  return m.name.startsWith('GLOW-') || /glow/i.test(m.name);
}

function isEyes(m: Material): boolean {
  return m.name.startsWith('EYES-') || /eye/i.test(m.name);
}

/**
 * Fish are solid creatures: authored GLBs sometimes ship alpha-BLEND
 * materials (voxel atlases especially), which render the body see-through
 * with fins visible through it. Force every fish material opaque with a
 * depth write — the aquarium look comes from fog and bloom, not alpha.
 */
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

/**
 * Which way does this fish face? The eyes mark the head: find the meshes with
 * EYE materials and return the sign of their offset from the body center
 * along `axis` ('x' or 'z'), or 0 when there are no eye meshes to read.
 * Orientation becomes data-driven instead of a per-breed guess.
 */
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

/** Does any material in this tree carry a texture map? Textured GLBs are
 *  atlas-styled fish whose look IS the texture — never recoat them. */
export function hasTexturedMaterial(root: Object3D): boolean {
  let found = false;
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    for (const m of materialsOf(mesh)) {
      if ((m as Partial<MeshStandardMaterial>).map) found = true;
    }
  });
  return found;
}

/**
 * NPC treatment: seeded palette body colors + emissive glow parts. Runs on a
 * CLONE, per fish, so each fish draws its own coat from its forked rng.
 * Originals aren't disposed here — templates share materials across clones;
 * the tank disposes everything (scene + templates) on teardown.
 */
export function applyNpcMaterials(root: Object3D, rng: Rng): void {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const replaced = materialsOf(mesh).map((m) => {
      if (isEyes(m)) return m;
      if (isGlow(m)) {
        mesh.layers.enable(BLOOM_LAYER);
        const glow = new MeshStandardMaterial({ color: 0x000000 });
        glow.emissive = new Color(rng.pick(BLOOM_COLORS));
        glow.emissiveIntensity = 1.5;
        glow.name = m.name;
        return glow;
      }
      const body = new MeshBasicMaterial({ color: new Color(rng.pick(BODY_COATS)) });
      body.name = m.name;
      return body;
    });
    mesh.material = Array.isArray(mesh.material) ? replaced : replaced[0]!;
  });
}

/**
 * Live-fish treatment: authored materials stay exactly as shipped (the
 * original's `insertFish` does the same) — an NFT fish's colors and texture
 * atlas ARE its identity. Two additions:
 * - `GLOW-*` meshes join the bloom layer so authored emissive reads as glow.
 * - Emissive OVERDRIVE is normalized: KHR_materials_emissive_strength values
 *   authored for HDR (seen up to 20×) clip every pixel to white in an LDR
 *   pipeline. Clamp into glow range and let the bloom layer supply the halo
 *   the strength was authored to suggest.
 * - "Unstyled" materials — untextured AND near-white — get a seeded coat.
 *   A white untextured material is the default-material look (the v1 port's
 *   white-blob bug); anything with a map or an authored color is untouched.
 */
export function applyFarmMaterials(root: Object3D, rng: Rng): void {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (materialsOf(mesh).some(isGlow)) mesh.layers.enable(BLOOM_LAYER);
    const replaced = materialsOf(mesh).map((m) => {
      if (isGlow(m) || isEyes(m)) return m;
      const std = m as Partial<MeshStandardMaterial> & Material;
      const emissive = std.emissive;
      if (emissive && emissive.getHex() !== 0x000000 && (std.emissiveIntensity ?? 1) > 2) {
        // Below the clip point (max channel ≤ ~0.9) so the authored hue shows;
        // above the 0.65 bloom threshold so the halo still reads.
        const maxCh = Math.max(emissive.r, emissive.g, emissive.b) || 1;
        std.emissiveIntensity = 0.9 / maxCh;
        mesh.layers.enable(BLOOM_LAYER);
        return m;
      }
      const hasMap = !!std.map;
      const color = std.color;
      const nearWhite =
        !!color && color.r >= 0.85 && color.g >= 0.85 && color.b >= 0.85;
      if (hasMap || !nearWhite) return m;
      const body = new MeshBasicMaterial({ color: new Color(rng.pick(BODY_COATS)) });
      body.name = m.name;
      return body;
    });
    mesh.material = Array.isArray(mesh.material) ? replaced : replaced[0]!;
  });
}
