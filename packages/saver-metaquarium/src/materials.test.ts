import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Texture } from 'three';
import {
  applyFarmMaterials,
  applyNpcMaterials,
  eyeNoseSign,
  forceOpaque,
  hasTexturedMaterial,
  BLOOM_LAYER,
  MIAMI_VICE_COLORS,
} from './materials';

/** Build a fish-shaped object tree with named materials, like a breed GLB. */
function npcFish(): { root: Group; body: Mesh; glow: Mesh; eyes: Mesh } {
  const geo = new SphereGeometry(1, 4, 4);
  const body = new Mesh(geo, new MeshStandardMaterial({ name: 'VICE-body' }));
  body.material.name = 'VICE-body';
  const glow = new Mesh(geo, new MeshStandardMaterial({ name: 'GLOW-fin' }));
  glow.material.name = 'GLOW-fin';
  const eyes = new Mesh(geo, new MeshStandardMaterial({ name: 'EYES-left' }));
  eyes.material.name = 'EYES-left';
  const root = new Group();
  root.add(body, glow, eyes);
  return { root, body, glow, eyes };
}

describe('metaquarium material contract', () => {
  it('NPC: body materials become unlit palette basics, seeded per rng', () => {
    const { root, body } = npcFish();
    applyNpcMaterials(root, createRng(7).fork(1));
    const mat = body.material as MeshBasicMaterial;
    expect(mat).toBeInstanceOf(MeshBasicMaterial);
    const hex = `#${mat.color.getHexString()}`;
    expect(MIAMI_VICE_COLORS.map((c) => c.toLowerCase())).toContain(hex);
  });

  it('NPC: same fork → same coat; different fork → (eventually) different coat', () => {
    const a = npcFish();
    const b = npcFish();
    applyNpcMaterials(a.root, createRng(7).fork(3));
    applyNpcMaterials(b.root, createRng(7).fork(3));
    expect((a.body.material as MeshBasicMaterial).color.getHex()).toBe(
      (b.body.material as MeshBasicMaterial).color.getHex(),
    );
  });

  it('NPC: GLOW-* becomes black-bodied emissive standard on the bloom layer', () => {
    const { root, glow } = npcFish();
    applyNpcMaterials(root, createRng(7).fork(1));
    const mat = glow.material as MeshStandardMaterial;
    expect(mat).toBeInstanceOf(MeshStandardMaterial);
    expect(mat.color.getHex()).toBe(0x000000);
    expect(mat.emissive.getHex()).not.toBe(0x000000);
    expect(mat.emissiveIntensity).toBe(1.5);
    expect(glow.layers.isEnabled(BLOOM_LAYER)).toBe(true);
  });

  it('NPC: EYES-* materials are left untouched', () => {
    const { root, eyes } = npcFish();
    const before = eyes.material;
    applyNpcMaterials(root, createRng(7).fork(1));
    expect(eyes.material).toBe(before);
  });

  it('farm: authored colored materials stay exactly as shipped; GLOW meshes join the bloom layer', () => {
    const { root, body, glow } = npcFish();
    (body.material as MeshStandardMaterial).color.set('#ee8030'); // authored orange
    const bodyBefore = body.material;
    applyFarmMaterials(root, createRng(7).fork(1));
    expect(body.material).toBe(bodyBefore);
    expect(body.layers.isEnabled(BLOOM_LAYER)).toBe(false);
    expect(glow.layers.isEnabled(BLOOM_LAYER)).toBe(true);
  });

  it('farm: HDR emissive overdrive is normalized below clip and joins the bloom layer', () => {
    const { root, body } = npcFish();
    const mat = body.material as MeshStandardMaterial;
    mat.color.set('#000000');
    mat.emissive.set(0.55, 0.48, 1.0); // authored periwinkle glow
    mat.emissiveIntensity = 20; // KHR_materials_emissive_strength overdrive
    applyFarmMaterials(root, createRng(7).fork(1));
    expect(body.material).toBe(mat); // same material, retuned
    expect(mat.emissiveIntensity).toBeCloseTo(0.9); // 0.9 / max channel (1.0)
    expect(body.layers.isEnabled(BLOOM_LAYER)).toBe(true);
  });

  it('forceOpaque solidifies alpha-blend fish materials (the see-through-body bug)', () => {
    const { root, body } = npcFish();
    const mat = body.material as MeshStandardMaterial;
    mat.transparent = true;
    mat.opacity = 0.4;
    mat.depthWrite = false;
    forceOpaque(root);
    expect(mat.transparent).toBe(false);
    expect(mat.opacity).toBe(1);
    expect(mat.depthWrite).toBe(true);
  });

  it('eyeNoseSign reads the head end from the EYE meshes, 0 without eyes', () => {
    const { root, eyes, body, glow } = npcFish();
    eyes.position.x = 5; // eyes toward +x → nose is +x
    expect(eyeNoseSign(root, 'x')).toBe(1);
    eyes.position.x = -5;
    expect(eyeNoseSign(root, 'x')).toBe(-1);
    (body.material as MeshStandardMaterial).name = 'VICE-body';
    (eyes.material as MeshStandardMaterial).name = 'fin'; // no eye materials left
    (glow.material as MeshStandardMaterial).name = 'fin2';
    expect(eyeNoseSign(root, 'x')).toBe(0);
  });

  it('detects texture atlases, and the farm lane never recoats them — even white ones', () => {
    const { root, body } = npcFish();
    expect(hasTexturedMaterial(root)).toBe(false);
    const mat = body.material as MeshStandardMaterial;
    mat.map = new Texture(); // white base + atlas = the Guy-style textured fish
    expect(hasTexturedMaterial(root)).toBe(true);
    applyFarmMaterials(root, createRng(7).fork(1));
    expect(body.material).toBe(mat); // the texture IS the look; untouched
  });

  it('farm: unstyled (untextured near-white) materials get a seeded rescue coat', () => {
    const { root, body } = npcFish();
    // Default MeshStandardMaterial color is white and there is no map — the
    // "default-material look" that made v1's fish render as white blobs.
    applyFarmMaterials(root, createRng(7).fork(1));
    const mat = body.material as MeshBasicMaterial;
    expect(mat).toBeInstanceOf(MeshBasicMaterial);
    const hex = `#${mat.color.getHexString()}`;
    expect(MIAMI_VICE_COLORS.map((c) => c.toLowerCase())).toContain(hex);
    expect(hex).not.toBe('#1c1c1c'); // off-black is never a body coat
  });
});
