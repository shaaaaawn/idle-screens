import type { Rng } from '@idle-screens/core';
import {
  Color,
  MeshBasicMaterial,
  type Material,
  type Mesh,
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

/**
 * Seeded palette coat: body → unlit palette color, GLOW-* → colored emissive
 * MeshBasicMaterial, EYES-* → untouched, textured materials → untouched
 * (their atlas IS the look). All unlit — no scene lights needed.
 */
export function applyNpcMaterials(root: Object3D, rng: Rng): void {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const replaced = materialsOf(mesh).map((m) => {
      if (isEyes(m)) return m;
      if ((m as Partial<MeshBasicMaterial>).map) return m;
      if (isGlow(m)) {
        const glow = new MeshBasicMaterial({ color: 0x000000 });
        glow.color.set(rng.pick(BLOOM_COLORS));
        glow.name = m.name;
        // Ours to dispose at fish teardown. Eyes/textured materials stay the
        // template's — disposing those would corrupt every other clone.
        glow.userData.mqOwned = true;
        return glow;
      }
      const body = new MeshBasicMaterial({ color: new Color(rng.pick(BODY_COATS)) });
      body.name = m.name;
      body.userData.mqOwned = true;
      return body;
    });
    mesh.material = Array.isArray(mesh.material) ? replaced : replaced[0]!;
  });
}
