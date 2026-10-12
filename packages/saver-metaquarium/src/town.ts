/**
 * The small things a lived-in village has (`townProps`): fences round the
 * yards, a mailbox by every gate, benches round the square, a current sock.
 *
 * Everything is cubes on the fish's grid (one cube = two of a classic token's
 * pixels, FISH_LENGTH / 7: furniture for fish, sized to them) and set square
 * to its home or its square:
 *
 *   fence     a square yard round each home, turned to face its door, with a
 *             gate where the path leaves; posts every three cubes. Styles:
 *             driftwood (weathered pickets and a rail), coral (coral posts
 *             strung with sagging kelp rope), stone (a low dry-stone wall),
 *             crystal (slate posts each capped with a glowing crystal in the
 *             home's colour). A fence keeps off paths, other yards, crystals
 *             and lamps, and simply leaves a gap where something is in the way.
 *   mailbox   just outside each gate, beside the path, facing it: a post box
 *             whose flag goes up when the mail comes (and down again a while
 *             after), a clam that opens, a bottle that rocks on its cradle.
 *             Each is a vignette mark (`mailbox1`…): a fish sent there has
 *             come with the post.
 *   bench     round the fountain (or the hub, or the village green), facing
 *             in: a scallop-backed shell bench or a stone slab.
 *   sock      a striped current sock on a pole, swinging round as the
 *             current turns and drooping as it slackens.
 *
 * The moving parts (a flag, a lid, a bottle, a sock) are one draw: each
 * vertex carries its pivot, axis and motion, and the vertex shader turns it,
 * closed-form in the scene clock — every screen sees the same mail arrive.
 */
import { BufferAttribute, BufferGeometry, Color, FrontSide, MeshBasicMaterial, Vector3 } from 'three';
import type { CrystalRng } from './crystals';
import { CubeWriter } from './scenery-paint';
import { FISH_LENGTH } from './swim';
import { BENCH_STYLES, FENCE_STYLES, MAILBOX_STYLES, type FenceStyle, type MailboxStyle, type TownProps } from './town-mix';

/** One cube: two of a classic token's pixels — on the fish's grid, and sized for them: a fence post comes to half
 *  a fish, a bench seats one, a current sock's pole is a fish tall. */
export const TOWN_VOXEL = (FISH_LENGTH / 14) * 2;

export interface TownYard {
  /** The home's middle, the ground there, and its shell's half-widths: across its front, and front to back. */
  x: number; z: number; y: number; across: number; along: number;
  /** The foot of its front steps. */
  door: { x: number; z: number };
  /** Its crystal's colour (a crystal fence's caps). */
  tint: string;
}

export interface TownContext {
  rng: CrystalRng;
  scale: number;
  terrain: (x: number, z: number) => number;
  yards: readonly TownYard[];
  /** Where benches gather (the fountain, the hub, the green) and how far out its paving runs; null: no benches. */
  centre: { x: number; z: number; r: number } | null;
  /** Clear of everything placed before the town (homes, crystals, lamps, the fountain); `own` is a home not to count. */
  free: (x: number, z: number, r: number, own?: { x: number; z: number }) => boolean;
  /** How far (x, z) is from the nearest path's edge; `onSquare`: the square's paving does not count (a bench stands on it). */
  pathClear: (x: number, z: number, onSquare?: boolean) => number;
}

export interface Town {
  /** Everything that stands still: posts, rails, walls, boxes, benches, poles. */
  fixed: BufferGeometry | null;
  /** Flags, lids, bottles and socks: turned in the vertex shader (`townMaterial`). */
  moving: BufferGeometry | null;
  obstacles: Array<{ x: number; y: number; z: number; r: number; h: number }>;
  /** `mailbox1`…: where a fish delivering the post hovers. */
  marks: Record<string, { x: number; y: number; z: number }>;
  counts: { fences: number; posts: number; mailboxes: number; benches: number; socks: number };
}

/** How a moving cube moves (aSwing.x). */
const FLAG = 1, LID = 2, ROCK = 3, SOCK = 4;

