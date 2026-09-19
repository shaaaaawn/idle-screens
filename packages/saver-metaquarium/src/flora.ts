/**
 * Flora that feeds on the light.
 *
 * Everything in the mineral world is still except the fish; flora is what
 * makes it water. Three species, all VOXEL (the world's rule: minerals are
 * faceted, the living is voxel), all rooted near a crystal and coloured by it:
 *
 *   kelp  — tall, curved, with alternating leaf blades and a lit tip
 *   reed  — a clump of thin stalks, each ending in a bright bead
 *   bulb  — a short stem carrying a lantern head between four petals
 *
 * They lean TOWARD their crystal — that is what "feeds on the light" looks
 * like — and they move in the vertex shader, so the whole field is one draw
 * call and zero CPU per frame: a slow sway that grows with height, a gust that
 * travels across the field (phase from the root's position, so neighbours
 * follow each other instead of nodding in unison), and tips that breathe.
 * All of it is a pure function of the tank clock.
 */

import { BoxGeometry, BufferAttribute, type BufferGeometry, Color, Quaternion, Vector3 } from 'three';
import type { CrystalRng } from './crystals';
import { painted } from './scenery-paint';

export type FloraSpecies = 'kelp' | 'reed' | 'bulb';

export interface FloraAnchor { x: number; y: number; z: number; color: string }

export interface FloraOptions {
  density: number;
  cap: number;
  scale: number;
  /** True where something solid already stands (a home, a boulder). */
  blocked(x: number, z: number): boolean;
}

export interface FloraField {
  parts: BufferGeometry[];
  /** The lights — tips, beads, lantern heads: drawn as polished metal. */
  lamps: BufferGeometry[];
  plants: number;
  bySpecies: Record<FloraSpecies, number>;
}

const Q = new Quaternion();

