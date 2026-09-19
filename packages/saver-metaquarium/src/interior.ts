/**
 * Inside a geode home — the room behind the round door.
 *
 * From outside, a geode home is a broken stone with a house in its throat.
 * Inside it is the reverse: the whole room IS the crystal. The shell is a
 * displaced dome seen from within — agate strata banding the wall, a throat of
 * crystal teeth all over it (coarse druse at the skirting, fine sparkle toward
 * the apex, a few great points standing proud), white-hot at the root like
 * every crystal in this world.
 *
 * And then somebody lives here. Everything the inhabitants MADE is voxel — the
 * world's one rule — and furnished the way a small cosy-game house is: a plank
 * floor and a round rug, a bed with a quilt, a table laid with a teapot, a
 * bookshelf, an iron stove with a kettle (the room's bubble vent) and a flue up
 * through the roof, a floor lamp, potted lantern plants, pictures, a chest, the
 * round door with its mat, a round window onto the blue outside, and a
 * chandelier of little crystal lanterns hung from the apex.
 *
 * The lights are real emitters in the tank's light field — chandelier, lamp,
 * stove, window — so they pool on the floor and tint a fish that swims under
 * them, and each wears a bloom card. The room is sized for the fish as its
 * citizens: the swim volume (radius 120, y 15–72) fits inside with the
 * furniture pushed to the walls, and the default orbit camera stays indoors.
 *
 * Seeded, generated, batched: four draw calls, nothing per frame on the CPU.
 */

import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, IcosahedronGeometry, Quaternion, Vector3,
} from 'three';
import type { CrystalRng, Emitter } from './crystals';
import { painted } from './scenery-paint';

export interface InteriorOptions {
  /** Hex — the geode's crystal colour. */
  tint: string;
  scale: number;
  floorY: number;
  /** 0..1 — how much of the druse lining to grow (weak devices grow less). */
  detail?: number;
}

export interface InteriorLight { x: number; y: number; z: number; size: number; color: string }

export interface InteriorParts {
  /** The dome, wound to face INWARD (draw front faces). */
  shell: BufferGeometry[];
  /** Unshaded: crystal teeth, lamps, fire, window. */
  glow: BufferGeometry[];
  voxels: BufferGeometry[];
  emitters: Emitter[];
  lights: InteriorLight[];
  vents: Array<{ x: number; y: number; z: number; color: string }>;
  obstacles: Array<{ x: number; y: number; z: number; r: number; h: number }>;
  radius: number;
  height: number;
  triangles: number;
}

/** Room size at scale 1: wall radius and apex height. The tank's swim volume
 *  is radius 120 / y ≤ 72 and its camera orbits from distance 80 up. */
export const ROOM_RADIUS = 172;
export const ROOM_HEIGHT = 132;

const linear = (hex: string): [number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};

