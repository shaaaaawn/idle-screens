/**
 * What an eye IS, measured from the model. (`scripts/mq/eye-survey.mjs` in the
 * mono is the survey this came out of — 15 tokens across the four minted
 * breeds plus the NPC set.)
 *
 * Every minted fish wears its eyes as a tiny PIXEL GRID: a slab one voxel
 * deep on each side of the head — 3×3 on a betafish or a seahorse, 3×2 on an
 * angelfish, 2×2 on a sea turtle — whose cells are either the EYE-WHITE
 * material or the EYE-BLACK one. Which cells are which is the token's own eye:
 * #180 is a black 3×2 over a white row, #100 a black eye with an L of
 * catch-light, #456 has split pupils that differ left to right. The two
 * materials tile the grid exactly and sit flush with the head, which is why
 * moving their vertices made them flash.
 *
 * So this module does not deform anything. It recovers, per eye, the grid —
 * origin, axes, cell size, columns × rows — and the pattern as a bitmask, so a
 * shader can treat the eye as a small display and redraw the token's own
 * pattern with the pupil a cell over, a lid a row down, or an expression in
 * its place. Pure math on plain arrays: no three.js, testable with synthetic
 * slabs.
 */

export type Vec3 = [number, number, number];

export interface EyeGrid {
  /** The grid's low corner on the outward face, in the space the triangles came in. */
  origin: Vec3;
  /** Toward the nose, along the eye. */ u: Vec3;
  /** Up the eye. */ v: Vec3;
  /** Out of the head. */ n: Vec3;
  cell: number;
  cols: number;
  rows: number;
  /** Bit `row * cols + col` set = that cell is black. Row 0 is the bottom. */
  black: number;
  /** Bit set = the model has an eye voxel there at all (grids can be notched). */
  present: number;
  /** True when black is the majority: a dark eye whose DETAIL is its white catch-light. */
  darkEye: boolean;
  /** How far the detail can move before it leaves the eye: cells, [min, max]. */
  shiftX: [number, number];
  shiftY: [number, number];
  /** `3x3 ###/#../#..` — rows top to bottom, `#` black `.` white `_` absent. For inspect() and tests. */
  signature: string;
}

export interface EyeSoup {
  /** Flat xyz per vertex, three vertices per triangle. */
  white: ArrayLike<number>;
  black: ArrayLike<number>;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

interface Tri { a: Vec3; b: Vec3; c: Vec3; n: Vec3; area: number; black: boolean; comp: number }

/** Largest grid a float uniform can carry as an exact bitmask, with room to spare. */
export const MAX_EYE_CELLS = 20;

export function analyseEyes(soup: EyeSoup, fishCentre: Vec3, up: Vec3, fwd: Vec3): EyeGrid[] {
  const tris: Tri[] = [];
  const read = (arr: ArrayLike<number>, black: boolean): void => {
    for (let i = 0; i + 8 < arr.length; i += 9) {
      const a: Vec3 = [arr[i]!, arr[i + 1]!, arr[i + 2]!], b: Vec3 = [arr[i + 3]!, arr[i + 4]!, arr[i + 5]!], c: Vec3 = [arr[i + 6]!, arr[i + 7]!, arr[i + 8]!];
      const x = cross(sub(b, a), sub(c, a)), area = len(x) / 2;
      if (area > 1e-12) tris.push({ a, b, c, n: norm(x), area, black, comp: -1 });
    }
  };
  read(soup.white, false); read(soup.black, true);
  if (!tris.length) return [];

  // The voxel: the shortest edge anywhere in the eyes.
  let voxel = Infinity;
  for (const t of tris) for (const [p, q] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as const) {
    const d = len(sub(p, q)); if (d > 1e-6 && d < voxel) voxel = d;
  }
  if (!Number.isFinite(voxel)) return [];

  // One eye = one connected lump of white + black (they share corners). Weld and union.
  const q = voxel / 40, ids = new Map<string, number>(), parent: number[] = [];
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const vid = (p: Vec3): number => {
    const k = `${Math.round(p[0] / q)},${Math.round(p[1] / q)},${Math.round(p[2] / q)}`;
    let i = ids.get(k); if (i === undefined) { i = parent.length; ids.set(k, i); parent.push(i); } return i;
  };
  const corner = tris.map((t) => [vid(t.a), vid(t.b), vid(t.c)] as const);
  corner.forEach(([a, b, c]) => { parent[find(a)] = find(b); parent[find(b)] = find(c); });
  // Greedy-meshed voxels do not always share corners (a big white quad beside
  // a small black one meets it at a T-junction), so lumps that TOUCH are one
  // eye too: union any two with a vertex within a third of a voxel of the other.
  const pointsOf = new Map<number, Vec3[]>();
  tris.forEach((t, i) => { const r = find(corner[i]![0]); (pointsOf.get(r) ?? pointsOf.set(r, []).get(r)!).push(t.a, t.b, t.c); });
  const roots = [...pointsOf.keys()], reach = voxel * 0.34;
  // By real distance, not by bounding box: on a turned head (a sea turtle's)
  // boxes are fat and would swallow the nostril that sits between the eyes.
  // Euclidean, not per axis — a per-axis box reaches √3 further on the
  // diagonal, which is where a nostril sits.
  const reach2 = reach * reach;
  const near = (A: Vec3[], B: Vec3[]): boolean => A.some((p) => B.some((q2) => {
    const dx = p[0] - q2[0], dy = p[1] - q2[1], dz = p[2] - q2[2];
    return dx * dx + dy * dy + dz * dz < reach2;
  }));
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) {
    if (find(roots[i]!) !== find(roots[j]!) && near(pointsOf.get(roots[i]!)!, pointsOf.get(roots[j]!)!)) parent[find(roots[i]!)] = find(roots[j]!);
  }
  const comps = new Map<number, Tri[]>();
  tris.forEach((t, i) => { const r = find(corner[i]![0]); (comps.get(r) ?? comps.set(r, []).get(r)!).push(t); });

