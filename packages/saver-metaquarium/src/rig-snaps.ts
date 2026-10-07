/**
 * Measuring a rig's motion for snaps, frame by frame at 30 fps — what the
 * eye reads as a tick or a jerk. A snap is a spike in the CHANGE of a bone's
 * turning between frames (its angular acceleration, radians per frame²);
 * a smooth gesture, however big, keeps it small.
 *
 * Used by the minted breeds' tests (angel, turtle, …) on the real rig: each
 * moment played alone, and a minute's swim through the driver.
 */
import { Quaternion, type AnimationAction, type AnimationMixer, type Bone, type Object3D } from 'three';

export interface ClipRig {
  mixer: AnimationMixer;
  actions: Record<string, AnimationAction>;
  durations: Record<string, number>;
}

/** The skeleton's bones, in scene order. */
export function bonesOf(scene: Object3D): Object3D[] {
  const out: Object3D[] = [];
  scene.traverse((o) => { if ((o as Bone).isBone) out.push(o); });
  return out;
}

/** Tracks the bones' world turning over successive frames. */
class Watch {
  private q1: Quaternion[]; private q2: Quaternion[]; private n = 0;
  private q = new Quaternion(); private v1 = new Quaternion(); private v2 = new Quaternion(); private inv = new Quaternion();
  constructor(private bones: Object3D[]) {
    this.q1 = bones.map(() => new Quaternion());
    this.q2 = bones.map(() => new Quaternion());
  }
  /** After a pose: each bone's step (radians this frame) and acceleration, or null on the first two frames. */
  step(each: (bone: Object3D, step: number, acc: number) => void): void {
    this.bones.forEach((bone, k) => {
      bone.getWorldQuaternion(this.q);
      if (this.n > 1) {
        this.v1.copy(this.q).multiply(this.inv.copy(this.q1[k]!).invert());
        this.v2.copy(this.q1[k]!).multiply(this.inv.copy(this.q2[k]!).invert());
        each(bone, this.q.angleTo(this.q1[k]!), this.v1.angleTo(this.v2));
      }
      this.q2[k]!.copy(this.q1[k]!);
      this.q1[k]!.copy(this.q);
    });
    this.n++;
  }
}

/** Each of `moments` played alone at full weight: those whose worst acceleration reaches `limit`, described. */
export function momentSnaps(scene: Object3D, rig: ClipRig, moments: readonly string[], limit = 0.03): string[] {
  const bones = bonesOf(scene), snaps: string[] = [];
  for (const m of moments) {
    const w = new Watch(bones);
    let worst = 0, at = '';
    for (const n of Object.keys(rig.actions)) rig.actions[n]!.setEffectiveWeight(n === m ? 1 : 0);
    const D = rig.durations[m]!;
    for (let i = 0; i <= Math.floor(D * 30); i++) {
      rig.actions[m]!.time = Math.min(i / 30, D - 1e-4);
      rig.mixer.update(0);
      scene.updateMatrixWorld(true);
      w.step((bone, _s, acc) => { if (acc > worst) { worst = acc; at = `${bone.name} at ${(i / 30).toFixed(2)} s`; } });
    }
    if (worst >= limit) snaps.push(`${m}: ${at} (${worst.toFixed(3)})`);
  }
  return snaps;
}

export interface SwimInput { pace: number; flurry: number; turn: number; viewer: { yaw: number; pitch: number } | null }

export interface SwimMotion {
  /** The 99th-percentile step (radians a frame) while not darting. */
  p99: number;
  /** The worst acceleration while not darting, and where. */
  worstAcc: number; worstAt: string;
  /** The worst step at all, darts included. */
  worstStep: number;
}

/**
 * A minute (by default) of each fish in `cast` through its driver `frame`:
 * idling to cruising and back, a dart now and then, weaving turns, the
 * viewer drifting about.
 */
export function swimMotion(scene: Object3D, cast: readonly number[], frame: (t: number, fish: number, beat: number, inp: SwimInput) => void, seconds = 60): SwimMotion {
  const bones = bonesOf(scene), steady: number[] = [];
  let worstStep = 0, worstAcc = 0, worstAt = '';
  for (const fish of cast) {
    const w = new Watch(bones);
    let beat = 0;
    for (let i = 0; i <= seconds * 30; i++) {
      const t = i / 30;
      const pace = 0.6 + 0.6 * Math.sin(t * 0.21);
      const flurry = Math.max(0, Math.sin(t * 0.37) - 0.85) * 6;
      const turn = 0.25 * Math.sin(t * 0.5) + 0.1 * Math.sin(t * 1.3);
      beat += (pace * 12) / 30;
      frame(t, fish, beat, { pace, flurry, turn, viewer: { yaw: 0.4 * Math.sin(t * 0.2), pitch: 0.1 } });
      scene.updateMatrixWorld(true);
      w.step((bone, step, acc) => {
        worstStep = Math.max(worstStep, step);
        if (flurry > 0) return;
        steady.push(step);
        if (acc > worstAcc) { worstAcc = acc; worstAt = `fish ${fish}: ${bone.name} at ${t.toFixed(2)} s`; }
      });
    }
  }
  steady.sort((x, y) => x - y);
  return { p99: steady[Math.floor(steady.length * 0.99)]!, worstAcc, worstAt, worstStep };
}
