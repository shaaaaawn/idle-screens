/** Seeded mineral scenery. Minerals are faceted; living/inhabited details are voxels.
 * Geometry is batched at build time, owns its resources, and uses the tank clock. */
import {
  BufferAttribute, BufferGeometry, Color, Group,
  Matrix4, Points, PointsMaterial, Vector4,
  Mesh, type MeshBasicMaterial, Quaternion, TorusGeometry, Vector3,
} from 'three';
import { emittersOf, type Cluster, type CrystalRng, type Emitter } from './crystals';
import { batch, FrontSide } from './scenery-paint';
import { buildFlora, FLORA_COLOR, FLORA_VERTEX } from './flora';
import { buildGeode, GEODE_HABITS } from './geode';
import { buildRock, fissures, glowGeometry, paintStone, type Tri } from './rocks';

export interface SceneryOptions {
  rocks: number;
  /** 0..1 — how fractured the stone is: fissure width, forks, crystals in the crack. */
  veins: number;
  homes: number;
  flora: number;
  bubbles: number;
  snow: number;
  cap: number;
  scale: number;
}
export interface SceneryAnchor { x: number; y: number; z: number; color: string }
export interface Scenery {
  group: Group;
  counts: Record<string, number>;
  vents: SceneryAnchor[];
  /** Light the scenery adds to the field: home windows and doors. */
  emitters: Emitter[];
  drawCalls: number;
  triangles: number;
  clearance(x: number, z: number): number;
  setFrame(t: number): void;
}

/** Each feature gets its own fork, so adding flora never rearranges a village. */
export function sceneryAnchors(clusters: readonly Cluster[], rng: CrystalRng,
  terrain: (x: number, z: number) => number): SceneryAnchor[] {
  if (clusters.length) return clusters.map(c => ({ x: c.x, y: terrain(c.x, c.z), z: c.z, color: c.color }));
  return Array.from({ length: 6 }, (_, i) => {
    const a = i * Math.PI / 3 + 0.2;
    const r = rng.range(55, 95);
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    return { x, y: terrain(x, z), z, color: ['#49cfff', '#a17bff', '#ff67bc'][i % 3]! };
  });
}

