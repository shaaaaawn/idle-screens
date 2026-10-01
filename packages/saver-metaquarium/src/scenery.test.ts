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
  it('grows real crystal colonies out of the rocks: rooted in the stone, pointing up, cleared by fish', () => {
    const world = build({ ...off, rocks: 1, veins: 0.7 });
    const colonies = world.rockClusters;
    expect(colonies.length).toBeGreaterThan(3);
    expect(world.counts.rockCrystals).toBe(colonies.length);
    for (const c of colonies) {
      // The mineral habits only: a lotus rosette over a split read as a flower.
      expect(['druse', 'spire']).toContain(c.habit);
      expect(c.shards.length).toBeGreaterThan(0);
      expect(c.shards.length).toBeLessThanOrEqual(15); // ≤ 12 × 1.25, the rock budget
      // Out of the breach and up: never flat over a small stone's edge, never down.
      for (const sh of c.shards) expect(sh.ay).toBeGreaterThan(0.3); // ≈ 20° above the horizon at least
    }
    // Fish ride over a rock's colony, not through it (the arch's stands over their heads).
    const onRocks = colonies.filter((c) => world.clearance(c.x, c.z) < c.y);
    expect(onRocks.length).toBeLessThanOrEqual(1);
    for (const c of colonies) if (!onRocks.includes(c)) expect(world.clearance(c.x, c.z)).toBeGreaterThanOrEqual(c.y + c.height * 0.99);
    // Veins 0: plain stone, nothing grows.
    expect(build({ ...off, rocks: 1, veins: 0 }).rockClusters).toHaveLength(0);
    // Seeded.
    expect(build({ ...off, rocks: 1, veins: 0.7 }).rockClusters).toEqual(colonies);
  });
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

  it('cuts the castle\'s spires in the crystals\' own colours', () => {
    // The spire palette is the clusters' colours: two villages of the same
    // shape but different crystals get the same stones under different spires.
    const cluster: Cluster = {
      id: null, habit: 'lotus', x: 80, y: 0, z: 40, color: '#49cfff', accent: '#49cfff',
      glass: false, radius: 20, height: 30, phase: 0, shards: [],
    };
    const spires = (color: string): (string | number)[][] => buffers(build({ ...off, castle: 1 }, 42, [{ ...cluster, color }]))
      .filter(b => b[0] === 'castle-spires');
    const colours = (color: string): number[] => {
      const mesh = build({ ...off, castle: 1 }, 42, [{ ...cluster, color }]).group.children.find(o => o.name === 'castle-spires') as Mesh;
      return Array.from(mesh.geometry.getAttribute('color').array);
    };
    expect(spires('#49cfff')).toEqual(spires('#ff67bc'));
    expect(colours('#49cfff')).not.toEqual(colours('#ff67bc'));
  });

  it('names one program per patched layer, so three never shares a cache entry between two patches', () => {
    // three.js caches compiled programs by customProgramCacheKey: two
    // materials with different onBeforeCompile patches but the same key
    // would silently share one program. Every patched layer names its own.
    const world = build({ ...full, lanterns: 1, horizon: 1, castle: 1 });
    const keys = new Map<string, string>();
    for (const object of world.group.children) {
      const mesh = object as Mesh;
      const material = mesh.material as Material;
      if (!Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey')) continue;
      keys.set(object.name, material.customProgramCacheKey());
    }
    expect(keys.get('voxel-light-flora')).toBe('mineral-flora-v5');
    expect(keys.get('flora-lamps')).toBe('mineral-flora-lamps-v4');
    expect(keys.get('crystal-veins')).toBe('mineral-fissures-v3');
    expect(keys.size).toBeGreaterThanOrEqual(6); // + spores, vents, snow, lanterns, horizon
    // One key per distinct PATCH. The glass lanterns are three draws of one
    // geometry with the identical patch (cores, depth, blended colour — the
    // pass is a uniform), so those three share a program on purpose.
    const lanternDraws = ['sky-lantern-cores', 'sky-lantern-depth', 'sky-lanterns'];
    expect(new Set(lanternDraws.map((n) => keys.get(n))).size).toBe(1);
    const distinct = [...keys].filter(([name]) => !lanternDraws.slice(1).includes(name));
    expect(new Set(distinct.map(([, key]) => key)).size).toBe(distinct.length);
  });

  it('never raises a castle indoors', () => {
    const world = build({ ...off, castle: 1, interior: true });
    expect(world.counts.castle).toBeUndefined();
    expect(world.group.children.some(o => o.name.startsWith('castle-'))).toBe(false);
  });

});

