/**
 * Flora that feeds on the light.
 *
 * Everything in the mineral world is still except the fish; flora is what
 * makes it water. The living is VOXEL (minerals are faceted — the world's one
 * rule), and voxel means CUBES ON A GRID. The first flora was stretched boxes
 * with horizontal rungs, and read as ladders and aerials; a plant made of
 * cubes reads as a plant because its curves are stair-steps and its leaves
 * climb. Five species, planted as a garden round each crystal — low at the
 * skirt, tall behind:
 *
 *   grass  tufts of short blades at the crystal's feet (the ground cover)
 *   tube   a cluster of tube sponges, each mouth lit from inside
 *   bulb   a short stem carrying a lantern, capped in brass
 *   fan    a sea fan: a flat branching tree that faces its crystal
 *   kelp   a tall meandering stalk with stair-step blades and a lit bud
 *
 * They take their crystal's colour and lean TOWARD it — that is what feeding
 * on the light looks like. All motion is in the vertex shader (one draw, zero
 * CPU per frame, pure in the tank clock): a sway that grows with height², a
 * gust whose phase comes from the root's position so it crosses the field,
 * and lights that breathe. Geometry is written straight into arrays — a
 * garden is thousands of cubes, and cloning a BoxGeometry for each was most of
 * the scenery's build time.
 */

import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { CrystalRng } from './crystals';

export type FloraSpecies = 'grass' | 'tube' | 'bulb' | 'fan' | 'kelp';
export const FLORA_SPECIES: readonly FloraSpecies[] = ['grass', 'tube', 'bulb', 'fan', 'kelp'];

export interface FloraAnchor { x: number; y: number; z: number; color: string }

export interface FloraOptions {
  density: number;
  cap: number;
  scale: number;
  /** True where something solid already stands (a home, a boulder). */
  blocked(x: number, z: number): boolean;
}

export interface FloraField {
  /** One merged geometry (or none): stems, leaves, tubes. */
  parts: BufferGeometry[];
  /** One merged geometry (or none): the lights — drawn as polished metal. */
  lamps: BufferGeometry[];
  plants: number;
  voxels: number;
  bySpecies: Record<FloraSpecies, number>;
}

/** Voxel-art face values: top brightest, the two side pairs apart, bottom dark. */
const FACES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 0, 1], [0, -1, 0, 0.42], [1, 0, 0, 0.8], [-1, 0, 0, 0.62], [0, 0, 1, 0.72], [0, 0, -1, 0.55],
];

class VoxelWriter {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly sway: number[] = [];
  readonly glow: number[] = [];
  count = 0;
  root = 0; phase = 0; gust = 0;

  cube(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, c: Color, lit: number, flat = false): void {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    for (const [nx, ny, nz, shade] of FACES) {
      // Two in-plane axes for this face.
      const ax = ny !== 0 ? [1, 0, 0] : nx !== 0 ? [0, 0, 1] : [1, 0, 0];
      const bx = ny !== 0 ? [0, 0, 1] : [0, 1, 0];
      const flip = (nx + ny + nz) * (ny !== 0 ? -1 : nx !== 0 ? -1 : 1) < 0;
      const corner = (s: number, t: number): [number, number, number] => [
        cx + nx * hx + ax[0]! * s * hx + bx[0]! * t * hx,
        cy + ny * hy + ax[1]! * s * hy + bx[1]! * t * hy,
        cz + nz * hz + ax[2]! * s * hz + bx[2]! * t * hz,
      ];
      const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      const k = flat ? 1 : shade;
      for (const i of order) {
        const p = q[i]!;
        this.pos.push(p[0], p[1], p[2]);
        this.nor.push(nx, ny, nz);
        this.col.push(c.r * k, c.g * k, c.b * k);
        this.sway.push(this.root, this.phase, this.gust);
        this.glow.push(lit);
      }
    }
    this.count += 1;
  }

  geometry(): BufferGeometry[] {
    if (!this.count) return [];
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aSway', new BufferAttribute(new Float32Array(this.sway), 3));
    g.setAttribute('aGlow', new BufferAttribute(new Float32Array(this.glow), 1));
    return [g];
  }
}

/** How far out each species lives (in units of scale), and its share of a garden. */
const HABITAT: Readonly<Record<FloraSpecies, { near: number; far: number; share: number }>> = {
  grass: { near: 9, far: 24, share: 0.34 },
  tube: { near: 13, far: 25, share: 0.14 },
  bulb: { near: 14, far: 30, share: 0.14 },
  fan: { near: 19, far: 36, share: 0.16 },
  kelp: { near: 24, far: 46, share: 0.22 },
};

