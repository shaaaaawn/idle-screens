/**
 * What the village lays on its floor (`floorCover`): lawns in the yards, a
 * mosaic in the square, a mat at every door, stepping stones down the paths,
 * and the open sand combed into ripples by the current.
 *
 * Two kinds of thing, like the paths before them:
 *
 *   PAINTED  lawn, mosaic, ripples — no geometry. The floor's own shader
 *            paints them (installFloorPools, crystal-mesh.ts), so they lie on
 *            any terrain, cost no triangles and never z-fight. Each is drawn
 *            in whole cells — the world is voxels, so a lawn is mown in cube-
 *            wide stripes and a mosaic is tesserae — and takes the floor's own
 *            brightness, as a path does: a dark ocean has a dark lawn.
 *   VOXEL    mats and stepping stones — cubes on the fish's grid (TOWN_VOXEL),
 *            one draw with the town's furniture. Only where the ground is flat
 *            under them: a slab on a slope floats at one end.
 *
 * Paint order on the floor: lawns, paths, the mosaic, the light (pools and
 * spots) over all of them, then the ripples, which are relief, not paint: they
 * shade the lit sand, and only bare sand. A door's walk crosses its own lawn;
 * the mosaic is laid over the square's paving, its worn cobbles a rim round it.
 */
import { BufferAttribute, BufferGeometry, Color, Vector4 } from 'three';
import type { CrystalRng } from './crystals';
import { LAWN_STYLES, MOSAIC_STYLES, type FloorCover, type MatStyle, type StepStyle } from './floor-cover-mix';
import type { PathSegment } from './paths';
import { CubeWriter } from './scenery-paint';
import { currentFlow, TOWN_VOXEL, yardFrame, type TownYard } from './town';

/** Uniform budget: one lawn per home (geodeHomes ≤ 3), and room for one more. */
export const MAX_LAWNS = 4;
/** A mosaic's tessera, in cubes: smaller than a path's slab, big enough not to shimmer from across the tank. */
export const MOSAIC_CELL = 0.8;
/** A ripple's wavelength in cubes, by style; it is drawn in sixths of that. */
export const RIPPLE_WAVE = { fine: 2, broad: 4 } as const;

export interface CoverPaint {
  lawns: Array<{ x: number; z: number; dx: number; dz: number; Rd: number; Rr: number; style: number; cell: number }>;
  /** The square's middle, its edge and the fountain's basin (0: none), in world units. */
  mosaic: { x: number; z: number; r: number; inner: number; style: number; cell: number } | null;
  /** Down-current direction, and the wavelength. */
  ripples: { fx: number; fz: number; wave: number } | null;
}

export const NO_PAINT: CoverPaint = { lawns: [], mosaic: null, ripples: null };
export const paintsFloor = (p: CoverPaint | null | undefined): p is CoverPaint => !!p && (p.lawns.length > 0 || !!p.mosaic || !!p.ripples);

export interface CoverContext {
  rng: CrystalRng;
  scale: number;
  terrain: (x: number, z: number) => number;
  yards: readonly TownYard[];
  /** The square: its middle, the fountain's basin radius (0: no fountain) and how far its paving runs. */
  square: { x: number; z: number; inner: number; r: number } | null;
  /** The walks (not the square's paving): where stepping stones go. */
  walks: readonly PathSegment[];
  /** Clear of everything standing (homes, crystals, lamps, posts, benches). */
  free: (x: number, z: number, r: number) => boolean;
  /** The village's current (radians, as town.ts `currentFlow`): the sand is combed across it. */
  current: number;
}

export interface Cover {
  fixed: BufferGeometry | null;
  paint: CoverPaint;
  /** Ground that is laid and kept: plants and pyramids keep off it (scenery's keepClear). */
  keepClear: PathSegment[];
  counts: { lawns: number; mosaics: number; mats: number; stones: number; ripples: number };
}

const PALETTE = {
  kelp: ['#4f7a3a', '#3d662f', '#2c4a24'],
  cream: '#efe6d2',
  stone: { slate: ['#5d6573', '#6b7383', '#545b67'], sand: ['#b9a27a', '#c8b38a', '#a89069'], moss: ['#5f7060', '#6b7f69', '#556556'] },
} as const;

