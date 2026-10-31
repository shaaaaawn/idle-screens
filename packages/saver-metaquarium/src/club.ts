/**
 * The open-mic stage (`stageSet`), built of cubes like everything else in the tank.
 *
 *   club   a brick back wall, washed warm where the spot spills on it and sooty toward the top, a mic on a
 *          stand at the `mic` mark (vignette.ts), and a bar stool beside it
 *   mic    the stand alone, for any open stage
 *
 * The mic stands in front of the `mic` mark at mouth height for a dolphin on its tail, tipped back toward
 * whoever stands there; the stool waits upstage left of it. Seeded only by position: the same bricks on every
 * screen. Zero state, built once per scenery.
 */
import { BoxGeometry, BufferAttribute, Color, Group, Mesh, MeshBasicMaterial, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OPEN_MARKS } from './vignette';

export const STAGE_SETS = ['none', 'club', 'mic'] as const;
export type StageSet = (typeof STAGE_SETS)[number];

export const CLUB = {
  /** The back wall: how far back, how wide either side, how high; one brick (with its mortar joint). */
  wall: { z: -96, half: 104, top: 128, brick: { w: 8, h: 3.6, d: 3, joint: 0.55 } },
  bricks: ['#7c3326', '#8d3d2b', '#6e2c22', '#984631', '#7a3a2e', '#5f2620'],
  mortar: '#2b2422',
  /** The warm pool the spot throws on the wall behind the mic: centre height and radius. */
  spill: { y: 46, r: 44, lift: 0.75 },
  /** The mic: how far in front of its mark the stand stands, and the height of the mic's head. */
  mic: { ahead: 8, head: 56, tilt: 0.5 },
  /** The stool: where, from the mic mark, and its seat height. */
  stool: { x: -18, z: -12, seat: 15 },
} as const;

type Box = [x: number, y: number, z: number, w: number, h: number, d: number, color: Color];

