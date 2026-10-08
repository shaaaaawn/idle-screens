import { Group, Mesh, MeshBasicMaterial, Texture, type AnimationClip, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { BETA_LOOK_STYLE, betaPersonality } from './beta';
import { BETA_EYE_BLOCKS, betaEyeCells, rigBetaEyes } from './beta-eyes';
import { BUNDLED_BREEDS } from './breeds';
import { mintedLook } from './eyes';

const load = async (): Promise<{ scene: Object3D; animations: AnimationClip[] }> => {
  const b = Buffer.from((await BUNDLED_BREEDS.betafish!()).default, 'base64');
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};
const firstGeometry = (o: Object3D): Mesh['geometry'] => {
  let g: Mesh['geometry'] | null = null;
  o.traverse((n) => { if (!g && (n as Mesh).isMesh) g = (n as Mesh).geometry; });
  return g!;
};

describe('betafish: the painted eyes', () => {
  it('finds both 3×3 eye blocks on the real model, each cell mapped onto its own square of the atlas', async () => {
    const cells = betaEyeCells(firstGeometry((await load()).scene))!;
    expect(cells).not.toBeNull();
    expect(cells.map((e) => e.filter(Boolean).length)).toEqual([9, 9]);
    for (const eye of cells) for (const c of eye) {
      // A cell is a small square of the 512² atlas (~12 texels), inside it — all four corners.
      const at = (a: number, b: number): [number, number] => [c!.o[0] + c!.dz[0] * a + c!.dy[0] * b, c!.o[1] + c!.dz[1] * a + c!.dy[1] * b];
      for (const [u, v] of [at(0, 0), at(1, 0), at(0, 1), at(1, 1)]) {
        expect(u).toBeGreaterThanOrEqual(-1e-6); expect(u).toBeLessThanOrEqual(1 + 1e-6);
        expect(v).toBeGreaterThanOrEqual(-1e-6); expect(v).toBeLessThanOrEqual(1 + 1e-6);
      }
      const side = Math.hypot(...c!.dz) + Math.hypot(...c!.dy);
      expect(side * 512).toBeGreaterThan(10);
      expect(side * 512).toBeLessThan(40);
    }
    // No two cells' squares overlap anywhere in the atlas (a shared texel would bleed one into the other).
    const boxes = cells.flat().map((c) => {
      const us = [0, 1].flatMap((a) => [0, 1].map((b) => c!.o[0] + c!.dz[0] * a + c!.dy[0] * b));
      const vs = [0, 1].flatMap((a) => [0, 1].map((b) => c!.o[1] + c!.dz[1] * a + c!.dy[1] * b));
      return [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)] as const;
    });
    const eps = 0.5 / 512;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a0, a1, a2, a3] = boxes[i]!, [b0, b1, b2, b3] = boxes[j]!;
      expect(a1 - eps <= b0 || b1 - eps <= a0 || a3 - eps <= b2 || b3 - eps <= a2, `cells ${i} and ${j}`).toBe(true);
    }
  });

  it('reads every mesh of a token: eye cells split across its materials\' meshes are all found', async () => {
    const geometry = firstGeometry((await load()).scene);
    const idx = geometry.index!, n = idx.count, pos = geometry.getAttribute('position');
    // Two meshes over one buffer, each indexing the triangles on one side of
    // z 3.3 (mid-eye) — as a token's materials split its cells between them.
    const half = (k: number): typeof geometry => {
      const g = geometry.clone(); const ids: number[] = [];
      for (let t = 0; t < n; t += 3) {
        const z = (pos.getZ(idx.getX(t)) + pos.getZ(idx.getX(t + 1)) + pos.getZ(idx.getX(t + 2))) / 3;
        if ((z < 3.3 ? 0 : 1) === k) ids.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
      }
      g.setIndex(ids); return g;
    };
    const one = betaEyeCells(half(0));
    expect(one === null || one.flat().some((c) => !c)).toBe(true); // neither half alone has every cell
    expect(betaEyeCells([half(0), half(1)])!.map((e) => e.filter(Boolean).length)).toEqual([9, 9]);
  });

  it('a model without the blocks is left alone', () => {
    const g = new Group(); g.add(new Mesh(undefined, new MeshBasicMaterial()));
    expect(rigBetaEyes(g)).toBeNull();
    expect(BETA_EYE_BLOCKS).toHaveLength(2);
  });

  it('patches every atlas material once, on its own program key, and takes each eye\'s gaze clamped', async () => {
    const { scene } = await load();
    const mats: MeshBasicMaterial[] = [];
    scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) { const mat = new MeshBasicMaterial({ map: new Texture() }); m.material = mat; mats.push(mat); }
    });
    const rig = rigBetaEyes(scene)!;
    expect(rig.cells).toEqual([9, 9]);
    // The template's materials are left alone; the fish patches its own copies.
    for (const m of mats) expect(m.customProgramCacheKey()).not.toContain('mq-beta-eyes-v1');
    mats.length = 0;
    scene.traverse((o) => { const m = o as Mesh; if (m.isMesh) mats.push(m.material as MeshBasicMaterial); });
    for (const m of mats) expect(m.customProgramCacheKey()).toContain('mq-beta-eyes-v1');
    const shader = { vertexShader: '#include <begin_vertex>', fragmentShader: '#include <map_pars_fragment>\n#include <map_fragment>', uniforms: {} as Record<string, { value: unknown }> };
    mats[0]!.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('vBetaP = position');
    expect(shader.fragmentShader).toContain('mqBetaEyeUv( vMapUv )');
    rig.set([{ fwd: 3, up: -3 }, { fwd: 0.25, up: 0.5 }]);
    const gaze = shader.uniforms.uBetaGaze!.value as Array<{ x: number; y: number }>;
    expect([gaze[0]!.x, gaze[0]!.y, gaze[1]!.x, gaze[1]!.y]).toEqual([1, -1, 0.25, 0.5]);
  });
});

