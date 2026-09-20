import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, ShaderLib, type Material, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { eyeMood, rigEyes, type EyeCue, type EyeState } from './eyes';

// A one-voxel-deep eye slab on the +x (or -x) side of a fish: `rows` top to
// bottom, `#` black `.` white — the same construction as eye-grid.test.ts,
// but emitting real BufferGeometry instead of flat position arrays, since
// rigEyes (unlike analyseEyes) walks an actual Object3D scene graph.
function slabGeometry(rows: string[], side: 1 | -1, kind: 'white' | 'black', voxel = 0.5, at: [number, number, number] = [2, 1, 3]): BufferGeometry | null {
  const pos: number[] = [];
  const h = rows.length;
  rows.forEach((line, r) => [...line].forEach((ch, k) => {
    if (ch === '_') return;
    if ((ch === '#') !== (kind === 'black')) return;
    const x0 = at[0] * side, x1 = x0 + voxel * side;
    const y0 = at[1] + (h - 1 - r) * voxel, y1 = y0 + voxel, z0 = at[2] + k * voxel, z1 = z0 + voxel;
    const quad = (a: number[], b: number[], c: number[], d: number[]): void => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); };
    if (side > 0) quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); else quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]);
    if (r === 0) quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
    if (k === line.length - 1) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  }));
  if (!pos.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
}

const eyeMaterial = (kind: 'sclera' | 'pupil'): MeshBasicMaterial => {
  const m = new MeshBasicMaterial();
  m.userData.mqEye = kind;
  return m;
};

/** A betafish-like body: a 3x3 eye slab on each side, sclera and pupil as
 *  separate meshes (as the shipped models do it). */
function eyeBody(rows: string[] = ['...', '.#.', '...']): { group: Group; body: Group } {
  const body = new Group();
  for (const side of [1, -1] as const) {
    const white = slabGeometry(rows, side, 'white');
    const black = slabGeometry(rows, side, 'black');
    if (white) body.add(new Mesh(white, eyeMaterial('sclera')));
    if (black) body.add(new Mesh(black, eyeMaterial('pupil')));
  }
  const group = new Group();
  group.add(body);
  return { group, body };
}

const idle: EyeCue = { doing: 'idle', target: null, camera: { fwd: 0, up: 0.2 }, climb: 0 };
const mood = (t: number, slot: number, cue: EyeCue = idle, amount = 1): EyeState =>
  eyeMood(t, slot, cue, amount, { blink: 0, gazeFwd: 0, gazeUp: 0, dilate: 1, widen: 0, expr: 0 });

describe('eye mood', () => {
  it('is pure in (t, slot) and stays inside the eye', () => {
    for (let t = 0; t < 60; t += 0.37) {
      const a = mood(t, 3), b = mood(t, 3);
      expect(a).toEqual(b);
      expect(Math.abs(a.gazeFwd)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.gazeUp)).toBeLessThanOrEqual(1);
      expect(a.blink).toBeGreaterThanOrEqual(0);
      expect(a.blink).toBeLessThanOrEqual(1);
    }
  });

  it('blinks briefly, on a personal clock: mostly open, and two fish are out of step', () => {
    const shut = (slot: number): number[] => Array.from({ length: 1200 }, (_, i) => (mood(i * 0.05, slot).blink > 0.5 ? 1 : 0));
    const a = shut(0), b = shut(1);
    const frac = a.reduce((s: number, v) => s + v, 0) / a.length;
    expect(frac).toBeGreaterThan(0.005);
    expect(frac).toBeLessThan(0.08);
    expect(a).not.toEqual(b);
  });

  it('saccades: holds a point, then darts — most frames the gaze does not move', () => {
    let still = 0;
    for (let i = 0; i < 400; i++) if (Math.abs(mood(20 + i * 0.02, 5).gazeFwd - mood(20 + (i + 1) * 0.02, 5).gazeFwd) < 1e-6) still++;
    expect(still).toBeGreaterThan(280);
  });

  it('means it: looks where it swims, at who it faces, wide for a hop, shut for a rest', () => {
    expect(mood(3.3, 2, { ...idle, doing: 'moving', climb: 1 }).gazeUp).toBeGreaterThan(0.5);
    expect(mood(3.3, 2, { ...idle, target: { fwd: 1, up: -0.6 } }).gazeFwd).toBeGreaterThan(0.6);
    const hop = mood(3.3, 2, { ...idle, doing: 'hop' });
    expect(hop.dilate).toBeGreaterThan(1.3);
    expect(hop.widen).toBe(1);
    expect(hop.expr).toBe(1);
    expect(mood(3.3, 2, { ...idle, doing: 'wiggle' }).expr).toBe(2);
    expect(mood(3.3, 2, { ...idle, doing: 'rest' }).blink).toBeGreaterThan(0.9);
    expect(mood(3.3, 2, { ...idle, doing: 'talk' }).dilate).toBeGreaterThan(1.05);
    expect(mood(3.3, 2, { ...idle, doing: 'nod' }).blink).toBeGreaterThanOrEqual(0.34);
    expect(mood(3.3, 2, { ...idle, doing: 'shake' }).dilate).toBeLessThan(0.9);
    const peek = mood(3.3, 2, { ...idle, doing: 'peek' });
    expect(peek.widen).toBeCloseTo(0.7, 5);
    expect(peek.expr).toBe(1);
    const bow = mood(3.3, 2, { ...idle, doing: 'bow' });
    expect(bow.gazeUp).toBeLessThan(-0.5);
    expect(bow.blink).toBeGreaterThan(0.9);
  });

  it('scales to nothing at eyeLife 0', () => {
    const off = mood(3.3, 2, { ...idle, doing: 'hop' }, 0);
    for (const k of ['blink', 'gazeFwd', 'gazeUp', 'widen'] as const) expect(off[k]).toBeCloseTo(0, 9);
    expect(off.dilate).toBeCloseTo(1, 9);
  });
});