  // Which way is OUT of the head? For a pair of eyes it is simply away from
  // the point between them — truer than "away from the model's centre", which
  // is forward as much as sideways for eyes near the nose, and wrong outright
  // for a turned head (a sea turtle's). Only eye-sized lumps vote.
  const small: { c: Vec3; size: number; mono: boolean; lump: Tri[] }[] = [];
  for (const lump of comps.values()) {
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    let hasB = false, hasW = false;
    for (const t of lump) { if (t.black) hasB = true; else hasW = true; for (const p of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]!); hi[k] = Math.max(hi[k]!, p[k]!); } }
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    if (size <= voxel * 6.5) small.push({ c: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], size, mono: !(hasB && hasW), lump });
  }
  const mid: Vec3 = small.length >= 2
    ? scale(small.reduce<Vec3>((m, e) => [m[0] + e.c[0], m[1] + e.c[1], m[2] + e.c[2]], [0, 0, 0]), 1 / small.length)
    : fishCentre;

  const grids: EyeGrid[] = [];
  for (const entry of small) {
    const lump = entry.lump;
    // A one-colour lump is an eye only if it has a twin (a glowfish's two black
    // cubes). Alone, it is a mouth or a stripe that wears the eye material.
    if (entry.mono && !small.some((o) => o !== entry && o.mono && Math.abs(o.size - entry.size) < voxel * 0.3 && len(sub(o.c, entry.c)) > voxel)) continue;
    const centre: Vec3 = [0, 0, 0]; let total = 0;
    const cw: Vec3 = [0, 0, 0], cb: Vec3 = [0, 0, 0]; let aw = 0, ab = 0;
    for (const t of lump) {
      const m = scale([t.a[0] + t.b[0] + t.c[0], t.a[1] + t.b[1] + t.c[1], t.a[2] + t.b[2] + t.c[2]], t.area / 3);
      centre[0] += m[0]; centre[1] += m[1]; centre[2] += m[2]; total += t.area;
      const into = t.black ? cb : cw; into[0] += m[0]; into[1] += m[1]; into[2] += m[2];
      if (t.black) ab += t.area; else aw += t.area;
    }
    const c = scale(centre, 1 / total);
    // Which way does this eye face? A slab's flat side is its biggest face —
    // true whichever way the head is turned (a sea turtle's is, 30°) and
    // wherever the eyes sit (on the sides of a betafish, on the FRONT of a
    // blowfish, like a face). Winding is not trusted either: a mirrored half
    // (one side of every angelfish) is wound backwards, so faces are pooled
    // by axis, ±n together, and the sign is settled afterwards.
    const fromMid = sub(c, mid), fromFish = sub(c, fishCentre);
    const faces = new Map<string, { n: Vec3; area: number }>();
    for (const t of lump) {
      let tn = t.n;
      const lead = Math.abs(tn[0]) > 0.5 ? tn[0] : Math.abs(tn[1]) > 0.5 ? tn[1] : tn[2];
      if (lead < 0) tn = scale(tn, -1);
      const k = `${Math.round(tn[0] * 8)},${Math.round(tn[1] * 8)},${Math.round(tn[2] * 8)}`;
      const f = faces.get(k); if (f) f.area += t.area; else faces.set(k, { n: tn, area: t.area });
    }
    if (!faces.size) continue;
    // A cube eye (a crab's) has no flat side: its pupil says which face is the front.
    const hint = ab > 0 && aw > 0 ? sub(scale(cb, 1 / ab), scale(cw, 1 / aw)) : ([0, 0, 0] as Vec3);
    const hl = len(hint) > voxel * 0.2 ? norm(hint) : null;
    const lean = len(fromMid) > voxel * 0.5 ? norm(fromMid) : norm(fromFish);
    let best: { n: Vec3; area: number } | null = null, bestScore = -Infinity;
    // The eye faces along its THIN axis. Not "its biggest face": a betafish
    // is built of whole cubes with every inner face kept, so every axis has
    // the same area. Thickness is measured along each face direction the lump
    // actually has, so it holds for a turned head too. Hints only break ties
    // (a cube eye, as thick as it is wide).
    const spans = [...faces.values()].map((f) => {
      let lo = Infinity, hi = -Infinity;
      for (const t of lump) for (const p of [t.a, t.b, t.c]) { const d = dot(p, f.n); lo = Math.min(lo, d); hi = Math.max(hi, d); }
      return { f, span: hi - lo };
    }).sort((p, q2) => p.span - q2.span);
    const tied = spans.filter((e) => e.span < spans[0]!.span * 1.3 + voxel * 0.1).map((e) => e.f);
    for (const f of tied) {
      const score = tied.length === 1 ? 1
        : (1 + (hl ? Math.abs(dot(f.n, hl)) : 0)) * (1 - 0.5 * Math.abs(dot(f.n, up))) * (1 + 0.15 * Math.abs(dot(f.n, lean)));
      if (score > bestScore) { bestScore = score; best = f; }
    }
    let axis = best!.n;
    const side = tied.length > 1 && hl && Math.abs(dot(axis, hl)) > 0.5 ? dot(axis, hl)
      : Math.abs(dot(axis, fromMid)) > 0.3 * len(fromMid) && len(fromMid) > voxel * 0.5 ? dot(axis, fromMid) : dot(axis, fromFish);
    if (side < 0) axis = scale(axis, -1);
    best = { n: axis, area: best!.area };
    const n = best!.n;
    let v = sub(up, scale(n, dot(up, n)));
    if (len(v) < 0.2) v = sub(fwd, scale(n, dot(fwd, n))); // eyes on top of the head
    v = norm(v);
    let u = norm(cross(v, n));
    if (dot(u, fwd) < 0) u = scale(u, -1);

    // The front face: triangles facing n, on the outermost plane.
    let maxD = -Infinity;
    for (const t of lump) if (Math.abs(dot(t.n, n)) > 0.9) maxD = Math.max(maxD, dot(t.a, n));
    const face = lump.filter((t) => Math.abs(dot(t.n, n)) > 0.9 && dot(t.a, n) > maxD - voxel * 0.3);
    if (!face.length) continue;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const t of face) for (const p of [t.a, t.b, t.c]) {
      const pu = dot(p, u), pv = dot(p, v);
      u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
    }
    const cols = Math.max(1, Math.round((u1 - u0) / voxel)), rows = Math.max(1, Math.round((v1 - v0) / voxel));
    // Not an eye: a belly plate or a stripe that happens to wear the eye material.
    if (cols > 5 || rows > 5 || cols * rows > MAX_EYE_CELLS) continue;
    const cell = Math.max((u1 - u0) / cols, (v1 - v0) / rows);

    const inside = (px: number, py: number, t: Tri): boolean => {
      const ax = dot(t.a, u), ay = dot(t.a, v), bx = dot(t.b, u), by = dot(t.b, v), cx = dot(t.c, u), cy = dot(t.c, v);
      const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
      const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
      const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    };
    let black = 0, present = 0, nb = 0, nw = 0;
    let bx0 = cols, bx1 = -1, by0 = rows, by1 = -1, wx0 = cols, wx1 = -1, wy0 = rows, wy1 = -1;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const px = u0 + (k + 0.5) * cell, py = v0 + (r + 0.5) * cell;
      const hit = face.find((t) => inside(px, py, t));
      if (!hit) continue;
      const bit = 1 << (r * cols + k);
      present |= bit;
      if (hit.black) { black |= bit; nb++; bx0 = Math.min(bx0, k); bx1 = Math.max(bx1, k); by0 = Math.min(by0, r); by1 = Math.max(by1, r); }
      else { nw++; wx0 = Math.min(wx0, k); wx1 = Math.max(wx1, k); wy0 = Math.min(wy0, r); wy1 = Math.max(wy1, r); }
    }
    if (!present) continue;
    const darkEye = nb > nw;
    // The DETAIL is the minority colour; it may travel until it touches the rim.
    // …but only a real PUPIL looks around. Most minted eyes are a glyph (the token's `eyes` trait is
    // an ASCII character drawn in voxels — `%`, `#`, `x`); sliding a glyph a
    // cell over turns it into a different one, so those blink and emote only.
    const detailBits = (darkEye ? present & ~black : black) >>> 0, count = darkEye ? nw : nb;
    let blob = 0;
    if (count > 0) {
      const start = detailBits & -detailBits; let seen = start, frontier = start;
      while (frontier) {
        let next = 0;
        for (let bit = 0; bit < cols * rows; bit++) if (frontier & (1 << bit)) {
          const k = bit % cols;
          for (const nb2 of [k > 0 ? bit - 1 : -1, k < cols - 1 ? bit + 1 : -1, bit - cols, bit + cols]) {
            if (nb2 >= 0 && nb2 < cols * rows && detailBits & (1 << nb2) && !(seen & (1 << nb2))) { seen |= 1 << nb2; next |= 1 << nb2; }
          }
        }
        frontier = next;
      }
      for (let bit = 0; bit < cols * rows; bit++) if (seen & (1 << bit)) blob++;
    }
    // …one blob, a FILLED rectangle (a 2×2 pupil, a 1×2 slit — not an L or a
    // diagonal), and no more than half the eye.
    const [rx0, rx1, ry0, ry1] = darkEye ? [wx0, wx1, wy0, wy1] : [bx0, bx1, by0, by1];
    const some = count > 0 && blob === count && (rx1 - rx0 + 1) * (ry1 - ry0 + 1) === count && count * 2 <= nb + nw;
    const [dx0, dx1, dy0, dy1] = darkEye ? [wx0, wx1, wy0, wy1] : [bx0, bx1, by0, by1];
    // A notched eye (a cell missing inside the cols×rows rectangle, not just
    // outside it) can leave `present` with holes the [0, cols) / [0, rows)
    // bound above doesn't see. Shrink each direction to the first step where
    // any translated detail cell would land off the actual shape, not just
    // off the grid — the shader has no fallback for "inside the rectangle
    // but not part of this eye".
    const maxStep = (dx: number, dy: number): number => {
      let m = 0;
      stepping: for (let step = 1; ; step += 1) {
        for (let y = dy0; y <= dy1; y += 1) {
          for (let x = dx0; x <= dx1; x += 1) {
            const tx = x + dx * step, ty = y + dy * step;
            if (tx < 0 || tx >= cols || ty < 0 || ty >= rows || !((present >>> (ty * cols + tx)) & 1)) break stepping;
          }
        }
        m = step;
      }
      return m;
    };
    const shiftX: [number, number] = some ? [-maxStep(-1, 0) || 0, maxStep(1, 0)] : [0, 0];
    const shiftY: [number, number] = some ? [-maxStep(0, -1) || 0, maxStep(0, 1)] : [0, 0];
    const lines: string[] = [];
    for (let r = rows - 1; r >= 0; r--) {
      let s = '';
      for (let k = 0; k < cols; k++) { const bit = 1 << (r * cols + k); s += !(present & bit) ? '_' : black & bit ? '#' : '.'; }
      lines.push(s);
    }
    const origin: Vec3 = [
      u[0] * u0 + v[0] * v0 + n[0] * maxD, u[1] * u0 + v[1] * v0 + n[1] * maxD, u[2] * u0 + v[2] * v0 + n[2] * maxD,
    ];
    grids.push({ origin, u, v, n, cell, cols, rows, black, present, darkEye, shiftX, shiftY, signature: `${cols}x${rows} ${lines.join('/')}` });
  }
  return grids;
}
