/**
 * The far distance. Everything else in the mineral world lives inside one
 * depth band, close to the lens; past the fog line the frame used to be empty.
 * This is what stands out there: three rings of silhouettes — rock spires,
 * castle-sized crystals, and one grand geode with its door lit — each ring
 * fainter than the one in front, all of them dissolving into haze at the foot.
 *
 * They are not lit and not fogged by distance from the CAMERA (the far side of
 * a ring would simply vanish). Atmospheric perspective is per ring, baked into
 * a vertex attribute, and the colour is `fog + tint × haze`: a shape made of
 * slightly-more-light than the water behind it, which reads on a near-black
 * ocean and on a bright green one alike. One merged geometry, one draw.
 */

import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { CrystalRng } from './crystals';

export interface HorizonOptions {
  /** 0..1 — how much stands on the horizon. */
  amount: number;
  /** Colours for the distant crystals (the scene's own). */
  palette: readonly string[];
  /** False when the world already has its landmark: one grand thing, not two. */
  geode?: boolean;
  /** The world's `crystalScale` — sizes and places the horizon like every
   *  other piece of mineral-world geometry. Defaults to 1 (unscaled). */
  scale?: number;
}

export interface Horizon {
  geometry: BufferGeometry | null;
  counts: { spires: number; crystals: number; geodes: number };
  triangles: number;
}

/** Ring radii, and how much of its tint each ring keeps through the water. */
export const HORIZON_RINGS: ReadonlyArray<{ r: number; haze: number; tall: number }> = [
  { r: 520, haze: 1, tall: 1 },
  { r: 660, haze: 0.6, tall: 1.35 },
  { r: 820, haze: 0.34, tall: 1.8 },
];

const FALLBACK = ['#49cfff', '#a17bff', '#ff67bc'];
const ROCK = new Color('#8fa3c8');

/** No generated vertex may sit farther than this from the origin. The camera
 *  sits at most `CAMERA_FAR - HORIZON_SAFE_R` (tank.ts's `CAMERA_FAR`, 1400,
 *  minus this) from the origin at `cameraDistance`'s widest orbit (400), so a
 *  point this close to the origin stays inside the far plane even when the
 *  camera is on its far side — with margin for the small vertical offset this
 *  purely-radial bound ignores. */
export const HORIZON_SAFE_R = 950;

export const HORIZON_VERTEX = /* glsl */ `
  #include <begin_vertex>
  // Haze pools at the foot: a silhouette has no base, it rises out of the murk.
  vHorizon = aHaze.x * (aHaze.y > 0.0 ? smoothstep(0.0, aHaze.y, position.y) : 1.0);
`;
export const HORIZON_FRAGMENT = /* glsl */ `
  #include <color_fragment>
  diffuseColor.rgb = uHorizonFog + diffuseColor.rgb * vHorizon;
`;

class Tris {
  readonly pos: number[] = []; readonly col: number[] = []; readonly haze: number[] = [];
  haz = 1; fade = 0;
  tri(a: number[], b: number[], c: number[], ca: Color, cb: Color, cc: Color): void {
    this.pos.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
    this.col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
    for (let i = 0; i < 3; i++) this.haze.push(this.haz, this.fade);
  }
  quad(a: number[], b: number[], c: number[], d: number[], lo: Color, hi: Color): void {
    this.tri(a, b, c, lo, lo, hi); this.tri(a, c, d, lo, hi, hi);
  }
}

/** A faceted column from stacked rings to a point; `lean` tips it over. */
function column(t: Tris, x: number, z: number, h: number, r: number, sides: number, spin: number,
  lean: [number, number], profile: ReadonlyArray<readonly [number, number]>, foot: Color, tip: Color, rng: CrystalRng): void {
  const ring = (k: number, rr: number): number[][] => Array.from({ length: sides }, (_, i) => {
    const a = spin + (i / sides) * Math.PI * 2;
    return [x + Math.cos(a) * rr + lean[0] * h * k, h * k, z + Math.sin(a) * rr + lean[1] * h * k];
  });
  const tones = Array.from({ length: sides }, () => rng.range(0.72, 1.12));
  let prev = ring(0, r), pk = 0;
  for (const [k, rr] of profile) {
    const next = ring(k, r * rr);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const lo = foot.clone().lerp(tip, pk).multiplyScalar(tones[i]!), hi = foot.clone().lerp(tip, k).multiplyScalar(tones[i]!);
      t.quad(prev[i]!, prev[j]!, next[j]!, next[i]!, lo, hi);
    }
    prev = next; pk = k;
  }
  const apex = [x + lean[0] * h * 1.0, h, z + lean[1] * h * 1.0];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const c = tip.clone().multiplyScalar(tones[i]!);
    t.tri(prev[i]!, prev[j]!, apex, c, c, c);
  }
}