function merged(boxes: readonly Box[], name: string): Mesh {
  const parts: BufferGeometry[] = [];
  for (const [x, y, z, w, h, d, col] of boxes) {
    const g = new BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    const n = g.getAttribute('position').count;
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { rgb[i * 3] = col.r; rgb[i * 3 + 1] = col.g; rgb[i * 3 + 2] = col.b; }
    g.setAttribute('color', new BufferAttribute(rgb, 3));
    parts.push(g);
  }
  const geometry = mergeGeometries(parts)!;
  geometry.userData.mqOwned = true;
  const material = new MeshBasicMaterial({ vertexColors: true });
  material.name = name;
  material.userData.mqOwned = true;
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

/** 0..1 from a brick's place: the same wall everywhere. */
const brickHash = (i: number, j: number): number => {
  const s = Math.sin(i * 91.7 + j * 47.3 + 13.1) * 43758.5453;
  return s - Math.floor(s);
};

export interface BuiltStageSet {
  group: Group;
  /** Its materials, to take the spot and crystal light (flora-light.ts). */
  materials: MeshBasicMaterial[];
  obstacles: { x: number; y: number; z: number; r: number; h: number }[];
}

export function buildStageSet(kind: StageSet, terrain: (x: number, z: number) => number): BuiltStageSet | null {
  if (kind === 'none') return null;
  const group = new Group();
  group.name = `stage-set-${kind}`;
  const obstacles: BuiltStageSet['obstacles'] = [];
  const mic = OPEN_MARKS.mic!;
  const boxes: Box[] = [];
  const c = (hex: string): Color => new Color(hex);

  if (kind === 'club') {
    // The wall: running bond, each brick its own red, lit by the spill and dimmed by soot toward the top.
    const { z, half, top, brick: b } = CLUB.wall;
    const ground = Math.min(terrain(-half, z), terrain(0, z), terrain(half, z)) - 2;
    const rows = Math.ceil((top - ground) / b.h);
    const tmp = new Color();
    for (let j = 0; j < rows; j++) {
      const y = ground + (j + 0.5) * b.h;
      const off = j % 2 ? b.w / 2 : 0;
      for (let i = -Math.ceil(half / b.w) - 1; i <= Math.ceil(half / b.w); i++) {
        const x0 = Math.max(-half, i * b.w + off - b.w / 2), x1 = Math.min(half, i * b.w + off + b.w / 2);
        if (x1 - x0 < 1) continue;
        const h = brickHash(i, j);
        tmp.set(CLUB.bricks[Math.floor(h * CLUB.bricks.length)]!);
        const dx = (x0 + x1) / 2 - mic.x, dy = y - CLUB.spill.y;
        const spill = Math.exp(-(dx * dx + dy * dy) / (CLUB.spill.r * CLUB.spill.r));
        const soot = 1 - 0.55 * Math.min(1, Math.max(0, (y - 70) / (top - 70)));
        const k = (0.55 + CLUB.spill.lift * spill) * soot * (0.88 + 0.24 * brickHash(j, i));
        boxes.push([(x0 + x1) / 2, y, z + (h - 0.5) * 0.4, x1 - x0 - b.joint, b.h - b.joint, b.d, tmp.clone().multiplyScalar(k)]);
      }
    }
    // The mortar behind them.
    boxes.push([0, (ground + top) / 2, z - b.d / 2, half * 2, top - ground, 1, c(CLUB.mortar)]);
    obstacles.push({ x: 0, y: ground, z, r: 4, h: top - ground });
    // The stool: four legs, a footrest, a round-ish seat.
    const sx = mic.x + CLUB.stool.x, sz = mic.z + CLUB.stool.z, sg = terrain(sx, sz), seat = CLUB.stool.seat;
    const wood = c('#3a261b'), steel = c('#55585f');
    for (const [lx, lz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]] as const) boxes.push([sx + lx, sg + seat / 2, sz + lz, 0.8, seat, 0.8, steel]);
    for (const [fx, fz, fw, fd] of [[0, -2.2, 5.2, 0.6], [0, 2.2, 5.2, 0.6], [-2.2, 0, 0.6, 5.2], [2.2, 0, 0.6, 5.2]] as const) boxes.push([sx + fx, sg + seat * 0.35, sz + fz, fw, 0.6, fd, steel]);
    boxes.push([sx, sg + seat + 0.6, sz, 6.4, 1.2, 6.4, wood], [sx, sg + seat + 0.6, sz, 7.2, 0.9, 4.6, wood], [sx, sg + seat + 0.6, sz, 4.6, 0.9, 7.2, wood]);
    obstacles.push({ x: sx, y: sg, z: sz, r: 5, h: seat + 1 });
  }

  // The stand: a weighted base, a pole up to the clip; the mic itself is its own mesh, tipped back toward the mark.
  const mx = mic.x, mz = mic.z + CLUB.mic.ahead, mg = terrain(mx, mz), head = CLUB.mic.head;
  const black = c('#18191d');
  boxes.push([mx, mg + 0.4, mz, 6, 0.8, 6, black], [mx, mg + 0.4, mz, 7, 0.6, 4, black], [mx, mg + 0.4, mz, 4, 0.6, 7, black]);
  boxes.push([mx, mg + (head - 2 - mg) / 2, mz, 0.9, head - 2 - mg, 0.9, c('#2a2c31')]);
  boxes.push([mx, head - 1.6, mz, 1.6, 1.4, 1.6, c('#3a3d44')]);
  obstacles.push({ x: mx, y: mg, z: mz, r: 3.5, h: head - mg + 2 });
  const set = merged(boxes, `STAGE-${kind}`);
  group.add(set);

  const micBoxes: Box[] = [
    [0, 0, 0, 1.3, 1.3, 5, c('#1f2126')], // the handle
    [0, 0, -3.3, 2.4, 2.4, 2.6, c('#c3c7cf')], // the grille, toward the mouth
    [0, 0, -3.3, 2.0, 2.0, 2.9, c('#9ea3ad')],
  ];
  const head3 = merged(micBoxes, 'STAGE-mic-head');
  head3.position.set(mx, head, mz);
  head3.rotation.x = CLUB.mic.tilt; // its grille up and back toward the mark
  head3.updateMatrix();
  group.add(head3);
  return { group, materials: [set.material as MeshBasicMaterial, head3.material as MeshBasicMaterial], obstacles };
}
