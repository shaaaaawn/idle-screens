/** Seeded mineral scenery. Minerals are faceted; living/inhabited details are voxels.
 * Geometry is batched at build time, owns its resources, and uses the tank clock. */
import {
  BufferAttribute, BufferGeometry, Color, Group, IcosahedronGeometry, Matrix4,
  Mesh, MeshBasicMaterial, Quaternion, TorusGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Cluster, CrystalRng } from './crystals';

export interface SceneryOptions {
  rocks: number;
  cap: number;
  scale: number;
}
export interface SceneryAnchor { x: number; y: number; z: number; color: string }
export interface Scenery {
  group: Group;
  counts: Record<string, number>;
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

/** Bake faceted directional shading into vertex colours: works in flat and lit tanks. */
function painted(geometry: BufferGeometry, color: string, position: Vector3, scale: Vector3,
  rotation = new Quaternion(), shade = true): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  geometry.dispose();
  g.computeVertexNormals();
  g.applyMatrix4(new Matrix4().compose(position, rotation, scale));
  const normals = g.getAttribute('normal');
  const colors = new Float32Array(g.getAttribute('position').count * 3);
  const base = new Color(color);
  for (let i = 0; i < normals.count; i++) {
    const k = shade ? 0.34 + 0.66 * Math.max(0, normals.getX(i) * -0.45 + normals.getY(i) * 0.78 + normals.getZ(i) * 0.43) : 1;
    colors.set([base.r * k, base.g * k, base.b * k], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}
function batch(group: Group, parts: BufferGeometry[], name: string): Mesh | null {
  if (!parts.length) return null;
  const geometry = mergeGeometries(parts)!;
  parts.forEach(g => g.dispose());
  geometry.userData.mqOwned = true;
  const material = new MeshBasicMaterial({ vertexColors: true });
  material.userData.mqOwned = true;
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  group.add(mesh);
  return mesh;
}

export function buildScenery(clusters: readonly Cluster[], rng: CrystalRng,
  terrain: (x: number, z: number) => number, opts: SceneryOptions): Scenery {
  const group = new Group();
  group.name = 'mineral-world';
  const anchors = sceneryAnchors(clusters, rng.fork(1), terrain);
  const stones: BufferGeometry[] = [], veins: BufferGeometry[] = [];
  const obstacles: { x: number; y: number; z: number; r: number; h: number }[] = [];
  const counts: Record<string, number> = { rocks: 0, arches: 0 };
  const rockRng = rng.fork(2);
  const s = opts.scale;
  const rock = (x: number, y: number, z: number, rx: number, ry: number, rz: number, color: string): void => {
    stones.push(painted(new IcosahedronGeometry(1, 1), '#334559', new Vector3(x, y, z), new Vector3(rx, ry, rz)));
    // A broken mineral seam follows the exposed upper surface, rather than a floating ring.
    for (let j = 0; j < 5; j++) {
      const u = (j - 2) * 0.28;
      veins.push(painted(new IcosahedronGeometry(1, 0), color,
        new Vector3(x + u * rx, y + ry * Math.sqrt(1 - u * u) * 0.94, z + Math.sin(j * 1.8) * rz * 0.12),
        new Vector3(rx * 0.18, 0.18 * s, 0.35 * s), new Quaternion(), false));
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
  batch(group, stones, 'rock-formations');
  batch(group, veins, 'crystal-veins');
  return {
    group, counts,
    clearance(x, z) {
      let h = -Infinity;
      for (const o of obstacles) {
        const q = Math.hypot(x - o.x, z - o.z) / (o.r + 6);
        if (q < 1) h = Math.max(h, o.y + o.h * Math.sqrt(1 - q * q));
      }
      return h;
    },
    setFrame(_t) { /* Static geology. Animated layers use the same analytic clock. */ },
  };
}