export function buildHorizon(rng: CrystalRng, opts: HorizonOptions): Horizon {
  const counts = { spires: 0, crystals: 0, geodes: 0 };
  if (opts.amount <= 0) return { geometry: null, counts, triangles: 0 };
  const palette = opts.palette.length ? opts.palette : FALLBACK;
  const s = opts.scale ?? 1;
  const t = new Tris();
  const geodeBearing = rng.next() * Math.PI * 2;
  HORIZON_RINGS.forEach((ring, ri) => {
    const rr = rng.fork(20 + ri);
    const slots = Math.round((7 + ri * 3) * (0.35 + 0.65 * opts.amount));
    t.haz = ring.haze;
    for (let i = 0; i < slots; i++) {
      const a = (i / slots) * Math.PI * 2 + rr.range(-0.16, 0.16) + ri * 0.4;
      // The grand geode owns its stretch of the first ring.
      if (ri === 0 && opts.geode !== false && Math.abs(Math.atan2(Math.sin(a - geodeBearing), Math.cos(a - geodeBearing))) < 0.42) continue;
      // Clamped to HORIZON_SAFE_R: at large `crystalScale` the ring's own
      // radius alone could otherwise sit past the far plane.
      const rad = Math.min((ring.r + rr.range(-45, 45)) * s, HORIZON_SAFE_R);
      const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
      if (rr.next() < 0.42) {
        // A stand of castle crystals: a tall one and its leaning court.
        const tint = new Color(palette[Math.floor(rr.next() * palette.length)]!);
        const n = 3 + Math.floor(rr.next() * 4);
        const H = rr.range(130, 230) * ring.tall * s;
        t.fade = H * 0.55;
        for (let c = 0; c < n; c++) {
          const h = c === 0 ? H : H * rr.range(0.35, 0.75);
          const offRaw = c === 0 ? 0 : rr.range(18, 46) * ring.tall * s;
          const oa = rr.next() * 6.28;
          const leanX = c === 0 ? rr.range(-0.05, 0.05) : Math.cos(oa) * rr.range(0.12, 0.34);
          const leanZ = c === 0 ? rr.range(-0.05, 0.05) : Math.sin(oa) * rr.range(0.12, 0.34);
          const rLocalRaw = h * rr.range(0.07, 0.1);
          // What this ring position has left of HORIZON_SAFE_R's budget, then
          // how much of it the lean eats (the apex can reach `|lean| * h`),
          // then the footprint, then finally the offset from the stand's
          // centre — each trimmed to what's left so no vertex of this column
          // can clear HORIZON_SAFE_R, base crystal or leaning satellite alike.
          const remaining = Math.max(0, HORIZON_SAFE_R - rad);
          const leanReach = Math.hypot(leanX, leanZ) * h;
          const rLocal = Math.min(rLocalRaw, Math.max(0, remaining - leanReach));
          const off = Math.min(offRaw, Math.max(0, remaining - rLocal - leanReach));
          column(t, x + Math.cos(oa) * off, z + Math.sin(oa) * off, h, rLocal, 6, rr.next() * 6.28, [leanX, leanZ],
            [[0.78, 1.0]], tint.clone().multiplyScalar(0.035), tint.clone().multiplyScalar(0.28), rr);
        }
        counts.crystals += 1;
      } else {
        // A rock spire: broad foot, a shoulder, a broken point.
        const H = rr.range(90, 210) * ring.tall * s;
        t.fade = H * 0.7;
        const foot = ROCK.clone().multiplyScalar(0.04), top = ROCK.clone().multiplyScalar(0.085);
        const spireLeanX = rr.range(-0.1, 0.1), spireLeanZ = rr.range(-0.1, 0.1);
        const rLocalRaw = H * rr.range(0.22, 0.36);
        const spin = rr.next() * 6.28;
        // The main spire has no offset to trim, so its own radius is what
        // gets capped to keep its widest (base) ring under HORIZON_SAFE_R.
        const remaining = Math.max(0, HORIZON_SAFE_R - rad);
        const rLocal = Math.min(rLocalRaw, Math.max(0, remaining - Math.hypot(spireLeanX, spireLeanZ) * H));
        column(t, x, z, H, rLocal, 5, spin, [spireLeanX, spireLeanZ],
          [[0.32, 0.74], [0.62, 0.5], [0.86, 0.2]], foot, top, rr);
        if (rr.next() < 0.6) {
          const oa = rr.next() * 6.28;
          const offRaw = H * 0.3;
          const hCompanion = H * rr.range(0.4, 0.62), rCompanionRaw = H * 0.16;
          const spin2 = rr.next() * 6.28;
          // No lean on the companion, so its own radius is the whole reach.
          const rCompanion = Math.min(rCompanionRaw, remaining);
          const off = Math.min(offRaw, Math.max(0, remaining - rCompanion));
          column(t, x + Math.cos(oa) * off, z + Math.sin(oa) * off, hCompanion, rCompanion, 5, spin2, [0, 0],
            [[0.4, 0.7], [0.8, 0.3]], foot, top, rr);
        }
        counts.spires += 1;
      }
    }
  });
  // The grand geode: the biggest home in the world, seen from the village.
  if (opts.amount >= 0.4 && opts.geode !== false) {
    const gr = rng.fork(40);
    const R = 150 * s;
    // Its own column has no lean, so its base ring (radius R) is the whole
    // reach beyond its centre — cap that centre so the shell stays inside
    // HORIZON_SAFE_R even at a large `crystalScale`.
    const rad = Math.min((HORIZON_RINGS[0]!.r + 30) * s, Math.max(0, HORIZON_SAFE_R - R));
    const gx = Math.sin(geodeBearing) * rad, gz = Math.cos(geodeBearing) * rad;
    t.haz = 1; t.fade = R * 0.55;
    const shell = ROCK.clone().multiplyScalar(0.06), cap = ROCK.clone().multiplyScalar(0.11);
    column(t, gx, gz, R * 1.15, R, 9, gr.next() * 6.28, [0, 0],
      [[0.3, 0.98], [0.58, 0.82], [0.8, 0.55], [0.93, 0.28]], shell, cap, gr);
    // Its door and windows face the village; they are light, so no haze at the foot.
    t.fade = 0;
    const tint = new Color(palette[0]!);
    const glow = tint.clone().lerp(new Color('#ffb860'), 0.75).multiplyScalar(0.3), dimGlow = glow.clone().multiplyScalar(0.5);
    const inX = -Math.sin(geodeBearing), inZ = -Math.cos(geodeBearing), sX = inZ, sZ = -inX;
    const face = (u: number, y: number, push: number): number[] => [gx + inX * push + sX * u, y, gz + inZ * push + sZ * u];
    const rAt = (y: number): number => R * (y < R * 0.35 ? 0.99 : 0.9) + 2 * s;
    // Arched door: a stack of narrowing slabs.
    [[26, 0, 30], [24, 30, 50], [17, 50, 64], [8, 64, 72]].forEach(([w, y0, y1]) => {
      const sw = w! * s, sy0 = y0! * s, sy1 = y1! * s;
      t.quad(face(-sw, sy0, rAt(sy0)), face(sw, sy0, rAt(sy0)), face(sw, sy1, rAt(sy1)), face(-sw, sy1, rAt(sy1)), dimGlow, glow);
    });
    [[-62, 58], [62, 66], [-38, 104], [30, 112]].forEach(([u, y]) => {
      const su = u! * s, sy = y! * s;
      const push = Math.sqrt(Math.max(0, rAt(sy) ** 2 - su * su)) * 0.97;
      t.quad(face(su - 5 * s, sy - 7 * s, push), face(su + 5 * s, sy - 7 * s, push), face(su + 5 * s, sy + 7 * s, push), face(su - 5 * s, sy + 7 * s, push), glow, glow);
    });
    counts.geodes = 1;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(t.pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(t.col), 3));
  g.setAttribute('aHaze', new BufferAttribute(new Float32Array(t.haze), 2));
  return { geometry: g, counts, triangles: t.pos.length / 9 };
}
