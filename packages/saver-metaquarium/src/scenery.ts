/** Seeded mineral scenery. Minerals are faceted; living/inhabited details are voxels.
 * Geometry is batched at build time, owns its resources, and uses the tank clock. */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, IcosahedronGeometry,
  Points, PointsMaterial, Vector4,
  Mesh, type MeshBasicMaterial, Quaternion, Ray, TorusGeometry, Vector3,
} from 'three';
import { emittersOf, type Cluster, type CrystalRng, type Emitter } from './crystals';
import { batch, FrontSide, painted } from './scenery-paint';
import { buildGeode, GEODE_HABITS } from './geode';

export interface SceneryOptions {
  rocks: number;
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
  const rock = (x: number, y: number, z: number, rx: number, ry: number, rz: number, color: string): void => {
    const stone = painted(new IcosahedronGeometry(1, 1), '#334559', new Vector3(x, y, z), new Vector3(rx, ry, rz));
    stones.push(stone);
    // Project the seam onto the actual faceted surface. A spherical estimate
    // hides parts of it inside the flat triangles and reads as dotted lights.
    const surface = stone.getAttribute('position');
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), hit = new Vector3();
    const ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
    let previous: Vector3 | null = null;
    for (let j = 0; j < 17; j++) {
      const u = (j / 16 - 0.5) * 1.65;
      const px = x + u * rx, pz = z + Math.sin(j * 0.8) * rz * 0.16;
      ray.origin.set(px, y + ry * 2, pz);
      let top = -Infinity;
      for (let k = 0; k < surface.count; k += 3) {
        a.fromBufferAttribute(surface, k); b.fromBufferAttribute(surface, k + 1); c.fromBufferAttribute(surface, k + 2);
        if (ray.intersectTriangle(a, b, c, false, hit)) top = Math.max(top, hit.y);
      }
      if (!Number.isFinite(top)) { previous = null; continue; }
      const point = new Vector3(px, top + 0.24 * s, pz);
      if (previous) {
        const delta = point.clone().sub(previous);
        veins.push(painted(new CylinderGeometry(0.17 * s, 0.17 * s, delta.length(), 4), color,
          point.clone().add(previous).multiplyScalar(0.5), new Vector3(1, 1, 1),
          new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize()), false));
      }
      previous = point;
    }
    obstacles.push({ x, y, z, r: Math.max(rx, rz), h: ry });
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
    const arch = new TorusGeometry(24 * s, 6 * s, 5, 11, Math.PI);
    stones.push(painted(arch, '#384960', new Vector3(x, y, z), new Vector3(1, 1.45, 1)));
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
  const flora: BufferGeometry[] = [];
  const floraRng = rng.fork(4);
  const strands = Math.round(opts.flora * opts.cap * 5);
  for (let i = 0; i < strands; i++) {
    const a = anchors[i % anchors.length]!;
    const angle = floraRng.range(0, Math.PI * 2), radius = floraRng.range(17, 29) * s;
    const x = a.x + Math.cos(angle) * radius, z = a.z + Math.sin(angle) * radius;
    const root = terrain(x, z), height = floraRng.range(17, 43) * s;
    const nearest = anchors.reduce((best, c) => Math.hypot(x - c.x, z - c.z) < Math.hypot(x - best.x, z - best.z) ? c : best, a);
    const tint = new Color(nearest.color).lerp(new Color('#369a81'), 0.5);
    for (let j = 0; j < 9; j++) {
      const h = j / 8;
      const color = tint.clone().multiplyScalar(0.28 + h * 0.5).getHexString();
      const p = painted(new BoxGeometry(1, 1, 1), j === 8 ? nearest.color : `#${color}`,
        new Vector3(x + Math.sin(h * 3 + angle) * h * 3 * s, root + h * height, z),
        new Vector3((j === 8 ? 1.7 : 1) * s, height / 8 + 0.2, 0.9 * s), new Quaternion(), j !== 8);
      const roots = new Float32Array(p.getAttribute('position').count * 2);
      for (let k = 0; k < roots.length; k += 2) { roots[k] = root; roots[k + 1] = angle; }
      p.setAttribute('aSway', new BufferAttribute(roots, 2));
      flora.push(p);
      if (j > 1 && j < 8 && j % 2 === 0) {
        const leaf = painted(new BoxGeometry(1, 1, 1), `#${color}`,
          new Vector3(x + (j % 4 === 0 ? 2 : -2) * s, root + h * height, z),
          new Vector3(4 * s, 1.1 * s, 1 * s));
        const lr = new Float32Array(leaf.getAttribute('position').count * 2);
        for (let k = 0; k < lr.length; k += 2) { lr[k] = root; lr[k + 1] = angle; }
        leaf.setAttribute('aSway', new BufferAttribute(lr, 2));
        flora.push(leaf);
      }
    }
  }
  const plants = batch(group, flora, 'voxel-light-kelp');
  if (plants) {
    const clock = { value: 0 }; clocks.push(clock);
    (plants.material as MeshBasicMaterial).onBeforeCompile = shader => {
      shader.uniforms.uSwayTime = clock;
      shader.vertexShader = 'uniform float uSwayTime; attribute vec2 aSway;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float h = max(0.0, position.y - aSway.x);
        transformed.x += sin(uSwayTime * 0.55 + aSway.y + h * 0.07) * h * 0.13;
        transformed.z += cos(uSwayTime * 0.38 + aSway.y + h * 0.06) * h * 0.055;
      `);
    };
    plants.frustumCulled = false;
  }
  counts.flora = strands;
  // Both particle layers are one draw each; positions are pure in t, including
  // wraps. Bubble fade at either end hides the reset back to its vent.
  const particleRng = rng.fork(6);
  const sources = [...vents, ...anchors.map(a => ({ ...a, y: a.y + 6 * s }))];
  const emitters = emittersOf(clusters);
  const lightPositions = Array.from({ length: 12 }, (_, i) => {
    const e = emitters[i]; return e ? new Vector4(e.x, e.y, e.z, e.reach) : new Vector4(0, 0, 0, 1);
  });
  const lightColors = Array.from({ length: 12 }, (_, i) => {
    const e = emitters[i]; return e ? new Vector3(e.r, e.g, e.b) : new Vector3();
  });
  const particles = (bubble: boolean, n: number): void => {
    if (!n) return;
    const positions = new Float32Array(n * 3), colors = new Float32Array(n * 3), phases = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const source = sources[i % sources.length]!;
      positions.set(bubble ? [source.x, source.y, source.z] : [particleRng.range(-170, 170) * s, 0, particleRng.range(-150, 150) * s], i * 3);
      const color = new Color(bubble ? source.color : '#abc9dc');
      colors.set([color.r, color.g, color.b], i * 3);
      phases.set([particleRng.next(), particleRng.range(0.7, 1.3)], i * 2);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setAttribute('aParticle', new BufferAttribute(phases, 2));
    geometry.userData.mqOwned = true;
    const material = new PointsMaterial({ vertexColors: true, size: bubble ? 1.5 * s : 0.65 * s,
      transparent: true, opacity: bubble ? 0.55 : 0.5, depthWrite: false });
    material.userData.mqOwned = true;
    const clock = { value: 0 }; clocks.push(clock);
    material.onBeforeCompile = shader => {
      shader.uniforms.uParticleTime = clock;
      shader.uniforms.uMineralPosition = { value: lightPositions };
      shader.uniforms.uMineralColor = { value: lightColors };
      shader.vertexShader = `uniform float uParticleTime;
        attribute vec2 aParticle; varying float vLife;
        uniform vec4 uMineralPosition[12]; uniform vec3 uMineralColor[12];
      ` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float life = fract(aParticle.x + uParticleTime * aParticle.y * ${bubble ? '0.045' : '0.007'});
        transformed.y += ${bubble ? 'life * 76.0' : '(1.0 - life) * 150.0'};
        transformed.x += sin(life * 9.0 + aParticle.x * 30.0) * ${bubble ? '1.8' : '7.0'};
        transformed.z += cos(life * 6.0 + aParticle.x * 20.0) * 2.0;
        vLife = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.78, 1.0, life));
        vec3 light = vec3(0.22);
        for (int i = 0; i < 12; i++) {
          vec3 delta = transformed - uMineralPosition[i].xyz;
          float reach = uMineralPosition[i].w;
          light += uMineralColor[i] / (1.0 + dot(delta, delta) / (reach * reach));
        }
        vColor.rgb *= min(vec3(1.8), light);
      `);
      shader.fragmentShader = 'varying float vLife;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float mask = ${bubble ? 'smoothstep(0.5, 0.72, r) * (1.0 - smoothstep(0.8, 1.0, r))' : '1.0 - smoothstep(0.0, 1.0, r)'};
        diffuseColor.a *= mask * vLife;
      `);
    };
    material.customProgramCacheKey = () => bubble ? 'mineral-bubbles-v1' : 'mineral-snow-v1';
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
  batch(group, veins, 'crystal-veins', FrontSide);
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