/** A CubeWriter whose cubes also carry a pivot, an axis and a motion per vertex. */
class MovingWriter {
  readonly cubes = new CubeWriter();
  readonly pivot: number[] = []; readonly axis: number[] = []; readonly swing: number[] = [];
  cube(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: Color, yaw: number,
    pivot: Vector3, axis: Vector3, kind: number, phase: number, angle: number): void {
    const before = this.cubes.pos.length / 3;
    this.cubes.cube(cx, cy, cz, sx, sy, sz, color, yaw);
    for (let v = before; v < this.cubes.pos.length / 3; v++) {
      this.pivot.push(pivot.x, pivot.y, pivot.z); this.axis.push(axis.x, axis.y, axis.z); this.swing.push(kind, phase, angle, 0);
    }
  }
  geometry(): BufferGeometry | null {
    if (!this.cubes.count) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.cubes.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.cubes.col), 3));
    g.setAttribute('aPivot', new BufferAttribute(new Float32Array(this.pivot), 3));
    g.setAttribute('aAxis', new BufferAttribute(new Float32Array(this.axis), 3));
    g.setAttribute('aSwing', new BufferAttribute(new Float32Array(this.swing), 4));
    g.computeBoundingSphere();
    g.userData.mqOwned = true;
    return g;
  }
}

const geometryOf = (w: CubeWriter): BufferGeometry | null => {
  if (!w.count) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(w.pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(w.col), 3));
  g.computeBoundingSphere();
  g.userData.mqOwned = true;
  return g;
};

/** CubeWriter's yaw that lays a cube's length along the ground direction (dx, dz). */
const yawAlong = (dx: number, dz: number): number => Math.atan2(-dz, dx);

const PALETTE = {
  driftwood: ['#8a7d6b', '#6f6457', '#9c8e78', '#7d705f'],
  coral: ['#ff7f6b', '#ff9a76', '#e86a5a', '#ffb38a'],
  kelp: '#5f9e4a',
  stone: ['#7d8796', '#6a7380', '#8f98a6', '#737c89'],
  slate: '#3b4252',
  mailbox: ['#3f7f8c', '#b8433a', '#2f5d8a', '#e2c35a'],
  shell: ['#f3e3cf', '#f2b8a8'],
  benchStone: ['#8d939c', '#7a8089'],
  sock: ['#ff7a3d', '#f5f1e8'],
} as const;