const STEP_FOR: Record<PathSegment['material'], StepStyle> = { pebble: 'slate', sand: 'sand', algae: 'moss' };

export function buildFloorCover(cover: FloorCover, ctx: CoverContext): Cover {
  const s = ctx.scale, V = TOWN_VOXEL * s, rng = ctx.rng;
  const out: Cover = { fixed: null, paint: { lawns: [], mosaic: null, ripples: null }, keepClear: [], counts: { lawns: 0, mosaics: 0, mats: 0, stones: 0, ripples: 0 } };
  const w = new CubeWriter(), c = new Color();
  const col = (hex: string, k = 1): Color => c.set(hex).multiplyScalar(k);
  const yards = ctx.yards.map((y) => ({ ...y, ...yardFrame(y, V) }));
  /** The ground under a slab of half-widths (a, b) along (u, v): its highest corner, or null where it slopes. */
  const flatAt = (x: number, z: number, u: { x: number; z: number }, a: number, b: number): number | null => {
    const v = { x: -u.z, z: u.x };
    const hs = [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]].map(([i, j]) => ctx.terrain(x + u.x * a * i! + v.x * b * j!, z + u.z * a * i! + v.z * b * j!));
    return Math.max(...hs) - Math.min(...hs) > 0.35 * V ? null : Math.max(...hs);
  };
  const inShell = (x: number, z: number): boolean => yards.some((y) => ((x - y.x) / (y.across + V)) ** 2 + ((z - y.z) / (y.along + V)) ** 2 < 1);

  if (cover.lawn) {
    for (const y of yards.slice(0, MAX_LAWNS)) {
      out.paint.lawns.push({ x: y.x, z: y.z, dx: y.d.x, dz: y.d.z, Rd: y.Rd, Rr: y.Rr, style: LAWN_STYLES.indexOf(cover.lawn.style), cell: V });
      // Kept: a capsule down the yard's long axis, inside the rectangle.
      const long = y.Rd >= y.Rr ? y.d : y.r, L = Math.max(y.Rd, y.Rr), S = Math.min(y.Rd, y.Rr);
      out.keepClear.push({ x0: y.x - long.x * (L - S), z0: y.z - long.z * (L - S), x1: y.x + long.x * (L - S) + 1e-3, z1: y.z + long.z * (L - S), width: S, material: 'algae' });
      out.counts.lawns++;
    }
  }

  if (cover.mosaic && ctx.square) {
    const q = ctx.square;
    out.paint.mosaic = { x: q.x, z: q.z, r: q.r, inner: q.inner, style: MOSAIC_STYLES.indexOf(cover.mosaic.style), cell: MOSAIC_CELL * V };
    out.keepClear.push({ x0: q.x, z0: q.z, x1: q.x, z1: q.z + 0.01, width: q.r, material: 'pebble' });
    out.counts.mosaics = 1;
  }

  if (cover.ripples) {
    const f = currentFlow(ctx.current);
    out.paint.ripples = { fx: f.x, fz: f.z, wave: RIPPLE_WAVE[cover.ripples.style] * V };
    out.counts.ripples = 1;
  }

  if (cover.mat) {
    yards.forEach((y) => {
      const style: MatStyle = cover.mat!.style, dl = Math.hypot(y.door.x - y.x, y.door.z - y.z);
      // Just in front of the door's step, across the walk.
      const at = { x: y.x + y.d.x * (dl + 1.3 * V), z: y.z + y.d.z * (dl + 1.3 * V) };
      const A = 1.7 * V, B = 1.1 * V, y0 = flatAt(at.x, at.z, y.r, A, B);
      if (y0 === null) return;
      mat(style, at.x, at.z, y0, y, A, B);
      out.counts.mats++;
    });
  }

  function mat(style: MatStyle, x: number, z: number, y0: number, y: (typeof yards)[number], A: number, B: number): void {
    // A woven grid: 8 across, 5 deep, a border in the darker thread; a striped rug in its home's colour, fringed.
    const nu = 8, nv = 5, cu = (2 * A) / nu, cv = (2 * B) / nv, h = 0.16 * V, yaw = Math.atan2(-y.r.z, y.r.x);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u = -A + (i + 0.5) * cu, v = -B + (j + 0.5) * cv, border = i === 0 || j === 0 || i === nu - 1 || j === nv - 1;
      const px = x + y.r.x * u + y.d.x * v, pz = z + y.r.z * u + y.d.z * v;
      let hex: string, k = 1;
      if (style === 'kelp') { hex = border ? PALETTE.kelp[2] : PALETTE.kelp[(i + j) % 2]!; k = 1 + 0.06 * (((i * 7 + j * 3) % 3) - 1); }
      else { hex = border ? y.tint : i % 3 === 1 ? PALETTE.cream : y.tint; k = border ? 0.6 : i % 3 === 1 ? 1 : 0.85; }
      w.cube(px, y0 + h / 2 + 0.04 * V, pz, cu, h, cv, col(hex, k), yaw);
    }
    if (style === 'stripe') {
      for (const side of [-1, 1]) for (let j = 0; j < nv; j++) {
        const v = -B + (j + 0.5) * cv, u = side * (A + 0.18 * V);
        w.cube(x + y.r.x * u + y.d.x * v, y0 + 0.05 * V, z + y.r.z * u + y.d.z * v, 0.36 * V, 0.08 * V, 0.12 * V, col(PALETTE.cream, 0.9), yaw);
      }
    }
  }

  if (cover.steps && ctx.walks.length) {
    // One line of stones down the middle of every walk, a stride apart, stepping a little left and right.
    const stride = 2.3 * V;
    let zig = 0;
    for (const seg of ctx.walks) {
      const dx = seg.x1 - seg.x0, dz = seg.z1 - seg.z0, L = Math.hypot(dx, dz);
      if (L < stride) continue;
      const u = { x: dx / L, z: dz / L }, p = { x: -u.z, z: u.x }, n = Math.floor(L / stride);
      const style: StepStyle = cover.steps.style ?? STEP_FOR[seg.material], pal = PALETTE.stone[style];
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) * (L / n), off = (zig++ % 2 ? 1 : -1) * Math.min(0.8 * V, seg.width * 0.3) + rng.range(-0.2, 0.2) * V;
        const x = seg.x0 + u.x * t + p.x * off, z = seg.z0 + u.z * t + p.z * off;
        const a = (0.95 + 0.25 * rng.next()) * V, b = (0.75 + 0.2 * rng.next()) * V, turn = rng.range(-0.3, 0.3), tone = Math.floor(rng.next() * 3);
        if (ctx.square && Math.hypot(x - ctx.square.x, z - ctx.square.z) < ctx.square.r + 1.5 * V) continue;
        if (inShell(x, z) || !ctx.free(x, z, 1.2 * V)) continue;
        const dir = { x: Math.cos(Math.atan2(u.z, u.x) + turn), z: Math.sin(Math.atan2(u.z, u.x) + turn) };
        const y0 = flatAt(x, z, dir, a, b);
        if (y0 === null) continue;
        stone(x, z, y0, dir, a, b, pal[tone]!);
        out.counts.stones++;
      }
    }
  }

  function stone(x: number, z: number, y0: number, dir: { x: number; z: number }, a: number, b: number, hex: string): void {
    // Rounded in cubes: a long slab crossed by a short one, a paler worn top set into it.
    const yaw = Math.atan2(-dir.z, dir.x), h = 0.32 * V, y = y0 + h / 2 - 0.08 * V;
    w.cube(x, y, z, 2 * a, h, 2 * b * 0.7, col(hex), yaw);
    w.cube(x, y, z, 2 * a * 0.72, h, 2 * b, col(hex), yaw);
    w.cube(x, y + h / 2 + 0.03 * V, z, 2 * a * 0.6, 0.06 * V, 2 * b * 0.55, col(hex, 1.18), yaw);
  }

  if (w.count) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(w.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(w.col), 3));
    g.computeBoundingSphere();
    g.userData.mqOwned = true;
    out.fixed = g;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The mosaic's pattern: one model, in JS (tests, and whoever asks) and GLSL.
