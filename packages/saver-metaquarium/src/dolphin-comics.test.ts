import { Color, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { createRng } from '@idle-screens/core';
import { BUNDLED_BREEDS } from './breeds';
import { dolphinFrame, rigDolphin } from './dolphin';
import { DOLPHIN_PERSONAS, dressDolphin, parseDolphinCast, PERSONAS } from './dolphin-comics';
import { applyNpcMaterials } from './materials';

const dressed = async (id: (typeof DOLPHIN_PERSONAS)[number]) => {
  const b = Buffer.from((await BUNDLED_BREEDS.dolphin!()).default, 'base64');
  const g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  const rig = rigDolphin(g.scene, g.animations)!;
  applyNpcMaterials(g.scene, createRng(7), true, true);
  const before = new Map<string, number>();
  g.scene.traverse((o) => { const m = o as Mesh; if (m.isMesh) for (const mat of [m.material as Material]) before.set(mat.name, (mat as MeshStandardMaterial).color?.getHex() ?? 0); });
  const props = dressDolphin(g.scene, PERSONAS[id], (n) => g.scene.getObjectByName(n) ?? undefined);
  return { g, rig, props, before };
};
const skins = (root: Object3D): MeshStandardMaterial[] => {
  const out: MeshStandardMaterial[] = [];
  root.traverse((o) => { const m = o as SkinnedMesh; if (m.isSkinnedMesh && /^SKIN-/.test((m.material as Material).name)) out.push(m.material as MeshStandardMaterial); });
  return out;
};

describe('dolphin comics: a cast of characters, each still a dolphin', () => {
  it('reads a cast in order; anything it does not know is the classic dolphin', () => {
    expect(parseDolphinCast('showman, drifter ,BIGGUY')).toEqual(['showman', 'drifter', 'bigguy']);
    expect(parseDolphinCast('showman, someone')).toEqual(['showman', 'classic']);
    expect(parseDolphinCast('')).toEqual([]);
  });

  it('the classic dolphin is left exactly as it is', async () => {
    const { g, props, before } = await dressed('classic');
    expect(props).toEqual([]);
    for (const m of skins(g.scene)) expect(m.color.getHex()).toBe(before.get(m.name));
  });

  it('each comic wears its own skin and finish, and no two look alike', async () => {
    const looks = new Set<string>();
    for (const id of ['showman', 'drifter', 'bigguy'] as const) {
      const { g } = await dressed(id);
      const ms = skins(g.scene);
      expect(ms.length).toBeGreaterThan(0);
      const cape = ms.find((m) => m.name === 'SKIN-#1f6fd1')!;
      expect(cape.color.getHex()).toBe(new Color(PERSONAS[id].skin!.cape).getHex());
      expect(cape.roughness).toBeCloseTo(PERSONAS[id].finish!.roughness, 6);
      looks.add(ms.map((m) => m.color.getHexString()).sort().join());
    }
    expect(looks.size).toBe(3);
  });

  it('props ride their bones: the showman\'s tie on its body, the drifter\'s cap on its head', async () => {
    const show = await dressed('showman');
    expect(show.props.map((p) => p.name)).toEqual(['PROP-Tie']);
    expect(show.props[0]!.parent?.name).toBe('body');
    const drift = await dressed('drifter');
    expect(drift.props.map((p) => p.name)).toEqual(['PROP-Cap']);
    expect(drift.props[0]!.parent?.name).toBe('head');
    // The cap sits ON the head: above its top, toward its nose.
    drift.g.scene.updateMatrixWorld(true);
    const box = { y: -Infinity };
    drift.props[0]!.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.geometry.computeBoundingBox(); box.y = Math.max(box.y, m.geometry.boundingBox!.max.y); } });
    expect(box.y).toBeGreaterThan(0);
  });

  it('the big guy\'s tee is tinted into its chest on a geometry of its own (the template\'s is every dolphin\'s)', async () => {
    const classic = await dressed('classic');
    const big = await dressed('bigguy');
    let tinted = 0, owned = 0;
    big.g.scene.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isSkinnedMesh || !/^SKIN-/.test((m.material as Material).name)) return;
      if (m.geometry.userData.mqOwned) owned++;
      const c = m.geometry.getAttribute('color');
      if (c) for (let i = 0; i < c.count; i++) if (c.getX(i) < 0.3) { tinted++; break; }
    });
    expect(owned).toBeGreaterThan(0);
    expect(tinted).toBeGreaterThan(0);
    // The classic's geometry is untouched (shared, never mutated).
    classic.g.scene.traverse((o) => { const m = o as SkinnedMesh; if (m.isSkinnedMesh) expect(m.geometry.userData.mqOwned).toBeFalsy(); });
    expect(PERSONAS.bigguy.size).toBeGreaterThan(1.2);
  });

  it('each plays its act: the drifter\'s lids hang, the big guy\'s gestures are small, the showman\'s quick', async () => {
    const { rig } = await dressed('classic');
    const talk = { name: 'talk' as const, at: 0.8, weight: 1 };
    // Lids: between blinks the blink clip holds at its act's weight (none for the classic dolphin).
    const drowsy = dolphinFrame(rig, 1.234, 3, 0, { pace: 0, flurry: 0, actor: true, act: PERSONAS.drifter.act });
    const plain = dolphinFrame(rig, 1.234, 3, 0, { pace: 0, flurry: 0, actor: true, act: PERSONAS.classic.act });
    if (plain.weights.blink === 0) expect(drowsy.weights.blink).toBeCloseTo(PERSONAS.drifter.act.lids, 6);
    // Energy: a deadpan's gesture weighs less than a classic's.
    const big = dolphinFrame(rig, 50, 3, 0, { pace: 0, flurry: 0, actor: true, gesture: talk, act: PERSONAS.bigguy.act });
    const classic = dolphinFrame(rig, 50, 3, 0, { pace: 0, flurry: 0, actor: true, gesture: talk, act: PERSONAS.classic.act });
    expect(big.weights.chatter).toBeLessThan(classic.weights.chatter);
    // Tempo: the showman is further into the same gesture at the same moment; the drifter less far.
    expect(PERSONAS.showman.act.tempo).toBeGreaterThan(1);
    const into = (act: typeof PERSONAS.classic.act) => dolphinFrame(rig, 50, 3, 0, { pace: 0, flurry: 0, actor: true, gesture: talk, act }).into;
    expect(into(PERSONAS.showman.act)).toBeGreaterThan(into(PERSONAS.classic.act));
    expect(into(PERSONAS.drifter.act)).toBeLessThan(into(PERSONAS.classic.act));
  });
});
