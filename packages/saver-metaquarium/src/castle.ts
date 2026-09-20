/**
 * The landmark: a castle. One thing in the world bigger than everything else,
 * that the eye goes to first and the village is arranged around.
 *
 * It obeys the world rule — the made is voxel, minerals are faceted — by being
 * both: curtain walls, towers, a gatehouse and banners are laid in voxel
 * courses, and every tower is ROOFED with a faceted crystal spire that glows in
 * the scene's colours. The keep in the middle is a grand geode (built by the
 * caller with `buildGeode`, so it is the same home, only bigger). A paved road
 * runs out of the gate between lamp posts: the first piece of layout that says
 * somebody planned this place.
 *
 * Two geometries: the voxel masonry (one draw, front faces) and the crystal +
 * lit windows (one draw, unshaded). Everything is static; the light it throws
 * joins the field as emitters at the spire tips and the gate.
 */

import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { CrystalRng, Emitter } from './crystals';
import { CubeWriter } from './scenery-paint';

export interface CastleSpec {
  x: number; y: number; z: number;
  /** Yaw, radians: which way the gate looks (0 = toward +z, the default camera). */
  facing: number;
  scale: number;
  /** Spire colours, cycled round the towers. */
  palette: readonly string[];
  /** 2 raises an upper ward on a terrace inside the walls: a second ring, four taller towers, a stair. */
  tiers?: 1 | 2;
}

export interface CastleParts {
  masonry: BufferGeometry;
  crystal: BufferGeometry;
  emitters: Emitter[];
  obstacles: { x: number; y: number; z: number; r: number; h: number }[];
  /** Places a fish can be sent: just outside the gate, the courtyard, the road's end. */
  marks: Record<string, { x: number; y: number; z: number }>;
  /** Where the keep goes, and how big a geode fits the courtyard. */
  keep: { x: number; y: number; z: number; scale: number };
  counts: { towers: number; cubes: number; triangles: number };
}

const STONE = ['#56627c', '#4b5670', '#626f8a', '#454f68'];
const WARM = '#ffc76e';

class Facets {
  readonly pos: number[] = []; readonly col: number[] = [];
  tri(a: number[], b: number[], c: number[], ca: Color, cb: Color, cc: Color): void {
    this.pos.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
    this.col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  }
  quad(a: number[], b: number[], c: number[], d: number[], lo: Color, hi: Color): void {
    this.tri(a, b, c, lo, lo, hi); this.tri(a, c, d, lo, hi, hi);
  }
  /** A hexagonal crystal: prism to a shoulder, then a point. White-hot at the root. */
  spire(x: number, y: number, z: number, r: number, h: number, tint: Color, rng: CrystalRng, lean: [number, number] = [0, 0]): void {
    const spin = rng.next() * 6.28, sides = 6, shoulder = rng.range(0.6, 0.74);
    const ring = (k: number, rr: number): number[][] => Array.from({ length: sides }, (_, i) => {
      const a = spin + (i / sides) * Math.PI * 2;
      return [x + Math.cos(a) * rr + lean[0] * h * k, y + h * k, z + Math.sin(a) * rr + lean[1] * h * k];
    });
    const hot = tint.clone().lerp(new Color('#ffffff'), 0.6);
    const foot = ring(0, r), top = ring(shoulder, r * 0.86), apex = [x + lean[0] * h, y + h, z + lean[1] * h];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, k = rng.range(0.55, 1.05);
      this.quad(foot[i]!, foot[j]!, top[j]!, top[i]!, hot.clone().multiplyScalar(k), tint.clone().multiplyScalar(k));
      const c = tint.clone().multiplyScalar(k * 0.8);
      this.tri(top[i]!, top[j]!, apex, c, c, tint.clone().lerp(new Color('#ffffff'), 0.35));
    }
  }
}

