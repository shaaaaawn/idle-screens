/**
 * A babyfish's hiccup bubbles. "Hic!" — at the jolt a bubble pops out of its
 * mouth, a tiny one just after, and they wobble up where they were let go
 * while the baby swims on, quicken, and pop. A bubble leaves with the baby's
 * own speed and loses it to the water in a moment — spat out ahead, then left
 * behind.
 *
 * A bubble is an EMISSION — where and when it left — and its flight is a
 * closed form of the time since (`burpAt`). The tank notes the emission the
 * first frame it sees a hiccup's jolt, where the mouth is then; a viewer that
 * seeks back before it drops the bubble, and sees it again when the hiccup
 * comes round.
 */
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, SphereGeometry, type Scene } from 'three';
import { stackPatch } from './hooks';

/** Seconds a bubble lives, at most: it pops sooner at the ceiling. */
export const BURP_LIFE = 3.2;
/** Seconds the tiny bubble trails the first. */
export const BURP_TRAIL = 0.14;
const POP = 0.12;
const CAP = 48;

export interface Burp {
  t: number; x: number; y: number; z: number; r: number; seed: number;
  /** The baby's velocity when it let go (units/s). */
  vx: number; vy: number; vz: number;
}
/** Seconds a bubble takes to lose the baby's speed (to 1/e). */
export const BURP_DRAG = 0.3;
export interface BurpPose { visible: boolean; x: number; y: number; z: number; s: number }

/** Where bubble `b` is at `t`: rising and quickening, wobbling, popping at the end of its life or at `top`. */
export function burpAt(b: Burp, t: number, top: number, out: BurpPose): BurpPose {
  const a = t - b.t;
  // Faster when bigger, like a real bubble; a gentle start out of the mouth.
  const v0 = 3 + 2.5 * b.r, acc = 2.5 + 2 * b.r;
  const y = b.y + v0 * a + 0.5 * acc * a * a;
  const life = Math.min(BURP_LIFE, popAge(b, top));
  out.visible = a >= 0 && a <= life;
  if (!out.visible) return out;
  const w = Math.min(1, a / 0.6) * b.r * 0.5;
  const carry = BURP_DRAG * (1 - Math.exp(-a / BURP_DRAG));
  out.x = b.x + b.vx * carry + Math.sin(a * 7.3 + b.seed * 6.28) * w;
  out.z = b.z + b.vz * carry + Math.cos(a * 6.1 + b.seed * 4.1) * w;
  out.y = y + b.vy * carry;
  // Out of the mouth with an overshoot; at the end a swell, and gone.
  const born = a < 0.18 ? Math.sin((a / 0.18) * Math.PI * 0.65) / Math.sin(Math.PI * 0.65) : 1;
  const pop = a > life - POP ? 1 + 0.45 * ((a - (life - POP)) / POP) : 1;
  // A rising bubble wobbles in shape too.
  out.s = b.r * born * pop * (1 + 0.06 * Math.sin(a * 13 + b.seed * 9));
  return out;
}

/** The age at which bubble `b` reaches `top`. */
function popAge(b: Burp, top: number): number {
  const h = top - b.y, v0 = 3 + 2.5 * b.r, acc = 2.5 + 2 * b.r;
  if (h <= 0) return 0;
  return (-v0 + Math.sqrt(v0 * v0 + 2 * acc * h)) / acc;
}

/** Rim bright, middle clear, a catchlight up and to the left: a bubble. */
function bubbleLook(m: MeshBasicMaterial): void {
  stackPatch(m, 'mq-burp', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBurpN;\nvarying vec3 vBurpV;')
      .replace('#include <project_vertex>', `#include <project_vertex>
      {
        vec3 n = normal;
        #ifdef USE_INSTANCING
          n = mat3(instanceMatrix) * n;
        #endif
        vBurpN = normalize(normalMatrix * n);
        vBurpV = normalize(-mvPosition.xyz);
      }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBurpN;\nvarying vec3 vBurpV;')
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
      {
        vec3 n = normalize(vBurpN);
        float rim = pow(1.0 - abs(dot(n, normalize(vBurpV))), 1.8);
        float spark = smoothstep(0.86, 0.95, dot(n, normalize(vec3(-0.45, 0.6, 0.66))));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), spark);
        diffuseColor.a *= max(mix(0.1, 0.9, rim), spark);
      }`);
  });
}

export class BurpLayer {
  readonly mesh: InstancedMesh;
  private readonly burps = new Map<string, Burp>();
  private readonly pose: BurpPose = { visible: false, x: 0, y: 0, z: 0, s: 0 };
  private readonly m = new Matrix4();

  constructor(scene: Scene) {
    const geo = new SphereGeometry(1, 16, 12);
    geo.userData.mqOwned = true;
    const mat = new MeshBasicMaterial({ color: new Color('#d8f6ff'), transparent: true, depthWrite: false });
    mat.userData.mqOwned = true;
    bubbleLook(mat);
    this.mesh = new InstancedMesh(geo, mat, CAP);
    this.mesh.name = 'baby-burps';
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** A hiccup's bubbles, once per `key` (the baby and its hiccup), from (x, y, z) at `t`; `r` is the big one's radius. */
  emit(key: string, t: number, x: number, y: number, z: number, r: number, seed: number, vx = 0, vy = 0, vz = 0): void {
    if (this.burps.has(key) || this.burps.size >= CAP - 1) return;
    this.burps.set(key, { t, x, y, z, r, seed, vx, vy, vz });
    // The tiny one leaves a moment later, from where the mouth has got to.
    const k = BURP_TRAIL;
    this.burps.set(`${key}+`, { t: t + k, x: x + vx * k + r * 0.3, y: y + vy * k + r * 0.2, z: z + vz * k, r: r * 0.5, seed: seed + 0.37, vx, vy, vz });
  }

  /** Where each bubble left from and when (for inspect). */
  list(): { key: string; t: number; x: number; y: number; z: number }[] {
    const r = (v: number): number => Math.round(v * 10) / 10;
    return [...this.burps].map(([key, b]) => ({ key, t: r(b.t), x: r(b.x), y: r(b.y), z: r(b.z) }));
  }

  /** How many bubbles are noted (in flight, or waiting on a seek). */
  get size(): number { return this.burps.size; }

  /** Place every bubble for `t`; forget those whose time is over (or not yet come). */
  update(t: number, top: number): number {
    let n = 0;
    for (const [key, b] of this.burps) {
      const p = burpAt(b, t, top, this.pose);
      if (!p.visible) {
        // The trailing bubble waits on its own start; the big one's key says when the pair began.
        const base = key.endsWith('+') ? this.burps.get(key.slice(0, -1)) : b;
        if (!base || t < base.t || t > b.t + BURP_LIFE) this.burps.delete(key);
        continue;
      }
      this.m.makeScale(p.s, p.s, p.s).setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    return n;
  }
}
