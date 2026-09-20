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
    expect(world.group.children.length).toBeLessThanOrEqual(9); // + the spores
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
    expect(world.counts.flora).toBeGreaterThan(24); // 4 × 9, less any rooted where a home stands
    expect(world.counts.flora).toBeLessThanOrEqual(36);
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
    expect(clocks).toHaveLength(6);
    expect(new Set(particlePrograms).size).toBe(3);
    const before = buffers(world);
    world.setFrame(73.5);
    expect(clocks.every(c => c.value === 73.5)).toBe(true);
    world.setFrame(0);
    expect(clocks.every(c => c.value === 0)).toBe(true);
    expect(buffers(world)).toEqual(before);
  });

  it('steps a home back from a crystal cluster that would overlap it', () => {
    // Sits on top of the lone home's naive spawn point (homeCount=1 → t=0 →
    // x≈0, z≈-38), with a radius wide enough that the ±5u seeded jitter
    // can't dodge it — every pass through the homes loop must displace it.
    // Isolated to `homes: 1` with everything else off so the only obstacle
    // in play is the home itself: if the step-back loop were deleted, the
    // home would stay at its spawn point and clearance there would be
    // finite (its own footprint), not -Infinity.
    const cluster: Cluster = {
      id: null, habit: 'lotus', x: 0, y: 0, z: -38, color: '#49cfff', accent: '#49cfff',
      glass: false, radius: 60, height: 30, phase: 0, shards: [],
    };
    const blocked = build({ ...off, homes: 1 }, 42, [cluster]);
    expect(blocked.counts.homes).toBe(1);
    expect(blocked.clearance(0, -38)).toBe(-Infinity);
    for (const object of blocked.group.children) {
      const mesh = object as Mesh;
      for (const attr of Object.values(mesh.geometry.attributes)) {
        expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('builds the room behind a geode door INSTEAD of the outdoor scene', () => {
    // All outdoor layers off (`off`) plus interior — if `interior` stopped
    // suppressing the unconditional boulder/arch/home/flora builds, this
    // would catch it via the counts, not just "something got added".
    const world = build({ ...off, interior: true });
    expect(world.counts.rocks).toBe(0);
    expect(world.counts.homes).toBe(0);
    expect(world.counts.flora).toBe(0);
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

  /** Drives a mesh's onBeforeCompile and customProgramCacheKey the way
   *  three.js would when it actually compiles the program — the source of
   *  the shader patch and its cache key, both otherwise only ever called
   *  by a real renderer. Returns the patched shader so callers can assert
   *  the replace() actually landed, not just that it ran without throwing. */
  const patchShader = (mesh: Mesh): Parameters<Material['onBeforeCompile']>[0] => {
    const material = mesh.material as Material;
    const shader = { uniforms: {}, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader } as Parameters<Material['onBeforeCompile']>[0];
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    material.customProgramCacheKey?.();
    return shader;
  };

  it('fills the sky with jellyfish lanterns and lights their glow cards', () => {
    const world = build({ ...off, lanterns: 1 });
    expect(world.counts.lanterns).toBeGreaterThan(0);
    const lanterns = world.group.children.find(o => o.name === 'sky-lanterns') as Mesh | undefined;
    expect(lanterns).toBeDefined();
    const shader = patchShader(lanterns!);
    // Tokens unique to the replaced-in shader body — not the unconditionally
    // prepended `uniform float uSkyTime` declaration, which would still be
    // present even if the #include marker it replaces stopped matching.
    expect(shader.vertexShader).toContain('transformed = home + local');
    expect(shader.vertexShader).toContain('vColor.rgb *= 1.0 + aGlow');
    expect(shader.uniforms.uSkyTime).toBeDefined();
    for (const object of world.group.children) {
      const mesh = object as Mesh;
      if (!mesh.geometry) continue;
      for (const attr of Object.values(mesh.geometry.attributes)) {
        expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
      }
    }
    // setFrame's lantern glow-card commit only runs with a fog argument.
    expect(() => world.setFrame(9, { color: new Color('#000'), near: 10, far: 100 }, 0.7)).not.toThrow();
  });

  it('stands a hazed horizon of spires, castle crystals and a grand geode past the fog line', () => {
    const world = build({ ...off, horizon: 1 });
    expect(world.counts.horizon).toBeGreaterThan(0);
    const horizon = world.group.children.find(o => o.name === 'horizon') as Mesh | undefined;
    expect(horizon).toBeDefined();
    const shader = patchShader(horizon!);
    // Tokens unique to the replaced-in shader body — not the unconditionally
    // prepended `varying`/`uniform` declarations, which would still be
    // present even if the #include marker they replace stopped matching.
    expect(shader.vertexShader).toContain('smoothstep(0.0, aHaze.y, position.y)');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb * vHorizon');
    expect(shader.uniforms.uHorizonFog).toBeDefined();
    for (const object of world.group.children) {
      const mesh = object as Mesh;
      if (!mesh.geometry) continue;
      for (const attr of Object.values(mesh.geometry.attributes)) {
        expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
      }
    }
    expect(() => world.setFrame(5, { color: new Color('#123'), near: 10, far: 100 }, 0.5)).not.toThrow();
  });

  it('never stands a sky or horizon indoors', () => {
    const world = build({ ...off, lanterns: 1, horizon: 1, interior: true });
    expect(world.counts.lanterns).toBeUndefined();
    expect(world.counts.horizon).toBeUndefined();
    expect(world.group.children.some(o => o.name === 'sky-lanterns' || o.name === 'horizon')).toBe(false);
  });

  it('raises a castle behind the village, its keep a grand geode home', () => {
    const world = build({ ...off, homes: 1, castle: 1 });
    expect(world.counts.castle).toBe(1);
    expect(world.group.children.some(o => o.name === 'castle-masonry')).toBe(true);
    expect(world.group.children.some(o => o.name === 'castle-spires')).toBe(true);
    expect(Object.keys(world.marks).length).toBeGreaterThan(0);
    for (const object of world.group.children) {
      const mesh = object as Mesh;
      if (!mesh.geometry) continue;
      for (const attr of Object.values(mesh.geometry.attributes)) {
        expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('never raises a castle indoors', () => {
    const world = build({ ...off, castle: 1, interior: true });
    expect(world.counts.castle).toBeUndefined();
    expect(world.group.children.some(o => o.name.startsWith('castle-'))).toBe(false);
  });

});
