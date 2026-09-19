/** Seeded mineral scenery. Minerals are faceted; living/inhabited details are voxels.
 * Geometry is batched at build time, owns its resources, and uses the tank clock. */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, Color, DoubleSide, Group, IcosahedronGeometry, Matrix4,
  OctahedronGeometry,
  Mesh, MeshBasicMaterial, Quaternion, TorusGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Cluster, CrystalRng } from './crystals';

export interface SceneryOptions {
  rocks: number;
  homes: number;
  cap: number;
  scale: number;
}
export interface SceneryAnchor { x: number; y: number; z: number; color: string }
export interface Scenery {
  group: Group;
  counts: Record<string, number>;
  vents: SceneryAnchor[];
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
  g.deleteAttribute('uv');
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
  const material = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
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
  const vents: SceneryAnchor[] = [];
  const counts: Record<string, number> = { rocks: 0, arches: 0, homes: 0 };
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
  const interiors: BufferGeometry[] = [], details: BufferGeometry[] = [];
  const homeRng = rng.fork(3);
  const homeCount = Math.min(Math.round(opts.homes), opts.cap >= 8 ? 3 : 2);
  for (let i = 0; i < homeCount; i++) {
    const x = (i - (homeCount - 1) / 2) * 39 * s;
    const z = (-25 - (i % 2) * 14) * s;
    const y = terrain(x, z), r = homeRng.range(13, 16) * s;
    const tint = anchors[i % anchors.length]!.color;
    // Cut actual triangles away from the front of the shell. The warm inner
    // bowl is visible through the opening, and fish can occlude either rim.
    const shell = new IcosahedronGeometry(1, 2);
    const src = shell.getAttribute('position');
    const pos: number[] = [];
    for (let j = 0; j < src.count; j += 3) {
      if ((src.getZ(j) + src.getZ(j + 1) + src.getZ(j + 2)) / 3 > 0.48) continue;
      for (let k = 0; k < 3; k++) pos.push(src.getX(j + k), src.getY(j + k), src.getZ(j + k));
    }
    shell.dispose();
    const cut = new BufferGeometry();
    cut.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    cut.computeVertexNormals();
    stones.push(painted(cut.clone(), '#465066', new Vector3(x, y + r * 0.82, z), new Vector3(r, r, r * 0.85)));
    interiors.push(painted(cut, '#aa6347', new Vector3(x, y + r * 0.82, z), new Vector3(r * 0.88, r * 0.88, r * 0.73)));
    for (let j = 0; j < 11; j++) {
      const a = j / 11 * Math.PI * 2;
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a);
      veins.push(painted(new OctahedronGeometry(1), tint,
        new Vector3(x + Math.cos(a) * r * 0.85, y + r * 0.82 + Math.sin(a) * r * 0.85, z + r * 0.42),
        new Vector3(1.2 * s, 2.5 * s, 1.5 * s), q));
    }
    // Round recessed door; a voxel lintel, lamp, stool and steps show the
    // inhabitants working with the mineral shell rather than another rock.
    interiors.push(painted(new CircleGeometry(r * 0.4, 16), '#ffca7c', new Vector3(x, y + r * 0.5, z - r * 0.55), new Vector3(1, 1, 1), new Quaternion(), false));
    const box = (dx: number, dy: number, dz: number, sx: number, sy: number, sz: number, color: string): void => {
      details.push(painted(new BoxGeometry(1, 1, 1), color, new Vector3(x + dx * s, y + dy * s, z + dz * s), new Vector3(sx * s, sy * s, sz * s)));
    };
    box(0, 1, 8, 10, 2, 8, '#646479');
    box(0, 0.3, 13, 13, 0.8, 4, '#424e64');
    box(6, 4, 0, 5, 1.5, 3, '#ac7658');
    box(5, 2, 0, 1, 4, 1, '#75504b');
    box(7, 2, 0, 1, 4, 1, '#75504b');
    box(-6, 7, 1, 0.8, 9, 0.8, '#a88372');
    box(-6, 12, 1, 3, 3, 3, '#ffe1a0');
    box(5, r / s * 1.75, -2, 3, 8, 3, '#485468');
    vents.push({ x: x + 5 * s, y: y + r * 1.75 + 4 * s, z: z - 2 * s, color: '#ffd69a' });
    obstacles.push({ x, y: y + r * 0.82, z, r, h: r });
    counts.homes!++;
  }
  batch(group, interiors, 'geode-interiors');
  batch(group, details, 'voxel-furnishings');
  batch(group, stones, 'rock-formations');
  batch(group, veins, 'crystal-veins');
  return {
    group, counts, vents,
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
