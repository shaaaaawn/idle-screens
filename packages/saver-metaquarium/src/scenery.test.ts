import { createRng } from '@idle-screens/core';
import { Mesh, Points, ShaderLib, type WebGLRenderer, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { buildScenery, type SceneryOptions } from './scenery';

const off: SceneryOptions = { rocks: 0, homes: 0, flora: 0, bubbles: 0, snow: 0, cap: 8, scale: 1 };
const full: SceneryOptions = { ...off, rocks: 1, homes: 3, flora: 1, bubbles: 1, snow: 1 };
const terrain = (x: number, z: number): number => Math.sin(x * 0.02) * 3 + Math.cos(z * 0.03) * 4;
const build = (options = full, seed = 42) => buildScenery([], createRng(seed), terrain, options);
const buffers = (world: ReturnType<typeof build>) => world.group.children.map(o => {
  const mesh = o as Mesh;
  return [o.name, ...Array.from(mesh.geometry.getAttribute('position').array)];
});

describe('mineral world', () => {
  it('leaves old scenes empty and without collision volumes', () => {
    const world = build(off);
    expect(world.group.children).toHaveLength(0);
    expect(world.clearance(0, 0)).toBe(-Infinity);
  });
  it('rebuilds identical geometry from a seed, without one layer perturbing another', () => {
    expect(buffers(build())).toEqual(buffers(build()));
    expect(buffers(build(full, 43))).not.toEqual(buffers(build()));
    const geology = (opts: SceneryOptions) => buffers(build(opts)).filter(b => b[0] === 'rock-formations');
    expect(geology(full)).toEqual(geology({ ...full, flora: 0, bubbles: 0, snow: 0 }));
  });
  it('batches every layer with finite geometry and owned resources', () => {
    const world = build();
    expect(world.group.children.length).toBeLessThanOrEqual(7);
    for (const object of world.group.children) {
      expect(object instanceof Mesh || object instanceof Points).toBe(true);
      const mesh = object as Mesh;
      expect(mesh.geometry.userData.mqOwned).toBe(true);
      expect((mesh.material as Material).userData.mqOwned).toBe(true);
      for (const attr of Object.values(mesh.geometry.attributes)) {
        expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
        expect(attr.count).toBe(mesh.geometry.getAttribute('position').count);
      }
    }
    expect(world.counts.homes).toBe(3);
    expect(world.vents).toHaveLength(3);
  });
  it('reduces population on weak devices while keeping each visual layer', () => {
    const world = build({ ...full, cap: 4 });
    expect(world.counts.homes).toBe(2);
    expect(world.counts.flora).toBe(20);
    expect(world.counts.bubbles).toBe(48);
    expect(world.counts.snow).toBe(100);
    expect(world.counts.arches).toBe(1);
  });
  it('keeps the arch opening traversable and protects occupied home footprints', () => {
    const world = build();
    expect(world.clearance(-48, -65)).toBe(-Infinity);
    expect(world.clearance(0, -39)).toBeGreaterThan(20);
  });
  it('rewinds every animated layer without accumulated motion and separates particle programs', () => {
    const world = build();
    const clocks: { value: unknown }[] = [];
    const particlePrograms: string[] = [];
    for (const object of world.group.children) {
      const material = (object as Mesh).material as Material;
      const source = object instanceof Points ? ShaderLib.points : ShaderLib.basic;
      const shader = { uniforms: {}, vertexShader: source.vertexShader, fragmentShader: source.fragmentShader } as Parameters<Material['onBeforeCompile']>[0];
      material.onBeforeCompile(shader, {} as WebGLRenderer);
      for (const [name, uniform] of Object.entries(shader.uniforms)) {
        if (name.endsWith('Time')) clocks.push(uniform);
      }
      if (object instanceof Points) particlePrograms.push(material.customProgramCacheKey());
    }
    expect(clocks).toHaveLength(3);
    expect(new Set(particlePrograms).size).toBe(2);
    const before = buffers(world);
    world.setFrame(73.5);
    expect(clocks.every(c => c.value === 73.5)).toBe(true);
    world.setFrame(0);
    expect(clocks.every(c => c.value === 0)).toBe(true);
    expect(buffers(world)).toEqual(before);
  });

});