describe('the garden answers the cast', () => {
  it('setFish writes where each fish is into the flora programs, capped', () => {
    const world = build(full);
    const plants = world.group.children.find((o) => o.name === 'voxel-light-flora') as Mesh;
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader };
    (plants.material as Material).onBeforeCompile(shader as never, {} as WebGLRenderer);
    expect(shader.vertexShader).toContain('mqStartleAt(position)');
    world.setFish([{ x: 1, y: 2, z: 3, r: 28 }, { x: -4, y: 5, z: 6, r: 20 }]);
    expect(shader.uniforms.uMqFloraFishN!.value).toBe(2);
    expect((shader.uniforms.uMqFloraFish!.value as Array<{ toArray(): number[] }>)[1]!.toArray()).toEqual([-4, 5, 6, 20]);
    world.setFish(Array.from({ length: 40 }, (_, i) => ({ x: i, y: 0, z: 0, r: 10 })));
    expect(shader.uniforms.uMqFloraFishN!.value).toBe(24);
    world.setFish([]);
    expect(shader.uniforms.uMqFloraFishN!.value).toBe(0);
  });
});

describe('wild geodes in the scenery', () => {
  it('builds one geode mesh, answers the cast, and the flora grows round it', () => {
    const world = build({ ...full, geodes: 1 });
    const geodes = world.group.children.find((o) => o.name === 'wild-geodes') as Mesh;
    expect(geodes).toBeTruthy();
    expect(world.counts.geodes).toBeGreaterThan(5);
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader };
    (geodes.material as Material).onBeforeCompile(shader as never, {} as WebGLRenderer);
    expect(shader.vertexShader).toContain('mqStartleAt(vGeoW)');
    expect(shader.fragmentShader).toContain('float nb = 8.0');
    expect(shader.vertexShader.match(/#include <project_vertex>/g)).toHaveLength(1);
    world.setFish([{ x: 1, y: 2, z: 3, r: 28 }]);
    expect(shader.uniforms.uMqFloraFishN!.value).toBe(1);
    expect(build({ ...full, geodes: 0 }).group.children.some((o) => o.name === 'wild-geodes')).toBe(false);
    // Indoors there is no floor to scatter them on.
    expect(build({ ...off, geodes: 1, interior: true }).group.children.some((o) => o.name === 'wild-geodes')).toBe(false);
  });
});

describe('the town square', () => {
  it('a fountain where the paths meet, a plaza, a bubble column, lamps along the paths, halos', () => {
    const world = build({ ...off, homes: 3, paths: 1, flora: 0.4, fountain: 'geode', lamps: 1 });
    expect(world.counts.fountain).toBe(1);
    expect(world.counts.lamps).toBeGreaterThan(3);
    expect(world.marks.fountain).toBeTruthy();
    expect(world.group.children.some((o) => o.name === 'fountain-bubbles')).toBe(true);
    expect(world.group.children.some((o) => o.name === 'town-halos')).toBe(true);
    // The plaza is painted on the floor: a pebble disc at the fountain.
    const f = world.marks.fountain!;
    expect(world.paths.some((p) => p.material === 'pebble' && Math.hypot(p.x0 - f.x, p.z0 - f.z) < 1 && p.width > 30)).toBe(true);
    // Lamps and the fountain light the square.
    expect(world.emitters.length).toBeGreaterThan(3);
    const vent = build({ ...off, homes: 3, paths: 1, fountain: 'vent' });
    expect(vent.counts.fountain).toBe(1);
    expect(build({ ...off, homes: 3, paths: 1 }).counts.fountain ?? 0).toBe(0);
    // No paths, no lamps.
    expect(build({ ...off, homes: 3, paths: 0, lamps: 1 }).counts.lamps ?? 0).toBe(0);
  });

  it('with no paths the fountain stands in front of the homes; with no homes, near the middle', () => {
    const homes = build({ ...off, homes: 3, paths: 0, fountain: 'vent' });
    expect(homes.counts.fountain).toBe(1);
    expect(homes.marks.fountain!.z).toBeGreaterThan(-60);
    const bare = build({ ...off, fountain: 'geode' });
    expect(bare.counts.fountain).toBe(1);
    expect(Math.hypot(bare.marks.fountain!.x, bare.marks.fountain!.z)).toBeLessThan(80);
  });
});
