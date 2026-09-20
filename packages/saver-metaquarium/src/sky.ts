/**
 * The sky motif: jellyfish lanterns. Minerals are faceted, the living is voxel
 * — so the thing that owns the empty top half of the frame is a slow flotilla
 * of voxel jellyfish, each a paper lantern with a lit core, pulsing as it
 * rises and sinks. A few hang far out, big and dim, and the fog turns them
 * into silhouettes: that is the sky's far distance.
 *
 * One merged geometry, one draw. Every voxel carries its lantern's home and
 * phase, and the vertex shader does all of the motion — drift, the bell's
 * squeeze, the tentacles' lagging wave — as a pure function of t. `lanternAt`
 * is the same drift in JS, so the bloom card and the light a lantern throws
 * on the floor ride exactly where the shader drew it.
 */

import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { CrystalRng, Emitter } from './crystals';

export interface Lantern {
  x: number; y: number; z: number;
  size: number;
  phase: number;
  color: string;
  /** Out past the swim space: bigger, dimmer, no light of its own. */
  far: boolean;
}

export interface SkyOptions {
  /** 0..1 — how populated the sky is. */
  density: number;
  cap: number;
  scale: number;
  /** Colours to borrow (the scene's crystals), so a lantern belongs to its district. */
  palette: readonly string[];
}

export interface Sky {
  lanterns: Lantern[];
  geometry: BufferGeometry | null;
  voxels: number;
}

const FALLBACK = ['#ffb36b', '#ff7ac8', '#7ad7ff', '#b79bff'];
/** Bell pulse, rad/s — about one squeeze every six seconds. */
export const LANTERN_BEAT = 1.05;

/** Where lantern `l` is at `t`. Mirrors the vertex shader line for line. */
export function lanternAt(l: Lantern, t: number, out: { x: number; y: number; z: number }): void {
  const amp = l.far ? 0.35 : 1;
  out.x = l.x + Math.sin(t * 0.031 + l.phase * 2.0) * 28 * amp;
  out.z = l.z + Math.cos(t * 0.023 + l.phase * 1.3) * 22 * amp;
  out.y = l.y + Math.sin(t * 0.07 + l.phase) * 12 * amp - Math.cos(t * LANTERN_BEAT + l.phase) * 1.6 * l.size;
}

export const LANTERN_VERTEX = /* glsl */ `
  #include <begin_vertex>
  float ph = aJelly.x, hang = aJelly.y, amp = aHome.w;
  float beat = 0.5 + 0.5 * sin(uSkyTime * ${LANTERN_BEAT.toFixed(2)} + ph);
  beat *= beat;
  vec3 local = position - aHome.xyz;
  if (hang <= 0.0) {
    // The bell: squeezes in and grows a little taller, then relaxes wide.
    local.xz *= 1.0 + 0.2 * (0.45 - beat);
    local.y *= 1.0 + 0.14 * (beat - 0.45);
  } else {
    // Tentacles trail: the same wave, later the further down it hangs.
    local.x += sin(uSkyTime * ${LANTERN_BEAT.toFixed(2)} + ph - hang * 0.24) * hang * 0.11;
    local.z += cos(uSkyTime * ${(LANTERN_BEAT * 0.8).toFixed(2)} + ph - hang * 0.2) * hang * 0.09;
    local.y += beat * hang * 0.07;
  }
  vec3 home = aHome.xyz;
  home.x += sin(uSkyTime * 0.031 + ph * 2.0) * 28.0 * amp;
  home.z += cos(uSkyTime * 0.023 + ph * 1.3) * 22.0 * amp;
  home.y += sin(uSkyTime * 0.07 + ph) * 12.0 * amp - cos(uSkyTime * ${LANTERN_BEAT.toFixed(2)} + ph) * 1.6 * aJelly.z;
  transformed = home + local;
`;
export const LANTERN_COLOR = /* glsl */ `
  #include <color_vertex>
  float lbeat = 0.5 + 0.5 * sin(uSkyTime * ${LANTERN_BEAT.toFixed(2)} + aJelly.x);
  vColor.rgb *= 1.0 + aGlow * 0.55 * lbeat * lbeat;
`;

