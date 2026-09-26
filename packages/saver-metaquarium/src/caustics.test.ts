import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, MeshStandardMaterial, PointsMaterial, Scene, ShaderMaterial, BoxGeometry, AdditiveBlending, type Material } from 'three';
import { applyCaustics, causticAt, CAUSTIC_FUNCS, CAUSTIC_LAYERS, CAUSTIC_WINDOW, causticUniforms, patchCaustics, voronoiEdge } from './caustics';
import { installFloorPools } from './crystal-mesh';
import { stackPatch } from './hooks';

type Shader = Parameters<Material['onBeforeCompile']>[0];
const compile = (m: Material): Shader => {
  const s = { uniforms: {}, vertexShader: 'void main(){\n#include <project_vertex>\n}', fragmentShader: 'void main(){\nvec3 outgoingLight;\n#include <opaque_fragment>\n}' } as unknown as Shader;
  m.onBeforeCompile(s, undefined as never);
  return s;
};

describe('caustics', () => {
  const u = { strength: 1, cell: 12, t: 37.5, surface: 132 };
  it('redistributes light: mean about 1, bright lines, dark cells', () => {
    let sum = 0, n = 0, max = 0, min = 9;
    for (let x = -60; x < 60; x += 0.7) for (let z = -60; z < 60; z += 0.9) {
      const c = causticAt(x, 40, z, u); sum += c; n++; max = Math.max(max, c); min = Math.min(min, c);
    }
    expect(sum / n).toBeGreaterThan(0.85);
    expect(sum / n).toBeLessThan(1.2);
    expect(max).toBeGreaterThan(1.8);
    expect(min).toBeLessThan(0.7);
  });
  it('is 1 everywhere at strength 0, and fades with depth', () => {
    expect(causticAt(3, 40, 7, { ...u, strength: 0 })).toBe(1);
    const spread = (y: number) => {
      let lo = 9, hi = 0;
      for (let x = 0; x < 40; x += 0.5) { const c = causticAt(x, y, 5, u); lo = Math.min(lo, c); hi = Math.max(hi, c); }
      return hi - lo;
    };
    expect(spread(120)).toBeGreaterThan(spread(-100));
  });
  it('repeats exactly over the window, so t mod 1200 is seamless', () => {
    for (const [x, z] of [[1, 2], [30, -14], [-55, 40]] as const) {
      expect(causticAt(x, 20, z, { ...u, t: 100 })).toBeCloseTo(causticAt(x, 20, z, { ...u, t: 100 + CAUSTIC_WINDOW }), 3);
    }
    expect(voronoiEdge(0.3, 0.7, 1)).toBeGreaterThanOrEqual(0);
  });
  it('patches opaque surfaces only, stacks with other patches, and never twice', () => {
    const basic = new MeshBasicMaterial(), std = new MeshStandardMaterial();
    stackPatch(basic, 'mq-floor-pools', (s) => { s.fragmentShader += '//pools'; });
    expect(patchCaustics(basic)).toBe(true);
    expect(patchCaustics(basic)).toBe(false);
    expect(patchCaustics(std)).toBe(true);
    const s = compile(basic);
    expect(s.fragmentShader).toContain('//pools');
    expect(s.fragmentShader).toContain('mqCaustic(vMqCausticW');
    expect(s.vertexShader).toContain('vMqCausticW = ');
    expect(s.uniforms.uMqCaustic).toBeDefined();
    // Layers are a uniform the tier sets, never a macro two patches could disagree on.
    expect(compile(std).uniforms.uMqCausticLayers).toBe(CAUSTIC_LAYERS);
    expect(compile(std).fragmentShader).not.toMatch(/#define MQ_CAUSTIC_LAYERS/);
    for (const skip of [new ShaderMaterial(), new PointsMaterial(), new MeshBasicMaterial({ transparent: true }), new MeshBasicMaterial({ blending: AdditiveBlending })]) {
      expect(patchCaustics(skip)).toBe(false);
    }
  });
  it('applyCaustics walks a scene and is a no-op the second time', () => {
    const scene = new Scene();
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()), new Mesh(new BoxGeometry(), [new MeshBasicMaterial(), new MeshStandardMaterial()]));
    expect(applyCaustics(scene)).toBe(3);
    expect(applyCaustics(scene)).toBe(0);
  });
  it('never lights a light: materials marked mqNoCaustic are left alone, and clones stay marked', () => {
    const glow = new MeshBasicMaterial();
    glow.userData.mqNoCaustic = true;
    expect(patchCaustics(glow)).toBe(false);
    expect(patchCaustics(glow.clone())).toBe(false);
  });
  it('the spot pools and the surface net stack either way round with ONE copy of the functions', () => {
    const pools = { uMqPoolN: { value: 0 } } as never;
    const count = (src: string) => (src.match(/float mqVoronoiEdge\(/g) ?? []).length;
    const poolsFirst = new MeshBasicMaterial();
    installFloorPools(poolsFirst, pools);
    patchCaustics(poolsFirst);
    const netFirst = new MeshBasicMaterial();
    patchCaustics(netFirst);
    installFloorPools(netFirst, pools);
    for (const m of [poolsFirst, netFirst]) {
      const s = { uniforms: {}, vertexShader: 'void main(){\n#include <project_vertex>\n}', fragmentShader: 'void main(){\n#include <color_fragment>\nvec3 outgoingLight;\n#include <opaque_fragment>\n}' } as never as Shader;
      m.onBeforeCompile(s, undefined as never);
      // Textually twice (guarded), compiled once: the guard is what counts.
      expect(count(s.fragmentShader)).toBeGreaterThanOrEqual(1);
      expect(s.fragmentShader.match(/#ifndef MQ_CAUSTIC_FUNCS/g)!.length).toBe(count(s.fragmentShader));
      expect(s.fragmentShader).toContain('mqCausticNet(vMqW, 9.0)'); // the spot web is the shared net
      expect(s.fragmentShader).toContain('MQ_CAUSTIC_SURFACE');
      expect(s.uniforms.uMqCaustic).toBeDefined();
    }
  });
  it('the shared functions are include-guarded and every consumer can reach the uniforms', () => {
    expect(CAUSTIC_FUNCS.trim().startsWith('#ifndef MQ_CAUSTIC_FUNCS')).toBe(true);
    expect(Object.keys(causticUniforms())).toEqual(['uMqCaustic', 'uMqCausticLayers']);
  });
});