export function buildFlora(
  anchors: readonly FloraAnchor[], terrain: (x: number, z: number) => number,
  rng: CrystalRng, opts: FloraOptions,
): FloraField {
  const bySpecies: Record<FloraSpecies, number> = { grass: 0, tube: 0, bulb: 0, fan: 0, kelp: 0 };
  const body = new VoxelWriter(), lamp = new VoxelWriter();
  const s = opts.scale;
  const want = Math.round(opts.density * opts.cap * 9);
  if (!want || !anchors.length) return { parts: [], lamps: [], plants: 0, voxels: 0, bySpecies };
  const V = 1.7 * s; // the voxel
  const white = new Color('#ffffff'), leafGreen = new Color('#2f9d7c'), brassBase = new Color('#c9a15a');

  let plants = 0;
  for (let i = 0; i < want * 3 && plants < want; i += 1) {
    const home = anchors[i % anchors.length]!;
    // Species by share, so a garden keeps its proportions at any density.
    let pick = rng.next(), species: FloraSpecies = 'grass';
    for (const sp of FLORA_SPECIES) { if (pick < HABITAT[sp].share) { species = sp; break; } pick -= HABITAT[sp].share; }
    const hab = HABITAT[species];
    const angle = rng.range(0, Math.PI * 2);
    const radius = (hab.near + (hab.far - hab.near) * rng.next() ** 1.4) * s;
    const x = home.x + Math.cos(angle) * radius, z = home.z + Math.sin(angle) * radius;
    if (opts.blocked(x, z)) continue;
    const near = anchors.reduce((b, c) => (Math.hypot(x - c.x, z - c.z) < Math.hypot(x - b.x, z - b.z) ? c : b), home);
    const root = terrain(x, z);
    const light = new Color(near.color);
    const stem = light.clone().lerp(leafGreen, 0.62);
    const dx = near.x - x, dz = near.z - z, dl = Math.hypot(dx, dz) || 1;
    const lx = dx / dl, lz = dz / dl; // toward the light
    const phase = rng.range(0, Math.PI * 2), gust = x * 0.021 + z * 0.015;
    for (const w of [body, lamp]) { w.root = root; w.phase = phase; w.gust = gust; }
    const tone = (h: number, k = 1): Color => stem.clone().multiplyScalar((0.34 + 0.62 * h) * k);

    if (species === 'grass') {
      const blades = 4 + Math.floor(rng.next() * 5);
      for (let b = 0; b < blades; b += 1) {
        const bx = x + rng.range(-3.2, 3.2) * s, bz = z + rng.range(-3.2, 3.2) * s;
        const n = 2 + Math.floor(rng.next() * 4), lean = rng.range(-0.5, 0.5);
        for (let j = 0; j < n; j += 1) {
          const h = (j + 0.5) / n;
          body.cube(bx + Math.round(lean * j) * V * 0.5, root + (j + 0.5) * V * 0.8, bz, V * 0.55, V * 0.8, V * 0.55, tone(h, 1.05), 0);
        }
      }
    } else if (species === 'tube') {
      const tubes = 3 + Math.floor(rng.next() * 3);
      const hue = light.clone().lerp(new Color('#ff7aa8'), 0.35);
      for (let t = 0; t < tubes; t += 1) {
        const a = (t / tubes) * Math.PI * 2 + rng.next(), r = (t === 0 ? 0 : rng.range(2.2, 4.2)) * s;
        const tx = x + Math.cos(a) * r, tz = z + Math.sin(a) * r;
        const n = 3 + Math.floor(rng.next() * (t === 0 ? 6 : 4)), w = V * (t === 0 ? 1.9 : 1.45);
        for (let j = 0; j < n; j += 1) {
          const h = (j + 0.5) / n;
          body.cube(tx, root + (j + 0.5) * V, tz, w, V, w, hue.clone().multiplyScalar(0.3 + 0.55 * h), 0);
        }
        // The lit mouth: a lip, and light down inside it.
        body.cube(tx, root + (n + 0.25) * V, tz, w * 1.25, V * 0.5, w * 1.25, hue.clone().multiplyScalar(0.95), 0);
        lamp.cube(tx, root + (n + 0.3) * V, tz, w * 0.7, V * 0.45, w * 0.7, light.clone().lerp(white, 0.35), 1, true);
      }
    } else if (species === 'bulb') {
      const n = 3 + Math.floor(rng.next() * 3);
      let tx = x, tz = z;
      for (let j = 0; j < n; j += 1) {
        const h = (j + 0.5) / n;
        tx = x + Math.round(lx * h * 1.2) * V * 0.5; tz = z + Math.round(lz * h * 1.2) * V * 0.5;
        body.cube(tx, root + (j + 0.5) * V, tz, V * 0.8, V, V * 0.8, tone(h), 0);
      }
      const top = root + n * V, head = V * 2;
      const brass = light.clone().lerp(brassBase, 0.6).multiplyScalar(0.6);
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        body.cube(tx + ax * head * 0.62, top + head * 0.35, tz + az * head * 0.62, V * 0.7, head * 0.7, V * 0.7, tone(0.9, 0.85), 0);
      }
      lamp.cube(tx, top + head * 0.18, tz, head * 1.05, head * 0.16, head * 1.05, brass, 1, true);
      lamp.cube(tx, top + head * 0.75, tz, head * 0.9, head * 0.9, head * 0.9, light.clone().lerp(white, 0.35), 1, true);
      lamp.cube(tx, top + head * 1.3, tz, head * 1.15, head * 0.18, head * 1.15, brass, 1, true);
      lamp.cube(tx, top + head * 1.5, tz, head * 0.4, head * 0.24, head * 0.4, brass, 1, true);
    } else if (species === 'fan') {
      // A sea fan: a flat tree in the plane that faces its crystal, grown on
      // the voxel grid so every limb is a run of cubes.
      const px = -lz, pz = lx; // the fan's plane runs across the light
      const coral = light.clone().lerp(new Color('#ff6f91'), 0.45);
      const seen = new Set<string>();
      const grow = (gu: number, gv: number, du: number, len: number, depth: number): void => {
        for (let k = 0; k < len; k += 1) {
          gv += 1;
          if (k % 2 === 1) gu += du;
          const key = `${gu},${gv}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const h = Math.min(1, gv / 16);
          body.cube(x + px * gu * V, root + (gv - 0.5) * V, z + pz * gu * V, V, V, V * 0.8, coral.clone().multiplyScalar(0.32 + 0.62 * h), 0);
          if (depth > 0 && k > 1 && rng.next() < 0.42) grow(gu, gv, du === 0 ? (rng.next() < 0.5 ? -1 : 1) : -du, Math.max(3, len - k - 1), depth - 1);
        }
        if (depth <= 1) lamp.cube(x + px * gu * V, root + (gv + 0.4) * V, z + pz * gu * V, V * 0.85, V * 0.85, V * 0.85, light.clone().lerp(white, 0.3), 1, true);
      };
      const tall = 7 + Math.floor(rng.next() * 6);
      grow(0, 0, 0, 3, 0);
      grow(0, 3, -1, tall, 2);
      grow(0, 3, 1, tall - 1, 2);
      grow(0, 3, 0, tall + 1, 1);
    } else {
      // Kelp: a stalk that meanders on the grid and leans to the light, with
      // blades that CLIMB away from it in two-cube stair-steps.
      const n = 12 + Math.floor(rng.next() * 14);
      const wander = rng.range(0.25, 0.5), lean = rng.range(0.1, 0.24);
      let tx = x, tz = z;
      for (let j = 0; j < n; j += 1) {
        const h = (j + 0.5) / n;
        const off = Math.round(Math.sin(j * wander + phase) * 1.4 + h * h * lean * n);
        tx = x + (lx * off + -lz * Math.round(Math.cos(j * wander * 0.7 + phase) * 0.8)) * V * 0.55;
        tz = z + (lz * off + lx * Math.round(Math.cos(j * wander * 0.7 + phase) * 0.8)) * V * 0.55;
        const y = root + (j + 0.5) * V;
        body.cube(tx, y, tz, V * (1 - h * 0.3), V, V * (1 - h * 0.3), tone(h), 0);
        if (j > 2 && j < n - 1 && j % 3 === 0) {
          const dir = (j / 3) % 2 ? 1 : -1;
          const sxv = -lz * dir, szv = lx * dir;
          const blade = 2 + Math.floor(rng.next() * 3);
          for (let k = 1; k <= blade; k += 1) {
            body.cube(tx + sxv * k * V * 0.9, y + k * V * 0.55, tz + szv * k * V * 0.9, V * 0.95, V * 0.6, V * 0.7, tone(h, 1.12 - k * 0.06), 0);
          }
        }
      }
      lamp.cube(tx, root + (n + 0.45) * V, tz, V * 1.15, V * 1.15, V * 1.15, light.clone().lerp(white, 0.3), 1, true);
    }
    bySpecies[species] += 1;
    plants += 1;
  }
  return { parts: body.geometry(), lamps: lamp.geometry(), plants, voxels: body.count + lamp.count, bySpecies };
}

/** The sway, as shader text. Exported so the test can hold it to "pure in t".
 *  Gentle: a 40-unit kelp tip moves about four units, and a gust adds as much
 *  again as it passes — enough to be water, not enough to be wind. */
export const FLORA_VERTEX = /* glsl */ `
  #include <begin_vertex>
  float h = max(0.0, position.y - aSway.x);
  float reach = min(h * h * 0.0016, 3.4);
  float gustWave = sin(uSwayTime * 0.31 - aSway.z) * 0.5 + 0.5;
  transformed.x += (sin(uSwayTime * 0.55 + aSway.y + h * 0.07) + gustWave * 1.2) * reach;
  transformed.z += cos(uSwayTime * 0.38 + aSway.y + h * 0.06) * reach * 0.6;
`;
export const FLORA_COLOR = /* glsl */ `
  #include <color_vertex>
  vColor.rgb *= 1.0 + aGlow * 0.3 * sin(uSwayTime * 0.75 + aSway.y);
`;

/** Lamps are lit metal: their vertex colour is both the metal's tint and what
 *  it emits, so a bud is anodised in its crystal's colour AND glows in it. */
export const FLORA_LAMP_EMISSIVE = /* glsl */ `
  #include <emissivemap_fragment>
  totalEmissiveRadiance += vColor.rgb * 0.5;
`;
