/**
 * Underwater signage: voxel signs that stand in the world beside its places.
 *
 *   plank     weathered boards nailed to a post, the lettering painted on
 *   arrow     a board cut to a point, aimed at another place
 *   ring      a life-ring hung on a post, a name plaque under it
 *   porthole  a brass porthole on a stone, its glass lit, a word or a fish
 *   neon      tube lettering on a dark board, glowing, a halo and a floor pool
 *   led       a dot-matrix board in the hackerfish's pixels; a long line scrolls
 *
 * Built like the streetlamps: sites tested against what already stands,
 * pushed as obstacles so fish go round them, light handed back as halos and
 * floor pools. Everything is cubes in one baked-colour draw, the lit parts in
 * a second, and one more draw per LED board (its own text texture). A sign is
 * read from the front: it faces the default camera, turned a little toward
 * the middle of the tank. Lettering is the 5×7 pixel font.
 */
import {
  BufferAttribute, BufferGeometry, Color, DataTexture, FrontSide, Group, Mesh, MeshBasicMaterial, NearestFilter,
  PlaneGeometry, RedFormat, UnsignedByteType, Vector4,
} from 'three';
import type { Emitter } from './crystals';
import { FONT_H, rasterText, type PixelText } from './pixel-font';
import { CubeWriter } from './scenery-paint';
import type { SignEntry } from './sign-mix';

interface Rng { next(): number; range(a: number, b: number): number; fork(n: number): Rng }
type Mark = { x: number; y: number; z: number };

export interface SignContext {
  rng: Rng;
  terrain: (x: number, z: number) => number;
  scale: number;
  /** The world's marks so far (gate, plaza, hub, fountain, home1…) and the open tank's. */
  marks: Readonly<Record<string, Mark>>;
  /** Is (x, z) clear of everything already standing, by r? */
  free: (x: number, z: number, r: number) => boolean;
  /** Uniforms the scenery advances to the scene time every frame. */
  clocks: { value: number }[];
}

export interface BuiltSigns {
  group: Group;
  obstacles: { x: number; y: number; z: number; r: number; h: number }[];
  halos: { x: number; y: number; z: number; color: string; size: number }[];
  lights: Emitter[];
  count: number;
}

const WOOD = ['#7a4f2c', '#8a5a33', '#6c4527', '#94653b'];
const DEFAULT_COLOR: Record<SignEntry['kind'], string> = {
  plank: '#f3e2b3', arrow: '#f3e2b3', ring: '#e8432e', porthole: '#8fe3ff', neon: '#ff4fa0', led: '#ffb347',
};
/** Glyph pixels in world units at size 1: letters ~4 tall, a 19-character plank ~70 wide (a fish is ~18, a home ~60). */
const PX = 0.6;
/** LED board: columns of LEDs, rows (7 + a row of margin each side). */
const LED_COLS = 60, LED_ROWS = 9;

/** One sign's writer: cubes in the sign's own frame (x right, y up, z out toward the reader). */
class SignFrame {
  constructor(private readonly w: CubeWriter, readonly x: number, readonly y: number, readonly z: number, readonly yaw: number) {}
  box(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: Color, flat = false): void {
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    this.w.cube(this.x + lx * cs + lz * sn, this.y + ly, this.z - lx * sn + lz * cs, sx, sy, sz, color, this.yaw, flat);
  }
  /** Lit pixels of `text`, centred on (cx, cy) in the sign's plane at depth lz. */
  text(t: PixelText, cx: number, cy: number, lz: number, px: number, depth: number, color: Color, flat = false): void {
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      if (!t.bits[y * t.w + x]) continue;
      this.box(cx + (x - (t.w - 1) / 2) * px, cy + ((t.h - 1) / 2 - y) * px, lz, px * 0.94, px * 0.94, depth, color, flat);
    }
  }
}

