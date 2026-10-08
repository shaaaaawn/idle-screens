/**
 * A betta's eyes, alive.
 *
 * The other minted breeds' eyes are cells in materials of their own (eyes.ts
 * redraws them). A betta's are painted into its token's texture atlas: on
 * each flank, a block of 3×3 voxel faces at the front of the head — white
 * cells round a pupil (indigo on one side, a pale grey on the other), placed
 * differently by every token. Every token shares the model and its UVs, so
 * the block is in the same place on all 256 (measured over every atlas,
 * 2026-10-07).
 *
 * So the eye is a DISPLAY in the texture lookup: for a point on one of the
 * two blocks, the shader reads the block's nine cells from the token's own
 * atlas, finds the pupil (the cells darker than the white or tinted), and
 * draws the block with the pupil glided toward where the fish is looking — a
 * fraction of a cell at a time, never past the white's edge (the pupil's own
 * extent sets how far it may go). Every token, no tables, the fish's own
 * pupil in its own colours; nothing else on the fish is touched, and the cost
 * lands only on the pixels of the eyes.
 *
 * Measured in the rig's frame (breeds/rig/betafish.py: nose +Z, up +Y; the
 * mesh's bind-space positions): the flanks stand at x = -7.38 and +6.62, the
 * blocks span z 0.3 .. 6.3 and y -2.1 .. 3.9, in cells of 2.
 */
import { ShaderChunk, Vector2, Vector4, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three';

/** The two eye blocks: the flank's plane (x), and the block's corner (z, y). */
export const BETA_EYE_BLOCKS = [
  { plane: -7.38, z0: 0.3, y0: -2.1 },
  { plane: 6.62, z0: 0.3, y0: -2.1 },
] as const;
const CELL = 2;
const N = 3;

export interface BetaEyeRig {
  /** Each eye's gaze, -1..1: fwd + toward the nose, up + up. */
  set(eyes: ReadonlyArray<{ fwd: number; up: number }>): void;
  /** The cells found per eye (9 when the model is the betta's). */
  cells: readonly number[];
}

/**
 * How each eye cell maps onto the atlas: its UV at the cell's (low z, low y)
 * corner, and the UV steps along +z and +y across it — learned from the
 * model's own triangles. Null when the model has no such block.
 */
export function betaEyeCells(geometry: BufferGeometry): Array<Array<{ o: [number, number]; dz: [number, number]; dy: [number, number] } | null>> | null {
  const pos = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), idx = geometry.index;
  if (!pos || !uv) return null;
  const out = BETA_EYE_BLOCKS.map(() => Array.from({ length: N * N }, () => null as { o: [number, number]; dz: [number, number]; dy: [number, number] } | null));
  const n = idx ? idx.count : pos.count;
  for (let t = 0; t + 2 < n; t += 3) {
    const v = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
    const P = v.map((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)] as const);
    BETA_EYE_BLOCKS.forEach((b, e) => {
      if (!P.every((p) => Math.abs(p[0] - b.plane) < 0.02)) return;
      const zs = P.map((p) => p[2]), ys = P.map((p) => p[1]);
      const z0 = Math.min(...zs), y0 = Math.min(...ys);
      if (Math.max(...zs) - z0 < CELL * 0.9 || Math.max(...ys) - y0 < CELL * 0.9) return; // a sliver, not a face
      const cx = Math.round((z0 - b.z0) / CELL), cy = Math.round((y0 - b.y0) / CELL);
      if (cx < 0 || cy < 0 || cx >= N || cy >= N || Math.abs(z0 - (b.z0 + cx * CELL)) > 0.05) return;
      // Solve this triangle's UV as an affine map of (z, y): uv = o + dz·a + dy·b over the cell.
      const U = v.map((i) => [uv.getX(i), uv.getY(i)] as const);
      const a = P.map((p) => (p[2] - z0) / CELL), c = P.map((p) => (p[1] - y0) / CELL);
      const det = (a[1]! - a[0]!) * (c[2]! - c[0]!) - (a[2]! - a[0]!) * (c[1]! - c[0]!);
      if (Math.abs(det) < 1e-6) return;
      const solve = (k: 0 | 1): [number, number, number] => {
        const du1 = U[1]![k] - U[0]![k], du2 = U[2]![k] - U[0]![k];
        const dz = (du1 * (c[2]! - c[0]!) - du2 * (c[1]! - c[0]!)) / det;
        const dy = ((a[1]! - a[0]!) * du2 - (a[2]! - a[0]!) * du1) / det;
        return [U[0]![k] - dz * a[0]! - dy * c[0]!, dz, dy];
      };
      const [ou, dzu, dyu] = solve(0), [ov, dzv, dyv] = solve(1);
      out[e]![cy * N + cx] = { o: [ou, ov], dz: [dzu, dzv], dy: [dyu, dyv] };
    });
  }
  return out.some((cells) => cells.every(Boolean)) ? out : null;
}