export function buildTown(props: TownProps, ctx: TownContext): Town {
  const out: Town = { fixed: null, moving: null, obstacles: [], marks: {}, counts: { fences: 0, posts: 0, mailboxes: 0, benches: 0, socks: 0 } };
  const s = ctx.scale, V = TOWN_VOXEL * s, rng = ctx.rng;
  const fixed = new CubeWriter(), moving = new MovingWriter();
  const c = new Color();
  const col = (hex: string, k = 1): Color => c.set(hex).multiplyScalar(k);
  const g = (x: number, z: number): number => ctx.terrain(x, z);

  // The yards first: a rectangle round each home fitted to its shell (two cubes clear of it, three in front of the
  // door), turned to face its door, a gate on the door's side.
  const yards = ctx.yards.map((y) => {
    const dl = Math.hypot(y.door.x - y.x, y.door.z - y.z) || 1;
    const d = { x: (y.door.x - y.x) / dl, z: (y.door.z - y.z) / dl }, r = { x: d.z, z: -d.x };
    return { ...y, d, r, Rd: Math.max(y.along, dl) + 3 * V, Rr: y.across + 2 * V };
  });
  const gateHalf = 2.5 * V;
  const inYard = (px: number, pz: number, k: number): boolean => {
    const y = yards[k]!, ox = px - y.x, oz = pz - y.z;
    return Math.abs(ox * y.d.x + oz * y.d.z) < y.Rd + V && Math.abs(ox * y.r.x + oz * y.r.z) < y.Rr + V;
  };
  const gateAt: Array<{ x: number; z: number }> = [];

  if (props.fence) {
    yards.forEach((y, i) => {
      const style: FenceStyle = props.fence!.style ?? FENCE_STYLES[i % FENCE_STYLES.length]!;
      const at = (side: number, u: number): { x: number; z: number; along: { x: number; z: number } } => {
        // front (door), back, right, left: a centre and the direction posts run along it.
        const [cx, cz, ax, az] = side === 0 ? [y.d.x * y.Rd, y.d.z * y.Rd, y.r.x, y.r.z] : side === 1 ? [-y.d.x * y.Rd, -y.d.z * y.Rd, y.r.x, y.r.z]
          : side === 2 ? [y.r.x * y.Rr, y.r.z * y.Rr, y.d.x, y.d.z] : [-y.r.x * y.Rr, -y.r.z * y.Rr, y.d.x, y.d.z];
        return { x: y.x + cx + ax * u, z: y.z + cz + az * u, along: { x: ax, z: az } };
      };
      // Something in the way — a path, a crystal, a lamp, another yard — and the fence leaves a gap.
      const blocked = (px: number, pz: number): boolean => !ctx.free(px, pz, V, y) || ctx.pathClear(px, pz) < 1.5 * V
        || yards.some((_, k) => k !== i && k < i && inYard(px, pz, k));
      let built = 0;
      for (let side = 0; side < 4; side++) {
        // Front and back run across the yard, the sides front to back: posts every three cubes, evenly.
        const half = side < 2 ? y.Rr : y.Rd;
        const n = Math.max(2, Math.round((2 * half) / (3 * V))), step = (2 * half) / n;
        const posts: Array<{ x: number; z: number; u: number; tall: boolean } | null> = [];
        for (let k = 0; k <= n; k++) {
          // The left and right sides share the front and back's corner posts.
          if (side >= 2 && (k === 0 || k === n)) { posts.push(null); continue; }
          const u = -half + k * step;
          if (side === 0 && Math.abs(u) < gateHalf - 1e-6) { posts.push(null); continue; }
          const p = at(side, u);
          posts.push(blocked(p.x, p.z) ? null : { x: p.x, z: p.z, u, tall: false });
        }
        // The gate: two taller posts either side of the gap, on the door's side.
        if (side === 0) {
          for (const u of [-gateHalf, gateHalf]) {
            const p = at(0, u);
            if (!blocked(p.x, p.z)) posts.push({ x: p.x, z: p.z, u, tall: true });
          }
          const gp = at(0, 0); gateAt[i] = { x: gp.x, z: gp.z };
        }
        const along = at(side, 0).along, yaw = yawAlong(along.x, along.z);
        const real = posts.filter((p): p is { x: number; z: number; u: number; tall: boolean } => !!p).sort((a, b) => a.u - b.u);
        for (const p of real) { fencePost(style, p.x, p.z, p.tall, yaw, y.tint); built++; }
        // Rails, rope or wall between neighbours one step apart (never across the gate).
        for (let k = 0; k + 1 < real.length; k++) {
          const a = real[k]!, b = real[k + 1]!;
          if (b.u - a.u > step * 1.01 + 1e-6 && !(a.tall && b.tall)) continue;
          if (a.tall && b.tall) continue;
          fenceSpan(style, a, b, yaw);
        }
      }
      if (built) { out.counts.fences++; out.counts.posts += built; }
    });
  }

  function fencePost(style: FenceStyle, x: number, z: number, tall: boolean, yaw: number, tint: string): void {
    const y0 = g(x, z), k = tall ? 1.35 : 1;
    if (style === 'driftwood') {
      const h = (2.6 + 0.6 * rng.next()) * V * k;
      fixed.cube(x, y0 + h / 2, z, 0.9 * V, h, 0.9 * V, col(PALETTE.driftwood[Math.floor(rng.next() * 4)]!), yaw);
    } else if (style === 'coral') {
      const n = tall ? 4 : 3;
      for (let j = 0; j < n; j++) fixed.cube(x, y0 + (j + 0.5) * 0.9 * V, z, 0.9 * V, 0.9 * V, 0.9 * V, col(PALETTE.coral[(j + Math.floor(rng.next() * 2)) % 4]!), yaw);
      fixed.cube(x, y0 + (n * 0.9 + 0.3) * V, z, 0.6 * V, 0.6 * V, 0.6 * V, col(PALETTE.coral[3]!, 1.1), yaw);
    } else if (style === 'stone') {
      const n = tall ? 3 : 2;
      for (let j = 0; j < n; j++) fixed.cube(x, y0 + (j + 0.5) * 0.95 * V, z, 1.05 * V, 0.95 * V, 1.05 * V, col(PALETTE.stone[j % 4]!), yaw);
      fixed.cube(x, y0 + (n * 0.95 + 0.15) * V, z, 1.2 * V, 0.3 * V, 1.2 * V, col(PALETTE.stone[2]!, 1.1), yaw);
    } else {
      const h = 2.4 * V * k;
      fixed.cube(x, y0 + h / 2, z, 0.8 * V, h, 0.8 * V, col(PALETTE.slate), yaw);
      // The cap: a crystal in its home's colour, glowing (flat: its own light, not the room's).
      fixed.cube(x, y0 + h + 0.45 * V, z, 0.9 * V, 0.9 * V, 0.9 * V, col(tint, 1.25), yaw, true);
      fixed.cube(x, y0 + h + 1.1 * V, z, 0.45 * V, 0.45 * V, 0.45 * V, col('#ffffff').lerp(new Color(tint), 0.5), yaw, true);
    }
    out.obstacles.push({ x, y: y0, z, r: V, h: 3 * V });
  }

  function fenceSpan(style: FenceStyle, a: { x: number; z: number }, b: { x: number; z: number }, yaw: number): void {
    const len = Math.hypot(b.x - a.x, b.z - a.z), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const ya = g(a.x, a.z), yb = g(b.x, b.z), ym = (ya + yb) / 2;
    if (style === 'driftwood') {
      fixed.cube(mx, ym + 1.25 * V, mz, len, 0.3 * V, 0.3 * V, col(PALETTE.driftwood[1]!), yaw);
      const pickets = Math.max(1, Math.round(len / V) - 1);
      for (let j = 1; j <= pickets; j++) {
        const f = j / (pickets + 1), x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f, h = (1.8 + 0.4 * rng.next()) * V;
        fixed.cube(x, g(x, z) + h / 2, z, 0.55 * V, h, 0.35 * V, col(PALETTE.driftwood[Math.floor(rng.next() * 4)]!), yaw);
      }
    } else if (style === 'coral') {
      // Two strands of kelp rope, sagging between the posts.
      for (const [h, sag] of [[1.0, 0.35], [1.9, 0.45]] as const) {
        const knots = Math.max(4, Math.round(len / (0.45 * V)));
        for (let j = 1; j < knots; j++) {
          const f = j / knots, x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
          const y = ya + (yb - ya) * f + (h - sag * 4 * f * (1 - f)) * V;
          fixed.cube(x, y, z, 0.32 * V, 0.32 * V, 0.32 * V, col(PALETTE.kelp, 0.9 + 0.2 * ((j % 2))), yaw);
        }
      }
    } else if (style === 'stone') {
      const blocks = Math.max(1, Math.round(len / V) - 1);
      for (let j = 1; j <= blocks; j++) {
        const f = j / (blocks + 1), x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f, y0 = g(x, z);
        for (let row = 0; row < 2; row++) fixed.cube(x, y0 + (row + 0.5) * 0.95 * V, z, 0.98 * V, 0.95 * V, 1.0 * V, col(PALETTE.stone[(j + row) % 4]!), yaw);
      }
    } else {
      fixed.cube(mx, ym + 1.6 * V, mz, len, 0.22 * V, 0.22 * V, col(PALETTE.slate, 1.2), yaw);
    }
  }

  // Mailboxes: just outside each gate, beside the path, facing it.
  if (props.mailbox) {
    yards.forEach((y, i) => {
      const style: MailboxStyle = props.mailbox!.style ?? MAILBOX_STYLES[i % MAILBOX_STYLES.length]!;
      let spot: { x: number; z: number; side: number } | null = null;
      // Beside the gate, outside the fence: either side, a little further out if the first spots are taken.
      for (const ahead of [2, 3.5, 5]) for (const off of [2.2, 3.6, 5]) for (const side of [1, -1]) {
        if (spot) break;
        const outR = y.Rd + ahead * V, sideOff = gateHalf + off * V;
        const x = y.x + y.d.x * outR + y.r.x * sideOff * side, z = y.z + y.d.z * outR + y.r.z * sideOff * side;
        if (ctx.free(x, z, 1.5 * V, y) && ctx.pathClear(x, z, true) > 1.2 * V && !yards.some((_, k) => k !== i && inYard(x, z, k))) spot = { x, z, side };
      }
      if (!spot) return;
      const f = new Vector3(-y.r.x * spot.side, 0, -y.r.z * spot.side); // toward the path
      const sAx = new Vector3(f.z, 0, -f.x); // across the box
      mailbox(style, spot.x, spot.z, f, sAx, i);
      out.counts.mailboxes++;
      out.obstacles.push({ x: spot.x, y: g(spot.x, spot.z), z: spot.z, r: 1.6 * V, h: 4.5 * V });
      // Where a fish bringing the post hovers: in front of the box, at its height.
      out.marks[`mailbox${i + 1}`] = { x: spot.x + f.x * 4 * V, y: g(spot.x, spot.z) + 4 * V, z: spot.z + f.z * 4 * V };
    });
  }

  function mailbox(style: MailboxStyle, x: number, z: number, f: Vector3, sAx: Vector3, i: number): void {
    const y0 = g(x, z), yaw = yawAlong(f.x, f.z), phase = rng.next();
    const up = new Vector3(0, 1, 0);
    const post = style === 'post' ? 3 : style === 'clam' ? 2.6 : 2.4;
    fixed.cube(x, y0 + (post * V) / 2, z, 0.6 * V, post * V, 0.6 * V, col(PALETTE.driftwood[1]!), yaw);
    const top = y0 + post * V;
    if (style === 'post') {
      const hue = PALETTE.mailbox[i % PALETTE.mailbox.length]!;
      fixed.cube(x, top + 0.5 * V, z, 2.2 * V, 1.0 * V, 1.2 * V, col(hue), yaw);
      fixed.cube(x, top + 1.15 * V, z, 2.2 * V, 0.3 * V, 0.8 * V, col(hue, 1.08), yaw);
      fixed.cube(x + f.x * 1.12 * V, top + 0.55 * V, z + f.z * 1.12 * V, 0.08 * V, 0.8 * V, 0.9 * V, col('#1d2430'), yaw);
      // The flag, built up, folding back down when there is no mail: on the box's side, near its back.
      const side = 0.68 * V, back = -0.75 * V;
      const pv = new Vector3(x + f.x * back + sAx.x * side, top + 0.3 * V, z + f.z * back + sAx.z * side);
      const fold = new Vector3().crossVectors(sAx, up).dot(f) > 0 ? -Math.PI / 2 : Math.PI / 2;
      moving.cube(pv.x, pv.y + 0.6 * V, pv.z, 0.25 * V, 1.2 * V, 0.15 * V, col('#d8d8d8'), yaw, pv, sAx, FLAG, phase, fold);
      moving.cube(pv.x + f.x * 0.3 * V, pv.y + 1.1 * V, pv.z + f.z * 0.3 * V, 0.6 * V, 0.45 * V, 0.15 * V, col('#e8402f'), yaw, pv, sAx, FLAG, phase, fold);
    } else if (style === 'clam') {
      // The dish, ribbed, and its lid hinged at the back: it opens its front to the path.
      for (let r = -2; r <= 2; r++) {
        const o = r * 0.48 * V, w = (1.2 - Math.abs(r) * 0.18) * V;
        fixed.cube(x + sAx.x * o, top + 0.3 * V, z + sAx.z * o, w, 0.6 * V, 0.46 * V, col(PALETTE.shell[(r + 2) % 2]!), yawAlong(sAx.x, sAx.z) + Math.PI / 2);
      }
      const pv = new Vector3(x - f.x * 0.6 * V, top + 0.6 * V, z - f.z * 0.6 * V);
      const open = new Vector3().crossVectors(sAx, f).dot(up) > 0 ? 0.9 : -0.9;
      for (let r = -2; r <= 2; r++) {
        const o = r * 0.48 * V, w = (1.1 - Math.abs(r) * 0.16) * V;
        moving.cube(x + sAx.x * o, top + 0.85 * V, z + sAx.z * o, w, 0.5 * V, 0.46 * V, col(PALETTE.shell[(r + 3) % 2]!, 1.05),
          yawAlong(sAx.x, sAx.z) + Math.PI / 2, pv, sAx, LID, phase, open);
      }
      // A pearl inside, seen when it opens.
      fixed.cube(x, top + 0.75 * V, z, 0.35 * V, 0.35 * V, 0.35 * V, col('#fff6ee', 1.2), yaw, true);
    } else {
      // A cradle, and a green bottle on it, its note rolled inside; it rocks.
      fixed.cube(x + sAx.x * 0.5 * V, top + 0.25 * V, z + sAx.z * 0.5 * V, 0.3 * V, 0.5 * V, 0.3 * V, col(PALETTE.driftwood[0]!), yaw);
      fixed.cube(x - sAx.x * 0.5 * V, top + 0.25 * V, z - sAx.z * 0.5 * V, 0.3 * V, 0.5 * V, 0.3 * V, col(PALETTE.driftwood[0]!), yaw);
      const pv = new Vector3(x, top + 0.5 * V, z);
      moving.cube(x, top + 1.0 * V, z, 2.2 * V, 0.95 * V, 0.95 * V, col('#4fb27a'), yaw, pv, sAx, ROCK, phase, 0.09);
      moving.cube(x + f.x * 1.45 * V, top + 1.0 * V, z + f.z * 1.45 * V, 0.7 * V, 0.45 * V, 0.45 * V, col('#5cc58a'), yaw, pv, sAx, ROCK, phase, 0.09);
      moving.cube(x + f.x * 1.9 * V, top + 1.0 * V, z + f.z * 1.9 * V, 0.3 * V, 0.38 * V, 0.38 * V, col('#c9a26b'), yaw, pv, sAx, ROCK, phase, 0.09);
      moving.cube(x - f.x * 0.2 * V, top + 1.0 * V, z - f.z * 0.2 * V, 1.1 * V, 0.55 * V, 0.55 * V, col('#f3ead2', 1.1), yaw, pv, sAx, ROCK, phase, 0.09);
    }
  }

  // Benches: round the square, facing in, spaced evenly — the ring turned until none sits on a path.
  if (props.bench && ctx.centre) {
    const { x: cx, z: cz } = ctx.centre, n = props.bench.count;
    // Rings just outside the square's paving, then a little further out (between its lamps and the paths), each
    // turned until every bench is clear; failing that, the ring and turn that seat the most.
    let best: { ring: number; turn: number; fit: number } = { ring: 0, turn: 0, fit: -1 };
    // On the square's paving between the fountain and its lamps first, then just beyond them.
    for (const ring of [ctx.centre.r - 1.5 * V, ctx.centre.r + 3 * V, ctx.centre.r + 6 * V]) {
      for (let k = 0; k < 24; k++) {
        const turn = (k / 24) * ((Math.PI * 2) / n);
        const fit = Array.from({ length: n }, (_, j) => turn + (j / n) * Math.PI * 2).filter((a) => benchOk(cx, cz, ring, a)).length;
        if (fit > best.fit) best = { ring, turn, fit };
        if (fit === n) break;
      }
      if (best.fit === n) break;
    }
    const angles = Array.from({ length: n }, (_, j) => best.turn + (j / n) * Math.PI * 2).filter((a) => benchOk(cx, cz, best.ring, a));
    angles.forEach((a, j) => {
      const p = { x: cx + Math.cos(a) * best.ring, z: cz + Math.sin(a) * best.ring }, style = props.bench!.style ?? BENCH_STYLES[j % BENCH_STYLES.length]!;
      bench(style, p.x, p.z, a);
      out.counts.benches++;
      out.obstacles.push({ x: p.x, y: g(p.x, p.z), z: p.z, r: 2.4 * V, h: 3.2 * V });
    });
  }

  function benchOk(cx: number, cz: number, ring: number, a: number): boolean {
    const x = cx + Math.cos(a) * ring, z = cz + Math.sin(a) * ring;
    return ctx.free(x, z, 2 * V) && ctx.pathClear(x, z, true) > 1.2 * V && !out.obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 2 * V);
  }

  function bench(style: 'shell' | 'stone', x: number, z: number, a: number): void {
    // Facing in (f, toward the centre), its length along the ring (t).
    const f = { x: -Math.cos(a), z: -Math.sin(a) }, t = { x: -f.z, z: f.x }, yaw = yawAlong(t.x, t.z), y0 = g(x, z);
    if (style === 'shell') {
      for (const o of [-1.3, 1.3]) fixed.cube(x + t.x * o * V, y0 + 0.55 * V, z + t.z * o * V, 0.5 * V, 1.1 * V, 1.0 * V, col(PALETTE.shell[0]!, 0.85), yaw);
      fixed.cube(x, y0 + 1.25 * V, z, 4 * V, 0.4 * V, 1.4 * V, col(PALETTE.shell[0]!), yaw);
      // The scallop back: five ribs, tallest in the middle, symmetric.
      [1.4, 1.8, 2.1, 1.8, 1.4].forEach((h, k) => {
        const o = (k - 2) * 0.8 * V, bx = x + t.x * o - f.x * 0.6 * V, bz = z + t.z * o - f.z * 0.6 * V;
        fixed.cube(bx, y0 + 1.45 * V + (h * V) / 2, bz, 0.7 * V, h * V, 0.35 * V, col(PALETTE.shell[k % 2]!), yaw);
      });
    } else {
      for (const o of [-1.4, 1.4]) fixed.cube(x + t.x * o * V, y0 + 0.5 * V, z + t.z * o * V, 0.9 * V, 1.0 * V, 1.2 * V, col(PALETTE.benchStone[1]!), yaw);
      fixed.cube(x, y0 + 1.3 * V, z, 4.2 * V, 0.6 * V, 1.5 * V, col(PALETTE.benchStone[0]!), yaw);
    }
  }

  // Current socks: by the square, between its benches, or else on open ground near the village.
  if (props.sock) {
    const want = props.sock.count;
    const candidates: Array<{ x: number; z: number }> = [];
    if (ctx.centre) {
      const ring = ctx.centre.r + 9 * V;
      for (let k = 0; k < 16; k++) { const a = Math.PI / 8 + (k / 16) * Math.PI * 2; candidates.push({ x: ctx.centre.x + Math.cos(a) * ring, z: ctx.centre.z + Math.sin(a) * ring }); }
    }
    for (const y of yards) for (const side of [1, -1]) candidates.push({ x: y.x + y.r.x * (y.Rr + 5 * V) * side, z: y.z + y.r.z * (y.Rr + 5 * V) * side });
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, r = (50 + 10 * (k % 3)) * s; candidates.push({ x: Math.cos(a) * r, z: Math.sin(a) * r }); }
    const placed: Array<{ x: number; z: number }> = [];
    for (const p of candidates) {
      if (placed.length >= want) break;
      if (!ctx.free(p.x, p.z, 1.5 * V) || ctx.pathClear(p.x, p.z) < 1.5 * V || yards.some((_, k) => inYard(p.x, p.z, k))) continue;
      if (out.obstacles.some((o) => Math.hypot(p.x - o.x, p.z - o.z) < o.r + 2 * V) || placed.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 20 * V)) continue;
      placed.push(p);
      sock(p.x, p.z);
      out.counts.socks++;
      out.obstacles.push({ x: p.x, y: g(p.x, p.z), z: p.z, r: 1.2 * V, h: 8 * V });
    }
  }

  function sock(x: number, z: number): void {
    const y0 = g(x, z), h = 7 * V, phase = rng.next(), base = rng.next() * Math.PI * 2;
    fixed.cube(x, y0 + h / 2, z, 0.45 * V, h, 0.45 * V, col('#c9ccd2'), 0);
    fixed.cube(x, y0 + h + 0.2 * V, z, 0.7 * V, 0.4 * V, 0.7 * V, col('#e8e4dc'), 0);
    // The sock, built along +x from the pole's top: the shader droops it, then swings it round.
    const pv = new Vector3(x, y0 + h - 0.3 * V, z), axis = new Vector3(0, 1, 0);
    for (let k = 0; k < 5; k++) {
      const w = (1.4 - k * 0.17) * V;
      moving.cube(x + (0.7 + k * 1.0) * V, pv.y, z, 1.0 * V, w, w, col(PALETTE.sock[k % 2]!), 0, pv, axis, SOCK, phase, base);
    }
  }

  out.fixed = geometryOf(fixed);
  out.moving = moving.geometry();
  return out;
}