/** A board of horizontal planks with a little seeded wobble: weathered, not sawn yesterday. */
function planks(f: SignFrame, rng: Rng, cx: number, cy: number, w: number, h: number, d: number, px: number): void {
  const n = Math.max(2, Math.round(h / (4 * px)));
  const ph = h / n, c = new Color();
  for (let i = 0; i < n; i++) {
    c.set(WOOD[Math.floor(rng.next() * WOOD.length)]!).multiplyScalar(rng.range(0.85, 1.08));
    const shift = rng.range(-0.8, 0.8) * px, trim = rng.range(0, 1.4) * px;
    f.box(cx + shift, cy - h / 2 + ph * (i + 0.5), 0, w - trim, ph * 0.92, d, c);
  }
  // Two battens behind, nailed through: the board's own structure.
  c.set('#4e321c');
  for (const bx of [-w * 0.32, w * 0.32]) f.box(cx + bx, cy, -d * 0.9, px * 1.2, h * 0.96, d * 0.8, c);
  c.set('#b8b2a6');
  for (let i = 0; i < n; i++) for (const bx of [-w * 0.32, w * 0.32]) f.box(cx + bx, cy - h / 2 + ph * (i + 0.5), d * 0.52, px * 0.45, px * 0.45, px * 0.25, c, true);
}

function post(f: SignFrame, top: number, wide: number, color = '#5b3a20'): void {
  const c = new Color(color);
  // Sunk a little: the ground under a sign is rarely flat.
  f.box(0, top / 2 - 2, -0.6 * wide, wide, top + 4, wide, c);
}

/** A ring of cubes (a porthole's brass, a life-ring's foam). */
function ring(f: SignFrame, cx: number, cy: number, r: number, thick: number, d: number, colorAt: (a: number) => Color): void {
  const steps = Math.max(16, Math.round((r * Math.PI * 2) / (thick * 0.7)));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    f.box(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0, thick, thick, d, colorAt(a));
  }
}

/** A tiny fish for a porthole with no word: what's behind the glass. */
const FISH_ICON: PixelText = (() => {
  const rows = ['..##....', '.####.#.', '##.#####', '.####.#.', '..##....'];
  const bits = new Uint8Array(8 * 5);
  rows.forEach((r, y) => { for (let x = 0; x < 8; x++) bits[y * 8 + x] = r[x] === '#' ? 1 : 0; });
  return { w: 8, h: 5, bits };
})();

const LED_GLSL = /* glsl */ `
uniform sampler2D uLedText;
uniform vec4 uLedInfo;   // text width px, time, scroll (1/0), level
uniform vec3 uLedColor;
varying vec2 vLedUv;
vec3 mqLed() {
  vec2 cell = vLedUv * vec2(${LED_COLS}.0, ${LED_ROWS}.0);
  ivec2 c = ivec2(floor(cell));
  vec2 f = fract(cell) - 0.5;
  float w = uLedInfo.x, gap = 8.0, span = w + gap;
  // Columns of the text under this LED: scrolled right to left, or centred.
  float col = uLedInfo.z > 0.5
    ? mod(float(c.x) + floor(uLedInfo.y * 7.0), span) - 0.0
    : float(c.x) - floor((${LED_COLS}.0 - w) * 0.5);
  int row = ${LED_ROWS} - 2 - c.y;
  float on = 0.0;
  if (row >= 0 && row < ${FONT_H} && col >= 0.0 && col < w) on = texelFetch(uLedText, ivec2(int(col), row), 0).r;
  // A round LED in its socket; the dark ones just there.
  float dotr = 1.0 - smoothstep(0.30, 0.42, length(f));
  return uLedColor * dotr * (on * uLedInfo.w + 0.06) + uLedColor * 0.01;
}
`;