export function buildGeodeInterior(rng: CrystalRng, opts: InteriorOptions): InteriorParts {
  const s = opts.scale, y0 = opts.floorY;
  const R = ROOM_RADIUS * s, H = ROOM_HEIGHT * s;
  const tint = new Color(opts.tint);
  const white = new Color('#ffffff');

  // ---- the crystal dome ---------------------------------------------------
  const ico = new IcosahedronGeometry(1, 5);
  const src = ico.getAttribute('position');
  const bump = new Map<string, number>();
  const brng = rng.fork(1);
  const at = (i: number): Vector3 => {
    const x = src.getX(i), y = src.getY(i), z = src.getZ(i);
    const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let v = bump.get(k);
    if (v === undefined) { v = brng.range(0.95, 1.06); bump.set(k, v); }
    return new Vector3(x * v * R, y0 + y * v * H, z * v * R);
  };
  const shellP: number[] = [], shellC: number[] = [], glowP: number[] = [], glowC: number[] = [];
  const put = (arr: number[], col: number[], p: Vector3, c: Color): void => { arr.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); };

  // Agate strata: the wall is banded by height, the bands wandering with the
  // angle so they read as grown, not painted.
  const deep = tint.clone().multiplyScalar(0.12);
  const body = tint.clone().multiplyScalar(0.42);
  const quartz = new Color('#f1e9f7').multiplyScalar(0.5);
  const pale = tint.clone().lerp(white, 0.45).multiplyScalar(0.75);
  const strata = [deep, body, quartz, body, pale, body, deep, body];
  const srng = rng.fork(2), trng = rng.fork(3);
  const wob = srng.next() * 6.28;
  const centre = new Vector3(0, y0 + H * 0.3, 0);
  const mid = new Vector3(), inward = new Vector3();
  const faces: Array<[Vector3, Vector3, Vector3, number]> = [];
  const Y_UP = new Vector3(0, 1, 0);
  for (let i = 0; i < src.count; i += 3) {
    const a = at(i), b = at(i + 1), c = at(i + 2);
    mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    const up = (mid.y - y0) / H; // 0 floor … 1 apex
    if (up < -0.04) continue;
    const ang = Math.atan2(mid.z, mid.x);
    const band = up * 9 + Math.sin(ang * 3 + wob) * 0.55 + Math.sin(ang * 7 - wob) * 0.22;
    // `band` dips below zero at the skirting: a bare % would index strata[-1].
    const bi = ((Math.floor(band) % strata.length) + strata.length) % strata.length;
    const lo = strata[bi]!, hi = strata[(bi + 1) % strata.length]!;
    const f = band - Math.floor(band);
    // The wall itself stays dark and quietly banded: it is the ground the
    // crystals grow from, and they — not it — carry the light.
    const lit = (0.34 + 0.4 * (1 - up) ** 1.5) * srng.range(0.85, 1.12);
    const wall = lo.clone().lerp(hi, f * f * (3 - 2 * f)).lerp(deep, 0.45).multiplyScalar(lit);
    for (const p of [a, c, b]) put(shellP, shellC, p, wall); // wound inward
    if (up > 0) faces.push([a.clone(), b.clone(), c.clone(), up]);
  }

  // The druse: thousands of small three-sided points carpeting the wall, NOT
  // one per facet — a geode's lining is far finer than the stone it lines.
  // Each leans its own way, is dark at the root and catches the room's light at
  // the tip, and its three faces take three values so it reads as cut. Coarse
  // and dense at the skirting, finer toward the apex; a few great points and
  // the odd water-clear one for sparkle.
  faces.sort((p, q) => p[3] - q[3]); // floor first, so the bias below means LOW
  const side = new Vector3(), fwd = new Vector3(), axis = new Vector3(), base = new Vector3();
  const FACE = [1, 0.66, 0.4];
  const crystals = Math.round(5200 * Math.min(1, opts.detail ?? 1));
  for (let n = 0; n < crystals; n += 1) {
    // Bias toward the lower wall, where the eye is.
    const face = faces[Math.floor(trng.next() ** 1.35 * faces.length)]!;
    const [a, b, c, up] = face;
    let u = trng.next(), v = trng.next();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    base.copy(a).addScaledVector(side.subVectors(b, a), u).addScaledVector(fwd.subVectors(c, a), v);
    inward.copy(centre).sub(base).normalize();
    axis.copy(inward).add(new Vector3(trng.range(-0.5, 0.5), trng.range(-0.5, 0.5), trng.range(-0.5, 0.5))).normalize();
    const great = trng.next() < 0.012;
    const len = (great ? trng.range(30, 52) : (up < 0.2 ? trng.range(8, 19) : trng.range(4.5, 12))) * s;
    const wid = len * trng.range(0.26, 0.42);
    side.crossVectors(axis, Y_UP).normalize();
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    fwd.crossVectors(axis, side).normalize();
    const spin = trng.next() * 6.28;
    const foot: Vector3[] = [];
    for (let k = 0; k < 3; k += 1) {
      const ang2 = spin + (k / 3) * Math.PI * 2;
      foot.push(base.clone().addScaledVector(side, Math.cos(ang2) * wid).addScaledVector(fwd, Math.sin(ang2) * wid)
        .addScaledVector(inward, -1.5 * s)); // sunk into the wall
    }
    const tip = base.clone().addScaledVector(axis, len);
    const clear = trng.next() < 0.1;
    const glowUp = 0.5 + 0.5 * (1 - up);
    const rootC = (clear ? quartz : tint).clone().multiplyScalar(0.2 * glowUp);
    const tipBase = clear ? white.clone() : tint.clone().lerp(white, great ? 0.55 : 0.3);
    for (let k = 0; k < 3; k += 1) {
      const p = foot[k]!, q = foot[(k + 1) % 3]!;
      const tipC = tipBase.clone().multiplyScalar(FACE[k]! * glowUp * (great ? 1.25 : 1.05));
      const rc = rootC.clone().multiplyScalar(FACE[k]! + 0.4);
      put(glowP, glowC, p, rc); put(glowP, glowC, tip, tipC); put(glowP, glowC, q, rc);
    }
  }
  ico.dispose();
  const soup = (pos: number[], col: number[]): BufferGeometry => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    g.computeVertexNormals();
    return g;
  };
  const shell = [soup(shellP, shellC)];
  const glow: BufferGeometry[] = [soup(glowP, glowC)];

  // ---- what the inhabitants made (voxels) ---------------------------------
  const voxels: BufferGeometry[] = [];
  const emitters: Emitter[] = [], lights: InteriorLight[] = [];
  const vents: InteriorParts['vents'] = [];
  const obstacles: InteriorParts['obstacles'] = [];
  const Y = new Vector3(0, 1, 0);
  /** A piece of furniture stood at polar (angle, radius), facing the centre.
   *  Local space: +x along the wall, +y up, +z toward the middle of the room. */
  const piece = (angleDeg: number, radius: number) => {
    const a = (angleDeg * Math.PI) / 180;
    const ox = Math.cos(a) * radius * s, oz = Math.sin(a) * radius * s;
    const yaw = new Quaternion().setFromAxisAngle(Y, Math.atan2(-ox, -oz));
    const world = (lx: number, ly: number, lz: number): Vector3 =>
      new Vector3(lx * s, 0, lz * s).applyQuaternion(yaw).add(new Vector3(ox, y0 + ly * s, oz));
    const vox = (lx: number, ly: number, lz: number, w: number, h: number, d: number, color: string, lit = false): void => {
      (lit ? glow : voxels).push(painted(new BoxGeometry(1, 1, 1), color, world(lx, ly, lz), new Vector3(w * s, h * s, d * s), yaw, !lit));
    };
    const lamp = (lx: number, ly: number, lz: number, size: number, color: string, power = 1): void => {
      const p = world(lx, ly, lz);
      const [r, g, b] = linear(color);
      emitters.push({ x: p.x, y: p.y, z: p.z, r: r * power, g: g * power, b: b * power, reach: size * 1.5 * s, phase: rng.next() * 6.28 });
      lights.push({ x: p.x, y: p.y, z: p.z, size: size * s, color });
    };
    const solid = (r: number, h: number): void => { obstacles.push({ x: ox, y: y0, z: oz, r: r * s, h: h * s }); };
    return { vox, lamp, world, solid };
  };

  // Plank floor: strips across the room, cut to the wall's chord.
  const planks = ['#8b5e3c', '#7c5236', '#94673f', '#845839'];
  const fr = R * 0.97 / s;
  for (let k = 0, z = -fr + 6; z < fr; z += 12, k += 1) {
    const half = Math.sqrt(Math.max(1, fr * fr - z * z));
    voxels.push(painted(new BoxGeometry(1, 1, 1), planks[k % 4]!, new Vector3(0, y0 + 0.4 * s, z * s), new Vector3(half * 2 * s, 1.2 * s, 11.6 * s)));
  }
  // Round rug, in rings, slightly off-centre the way a rug is.
  const rugC = [`#${tint.clone().lerp(white, 0.55).getHexString()}`, '#f4ead2', `#${tint.clone().multiplyScalar(0.8).getHexString()}`, '#f4ead2'];
  const cell = 7, rugR = 52;
  for (let gx = -rugR; gx <= rugR; gx += cell) {
    for (let gz = -rugR; gz <= rugR; gz += cell) {
      const d = Math.hypot(gx, gz);
      if (d > rugR) continue;
      voxels.push(painted(new BoxGeometry(1, 1, 1), rugC[Math.floor(d / 14) % 4]!,
        new Vector3((gx + 6) * s, y0 + 1.3 * s, (gz - 4) * s), new Vector3(cell * s, 0.7 * s, cell * s)));
    }
  }

  // Bed, against the wall, with a quilt in the home's colour.
  {
    const p = piece(205, 132);
    p.vox(0, 4, 0, 34, 6, 20, '#6e4630');
    p.vox(0, 8.5, 0, 32, 4, 18, '#f3efe6');
    p.vox(-11, 11.5, 0, 9, 3, 13, '#ffffff');
    p.vox(5, 9.5, 0, 21, 5, 18.6, `#${tint.clone().lerp(white, 0.25).getHexString()}`);
    p.vox(5, 12.2, 0, 21, 0.8, 5, '#f4ead2');
    p.vox(-17.5, 11, 0, 2.5, 20, 20, '#5a3826');
    p.vox(17.5, 6, 0, 2.5, 10, 20, '#5a3826');
    p.vox(-26, 6, 2, 9, 12, 9, '#6e4630'); // bedside table
    p.vox(-26, 13.5, 2, 3, 3, 3, '#ffe2a3', true);
    p.lamp(-26, 15, 2, 20, '#ffd58a', 0.7);
    p.solid(24, 16);
  }
  // Table laid for tea, with two stools — out on the rug.
  {
    const p = piece(150, 46);
    p.vox(0, 10.5, 0, 24, 2, 24, '#9a6a43');
    p.vox(0, 5, 0, 5, 9, 5, '#6e4630');
    p.vox(0, 1.6, 0, 12, 1.2, 12, '#6e4630');
    p.vox(-3, 13.5, 1, 6, 4, 6, '#e9f1f4'); // teapot
    p.vox(-3, 16, 1, 3, 1.4, 3, '#c8d6dc');
    p.vox(1.5, 13.5, 1, 3, 1.5, 1.5, '#e9f1f4');
    p.vox(6, 12.5, -5, 3, 2, 3, '#ffffff');
    p.vox(-7, 12.5, 6, 3, 2, 3, '#ffffff');
    p.vox(18, 4, 0, 8, 7, 8, '#b07a4c');
    p.vox(-18, 4, 4, 8, 7, 8, '#b07a4c');
    p.solid(24, 14);
    vents.push({ ...p.world(-3, 18, 1), color: '#f4f8ff' }); // the teapot steams
  }
  // Bookshelf.
  {
    const p = piece(330, 140);
    p.vox(0, 19, 0, 30, 38, 8, '#5a3826');
    const spines = ['#d8574f', '#e8b04a', '#4fa3d8', '#7bc47f', '#b779d8', '#f1ede4'];
    for (let row = 0; row < 3; row += 1) {
      p.vox(0, 7 + row * 12, 1.5, 27, 9.5, 6, '#2c1c14');
      let x = -12;
      for (let k = 0; x < 12; k += 1) {
        const w = 2 + ((k * 7 + row * 3) % 3);
        p.vox(x + w / 2, 6 + row * 12 + ((k + row) % 3), 2.4, w, 7 + ((k + row) % 3) * 1, 4.4, spines[(k + row * 2) % 6]!);
        x += w + 0.4;
      }
    }
    p.vox(0, 39.5, 1, 6, 3, 5, '#e9f1f4');
    p.solid(18, 40);
  }
  // Iron stove with a kettle; the flue climbs to the roof.
  {
    const p = piece(88, 138);
    p.vox(0, 11, 0, 24, 22, 17, '#2e3440');
    p.vox(0, 23, 0, 27, 2.5, 20, '#3d4656');
    p.vox(0, 9, 8.8, 13, 9, 0.8, '#ff8a2a', true);
    p.vox(0, 9, 9.3, 13, 1, 0.6, '#1d222b');
    p.vox(0, 9, 9.3, 1, 9, 0.6, '#1d222b');
    for (const lx of [-10, 10]) p.vox(lx, 1.5, 0, 3, 3, 14, '#1d222b');
    for (let k = 0; k < 11; k += 1) p.vox(7 + k * 0.25, 29 + k * 9, -3, 5.5, 9.2, 5.5, k % 2 ? '#3d4656' : '#343c4a');
    p.vox(-5, 27, 0, 7, 5, 7, '#c9d3da');
    p.vox(-5, 30.5, 0, 3, 2, 3, '#aebac2');
    p.vox(-0.5, 28, 0, 3, 1.4, 1.4, '#c9d3da');
    p.lamp(0, 9, 18, 46, '#ff8a3a', 0.95);
    p.solid(20, 26);
    vents.push({ ...p.world(-5, 32, 0), color: '#fff1dc' });
    // A basket of logs beside it.
    p.vox(21, 3.5, 3, 11, 7, 11, '#9a6a43');
    for (let k = 0; k < 3; k += 1) p.vox(21, 8 + k * 0.2, -1 + k * 3.4, 12, 3, 3, '#6e4630');
  }
  // Floor lamp and an armchair — the reading corner.
  {
    const p = piece(262, 130);
    p.vox(0, 1.2, 0, 8, 1.6, 8, '#3a2a28');
    p.vox(0, 16, 0, 1.6, 30, 1.6, '#3a2a28');
    p.vox(0, 33, 0, 11, 8, 11, '#ffe2a3', true);
    p.lamp(0, 32, 0, 52, '#ffcf82', 1);
    p.vox(20, 5, 2, 18, 8, 17, `#${tint.clone().multiplyScalar(0.7).getHexString()}`);
    p.vox(20, 13, -5, 18, 12, 4, `#${tint.clone().multiplyScalar(0.62).getHexString()}`);
    for (const lx of [11.5, 28.5]) p.vox(lx, 10, 2, 3, 6, 15, `#${tint.clone().multiplyScalar(0.55).getHexString()}`);
    p.vox(20, 10.5, 3, 12, 3, 11, '#f4ead2');
    p.solid(26, 22);
  }
  // The round door, its frame and its mat.
  {
    const p = piece(28, 158);
    const dr = 17;
    for (let j = 0; j < 9; j += 1) {
      const y = -dr + (j + 0.5) * (2 * dr / 9);
      const w = Math.sqrt(Math.max(1, dr * dr - y * y)) * 2;
      p.vox(0, 18 + y, 0, w + 5, 2 * dr / 9 + 0.05, 2.4, '#3d2a22');
      p.vox(0, 18 + y, 1.4, w, 2 * dr / 9 + 0.05, 2, j % 2 ? '#7a4e35' : '#8a5a3c');
    }
    p.vox(9, 17, 3, 2.4, 2.4, 1.6, '#ffd76a', true);
    p.vox(0, 1.9, 14, 26, 0.8, 14, '#c9574b');
    p.vox(0, 2.2, 14, 20, 0.8, 9, '#f4ead2');
  }
  // A round window onto the blue outside.
  {
    const p = piece(128, 158);
    const wr = 13;
    for (let j = 0; j < 7; j += 1) {
      const y = -wr + (j + 0.5) * (2 * wr / 7);
      const w = Math.sqrt(Math.max(1, wr * wr - y * y)) * 2;
      p.vox(0, 46 + y, 0, w + 5, 2 * wr / 7 + 0.05, 2.4, '#5a3826');
      p.vox(0, 46 + y, 1.2, w, 2 * wr / 7 + 0.05, 1.6, j < 3 ? '#2f6fd6' : '#57b6ff', true);
    }
    p.vox(0, 46, 2.4, 2 * wr, 1.6, 1.2, '#5a3826');
    p.vox(0, 46, 2.4, 1.6, 2 * wr, 1.2, '#5a3826');
    p.vox(0, 31, 3, 30, 2, 7, '#6e4630'); // sill
    p.vox(-9, 35, 3, 5, 6, 5, '#c9574b'); // a pot on it
    p.vox(-9, 40, 3, 3, 4, 3, '#57d38a');
    p.lamp(0, 44, 16, 50, '#4fa8ff', 0.8);
  }
  // Potted lantern plants (the flora from outside, brought in).
  for (const [ang, rad] of [[300, 118], [62, 120], [178, 126]] as const) {
    const p = piece(ang, rad);
    p.vox(0, 4, 0, 9, 8, 9, '#c9704b');
    p.vox(0, 8.4, 0, 10.5, 1.4, 10.5, '#b25f3d');
    p.vox(0, 15, 0, 1.8, 13, 1.8, '#2f8f7a');
    p.vox(3, 14, 0, 5, 1.4, 1.4, '#2f8f7a');
    p.vox(-3, 18, 0, 5, 1.4, 1.4, '#2f8f7a');
    p.vox(0, 24, 0, 5, 5, 5, `#${tint.clone().lerp(white, 0.4).getHexString()}`, true);
    p.lamp(0, 24, 0, 16, `#${tint.getHexString()}`, 0.55);
    p.solid(8, 26);
  }
  // A chest and a stack of crates.
  {
    const p = piece(232, 140);
    p.vox(0, 5, 0, 20, 10, 12, '#7c5236');
    p.vox(0, 11, 0, 21, 3, 13, '#5a3826');
    p.vox(0, 7, 6.4, 3, 4, 0.8, '#ffd76a', true);
    p.vox(18, 5, -1, 11, 10, 11, '#9a6a43');
    p.vox(17, 14, -1, 9, 8, 9, '#8b5e3c');
    p.solid(20, 18);
  }
  // Pictures on the wall.
  for (const [ang, hgt, col] of [[0, 52, '#57b6ff'], [352, 36, '#ffb45a'], [300, 58, '#7bc47f']] as const) {
    const p = piece(ang, 160);
    p.vox(0, hgt, 0, 15, 12, 1.6, '#5a3826');
    p.vox(0, hgt, 1, 12, 9, 1, col);
    p.vox(-2, hgt - 2, 1.6, 5, 4, 0.6, '#f4ead2');
  }
  // Chandelier: a chain from the apex, a ring, six little crystal lanterns.
  {
    const top = y0 + H * 0.98, hang = y0 + 96 * s;
    for (let y = hang + 6 * s; y < top; y += 5 * s) {
      voxels.push(painted(new BoxGeometry(1, 1, 1), '#2e3440', new Vector3(0, y, 0), new Vector3(1.6 * s, 3.4 * s, 1.6 * s)));
    }
    voxels.push(painted(new BoxGeometry(1, 1, 1), '#3d4656', new Vector3(0, hang + 3 * s, 0), new Vector3(6 * s, 4 * s, 6 * s)));
    for (let k = 0; k < 6; k += 1) {
      const a = (k / 6) * Math.PI * 2, rr = 17 * s;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      voxels.push(painted(new BoxGeometry(1, 1, 1), '#3d4656', new Vector3(x * 0.5, hang + 2 * s, z * 0.5),
        new Vector3(Math.abs(Math.cos(a)) * rr + 1.4 * s, 1.4 * s, Math.abs(Math.sin(a)) * rr + 1.4 * s)));
      voxels.push(painted(new BoxGeometry(1, 1, 1), '#3d4656', new Vector3(x, hang - 1 * s, z), new Vector3(1.2 * s, 5 * s, 1.2 * s)));
      glow.push(painted(new BoxGeometry(1, 1, 1), `#${tint.clone().lerp(new Color('#ffe9c4'), 0.6).getHexString()}`,
        new Vector3(x, hang - 6 * s, z), new Vector3(4.6 * s, 6 * s, 4.6 * s), new Quaternion(), false));
    }
    const [r, g, b] = linear('#ffdca0');
    emitters.push({ x: 0, y: hang - 8 * s, z: 0, r, g, b, reach: 120 * s, phase: 0 });
    lights.push({ x: 0, y: hang - 5 * s, z: 0, size: 70 * s, color: '#ffdca0' });
  }

  const triangles = (shellP.length + glowP.length) / 9 + (voxels.length + glow.length - 1) * 12;
  return { shell, glow, voxels, emitters, lights, vents, obstacles, radius: R, height: H, triangles };
}
