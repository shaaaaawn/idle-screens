/**
 * The dolphin's cast: comics. EXPERIMENTAL.
 *
 * One dolphin model, several characters — each still very much a dolphin, each with an act of its own you
 * can read from across the room before it says a word. Original characters, written as stage TYPES (a
 * buttoned-up storyteller who works the whole stage; a sun-bleached drifter who talks slow and slouches; a
 * big easy deadpan who barely moves), never anyone's name or likeness.
 *
 *   look     its own skin (the SKIN- materials recoloured: cape, back, flank, belly), its finish (glossy,
 *            matte, plain), a shirt tinted into its vertices round the chest (the baked occlusion's
 *            vertex colours, which the skin multiplies in), and a prop riding a bone — a tie on the
 *            chest, a trucker cap on the head
 *   act      how it performs (dolphin.ts reads this): the tempo of its gestures, how big they are, how
 *            far it slouches and leans when it stands, how heavy its lids hang
 *
 * `dolphinCast` names them, in the order the dolphins come in `fishMix`.
 */
import { BoxGeometry, BufferAttribute, Color, Mesh, MeshStandardMaterial, Vector3, type BufferGeometry, type Material, type Object3D, type SkinnedMesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const DOLPHIN_PERSONAS = ['classic', 'showman', 'drifter', 'bigguy', 'host'] as const;
export type DolphinPersonaId = (typeof DOLPHIN_PERSONAS)[number];

export interface DolphinAct {
  /** Its gestures' tempo (× the clip's). */
  tempo: number;
  /** How big its gestures are (1: as the clip; under 1, subtler; over, bigger and longer held). */
  energy: number;
  /** Extra forward curl when it stands (radians per spine bone, the tail most): a slouch. */
  slouch: number;
  /** A sideways lean of its body when it stands, and its head tipped against it (radians). */
  lean: number;
  /** 0..1: its lids, half down at 0.5 (a drowsy drawl), never fully shut. */
  lids: number;
}

export interface DolphinPersona {
  id: DolphinPersonaId;
  label: string;
  /** Its skin, by part: the SKIN- material colours it replaces. */
  skin: { cape: string; back: string; flank: string; belly: string } | null;
  /** Its finish when the tank is lit and polished. */
  finish: { roughness: number; metalness: number; envMapIntensity: number } | null;
  /** A shirt round its chest (a colour multiplied into the skin there), or none. */
  shirt: string | null;
  /** A flannel's dark check over the shirt, or none: the side a standing comic shows its audience is its chest. */
  plaid?: string;
  /** A tie down its chest, or none. */
  tie: string | null;
  /** A bow tie at its throat, or none. */
  bowtie?: string;
  /** A trucker cap: crown front, crown back and brim, or none. */
  cap: { front: string; back: string } | null;
  /** Its size (× the breed's). */
  size: number;
  act: DolphinAct;
}

const CLASSIC_ACT: DolphinAct = { tempo: 1, energy: 1, slouch: 0, lean: 0, lids: 0 };

export const PERSONAS: Readonly<Record<DolphinPersonaId, DolphinPersona>> = {
  classic: { id: 'classic', label: 'The dolphin', skin: null, finish: null, shirt: null, tie: null, cap: null, size: 1, act: CLASSIC_ACT },
  // Buttoned up and wound up: a navy suit (a dark glossy cape over a crisp white shirt-front), a red tie,
  // and an act that works the whole stage — quick, big, upright.
  showman: {
    id: 'showman', label: 'The Showman',
    skin: { cape: '#1c2b4a', back: '#121c33', flank: '#2a3d63', belly: '#f3f5fa' },
    finish: { roughness: 0.3, metalness: 0.2, envMapIntensity: 1.0 },
    shirt: null, tie: '#d0283a', cap: null, size: 1,
    act: { tempo: 1.35, energy: 1.25, slouch: -0.05, lean: 0, lids: 0 },
  },
  // Sun-bleached and easy: a sandy, matte skin, a faded flannel, a two-tone trucker cap, heavy lids, a slow
  // drawl, a slouch and a lean like it is propped on a bar. Tanned deeper than it reads: under a stage spot
  // its first coat (cream belly, pale sand flank) was all an audience saw, a white dolphin.
  drifter: {
    id: 'drifter', label: 'The Drifter',
    skin: { cape: '#8c6a40', back: '#6e532f', flank: '#a5844f', belly: '#c4a878' },
    finish: { roughness: 0.8, metalness: 0, envMapIntensity: 0.25 },
    shirt: '#a8321f', plaid: '#241a16', tie: null, cap: { front: '#f4efe2', back: '#c8402c' }, size: 0.95,
    act: { tempo: 0.72, energy: 0.95, slouch: 0.12, lean: 0.2, lids: 0.5 },
  },
  // Big and unbothered: a stocky slate-grey dolphin in a dark tee, gestures small and slow, a deadpan
  // that lets the line do the work.
  bigguy: {
    id: 'bigguy', label: 'The Big Guy',
    skin: { cape: '#5b6a7e', back: '#48566a', flank: '#72839a', belly: '#d2d9e1' },
    finish: { roughness: 0.6, metalness: 0.05, envMapIntensity: 0.5 },
    shirt: '#30343b', tie: null, cap: null, size: 1.3,
    act: { tempo: 0.85, energy: 0.55, slouch: 0.06, lean: 0.05, lids: 0.2 },
  },
  // The emcee: the dolphin itself, as it always is, in a black bow tie — bright, quick, warm, up on its tail
  // to bring each comic on and to send them off.
  host: {
    id: 'host', label: 'The Host',
    skin: null, finish: null, shirt: null, tie: null, bowtie: '#14161b', cap: null, size: 1,
    act: { tempo: 1.15, energy: 1.1, slouch: -0.03, lean: 0, lids: 0 },
  },
};

/** `dolphinCast` → a persona per dolphin, in the order they come in the mix (unknown names: classic). */
export function parseDolphinCast(cast: string): DolphinPersonaId[] {
  return cast.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    .map((s) => ((DOLPHIN_PERSONAS as readonly string[]).includes(s) ? (s as DolphinPersonaId) : 'classic'));
}

/** The SKIN- parts by their authored colour (rig/dolphin-model.mjs: CAPE, BACK, FLANK, BELLY). */
const SKIN_PART: Readonly<Record<string, keyof NonNullable<DolphinPersona['skin']>>> = {
  'SKIN-#1f6fd1': 'cape', 'SKIN-#1858b4': 'back', 'SKIN-#3f8fe6': 'flank', 'SKIN-#d9ecfa': 'belly',
};

/** The dolphin's chest, in its own frame (nose +z): where a tie hangs and a shirt reaches. */
const CHEST = { z0: 2, z1: 17 } as const;

/**
 * Dress a freshly rigged, freshly materialled dolphin body (identity transform) as `persona`: its skin, its
 * finish, its shirt, its props. `bone` finds a spine bone by name (a prop rides it). Returns the props made.
 */
export function dressDolphin(body: Object3D, persona: DolphinPersona, bone: (name: string) => Object3D | undefined): Object3D[] {
  if (persona.id === 'classic') return [];
  body.updateMatrixWorld(true);
  const meshes: SkinnedMesh[] = [];
  body.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh); });
  for (const mesh of meshes) {
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
    for (const m of mats) {
      const part = SKIN_PART[m.name];
      if (!part || !persona.skin) continue;
      const std = m as MeshStandardMaterial;
      std.color?.set(persona.skin[part]);
      if (persona.finish && std.isMeshStandardMaterial) {
        std.roughness = persona.finish.roughness; std.metalness = persona.finish.metalness; std.envMapIntensity = persona.finish.envMapIntensity;
      }
    }
    // A shirt: the chest's vertex colours (its baked occlusion) multiplied by the shirt's colour, on a copy
    // of the geometry (the template's is every dolphin's).
    const colors = mesh.geometry.getAttribute('color');
    if (persona.shirt && colors && mats.some((m) => SKIN_PART[m.name])) {
      const g = mesh.geometry.clone();
      g.userData.mqOwned = true;
      const pos = g.getAttribute('position'), col = g.getAttribute('color') as BufferAttribute;
      const shirt = new Color(persona.shirt), check = new Color(persona.plaid ?? persona.shirt), v = new Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.z < CHEST.z0 || v.z > CHEST.z1) continue;
        // A flannel's check: dark bands two cubes apart along it and across it, darkest where they cross.
        const bands = persona.plaid ? (Math.floor(v.z / 2) % 2 === 0 ? 1 : 0) + (Math.floor((v.x + 50) / 2) % 2 === 0 ? 1 : 0) : 0;
        const tint = bands ? shirt.clone().lerp(check, bands * 0.5) : shirt;
        // Brightened so the skin's own colour still tells under the shirt a little (a tee, not a hole).
        col.setXYZ(i, col.getX(i) * (tint.r * 1.6 + 0.08), col.getY(i) * (tint.g * 1.6 + 0.08), col.getZ(i) * (tint.b * 1.6 + 0.08));
      }
      col.needsUpdate = true;
      mesh.geometry = g;
    }
  }
  const props: Object3D[] = [];
  const surface = surfaceOf(meshes);
  if (persona.tie) {
    const tie = voxels(tieCells(surface), persona.tie, 'PROP-Tie');
    const host = bone('body');
    if (host) { host.attach(tie); props.push(tie); }
  }
  if (persona.bowtie) {
    const bow = voxels(bowtieCells(surface), persona.bowtie, 'PROP-Bowtie');
    const host = bone('body');
    if (host) { host.attach(bow); props.push(bow); }
  }
  if (persona.cap) {
    const cap = capOf(surface, persona.cap.front, persona.cap.back);
    const host = bone('head');
    if (host) { host.attach(cap); props.push(cap); }
  }
  return props;
}