// ---------------------------------------------------------------------------

/** Tones: 0 field, 1 field speckle (shader only), 2 dark band, 3 light band, 4 and 5 the compass's two faces. */
export const MOSAIC_PALETTES: Record<(typeof MOSAIC_STYLES)[number], ReadonlyArray<readonly [number, number, number]>> = {
  stone: [[0.36, 0.34, 0.3], [0.44, 0.41, 0.35], [0.12, 0.13, 0.16], [0.6, 0.53, 0.38], [0.17, 0.21, 0.3], [0.64, 0.55, 0.36]],
  shell: [[0.74, 0.66, 0.56], [0.8, 0.62, 0.56], [0.5, 0.2, 0.17], [0.9, 0.83, 0.72], [0.82, 0.36, 0.28], [0.95, 0.72, 0.58]],
  glass: [[0.08, 0.2, 0.24], [0.1, 0.27, 0.29], [0.03, 0.06, 0.11], [0.5, 0.72, 0.66], [0.1, 0.4, 0.58], [0.68, 0.5, 0.12]],
};
/** Radii, as fractions of the square: the outer border's bands, where the compass points end. */
const BAND = { edge: 0.94, light: 0.88, inner: 0.84, tip: 0.8, minor: 0.62, ring: 0.05, boss: 0.1 } as const;
const QUARTER = Math.PI / 2;
/** A main point's half-width at its root, in eighths of a turn. */
const MAIN_RAY = 0.7;

