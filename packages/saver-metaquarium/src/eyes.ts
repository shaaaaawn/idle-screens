/**
 * Eye life. A fish's eye is a tiny pixel grid — see `eye-grid.ts` for what the
 * survey of the breeds found — so the rig treats it as a DISPLAY. Both eye
 * materials (white and black; they tile the grid between them) run one
 * fragment function that knows the grid and the token's own pattern, and
 * redraws it:
 *
 *   gaze     the pattern's detail (a pupil, or a dark eye's catch-light) a
 *            whole cell toward where the fish is looking — never off the eye
 *   lids     rows closing from top and bottom toward a lash line — drawn in the
 *            eye's own black and white, never any other colour
 *   wide     the pupil a ring bigger
 *   happy    a little ^ where the eye was
 *   smooth   the dori's way, for the minted breeds: the token's own pattern
 *            GLIDES under the eye's fixed outline, a fraction of a cell at a
 *            time (a pupil sliding over an eyeball), each eye on its own
 *            gaze — and no lids, no steps, no lines (fish have no eyelids)
 *
 * Nothing moves: no vertex is touched, so the flush voxel faces cannot fight
 * (the first rig slid and scaled them, and they flashed). It costs no
 * geometry and no draw calls, works on skinned fish (the grid lives in bind
 * space), and steps by whole cells — the way pixel art moves.
 *
 * `eyeMood` decides WHEN, as a pure function of t and the fish's slot.
 */

import { Matrix4, Vector3, Vector4, type BufferGeometry, type Material, type Mesh, type MeshBasicMaterial, type Object3D, type SkinnedMesh } from 'three';
import { analyseEyes, type EyeGrid, type Vec3 } from './eye-grid';

export const MAX_EYES = 4;

export interface EyeRig {
  set(state: EyeState): void;
  /** One signature per eye found (`3x3 ###/#../#..`), for inspect(). */
  grids: readonly EyeGrid[];
}

const EYE_PARS = /* glsl */ `
  uniform vec4 uEyeO[${4}]; uniform vec3 uEyeU[${4}]; uniform vec3 uEyeV[${4}];
  uniform vec4 uEyeG[${4}]; uniform vec4 uEyeS[${4}]; uniform vec4 uEyeLid;
  varying vec3 vEyeP;
  bool mqEyeBit(float bits, int cols, int rows, int x, int y, bool outside) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return outside;
    return ((int(bits) >> (y * cols + x)) & 1) == 1;
  }
  vec3 mqEyeColor(vec3 base) {
    int count = int(uEyeLid.w), e = 0; float near = 1e20;
    for (int i = 0; i < ${4}; i++) {
      if (i >= count) break;
      vec3 c = uEyeO[i].xyz + (uEyeU[i] * uEyeG[i].x + uEyeV[i] * uEyeG[i].y) * (0.5 * uEyeO[i].w);
      float d = distance(vEyeP, c);
      if (d < near) { near = d; e = i; }
    }
    vec3 p = vEyeP - uEyeO[e].xyz; float cell = uEyeO[e].w;
    int cols = int(uEyeG[e].x), rows = int(uEyeG[e].y);
    // The eye material sometimes paints other things (a crab's belly): leave those alone.
    if (near > cell * (0.75 * float(max(cols, rows)) + 1.0)) return base;
    // Where on the grid, in cells, clamped to it (the slab's side faces sit on its edge).
    float fu = clamp(dot(p, uEyeU[e]) / cell, 0.0, float(cols) - 0.001);
    float fv = clamp(dot(p, uEyeV[e]) / cell, 0.0, float(rows) - 0.001);
    int cx = int(floor(fu)), cy = int(floor(fv));
    vec4 s = uEyeS[e];
    int level = int(s.z), mode = int(s.w), top = rows - 1;
    bool dark = uEyeG[e].w > 0.5;
    // Black and white only. A lid is the eye's own majority colour and the
    // lash line the other one, so a shut eye is still this fish's eye.
    vec3 lidC = dark ? vec3(0.0) : vec3(1.0), lineC = dark ? vec3(1.0) : vec3(0.0);
    int lineRow = (rows - 1) / 2;
    int far = max(lineRow, top - lineRow);
    if (mode == 2 && cols >= 3 && rows >= 2) {
      int mid = cols / 2;
      bool arc = (cx == mid && cy == top) || ((cx == mid - 1 || cx == mid + 1) && cy == top - 1);
      return arc ? lineC : lidC;
    }
    // Shut: a light eye keeps a black lash line; a dark eye simply goes dark
    // (a white bar flashing on every blink is the opposite of a closed eye).
    if (level > far || mode == 2) return (cy == lineRow && !dark) ? lineC : lidC;
    // Rows close from the top AND the bottom toward the line, a row a step.
    int away = cy > lineRow ? cy - lineRow : lineRow - cy;
    if (away > far - level) return lidC;
    // The pattern under this point, shifted by the gaze — a whole cell, or
    // (smooth) any fraction of one: the detail glides under the eye's outline.
    int sx = int(floor(fu - s.x)), sy = int(floor(fv - s.y));
    bool black = mqEyeBit(uEyeG[e].z, cols, rows, sx, sy, dark);
    if (mode == 1 && !black && !dark) {
      black = mqEyeBit(uEyeG[e].z, cols, rows, sx - 1, sy, false) || mqEyeBit(uEyeG[e].z, cols, rows, sx + 1, sy, false)
        || mqEyeBit(uEyeG[e].z, cols, rows, sx, sy - 1, false) || mqEyeBit(uEyeG[e].z, cols, rows, sx, sy + 1, false);
    }
    return black ? vec3(0.0) : vec3(1.0);
  }
`;