const FACES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 0, 1], [0, -1, 0, 0.5], [1, 0, 0, 0.82], [-1, 0, 0, 0.66], [0, 0, 1, 0.75], [0, 0, -1, 0.6],
];

class LanternWriter {
  readonly pos: number[] = []; readonly col: number[] = [];
  readonly home: number[] = []; readonly jelly: number[] = []; readonly glow: number[] = [];
  count = 0;
  l: Lantern = { x: 0, y: 0, z: 0, size: 1, phase: 0, color: '#fff', far: false };

  cube(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, c: Color, hang: number, lit: number): void {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, l = this.l;
    for (const [nx, ny, nz, shade] of FACES) {
      const a = ny !== 0 ? [1, 0, 0] : nx !== 0 ? [0, 0, 1] : [1, 0, 0];
      const b = ny !== 0 ? [0, 0, 1] : [0, 1, 0];
      const flip = (nx + ny + nz) * (ny !== 0 || nx !== 0 ? -1 : 1) < 0;
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [
        cx + nx * hx + a[0]! * u! * hx + b[0]! * v! * hx,
        cy + ny * hy + a[1]! * u! * hy + b[1]! * v! * hy,
        cz + nz * hz + a[2]! * u! * hz + b[2]! * v! * hz,
      ]);
      // A lit voxel is a lamp: it does not take the face shading.
      const k = lit > 0.5 ? 1 : shade;
      for (const i of flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) {
        const p = q[i]!;
        this.pos.push(p[0]!, p[1]!, p[2]!);
        this.col.push(c.r * k, c.g * k, c.b * k);
        this.home.push(l.x, l.y, l.z, l.far ? 0.35 : 1);
        this.jelly.push(l.phase, hang, l.size);
        this.glow.push(lit);
      }
    }
    this.count += 1;
  }
}

/** One jellyfish, voxel by voxel: a stepped dome, a scalloped skirt, a lit
 *  core showing through the underside, frilled arms and thin trailing lines. */
function growLantern(w: LanternWriter, l: Lantern, rng: CrystalRng): void {
  w.l = l;
  const u = 1.7 * l.size;
  const dim = l.far ? 0.3 : 1;
  const body = new Color(l.color).multiplyScalar(0.62 * dim);
  const crown = new Color(l.color).lerp(new Color('#ffffff'), 0.35).multiplyScalar(0.8 * dim);
  const core = new Color(l.color).lerp(new Color('#fff6e0'), 0.55).multiplyScalar(l.far ? 0.4 : 1);
  const line = new Color(l.color).multiplyScalar(0.45 * dim);
  // Dome: discs of voxels, widest at the skirt. Hollowed, so the core shows.
  const radii = [3.6, 3.4, 2.7, 1.6];
  radii.forEach((r, layer) => {
    const n = Math.ceil(r);
    for (let ix = -n; ix <= n; ix++) for (let iz = -n; iz <= n; iz++) {
      const d = Math.hypot(ix, iz);
      if (d > r) continue;
      // Keep the shell and the spots; drop the inside of the low layers.
      if (layer < 2 && d < r - 1.3) continue;
      const spot = layer >= 1 && ((ix * 7 + iz * 13 + layer * 5) & 7) === 0;
      w.cube(l.x + ix * u, l.y + layer * u, l.z + iz * u, u, u, u, spot ? core : layer >= 2 ? crown : body, 0, spot ? 1 : 0);
    }
  });
  // Scalloped skirt: every other rim voxel drops one.
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    if (i % 2) w.cube(l.x + Math.round(Math.cos(a) * 3.5) * u, l.y - u, l.z + Math.round(Math.sin(a) * 3.5) * u, u, u, u, body, 0.01, 0);
  }
  // The lantern's flame.
  for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
    w.cube(l.x + ix * u, l.y + u * 0.2, l.z + iz * u, u, u * 1.4, u, core, 0, 1);
  }
  // Frilled arms: short, thick, glowing a little.
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + rng.next();
    const len = 4 + Math.floor(rng.next() * 3);
    for (let j = 1; j <= len; j++) {
      const wd = u * (1.25 - j * 0.12);
      w.cube(l.x + Math.cos(a) * u * 0.9, l.y - j * u, l.z + Math.sin(a) * u * 0.9, wd, u, wd, j % 2 ? core : crown, j * u, j % 2 ? 0.6 : 0);
    }
  }
  // Trailing lines: thin, long, from under the rim.
  const lines = l.far ? 5 : 7;
  for (let k = 0; k < lines; k++) {
    const a = (k / lines) * Math.PI * 2 + rng.next() * 0.5;
    const len = 7 + Math.floor(rng.next() * 8);
    for (let j = 1; j <= len; j++) {
      const wd = u * Math.max(0.28, 0.6 - j * 0.03);
      w.cube(l.x + Math.cos(a) * u * 2.6, l.y - (j + 0.5) * u, l.z + Math.sin(a) * u * 2.6, wd, u * 1.02, wd, j % 4 === 0 && !l.far ? core : line, j * u, j % 4 === 0 && !l.far ? 0.8 : 0);
    }
  }
}

