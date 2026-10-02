/**
 * Flora that feeds on the light.
 *
 * Everything in the mineral world is still except the fish; flora is what
 * makes it water. The living is VOXEL (minerals are faceted — the world's one
 * rule), and voxel means CUBES ON A GRID. The first flora was stretched boxes
 * with horizontal rungs, and read as ladders and aerials; a plant made of
 * cubes reads as a plant because its curves are stair-steps and its leaves
 * climb. Seventeen species, planted as a garden round each crystal — low at
 * the skirt, tall behind:
 *
 *   grass     tufts of short blades at the crystal's feet (the ground cover)
 *   tube      a cluster of tube sponges, each mouth lit from inside
 *   bulb      a short stem carrying a lantern, capped in brass
 *   fan       a sea fan: a flat branching tree that faces its crystal
 *   kelp      a tall meandering stalk with stair-step blades and a lit bud
 *   anemone   a squat column crowned with climbing tentacles, each tip a bead of light
 *   staghorn  antler coral, forking in every direction, some tips lit
 *   brain     a low dome whose skin is a maze of ridges and grooves
 *   whip      a stand of thin bright rods: all height, so the liveliest sway
 *   barrel    a hollow banded vase with light pooled in the bottom
 *   shelf     glow caps: wide flat caps whose gills shine down the stalk
 *   seapen    a quill with a feather of paired leaves, every other edge lit
 *   clam      a giant clam gaping at the light, its mantle vivid — a specimen, two at most
 *   bubble    bubble algae: glossy orbs on the floor, the one round and shiny thing
 *   elder     the garden's one great blossom tree, a lantern at the end of every limb
 *   curl      a fiddlehead: a frond still wound in its crozier, light at the coil's heart
 *   pod       a stalk carrying one great glowing-sacced orb, or three stems strung with beads
 *
 * They grow in COLONIES (a founder and siblings sharing its genes, so its
 * colour), ramp from a deeper base to a brighter tip, and about one colony in
 * thirty is a rare nacreous morph. Stony things (brain, staghorn, barrel, a
 * clam) barely sway or not at all; tentacles writhe from their crown. On the
 * mid and high tiers the plants take the light field (flora-light.ts): a
 * crystal lights the plants round it, a follow-spot lights the plant it lands
 * on, and sheen gleams on tentacles, bubble algae and rare morphs.
 *
 * From No Man's Sky's flora: plants ANSWER what passes (a crown folds shut,
 * a worm ducks into its tube, a sea pen pulls down, a pod swells, every lamp
 * flares near a fish); species are dimorphic (a sibling may be the small
 * form); and a garden can wear one world palette (`floraPalette`).
 *
 * The room chooses the garden (coral on a reef, kelp and whips in the kelp
 * forest, glow caps in the abyss) unless `floraMix` does. Each plant carries
 * its own colour, mixed with its crystal's, and leans TOWARD the crystal —
 * that is what feeding on the light looks like. Solids (a brain, a barrel, a
 * cap, a clam) draw only the faces that touch water. All motion is in the vertex shader (one draw, zero
 * CPU per frame, pure in the tank clock): a sway that grows with height², a
 * gust whose phase comes from the root's position so it crosses the field,
 * and lights that breathe. Geometry is written straight into arrays — a
 * garden is thousands of cubes, and cloning a BoxGeometry for each was most of
 * the scenery's build time.
 */

import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { CrystalRng } from './crystals';
import { FLORA_BY_ENVIRONMENT, FLORA_SPECIES, type FloraSpecies } from './flora-mix';

// The species list and `floraMix` live in a three-free module (the package
// entry validates params through guide.ts, and must not pull three.js onto
// the Apple TV's 2D path); re-exported here for the builders.
export { FLORA_BY_ENVIRONMENT, FLORA_SPECIES, parseFloraMix, type FloraSpecies } from './flora-mix';

export interface FloraAnchor { x: number; y: number; z: number; color: string }

export interface FloraOptions {
  density: number;
  cap: number;
  scale: number;
  /** True where something solid already stands (a home, a boulder). */
  blocked(x: number, z: number): boolean;
  /** Relative weights by species (`floraMix`); anything unnamed is left out. Empty = the default garden. */
  mix?: Partial<Record<FloraSpecies, number>>;
  /** The room (`environment`): with no `mix`, it chooses the garden — coral on a reef, kelp in the kelp forest. */
  environment?: string;
  /** A world palette (`floraPalette`): colours every colony is pulled toward. None = each species' own. */
  palette?: readonly string[];
  /** `garden` (default) grows round the crystals; `gallery` plants one of each species in its own plot, in rows (`floraLayout`). */
  layout?: 'garden' | 'gallery';
}

export interface FloraField {
  /** One merged geometry (or none): stems, leaves, tubes. */
  parts: BufferGeometry[];
  /** One merged geometry (or none): the lights — drawn as polished metal. */
  lamps: BufferGeometry[];
  plants: number;
  voxels: number;
  bySpecies: Record<FloraSpecies, number>;
  /** Where the lamps are — what sheds spores. `root` is the plant's foot. */
  lights: { x: number; y: number; z: number; root: number; phase: number; gust: number; color: string; flex: number }[];
  /** Every plant's crown, lit or not, and how freely its stiffest-to-limpest part sways: what the shoal keeps above (canopy.ts). */
  tips: { x: number; y: number; z: number; root: number; flex: number }[];
  /** Plants of a rare morph (nacreous, iridescent): about one colony in thirty. */
  rare: number;
  /** Colonies founded: each founder's siblings share its species and genes. */
  colonies: number;
}

/** Voxel-art face values: top brightest, the two side pairs apart, bottom dark. */
const FACES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 0, 1], [0, -1, 0, 0.42], [1, 0, 0, 0.8], [-1, 0, 0, 0.62], [0, 0, 1, 0.72], [0, 0, -1, 0.55],
];

/** Lights (spore emitters) one plant may have, however many lamps it grows. */
const LAMPS_PER_PLANT = 4;

/**
 * Which lamps a plant grew: its lamp cells `from`..`to` (centres in `cells`,
 * x y z) grouped into touching runs — closer than `touch` (squared) is the
 * same lamp. Answers each lamp's last cell, the last-drawn lamps first, at
 * most `cap`.
 */
export function lampHeads(cells: readonly number[], from: number, to: number, touch: number, cap: number): number[] {
  const n = to - from, up = Array.from({ length: n }, (_, i) => i);
  const top = (i: number): number => { while (up[i] !== i) i = up[i] = up[up[i]!]!; return i; };
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = (from + i) * 3, b = (from + j) * 3;
      if ((cells[a]! - cells[b]!) ** 2 + (cells[a + 1]! - cells[b + 1]!) ** 2 + (cells[a + 2]! - cells[b + 2]!) ** 2 < touch) up[top(j)] = top(i);
    }
  }
  const heads: number[] = [], seen = new Set<number>();
  for (let i = n - 1; i >= 0 && heads.length < cap; i -= 1) {
    const r = top(i);
    if (seen.has(r)) continue;
    seen.add(r);
    heads.push(from + i);
  }
  return heads;
}

class VoxelWriter {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly sway: number[] = [];
  readonly glow: number[] = [];
  /** Per vertex: how freely it sways (0 stone .. 1 a leaf .. 2+ a tentacle), and its sheen (0 matte .. 1 nacre). */
  readonly mat: number[] = [];
  readonly plant: number[] = [];
  count = 0;
  root = 0; phase = 0; gust = 0;
  flex = 1; sheen = 0;
  /** Per vertex (aPlant): the plant's centre, how it answers a fish passing
   *  (0 not at all, + folds toward its root and centre, - swells about
   *  \`bloatY\`), and that centre's height. */
  px = 0; pz = 0; react = 0; bloatY = 0;
  /** A rare morph: every colour drawn is washed toward mother-of-pearl this much, and gleams. */
  pearl = 0;
  /** The most flex drawn since it was last reset. */
  maxFlex = 0;
  /** The highest point drawn since `top` was last reset (a plant's crown). */
  top = 0;
  last: [number, number, number] = [0, 0, 0];
  /** Every cell drawn, centre by centre (x, y, z) — where a plant's lamps are. */
  readonly cells: number[] = [];
  /** Each cell's sway (root, phase, gust, flex), as its vertices have it: a spore leaves with the tip it came off. */
  readonly cellSway: number[] = [];

  cube(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, c: Color, lit: number, flat = false): void {
    for (let f = 0; f < 6; f += 1) this.face(f, cx, cy, cz, sx / 2, sy / 2, sz / 2, c, lit, flat);
    if (this.flex > this.maxFlex) this.maxFlex = this.flex;
    this.count += 1;
    this.last = [cx, cy, cz];
    this.cells.push(cx, cy, cz);
    this.cellSway.push(this.root, this.phase, this.gust, this.flex);
    if (cy + sy / 2 > this.top) this.top = cy + sy / 2;
  }