describe('betafish: each temperament looks its own way', () => {
  const cue = { camera: { fwd: 0.8, up: 0.2 }, turn: 0, cruise: 0 };
  const darts = (slot: number, style: Parameters<typeof mintedLook>[4]): number => {
    // How often the gaze jumps: frames where it moves more than a sliver.
    let prev = 0, n = 0;
    for (let t = 0; t < 120; t += 1 / 30) {
      const out = [{ fwd: 0, up: 0 }, { fwd: 0, up: 0 }];
      mintedLook(slot, t, cue, out, style);
      if (Math.abs(out[0]!.fwd - prev) > 0.02) n++;
      prev = out[0]!.fwd;
    }
    return n;
  };
  const of = (temper: string): number => [...Array(80).keys()].find((i) => betaPersonality(i).temper === temper)!;

  it('a fighter\'s eyes dart often; a dreamer\'s drift — they move far less', () => {
    expect(darts(of('fighter'), BETA_LOOK_STYLE.fighter)).toBeGreaterThan(darts(of('dreamer'), BETA_LOOK_STYLE.dreamer));
  });

  it('a showoff seeks the camera more often than a dreamer', () => {
    const atViewer = (slot: number, style: Parameters<typeof mintedLook>[4]): number => {
      let n = 0;
      for (let t = 0; t < 300; t += 0.25) if (mintedLook(slot, t, cue, [{ fwd: 0, up: 0 }, { fwd: 0, up: 0 }], style) === 'viewer') n++;
      return n;
    };
    expect(atViewer(of('showoff'), BETA_LOOK_STYLE.showoff)).toBeGreaterThan(atViewer(of('dreamer'), BETA_LOOK_STYLE.dreamer));
  });

  it('locked on, both eyes hold the viewer whatever else they would do', () => {
    for (let t = 0; t < 30; t += 0.37) {
      const out = [{ fwd: 0, up: 0 }, { fwd: 0, up: 0 }];
      mintedLook(of('fighter'), t, cue, out, { ...BETA_LOOK_STYLE.fighter, lock: 1 });
      for (const e of out) { expect(e.fwd).toBeCloseTo(0.8, 9); expect(e.up).toBeCloseTo(0.2, 9); }
    }
  });

  it('the default look is every other minted breed\'s, unchanged', () => {
    for (let t = 0; t < 30; t += 0.41) {
      const a = [{ fwd: 0, up: 0 }, { fwd: 0, up: 0 }], b = [{ fwd: 0, up: 0 }, { fwd: 0, up: 0 }];
      mintedLook(5, t, cue, a); mintedLook(5, t, cue, b, { hold: [0.7, 2.6], dart: 0.12, amp: 1, viewerEvery: 1, lock: 0 });
      expect(a).toEqual(b);
    }
  });
});
