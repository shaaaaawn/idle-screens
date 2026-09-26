import { describe, expect, it } from 'vitest';
import { Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial, ShaderChunk, type Material } from 'three';
import { cloneWithHooks, hasPatch, stackPatch } from './hooks';
import { rigSwimWave, waveOffset, waveProfile, waveState, type WaveState } from './swimwave';

const blank = (): WaveState => ({ phase: 0, amp: 0, bend: 0 });
type Shader = Parameters<Material['onBeforeCompile']>[0];
const shaderOf = (): Shader => ({
  uniforms: {},
  vertexShader: `void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}`,
  fragmentShader: 'void main() {}',
} as unknown as Shader);
const compile = (m: Material): Shader => { const s = shaderOf(); m.onBeforeCompile(s, undefined as never); return s; };

/** A fish: a long box along +z, split in two meshes sharing one template material. */
function fish(): { group: Group; body: Group; shared: MeshBasicMaterial } {
  const group = new Group(), body = new Group();
  const shared = new MeshBasicMaterial();
  const front = new Mesh(new BoxGeometry(2, 3, 10), shared); front.position.z = 5;
  const back = new Mesh(new BoxGeometry(2, 3, 10), shared); back.position.z = -5;
  body.add(front, back); group.add(body);
  return { group, body, shared };
}

describe('waveProfile', () => {
  it('skips breeds whose motion is not a body wave', () => {
    for (const b of ['seaturtle', 'seahorse', 'crab', 'jellyfish']) expect(waveProfile(b, fish().body)).toBe(false);
    expect(waveProfile('angelfish', fish().body)).toBe(true);
  });
  it('skips a model with a skeleton: it already bends', () => {
    const { body } = fish(); body.add(new Bone());
    expect(waveProfile('betafish', body)).toBe(false);
  });
  it('an unknown model waves only when it is longer than it is tall', () => {
    expect(waveProfile(null, fish().body)).toBe(true);
    const upright = new Group(); upright.add(new Mesh(new BoxGeometry(2, 20, 4), new MeshBasicMaterial()));
    expect(waveProfile(null, upright)).toBe(false);
  });
});

describe('waveState / waveOffset', () => {
  it('is zero everywhere at amount 0', () => {
    const w = waveState(123, 18, 1, 0.5, 0, blank());
    for (const s of [0, 0.3, 0.7, 1]) expect(waveOffset(s, w)).toBe(0);
  });
  it('beats with distance: one tail beat per 0.7 body length', () => {
    const a = waveState(0, 18, 0, 0, 1, blank()).phase;
    const b = waveState(18 * 0.7, 18, 0, 0, 1, blank()).phase;
    expect(b - a).toBeCloseTo(Math.PI * 2, 6);
  });
  it('swings the tail much more than the head', () => {
    let head = 0, tail = 0;
    for (let i = 0; i < 64; i++) {
      const w = waveState(i * 0.4, 18, 0, 0, 1, blank());
      head = Math.max(head, Math.abs(waveOffset(0.05, w)));
      tail = Math.max(tail, Math.abs(waveOffset(1, w)));
    }
    expect(tail).toBeGreaterThan(head * 8);
    expect(tail).toBeLessThan(0.15); // a cruising tail, not a thrash
  });
  it('works harder in a flurry', () => {
    expect(waveState(0, 18, 1, 0, 1, blank()).amp).toBeGreaterThan(waveState(0, 18, 0, 0, 1, blank()).amp * 1.5);
  });
  it('curls nose and tail into the turn, and caps a hairpin', () => {
    const w = waveState(0, 18, 0, 0.4, 1, { phase: 0, amp: 0, bend: 0 });
    w.amp = 0;
    expect(waveOffset(0, w)).toBeGreaterThan(0);
    expect(waveOffset(1, w)).toBeCloseTo(waveOffset(0, w), 9);
    expect(waveOffset(0.5, w)).toBe(0);
    expect(waveState(0, 18, 0, 50, 1, blank()).bend).toBeLessThanOrEqual(0.9);
    expect(waveState(0, 18, 0, -0.4, 1, blank()).bend).toBeLessThan(0);
  });
});