/** The body's top and bottom along its length (bind pose, its own frame), from its vertices. */
interface Surface { top(z: number): number; bottom(z: number): number }
function surfaceOf(meshes: SkinnedMesh[]): Surface {
  const top = new Map<number, number>(), bottom = new Map<number, number>();
  const v = new Vector3();
  for (const m of meshes) {
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (Math.abs(v.x) > 2.5) continue; // the midline: not a flipper, not the flank
      const k = Math.round(v.z / 2);
      top.set(k, Math.max(top.get(k) ?? -Infinity, v.y));
      bottom.set(k, Math.min(bottom.get(k) ?? Infinity, v.y));
    }
  }
  const at = (map: Map<number, number>, z: number, fallback: number): number => map.get(Math.round(z / 2)) ?? fallback;
  return { top: (z) => at(top, z, 10), bottom: (z) => at(bottom, z, 0) };
}

type Cell = [x: number, y: number, z: number, color?: string, height?: number];

/** A tie down the chest, hanging just proud of the belly: a knot at the throat, a blade, a point. */
function tieCells(s: Surface): Cell[] {
  const cells: Cell[] = [];
  const at = (z: number, xs: number[]): void => { for (const x of xs) cells.push([x, s.bottom(z) - 0.9, z]); };
  at(16, [-2, 0, 2]); // the knot
  for (const z of [14, 12, 10]) at(z, [0]);
  for (const z of [8, 6]) at(z, [-2, 0, 2]);
  at(4, [0]); // the point
  return cells;
}

