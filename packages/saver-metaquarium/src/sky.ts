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
  species: LanternSpecies;
  /** Beats relative to LANTERN_BEAT: small jellies pulse quicker, the far giants slowly. */
  rate: number;
}

export interface SkyOptions {
  /** 0..1 — how populated the sky is. */
  density: number;
  cap: number;
  scale: number;
  /** Colours to borrow (the scene's crystals), so a lantern belongs to its district. */
  palette: readonly string[];
  /** Altitude multiplier: 1 is overhead; ~0.35 brings the flotilla down among the houses. */
  height?: number;
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
  out.y = l.y + Math.sin(t * 0.07 + l.phase) * 12 * amp + lanternSurge(t, l) * 3.2 * l.size;
}

/** Propulsion: a jelly is THROWN upward by each squeeze and sinks until the
 *  next — a quick rise, a long fall, zero over a beat. Same curve in GLSL. */
export function lanternSurge(t: number, l: Pick<Lantern, 'phase' | 'rate'>): number {
  const x = (t * LANTERN_BEAT * l.rate + l.phase) / (Math.PI * 2) - 0.08;
  const u = x - Math.floor(x);
  return (u < 0.3 ? u / 0.3 : 1 - (u - 0.3) / 0.7) - 0.5;
}

/** `mqBeat` below, in JS, at the crown (lag 0): 0 relaxed → 1 squeezed. The
 *  light a lantern throws — its bloom card, its pool on the floor, the tint on
 *  a fish under it — flares on this same beat, so the field never brightens
 *  while the lantern it comes from is dark. */
export function lanternBeat(t: number, phase: number, rate = 1): number {
  // `rate`: each jelly beats at its own pace (the shader's `aBell.y`) — leave it
  // out and the light drifts out of step with the bell it comes from.
  const w = (t * LANTERN_BEAT * rate + phase) / 6.2831853;
  const u = w - Math.floor(w);
  const x = u < 0.22 ? u / 0.22 : (u - 0.22) / 0.78;
  const s = x * x * (3 - 2 * x);
  return u < 0.22 ? s : 1 - s;
}
/** How bright the lit core is on this beat, relative to its peak — the
 *  shader's `0.15 + 0.85 * beat` over a base of 1, normalised to the squeeze. */
export const lanternLight = (beat: number): number => 0.575 + 0.425 * beat;

/** One beat of the bell, 0 relaxed → 1 squeezed: a quick snap shut, a long
 *  ease open. `lag` delays it — the rim follows the crown, a tentacle follows
 *  the rim — which is what makes the pulse travel down the animal. */
