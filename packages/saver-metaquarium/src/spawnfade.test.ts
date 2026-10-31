import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, ShaderLib, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { patchSpawnFade, rigSpawnFade, spawnAmount, type SpawnUniform } from './spawnfade';
import { patchNearFade } from './nearfade';
import { METAQUARIUM_PARAMS } from './manifest';
import { PARAM_DOCS } from './guide';

type Shader = { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string };
const compile = (m: Material, src = ShaderLib.lambert): Shader => {
  const s = { uniforms: {}, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
  m.onBeforeCompile(s as never, null as never);
  return s;
};

describe('fishFadeIn', () => {
  it('is off by default and documented', () => {
    expect(METAQUARIUM_PARAMS.fishFadeIn).toMatchObject({ type: 'number', default: 0, min: 0, max: 3 });
    expect(PARAM_DOCS.fishFadeIn).toMatch(/pops in/);
  });

  it('eases from nothing to whole over the fade, and is whole without one or before arrival', () => {
    expect(spawnAmount(0, 1)).toBe(0);
    expect(spawnAmount(0.5, 1)).toBeCloseTo(0.5, 9);
    expect(spawnAmount(1, 1)).toBe(1);
    expect(spawnAmount(5, 1)).toBe(1);
    expect(spawnAmount(0, 0)).toBe(1);
    expect(spawnAmount(-0.2, 1)).toBe(1); // a still rendered before the fish arrived
  });

  it('binds each fish to its own fade, once', () => {
    const fishA = new Group(), fishB = new Group();
    const coatA = new MeshLambertMaterial(), coatB = new MeshLambertMaterial(), eyeA = new MeshBasicMaterial();
    fishA.add(new Mesh(new BoxGeometry(), coatA), new Mesh(new BoxGeometry(), eyeA));
    fishB.add(new Mesh(new BoxGeometry(), coatB));
    const a: SpawnUniform = { value: 0.3 }, b: SpawnUniform = { value: 1 };
    rigSpawnFade(fishA, a);
    rigSpawnFade(fishB, b);
    rigSpawnFade(fishA, b); // already bound: stays with a
    expect(compile(coatA).uniforms.uMqSpawn).toBe(a);
    expect(compile(eyeA, ShaderLib.basic).uniforms.uMqSpawn).toBe(a);
    expect(compile(coatB).uniforms.uMqSpawn).toBe(b);
    expect(compile(coatA).fragmentShader).toMatch(/mqSpawnB4\(gl_FragCoord\.xy\) >= uMqSpawn\) discard/);
  });

  it('stacks with the near fade on one material without a name clash', () => {
    const m = new MeshLambertMaterial();
    patchNearFade(m);
    patchSpawnFade(m, { value: 1 });
    const f = compile(m).fragmentShader;
    expect(f).toMatch(/float mqBayer4\(/);
    expect(f).toMatch(/float mqSpawnB4\(/);
    expect(f.match(/float mqBayer4\(/g)).toHaveLength(1);
  });
});