  /**
   * A solid on the voxel grid: every cell a cube of `size`, but only the faces
   * that touch open water — the inside of a brain coral or a barrel's wall is
   * never drawn. `cells` maps `i,j,k` (x, y, z steps from `origin`) to a colour.
   */
  solid(origin: readonly [number, number, number], size: number, cells: ReadonlyMap<string, Color>, lit: number, flat = false): void {
    const h = size / 2;
    for (const [key, c] of cells) {
      const [i, j, k] = key.split(',').map(Number) as [number, number, number];
      const cx = origin[0] + i * size, cy = origin[1] + j * size, cz = origin[2] + k * size;
      for (let f = 0; f < 6; f += 1) {
        const [nx, ny, nz] = FACES[f]!;
        if (!cells.has(`${i + nx},${j + ny},${k + nz}`)) this.face(f, cx, cy, cz, h, h, h, c, lit, flat);
      }
      this.count += 1;
      this.last = [cx, cy, cz];
      this.cells.push(cx, cy, cz);
      this.cellSway.push(this.root, this.phase, this.gust, this.flex);
      if (cy + h > this.top) this.top = cy + h;
    }
    if (cells.size && this.flex > this.maxFlex) this.maxFlex = this.flex;
  }

  private face(f: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, c: Color, lit: number, flat: boolean): void {
    const [nx, ny, nz, shade] = FACES[f]!;
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
      const pr = this.pearl;
      this.col.push((c.r + (0.93 - c.r) * pr) * k, (c.g + (0.9 - c.g) * pr) * k, (c.b + (1 - c.b) * pr) * k);
      this.sway.push(this.root, this.phase, this.gust);
      this.glow.push(lit);
      this.mat.push(this.flex, Math.max(this.sheen, pr > 0 ? 1 : 0));
      this.plant.push(this.px, this.pz, this.react, this.bloatY);
    }
  }

  /** Scale everything drawn since vertex \`from\` about (x, root, z): the
   *  small form of a dimorphic species, cut at a smaller voxel. */
  shrink(from: number, x: number, root: number, z: number, k: number, cellFrom = this.count): void {
    for (let v = from; v < this.pos.length / 3; v += 1) {
      this.pos[v * 3] = x + (this.pos[v * 3]! - x) * k;
      this.pos[v * 3 + 1] = root + (this.pos[v * 3 + 1]! - root) * k;
      this.pos[v * 3 + 2] = z + (this.pos[v * 3 + 2]! - z) * k;
      this.sway[v * 3] = root + (this.sway[v * 3]! - root) * k;
      this.plant[v * 4 + 3] = root + (this.plant[v * 4 + 3]! - root) * k;
    }
    this.top = root + (this.top - root) * k;
    for (let c = cellFrom * 3; c < this.cells.length; c += 3) {
      this.cells[c] = x + (this.cells[c]! - x) * k;
      this.cells[c + 1] = root + (this.cells[c + 1]! - root) * k;
      this.cells[c + 2] = z + (this.cells[c + 2]! - z) * k;
      this.cellSway[(c / 3) * 4] = root + (this.cellSway[(c / 3) * 4]! - root) * k;
    }
    this.last = [x + (this.last[0] - x) * k, root + (this.last[1] - root) * k, z + (this.last[2] - z) * k];
  }

  geometry(): BufferGeometry[] {
    if (!this.count) return [];
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aSway', new BufferAttribute(new Float32Array(this.sway), 3));
    g.setAttribute('aGlow', new BufferAttribute(new Float32Array(this.glow), 1));
    g.setAttribute('aMat', new BufferAttribute(new Float32Array(this.mat), 2));
    g.setAttribute('aPlant', new BufferAttribute(new Float32Array(this.plant), 4));
    return [g];
  }
}

/** One plant's plot: where it roots, what light it feeds on, and the pens it draws with. */
interface Plot {
  x: number; z: number; root: number;
  /** The voxel, and the world scale it was cut at. */
  V: number; s: number;
  rng: CrystalRng;
  /** The colony's genes: palette picks draw from this, so siblings share a colour while their shapes differ. */
  gene: CrystalRng;
  /** The nearest crystal's colour, and the stem colour grown from it. */
  light: Color; stem: Color;
  /** Unit vector toward the light, on the floor. */
  lx: number; lz: number;
  phase: number;
  body: VoxelWriter; lamp: VoxelWriter;
  /** The stem colour shaded for height `h` (0 root .. 1 tip), ramping toward its tip colour. */
  tone(h: number, k?: number): Color;
  /** Any colour ramped from base to tip over `h` — a whip deep at the foot and bright at the end — then scaled by `k`. */
  ramp(c: Color, h: number, k?: number): Color;
  /** A colour from the species' own list — pulled toward the world palette when the garden has one (`floraPalette`). */
  paint(list: readonly string[]): Color;
}

interface SpeciesDef {
  /** How far out it lives from its crystal (in units of scale). */
  near: number; far: number;
  /** Its share of a garden when nothing says otherwise. */
  share: number;
  /** The most one garden holds, for a specimen (a giant clam is an event, not a lawn). */
  max?: number;
  /** What its stem is grown from, mixed with its crystal's light. */
  leaf?: readonly string[];
  /** How freely it sways: 1 a leaf; stony corals barely move, a clam not at all. Default 1. */
  flex?: number;
  /** A colony: how many siblings can follow the founder, and how far apart they stand (in units of scale). */
  colony?: readonly [number, number];
  spread?: number;
  grow(p: Plot): void;
}

const pick = <T,>(rng: CrystalRng, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rng.next() * list.length))]!;
/** A small seeded generator for a colony's genes (the tank's rng is shared and moves on). */
function geneRng(seed: number): CrystalRng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (lo, hi) => lo + (hi - lo) * next(), fork: salt => geneRng(seed ^ Math.imul(salt, 0x9e3779b1)) };
}
/** A voxel-grid cell's key: `i,j,k` steps along x, y, z. */
const cellKey = (i: number, j: number, k: number): string => `${i},${j},${k}`;

const WHITE = new Color('#ffffff'), LEAF_GREEN = '#2f9d7c', BRASS = new Color('#c9a15a');