const BEAT_GLSL = /* glsl */ `
  float mqBeat(float t, float ph, float lag) {
    float u = fract((t * ${LANTERN_BEAT.toFixed(2)} * aBell.y + ph) / 6.2831853 - lag);
    return u < 0.22 ? smoothstep(0.0, 0.22, u) : 1.0 - smoothstep(0.22, 1.0, u);
  }
  float mqSurge(float t, float ph) {
    float u = fract((t * ${LANTERN_BEAT.toFixed(2)} * aBell.y + ph) / 6.2831853 - 0.08);
    return (u < 0.3 ? u / 0.3 : 1.0 - (u - 0.3) / 0.7) - 0.5;
  }
`;
export const LANTERN_VERTEX = /* glsl */ `
  #include <begin_vertex>
  float ph = aJelly.x, hang = aJelly.y, amp = aHome.w, bell = aBell.x;
  vec3 local = position - aHome.xyz;
  float t = uSkyTime;
  if (bell >= 0.0) {
    // The bell: the crown squeezes first and the rim a beat later, so the
    // squeeze rolls down it; squeezed it is narrower and taller, and as it
    // relaxes the rim flares out past its rest width.
    float b = mqBeat(t, ph, (1.0 - bell) * 0.12);
    float rim = 1.0 - bell;
    local.xz *= 1.0 - b * (0.1 + 0.26 * rim) + (1.0 - b) * 0.08 * rim;
    local.y *= 1.0 + b * 0.16;
  } else {
    // Arms and lines trail: they hear the beat late, the later the lower.
    // On the squeeze they are drawn in and streamed straight behind the
    // surge; between beats they drift apart and wave.
    float b = mqBeat(t, ph, 0.14 + hang * 0.012);
    float r = length(local.xz) + 0.001;
    vec2 outward = local.xz / r;
    local.xz += outward * hang * (0.1 * (1.0 - b) - 0.05 * b);
    local.x += sin(t * 0.9 + ph - hang * 0.12) * hang * 0.07 * (1.0 - 0.6 * b);
    local.z += cos(t * 0.7 + ph * 1.7 - hang * 0.1) * hang * 0.06 * (1.0 - 0.6 * b);
    local.y -= b * hang * 0.1;
  }
  // The whole animal leans into its drift.
  vec2 vel = vec2(cos(t * 0.031 + ph * 2.0) * 28.0 * 0.031, -sin(t * 0.023 + ph * 1.3) * 22.0 * 0.023) * amp;
  local.xz += vel * local.y * 0.12;
  vec3 home = aHome.xyz;
  home.x += sin(t * 0.031 + ph * 2.0) * 28.0 * amp;
  home.z += cos(t * 0.023 + ph * 1.3) * 22.0 * amp;
  home.y += sin(t * 0.07 + ph) * 12.0 * amp + mqSurge(t, ph) * 3.2 * aJelly.z;
  transformed = home + local;
  // What the fragment stage needs to make it GLASS: how edge-on this face is
  // to the lens, how near the lantern's light it is, and what it is.
  vec3 toLens = normalize(cameraPosition - transformed);
  vSky = vec4(1.0 - abs(dot(normalize(normal), toLens)), exp(-dot(local, local) / (60.0 * aJelly.z * aJelly.z)), bell >= 0.0 ? 0.0 : 1.0, amp);
  vSkyBeat = mqBeat(t, ph, 0.0);
  // Three draws share this geometry. The lit core goes down first, opaque;
  // the shell then writes depth only; then its colour is blended over — so
  // the bell is see-through to its own light and the water behind, but never
  // to its own inner faces. Each draw folds away the voxels that are not its.
  bool coreVoxel = aGlow > 0.95 && bell >= 0.0;
  if ((uSkyPass < 0.5) != coreVoxel) transformed = home;
`;
export const LANTERN_COLOR = /* glsl */ `
  #include <color_vertex>
  // The light inside flares on the squeeze and runs down the lines after it.
  float lb = mqBeat(uSkyTime, aJelly.x, aBell.x >= 0.0 ? 0.0 : 0.1 + aJelly.y * 0.02);
  vColor.rgb *= 1.0 + aGlow * (0.15 + 0.85 * lb);
`;
/** Shader preamble both chunks need. */
export const LANTERN_PARS = 'varying vec4 vSky; varying float vSkyBeat;\n' + BEAT_GLSL;
/** Glass, in the blended draw: see-through face-on, solid and bright at a
 *  grazing edge (what makes a bell read as a dome of jelly, not a helmet),
 *  lit from inside by its own lantern — more on the squeeze — with a faint
 *  film of colour in the rim. Lines are nearly solid; the far giants fainter. */
export const LANTERN_FRAGMENT = /* glsl */ `
  #include <color_fragment>
  if (uSkyPass > 1.5) {
    float edge = pow(vSky.x, 1.35);
    vec3 inner = (diffuseColor.rgb * 0.55 + vec3(0.5, 0.46, 0.38)) * vSky.y * (0.45 + 0.75 * vSkyBeat);
    vec3 film = 0.5 + 0.5 * cos(vSky.x * 5.0 + vec3(0.0, 2.1, 4.2));
    diffuseColor.rgb = diffuseColor.rgb * (0.78 + 0.5 * edge) + inner + film * edge * 0.1;
    float glass = mix(0.3, 0.94, edge) + vSky.y * 0.18;
    diffuseColor.a = clamp(mix(glass, 0.86, vSky.z), 0.0, 1.0) * (vSky.w < 0.9 ? 0.7 : 1.0);
  }
`;

const FACES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 0, 1], [0, -1, 0, 0.5], [1, 0, 0, 0.82], [-1, 0, 0, 0.66], [0, 0, 1, 0.75], [0, 0, -1, 0.6],
];

class LanternWriter {
  readonly pos: number[] = []; readonly col: number[] = [];
  readonly home: number[] = []; readonly jelly: number[] = []; readonly glow: number[] = []; readonly bell: number[] = []; readonly nor: number[] = [];
  count = 0;
  l: Lantern = { x: 0, y: 0, z: 0, size: 1, phase: 0, color: '#fff', far: false, species: 'lantern', rate: 1 };