export function buildScenery(clusters: readonly Cluster[], rng: CrystalRng,
  terrain: (x: number, z: number) => number, opts: SceneryOptions): Scenery {
  const group = new Group();
  group.name = 'mineral-world';
  const anchors = sceneryAnchors(clusters, rng.fork(1), terrain);
  const stones: BufferGeometry[] = [], veins: BufferGeometry[] = [];
  const obstacles: { x: number; y: number; z: number; r: number; h: number }[] = [];
  const clocks: { value: number }[] = [];
  const vents: SceneryAnchor[] = [];
  const counts: Record<string, number> = { rocks: 0, arches: 0, homes: 0 };
  const rockRng = rng.fork(2);
  const s = opts.scale;
  let rockIndex = 0;
  const seeps: SceneryAnchor[] = [];
  const rock = (x: number, y: number, z: number, rx: number, ry: number, rz: number, color: string): void => {
    const built = buildRock({ x, y, z, rx, ry, rz, tint: color, veins: opts.veins }, rockRng.fork(100 + rockIndex++));
    stones.push(built.stone);
    if (built.glow) veins.push(built.glow);
    // The widest part of a big rock's fissure seeps bubbles.
    if (built.seep && rx > 15 * s) seeps.push({ x: built.seep.x, y: built.seep.y, z: built.seep.z, color });
    obstacles.push({ x, y, z, r: Math.max(rx, rz), h: ry * 1.3 });
    counts.rocks!++;
  };
  if (opts.rocks > 0) {
    const n = Math.min(anchors.length, opts.cap);
    for (const a of anchors.slice(0, n)) {
      rock(a.x, a.y, a.z, 18 * s, 8 * s, 15 * s, a.color);
      for (let j = 0; j < Math.ceil(opts.rocks * 2); j++) {
        const x = a.x + rockRng.range(-23, 23) * s, z = a.z + rockRng.range(-20, 20) * s;
        rock(x, terrain(x, z), z, rockRng.range(8, 14) * s, rockRng.range(5, 11) * s, 10 * s, a.color);
      }
    }
    // A real open arch: its opening remains empty depth space for passing fish.
    const x = -48 * s, z = -65 * s, y = terrain(x, z);
    // The arch is the same stone: displaced, painted and fissured like a boulder.
    const torus = new TorusGeometry(1, 0.26, 6, 14, Math.PI).toNonIndexed();
    const tp = torus.getAttribute('position');
    const archRng = rockRng.fork(900);
    const archTris: Tri[] = [];
    const wobble = new Map<string, number>();
    const av = (i: number): Vector3 => {
      const k = `${tp.getX(i).toFixed(3)},${tp.getY(i).toFixed(3)},${tp.getZ(i).toFixed(3)}`;
      let v = wobble.get(k);
      if (v === undefined) { v = archRng.range(0.9, 1.12); wobble.set(k, v); }
      return new Vector3(tp.getX(i) * v, tp.getY(i) * v, tp.getZ(i) * v);
    };
    for (let i = 0; i < tp.count; i += 3) archTris.push([av(i), av(i + 1), av(i + 2)]);
    torus.dispose();
    const archPlace = new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(24 * s, 35 * s, 24 * s));
    stones.push(paintStone(archTris, archPlace, archRng.fork(1), '#384960'));
    const archCut = fissures(archTris, archRng.fork(2), '#947cff', opts.veins);
    const archGlow = glowGeometry(archCut.positions, archCut.colors, archPlace);
    if (archGlow) veins.push(archGlow);
    counts.arches = 1;
    for (const dx of [-24, 24]) rock(x + dx * s, y, z, 10 * s, 8 * s, 12 * s, '#947cff');
    // Low back ridge frames the settlement without sealing off its centre.
    for (let i = 0; i < 4; i++) {
      const rx = (i - 1.5) * 30 * s, rz = -115 * s;
      rock(rx, terrain(rx, rz), rz, 25 * s, (12 + rockRng.next() * 12) * s, 19 * s, '#567fae');
    }
  }
  // Homes: a loose crescent opening toward the default camera, habits cycled
  // so a village of three is a cottage, a hall and a tower.
  const interiors: BufferGeometry[] = [], details: BufferGeometry[] = [];
  const homeLights: Emitter[] = [];
  const homeRng = rng.fork(3);
  const homeCount = Math.min(Math.round(opts.homes), opts.cap >= 8 ? 3 : 2);
  for (let i = 0; i < homeCount; i++) {
    const t = homeCount === 1 ? 0 : i / (homeCount - 1) - 0.5;
    const habit = GEODE_HABITS[(i + (homeCount === 1 ? 0 : 1)) % GEODE_HABITS.length]!;
    let x = t * 132 * s + homeRng.range(-5, 5) * s;
    let z = (-38 + Math.abs(t) * 30) * s + homeRng.range(-4, 4) * s;
    // A home never grows through a crystal: step it back from any cluster
    // whose footprint it would share.
    for (let pass = 0; pass < 3; pass++) {
      for (const c of clusters) {
        const d = Math.hypot(x - c.x, z - c.z), need = 40 * s + c.radius;
        if (d < need) {
          const k = (need - d) / Math.max(1, d);
          x += (x - c.x) * k; z += (z - c.z) * k;
        }
      }
    }
    const home = buildGeode({
      x, y: terrain(x, z), z, habit, scale: s,
      // Turned in toward the middle of the crescent, never square-on.
      facing: -t * 0.75 + homeRng.range(-0.12, 0.12),
      tint: anchors[i % anchors.length]!.color,
    }, homeRng.fork(20 + i));
    stones.push(...home.stone);
    details.push(...home.voxels);
    interiors.push(...home.glow);
    vents.push(home.vent);
    homeLights.push(home.emitter);
    obstacles.push(home.obstacle);
    counts.homes!++;
  }
  const field = buildFlora(anchors, terrain, rng.fork(4), {
    density: opts.flora, cap: opts.cap, scale: s,
    blocked: (x, z) => obstacles.some(o => Math.hypot(x - o.x, z - o.z) < o.r + 3 * s),
  });
  const plants = batch(group, field.parts, 'voxel-light-flora', FrontSide);
  if (plants) {
    const clock = { value: 0 }; clocks.push(clock);
    (plants.material as MeshBasicMaterial).onBeforeCompile = shader => {
      shader.uniforms.uSwayTime = clock;
      shader.vertexShader = 'uniform float uSwayTime; attribute vec3 aSway; attribute float aGlow;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', FLORA_VERTEX)
        .replace('#include <color_vertex>', FLORA_COLOR);
    };
    (plants.material as MeshBasicMaterial).customProgramCacheKey = () => 'mineral-flora-v2';
    plants.frustumCulled = false;
  }
  counts.flora = field.plants;
  // Both particle layers are one draw each; positions are pure in t, including
  // wraps. Bubble fade at either end hides the reset back to its vent.
  const particleRng = rng.fork(6);
  const sources = [...vents, ...seeps, ...anchors.map(a => ({ ...a, y: a.y + 6 * s }))];
  const emitters = emittersOf(clusters);
  const lightPositions = Array.from({ length: 12 }, (_, i) => {
    const e = emitters[i]; return e ? new Vector4(e.x, e.y, e.z, e.reach) : new Vector4(0, 0, 0, 1);
  });
  const lightColors = Array.from({ length: 12 }, (_, i) => {
    const e = emitters[i]; return e ? new Vector3(e.r, e.g, e.b) : new Vector3();
  });
  const particles = (bubble: boolean, n: number): void => {
    if (!n) return;
    const positions = new Float32Array(n * 3), colors = new Float32Array(n * 3), phases = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const source = sources[i % sources.length]!;
      positions.set(bubble ? [source.x, source.y, source.z] : [particleRng.range(-170, 170) * s, 0, particleRng.range(-150, 150) * s], i * 3);
      const color = new Color(bubble ? source.color : '#abc9dc');
      colors.set([color.r, color.g, color.b], i * 3);
      // Bubbles leave in PUFFS: every bubble of a vent belongs to one of three
      // bursts, so a chimney coughs a little cloud, rests, coughs again —
      // where a uniform phase gave a dripping tap. Snow stays uniform.
      const src = i % sources.length;
      const burst = bubble ? ((i / sources.length | 0) % 3) / 3 + src * 0.137 + particleRng.range(0, 0.07) : particleRng.next();
      phases.set([burst % 1, particleRng.range(0.75, 1.25), bubble ? particleRng.range(0.55, 1.9) ** 1.4 : 1], i * 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setAttribute('aParticle', new BufferAttribute(phases, 3));
    geometry.userData.mqOwned = true;
    const material = new PointsMaterial({ vertexColors: true, size: bubble ? 2.6 * s : 0.65 * s,
      transparent: true, opacity: bubble ? 0.8 : 0.5, depthWrite: false });
    material.userData.mqOwned = true;
    const clock = { value: 0 }; clocks.push(clock);
    material.onBeforeCompile = shader => {
      shader.uniforms.uParticleTime = clock;
      shader.uniforms.uMineralPosition = { value: lightPositions };
      shader.uniforms.uMineralColor = { value: lightColors };
      shader.vertexShader = `uniform float uParticleTime;
        attribute vec3 aParticle; varying float vLife;
        uniform vec4 uMineralPosition[12]; uniform vec3 uMineralColor[12];
      ` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float life = fract(aParticle.x + uParticleTime * aParticle.y * ${bubble ? '0.045' : '0.007'});
        ${bubble ? `
        // Buoyancy: slow off the vent, quicker as it grows. The wobble widens
        // with height into a loose helix, and small bubbles wander more.
        float rise = life * (0.55 + 0.45 * life);
        transformed.y += rise * 118.0;
        float wob = (0.6 + rise * 5.5) / (0.6 + aParticle.z);
        transformed.x += sin(life * 17.0 + aParticle.x * 40.0) * wob + rise * 9.0;
        transformed.z += cos(life * 13.0 + aParticle.x * 31.0) * wob;` : `
        transformed.y += (1.0 - life) * 150.0;
        transformed.x += sin(life * 9.0 + aParticle.x * 30.0) * 7.0;
        transformed.z += cos(life * 6.0 + aParticle.x * 20.0) * 2.0;`}
        vLife = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.8, 1.0, life));
        vec3 light = vec3(0.22);
        for (int i = 0; i < 12; i++) {
          vec3 delta = transformed - uMineralPosition[i].xyz;
          float reach = uMineralPosition[i].w;
          light += uMineralColor[i] / (1.0 + dot(delta, delta) / (reach * reach));
        }
        vColor.rgb *= min(vec3(1.8), light);
      `);
      // Per-bubble size, and they swell as the pressure drops.
      if (bubble) shader.vertexShader = shader.vertexShader.replace('gl_PointSize = size;',
        'gl_PointSize = size * aParticle.z * (0.7 + 0.8 * fract(aParticle.x + uParticleTime * aParticle.y * 0.045));');
      shader.fragmentShader = 'varying float vLife;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float r = length(gl_PointCoord - 0.5) * 2.0;
        ${bubble ? `
        // A bubble, not a ring: bright rim, faint fill, one highlight up-left.
        float rim = smoothstep(0.62, 0.86, r) * (1.0 - smoothstep(0.9, 1.0, r));
        float fill = (1.0 - smoothstep(0.0, 0.9, r)) * 0.13;
        float spec = 1.0 - smoothstep(0.0, 0.2, length(gl_PointCoord - vec2(0.34, 0.32)) * 2.0);
        float mask = clamp(rim + fill + spec * 0.9, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), spec * 0.85);` : `
        float mask = 1.0 - smoothstep(0.0, 1.0, r);`}
        diffuseColor.a *= mask * vLife;
      `);
    };
    material.customProgramCacheKey = () => bubble ? 'mineral-bubbles-v2' : 'mineral-snow-v2';
    const points = new Points(geometry, material);
    points.name = bubble ? 'bubble-vents' : 'illuminated-marine-snow';
    points.frustumCulled = false;
    group.add(points);
  };
  counts.bubbles = Math.round(opts.bubbles * opts.cap * 12);
  counts.snow = Math.round(opts.snow * opts.cap * 25);
  particles(true, counts.bubbles);
  particles(false, counts.snow);
  // Closed solids draw front faces only — half the fragment work of the
  // DoubleSide everything used to wear; only the open geode throat needs both.
  batch(group, interiors, 'geode-interiors');
  batch(group, details, 'voxel-furnishings', FrontSide);
  batch(group, stones, 'rock-formations', FrontSide);
  batch(group, veins, 'crystal-veins');
  return {
    group, counts, vents, emitters: homeLights,
    drawCalls: group.children.length,
    triangles: group.children.reduce((n, o) => o instanceof Mesh
      ? n + o.geometry.getAttribute('position').count / 3 : n, 0),
    clearance(x, z) {
      let h = -Infinity;
      for (const o of obstacles) {
        const q = Math.hypot(x - o.x, z - o.z) / (o.r + 6);
        if (q < 1) h = Math.max(h, o.y + o.h * Math.sqrt(1 - q * q));
      }
      return h;
    },
    setFrame(t) { for (const clock of clocks) clock.value = t; },
  };
}