function ledMaterial(t: PixelText, color: Color, clocks: { value: number }[]): MeshBasicMaterial {
  const data = new Uint8Array(Math.max(1, t.w) * t.h);
  for (let i = 0; i < t.bits.length; i++) data[i] = t.bits[i] ? 255 : 0;
  const tex = new DataTexture(data, Math.max(1, t.w), t.h, RedFormat, UnsignedByteType);
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  tex.userData.mqOwned = true;
  const mat = new MeshBasicMaterial({ color, side: FrontSide });
  mat.userData.mqOwned = true;
  mat.userData.mqNoCaustic = true; // a display, not a surface
  mat.userData.mqGlowColor = color.getHex();
  const info = { value: new Vector4(t.w, 0, t.w > LED_COLS ? 1 : 0, 1) };
  const uniforms = { uLedText: { value: tex }, uLedInfo: info, uLedColor: { value: color.clone() } };
  // The scenery sets every clock to the scene time each frame: that is the scroll.
  clocks.push({ get value() { return info.value.y; }, set value(t: number) { info.value.y = t; } });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec2 vLedUv;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLedUv = uv;');
    shader.fragmentShader = LED_GLSL + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = mqLed();');
  };
  mat.customProgramCacheKey = () => 'mq-sign-led-v1';
  return mat;
}

/**
 * Where each sign stands. Beside its mark, on whichever side is clear (a sign
 * on the doorstep or the gate itself would block it); in the open, a seeded
 * spot across the front of the tank.
 */
function siteOf(e: SignEntry, i: number, ctx: SignContext, width: number, taken: Array<{ x: number; z: number; r: number }>): { x: number; z: number } {
  const s = ctx.scale, r = width / 2 + 4 * s;
  const clear = (x: number, z: number): boolean => ctx.free(x, z, r) && !taken.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + r);
  const mark = e.place ? ctx.marks[e.place] : undefined;
  if (mark) {
    // Beside it first, then out in front of it (toward the reader), then
    // further: never on the mark itself, which is a doorstep or a gateway.
    for (const dz of [10, 24, 40, 58]) for (const d of [14, 24, 36, 50]) for (const side of [1, -1]) {
      const x = mark.x + side * (d * s + width / 2), z = mark.z + dz * s;
      if (clear(x, z)) return { x, z };
    }
  }
  if (mark) {
    // Crowded round its mark: the nearest clear spot in front of it.
    for (let k = 1; k <= 12; k++) for (const side of [1, -1]) {
      const x = mark.x + side * k * 10 * s, z = mark.z + (30 + k * 6) * s;
      if (clear(x, z)) return { x, z };
    }
  }
  const rng = ctx.rng.fork(100 + i);
  for (let k = 0; k < 48; k++) {
    const x = rng.range(-110, 110) * s, z = rng.range(15, 85) * s;
    if (clear(x, z)) return { x, z };
  }
  return { x: (i % 2 ? 1 : -1) * (40 + 30 * i) * s, z: 40 * s };
}

