/**
 * An octopus's ink: a dark cloud let go from its siphon as it jets off. A
 * cloud is an EMISSION (where and when), its puffs a closed form of the time
 * since — they bloom out, drift and sink a little, and thin away to nothing —
 * so a viewer that seeks back drops it (burps.ts's way). Normal blending, no
 * depth write: it hangs in the water in front of whatever is behind it.
 */
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, SphereGeometry, type Scene } from 'three';
import { fishHash } from './swim';

/** Seconds a cloud lasts. */
export const INK_LIFE = 5;
const PUFFS = 12;
const CAP = 8 * PUFFS;

export interface InkCloud { t: number; x: number; y: number; z: number; size: number; seed: number }
export interface InkPuff { visible: boolean; x: number; y: number; z: number; s: number }

/** Puff `p` of cloud `c` at `t`. */
export function inkPuffAt(c: InkCloud, p: number, t: number, out: InkPuff): InkPuff {
  const a = t - c.t - p * 0.06;
  out.visible = a >= 0 && a <= INK_LIFE;
  if (!out.visible) return out;
  const h = (k: number): number => fishHash(Math.round(c.seed * 1000) + p * 17 + k, 1801) * 2 - 1;
  // Out from the siphon, slowing; a slow sink.
  // Out from the siphon fast, then hanging: a cloud, not a ball.
  const spread = c.size * 3.2 * (1 - Math.exp(-a / 0.7)) * (0.6 + 0.4 * Math.abs(h(5)));
  out.x = c.x + h(1) * spread;
  out.y = c.y + h(2) * spread * 0.6 - 0.2 * c.size * a;
  out.z = c.z + h(3) * spread;
  // Each wisp blooms as it spreads and thins away to nothing.
  const bloom = Math.min(1, a / 0.6), thin = 1 - Math.max(0, (a - INK_LIFE * 0.35) / (INK_LIFE * 0.65));
  out.s = c.size * (0.35 + 0.3 * (h(4) + 1)) * (0.3 + 1.1 * bloom) * Math.max(0, thin);
  return out;
}

export class InkLayer {
  readonly mesh: InstancedMesh;
  private readonly clouds = new Map<string, InkCloud>();
  private readonly puff: InkPuff = { visible: false, x: 0, y: 0, z: 0, s: 0 };
  private readonly m = new Matrix4();

  constructor(scene: Scene) {
    const geo = new SphereGeometry(1, 8, 6);
    geo.userData.mqOwned = true;
    // Sepia-black, see-through: overlapping wisps darken where the cloud is thick.
    const mat = new MeshBasicMaterial({ color: new Color('#1c1626'), transparent: true, opacity: 0.42, depthWrite: false });
    mat.userData.mqOwned = true;
    this.mesh = new InstancedMesh(geo, mat, CAP);
    this.mesh.name = 'octopus-ink';
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** A cloud, once per `key`, from (x, y, z) at `t`; `size` its puffs' radius. */
  emit(key: string, t: number, x: number, y: number, z: number, size: number): void {
    if (this.clouds.has(key) || this.clouds.size >= CAP / PUFFS) return;
    this.clouds.set(key, { t, x, y, z, size, seed: fishHash(key.length, Math.round(t * 100) % 9973) });
  }

  get size(): number { return this.clouds.size; }

  update(t: number): number {
    let n = 0;
    for (const [key, c] of this.clouds) {
      if (t < c.t || t > c.t + INK_LIFE + PUFFS * 0.06) { this.clouds.delete(key); continue; }
      for (let p = 0; p < PUFFS; p++) {
        const q = inkPuffAt(c, p, t, this.puff);
        if (!q.visible || q.s <= 0) continue;
        this.m.makeScale(q.s, q.s, q.s).setPosition(q.x, q.y, q.z);
        this.mesh.setMatrixAt(n++, this.m);
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    return n;
  }
}