  /** `bell`: 0 (rim) … 1 (crown) for a voxel of the bell, -1 for anything that hangs from it. */
  cube(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, c: Color, hang: number, lit: number, bell = -1): void {
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
        this.bell.push(bell, l.rate);
        this.nor.push(nx, ny, nz);
      }
    }
    this.count += 1;
  }
}

export type LanternSpecies = 'moon' | 'lantern' | 'comb';
const SPECIES: Readonly<Record<LanternSpecies, { radii: readonly number[]; arms: number; armLen: number; lines: number; lineLen: readonly [number, number] }>> = {
  // A moon jelly: wide and shallow, a short frill, a fringe of fine lines.
  moon: { radii: [3.9, 4.3, 4.0, 3.1, 1.8], arms: 4, armLen: 4, lines: 12, lineLen: [3, 6] },
  // A lantern: a tall bell with long trailing lines — the one the motif is named for.
  lantern: { radii: [2.9, 3.3, 3.4, 3.1, 2.5, 1.5], arms: 3, armLen: 7, lines: 7, lineLen: [9, 17] },
  // A small comb: narrow, quick-looking, a few beaded lines.
  comb: { radii: [2.0, 2.4, 2.3, 1.7, 0.9], arms: 2, armLen: 3, lines: 5, lineLen: [5, 9] },
};
export const LANTERN_SPECIES = Object.keys(SPECIES) as LanternSpecies[];

/** One jellyfish, voxel by voxel: a stepped dome that is a SHELL (the light
 *  inside shows through windows left in it), a scalloped skirt, a lit core,
 *  ruffled arms and thin beaded lines. */