export function buildSigns(entries: readonly SignEntry[], ctx: SignContext): BuiltSigns {
  const group = new Group();
  group.name = 'signs';
  const wood = new CubeWriter(), glow = new CubeWriter();
  const obstacles: BuiltSigns['obstacles'] = [], halos: BuiltSigns['halos'] = [], lights: Emitter[] = [];
  const taken: Array<{ x: number; z: number; r: number }> = [];
  const s = ctx.scale;
  const c = new Color(), dark = new Color();
  entries.forEach((e, i) => {
    const rng = ctx.rng.fork(i + 1);
    // LEDs and neon tubes read from further off: their pixels are bigger.
    const px = PX * s * e.size * (e.kind === 'led' ? 1.45 : e.kind === 'neon' ? 1.25 : 1);
    const t = rasterText(e.text);
    const color = new Color(e.color ?? DEFAULT_COLOR[e.kind]);
    // The footprint first, to find a site the sign fits.
    const textW = Math.max(t.w, 1) * px;
    const width = e.kind === 'led' ? (LED_COLS + 2) * px : e.kind === 'porthole' ? 18 * px : e.kind === 'ring' ? Math.max(22 * px, textW + 4 * px) : textW + 8 * px;
    const site = siteOf(e, i, ctx, width, taken);
    taken.push({ x: site.x, z: site.z, r: width / 2 + 6 * s });
    // Faces the front, turned a little toward the middle so the edge ones read.
    const yaw = Math.max(-0.5, Math.min(0.5, -site.x / Math.max(60 * s, Math.abs(site.z) + 160 * s))) + rng.range(-0.06, 0.06);
    const ground = ctx.terrain(site.x, site.z);
    const W = new SignFrame(wood, site.x, ground, site.z, yaw);
    const L = new SignFrame(glow, site.x, ground, site.z, yaw);
    let top = 0, lightAt = 0;

    if (e.kind === 'plank' || e.kind === 'arrow') {
      const h = (FONT_H + 4) * px, d = 1.3 * px, cy = 12 * s * Math.sqrt(e.size) + h / 2;
      post(W, cy + h * 0.2, 1.8 * px);
      const bw = Math.max(12 * px, textW + 6 * px);
      const target = e.target ? ctx.marks[e.target] : undefined;
      const dir = target ? (target.x >= site.x ? 1 : -1) : 1;
      if (e.kind === 'plank') planks(W, rng, 0, cy, bw, h, d, px);
      else {
        // The arrow's body, then its point stepped down a pixel a column.
        planks(W, rng, -dir * 2 * px, cy, bw, h, d, px);
        c.set(WOOD[i % WOOD.length]!);
        const steps = Math.ceil(h / px / 2);
        for (let k = 0; k < steps; k++) {
          W.box(dir * (bw / 2 - 2 * px + (k + 0.5) * px), cy, 0, px, h - 2 * k * px, d, c);
        }
      }
      if (t.w > 1) W.text(t, e.kind === 'arrow' ? -dir * 2 * px : 0, cy, d * 0.6, px, d * 0.35, color);
      top = cy + h / 2;
    } else if (e.kind === 'ring') {
      const R = 8 * px, thick = 3 * px, cy = 14 * s + R + 10 * px;
      post(W, cy + R + 2 * px, 1.8 * px);
      // A crossbar and two ropes: hung, not nailed.
      c.set('#5b3a20'); W.box(0, cy + R + 2 * px, -0.6 * px, 6 * px, 1.4 * px, 1.4 * px, c);
      c.set('#d8c79a');
      for (const rx of [-2.5 * px, 2.5 * px]) W.box(rx, cy + R + 0.5 * px, 0.4 * px, 0.4 * px, 3 * px, 0.4 * px, c);
      const white = new Color('#f1efe8');
      ring(W, 0, cy, R, thick, 2.6 * px, (a) => (Math.floor((a / (Math.PI * 2)) * 8 + 0.5) % 2 ? color : white));
      if (t.w > 1) {
        const pw = t.w * px + 4 * px, ph = (FONT_H + 3) * px, py = cy - R - thick - ph / 2 - 1 * px;
        c.set('#efe2bd'); W.box(0, py, 0, pw, ph, 1.2 * px, c);
        dark.set('#2a1a10'); W.text(t, 0, py, 0.75 * px, px, 0.3 * px, dark);
      }
      top = cy + R + 3 * px;
    } else if (e.kind === 'porthole') {
      const R = 7 * px, cy = 8 * s + R + 4 * px;
      // A squat stone it is set in.
      c.set('#4a5560'); W.box(0, cy / 2, -1.2 * px, R * 2.4, cy + R, 2.4 * px, c);
      const brass = new Color('#c9963c'), brassDark = new Color('#8a6424');
      ring(W, 0, cy, R + 1 * px, 2.2 * px, 2.2 * px, (a) => (Math.floor(a * 4 / Math.PI + 0.25) % 2 ? brass : brassDark));
      // The glass: a disc of lit pixels, the word (or a fish) dark across it.
      const art = t.w > 1 ? t : FISH_ICON;
      const ox = (art.w - 1) / 2, oy = (art.h - 1) / 2;
      const glass = color.clone().multiplyScalar(0.75), ink = color.clone().multiplyScalar(0.18);
      for (let gy = -R; gy <= R; gy += px) for (let gx = -R; gx <= R; gx += px) {
        if (Math.hypot(gx, gy) > R - 0.4 * px) continue;
        const ax = Math.round(gx / px + ox), ay = Math.round(oy - gy / px);
        const ink1 = ax >= 0 && ax < art.w && ay >= 0 && ay < art.h && art.bits[ay * art.w + ax];
        L.box(gx, cy + gy, 0.2 * px, px, px, 0.6 * px, ink1 ? ink : glass, true);
      }
      lightAt = cy; top = cy + R + 2 * px;
    } else if (e.kind === 'neon') {
      const tw = Math.max(t.w, 5) * px, h = (FONT_H + 6) * px, bw = tw + 8 * px, cy = 16 * s * Math.sqrt(e.size) + h / 2;
      // Two legs and a dark board; a tube round the edge, the letters in front.
      c.set('#2b2f38'); for (const lx of [-bw * 0.35, bw * 0.35]) W.box(lx, cy / 2, -1.5 * px, 1.2 * px, cy, 1.2 * px, c);
      c.set('#11141c'); W.box(0, cy, -0.6 * px, bw, h, 1.2 * px, c);
      const rim = color.clone().multiplyScalar(0.55);
      for (let x = -bw / 2 + px; x <= bw / 2 - px + 1e-6; x += px) {
        L.box(x, cy + h / 2 - px, 0.3 * px, px * 0.6, px * 0.6, px * 0.6, rim, true);
        L.box(x, cy - h / 2 + px, 0.3 * px, px * 0.6, px * 0.6, px * 0.6, rim, true);
      }
      for (let y = -h / 2 + px; y <= h / 2 - px + 1e-6; y += px) {
        L.box(-bw / 2 + px, cy + y, 0.3 * px, px * 0.6, px * 0.6, px * 0.6, rim, true);
        L.box(bw / 2 - px, cy + y, 0.3 * px, px * 0.6, px * 0.6, px * 0.6, rim, true);
      }
      if (t.w > 1) L.text(t, 0, cy, 0.5 * px, px, 0.8 * px, color, true);
      lightAt = cy; top = cy + h / 2;
    } else {
      // LED board: a housing on two legs, the face one quad its shader draws.
      const fw = LED_COLS * px, fh = LED_ROWS * px, cy = 16 * s * Math.sqrt(e.size) + fh / 2;
      c.set('#2b2f38'); for (const lx of [-fw * 0.38, fw * 0.38]) W.box(lx, cy / 2, -1.6 * px, 1.4 * px, cy, 1.4 * px, c);
      c.set('#1b1d22'); W.box(0, cy, -0.8 * px, fw + 2 * px, fh + 2 * px, 1.6 * px, c);
      const quad = new PlaneGeometry(fw, fh);
      quad.userData.mqOwned = true;
      const face = new Mesh(quad, ledMaterial(t, color, ctx.clocks));
      face.name = 'sign-led';
      face.position.set(site.x + Math.sin(yaw) * 0.05 * px, ground + cy, site.z + Math.cos(yaw) * 0.05 * px);
      face.rotation.y = yaw;
      group.add(face);
      lightAt = cy; top = cy + fh / 2 + px;
    }

    obstacles.push({ x: site.x, y: ground, z: site.z, r: Math.max(3 * s, width / 2), h: top + 4 * s });
    if (lightAt) {
      const y = ground + lightAt;
      halos.push({ x: site.x, y, z: site.z + 2 * s, color: `#${color.getHexString()}`, size: Math.min(60, width * 0.9) });
      lights.push({ x: site.x, y, z: site.z + 6 * s, r: color.r, g: color.g, b: color.b, reach: 30 * s, phase: i * 1.3 });
    }
  });

  const add = (w: CubeWriter, name: string): void => {
    if (!w.count) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(w.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(w.col), 3));
    g.userData.mqOwned = true;
    const m = new MeshBasicMaterial({ vertexColors: true, side: FrontSide });
    m.userData.mqOwned = true;
    if (name === 'signs-lit') { m.userData.mqNoCaustic = true; }
    const mesh = new Mesh(g, m);
    mesh.name = name;
    group.add(mesh);
  };
  add(wood, 'signs');
  add(glow, 'signs-lit');
  return { group, obstacles, halos, lights, count: entries.length };
}