export function buildSky(rng: CrystalRng, opts: SkyOptions): Sky {
  const budget = Math.min(1, 0.4 + opts.cap / 20);
  const total = Math.round(opts.density * 10 * budget);
  if (total <= 0) return { lanterns: [], geometry: null, voxels: 0 };
  const s = opts.scale;
  const palette = opts.palette.length ? opts.palette : FALLBACK;
  const far = total >= 4 ? Math.max(1, Math.round(total * 0.3)) : 0;
  const lanterns: Lantern[] = [];
  const w = new LanternWriter();
  for (let i = 0; i < total; i++) {
    const isFar = i >= total - far;
    // Golden-angle bearings keep the flotilla spread without a relaxation pass.
    const a = i * 2.39996 + rng.next() * 0.6;
    const r = isFar ? rng.range(210, 300) : rng.range(35, 165);
    const l: Lantern = {
      x: Math.sin(a) * r * s, z: Math.cos(a) * r * s,
      y: (isFar ? rng.range(110, 210) : rng.range(92, 175)) * s,
      size: (isFar ? rng.range(2.4, 3.6) : rng.range(0.75, 1.5)) * s,
      phase: rng.next() * Math.PI * 2,
      color: palette[Math.floor(rng.next() * palette.length)]!,
      far: isFar,
    };
    lanterns.push(l);
    growLantern(w, l, rng.fork(10 + i));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(w.pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(w.col), 3));
  g.setAttribute('aHome', new BufferAttribute(new Float32Array(w.home), 4));
  g.setAttribute('aJelly', new BufferAttribute(new Float32Array(w.jelly), 3));
  g.setAttribute('aGlow', new BufferAttribute(new Float32Array(w.glow), 1));
  return { lanterns, geometry: g, voxels: w.count };
}

/** The light the near lanterns throw, at `t`, written into `out` in place. */
export function lanternEmitters(lanterns: readonly Lantern[], t: number, out: Emitter[]): void {
  const p = { x: 0, y: 0, z: 0 };
  const c = new Color();
  let n = 0;
  for (const l of lanterns) {
    if (l.far) continue;
    lanternAt(l, t, p);
    c.set(l.color);
    const e = out[n] ?? (out[n] = { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, reach: 1, phase: 0 });
    e.x = p.x; e.y = p.y; e.z = p.z;
    e.r = c.r * 0.55; e.g = c.g * 0.55; e.b = c.b * 0.55;
    e.reach = 58 * l.size; e.phase = l.phase;
    n += 1;
  }
  out.length = n;
}