/** Which tone a tessera at (rho, theta) is: rho in fractions of the square, r0 the basin's edge (0: none). */
export function mosaicTone(rho: number, th: number, r0: number): number {
  if (rho > BAND.edge) return 2;
  if (rho > BAND.light) return 3;
  if (rho > BAND.inner) return 2;
  if (r0 > 0 ? rho < r0 + BAND.ring : rho < BAND.boss) return 3;
  // As if the star were whole under the basin: its points come out from beneath it, tapering, not stubs round its rim.
  const t = (rho - r0 * 0.5) / (BAND.tip - r0 * 0.5);
  // The four main points on the axes, the four lesser between: each two-faced, lit one side, dark the other.
  const m = th / QUARTER, dm = (m - Math.floor(m + 0.5)) * QUARTER;
  if (Math.abs(dm) < (Math.PI / 4) * MAIN_RAY * (1 - t)) return dm >= 0 ? 4 : 5;
  const m2 = (th - Math.PI / 4) / QUARTER, d2 = (m2 - Math.floor(m2 + 0.5)) * QUARTER;
  if (t < BAND.minor && Math.abs(d2) < (Math.PI / 4) * 0.6 * (1 - t / BAND.minor)) return d2 >= 0 ? 5 : 4;
  return 0;
}

const f3 = (v: number): string => v.toFixed(3);
const vec3 = (c: readonly number[]): string => `vec3(${c.map(f3).join(', ')})`;
const MOSAIC_COLOR_GLSL = MOSAIC_STYLES.map((name, si) => {
  const pal = MOSAIC_PALETTES[name];
  const body = pal.map((c, ti) => (ti < pal.length - 1 ? `tone < ${ti}.5 ? ${vec3(c)} : ` : vec3(c))).join('');
  return si < MOSAIC_STYLES.length - 1 ? `if (style < ${si}.5) return ${body};` : `return ${body};`;
}).join('\n    ');