describe('rigSwimWave', () => {
  it('gives every mesh its own owned material and patches it', () => {
    const { group, body, shared } = fish();
    const rig = rigSwimWave(group, body)!;
    expect(rig.meshes).toBe(2);
    const [a, b] = body.children as Mesh[];
    expect(a!.material).not.toBe(shared);
    expect(a!.material).not.toBe(b!.material);
    for (const m of [a!, b!]) {
      const mat = m.material as Material;
      expect(mat.userData.mqOwned).toBe(true);
      const s = compile(mat);
      expect(s.vertexShader).toContain('uWaveTo');
      expect(s.vertexShader).toContain('#include <project_vertex>');
      expect(s.uniforms.uWave).toBeDefined();
    }
    // Each mesh carries its own frame into the fish.
    const sa = compile(a!.material as Material), sb = compile(b!.material as Material);
    expect(sa.uniforms.uWaveTo).not.toBe(sb.uniforms.uWaveTo);
    // The body's nose and length, measured in the fish frame.
    const bodyU = sa.uniforms.uWaveBody!.value as { x: number; y: number };
    expect(bodyU.x).toBeCloseTo(10, 5);
    expect(bodyU.y).toBeCloseTo(20, 5);
  });
  it('returns when something assigns over its hook (the eye rig does)', () => {
    const { group, body } = fish();
    const rig = rigSwimWave(group, body)!;
    const mesh = body.children[0] as Mesh, mat = mesh.material as Material;
    mat.onBeforeCompile = (sh) => { sh.vertexShader = `// eye\n${sh.vertexShader}`; };
    mat.customProgramCacheKey = () => 'mq-eye-display-v4';
    expect(hasPatch(mat, 'mq-wave-v1')).toBe(false);
    rig.ensure();
    const s = compile(mat);
    expect(s.vertexShader).toContain('// eye');
    expect(s.vertexShader).toContain('uWaveTo');
    expect(mat.customProgramCacheKey()).toBe('mq-eye-display-v4|mq-wave-v1');
    // And a second ensure leaves it alone (no recompile every frame).
    const hook = mat.onBeforeCompile;
    rig.ensure();
    expect(mat.onBeforeCompile).toBe(hook);
  });
  it('follows a material swap (tinting clones materials)', () => {
    const { group, body } = fish();
    const rig = rigSwimWave(group, body)!;
    const mesh = body.children[0] as Mesh;
    mesh.material = new MeshBasicMaterial();
    rig.ensure();
    expect(compile(mesh.material as Material).vertexShader).toContain('uWaveTo');
  });
  it('settles when another stacked patch re-applies alongside it every frame (water does)', () => {
    const { group, body } = fish();
    const rig = rigSwimWave(group, body)!;
    const mat = (body.children[0] as Mesh).material as Material;
    let hook = mat.onBeforeCompile, key = mat.customProgramCacheKey();
    for (let frame = 0; frame < 6; frame++) {
      stackPatch(mat, 'mq-water-v1', (sh) => { sh.fragmentShader += '//water'; });
      rig.ensure();
      if (frame > 0) {
        expect(mat.onBeforeCompile).toBe(hook);
        expect(mat.customProgramCacheKey()).toBe(key);
      }
      hook = mat.onBeforeCompile; key = mat.customProgramCacheKey();
    }
    const s = compile(mat);
    expect(s.vertexShader.match(/uniform vec3 uWave;/g)).toHaveLength(1);
    expect(s.fragmentShader.match(/\/\/water/g)).toHaveLength(1);
  });
  it('never shares a material with another fish\'s wave', () => {
    const a = fish(), b = fish();
    const shared = new MeshBasicMaterial(); shared.userData.mqOwned = true;
    for (const f of [a, b]) for (const m of f.body.children as Mesh[]) m.material = shared;
    rigSwimWave(a.group, a.body); rigSwimWave(b.group, b.body);
    const mats = [...a.body.children, ...b.body.children].map((m) => (m as Mesh).material);
    expect(new Set(mats).size).toBe(4);
  });
  it('sets the shared wave uniform', () => {
    const { group, body } = fish();
    const rig = rigSwimWave(group, body)!;
    rig.set({ phase: 1, amp: 0.1, bend: -0.2 });
    const v = compile((body.children[1] as Mesh).material as Material).uniforms.uWave!.value as { x: number; y: number; z: number };
    expect([v.x, v.y, v.z]).toEqual([1, 0.1, -0.2]);
  });
});

describe('hooks', () => {
  it('stacks patches in order and keys the program by the whole chain', () => {
    const m = new MeshBasicMaterial();
    stackPatch(m, 'a', (s) => { s.vertexShader += '//a'; });
    stackPatch(m, 'b', (s) => { s.vertexShader += '//b'; });
    expect(stackPatch(m, 'a', () => {})).toBe(false);
    expect(compile(m).vertexShader.endsWith('//a//b')).toBe(true);
    expect(m.customProgramCacheKey().endsWith('|a|b')).toBe(true);
    expect(new MeshBasicMaterial().customProgramCacheKey()).not.toBe(m.customProgramCacheKey());
  });
  it('cloneWithHooks keeps a patched material patched', () => {
    const m = new MeshBasicMaterial();
    stackPatch(m, 'a', (s) => { s.vertexShader += '//a'; });
    const c = cloneWithHooks(m);
    expect(compile(c).vertexShader.endsWith('//a')).toBe(true);
    expect(hasPatch(c, 'a')).toBe(true);
    expect(c.customProgramCacheKey()).toBe(m.customProgramCacheKey());
  });
  it('the real three vertex chunk carries both anchors the wave needs', () => {
    expect(ShaderChunk.meshbasic_vert).toContain('#include <project_vertex>');
    expect(ShaderChunk.meshphysical_vert).toContain('#include <project_vertex>');
  });
});