const SPECIES: Readonly<Record<FloraSpecies, SpeciesDef>> = {
  grass: {
    near: 9, far: 24, share: 0.19, colony: [2, 5], spread: 4,
    // Mostly green; now and then a tuft of red algae.
    leaf: [LEAF_GREEN, LEAF_GREEN, '#4fae4a', '#8fae3a', '#b0443c'],
    grow({ x, z, root, V, s, rng, body, tone }) {
      const blades = 4 + Math.floor(rng.next() * 5);
      for (let b = 0; b < blades; b += 1) {
        const bx = x + rng.range(-3.2, 3.2) * s, bz = z + rng.range(-3.2, 3.2) * s;
        const n = 2 + Math.floor(rng.next() * 4), lean = rng.range(-0.5, 0.5);
        for (let j = 0; j < n; j += 1) {
          const h = (j + 0.5) / n;
          body.cube(bx + Math.round(lean * j) * V * 0.5, root + (j + 0.5) * V * 0.8, bz, V * 0.55, V * 0.8, V * 0.55, tone(h, 1.05), 0);
        }
      }
    },
  },
  tube: {
    near: 13, far: 25, share: 0.07, flex: 0.45, colony: [1, 3], spread: 6,
    grow({ x, z, root, V, s, rng, light, body, lamp, ramp, paint }) {
      const tubes = 3 + Math.floor(rng.next() * 3);
      const hue = light.clone().lerp(paint(['#ff7aa8', '#ffb35c', '#9f7aff', '#5cd6ff']), 0.55);
      for (let t = 0; t < tubes; t += 1) {
        const a = (t / tubes) * Math.PI * 2 + rng.next(), r = (t === 0 ? 0 : rng.range(2.2, 4.2)) * s;
        const tx = x + Math.cos(a) * r, tz = z + Math.sin(a) * r;
        const n = 3 + Math.floor(rng.next() * (t === 0 ? 6 : 4)), w = V * (t === 0 ? 1.9 : 1.45);
        for (let j = 0; j < n; j += 1) {
          const h = (j + 0.5) / n;
          body.cube(tx, root + (j + 0.5) * V, tz, w, V, w, ramp(hue, h, 0.3 + 0.55 * h), 0);
        }
        // The lit mouth: a lip, and light down inside it.
        body.cube(tx, root + (n + 0.25) * V, tz, w * 1.25, V * 0.5, w * 1.25, ramp(hue, 1, 0.95), 0);
        // The worm inside ducks when a fish comes close: its light sinks into the tube.
        lamp.root = root + (n - 0.5) * V; lamp.px = tx; lamp.pz = tz; lamp.react = 1;
        lamp.cube(tx, root + (n + 0.3) * V, tz, w * 0.7, V * 0.45, w * 0.7, light.clone().lerp(WHITE, 0.35), 1, true);
      }
    },
  },
  bulb: {
    near: 14, far: 30, share: 0.07, colony: [1, 3], spread: 5,
    leaf: [LEAF_GREEN, '#4fae4a', '#6a8f3a'],
    grow({ x, z, root, V, rng, light, lx, lz, body, lamp, tone }) {
      const n = 3 + Math.floor(rng.next() * 3);
      let tx = x, tz = z;
      for (let j = 0; j < n; j += 1) {
        const h = (j + 0.5) / n;
        tx = x + Math.round(lx * h * 1.2) * V * 0.5; tz = z + Math.round(lz * h * 1.2) * V * 0.5;
        body.cube(tx, root + (j + 0.5) * V, tz, V * 0.8, V, V * 0.8, tone(h), 0);
      }
      const top = root + n * V, head = V * 2;
      const brass = light.clone().lerp(BRASS, 0.6).multiplyScalar(0.6);
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        body.cube(tx + ax * head * 0.62, top + head * 0.35, tz + az * head * 0.62, V * 0.7, head * 0.7, V * 0.7, tone(0.9, 0.85), 0);
      }
      lamp.cube(tx, top + head * 0.18, tz, head * 1.05, head * 0.16, head * 1.05, brass, 1, true);
      lamp.cube(tx, top + head * 0.75, tz, head * 0.9, head * 0.9, head * 0.9, light.clone().lerp(WHITE, 0.35), 1, true);
      lamp.cube(tx, top + head * 1.3, tz, head * 1.15, head * 0.18, head * 1.15, brass, 1, true);
      lamp.cube(tx, top + head * 1.5, tz, head * 0.4, head * 0.24, head * 0.4, brass, 1, true);
    },
  },
  fan: {
    // Gorgonians bend in a current, but from a stiff horny skeleton.
    near: 19, far: 36, share: 0.08, flex: 0.55, colony: [0, 2], spread: 8,
    grow({ x, z, root, V, rng, light, lx, lz, body, lamp, ramp, paint }) {
      // A sea fan: a flat tree in the plane that faces its crystal, grown on
      // the voxel grid so every limb is a run of cubes.
      const px = -lz, pz = lx; // the fan's plane runs across the light
      const coral = light.clone().lerp(paint(['#ff6f91', '#ff9f45', '#c86bff', '#ffd166', '#ff4f4f']), 0.6);
      const seen = new Set<string>();
      const grow = (gu: number, gv: number, du: number, len: number, depth: number): void => {
        for (let k = 0; k < len; k += 1) {
          gv += 1;
          if (k % 2 === 1) gu += du;
          const key = `${gu},${gv}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const h = Math.min(1, gv / 16);
          body.cube(x + px * gu * V, root + (gv - 0.5) * V, z + pz * gu * V, V, V, V * 0.8, ramp(coral, h, 0.32 + 0.62 * h), 0);
          if (depth > 0 && k > 1 && rng.next() < 0.42) grow(gu, gv, du === 0 ? (rng.next() < 0.5 ? -1 : 1) : -du, Math.max(3, len - k - 1), depth - 1);
        }
        if (depth <= 1) lamp.cube(x + px * gu * V, root + (gv + 0.4) * V, z + pz * gu * V, V * 0.85, V * 0.85, V * 0.85, light.clone().lerp(WHITE, 0.3), 1, true);
      };
      // One fan in eight is an old one, half as tall again.
      const tall = 7 + Math.floor(rng.next() * 6) + (rng.next() < 0.125 ? 5 : 0);
      grow(0, 0, 0, 3, 0);
      grow(0, 3, -1, tall, 2);
      grow(0, 3, 1, tall - 1, 2);
      grow(0, 3, 0, tall + 1, 1);
    },
  },
  kelp: {
    near: 24, far: 46, share: 0.14, colony: [2, 5], spread: 6,
    // Green, and the golds and olives of real kelp.
    leaf: [LEAF_GREEN, '#8a6a2a', '#5f7d2e', '#3a8f6a'],
    grow({ x, z, root, V, rng, light, lx, lz, phase, body, lamp, tone }) {
      // Kelp: a stalk that meanders on the grid and leans to the light, with
      // blades that CLIMB away from it in two-cube stair-steps.
      // One in ten is a giant, reaching for the surface.
      const n = 12 + Math.floor(rng.next() * 14) + (rng.next() < 0.1 ? 12 : 0);
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
      lamp.cube(tx, root + (n + 0.45) * V, tz, V * 1.15, V * 1.15, V * 1.15, light.clone().lerp(WHITE, 0.3), 1, true);
    },
  },
  anemone: {
    near: 10, far: 26, share: 0.08, flex: 0.2, colony: [1, 4], spread: 5,
    grow({ x, z, root, V, rng, gene, light, body, lamp, ramp, paint }) {
      // A squat column, an oral disc, and a crown of tentacles that climb
      // outward in stair-steps, each tipped with a bead of light. The column
      // is muscle and barely moves; the tentacles are rooted at the crown and
      // writhe from there, with a wet gleam.
      const hue = light.clone().lerp(paint(['#ff5fa2', '#ff9a3c', '#b884ff', '#5fe0ff', '#ff6a5c']), 0.78);
      const column = hue.clone().offsetHSL(gene.range(-0.12, 0.12), -0.1, -0.08);
      const base = 2 + Math.floor(rng.next() * 3);
      for (let j = 0; j < base; j += 1) body.cube(x, root + (j + 0.5) * V, z, V * 2.2, V, V * 2.2, column.clone().multiplyScalar(0.34 + 0.2 * (j / base)), 0);
      const top = root + base * V;
      body.cube(x, top + V * 0.25, z, V * 3.2, V * 0.5, V * 3.2, hue.clone().multiplyScalar(0.62), 0);
      const arms = 7 + Math.floor(rng.next() * 4), tip = hue.clone().lerp(WHITE, 0.45);
      // A fish too close and the crown folds shut, tentacles drawn into the mouth.
      for (const w of [body, lamp]) { w.root = top; w.flex = 2.4; w.sheen = Math.max(w.sheen, 0.35); w.react = 1; }
      for (let a = 0; a < arms; a += 1) {
        const ang = (a / arms) * Math.PI * 2 + rng.range(-0.15, 0.15);
        const ca = Math.cos(ang), sa = Math.sin(ang), len = 3 + Math.floor(rng.next() * 3);
        let out = V * 1.3, up = top + V * 0.5;
        for (let k = 0; k < len; k += 1) {
          out += k < 2 ? V * 0.6 : V * 0.3;
          up += V * 0.75;
          body.cube(x + ca * out, up, z + sa * out, V * 0.55, V * 0.75, V * 0.55, ramp(hue, (k + 1) / len, 0.72 + 0.28 * (k / len)), 0);
        }
        lamp.cube(x + ca * (out + V * 0.2), up + V * 0.55, z + sa * (out + V * 0.2), V * 0.6, V * 0.6, V * 0.6, tip, 1, true);
      }
      // The mouth glows last, and still: it is what sheds the spores.
      lamp.root = root; lamp.flex = 0.2; lamp.react = 0;
      lamp.cube(x, top + V * 0.6, z, V * 1.1, V * 0.35, V * 1.1, light.clone().lerp(WHITE, 0.4), 1, true);
    },
  },
  staghorn: {
    // Stony coral: it grows, and barely sways.
    near: 16, far: 34, share: 0.07, flex: 0.12, colony: [1, 3], spread: 7,
    grow({ x, z, root, V, rng, light, body, lamp, ramp, paint }) {
      // Antler coral: branches fork in every direction (a fan forks in one
      // plane), pale at the growing tips, some tips lit.
      const hue = light.clone().lerp(paint(['#e8b27a', '#c98bdc', '#8fd6c8', '#f2a0a0', '#d8e07a']), 0.75);
      const seen = new Set<string>();
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const;
      const branch = (gi: number, gj: number, gk: number, di: number, dk: number, len: number, depth: number): void => {
        for (let k = 0; k < len; k += 1) {
          gj += 1;
          const h = Math.min(1, gj / 12), c = ramp(hue, h, 0.36 + 0.5 * h);
          if (k % 2 === 1) {
            // A sideways step keeps an elbow, so the limb is one run of cubes, not a dotted line.
            if (!seen.has(cellKey(gi, gj, gk))) { seen.add(cellKey(gi, gj, gk)); body.cube(x + gi * V, root + (gj - 0.5) * V, z + gk * V, V * 0.8, V, V * 0.8, c, 0); }
            gi += di; gk += dk;
          }
          const key = cellKey(gi, gj, gk);
          if (seen.has(key)) continue;
          seen.add(key);
          body.cube(x + gi * V, root + (gj - 0.5) * V, z + gk * V, V * 0.8, V, V * 0.8, c, 0);
          if (depth > 0 && k >= 2 && rng.next() < 0.26) {
            const [ni, nk] = pick(rng, DIRS);
            branch(gi, gj, gk, ni, nk, Math.max(2, len - k - 1), depth - 1);
          }
        }
        // The growing tip is pale, and one in three is lit.
        if (rng.next() < 0.34) lamp.cube(x + gi * V, root + (gj + 0.35) * V, z + gk * V, V * 0.7, V * 0.7, V * 0.7, light.clone().lerp(WHITE, 0.5), 1, true);
        else body.cube(x + gi * V, root + (gj + 0.3) * V, z + gk * V, V * 0.75, V * 0.6, V * 0.75, hue.clone().lerp(WHITE, 0.55), 0);
      };
      const arms = 3 + Math.floor(rng.next() * 2), trunk = 1 + Math.floor(rng.next() * 2);
      for (let j = 0; j < trunk; j += 1) body.cube(x, root + (j + 0.5) * V, z, V * 1.1, V, V * 1.1, hue.clone().multiplyScalar(0.34), 0);
      const first = Math.floor(rng.next() * DIRS.length);
      for (let a = 0; a < arms; a += 1) {
        const [di, dk] = DIRS[(first + a * 3) % DIRS.length]!;
        branch(0, trunk, 0, di, dk, 6 + Math.floor(rng.next() * 5), 2);
      }
    },
  },
  brain: {
    near: 11, far: 28, share: 0.06, flex: 0, colony: [1, 3], spread: 7,
    grow({ x, z, root, V, rng, gene, light, body, paint }) {
      // A brain coral: a low dome, its surface a maze of ridges and grooves.
      // Solid, so only its skin is drawn.
      const base = light.clone().lerp(paint(['#d9c27a', '#9fcf7a', '#e59a7a', '#a7b7e8', '#e0a8c8']), 0.8);
      const R = 2.4 + rng.next() * 1.8, squash = 0.62, seed = rng.range(0, 9);
      const ridge = base.clone().lerp(WHITE, 0.18), groove = base.clone().offsetHSL(gene.range(-0.1, 0.1), 0.1, -0.12).multiplyScalar(0.55);
      const cells = new Map<string, Color>();
      const n = Math.ceil(R);
      for (let i = -n; i <= n; i += 1) for (let k = -n; k <= n; k += 1) for (let j = 0; j <= n; j += 1) {
        if ((i * i + k * k) / (R * R) + (j * j) / (R * R * squash * squash) > 1) continue;
        const maze = Math.sin(i * 1.9 + Math.sin(k * 1.3 + seed) * 1.6) * Math.cos(k * 1.7 + Math.sin(i * 1.1 + seed) * 1.4);
        cells.set(cellKey(i, j, k), (maze > 0 ? ridge : groove).clone().multiplyScalar(0.55 + 0.45 * (j / n)));
      }
      // Sunk a little into the floor, as if it grew there.
      body.solid([x, root + V * 0.2, z], V, cells, 0);
    },
  },
  whip: {
    near: 18, far: 40, share: 0.08, colony: [1, 3], spread: 5,
    grow({ x, z, root, V, s, rng, light, lx, lz, body, lamp, ramp, paint }) {
      // Sea whips: a stand of thin, bright rods. They are all height, so the
      // sway (which grows with height²) makes them the liveliest thing here.
      const hue = light.clone().lerp(paint(['#ff4a3d', '#ff9f1c', '#ffd23f', '#c77dff', '#ff5c8a']), 0.82);
      const whips = 3 + Math.floor(rng.next() * 3);
      let tallest = -1, tip: [number, number, number] = [x, root, z];
      for (let w = 0; w < whips; w += 1) {
        const bx = x + (w === 0 ? 0 : rng.range(-2.6, 2.6)) * s, bz = z + (w === 0 ? 0 : rng.range(-2.6, 2.6)) * s;
        const n = 8 + Math.floor(rng.next() * 11), la = rng.range(0, Math.PI * 2), lean = rng.range(0.15, 0.4);
        const ex = Math.cos(la) * 0.6 + lx * 0.4, ez = Math.sin(la) * 0.6 + lz * 0.4;
        let tx = bx, tz = bz;
        for (let j = 0; j < n; j += 1) {
          const h = (j + 0.5) / n, off = Math.round(h * h * lean * n);
          tx = bx + ex * off * V * 0.5; tz = bz + ez * off * V * 0.5;
          body.cube(tx, root + (j + 0.5) * V, tz, V * 0.5, V, V * 0.5, ramp(hue, h, 0.4 + 0.6 * h), 0);
        }
        if (n > tallest) { tallest = n; tip = [tx, root + (n + 0.35) * V, tz]; }
      }
      lamp.cube(tip[0], tip[1], tip[2], V * 0.7, V * 0.7, V * 0.7, light.clone().lerp(WHITE, 0.4), 1, true);
    },
  },
  barrel: {
    near: 16, far: 32, share: 0.04, flex: 0.1, colony: [0, 2], spread: 8,
    grow({ x, z, root, V, rng, gene, light, body, lamp, paint }) {
      // A barrel sponge: a hollow, flaring vase banded in rings, with light
      // pooled in the bottom of it.
      const base = light.clone().lerp(paint(['#b5653a', '#8f5a9e', '#c28a4a', '#7a8f5a', '#a8484a']), 0.8);
      const lip = base.clone().offsetHSL(gene.range(-0.06, 0.06), 0.05, 0.14);
      const H = 5 + Math.floor(rng.next() * 4), r0 = 1.4 + rng.next() * 0.4, r1 = r0 + 1.2 + rng.next() * 0.8;
      const cells = new Map<string, Color>();
      const n = Math.ceil(r1) + 1;
      for (let j = 0; j < H; j += 1) {
        const r = r0 + (r1 - r0) * (j / (H - 1));
        const band = (j % 2 ? 0.8 : 1) * (0.45 + 0.55 * (j / H));
        const c = (j === H - 1 ? lip : base).clone().multiplyScalar(band);
        for (let i = -n; i <= n; i += 1) for (let k = -n; k <= n; k += 1) {
          const d = Math.hypot(i, k);
          if (j === 0 ? d <= r + 0.5 : Math.abs(d - r) < 0.62) cells.set(cellKey(i, j, k), c);
        }
      }
      body.solid([x, root + V * 0.5, z], V, cells, 0);
      lamp.cube(x, root + V * 1.1, z, V * r0 * 1.4, V * 0.25, V * r0 * 1.4, light.clone().lerp(WHITE, 0.3), 1, true);
    },
  },
  shelf: {
    near: 12, far: 30, share: 0.05, flex: 0.4, colony: [1, 3], spread: 6,
    grow({ x, z, root, V, s, rng, gene, light, body, lamp, paint }) {
      // Glow caps: mushroom-like, with a wide flat cap whose gills shine down
      // onto the stalk. A clump of one to three, the tallest in the middle.
      const cap = light.clone().lerp(paint(['#e0d6ff', '#ffd6a8', '#b8f0ff', '#ffb3d9', '#d6ffb8']), 0.72);
      const spots = cap.clone().offsetHSL(gene.range(-0.2, 0.2), 0.2, -0.18);
      const stalkC = cap.clone().lerp(WHITE, 0.3).multiplyScalar(0.55), gill = light.clone().lerp(cap, 0.5).multiplyScalar(0.85);
      const count = 1 + Math.floor(rng.next() * 3);
      const order = Array.from({ length: count }, (_, m) => m).reverse(); // the tallest (m = 0) last: its gills shed the spores
      for (const m of order) {
        const a = rng.range(0, Math.PI * 2), d = m === 0 ? 0 : rng.range(2.5, 4) * s;
        const mx = x + Math.cos(a) * d, mz = z + Math.sin(a) * d;
        const tall = (m === 0 ? 5 : 2) + Math.floor(rng.next() * (m === 0 ? 5 : 3)), R = m === 0 ? 2.2 + rng.next() : 1.3 + rng.next() * 0.8;
        for (let j = 0; j < tall; j += 1) body.cube(mx, root + (j + 0.5) * V, mz, V * 0.8, V, V * 0.8, stalkC.clone().multiplyScalar(0.6 + 0.4 * (j / tall)), 0);
        const cells = new Map<string, Color>(), n = Math.ceil(R);
        for (let i = -n; i <= n; i += 1) for (let k = -n; k <= n; k += 1) {
          const d2 = Math.hypot(i, k);
          // A speckled cap: every few cells a darker spot, the way a toadstool is.
          const speck = (i * 7 + k * 13 + m * 5) % 5 === 0;
          if (d2 <= R) cells.set(cellKey(i, 0, k), (speck ? spots : cap).clone().multiplyScalar(0.7 + 0.3 * (1 - d2 / (R + 1))));
          if (d2 <= R * 0.55) cells.set(cellKey(i, 1, k), (speck ? spots : cap).clone().lerp(WHITE, 0.12));
        }
        const capY = root + (tall + 0.5) * V;
        body.solid([mx, capY, mz], V, cells, 0);
        // The gills: a glowing ring tucked under the cap, not a panel the width
        // of it (seen from below, a full-width slab read as a floating disc).
        lamp.cube(mx, capY - V * 0.58, mz, V * R * 1.2, V * 0.2, V * R * 1.2, gill, 1, true);
      }
    },
  },
  seapen: {
    near: 20, far: 40, share: 0.04, colony: [1, 4], spread: 5,
    grow({ x, z, root, V, rng, light, lx, lz, body, lamp, ramp, paint }) {
      // A sea pen: a quill standing on the floor, its feather a ladder of
      // paired leaves that sweep upward, widest in the middle, the edge of
      // every other leaf lit.
      const hue = light.clone().lerp(paint(['#ffb46b', '#ff7b7b', '#f0e6c8', '#d7a8ff']), 0.75);
      const px = -lz, pz = lx; // the feather faces the light
      const n = 9 + Math.floor(rng.next() * 6), from = Math.floor(n * 0.3);
      const bead = light.clone().lerp(WHITE, 0.45);
      body.sheen = 0.25;
      // A real sea pen pulls down into the sand when disturbed.
      body.react = 0.8; lamp.react = 0.8;
      for (let j = 0; j < n; j += 1) {
        const h = (j + 0.5) / n, y = root + (j + 0.5) * V;
        body.cube(x, y, z, V * 0.6, V, V * 0.6, ramp(hue, h, 0.35 + 0.5 * h), 0);
        if (j < from) continue;
        const reach = 1 + Math.round(Math.sin(Math.PI * (j - from + 0.5) / (n - from)) * 2.4);
        for (const side of [-1, 1]) {
          for (let k = 1; k <= reach; k += 1) {
            body.cube(x + px * side * k * V * 0.8, y + k * V * 0.3, z + pz * side * k * V * 0.8, V * 0.8, V * 0.35, V * 0.8, ramp(hue, h, 0.55 + 0.45 * h).lerp(WHITE, 0.12), 0);
          }
          if ((j - from) % 2 === 0) lamp.cube(x + px * side * (reach + 0.7) * V * 0.8, y + (reach + 0.5) * V * 0.3, z + pz * side * (reach + 0.7) * V * 0.8, V * 0.45, V * 0.45, V * 0.45, bead, 1, true);
        }
      }
      lamp.cube(x, root + (n + 0.3) * V, z, V * 0.7, V * 0.7, V * 0.7, bead, 1, true);
    },
  },
  clam: {
    // A giant clam: a specimen, not a lawn — at most two to a garden, and it
    // does not sway.
    near: 12, far: 22, share: 0.02, max: 2, flex: 0, colony: [0, 1], spread: 9,
    grow({ x, z, root, V, rng, light, lx, lz, body, lamp, paint }) {
      // Tridacna sits hinge-down in the floor with its two fluted valves
      // rising either side, and gapes UPWARD: from above (where the camera
      // usually is) it is a long zigzag slit, and the mantle — a thick band of
      // vivid, spotted colour — wells up out of it and over the wavy lips.
      // On the grid u runs along the slit (across the light), w across it, j up.
      const alongX = Math.abs(lz) > Math.abs(lx); // the slit lies across the line to the crystal
      const at = (u: number, w: number): [number, number] => alongX ? [u, w] : [w, u];
      const shell = paint(['#d8d2c0', '#c8d8d0', '#e0cdb8', '#d9c4d8']).lerp(light, 0.1);
      const mantleA = paint(['#2fb8ff', '#7a5cff', '#20e0a0', '#ff4fc8', '#2f6bff']).lerp(light, 0.15);
      const mantleB = mantleA.clone().offsetHSL(0.07, 0, -0.1), eye = mantleA.clone().lerp(WHITE, 0.75);
      const L = 5 + Math.floor(rng.next() * 3);
      const valves = new Map<string, Color>(), mantle = new Map<string, Color>();
      const put = (m: Map<string, Color>, u: number, j: number, w: number, c: Color): void => {
        const [i, k] = at(u, w);
        m.set(cellKey(i, j, k), c);
      };
      for (let u = -L; u <= L; u += 1) {
        const e = Math.sqrt(Math.max(0, 1 - (u / (L + 0.6)) ** 2));
        const H = Math.max(1, Math.round(1 + 3 * e)), half = Math.max(1, Math.round(1 + 2 * e));
        // Flutes: a pale ridge, then a dark trough, all along the valve.
        const rib = (u + 100) % 2 === 0 ? shell.clone().lerp(WHITE, 0.3) : shell.clone().multiplyScalar(0.62);
        for (let w = -half; w <= half; w += 1) for (let j = 0; j < H; j += 1) {
          put(valves, u, j, w, rib.clone().multiplyScalar(0.55 + 0.45 * (j / H)));
        }
        // The lips interlock in a zigzag: one valve high where the other is low.
        put(valves, u, H, (u + 100) % 2 === 0 ? -half : half, rib.clone().lerp(WHITE, 0.2));
        // The mantle wells up between them and spills over the lips.
        for (let w = -half + 1; w <= half - 1; w += 1) {
          const c = (u * 5 + w * 3 + 50) % 7 === 0 ? eye : (Math.abs(w) === half - 1 && half > 1) ? mantleB : mantleA;
          put(mantle, u, H, w, c);
          if (Math.abs(w) <= half - 2 || half === 1) put(mantle, u, H + 1, w, (u + w + 50) % 4 === 0 ? eye : mantleA);
        }
      }
      for (const key of mantle.keys()) valves.delete(key);
      // Startled, the mantle draws down behind the lips.
      lamp.root = root + V * 1.2; lamp.react = 1;
      body.solid([x, root - V * 0.3, z], V, valves, 0);
      lamp.solid([x, root - V * 0.3, z], V, mantle, 1, true);
    },
  },
  bubble: {
    // Bubble algae (Valonia): a scatter of glossy green orbs on the floor, one
    // of the few round things in the world, and the shiniest.
    near: 8, far: 26, share: 0.05, flex: 0.2, colony: [2, 4], spread: 4,
    grow({ x, z, root, V, s, rng, light, body, paint }) {
      const hue = light.clone().lerp(paint(['#3fbf6f', '#2f9f9f', '#6fbf3f', '#7a5fbf', '#2f8f5f']), 0.8);
      body.sheen = 0.85;
      const orbs = 2 + Math.floor(rng.next() * 4);
      for (let o = 0; o < orbs; o += 1) {
        const R = o === 0 ? rng.range(1.4, 2.1) : rng.range(0.8, 1.6);
        const ox = x + (o === 0 ? 0 : rng.range(-3.5, 3.5)) * s, oz = z + (o === 0 ? 0 : rng.range(-3.5, 3.5)) * s;
        const cells = new Map<string, Color>(), n = Math.ceil(R);
        let low = 0;
        for (let i = -n; i <= n; i += 1) for (let j = -n; j <= n; j += 1) for (let k = -n; k <= n; k += 1) {
          if (i * i + j * j + k * k > R * R + 0.3) continue;
          // Lit from above: a highlight cell at the crown, darker below.
          const c = j === n && i === 0 && k === 0 ? hue.clone().lerp(WHITE, 0.55) : hue.clone().multiplyScalar(0.55 + 0.45 * ((j + n) / (2 * n)));
          cells.set(cellKey(i, j, k), c);
          if (j < low) low = j;
        }
        const size = V * 0.7;
        // The lowest occupied cell sits on the floor, however the radius rounds.
        body.solid([ox, root + (0.5 - low) * size - size * 0.15, oz], size, cells, 0);
      }
    },
  },
  curl: {
    // After No Man's Sky's spiral growth forms: a fiddlehead, the young frond
    // of a fern still wound in its crozier. A stalk climbs, and at the top
    // coils forward and in on itself, a bead of light at the heart of the coil.
    near: 12, far: 34, share: 0.05, colony: [1, 4], spread: 5,
    grow({ x, z, root, V, rng, light, lx, lz, body, lamp, ramp, paint }) {
      const c = light.clone().lerp(paint(['#6fcf3f', '#3fbf8f', '#cf6fdf', '#ff8f3f', '#3f9fff', '#dfcf3f']), 0.8);
      const fronds = 1 + Math.floor(rng.next() * 3);
      for (let f = 0; f < fronds; f += 1) {
        // Each frond coils in its own vertical plane; the first faces the light.
        const a = f === 0 ? Math.atan2(lz, lx) : rng.range(0, Math.PI * 2);
        const du = Math.cos(a), dv = Math.sin(a), wu = -dv, wv = du;
        const bx = x + (f === 0 ? 0 : rng.range(-2.5, 2.5)) * V * 0.6, bz = z + (f === 0 ? 0 : rng.range(-2.5, 2.5)) * V * 0.6;
        const n = 6 + Math.floor(rng.next() * 8), R = 2.2 + rng.next() * 2;
        const cells: Array<[number, number]> = [];
        for (let j = 0; j < n; j += 1) cells.push([0, j]);
        // The crozier: a spiral whose radius winds down to nothing.
        const seen = new Set<string>();
        for (let th = 0; th <= Math.PI * 2.1; th += 0.12) {
          const r = R * (1 - th / (Math.PI * 2.5));
          const u = Math.round(R - r * Math.cos(th)), v = Math.round(n - 1 + r * Math.sin(th));
          const key = `${u},${v}`;
          if (seen.has(key) || (u === 0 && v < n)) continue;
          seen.add(key);
          cells.push([u, v]);
        }
        const all = cells.length;
        cells.forEach(([u, v], i) => {
          const h = i / all;
          body.cube(bx + du * u * V * 0.8, root + (v + 0.5) * V * 0.8, bz + dv * u * V * 0.8, V * 0.7, V * 0.8, V * 0.7, ramp(c, h, 0.4 + 0.6 * h), 0);
          // Pinnae: small paired leaflets up the stalk, across the frond's plane.
          if (u === 0 && v > 2 && v % 2 === 0) {
            for (const side of [-1, 1]) body.cube(bx + wu * side * V * 0.75, root + (v + 0.7) * V * 0.8, bz + wv * side * V * 0.75, V * 0.7, V * 0.35, V * 0.7, ramp(c, h, 0.7), 0);
          }
        });
        const [cu, cv] = cells[cells.length - 1]!;
        lamp.cube(bx + du * cu * V * 0.8, root + (cv + 0.5) * V * 0.8, bz + dv * cu * V * 0.8, V * 0.6, V * 0.6, V * 0.6, light.clone().lerp(WHITE, 0.45), 1, true);
      }
    },
  },
  pod: {
    // After No Man's Sky's bloated gas flora and orb plants: a stout stalk
    // carrying one great round pod, its skin set with glowing sacs — or (the
    // whirl form) three stems curving out, strung with glowing beads. A pod
    // swells when a fish comes close.
    near: 14, far: 36, share: 0.04, flex: 0.35, colony: [0, 2], spread: 7,
    grow({ x, z, root, V, s, rng, gene, light, body, lamp, paint }) {
      const skin = light.clone().lerp(paint(['#ff8f2f', '#ff4f6f', '#bf5fff', '#3fdfff', '#dfff4f', '#ff6fcf']), 0.82);
      const sac = skin.clone().offsetHSL(0.5, 0.1, 0.1).lerp(WHITE, 0.2);
      const stalkC = skin.clone().offsetHSL(gene.range(-0.1, 0.1), -0.2, -0.2);
      if (gene.next() < 0.6) {
        const stalk = 2 + Math.floor(rng.next() * 4), R = 2 + rng.next() * 1.5, size = V * 0.85;
        for (let j = 0; j < stalk; j += 1) body.cube(x, root + (j + 0.5) * V, z, V * 1.2, V, V * 1.2, stalkC.clone().multiplyScalar(0.5 + 0.3 * (j / stalk)), 0);
        const cy = root + stalk * V + R * size;
        const n = Math.ceil(R), cells = new Map<string, Color>(), sacs = new Map<string, Color>();
        const seed = rng.range(0, 6);
        for (let i = -n; i <= n; i += 1) for (let j = -n; j <= n; j += 1) for (let k = -n; k <= n; k += 1) {
          const d = Math.hypot(i, j, k);
          if (d > R + 0.3) continue;
          // Veins of the skin run pole to pole; a few surface cells are the glowing sacs.
          const vein = Math.sin(Math.atan2(k, i) * 5 + seed) > 0.7;
          const surface = d > R - 0.8;
          if (surface && Math.sin(i * 2.3 + j * 1.7 + k * 3.1 + seed) > 0.93) sacs.set(cellKey(i, j, k), sac);
          else cells.set(cellKey(i, j, k), (vein ? skin.clone().multiplyScalar(0.7) : skin.clone().lerp(WHITE, 0.1 * (j + n) / (2 * n))).clone());
        }
        // The pod swells about its own centre when startled.
        for (const w of [body, lamp]) { w.react = -1; w.bloatY = cy; }
        body.sheen = 0.3;
        body.solid([x, cy, z], size, cells, 0);
        if (sacs.size) lamp.solid([x, cy, z], size, sacs, 1, true);
        else lamp.cube(x, cy + R * size, z, V * 0.8, V * 0.8, V * 0.8, sac, 1, true);
      } else {
        // The whirl: three stems arching out, each strung with beads of light.
        const arms = 3, tall = 7 + Math.floor(rng.next() * 6), first = rng.range(0, Math.PI * 2);
        for (let a = 0; a < arms; a += 1) {
          const ang = first + (a / arms) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
          for (let j = 0; j < tall; j += 1) {
            const h = j / tall, out = Math.round(h * h * 4);
            const px = x + ca * out * V * 0.8 * s / s, pz = z + sa * out * V * 0.8;
            body.cube(px, root + (j + 0.5) * V, pz, V * 0.6, V, V * 0.6, stalkC.clone().lerp(skin, h).multiplyScalar(0.5 + 0.4 * h), 0);
            if (j > 1 && j % 2 === 0) lamp.cube(px + ca * V * 0.55, root + (j + 0.5) * V, pz + sa * V * 0.55, V * 0.55, V * 0.55, V * 0.55, sac, 1, true);
          }
        }
      }
    },
  },
  elder: {
    // The elder: a garden's one great blossom tree, standing out past the
    // plants with lanterns at the end of every limb. A landmark, not a crop.
    near: 30, far: 44, share: 0.015, max: 1, flex: 0.15, colony: [0, 0], spread: 10,
    grow({ x, z, root, V, rng, gene, light, lx, lz, body, lamp, ramp, paint }) {
      const bark = paint(['#6b4f3a', '#4f5a6b', '#5a3f5f', '#3f5a4a']).lerp(light, 0.15);
      const bloom = light.clone().lerp(paint(['#ffb7d5', '#ffd27a', '#7fffd4', '#c9a7ff', '#ff8f6b']), 0.8);
      const glow = bloom.clone().lerp(WHITE, 0.5), petal = bloom.clone().offsetHSL(gene.range(-0.12, 0.12), 0.1, -0.15);
      const trunk = 16 + Math.floor(rng.next() * 7);
      let tx = 0, tz = 0;
      // A thick trunk (2 × 2), leaning a little toward its crystal.
      for (let j = 0; j < trunk; j += 1) {
        if (j > 2 && j % 3 === 0) { tx += Math.round(lx); tz += Math.round(lz); }
        const c = bark.clone().multiplyScalar(0.45 + 0.35 * (j / trunk));
        for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) body.cube(x + (tx + a - 0.5) * V, root + (j + 0.5) * V, z + (tz + b - 0.5) * V, V, V, V, c, 0);
      }
      // Roots flaring out at the foot.
      for (const [a, b] of [[-1, 0], [2, 0], [0, -1], [1, 2], [-1, 1], [2, 1]] as const) body.cube(x + (a - 0.5) * V, root + V * 0.4, z + (b - 0.5) * V, V, V * 0.8, V, bark.clone().multiplyScalar(0.4), 0);
      const seen = new Set<string>();
      const limb = (gi: number, gj: number, gk: number, di: number, dk: number, len: number, depth: number): void => {
        for (let k = 0; k < len; k += 1) {
          if (k % 3 !== 2) { gi += di; gk += dk; } // limbs reach out more than up
          gj += 1;
          const key = cellKey(gi, gj, gk);
          if (seen.has(key)) continue;
          seen.add(key);
          body.cube(x + gi * V, root + (gj - 0.5) * V, z + gk * V, V * 0.85, V * 0.85, V * 0.85, ramp(bark, 0.5 + 0.5 * (k / len), 0.7), 0);
          if (depth > 0 && k >= 1 && rng.next() < 0.3) limb(gi, gj, gk, rng.next() < 0.5 ? dk : -dk, rng.next() < 0.5 ? di : -di, Math.max(2, len - k), depth - 1);
        }
        // A blossom: a round clump of petals with a lantern at its heart.
        const cells = new Map<string, Color>();
        for (let i = -2; i <= 2; i += 1) for (let j = 0; j <= 3; j += 1) for (let k = -2; k <= 2; k += 1) {
          if (i * i + k * k + (j - 1.5) ** 2 > 5.2) continue;
          cells.set(cellKey(i, j, k), ((i * 3 + k * 5 + j * 7 + 50) % 4 === 0 ? petal : bloom).clone().multiplyScalar(0.62 + 0.12 * j));
        }
        body.solid([x + gi * V, root + (gj + 0.2) * V, z + gk * V], V * 0.8, cells, 0);
        // The lantern hangs out of the blossom's crown.
        lamp.cube(x + gi * V, root + (gj + 3.6) * V * 0.8 + V * 0.2, z + gk * V, V * 1.1, V * 1.1, V * 1.1, glow, 1, true);
      };
      const arms = 4 + Math.floor(rng.next() * 3), first = rng.next() * Math.PI * 2;
      for (let a = 0; a < arms; a += 1) {
        const ang = first + (a / arms) * Math.PI * 2;
        limb(tx, trunk - 3 - (a % 3) * 2, tz, Math.round(Math.cos(ang)), Math.round(Math.sin(ang)), 7 + Math.floor(rng.next() * 5), 2);
      }
    },
  },
};

/** Weights for a garden: `mix` if it names anything, else the room's garden, else every species at its own share. */
function weightsOf(mix: FloraOptions['mix'], environment?: string): Array<[FloraSpecies, number]> {
  const named = (m: FloraOptions['mix']): Array<[FloraSpecies, number]> =>
    FLORA_SPECIES.map((sp): [FloraSpecies, number] => [sp, Math.max(0, m?.[sp] ?? 0)]).filter(([, w]) => w > 0);
  const own = named(mix);
  if (own.length) return own;
  const room = named(FLORA_BY_ENVIRONMENT[environment ?? '']);
  return room.length ? room : FLORA_SPECIES.map(sp => [sp, SPECIES[sp].share]);
}

/** The gallery's order: its front row holds the low species, its back row the tall ones, shortest first. */
export const GALLERY_ROWS: readonly (readonly FloraSpecies[])[] = [
  ['grass', 'bubble', 'brain', 'clam', 'anemone', 'tube', 'bulb', 'barrel', 'shelf'],
  ['pod', 'curl', 'staghorn', 'seapen', 'elder', 'whip', 'fan', 'kelp'],
];

export function buildFlora(
  anchors: readonly FloraAnchor[], terrain: (x: number, z: number) => number,
  rng: CrystalRng, opts: FloraOptions,
): FloraField {
  const bySpecies = Object.fromEntries(FLORA_SPECIES.map(sp => [sp, 0])) as Record<FloraSpecies, number>;
  const body = new VoxelWriter(), lamp = new VoxelWriter();
  const s = opts.scale;
  const gallery = opts.layout === 'gallery';
  const want = Math.round(opts.density * opts.cap * 9);
  const lights: FloraField['lights'] = [];
  const tips: FloraField['tips'] = [];
  const empty = (): FloraField => ({ parts: [], lamps: [], plants: 0, voxels: 0, bySpecies, lights, tips, rare: 0, colonies: 0 });
  if (!want || (!anchors.length && !gallery)) return empty();
  const V = 1.7 * s; // the voxel
  const weights = weightsOf(opts.mix, opts.environment);
  const palette = opts.palette?.length ? opts.palette : null;
  let plants = 0, rare = 0, founded = 0;

  /** Grow one plant of `species` rooted at (x, z). */
  const growOne = (species: FloraSpecies, x: number, z: number, genes: number, isRare: boolean, sibling: boolean): void => {
    const def = SPECIES[species];
    const gene = geneRng(genes);
    // It feeds on the nearest crystal's light; a gallery with none leans to the front.
    const near = anchors.length
      ? anchors.reduce((b, c) => (Math.hypot(x - c.x, z - c.z) < Math.hypot(x - b.x, z - b.z) ? c : b))
      : { x, y: 0, z: z + 100, color: '#bfe8ff' };
    const root = terrain(x, z);
    const light = new Color(near.color);
    // Every plant ramps from a deeper base to a brighter tip, the tip's hue
    // turned a little one way or the other — the colony's own.
    const turn = gene.range(-0.09, 0.09);
    const ramp = (c: Color, h: number, k = 1): Color =>
      c.clone().lerp(c.clone().offsetHSL(turn, 0.08, 0.1), Math.min(1, Math.max(0, h)) ** 1.5 * 0.65).multiplyScalar(k);
    // Siblings share their genes but not their size: a touch lighter or darker.
    const vigour = 0.9 + rng.next() * 0.2;
    const dx = near.x - x, dz = near.z - z, dl = Math.hypot(dx, dz) || 1;
    const phase = rng.range(0, Math.PI * 2), gust = x * 0.021 + z * 0.015;
    for (const w of [body, lamp]) {
      w.root = root; w.phase = phase; w.gust = gust; w.top = root;
      w.flex = def.flex ?? 1; w.sheen = 0; w.maxFlex = 0; w.pearl = 0;
      w.px = x; w.pz = z; w.react = 0; w.bloatY = root;
    }
    // A world palette (No Man's Sky's one bold scheme per planet): each
    // colony's colours pulled most of the way to one of the world's hues.
    const worldHue = palette ? new Color(pick(gene, palette)) : null;
    const paint = (list: readonly string[]): Color => {
      const c = new Color(pick(gene, list));
      return worldHue ? c.lerp(worldHue, 0.72) : c;
    };
    const stem = light.clone().lerp(paint(def.leaf ?? [LEAF_GREEN]), 0.62);
    // A rare morph is nacreous all through, its lamps too.
    body.pearl = lamp.pearl = isRare ? 0.5 : 0;
    const lampsBefore = lamp.count, bodyFrom = body.pos.length / 3, lampFrom = lamp.pos.length / 3;
    def.grow({
      x, z, root, V, s, rng, gene, light, stem, lx: dx / dl, lz: dz / dl, phase, body, lamp,
      tone: (h, k = 1) => ramp(stem, h, (0.34 + 0.62 * h) * k * vigour),
      ramp: (c, h, k = 1) => ramp(c, h, k * vigour), paint,
    });
    // Dimorphic, as No Man's Sky's flora is: a sibling may be the small form
    // of its species, the same plant cut at a smaller voxel.
    if (sibling && def.max === undefined && rng.next() < 0.3) {
      const k = rng.range(0.45, 0.68);
      body.shrink(bodyFrom, x, root, z, k);
      lamp.shrink(lampFrom, x, root, z, k, lampsBefore);
    }
    const flex = Math.max(body.maxFlex, lamp.maxFlex);
    // One light per LAMP — a branch tip, a tentacle, a blossom — not per
    // plant: lamp cells that touch are one lamp (a clam's whole mantle), and
    // lamps apart are lamps apart. Each lights from its last cell drawn (its
    // crown); the last-drawn lamps first, and no more than four a plant.
    for (const c of lampHeads(lamp.cells, lampsBefore, lamp.count, (1.8 * V) ** 2, LAMPS_PER_PLANT)) {
      // Swaying as that cell's vertices do: its own root, phase, gust and flex.
      const w = c * 4;
      lights.push({ x: lamp.cells[c * 3]!, y: lamp.cells[c * 3 + 1]!, z: lamp.cells[c * 3 + 2]!, root: lamp.cellSway[w]!, phase: lamp.cellSway[w + 1]!, gust: lamp.cellSway[w + 2]!, color: near.color, flex: lamp.cellSway[w + 3]! });
    }
    tips.push({ x, z, y: Math.max(body.top, lamp.top), root, flex });
    bySpecies[species] += 1;
    plants += 1;
    if (isRare) rare += 1;
  };

  if (gallery) {
    // A specimen gallery: one of each species (the ones `floraMix` names, or
    // all of them), each in its own plot, in two rows across the front of the
    // tank — the low ones before the tall — so every kind can be seen at once.
    const named = opts.mix && Object.values(opts.mix).some((w) => (w ?? 0) > 0);
    const rows = GALLERY_ROWS.map((row) => row.filter((sp) => !named || (opts.mix?.[sp] ?? 0) > 0)).filter((row) => row.length);
    rows.forEach((row, r) => {
      const gap = (r === 0 ? 23 : 29) * s, rowZ = (rows.length === 1 ? 0 : r === 0 ? 24 : -26) * s;
      row.forEach((sp, i) => {
        const x = (i - (row.length - 1) / 2) * gap;
        // A plot that lands on a crystal, path or rock steps out of its way —
        // forward for the front row, back for the back — so nothing stands
        // inside one and no species goes missing from the gallery.
        let z = rowZ;
        const away = r === 0 && rows.length > 1 ? 1 : -1;
        while ((anchors.some((c) => Math.hypot(x - c.x, z - c.z) < 14 * s) || opts.blocked(x, z)) && Math.abs(z - rowZ) < 60 * s) z += away * 8 * s;
        if (opts.blocked(x, z)) return;
        growOne(sp, x, z, Math.floor(rng.next() * 0x7fffffff), false, false);
        founded += 1;
      });
    });
    return { parts: body.geometry(), lamps: lamp.geometry(), plants, voxels: body.count + lamp.count, bySpecies, lights, tips, rare, colonies: founded };
  }

  // Plants grow in colonies, the way a reef does: a founder, then siblings of
  // the same species and the same genes (colour) standing round it. It is
  // what makes a garden read as grown rather than scattered.
  const colonies = new Map<number, { species: FloraSpecies; gene: number; rare: boolean; x: number; z: number; left: number }>();
  for (let i = 0; i < want * 3 && plants < want; i += 1) {
    const slot = i % anchors.length, home = anchors[slot]!;
    const col = colonies.get(slot);
    let species: FloraSpecies, x: number, z: number, genes: number, isRare: boolean;
    const sibling = !!col && col.left > 0 && rng.next() < 0.62;
    if (sibling && col) {
      species = col.species; genes = col.gene; isRare = col.rare;
      const a = rng.range(0, Math.PI * 2), r = rng.range(0.55, 1) * (SPECIES[species].spread ?? 5) * s;
      x = col.x + Math.cos(a) * r; z = col.z + Math.sin(a) * r;
    } else {
      // Species by share, so a garden keeps its proportions at any density.
      // A species at its cap leaves the draw, or its rolls would eat the planting attempts.
      const open = weights.filter(([sp]) => { const m = SPECIES[sp].max; return m === undefined || bySpecies[sp] < m; });
      if (!open.length) break;
      let roll = rng.next() * open.reduce((a, [, w]) => a + w, 0);
      species = open[0]![0];
      for (const [sp, w] of open) { if (roll < w) { species = sp; break; } roll -= w; }
      const def = SPECIES[species];
      const angle = rng.range(0, Math.PI * 2);
      const radius = (def.near + (def.far - def.near) * rng.next() ** 1.4) * s;
      x = home.x + Math.cos(angle) * radius; z = home.z + Math.sin(angle) * radius;
      genes = Math.floor(rng.next() * 0x7fffffff);
      // About one colony in thirty is a rare morph.
      isRare = rng.next() < 1 / 30;
    }
    const def = SPECIES[species];
    if (def.max !== undefined && bySpecies[species] >= def.max) continue;
    if (opts.blocked(x, z)) continue;
    if (sibling && col) col.left -= 1;
    else {
      const [lo, hi] = def.colony ?? [1, 3];
      colonies.set(slot, { species, gene: genes, rare: isRare, x, z, left: lo + Math.floor(rng.next() * (hi - lo + 1)) });
      founded += 1;
    }
    growOne(species, x, z, genes, isRare, sibling);
  }
  return { parts: body.geometry(), lamps: lamp.geometry(), plants, voxels: body.count + lamp.count, bySpecies, lights, tips, rare, colonies: founded };
}

/** The sway, as shader text — one function shared by the plants, their lamps
 *  and the spores the lamps shed, so all three agree where a tip is. It is an
 *  S-curve, not a lean: a wave climbs the stalk (the `h * 0.16` term), so a
 *  tall kelp snakes while grass just flutters; a gust crosses the garden in
 *  space (`aSway.z` is a position), bowing each plant as it passes. All of it
 *  is vertex work on a merged mesh: it costs the same as standing still. */
export const FLORA_SWAY = /* glsl */ `
  vec2 mqFloraSway(float h, vec3 sw, float t) {
    float reach = min(h * h * 0.0042, 9.0) + min(h, 6.0) * 0.06;
    float gust = pow(sin(t * 0.27 - sw.z) * 0.5 + 0.5, 3.0);
    float wave = sin(t * 0.85 + sw.y - h * 0.16);
    float slow = sin(t * 0.23 + sw.y * 1.7);
    return vec2(
      (wave * 0.7 + slow * 0.5 + gust * 2.1) * reach,
      (cos(t * 0.6 + sw.y - h * 0.13) * 0.6 + gust * 0.8) * reach * 0.7);
  }
`;
export const FLORA_VERTEX = /* glsl */ `
  #include <begin_vertex>
  float h = max(0.0, position.y - aSway.x);
  // aMat.x: how freely this part sways — a stony coral barely, a tentacle most.
  vec2 sway = mqFloraSway(h, aSway, uSwayTime) * aMat.x;
  transformed.x += sway.x;
  transformed.z += sway.y;
  // A plant bowed over is a little shorter.
  transformed.y -= dot(sway, sway) * 0.012;
  // Answering a fish: a crown folds shut, a worm ducks, a pen pulls down —
  // toward its own root and centre; a pod swells about its middle.
  if (mqStartle > 0.0 && aPlant.z != 0.0) {
    float k = mqStartle * abs(aPlant.z);
    if (aPlant.z > 0.0) {
      float up = max(0.0, transformed.y - aSway.x);
      transformed.y = aSway.x + up * (1.0 - 0.72 * k) + min(0.0, transformed.y - aSway.x);
      transformed.xz = mix(transformed.xz, aPlant.xy, 0.5 * k * step(0.001, up));
    } else {
      vec3 c = vec3(aPlant.x + sway.x, aPlant.w, aPlant.y + sway.y);
      transformed = c + (transformed - c) * (1.0 + 0.22 * k);
    }
  }
`;
/** Bioluminescence: every few seconds a band of light climbs each plant from
 *  root to tip, and the lamp at the top flares as it arrives. The gust sets
 *  the whole garden off in a wave, because it shares the gust's phase. The
 *  sweep is measured in `uFloraScale` units (the world's `crystalScale`), so
 *  it reaches the tip of a kelp grown at 2.5 as surely as one grown at 1. */
export const FLORA_COLOR = /* glsl */ `
  #include <color_vertex>
  // color_vertex runs before begin_vertex in both programs, so the startle is
  // measured once here (at rest) and the reaction below reuses it.
  if (uMqFloraFishN > 0 && (aPlant.z != 0.0 || aGlow > 0.0)) mqStartle = mqStartleAt(position);
  vColor.rgb *= 1.0 + aGlow * mqStartle * 1.4;
  float fh = max(0.0, position.y - aSway.x) / uFloraScale;
  float run = fract(uSwayTime * 0.11 + aSway.y * 0.159 - aSway.z * 0.04);
  float band = 1.0 - smoothstep(0.0, 7.0, abs(run * 70.0 - 8.0 - fh));
  float arrive = 1.0 - smoothstep(0.0, 0.16, abs(run - 0.62));
  vColor.rgb *= 1.0 + band * 1.1 * (1.0 - aGlow) + aGlow * (0.25 * sin(uSwayTime * 0.75 + aSway.y) + 0.9 * arrive);
`;

/** Spores: each lamp sheds a few motes of its own light, which rise, wander
 *  and go out. One Points draw for the whole garden. */
export const SPORE_VERTEX = /* glsl */ `
  #include <begin_vertex>
  float life = fract(aSpore.x + uSwayTime * aSpore.y);
  vec2 tip = mqFloraSway(max(0.0, position.y - aSway.x), aSway, uSwayTime - life * 3.0) * aFlex;
  transformed.x += tip.x * (1.0 - life) + sin(life * 9.0 + aSpore.x * 40.0) * (1.5 + life * 5.0);
  transformed.z += tip.y * (1.0 - life) + cos(life * 7.0 + aSpore.x * 31.0) * (1.5 + life * 5.0);
  transformed.y += life * (14.0 + aSpore.z * 22.0);
  vSpore = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.45, 1.0, life));
`;

/** Fish a garden answers to at once (the cast; the shoal is too small to startle anything). */
export const MAX_FLORA_FISH = 24;

/** The cast as the scenery sees it — declared by every program that answers a passing fish (flora, geodes). */
export const MQ_FISH_GLSL = /* glsl */ `
  uniform int uMqFloraFishN;
  uniform vec4 uMqFloraFish[${MAX_FLORA_FISH}];
  // How startled this point is by the nearest fish: 1 within half a reach, 0 past it.
  float mqStartleAt(vec3 p) {
    float s = 0.0;
    for (int i = 0; i < ${MAX_FLORA_FISH}; i++) {
      if (i >= uMqFloraFishN) break;
      float d = distance(p, uMqFloraFish[i].xyz) / uMqFloraFish[i].w;
      s = max(s, 1.0 - smoothstep(0.5, 1.0, d));
    }
    return s;
  }
`;

/** What every flora program declares ahead of the sway. */
export const FLORA_PARS = /* glsl */ `
  uniform float uSwayTime; uniform float uFloraScale;
  attribute vec3 aSway; attribute float aGlow; attribute vec2 aMat; attribute vec4 aPlant;
  float mqStartle = 0.0;
` + MQ_FISH_GLSL;

/** Lamps are lit metal: their vertex colour is both the metal's tint and what
 *  it emits, so a bud is anodised in its crystal's colour AND glows in it. */
export const FLORA_LAMP_EMISSIVE = /* glsl */ `
  #include <emissivemap_fragment>
  totalEmissiveRadiance += vColor.rgb * 0.5;
`;