function growLantern(w: LanternWriter, l: Lantern, rng: CrystalRng): void {
  w.l = l;
  const sp = SPECIES[l.species];
  const u = 1.7 * l.size;
  const dim = l.far ? 0.3 : 1;
  const tint = new Color(l.color), whiteC = new Color('#ffffff');
  const rimC = tint.clone().multiplyScalar(0.5 * dim);
  const crownC = tint.clone().lerp(whiteC, 0.45).multiplyScalar(0.85 * dim);
  const core = tint.clone().lerp(new Color('#fff6e0'), 0.55).multiplyScalar(l.far ? 0.4 : 1);
  // Lines must read as LINES: nearly as bright as the bell, so the eye joins
  // them up; the beads are only a touch wider and warmer than the line.
  const line = tint.clone().lerp(whiteC, 0.2).multiplyScalar(0.78 * dim);
  const bead = tint.clone().lerp(whiteC, 0.6).multiplyScalar(dim);
  const arm = tint.clone().lerp(whiteC, 0.3).multiplyScalar(0.9 * dim);
  const layers = sp.radii.length;
  sp.radii.forEach((r, layer) => {
    const k = layer / (layers - 1); // 0 rim … 1 crown
    const shell = rimC.clone().lerp(crownC, k ** 0.8);
    const n = Math.ceil(r);
    for (let ix = -n; ix <= n; ix++) for (let iz = -n; iz <= n; iz++) {
      const d = Math.hypot(ix, iz);
      if (d > r) continue;
      // A shell, one to two voxels thick, closed over the crown.
      if (layer < layers - 2 && d < r - 1.35) continue;
      // Windows in the lower bell: the lantern's light shows through them.
      const bearing = Math.round((Math.atan2(iz, ix) / Math.PI) * 6);
      if (layer >= 1 && layer <= layers - 3 && d > r - 1.35 && (bearing + layer) % 3 === 0) {
        if (!l.far) w.cube(l.x + ix * u * 0.8, l.y + layer * u, l.z + iz * u * 0.8, u * 0.8, u, u * 0.8, core, 0, 1, k);
        continue;
      }
      // Radial stripes on the crown, the way a real bell is marked.
      const stripe = layer >= layers - 3 && bearing % 2 === 0;
      w.cube(l.x + ix * u, l.y + layer * u, l.z + iz * u, u, u, u, stripe ? shell.clone().multiplyScalar(1.18) : shell, 0, layer === 0 ? 0.35 : 0, k);
    }
  });
  // Scalloped skirt: every other rim voxel drops one. It belongs to the bell (it squeezes with the rim).
  const r0 = sp.radii[0]!, scallops = Math.round(r0 * 5.5);
  for (let i = 0; i < scallops; i++) {
    if (i % 2) continue;
    const a = (i / scallops) * Math.PI * 2;
    w.cube(l.x + Math.round(Math.cos(a) * r0) * u, l.y - u, l.z + Math.round(Math.sin(a) * r0) * u, u, u, u, rimC, 0, 0.5, 0);
  }
  // The flame.
  for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
    if (Math.abs(ix) + Math.abs(iz) === 2 && r0 < 2.6) continue;
    w.cube(l.x + ix * u, l.y + u * 0.6, l.z + iz * u, u, u * 1.6, u, core, 0, 1, 0.3);
  }
  // Oral arms: thick, ruffled — each step sits a little off the last — and lit.
  for (let k = 0; k < sp.arms; k++) {
    const a = (k / sp.arms) * Math.PI * 2 + rng.next();
    const len = sp.armLen + Math.floor(rng.next() * 3);
    for (let j = 1; j <= len; j++) {
      const wd = u * Math.max(0.5, 1.2 - j * 0.1), ruffle = (j % 2 ? 0.22 : -0.1) * u;
      w.cube(l.x + Math.cos(a) * (u * 0.9 + ruffle), l.y - j * u, l.z + Math.sin(a) * (u * 0.9 + ruffle), wd, u, wd,
        j % 2 ? arm : crownC, j * u, j % 2 ? 0.45 : 0.15);
    }
  }
  // Trailing lines from under the rim: thin, long, beaded with light.
  const lines = l.far ? Math.ceil(sp.lines * 0.6) : sp.lines;
  for (let k = 0; k < lines; k++) {
    const a = (k / lines) * Math.PI * 2 + rng.next() * 0.5;
    const len = sp.lineLen[0] + Math.floor(rng.next() * (sp.lineLen[1] - sp.lineLen[0] + 1));
    const rr = (r0 - 0.6) * u, every = 4 + Math.floor(rng.next() * 3);
    for (let j = 1; j <= len; j++) {
      const wd = u * Math.max(0.3, 0.62 - j * 0.022), lit = j % every === 0 && !l.far;
      w.cube(l.x + Math.cos(a) * rr, l.y - (j + 0.5) * u, l.z + Math.sin(a) * rr, lit ? wd * 1.2 : wd, u * 1.02, lit ? wd * 1.2 : wd, lit ? bead : line, j * u, lit ? 0.7 : 0.12);
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
      y: (isFar ? rng.range(110, 210) : rng.range(92, 175)) * s * (isFar ? 1 : opts.height ?? 1),
      size: (isFar ? rng.range(2.4, 3.6) : rng.range(0.75, 1.5)) * s,
      phase: rng.next() * Math.PI * 2,
      color: palette[Math.floor(rng.next() * palette.length)]!,
      far: isFar,
      // A flotilla is mostly lanterns, with moons among them and a few small combs.
      species: (['lantern', 'moon', 'lantern', 'comb', 'moon'] as const)[Math.floor(rng.next() * 5)]!,
      rate: 1,
    };
    // Small bells beat quicker; the far giants are slow.
    l.rate = isFar ? 0.62 : Math.min(1.35, Math.max(0.75, 1.3 - 0.32 * (l.size / s))) * rng.range(0.92, 1.08);
    lanterns.push(l);
    growLantern(w, l, rng.fork(10 + i));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(w.pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(w.col), 3));
  g.setAttribute('aHome', new BufferAttribute(new Float32Array(w.home), 4));
  g.setAttribute('aJelly', new BufferAttribute(new Float32Array(w.jelly), 3));
  g.setAttribute('aGlow', new BufferAttribute(new Float32Array(w.glow), 1));
  g.setAttribute('aBell', new BufferAttribute(new Float32Array(w.bell), 2));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(w.nor), 3));
  return { lanterns, geometry: g, voxels: w.count };
}

/** The light the near lanterns throw, at `t`, written into `out` in place —
 *  on the bell's beat, so it flares with the core the shader is drawing. */
export function lanternEmitters(lanterns: readonly Lantern[], t: number, out: Emitter[]): void {
  const p = { x: 0, y: 0, z: 0 };
  const c = new Color();
  let n = 0;
  for (const l of lanterns) {
    if (l.far) continue;
    lanternAt(l, t, p);
    c.set(l.color);
    const e = out[n] ?? (out[n] = { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, reach: 1, phase: 0 });
    const k = 0.55 * lanternLight(lanternBeat(t, l.phase, l.rate));
    e.x = p.x; e.y = p.y; e.z = p.z;
    e.r = c.r * k; e.g = c.g * k; e.b = c.b * k;
    e.reach = 58 * l.size; e.phase = l.phase;
    n += 1;
  }
  out.length = n;
}