const PARS = /* glsl */ `
  uniform vec4 uBetaEye[2];     // plane x, z0, y0, live (1 = this eye is drawn)
  uniform vec4 uBetaCell[18];   // per cell: uv at its corner (xy), uv step along +z (zw)
  uniform vec2 uBetaCellY[18];  // per cell: uv step along +y
  uniform vec2 uBetaGaze[2];
  varying vec3 vBetaP;
  float mqBetaLum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  vec2 mqBetaCellUv(int k, vec2 f) { return uBetaCell[k].xy + uBetaCell[k].zw * f.x + uBetaCellY[k] * f.y; }
  vec2 mqBetaEyeUv(vec2 uv) {
    for (int e = 0; e < 2; e++) {
      vec4 b = uBetaEye[e];
      if (b.w < 0.5 || abs(vBetaP.x - b.x) > 0.05) continue;
      vec2 g = vec2((vBetaP.z - b.y) / ${CELL.toFixed(1)}, (vBetaP.y - b.z) / ${CELL.toFixed(1)});
      if (g.x < 0.0 || g.y < 0.0 || g.x > ${N}.0 || g.y > ${N}.0) continue;
      // The pupil: the cells darker than the eye's white, or tinted. Its box
      // sets how far it may glide before it would leave the white.
      float lmax = 0.0; float lum[9]; float sat[9];
      for (int k = 0; k < 9; k++) {
        vec3 c = texture2D(map, mqBetaCellUv(e * 9 + k, vec2(0.5))).rgb;
        lum[k] = mqBetaLum(c); sat[k] = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
        lmax = max(lmax, lum[k]);
      }
      vec2 lo = vec2(9.0), hi = vec2(-9.0);
      for (int k = 0; k < 9; k++) {
        if (lum[k] < lmax * 0.8 || sat[k] > 0.2) {
          vec2 cxy = vec2(float(k - (k / 3) * 3), float(k / 3));
          lo = min(lo, cxy); hi = max(hi, cxy);
        }
      }
      if (hi.x < 0.0) return uv;  // no pupil to move: the eye as painted
      vec2 gz = uBetaGaze[e];
      vec2 lim0 = -lo, lim1 = vec2(${N - 1}.0) - hi;  // how far the pupil may go back/down, and forward/up
      vec2 s = vec2(gz.x >= 0.0 ? gz.x * lim1.x : -gz.x * lim0.x, gz.y >= 0.0 ? gz.y * lim1.y : -gz.y * lim0.y);
      // The block shows its own pattern shifted by s: what is at q, s back.
      vec2 q = clamp(g - s, vec2(0.0), vec2(${N}.0 - 0.0005));
      vec2 cell = floor(q), f = clamp(q - cell, 0.03, 0.97);
      return mqBetaCellUv(e * 9 + int(cell.y) * 3 + int(cell.x), f);
    }
    return uv;
  }
`;

/**
 * Turn a betta's painted eyes into displays. `body` is the fish's model (its
 * meshes share the betta geometry). Every material with a `map` is patched;
 * a model without the eye blocks returns null and is left as it was.
 */
export function rigBetaEyes(body: Object3D): BetaEyeRig | null {
  let cells: ReturnType<typeof betaEyeCells> = null;
  const mats: Material[] = [];
  body.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    cells ??= betaEyeCells(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if ((m as Material & { map?: unknown }).map && !mats.includes(m)) mats.push(m);
    }
  });
  const found = cells as ReturnType<typeof betaEyeCells>;
  if (!found || !mats.length) return null;
  const cell = (e: number, k: number) => found[e]?.[k] ?? null;
  const uniforms = {
    uBetaEye: { value: BETA_EYE_BLOCKS.map((b, e) => new Vector4(b.plane, b.z0, b.y0, found[e]!.every(Boolean) ? 1 : 0)) },
    uBetaCell: { value: Array.from({ length: 18 }, (_, i) => { const c = cell(i >= 9 ? 1 : 0, i % 9); return c ? new Vector4(c.o[0], c.o[1], c.dz[0], c.dz[1]) : new Vector4(); }) },
    uBetaCellY: { value: Array.from({ length: 18 }, (_, i) => { const c = cell(i >= 9 ? 1 : 0, i % 9); return c ? new Vector2(c.dy[0], c.dy[1]) : new Vector2(); }) },
    uBetaGaze: { value: [new Vector2(), new Vector2()] },
  };
  for (const m of mats) {
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'varying vec3 vBetaP;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vBetaP = position;');
      // After the map's own declaration (the functions read it), and only where there is one.
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n#ifdef USE_MAP\n${PARS}\n#endif`).replace('#include <map_fragment>',
        ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'texture2D( map, mqBetaEyeUv( vMapUv ) )'));
    };
    const key = m.customProgramCacheKey.bind(m);
    m.customProgramCacheKey = () => `${key()}|mq-beta-eyes-v1`;
    m.needsUpdate = true;
  }
  const counts = found.map((c) => c.filter(Boolean).length);
  return {
    cells: counts,
    set(eyes) {
      for (let e = 0; e < 2; e++) {
        const g = eyes[e] ?? eyes[0] ?? { fwd: 0, up: 0 };
        uniforms.uBetaGaze.value[e]!.set(Math.max(-1, Math.min(1, g.fwd)), Math.max(-1, Math.min(1, g.up)));
      }
    },
  };
}