export const COVER_PARS = /* glsl */ `
  uniform int uMqLawnN;
  uniform vec4 uMqLawn[${MAX_LAWNS * 2}];
  uniform vec4 uMqMosaic;
  uniform vec4 uMqMosaicB;
  uniform vec4 uMqRipple;
  float mqMosaicTone(float rho, float th, float r0) {
    if (rho > ${f3(BAND.edge)}) return 2.0;
    if (rho > ${f3(BAND.light)}) return 3.0;
    if (rho > ${f3(BAND.inner)}) return 2.0;
    if (r0 > 0.0 ? rho < r0 + ${f3(BAND.ring)} : rho < ${f3(BAND.boss)}) return 3.0;
    float t = (rho - r0 * 0.5) / (${f3(BAND.tip)} - r0 * 0.5);
    float m = th / ${QUARTER.toFixed(6)}, dm = (m - floor(m + 0.5)) * ${QUARTER.toFixed(6)};
    if (abs(dm) < ${(Math.PI / 4).toFixed(6)} * ${f3(MAIN_RAY)} * (1.0 - t)) return dm >= 0.0 ? 4.0 : 5.0;
    float m2 = (th - ${(Math.PI / 4).toFixed(6)}) / ${QUARTER.toFixed(6)}, d2 = (m2 - floor(m2 + 0.5)) * ${QUARTER.toFixed(6)};
    if (t < ${f3(BAND.minor)} && abs(d2) < ${(Math.PI / 4).toFixed(6)} * 0.6 * (1.0 - t / ${f3(BAND.minor)})) return d2 >= 0.0 ? 5.0 : 4.0;
    return 0.0;
  }
  vec3 mqMosaicColor(float style, float tone) {
    ${MOSAIC_COLOR_GLSL}
  }
`;

/** Before the paths: the lawns. `mqFloorLum` is the bare floor's brightness; laid ground clears `mqBare`. */
export const COVER_UNDER = /* glsl */ `
  for (int i = 0; i < ${MAX_LAWNS}; i++) {
    if (i >= uMqLawnN) break;
    vec4 la = uMqLawn[i * 2], lb = uMqLawn[i * 2 + 1];
    vec2 lo = vMqW.xz - la.xy;
    float lu = dot(lo, la.zw), lv = dot(lo, vec2(la.w, -la.z));
    if (abs(lu) < lb.x && abs(lv) < lb.y) {
      float C = lb.w;
      float h = mqHash(floor(vec2(lu, lv) / C) + float(i) * 37.0);
      // Mown: stripes two cubes wide running from the gate to the back, or checks.
      float band = lb.z < 0.5 ? mod(floor(lv / (2.0 * C)), 2.0) : mod(floor(lu / (2.0 * C)) + floor(lv / (2.0 * C)), 2.0);
      vec3 lc = mix(vec3(0.035, 0.13, 0.045), vec3(0.065, 0.23, 0.07), band) * (0.9 + 0.2 * h);
      lc *= 1.0 + 0.3 * step(0.94, h); // the odd clump grown long
      // The cube along the fence, uncut and in its shade.
      lc *= min(lb.x - abs(lu), lb.y - abs(lv)) < C ? 0.78 : 1.0;
      diffuseColor.rgb = lc * clamp(0.34 + mqFloorLum * 2.6, 0.34, 1.0);
      mqBare = 0.0; mqGround = diffuseColor.rgb; mqAlbedo = lc;
    }
  }
`;

/** After the paths: the mosaic, laid over the square's paving with a crisp, stepped edge. */
export const COVER_OVER = /* glsl */ `
  if (uMqMosaic.z > 0.0) {
    float C = uMqMosaicB.y;
    vec2 mg = vMqW.xz / C, mcell = floor(mg), m01 = fract(mg);
    vec2 pc = (mcell + 0.5) * C - uMqMosaic.xy;
    float rho = length(pc) / uMqMosaic.z;
    if (rho < 1.0) {
      float h = mqHash(mcell + 3.7);
      float tone = mqMosaicTone(rho, atan(pc.y, pc.x), uMqMosaicB.x / uMqMosaic.z);
      if (tone < 0.5 && h > 0.72) tone = 1.0;
      vec3 mc = mqMosaicColor(uMqMosaic.w, tone) * (0.9 + 0.2 * h);
      // Grout: a thin dark joint round every tessera.
      float joint = min(min(m01.x, 1.0 - m01.x), min(m01.y, 1.0 - m01.y));
      mc *= 0.7 + 0.3 * smoothstep(0.0, 0.08, joint);
      diffuseColor.rgb = mc * clamp(0.34 + mqFloorLum * 2.6, 0.34, 1.0);
      mqBare = 0.0; mqGround = diffuseColor.rgb; mqAlbedo = mc;
    }
  }
`;