export function buildFlora(
  anchors: readonly FloraAnchor[], terrain: (x: number, z: number) => number,
  rng: CrystalRng, opts: FloraOptions,
): FloraField {
  const parts: BufferGeometry[] = [];
  const lamps: BufferGeometry[] = [];
  const bySpecies: Record<FloraSpecies, number> = { kelp: 0, reed: 0, bulb: 0 };
  const s = opts.scale;
  const want = Math.round(opts.density * opts.cap * 6);
  if (!want || !anchors.length) return { parts, lamps, plants: 0, bySpecies };

  let plants = 0;
  for (let i = 0; i < want * 2 && plants < want; i += 1) {
    const home = anchors[i % anchors.length]!;
    const angle = rng.range(0, Math.PI * 2);
    // Thick at the crystal's skirt, thinning outward.
    const radius = (16 + 26 * rng.next() ** 1.6) * s;
    const x = home.x + Math.cos(angle) * radius, z = home.z + Math.sin(angle) * radius;
    if (opts.blocked(x, z)) continue;
    const near = anchors.reduce((b, c) => (Math.hypot(x - c.x, z - c.z) < Math.hypot(x - b.x, z - b.z) ? c : b), home);
    const root = terrain(x, z);
    const pick = rng.next();
    const species: FloraSpecies = pick < 0.45 ? 'kelp' : pick < 0.78 ? 'reed' : 'bulb';
    const light = new Color(near.color);
    const stem = light.clone().lerp(new Color('#2f8f7a'), 0.55);
    // Unit vector toward the light, for the lean.
    const dx = near.x - x, dz = near.z - z, dl = Math.hypot(dx, dz) || 1;
    const lx = dx / dl, lz = dz / dl;
    const phase = rng.range(0, Math.PI * 2);
    const gust = x * 0.021 + z * 0.015;
    const from = parts.length, lampFrom = lamps.length;

    const box = (px: number, py: number, pz: number, w: number, h: number, d: number, c: Color, glow: number, shade = true): void => {
      const g = painted(new BoxGeometry(1, 1, 1), `#${c.getHexString()}`, new Vector3(px, py, pz), new Vector3(w, h, d), Q, shade);
      const n = g.getAttribute('position').count;
      const glows = new Float32Array(n).fill(glow);
      g.setAttribute('aGlow', new BufferAttribute(glows, 1));
      (glow ? lamps : parts).push(g);
    };
    // A stalk of stacked voxels that curves toward the light.
    const stalk = (ox: number, oz: number, height: number, segs: number, girth: number, lean: number, tip: number): [number, number, number] => {
      let tx = ox, ty = root, tz = oz;
      for (let j = 0; j < segs; j += 1) {
        const h = (j + 0.5) / segs;
        const bend = h * h * lean * height;
        tx = ox + lx * bend + Math.sin(h * 2.6 + phase) * girth * 0.8;
        tz = oz + lz * bend;
        ty = root + h * height;
        const c = stem.clone().multiplyScalar(0.3 + h * 0.55);
        box(tx, ty, tz, girth * (1 - h * 0.35), height / segs + 0.15, girth * 0.85 * (1 - h * 0.35), c, 0);
      }
      if (tip > 0) box(tx, ty + height / segs * 0.6, tz, girth * tip, girth * tip * 1.3, girth * tip, light, 1, false);
      return [tx, ty, tz];
    };

    if (species === 'kelp') {
      const height = rng.range(22, 46) * s, segs = 9, girth = rng.range(1, 1.5) * s;
      stalk(x, z, height, segs, girth, rng.range(0.1, 0.22), 1.6);
      for (let j = 2; j < segs - 1; j += 2) {
        const h = (j + 0.5) / segs, bend = h * h * 0.16 * height;
        const sidex = -lz * (j % 4 === 2 ? 1 : -1), sidez = lx * (j % 4 === 2 ? 1 : -1);
        const len = rng.range(3.4, 5.4) * s * (1 - h * 0.3);
        box(x + lx * bend + sidex * len * 0.55, root + h * height, z + lz * bend + sidez * len * 0.55,
          Math.abs(sidex) * len + girth * 0.7, 1 * s, Math.abs(sidez) * len + girth * 0.7,
          stem.clone().multiplyScalar(0.42 + h * 0.4), 0);
      }
    } else if (species === 'reed') {
      const n = 3 + Math.floor(rng.next() * 3);
      for (let k = 0; k < n; k += 1) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(0.5, 2.6) * s;
        stalk(x + Math.cos(a) * r, z + Math.sin(a) * r, rng.range(9, 20) * s, 5, 0.55 * s, rng.range(0.12, 0.3), 2.2);
      }
    } else {
      const height = rng.range(6, 11) * s;
      const [tx, ty, tz] = stalk(x, z, height, 3, 1.1 * s, 0.08, 0);
      const head = rng.range(2.4, 3.4) * s;
      box(tx, ty + head * 0.75, tz, head, head, head, light.clone().lerp(new Color('#ffffff'), 0.35), 1, false);
      // A lantern, not a cube: a cap and a collar in darker metal.
      const brass = light.clone().lerp(new Color('#c9a15a'), 0.6).multiplyScalar(0.55);
      box(tx, ty + head * 1.32, tz, head * 1.25, head * 0.16, head * 1.25, brass, 1, false);
      box(tx, ty + head * 1.5, tz, head * 0.45, head * 0.22, head * 0.45, brass, 1, false);
      box(tx, ty + head * 0.2, tz, head * 1.15, head * 0.14, head * 1.15, brass, 1, false);
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        box(tx + ax * head * 0.72, ty + head * 0.45, tz + az * head * 0.72, head * 0.45, head * 0.7, head * 0.45, stem.clone().multiplyScalar(0.7), 0);
      }
    }
    // Every vertex of this plant shares its root, phase and place in the gust.
    for (const g of [...parts.slice(from), ...lamps.slice(lampFrom)]) {
      const n = g.getAttribute('position').count;
      const sway = new Float32Array(n * 3);
      for (let v = 0; v < n; v += 1) sway.set([root, phase, gust], v * 3);
      g.setAttribute('aSway', new BufferAttribute(sway, 3));
    }
    bySpecies[species] += 1;
    plants += 1;
  }
  return { parts, lamps, plants, bySpecies };
}

/** The sway, as shader text. Exported so the test can hold it to "pure in t". */
export const FLORA_VERTEX = /* glsl */ `
  #include <begin_vertex>
  float h = max(0.0, position.y - aSway.x);
  float reach = h * h * 0.0042;
  float gustWave = sin(uSwayTime * 0.31 - aSway.z) * 0.5 + 0.5;
  transformed.x += (sin(uSwayTime * 0.55 + aSway.y + h * 0.07) + gustWave * 1.4) * reach;
  transformed.z += cos(uSwayTime * 0.38 + aSway.y + h * 0.06) * reach * 0.55;
`;
export const FLORA_COLOR = /* glsl */ `
  #include <color_vertex>
  vColor.rgb *= 1.0 + aGlow * 0.3 * sin(uSwayTime * 0.75 + aSway.y);
`;

/** Lamps are lit metal: their vertex colour is both the metal's tint and what
 *  it emits, so a bead is anodised in its crystal's colour AND glows in it. */
export const FLORA_LAMP_EMISSIVE = /* glsl */ `
  #include <emissivemap_fragment>
  totalEmissiveRadiance += vColor.rgb * 0.5;
`;
