import { createRng } from '@idle-screens/core';
import { Color, Mesh, Points, ShaderLib, type WebGLRenderer, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import type { Cluster } from './crystals';
import { buildScenery, type SceneryOptions } from './scenery';

const off: SceneryOptions = { rocks: 0, veins: 0.7, homes: 0, flora: 0, bubbles: 0, snow: 0, cap: 8, scale: 1 };
const full: SceneryOptions = { ...off, rocks: 1, homes: 3, flora: 1, bubbles: 1, snow: 1 };
const terrain = (x: number, z: number): number => Math.sin(x * 0.02) * 3 + Math.cos(z * 0.03) * 4;
const build = (options = full, seed = 42, clusters: readonly Cluster[] = []) =>
  buildScenery(clusters, createRng(seed), terrain, options);
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
    expect(world.counts.flora).toBeGreaterThan(16); // 4 × 6, less any rooted where a home stands
    expect(world.counts.flora).toBeLessThanOrEqual(24);
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

  it('steps a home back from a crystal cluster that would overlap it', () => {
    // Sits on top of the middle home's naive spawn point (t=0 → x≈0, z≈-38),
    // with a radius wide enough that the ±5u seeded jitter can't dodge it —
    // every pass through the homes loop must displace it.
    const cluster: Cluster = {
      id: null, habit: 'lotus', x: 0, y: 0, z: -38, color: '#49cfff', accent: '#49cfff',
      glass: false, radius: 60, height: 30, phase: 0, shards: [],
    };
    const clear = build(full, 42, []);
    const blocked = build(full, 42, [cluster]);
    expect(blocked.counts.homes).toBe(3);
    expect(buffers(blocked)).not.toEqual(buffers(clear));
    for (const object of blocked.group.children) {
      const mesh = object as Mesh;
      for (const attr of Object.values(mesh.geometry.attributes)) {
        expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('builds the room behind a geode door instead of an outdoor scene', () => {
    const world = build({ ...full, interior: true });
    expect(world.counts.interior).toBe(1);
    expect(world.counts.furniture).toBeGreaterThan(0);
    expect(world.emitters.length).toBeGreaterThan(0);
    const cards = world.group.children.find(o => o.userData.mqLights !== undefined);
    expect(cards).toBeDefined();
    for (const object of world.group.children) {
      const mesh = object as Mesh;
      if (!mesh.geometry) continue;
      for (const attr of Object.values(mesh.geometry.attributes)) {
        expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
      }
    }
    // setFrame's fog-driven glow-card commit only runs with a fog argument.
    expect(() => world.setFrame(12, { color: new Color('#000'), near: 10, far: 100 }, 0.6)).not.toThrow();
  });

});
