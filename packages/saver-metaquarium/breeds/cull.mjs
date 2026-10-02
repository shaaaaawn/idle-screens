// Voxel-face helpers shared by the intake and its tests (the intake itself is a
// top-level-await script, so it cannot be imported).

/** Triangles of a primitive as corner arrays. */
export function trianglesOf(p) {
  const pos = p.getAttribute('POSITION'), idx = p.getIndices();
  const n = idx ? idx.getCount() : pos.getCount(); const out = [];
  for (let t = 0; t < n / 3; t++) out.push([0, 1, 2].map((k) => pos.getElement(idx ? idx.getScalar(t * 3 + k) : t * 3 + k, [])));
  return out;
}

/** The joint each triangle is skinned to, or null for no rig. A rigid part's
 *  triangle rides one joint at weight 1; a triangle that BLENDS (the shark's
 *  spine bends across a zone at each joint) is -1, and passes through the
 *  intake exactly as authored. */
export function jointsOf(p) {
  const j = p.getAttribute('JOINTS_0'), w = p.getAttribute('WEIGHTS_0'); if (!j) return null;
  const idx = p.getIndices(); const n = idx ? idx.getCount() : j.getCount(); const out = [];
  for (let t = 0; t < n / 3; t++) {
    const ids = [0, 1, 2].map((k) => (idx ? idx.getScalar(t * 3 + k) : t * 3 + k));
    const js = ids.map((i) => j.getElement(i, [])[0]);
    // Rigid = slot 0 carries the whole weight; any secondary influence is a blend.
    const rigid = js[1] === js[0] && js[2] === js[0] && ids.every((i) => { const e = w.getElement(i, []); return Math.abs(e[0] - 1) < 1e-3 && e[1] < 1e-3 && e[2] < 1e-3 && e[3] < 1e-3; });
    out.push(rigid ? js[0] : -1);
  }
  return out;
}

/** The joint each triangle mostly rides (its first corner's heaviest). */
export function dominantOf(p) {
  const j = p.getAttribute('JOINTS_0'), w = p.getAttribute('WEIGHTS_0'); if (!j) return null;
  const out = [];
  for (let t = 0; t < j.getCount() / 3; t++) {
    const js = j.getElement(t * 3, []), ws = w.getElement(t * 3, []);
    out.push(js[ws.indexOf(Math.max(...ws))]);
  }
  return out;
}

/** An axis-aligned face cell: which plane it lies in, which way it faces, and its rectangle in that plane. */
export function faceOf([a, b, c]) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const L = Math.hypot(...n); if (L < 1e-12) return null;
  const axis = [0, 1, 2].reduce((best, i) => (Math.abs(n[i]) > Math.abs(n[best]) ? i : best), 0);
  if (Math.abs(n[axis]) / L < 0.999) return null; // not a voxel face
  const [ua, va] = [0, 1, 2].filter((i) => i !== axis);
  const us = [a[ua], b[ua], c[ua]], vs = [a[va], b[va], c[va]];
  return { axis, sign: Math.sign(n[axis]), plane: a[axis], ua, va, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

/**
 * Drops every face that a voxel sits right in front of: a face the model's own
 * cubes bury. Some sources are whole cubes, every face kept — 26,048 of the
 * shark's 28,818 faces could never be seen. Keyed by position (a part off the
 * lattice simply never matches), and a cell counts as solid only when all six
 * of its faces are there, so it only ever removes a face that a whole cube
 * sits on. A rig culls only against a voxel of the
 * SAME part: a face between two parts is a seam that shows when they move.
 * Runs on unindexed primitives; every attribute is filtered alike.
 */
export function cullHidden(doc, voxel) {
  const step = voxel / 20;
  const key = (q) => `${Math.round(q[0] / step)},${Math.round(q[1] / step)},${Math.round(q[2] / step)}`;
  const at = (f, side) => { const q = [0, 0, 0]; q[f.axis] = f.plane + side * f.sign * voxel / 2; q[f.ua] = (f.u0 + f.u1) / 2; q[f.va] = (f.v0 + f.v1) / 2; return q; };
  const prims = [];
  // A cell is solid only when all six of its faces are there: a whole cube.
  // A flat plate (a face with no cube behind it) must not bury what it faces.
  const sides = new Map();
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    // Eye geometry is never touched (see intake.mjs): neither culled nor a culler.
    if (/eye/i.test(p.getMaterial()?.getName() ?? '')) continue;
    const joints = jointsOf(p), dominant = dominantOf(p);
    // Only a face exactly one voxel square: a bigger one (a source built
    // partly from boxes, as the shark's is) is not one cell, and the one cell
    // in front of its middle says nothing about the rest of it.
    const unit = (f) => Math.abs(f.u1 - f.u0 - voxel) < voxel * 0.01 && Math.abs(f.v1 - f.v0 - voxel) < voxel * 0.01;
    const faces = trianglesOf(p).map((tri, t) => {
      const f = faceOf(tri); if (!f || !unit(f)) return null;
      // A blending face counts as the joint it mostly rides: buried inside a
      // bending body, it and what buries it bend together.
      const j = joints ? (joints[t] >= 0 ? joints[t] : dominant[t]) : 0;
      const inside = `${key(at(f, -1))}|${j}`;
      (sides.get(inside) ?? sides.set(inside, new Set()).get(inside)).add(`${f.axis}${f.sign}`);
      return { front: key(at(f, 1)), j };
    });
    prims.push({ p, faces });
  }
  const solid = new Set([...sides].filter(([, s]) => s.size === 6).map(([k]) => k));
  let dropped = 0;
  for (const { p, faces } of prims) {
    const keep = faces.map((f) => !f || !solid.has(`${f.front}|${f.j}`));
    if (keep.every(Boolean)) continue;
    for (const sem of p.listSemantics()) {
      const acc = p.getAttribute(sem), arr = acc.getArray(), n = acc.getElementSize();
      const out = new arr.constructor(keep.filter(Boolean).length * 3 * n);
      let o = 0;
      keep.forEach((k, t) => { if (k) { out.set(arr.subarray(t * 3 * n, (t + 1) * 3 * n), o); o += 3 * n; } });
      // A fresh accessor: one shared with another primitive must not be cut for this one.
      p.setAttribute(sem, doc.createAccessor().setType(acc.getType()).setNormalized(acc.getNormalized()).setArray(out));
    }
    dropped += keep.filter((k) => !k).length;
  }
  return dropped;
}