/**
 * Last, over the light. A lawn or a tessera reflects the light in its own colour. Then the sand's ripples, on bare floor
 * only: relief, not paint — a crest catches the light that falls on it and a lee hides from it, so they shade the lit
 * floor (pools and spots too), never a lawn, a path or the mosaic.
 */
export const COVER_LAST = /* glsl */ `
  // The light that fell on a lawn or a tessera, as that colour reflects it: a dark tile stays dark under a lamp, so
  // the compass reads in a lit square instead of washing out to the lamp's colour.
  if (mqAlbedo.x >= 0.0) diffuseColor.rgb = mqGround + (diffuseColor.rgb - mqGround) * min(mqAlbedo * 1.8, vec3(1.3));
  if (uMqRipple.z > 0.0 && mqBare > 0.5) {
    // Drawn in sixths of a wavelength, so a ripple is stepped like everything else here.
    float C = uMqRipple.z / 6.0;
    vec2 q = (floor(vMqW.xz / C) + 0.5) * C;
    // Fields of ripples with bare sand between, each crest wandering a little.
    float field = smoothstep(0.38, 0.64, mqNoise(q / (uMqRipple.z * 9.0) + 7.3));
    float f = fract(dot(q, uMqRipple.xy) / uMqRipple.z + 1.6 * mqNoise(q / (uMqRipple.z * 3.0)));
    // The gentle face climbs with the current to a lit crest, then drops down its steep lee into shadow.
    float lit = step(0.66, f) * step(f, 0.86), lee = step(0.86, f) * step(f, 0.97);
    diffuseColor.rgb *= 1.0 + field * (0.22 * lit - 0.24 * lee);
  }
`;

export function coverUniforms(): Record<string, { value: unknown }> {
  return {
    uMqLawnN: { value: 0 },
    uMqLawn: { value: Array.from({ length: MAX_LAWNS * 2 }, () => new Vector4()) },
    uMqMosaic: { value: new Vector4() },
    uMqMosaicB: { value: new Vector4() },
    uMqRipple: { value: new Vector4() },
  };
}

/** Paint this cover on the floor (null clears it). */
export function writeCover(u: Record<string, { value: unknown }>, paint: CoverPaint | null): void {
  const L = u.uMqLawn!.value as Vector4[], lawns = paint?.lawns.slice(0, MAX_LAWNS) ?? [];
  lawns.forEach((l, i) => { L[i * 2]!.set(l.x, l.z, l.dx, l.dz); L[i * 2 + 1]!.set(l.Rd, l.Rr, l.style, l.cell); });
  u.uMqLawnN!.value = lawns.length;
  const m = paint?.mosaic;
  (u.uMqMosaic!.value as Vector4).set(m?.x ?? 0, m?.z ?? 0, m?.r ?? 0, m?.style ?? 0);
  (u.uMqMosaicB!.value as Vector4).set(m?.inner ?? 0, m?.cell ?? 1, 0, 0);
  const r = paint?.ripples;
  (u.uMqRipple!.value as Vector4).set(r?.fx ?? 0, r?.fz ?? 0, r?.wave ?? 0, 0);
}

/** Where a lawn is, and which stripe (0 or 1): -1 off every lawn. The shader's test, for tests and whoever asks. */
export function lawnAt(paint: CoverPaint, x: number, z: number): number {
  for (const l of paint.lawns.slice(0, MAX_LAWNS)) {
    const ox = x - l.x, oz = z - l.z, u = ox * l.dx + oz * l.dz, v = ox * l.dz - oz * l.dx;
    if (Math.abs(u) < l.Rd && Math.abs(v) < l.Rr) {
      const C = l.cell;
      const band = l.style < 0.5 ? Math.floor(v / (2 * C)) : Math.floor(u / (2 * C)) + Math.floor(v / (2 * C));
      return ((band % 2) + 2) % 2;
    }
  }
  return -1;
}

