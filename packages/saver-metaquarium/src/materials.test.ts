import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Texture } from 'three';
import {
  applyNpcMaterials,
  eyeNoseSign,
  forceOpaque,
  MIAMI_VICE_COLORS,
} from './materials';

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
  it('body materials become unlit palette basics, seeded per rng', () => {
    const { root, body } = npcFish();
    applyNpcMaterials(root, createRng(7).fork(1));
    const mat = body.material as MeshBasicMaterial;
    expect(mat).toBeInstanceOf(MeshBasicMaterial);
    const hex = `#${mat.color.getHexString()}`;
    expect(MIAMI_VICE_COLORS.map((c) => c.toLowerCase())).toContain(hex);
  });

  it('same fork → same coat; different fork → (eventually) different coat', () => {
    const a = npcFish();
    const b = npcFish();
    applyNpcMaterials(a.root, createRng(7).fork(3));
    applyNpcMaterials(b.root, createRng(7).fork(3));
    expect((a.body.material as MeshBasicMaterial).color.getHex()).toBe(
      (b.body.material as MeshBasicMaterial).color.getHex(),
    );
  });

  it('GLOW-* becomes colored emissive basic (unlit, no scene lights)', () => {
    const { root, glow } = npcFish();
    applyNpcMaterials(root, createRng(7).fork(1));
    const mat = glow.material as MeshBasicMaterial;
    expect(mat).toBeInstanceOf(MeshBasicMaterial);
    expect(mat.color.getHex()).not.toBe(0x000000);
  });

  it('textured materials (with .map) are left untouched', () => {
    const geo = new SphereGeometry(1, 4, 4);
    const textured = new MeshBasicMaterial({ name: 'BODY-atlas', map: new Texture() });
    const mesh = new Mesh(geo, textured);
    const root = new Group();
    root.add(mesh);
    applyNpcMaterials(root, createRng(7).fork(1));
    expect(mesh.material).toBe(textured);
  });

  it('EYES-* materials are left untouched for scene lighting', () => {
    const { root, eyes } = npcFish();
    const before = eyes.material;
    applyNpcMaterials(root, createRng(7).fork(1));
    expect(eyes.material).toBe(before);
  });

  it('forceOpaque solidifies alpha-blend materials', () => {
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
    eyes.position.x = 5;
    expect(eyeNoseSign(root, 'x')).toBe(1);
    eyes.position.x = -5;
    expect(eyeNoseSign(root, 'x')).toBe(-1);
    (body.material as MeshStandardMaterial).name = 'VICE-body';
    (eyes.material as MeshStandardMaterial).name = 'fin';
    (glow.material as MeshStandardMaterial).name = 'fin2';
    expect(eyeNoseSign(root, 'x')).toBe(0);
  });

  it('eyeNoseSign supports z axis', () => {
    const { root, eyes } = npcFish();
    eyes.position.z = 5;
    expect(eyeNoseSign(root, 'z')).toBe(1);
  });

  it('applyNpcMaterials handles multi-material meshes', () => {
    const geo = new SphereGeometry(1, 4, 4);
    const mat1 = new MeshStandardMaterial({ name: 'VICE-body' });
    mat1.name = 'VICE-body';
    const mat2 = new MeshStandardMaterial({ name: 'GLOW-fin' });
    mat2.name = 'GLOW-fin';
    const mesh = new Mesh(geo, [mat1, mat2]);
    const root = new Group();
    root.add(mesh);
    applyNpcMaterials(root, createRng(7).fork(1));
    expect(Array.isArray(mesh.material)).toBe(true);
    const mats = mesh.material as unknown as MeshBasicMaterial[];
    expect(mats).toHaveLength(2);
    expect(mats[0]).toBeInstanceOf(MeshBasicMaterial);
    expect(mats[1]).toBeInstanceOf(MeshBasicMaterial);
  });
});

it('tags created coats mqOwned and leaves template materials untagged', () => {
  const root = new Group();
  const body = new Mesh(new SphereGeometry(1, 4, 4), new MeshStandardMaterial());
  body.material.name = 'BODY-1';
  const eyes = new Mesh(new SphereGeometry(1, 4, 4), new MeshStandardMaterial());
  eyes.material.name = 'EYES-L';
  root.add(body, eyes);
  applyNpcMaterials(root, createRng(7));
  // coat replaced and owned — safe to dispose at fish teardown
  expect((body.material as MeshStandardMaterial).userData.mqOwned).toBe(true);
  // eyes kept — template-shared, must never carry the owned tag
  expect((eyes.material as MeshStandardMaterial).name).toBe('EYES-L');
  expect((eyes.material as MeshStandardMaterial).userData.mqOwned).toBeUndefined();
});