/**
 * The moving parts' material: each vertex turned about its pivot, closed-form in the scene clock (`clock`).
 *   flag  up when the mail comes, for 18 s, every 47 s (each box its own phase), down otherwise
 *   lid   a clam opens over 2 s, stays open 4 s, closes over 2 s, every 23 s
 *   rock  a bottle rocks on its cradle
 *   sock  droops as the current slackens, swings round as it turns
 */
export const TOWN_MOTION_GLSL = /* glsl */ `
  attribute vec3 aPivot; attribute vec3 aAxis; attribute vec4 aSwing;
  uniform float uTownTime;
  vec3 mqTownRot(vec3 v, vec3 a, float ang) { float c = cos(ang), s = sin(ang); return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c); }
`;
export const TOWN_MOTION_VERTEX = /* glsl */ `
  #include <begin_vertex>
  {
    float kind = aSwing.x, ph = aSwing.y, t = uTownTime;
    vec3 p = transformed - aPivot;
    if (kind < ${FLAG}.5) {
      float u = mod(t + ph * 47.0, 47.0);
      float up = smoothstep(0.0, 0.8, u) * (1.0 - smoothstep(18.0, 18.8, u));
      p = mqTownRot(p, aAxis, aSwing.z * (1.0 - up));
    } else if (kind < ${LID}.5) {
      float u = mod(t + ph * 23.0, 23.0);
      p = mqTownRot(p, aAxis, aSwing.z * smoothstep(0.0, 2.0, u) * (1.0 - smoothstep(6.0, 8.0, u)));
    } else if (kind < ${ROCK}.5) {
      p = mqTownRot(p, aAxis, aSwing.z * sin(t * 0.9 + ph * 6.2832));
    } else {
      float droop = 0.15 + 0.35 * (0.5 + 0.5 * sin(t * 0.17 + ph * 6.2832));
      float yaw = aSwing.z + 0.55 * sin(t * 0.11 + ph * 6.2832) + 0.2 * sin(t * 0.29 + ph * 12.566);
      p = mqTownRot(mqTownRot(p, vec3(0.0, 0.0, 1.0), -droop), vec3(0.0, 1.0, 0.0), yaw);
    }
    transformed = aPivot + p;
  }
`;

export function townMaterial(clock: { value: number }): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({ vertexColors: true, side: FrontSide });
  mat.userData.mqOwned = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTownTime = clock;
    shader.vertexShader = TOWN_MOTION_GLSL + shader.vertexShader.replace('#include <begin_vertex>', TOWN_MOTION_VERTEX);
  };
  mat.customProgramCacheKey = () => 'mq-town-moving-v1';
  return mat;
}

/** Where a flag stands at `t` (1 up, 0 down) — the shader's schedule, for tests and for whoever wants to know. */
export function flagUp(phase: number, t: number): number {
  const u = ((t + phase * 47) % 47 + 47) % 47;
  const sm = (a: number, b: number, x: number): number => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  return sm(0, 0.8, u) * (1 - sm(18, 18.8, u));
}