function trianglesOf(geometry: BufferGeometry, m: Matrix4, start = 0, count = Infinity): number[] {
  const pos = geometry.getAttribute('position'), idx = geometry.index;
  const n = Math.min(idx ? idx.count : pos.count, start + count), out: number[] = [], v = new Vector3();
  for (let i = start; i < n; i++) {
    v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
    out.push(v.x, v.y, v.z);
  }
  return out;
}

/**
 * Find a fish's eyes and turn them into displays. `body` is the cloned model
 * already scaled and yawed under `group`, whose +z is the fish's nose. Returns
 * null when the model has no eye the survey's rules recognise — the materials
 * are then left exactly as they were.
 */
export function rigEyes(group: Object3D, body: Object3D): EyeRig | null {
  group.updateMatrixWorld(true);
  const groupInv = new Matrix4().copy(group.matrixWorld).invert();
  const parts: { mat: MeshBasicMaterial; toGroup: Matrix4 }[] = [];
  const white: number[] = [], black: number[] = [];
  body.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const rigged = new Set<Material>(); // one part per material, however many groups draw it
    // A multi-material mesh is several parts in one geometry: only the
    // GROUPS drawn with an eye material are eye, and each slot is looked at.
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as (Material & MeshBasicMaterial)[];
    const groups = Array.isArray(mesh.material) && mesh.geometry.groups.length
      ? mesh.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    let toGroup: Matrix4 | null = null;
    for (const g of groups) {
      const mat = mats[g.materialIndex ?? 0];
      const kind = mat?.userData.mqEye as 'sclera' | 'pupil' | undefined;
      if (!mat || !kind) continue;
      // Everything is measured in GROUP space; a skinned mesh's vertices live in bind space.
      const skinned = (mesh as unknown as SkinnedMesh).isSkinnedMesh ? (mesh as unknown as SkinnedMesh) : null;
      toGroup ??= skinned
        ? new Matrix4().copy(body.matrix).multiply(skinned.bindMatrix)
        : new Matrix4().multiplyMatrices(groupInv, mesh.matrixWorld);
      (kind === 'pupil' ? black : white).push(...trianglesOf(mesh.geometry, toGroup, g.start, g.count));
      if (!rigged.has(mat)) { rigged.add(mat); parts.push({ mat, toGroup }); }
    }
  });
  if (!parts.length) return null;
  const centre: Vec3 = [0, 0, 0];
  const grids = analyseEyes({ white, black }, centre, [0, 1, 0], [0, 0, 1]).slice(0, MAX_EYES);
  if (!grids.length) return null;

  const pad = <T>(f: (g: EyeGrid) => T, empty: T): T[] => Array.from({ length: MAX_EYES }, (_, i) => (grids[i] ? f(grids[i]!) : empty));
  const shared = {
    uEyeO: { value: pad((g) => new Vector4(g.origin[0], g.origin[1], g.origin[2], g.cell), new Vector4(0, 0, 0, 1)) },
    uEyeU: { value: pad((g) => new Vector3(...g.u), new Vector3(1, 0, 0)) },
    uEyeV: { value: pad((g) => new Vector3(...g.v), new Vector3(0, 1, 0)) },
    uEyeG: { value: pad((g) => new Vector4(g.cols, g.rows, g.black, g.darkEye ? 1 : 0), new Vector4(1, 1, 0, 0)) },
    uEyeS: { value: pad(() => new Vector4(), new Vector4()) },
    uEyeLid: { value: new Vector4(0, 0, 0, grids.length) },
  };
  for (const part of parts) {
    const uEyeM = { value: part.toGroup };
    part.mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared, { uEyeM });
      shader.vertexShader = 'uniform mat4 uEyeM; varying vec3 vEyeP;\n'
        + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vEyeP = (uEyeM * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = EYE_PARS
        + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = mqEyeColor(diffuseColor.rgb);');
    };
    part.mat.customProgramCacheKey = () => 'mq-eye-display-v5';
    part.mat.needsUpdate = true;
  }
  const clampInt = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(v)));
  return {
    grids,
    set(state) {
      grids.forEach((g, i) => {
        const s = shared.uEyeS.value[i]!;
        // A catch-light moves AGAINST the look (the light stays put while the eye turns).
        const k = g.darkEye ? -1 : 1;
        // Smooth: this eye's own gaze, carried all the way to the edge of where
        // the detail can go, at any fraction of a cell. Otherwise whole cells.
        const own = state.smooth ? state.eyes?.[i] : undefined;
        const gf = (own ? own.fwd : state.gazeFwd) * k, gu = (own ? own.up : state.gazeUp) * k;
        const reach = (lo: number, hi: number, v: number): number =>
          Math.min(hi, Math.max(lo, v * (v >= 0 ? hi : -lo)));
        s.x = state.smooth ? reach(g.shiftX[0], g.shiftX[1], gf) : clampInt(gf, g.shiftX[0], g.shiftX[1]);
        s.y = state.smooth ? reach(g.shiftY[0], g.shiftY[1], gu) : clampInt(gu, g.shiftY[0], g.shiftY[1]);
        // Closing steps: rows shut from both ends toward the line row, then the line.
        const lineRow = (g.rows - 1) >> 1, far = Math.max(lineRow, g.rows - 1 - lineRow);
        const mono = g.black === 0 || (g.black & g.present) === g.present;
        s.z = mono ? 0 : Math.round(state.blink * (far + 1));
        // "Wide" grows a PUPIL. An eye that is a glyph has none to grow, and
        // redrawing it would make it someone else's eye.
        const pupil = g.shiftX[0] !== g.shiftX[1] || g.shiftY[0] !== g.shiftY[1];
        s.w = mono || (state.expr === 1 && !pupil) ? 0 : state.expr;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Mood: when the eyes do what. Pure in (t, slot) — deterministic like the swim.
// ---------------------------------------------------------------------------

export interface EyeCue {
  /** What the body is doing: a vignette gesture, 'moving', 'idle', or a swimmer's ''. */
  doing: string;
  /** Unit-ish: where the thing worth looking at is, in the fish's own frame (ahead, up). Null = nothing. */
  target: { fwd: number; up: number } | null;
  /** Same frame: where the camera is. */
  camera: { fwd: number; up: number };
  /** Vertical intent of the swim (-1..1): pupils lead a climb or a dive. */
  climb: number;
}

/** `expr`: 0 open · 1 wide · 2 happy. `dilate`/`widen` are kept for callers that want the analogue values.
 *  `smooth`: the detail glides by fractions of a cell (the minted breeds); `eyes` then gives each eye its own gaze. */
export interface EyeState {
  blink: number; gazeFwd: number; gazeUp: number; dilate: number; widen: number; expr: 0 | 1 | 2;
  smooth?: boolean; eyes?: ReadonlyArray<{ fwd: number; up: number }>;
}

const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const bell = (u: number): number => (u <= 0 || u >= 1 ? 0 : Math.sin(u * Math.PI));
const ease = (u: number): number => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };

export function eyeMood(tSec: number, slot: number, cue: EyeCue, amount: number, out: EyeState): EyeState {
  // Blink: a personal period; one in four is a double.
  const period = 3.1 + hash(slot * 9.7) * 3.6;
  const bt = tSec / period + hash(slot * 3.3);
  const n = Math.floor(bt), into = (bt - n) * period;
  // 0.24 s: long enough that each closing step holds for a few frames.
  let blink = bell(into / 0.24);
  if (hash(n * 5.1 + slot) > 0.75) blink = Math.max(blink, bell((into - 0.4) / 0.24));

  // Idle saccades: hold a point, dart to the next. Steps, not drift — the dart
  // takes ~0.3 s, the hold 2.4–5 s, which is what reads as attention.
  const hold = 2.4 + hash(slot * 1.9) * 2.8;
  const st = tSec / hold + hash(slot * 7.1) * 10;
  const si = Math.floor(st), k = ease((st - si) * hold / 0.28);
  const px = (hash((si - 1) * 2.3 + slot) - 0.5) * 1.2, py = (hash((si - 1) * 4.7 + slot) - 0.5) * 0.8;
  const nx = (hash(si * 2.3 + slot) - 0.5) * 1.2, ny = (hash(si * 4.7 + slot) - 0.5) * 0.8;
  let gx = px + (nx - px) * k, gy = py + (ny - py) * k;

  // No idle "breathing" of the pupil: a shape that never stops changing reads as flicker.
  let dilate = 1, widen = 0;
  const moving = cue.doing === 'moving' || cue.doing === '';
  if (moving) { gx = 0.75 + gx * 0.2; gy = cue.climb * 0.9 + gy * 0.2; } // looks where it is going
  if (cue.target && !moving) { gx = cue.target.fwd * 0.9 + gx * 0.12; gy = cue.target.up * 0.9 + gy * 0.12; }

  // A glance at the camera: every 8–15 s, 1.3 s long, eased in and out.
  const gp = 8 + hash(slot * 6.3) * 7;
  const gl = tSec / gp + hash(slot * 8.9);
  const glance = ease(bell(((gl - Math.floor(gl)) * gp) / 1.3) * 2.2);
  gx += (cue.camera.fwd - gx) * glance; gy += (cue.camera.up - gy) * glance;

  let expr: 0 | 1 | 2 = 0;
  switch (cue.doing) {
    case 'hop': case 'spin': dilate = 1.38; widen = 1; expr = 1; break;
    case 'wiggle': expr = 2; break; // delighted
    case 'talk': dilate = 1.1; break;
    case 'nod': blink = Math.max(blink, 0.34); break; // lids a row down: listening
    case 'shake': dilate = 0.82; break;
    case 'peek': widen = 0.7; expr = 1; gx = Math.sin(tSec * 2.4) * 0.9; break;
    case 'bow': gy = -0.9; blink = 1; break;
    case 'rest': blink = 1; break; // asleep
  }
  const c = (v: number): number => Math.min(1, Math.max(-1, v));
  out.blink = blink * amount;
  out.gazeFwd = c(gx) * amount; out.gazeUp = c(gy) * amount;
  out.dilate = 1 + (dilate - 1) * amount; out.widen = widen * amount;
  out.expr = amount > 0.5 ? expr : 0;
  return out;
}

// ---------------------------------------------------------------------------
// Looking, the dori's way (tang.ts tangLook), for the minted breeds' eyes.
// ---------------------------------------------------------------------------

export type MintedLookAt = 'wander' | 'viewer' | 'ahead';

export interface MintedLookCue {
  /** Where the camera is, in the fish's frame (as EyeCue.camera). */
  camera: { fwd: number; up: number };
  /** Its turn (radians of heading per body length, + to its left): the eyes lead it. */
  turn: number;
  /** 0..1: how hard it is swimming — a cruising fish looks where it is going. */
  cruise: number;
}

/**
 * Where each eye looks at `t`: saccades about the water (a quick dart, then
 * still), bouts of holding the viewer's eye — the second eye a beat behind
 * the first, a double take — and, swimming, a lead into its turn. No blinks:
 * a fish has no eyelids. Pure in (slot, t), and continuous: every change is a
 * short eased glide, never a step.
 */
export function mintedLook(slot: number, t: number, cue: MintedLookCue, out: Array<{ fwd: number; up: number }>): MintedLookAt {
  // Saccades: hold 0.7–2.6 s, dart in 0.12 s to the next hashed point.
  const hold = 0.7 + hash(slot * 2.9) * 1.9;
  const st = t / hold + hash(slot * 6.1) * 10;
  const si = Math.floor(st), k = ease(((st - si) * hold) / 0.12);
  const at = (n: number, salt: number): number => (hash(n * salt + slot * 1.3) - 0.5) * 2;
  let wx = at(si - 1, 2.3) + (at(si, 2.3) - at(si - 1, 2.3)) * k;
  let wy = 0.6 * (at(si - 1, 4.7) + (at(si, 4.7) - at(si - 1, 4.7)) * k);
  // Swimming, the eyes lead the way: ahead, and into the turn.
  const lead = Math.min(1, cue.cruise);
  wx += (0.55 + 0.35 * Math.max(-1, Math.min(1, cue.turn * 2.5)) - wx) * 0.6 * lead;
  wy *= 1 - 0.5 * lead;
  // The viewer: the second eye arrives 0.18 s after the first and leaves
  // 0.18 s after it — a double take.
  let viewing = false;
  for (let i = 0; i < out.length; i++) {
    const w = mintedViewer(slot, t - (i === 1 ? 0.18 : 0));
    if (w > 0.5) viewing = true;
    const c = (v: number): number => Math.min(1, Math.max(-1, v));
    out[i] = { fwd: c(wx + (cue.camera.fwd - wx) * w), up: c(wy + (cue.camera.up - wy) * w) };
  }
  return viewing ? 'viewer' : lead > 0.5 ? 'ahead' : 'wander';
}

/**
 * When a minted fish holds the viewer's eye: every 7–14 s, for 1.6–3 s, eased
 * in and out over 0.15 s. 0..1, pure in (slot, t). The eyes (mintedLook) and
 * a rig's head (angel.ts) both answer to it, so the head turns with the look.
 */
export function mintedViewer(slot: number, t: number, ramp = 0.15): number {
  const vp = 7 + hash(slot * 3.7) * 7;
  const vt = t / vp + hash(slot * 9.2);
  const vi = Math.floor(vt), into = (vt - vi) * vp, lasts = 1.6 + hash(vi * 1.9 + slot) * 1.4;
  return ease(into / ramp) * (1 - ease((into - lasts) / ramp));
}
