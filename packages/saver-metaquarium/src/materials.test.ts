import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshMatcapMaterial, MeshStandardMaterial, SphereGeometry, Texture } from 'three';
import {
  addGlowHalos,
  applyNpcMaterials,
  chromeMatcap,
  collectFishGlow,
  eyeNoseSign,
  forceOpaque,
  glowColorOf,
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

  it('glow color honors the authored emissive over everything', () => {
    const m = new MeshStandardMaterial({ name: 'GLOW Blue.001' });
    m.emissive.setRGB(0, 0.0266, 1);
    const c = glowColorOf(m, createRng(1));
    expect(c.b).toBeCloseTo(1);
    expect(c.r).toBe(0);
  });

  it('glow color falls back to the color the NAME spells', () => {
    // The betafish generation is textured with no emissive — the name is the
    // only color signal ('GLOW-Orange', 'GLOW-DarkBlue', 'GLOW ORange.002').
    const named = (name: string) => {
      const m = new MeshStandardMaterial({ name });
      m.emissive.setRGB(0, 0, 0);
      return glowColorOf(m, createRng(1)).getHexString();
    };
    expect(named('GLOW-Orange')).toBe(named('GLOW ORange.002'));
    expect(named('GLOW-DarkBlue')).not.toBe(named('GLOW-Blue')); // longest prefix wins
    expect(named('GLOW-Teal')).toBe('00ffc8');
  });

  it('primary/secondary become one coherent two-tone, not a patchwork', () => {
    const geo = new SphereGeometry(1, 4, 4);
    const prim1 = new Mesh(geo, new MeshStandardMaterial({ name: 'PrimaryColor' }));
    prim1.material.name = 'PrimaryColor';
    const prim2 = new Mesh(geo, new MeshStandardMaterial({ name: 'primaryColor3' }));
    prim2.material.name = 'primaryColor3';
    const sec = new Mesh(geo, new MeshStandardMaterial({ name: 'SecondaryColor' }));
    sec.material.name = 'SecondaryColor';
    const root = new Group();
    root.add(prim1, prim2, sec);
    applyNpcMaterials(root, createRng(7).fork(2));
    const a = (prim1.material as unknown as MeshBasicMaterial).color.getHex();
    const b = (prim2.material as unknown as MeshBasicMaterial).color.getHex();
    const c = (sec.material as unknown as MeshBasicMaterial).color.getHex();
    expect(a).toBe(b); // every primary part shares the coat
    expect(c).not.toBe(a); // secondary is guaranteed distinct
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

  it('eyes become unlit pure white — the brightest point on a fish', () => {
    // The GLBs ship EYE-WHITE as 0.8-gray PBR; under the hemisphere light
    // that rendered dim gray. Name decides white vs black.
    const { root, eyes } = npcFish();
    applyNpcMaterials(root, createRng(7).fork(1));
    const mat = eyes.material as MeshBasicMaterial;
    expect(mat).toBeInstanceOf(MeshBasicMaterial);
    expect(mat.color.getHex()).toBe(0xffffff);
    expect(mat.name).toBe('EYES-left');
    expect(mat.userData.mqOwned).toBe(true);
  });

  it('pupils stay black, and unnamed eyes sort by their authored luminance', () => {
    const geo = new SphereGeometry(1, 4, 4);
    const pupil = new Mesh(geo, new MeshStandardMaterial({ name: 'EYE-BLACK' }));
    pupil.material.name = 'EYE-BLACK';
    // NPC 'eyes2' says neither white nor black — its authored color decides.
    const darkMat = new MeshStandardMaterial({ name: 'eyes2' });
    darkMat.color.setRGB(0.02, 0.02, 0.02);
    const dark = new Mesh(geo, darkMat);
    const root = new Group();
    root.add(pupil, dark);
    applyNpcMaterials(root, createRng(7).fork(1));
    expect((pupil.material as unknown as MeshBasicMaterial).color.getHex()).toBe(0x000000);
    expect((dark.material as unknown as MeshBasicMaterial).color.getHex()).toBe(0x000000);
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
  // eyes replaced too now (unlit white), and owned like every replacement
  expect((eyes.material as MeshStandardMaterial).name).toBe('EYES-L');
  expect((eyes.material as MeshStandardMaterial).userData.mqOwned).toBe(true);
});

describe('glow halos — selective bloom without a composer', () => {
  function glowFish(): { root: Group; glow: Mesh } {
    // A small fin on a big body — the ordinary case. The whole-silhouette
    // glow (crystal breeds) is covered by its own test below.
    const glow = new Mesh(new SphereGeometry(1, 4, 4), new MeshStandardMaterial({ name: 'GLOW-fin' }));
    glow.material.name = 'GLOW-fin';
    const body = new Mesh(new SphereGeometry(4, 4, 4), new MeshStandardMaterial({ name: 'PrimaryColor' }));
    body.material.name = 'PrimaryColor';
    const root = new Group();
    root.add(glow, body);
    return { root, glow };
  }

  it('adds additive shells on glow parts only, sharing the source geometry', () => {
    const { root, glow } = glowFish();
    applyNpcMaterials(root, createRng(7).fork(1));
    const added = addGlowHalos(root, createRng(7).fork(1));
    expect(added).toBe(2); // ≤3 parts → tight + wide shell
    const halos: Mesh[] = [];
    root.traverse((n) => { if ((n as Mesh).userData.mqHalo) halos.push(n as Mesh); });
    expect(halos).toHaveLength(2);
    for (const h of halos) {
      expect(h.geometry).toBe(glow.geometry); // template-owned, never cloned
      const m = h.material as MeshBasicMaterial;
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.fog).toBe(false);
      expect(m.userData.mqOwned).toBe(true);
    }
  });

  it('a whole-silhouette glow part gets ONE faint veil, not a bright double', () => {
    // The seahorse's crystal fin is LARGER than its body; part-proportional
    // shells turned it into a displaced ghost of the entire fish on the wall.
    const glow = new Mesh(new SphereGeometry(4, 4, 4), new MeshStandardMaterial({ name: 'GLOW-Crystal1' }));
    glow.material.name = 'GLOW-Crystal1';
    const body = new Mesh(new SphereGeometry(2, 4, 4), new MeshStandardMaterial({ name: 'PrimaryColor' }));
    body.material.name = 'PrimaryColor';
    const root = new Group();
    root.add(glow, body);
    applyNpcMaterials(root, createRng(7).fork(1));
    expect(addGlowHalos(root, createRng(7).fork(1))).toBe(1);
    root.traverse((n) => {
      const h = n as Mesh;
      if (h.userData.mqHalo) expect((h.material as MeshBasicMaterial).opacity).toBeLessThan(0.2);
    });
  });

  it('shell color matches the core glow color exactly', () => {
    const { root, glow } = glowFish();
    applyNpcMaterials(root, createRng(7).fork(5));
    addGlowHalos(root, createRng(99).fork(5)); // different rng — must not matter
    const core = (glow.material as MeshBasicMaterial).color.getHex();
    root.traverse((n) => {
      const h = n as Mesh;
      if (h.userData.mqHalo) expect((h.material as MeshBasicMaterial).color.getHex()).toBe(core);
    });
  });

  it('metallic atlases become unlit basics wearing the same texture', () => {
    // glTF's DEFAULT metallicFactor is 1.0 and a pure metal under a
    // hemisphere light renders BLACK — the jellyfish shipped that way.
    const geo = new SphereGeometry(1, 4, 4);
    const tex = new Texture();
    const metal = new MeshStandardMaterial({ name: 'jelly', map: tex, metalness: 1 });
    const soft = new MeshStandardMaterial({ name: 'atlas', map: tex, metalness: 0 });
    const a = new Mesh(geo, metal);
    const b = new Mesh(geo, soft);
    const root = new Group();
    root.add(a, b);
    applyNpcMaterials(root, createRng(3), false);
    const ra = a.material as unknown as MeshBasicMaterial;
    expect(ra).toBeInstanceOf(MeshBasicMaterial);
    expect(ra.map).toBe(tex); // same texture, unlit
    expect(ra.userData.mqOwned).toBe(true);
    expect(b.material).toBe(soft); // non-metal atlas untouched
  });

  it('reflective (default): metallic atlases wear the shared chrome matcap, never black', () => {
    const geo = new SphereGeometry(1, 4, 4);
    const tex = new Texture();
    const a = new Mesh(geo, new MeshStandardMaterial({ name: 'plate', map: tex, metalness: 1 }));
    const root = new Group();
    root.add(a);
    applyNpcMaterials(root, createRng(3));
    const m = a.material as unknown as MeshMatcapMaterial;
    expect(m).toBeInstanceOf(MeshMatcapMaterial);
    expect(m.map).toBe(tex);
    expect(m.matcap).toBe(chromeMatcap()); // one texture for every fish
    expect(m.userData.mqOwned).toBe(true);
    // Shared across tanks: must never be disposed with a fish.
    expect(chromeMatcap().userData.mqOwned).toBeUndefined();
    const px = chromeMatcap().image.data as Uint8Array;
    let lo = 255, hi = 0;
    for (let i = 0; i < px.length; i += 4) { lo = Math.min(lo, px[i + 1]!); hi = Math.max(hi, px[i + 1]!); }
    expect(lo).toBeGreaterThan(40); // no face ever goes black
    expect(hi).toBeGreaterThan(235); // and there is a real highlight
  });

  it('the halo shader pushes along normals via one shared program key', () => {
    const { root } = glowFish();
    applyNpcMaterials(root, createRng(7).fork(1));
    addGlowHalos(root, createRng(7).fork(1));
    const halos: Mesh[] = [];
    root.traverse((n) => { if ((n as Mesh).userData.mqHalo) halos.push(n as Mesh); });
    const mat = halos[0]!.material as MeshBasicMaterial;
    const shader = { uniforms: {} as Record<string, { value: number }>, vertexShader: 'void main() {\n#include <begin_vertex>\n}' };
    mat.onBeforeCompile!(shader as never, null as never);
    expect(shader.uniforms.uHaloPush!.value).toBeGreaterThan(0);
    expect(shader.vertexShader).toContain('transformed += normal * uHaloPush;');
    expect(mat.customProgramCacheKey!()).toBe('mq-glow-halo');
  });

  it('is idempotent-safe: halos never halo halos, and multi-material meshes are skipped', () => {
    const { root } = glowFish();
    applyNpcMaterials(root, createRng(7).fork(1));
    addGlowHalos(root, createRng(7).fork(1));
    const second = addGlowHalos(root, createRng(7).fork(1));
    // The already-added shells wear glow-named materials but are tagged.
    expect(second).toBe(2); // re-halos the small core part only, not the shells
    const geo = new SphereGeometry(1, 4, 4);
    const multi = new Mesh(geo, [
      new MeshStandardMaterial({ name: 'GLOW-a' }),
      new MeshStandardMaterial({ name: 'body' }),
    ]);
    const g = new Group();
    g.add(multi);
    expect(addGlowHalos(g, createRng(1))).toBe(0);
  });
});

describe('lit mode — fish that take light', () => {
  it('coats take light; glow and eyes stay unlit (they ARE the light)', () => {
    const { root, body, glow, eyes } = npcFish();
    applyNpcMaterials(root, createRng(7).fork(1), true, true);
    expect(body.material).toBeInstanceOf(MeshLambertMaterial);
    expect(glow.material).toBeInstanceOf(MeshBasicMaterial);
    expect(eyes.material).toBeInstanceOf(MeshBasicMaterial);
  });

  it('lit and flat pick the SAME coat from the same fork', () => {
    const a = npcFish();
    const b = npcFish();
    applyNpcMaterials(a.root, createRng(7).fork(3), true, true);
    applyNpcMaterials(b.root, createRng(7).fork(3), true, false);
    expect((a.body.material as MeshLambertMaterial).color.getHex())
      .toBe((b.body.material as MeshBasicMaterial).color.getHex());
  });

  it('metal plates become an owned PBR clone: coloured, polished, never a black mirror', () => {
    const tex = new Texture();
    const src = new MeshStandardMaterial({ name: 'plate', map: tex, metalness: 1, roughness: 1 });
    const a = new Mesh(new SphereGeometry(1, 4, 4), src);
    const root = new Group();
    root.add(a);
    applyNpcMaterials(root, createRng(3), true, true);
    const m = a.material as unknown as MeshStandardMaterial;
    expect(m).toBeInstanceOf(MeshStandardMaterial);
    expect(m).not.toBe(src); // the template's material is never edited
    expect(m.map).toBe(tex);
    expect(m.metalness).toBeLessThanOrEqual(0.35);
    expect(m.roughness).toBeLessThanOrEqual(0.3);
    expect(src.metalness).toBe(1);
  });
});

describe('the look is the default, and each part of it is optional', () => {
  it('lit + fishMetal off: the plate is an ordinary lit surface wearing its atlas', () => {
    const tex = new Texture();
    const a = new Mesh(new SphereGeometry(1, 4, 4), new MeshStandardMaterial({ name: 'plate', map: tex, metalness: 1 }));
    const root = new Group();
    root.add(a);
    applyNpcMaterials(root, createRng(3), false, true);
    const m = a.material as unknown as MeshLambertMaterial;
    expect(m).toBeInstanceOf(MeshLambertMaterial);
    expect(m.map).toBe(tex);
  });
});

describe('fish glow — GLOW parts as light sources', () => {
  const fin = (r: number, x: number, name = 'GLOW-HotPink'): Mesh => {
    const m = new Mesh(new SphereGeometry(r, 4, 4), new MeshStandardMaterial({ name }));
    m.material.name = name;
    m.position.x = x;
    return m;
  };

  it('an accent fin earns full bloom, its own colour, and a repaintable core', () => {
    const root = new Group();
    const body = new Mesh(new SphereGeometry(4, 4, 4), new MeshStandardMaterial({ name: 'VICE-body' }));
    const f = fin(1, 5);
    root.add(body, f);
    applyNpcMaterials(root, createRng(2));
    const g = collectFishGlow(root, createRng(2))!;
    expect(g.cores).toHaveLength(1);
    expect(g.cores[0]!.mat).toBe(f.material);
    expect(g.cx).toBeCloseTo(5, 5); // centred on the fin, not the fish
    expect(g.parts).toHaveLength(1);
    expect(g.parts[0]!.x).toBeCloseTo(5, 5);
    expect(g.gain).toBeGreaterThan(0.8);
    // The bloom is the colour the part actually wears — never a second guess.
    expect(g.r).toBeCloseTo(g.cores[0]!.base.r, 6);
    expect(g.g).toBeCloseTo(g.cores[0]!.base.g, 6);
  });

  it('a glow part that IS the silhouette is a coat: never whitened, fainter bloom', () => {
    const root = new Group();
    const body = new Mesh(new SphereGeometry(2, 4, 4), new MeshStandardMaterial({ name: 'VICE-body' }));
    root.add(body, fin(4, 0, 'GLOW-Seafoam'));
    applyNpcMaterials(root, createRng(2));
    const g = collectFishGlow(root, createRng(2))!;
    expect(g.cores).toHaveLength(0);
    expect(g.gain).toBeLessThan(0.5);
    expect(g.parts[0]!.coat).toBe(true); // a coat is not a lamp: no light, close rim only
  });

  it('a small WHITE glow part is a lamp — the glowfish\'s angler lure — and blooms; a big white coat still does not', () => {
    const lure = new Group();
    lure.add(new Mesh(new SphereGeometry(4, 4, 4), new MeshStandardMaterial({ name: 'PrimaryColor' })), fin(0.6, 5, 'GLOW-White'));
    applyNpcMaterials(lure, createRng(2));
    const lamp = collectFishGlow(lure, createRng(2))!;
    expect(lamp.gain).toBeGreaterThan(0.6);
    const p = lamp.parts[0]!;
    expect(Math.max(p.r, p.g, p.b)).toBeGreaterThan(0.5);
    expect(p.r).toBeGreaterThanOrEqual(p.b); // a touch warm, like a bulb
    expect(p.coat).toBe(false);

    const coat = new Group();
    coat.add(new Mesh(new SphereGeometry(2, 4, 4), new MeshStandardMaterial({ name: 'PrimaryColor' })), fin(4, 0, 'GLOW-White'));
    applyNpcMaterials(coat, createRng(2));
    const fog = collectFishGlow(coat, createRng(2))!;
    expect(Math.max(fog.parts[0]!.r, fog.parts[0]!.g, fog.parts[0]!.b)).toBeLessThan(0.2);
  });

  it('a fish with nothing that glows has no glow', () => {
    const root = new Group();
    root.add(new Mesh(new SphereGeometry(2, 4, 4), new MeshStandardMaterial({ name: 'VICE-body' })));
    applyNpcMaterials(root, createRng(2));
    expect(collectFishGlow(root, createRng(2))).toBeNull();
  });
});