export function buildCastle(spec: CastleSpec, rng: CrystalRng): CastleParts {
  const s = spec.scale, V = 3.4 * s;
  const cubes = new CubeWriter(), facets = new Facets();
  const cs = Math.cos(spec.facing), sn = Math.sin(spec.facing);
  /** Castle-local (u across the gate, w out through it) → world. */
  const W = (u: number, w: number): [number, number] => [spec.x + u * cs + w * sn, spec.z - u * sn + w * cs];
  const stones = STONE.map(c => new Color(c));
  const stone = (): Color => stones[Math.floor(rng.next() * stones.length)]!;
  const warm = new Color(WARM), dark = new Color('#1d2333');
  const palette = spec.palette.length ? spec.palette : ['#49cfff', '#a17bff', '#ff67bc'];
  const emitters: Emitter[] = [];
  const obstacles: CastleParts['obstacles'] = [];
  const emit = (x: number, y: number, z: number, color: Color, reach: number): void => {
    emitters.push({ x, y, z, r: color.r, g: color.g, b: color.b, reach, phase: rng.next() * 6.28 });
  };

  const two = (spec.tiers ?? 1) >= 2;
  const R = (two ? 108 : 86) * s, wallH = 9, towerH = 17;
  const gateHalf = 0.2 * (two ? 0.8 : 1); // radians either side of the gate left open
  const box = (u: number, w: number, y0: number, su: number, h: number, sw: number, c: Color, yaw = 0, flat = false): void => {
    const [x, z] = W(u, w);
    cubes.cube(x, spec.y + y0 + h / 2, z, su, h, sw, c, spec.facing + yaw, flat);
  };

  /** A ring of voxel courses, crenellated, open at the gate. */
  const ringWall = (rad: number, y0: number, h: number): void => {
    const columns = Math.round((Math.PI * 2 * rad) / V);
    const half = Math.asin(Math.min(0.9, (Math.sin(gateHalf) * R) / rad)); // same gate WIDTH on any ring
    for (let i = 0; i < columns; i++) {
      const a = (i / columns) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < half) continue;
      const u = Math.sin(a) * rad, w = Math.cos(a) * rad;
      // Two courses per column, different stones, so the wall reads as laid.
      const split = Math.min(h - 1, 3 + Math.floor(rng.next() * 4));
      box(u, w, y0, V * 1.04, split * V, V * 1.6, stone(), a);
      box(u, w, y0 + split * V, V * 1.04, (h - split) * V, V * 1.6, stone(), a);
      if (i % 2 === 0) box(u + Math.sin(a) * V * 0.45, w + Math.cos(a) * V * 0.45, y0 + h * V, V * 1.04, V * 1.2, V * 0.7, stone(), a);
      // Arrow slits, lit from inside.
      if (i % 5 === 2) box(u + Math.sin(a) * V * 0.82, w + Math.cos(a) * V * 0.82, y0 + h * V * 0.5, V * 0.36, V * 2.2, V * 0.1, warm, a, true);
    }
  };

  /** A round voxel drum with a flared parapet and a crystal for a roof. */
  let towers = 0;
  const tower = (a: number, rad: number, y0: number, big: number, spireK = 1): void => {
    const ti = towers++;
    const u = Math.sin(a) * rad, w = Math.cos(a) * rad;
    const [tx, tz] = W(u, w);
    const tr = 3.1 * big, hgt = Math.round(towerH * big);
    const drum = Math.round(tr * 2 * Math.PI);
    for (let k = 0; k < drum; k++) {
      const b = (k / drum) * Math.PI * 2;
      const du = Math.sin(b) * tr * V, dw = Math.cos(b) * tr * V;
      const split = 5 + Math.floor(rng.next() * 6);
      box(u + du, w + dw, y0, V * 1.08, split * V, V * 1.08, stone(), b);
      box(u + du, w + dw, y0 + split * V, V * 1.08, (hgt - split) * V, V * 1.08, stone(), b);
      // Parapet flares one voxel out; every other merlon stands.
      box(u + du * 1.22, w + dw * 1.22, y0 + hgt * V, V * 1.1, V * 1.1, V * 1.1, stone(), b);
      if (k % 2 === 0) box(u + du * 1.22, w + dw * 1.22, y0 + (hgt + 1.1) * V, V * 1.1, V, V * 1.1, stone(), b);
      if (k % 4 === 1) box(u + du * 1.09, w + dw * 1.09, y0 + (hgt - 5 - (k % 8)) * V, V * 0.5, V * 1.6, V * 0.5, warm, b, true);
    }
    // The roof: a crystal grown out of the drum, with a court of small ones.
    const tint = new Color(palette[ti % palette.length]!);
    const top = spec.y + y0 + hgt * V;
    const sr = rng.fork(60 + ti);
    const h = (26 + sr.range(0, 12)) * big * spireK * s;
    facets.spire(tx, top, tz, tr * V * 0.78, h, tint, sr);
    for (let c = 0; c < 4; c++) {
      // The court's bearing is castle-local, like the masonry's, so the roof
      // turns with its tower (`W` maps a local angle to world by -facing).
      const oa = sr.next() * 6.28 - spec.facing, lean = sr.range(0.18, 0.4);
      facets.spire(tx + Math.cos(oa) * tr * V * 0.45, top, tz + Math.sin(oa) * tr * V * 0.45, tr * V * 0.3, h * sr.range(0.35, 0.6), tint, sr,
        [Math.cos(oa) * lean, Math.sin(oa) * lean]);
    }
    // What a floor-hugger must clear here is the spire's tip, not the parapet:
    // a dome per tower, the castle's own dome covers the walls between.
    obstacles.push({ x: tx, y: spec.y, z: tz, r: tr * V * 1.5, h: y0 + hgt * V + h });
    emit(tx, top + h * 0.5, tz, tint, 70 * big * s);
    // A banner off the parapet, in the spire's colour.
    const flag = tint.clone().multiplyScalar(0.8);
    for (let f = 0; f < 4; f++) box(u + (tr + 1.4) * V * Math.sin(a), w + (tr + 1.4) * V * Math.cos(a), y0 + (hgt - 2 - f * 1.05) * V, V * 0.95 - f * 0.12 * V, V, V * 0.3, f % 2 ? flag : flag.clone().multiplyScalar(0.7), a);
  };

  ringWall(R, 0, wallH);
  tower(gateHalf + 0.09, R, 0, 1.25); tower(-gateHalf - 0.09, R, 0, 1.25); // the gatehouse pair
  for (const a of [Math.PI * 0.5, -Math.PI * 0.5]) tower(a, R, 0, 1);
  for (const a of [Math.PI * 0.82, -Math.PI * 0.82]) tower(a, R, 0, 1.1);

  // The upper ward: a terrace raised inside the walls, its own ring and four
  // taller towers, reached by a stair from the courtyard. The keep stands on it.
  const P = two ? 7 * V : 0, R2 = 50 * s;
  if (two) {
    const lip = R2 + 7 * s;
    // Retaining wall, battered in two courses.
    const cols = Math.round((Math.PI * 2 * lip) / V);
    for (let i = 0; i < cols; i++) {
      const a = (i / cols) * Math.PI * 2;
      box(Math.sin(a) * lip, Math.cos(a) * lip, 0, V * 1.06, P, V * 1.5, stone(), a);
      if (i % 3 === 0) box(Math.sin(a) * (lip + V * 0.7), Math.cos(a) * (lip + V * 0.7), 0, V * 1.06, P * 0.45, V * 0.9, stone(), a);
    }
    // The terrace floor.
    const step = V * 2, n = Math.ceil(lip / step);
    const flagA = new Color('#77829b'), flagB = new Color('#646f89');
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      if (Math.hypot(i, j) * step > lip) continue;
      box(i * step, j * step, P - V * 0.3, step * 0.98, V * 0.3, step * 0.98, (i + j) % 2 ? flagA : flagB);
    }
    ringWall(R2, P, 6);
    for (const a of [Math.PI * 0.27, -Math.PI * 0.27, Math.PI * 0.75, -Math.PI * 0.75]) tower(a, R2, P, 1.15, 1.5);
    // The stair: up from the courtyard to the upper gate.
    const steps = Math.ceil(P / (V * 0.6));
    for (let k = 0; k < steps; k++) {
      const rise = P - k * V * 0.6;
      box(0, lip + V * 0.75 + k * V, 0, V * 5.2, Math.max(V * 0.3, rise), V * 1.02, k % 2 ? flagA : flagB);
    }
    for (const side of [-1, 1]) box(side * V * 3, lip + V * 0.75, P, V * 0.8, V * 2.4, V * 0.8, warm, 0, true);
  }

  // Gatehouse: a lintel over the opening, a dark passage, a portcullis of light.
  const gw = Math.sin(gateHalf) * R;
  box(0, R, wallH * V * 0.72, gw * 2.1, wallH * V * 0.5, V * 2.2, stones[1]!);
  for (let k = -3; k <= 3; k++) if (k % 2 === 0) box(k * gw * 0.3, R + V * 0.6, wallH * V * 1.22, V * 1.2, V * 1.2, V * 0.8, stone());
  box(0, R - V * 0.4, 0, gw * 1.9, wallH * V * 0.72, V * 0.3, dark, 0, true);
  for (let k = -2; k <= 2; k++) box(k * gw * 0.36, R - V * 0.1, 0, V * 0.22, wallH * V * 0.7, V * 0.22, warm, 0, true);
  const [gx, gz] = W(0, R + 6 * s);
  emit(gx, spec.y + 14 * s, gz, warm, 60 * s);

  // The road: paving out of the gate, lamp posts either side, a round plaza.
  const paveA = new Color('#6f7a92'), paveB = new Color('#5c6780');
  const roadLen = 16;
  for (let k = 0; k < roadLen; k++) {
    for (let j = -2; j <= 2; j++) {
      if ((k * 3 + j * 5) % 11 === 0) continue; // a missing flag here and there
      box(j * V * 1.5, R + (k + 1.2) * V * 1.5, 0, V * 1.42, V * 0.22, V * 1.42, (k + j) % 2 ? paveA : paveB);
    }
    if (k % 5 === 2) for (const side of [-1, 1]) {
      const u = side * V * 4.6, w = R + (k + 1.2) * V * 1.5;
      box(u, w, 0, V * 0.5, V * 4.2, V * 0.5, dark);
      box(u, w, V * 4.2, V * 1.1, V * 0.3, V * 1.1, dark);
      box(u, w, V * 4.5, V * 0.8, V * 0.9, V * 0.8, warm, 0, true);
      box(u, w, V * 5.4, V * 1.1, V * 0.3, V * 1.1, dark);
      const [lx, lz] = W(u, w);
      if (side === 1 || k === 2) emit(lx, spec.y + V * 5, lz, warm, 26 * s);
    }
  }
  const plazaW = R + (roadLen + 3.5) * V * 1.5;
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
    const d = Math.hypot(i, j);
    if (d > 5.3 || (d > 1.2 && d < 2.1)) continue;
    box(i * V * 1.5, plazaW + j * V * 1.5, 0, V * 1.42, V * (d < 1.2 ? 0.5 : 0.22), V * 1.42, (i + j) % 2 ? paveA : paveB);
  }

  const masonry = new BufferGeometry();
  masonry.setAttribute('position', new BufferAttribute(new Float32Array(cubes.pos), 3));
  masonry.setAttribute('color', new BufferAttribute(new Float32Array(cubes.col), 3));
  const crystal = new BufferGeometry();
  crystal.setAttribute('position', new BufferAttribute(new Float32Array(facets.pos), 3));
  crystal.setAttribute('color', new BufferAttribute(new Float32Array(facets.col), 3));

  const [mx, mz] = W(0, R + 14 * s), [px, pz] = W(0, plazaW), [cx, cz] = W(0, R * 0.55);
  return {
    masonry, crystal, emitters,
    obstacles: [{ x: spec.x, y: spec.y, z: spec.z, r: R + 12 * s, h: (towerH + 4) * V + P }, ...obstacles],
    marks: {
      gate: { x: mx, y: spec.y + 16 * s, z: mz },
      plaza: { x: px, y: spec.y + 20 * s, z: pz },
      courtyard: { x: cx, y: spec.y + P + 22 * s, z: cz },
    },
    keep: { x: spec.x, y: spec.y + P, z: spec.z - (two ? 6 * s : 0), scale: (two ? 1.35 : 1.8) * s },
    counts: { towers, cubes: cubes.count, triangles: cubes.count * 12 + facets.pos.length / 9 },
  };
}