/** A bow tie at the throat, just proud of the belly: a knot and two wings, each flaring out from it. */
function bowtieCells(s: Surface): Cell[] {
  const z = 17, y = s.bottom(z) - 1;
  const cells: Cell[] = [[0, y, z]];
  for (const side of [-1, 1]) {
    cells.push([side * 2, y, z, undefined, 2.4], [side * 4, y, z, undefined, 3.4]);
  }
  return cells;
}

/** A trucker cap on the head, big enough to read across a room: a crown over the eyes and melon (a pale
 *  front panel, a coloured mesh back, three cubes tall at the middle), and a deep flat brim out over the
 *  beak. (Its first cut, two cubes over the melon, read as a few stray cubes.) */
function capOf(s: Surface, front: string, back: string): Object3D {
  const cells: Cell[] = [];
  const crown = [12, 14, 16, 18, 20, 22, 24];
  const base = Math.max(...crown.map((z) => s.top(z))) - 1.2; // seated down over the head, not perched on its highest point
  for (const z of crown) {
    const col = z >= 20 ? front : back;
    for (const x of [-6, -4, -2, 0, 2, 4, 6]) {
      if (s.top(z) < base - 4 && Math.abs(x) > 4) continue;
      cells.push([x, base, z, col]);
      if (Math.abs(x) <= 4) cells.push([x, base + 2, z, col]);
      if (Math.abs(x) <= 2 && z >= 14 && z <= 22) cells.push([x, base + 4, z, col]);
    }
  }
  // The button on top, and the brim: deep, flat, out over the beak.
  cells.push([0, base + 5.4, 18, back, 0.8]);
  for (const z of [26, 28, 30]) for (const x of [-6, -4, -2, 0, 2, 4, 6]) {
    if (z === 30 && Math.abs(x) > 4) continue;
    cells.push([x, base - 0.6, z, back, 0.8]);
  }
  return voxels(cells, back, 'PROP-Cap');
}

/** A prop of 2-unit cubes (a brim's are flat slabs), its colours in one mesh (vertex colours). */
function voxels(cells: Cell[], color: string, name: string): Mesh {
  const parts: BufferGeometry[] = [];
  for (const [x, y, z, c, h] of cells) {
    const g = new BoxGeometry(2, h ?? 2, 2).toNonIndexed();
    g.translate(x, y, z);
    const col = new Color(c ?? color), n = g.getAttribute('position').count;
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { rgb[i * 3] = col.r; rgb[i * 3 + 1] = col.g; rgb[i * 3 + 2] = col.b; }
    g.setAttribute('color', new BufferAttribute(rgb, 3));
    parts.push(g);
  }
  const geometry = mergeGeometries(parts)!;
  geometry.userData.mqOwned = true;
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0 });
  material.name = name;
  material.userData.mqOwned = true;
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}