describe('eye rig', () => {
  it('finds nothing on a body that wears no eye material — left exactly as it was', () => {
    const body = new Group();
    const plain = new MeshBasicMaterial();
    body.add(new Mesh(slabGeometry(['...', '.#.', '...'], 1, 'black')!, plain));
    const group = new Group(); group.add(body);
    expect(rigEyes(group, body)).toBeNull();
    expect(plain.customProgramCacheKey?.()).not.toBe('mq-eye-display-v4');
  });

  it('rigs both eyes of a betafish body and patches only their materials', () => {
    const { group, body } = eyeBody();
    const rig = rigEyes(group, body);
    expect(rig).not.toBeNull();
    expect(rig!.grids).toHaveLength(2);
    for (const g of rig!.grids) expect(g.signature).toBe('3x3 .../.#./...');
    for (const node of body.children) {
      const mat = (node as Mesh).material as MeshBasicMaterial;
      expect(typeof mat.onBeforeCompile).toBe('function');
      expect(mat.customProgramCacheKey?.()).toBe('mq-eye-display-v4');
    }
  });

  it('caps at MAX_EYES and never rigs a plain belly plate as an eye', () => {
    // A slab too large to read as a pupil-in-sclera eye at all.
    const bare = new Group();
    bare.add(new Mesh(slabGeometry(Array.from({ length: 8 }, () => '........'), 1, 'white')!, eyeMaterial('sclera')));
    const outer = new Group(); outer.add(bare);
    expect(rigEyes(outer, bare)).toBeNull();
  });

  it('drives the eye-display shader patch and updates gaze/blink uniforms from set()', () => {
    const { group, body } = eyeBody();
    const rig = rigEyes(group, body)!;
    const material = (body.children[0] as Mesh).material as Material;
    const shader = { uniforms: {}, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader } as Parameters<Material['onBeforeCompile']>[0];
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    // Tokens unique to the patched-in body, not just the prepended uniform/varying declarations.
    expect(shader.vertexShader).toContain('vEyeP = (uEyeM * vec4(position, 1.0)).xyz');
    expect(shader.fragmentShader).toContain('mqEyeColor(diffuseColor.rgb)');
    const uEyeS = shader.uniforms.uEyeS as { value: { x: number; y: number; z: number; w: number }[] };
    expect(uEyeS.value).toHaveLength(4); // MAX_EYES, padded

    rig.set({ blink: 1, gazeFwd: 1, gazeUp: -1, dilate: 1.4, widen: 1, expr: 1 });
    const s0 = uEyeS.value[0]!;
    expect([s0.x, s0.y, s0.z, s0.w].every(Number.isFinite)).toBe(true);
    // A fully-shut eye closes every row: z tracks the blink amount, not 0.
    expect(s0.z).toBeGreaterThan(0);

    rig.set({ blink: 0, gazeFwd: 0, gazeUp: 0, dilate: 1, widen: 0, expr: 0 });
    expect(s0.z).toBe(0);
  });

  it('shares one gaze rig across every eye material patched on the same body', () => {
    const { group, body } = eyeBody();
    const rig = rigEyes(group, body)!;
    const materials = body.children.map((n) => (n as Mesh).material as Material);
    const shaders = materials.map((mat) => {
      const shader = { uniforms: {}, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader } as Parameters<Material['onBeforeCompile']>[0];
      mat.onBeforeCompile(shader, {} as WebGLRenderer);
      return shader;
    });
    rig.set({ blink: 1, gazeFwd: 0.5, gazeUp: -0.5, dilate: 1, widen: 0, expr: 0 });
    const first = (shaders[0]!.uniforms.uEyeS as { value: unknown[] }).value;
    for (const shader of shaders.slice(1)) {
      expect((shader.uniforms.uEyeS as { value: unknown[] }).value).toBe(first); // same shared uniform object
    }
  });
});
