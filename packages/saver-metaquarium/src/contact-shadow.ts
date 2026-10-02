import { DataTexture, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, RGBAFormat, Vector3, type Quaternion } from 'three';

/** The contact shadow's falloff, centre (0) to rim (1): dark under the body and out to the feet, gone just past them. */
export function contactShade(r: number): number {
  const t = Math.max(0, Math.min(1, (r - 0.45) / 0.55));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * A soft dark ellipse under each crab, on the ground it stands on. Without
 * it a crab whose feet are on the sand still reads as hovering: nothing
 * under it says where the floor is. One instanced draw for every crab;
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
    this.mesh.name = 'crab-shadows';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.count = 0;
  }

  /** Shadow `i`: on the ground at (x, y, z), turned and tilted with the crab, `width` across and `length` along its body. */
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
