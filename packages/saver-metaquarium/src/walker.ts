/**
 * The ground a walker stands on. A swimmer keeps a CLEARANCE over the seabed
 * — domes over every plant, rock and crystal with a margin for its nose — and
 * that envelope is the wrong floor for a crab: riding it, a crab hovers a
 * body-height over the sand beside every plant. A walker wants the surface
 * that is actually there.
 *
 * So: the terrain, plus whatever solid thing is under it, found by casting a
 * ray straight down. Rays are cast once per floor cell, lazily, and cached —
 * a crab walks a few cells a second, the scenery never moves. Each cell keeps
 * every upward surface the ray met, so an arch or a home's eave does not put
 * a crab on the roof: it stands on the highest surface within a STEP of where
 * its feet are now. A rock or a geode's shoulder it climbs; a crystal taller
 * than a step it walks through, legs among the shards.
 *
 * Between cells the height is bilinear, so a crab climbing a rock walks up a
 * ramp instead of hopping cell to cell.
 */

import {
  DataTexture, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, RGBAFormat, Vector3,
  type Material, type Object3D, type Quaternion,
} from 'three';

export interface WalkGroundOptions {
  /** Cell size, world units. */
  cell?: number;
  /** Where the rays start from. */
  top?: number;
  /** Materials a walker passes through (plants sway; a crab does not climb grass). */
  soft?: ReadonlySet<Material>;
}

const solidMaterial = (m: Material | Material[], soft: ReadonlySet<Material>, index = 0): boolean => {
  const one = Array.isArray(m) ? m[index] : m;
  if (!one || !one.visible || soft.has(one)) return false;
  // Glow cards, halos, mist, bubbles: light, not ground.
  return !one.transparent && one.depthWrite !== false;
};

export class WalkGround {
  private readonly cells = new Map<number, number[]>();
  private readonly meshes: Mesh[] = [];
  private readonly ray = new Raycaster();
  private readonly origin = new Vector3();
  private readonly down = new Vector3(0, -1, 0);
  private readonly cell: number;
  private readonly top: number;
  private readonly soft: ReadonlySet<Material>;

  constructor(roots: readonly Object3D[], private readonly terrain: (x: number, z: number) => number, opts: WalkGroundOptions = {}) {
    this.cell = opts.cell ?? 1.5;
    this.top = opts.top ?? 400;
    const soft = this.soft = opts.soft ?? new Set<Material>();
    for (const root of roots) {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const m = o as Mesh;
        // A multi-material mesh is kept if any of its materials is solid; each hit is judged by its own face.
        const slots = Array.isArray(m.material) ? m.material.length : 1;
        if (m.isMesh && o.visible && m.geometry && Array.from({ length: slots }, (_, i) => solidMaterial(m.material, soft, i)).some(Boolean)) this.meshes.push(m);
      });
    }
  }

  /** How many solid meshes the rays test — 0 means the ground is the terrain alone. */
  get solids(): number { return this.meshes.length; }

  /** Cells cast so far (each is one ray). */
  get cast(): number { return this.cells.size; }

  /** Every upward surface over the cell centre (ix, iz), highest first. */
  private surfaces(ix: number, iz: number): number[] {
    const key = (ix + 4096) * 8192 + (iz + 4096);
    let s = this.cells.get(key);
    if (!s) {
      s = [];
      if (this.meshes.length) {
        this.ray.set(this.origin.set(ix * this.cell, this.top, iz * this.cell), this.down);
        for (const hit of this.ray.intersectObjects(this.meshes, false)) {
          if (!solidMaterial((hit.object as Mesh).material, this.soft, hit.face?.materialIndex ?? 0)) continue;
          // A downward ray meets a front face only if it faces up; a
          // double-sided part also reports its underside — keep the top.
          if (!s.length || s[s.length - 1]! - hit.point.y > 0.25) s.push(hit.point.y);
        }
      }
      this.cells.set(key, s);
    }
    return s;
  }

  /** The ground at one cell centre for feet now at `from`: terrain, or the highest surface within `step` of them. */
  private standAt(ix: number, iz: number, from: number, step: number): number {
    const x = ix * this.cell, z = iz * this.cell;
    const floor = this.terrain(x, z);
    for (const y of this.surfaces(ix, iz)) if (y > floor && y <= from + step) return y;
    return floor;
  }

  /** Where a walker at (x, z), feet at `from`, stands: bilinear over the four cells around it. */
  at(x: number, z: number, from: number, step: number): number {
    const gx = x / this.cell, gz = z / this.cell;
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const a = this.standAt(ix, iz, from, step), b = this.standAt(ix + 1, iz, from, step);
    const c = this.standAt(ix, iz + 1, from, step), d = this.standAt(ix + 1, iz + 1, from, step);
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }
}

/** The contact shadow's falloff, centre (0) to rim (1): dark under the body and out to the feet, gone just past them. */
export function contactShade(r: number): number {
  const t = Math.max(0, Math.min(1, (r - 0.45) / 0.55));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * A soft dark ellipse under each walker, on the ground it stands on. Without
 * it a crab whose feet are on the sand still reads as hovering: nothing
 * under it says where the floor is. One instanced draw for every walker;
 * fogged like the floor, so a far crab's shadow fades with it.
 */
export class ContactShadows {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(readonly capacity: number, opacity = 0.55) {
    const n = 32, px = new Uint8Array(n * n * 4);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const r = Math.hypot((i + 0.5) / n * 2 - 1, (j + 0.5) / n * 2 - 1);
      px[(j * n + i) * 4 + 3] = Math.round(255 * contactShade(r));
    }
    const map = new DataTexture(px, n, n, RGBAFormat);
    map.needsUpdate = true;
    map.userData.mqOwned = true;
    const material = new MeshBasicMaterial({ color: 0x000000, map, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    material.userData.mqOwned = true;
    const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geometry.userData.mqOwned = true;
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'walker-shadows';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.count = 0;
  }

  /** Shadow `i`: on the ground at (x, y, z), turned and tilted with the walker, `width` across and `length` along its walk. */
  set(i: number, x: number, y: number, z: number, turn: Quaternion, width: number, length: number): void {
    if (i >= this.capacity) return;
    this.mesh.setMatrixAt(i, this.m.compose(this.p.set(x, y, z), turn, this.s.set(width, 1, length)));
  }

  /** How many were set this frame. */
  commit(n: number): void {
    this.mesh.count = Math.min(n, this.capacity);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
