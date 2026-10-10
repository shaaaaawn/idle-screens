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
import { SUPPLY_GLSL } from './sign-supply';

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
  /** `signFlicker`, shared by every lit sign's shader and set each frame: how bad the wiring is. */
  flicker?: { value: number };
}

export interface BuiltSigns {
  group: Group;
  obstacles: { x: number; y: number; z: number; r: number; h: number }[];
  /** `supply`: the lit sign's power-supply id, so its halo can sag and die with it. */
  halos: { x: number; y: number; z: number; color: string; size: number; supply?: number }[];
  lights: Emitter[];
  count: number;
  /** Swap the text of the LED boards, in order of the entries, in place. */
  setLedTexts(texts: readonly string[]): void;
}

const WOOD = ['#7a4f2c', '#8a5a33', '#6c4527', '#94653b'];
const DEFAULT_COLOR: Record<SignEntry['kind'], string> = {
  plank: '#f3e2b3', arrow: '#f3e2b3', ring: '#e8432e', porthole: '#8fe3ff', neon: '#ff4fa0', led: '#ffb347',
};
/** Glyph pixels in world units at size 1: letters ~4 tall, a 19-character plank ~70 wide (a fish is ~18, a home ~60). */
const PX = 0.6;
/** LED board: columns of LEDs, rows (7 + a row of margin each side). */
const LED_COLS = 60, LED_ROWS = 9;

/**
 * One part of a sign: cubes in the part's own frame (x right, y up, z out
 * toward the reader), leaned by `lean` about (px, py) in its plane. Cubes stay
 * square to the frame — a lean moves them, it does not turn them — so a
 * leaning post or a crooked board steps a voxel at a time, which is how
 * pixel art leans. On the lit writer every cube carries a flicker tag.
 */
class SignFrame {
  tag = 0;
  constructor(private readonly w: CubeWriter, readonly x: number, readonly y: number, readonly z: number, readonly yaw: number,
    readonly lean = 0, readonly px = 0, readonly py = 0, private readonly tags: number[] | null = null) {}
  box(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: Color, flat = false): void {
    if (this.lean) {
      const dx = lx - this.px, dy = ly - this.py, cl = Math.cos(this.lean), sl = Math.sin(this.lean);
      lx = this.px + dx * cl - dy * sl; ly = this.py + dx * sl + dy * cl;
    }
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    this.w.cube(this.x + lx * cs + lz * sn, this.y + ly, this.z - lx * sn + lz * cs, sx, sy, sz, color, this.yaw, flat);
    if (this.tags) for (let k = 0; k < 36; k++) this.tags.push(this.tag);
  }
  /** The same part seen from behind: x mirrored, z flipped — for lettering on a sign's back. */
  back(): SignFrame {
    return new SignFrame(this.w, this.x, this.y, this.z, this.yaw + Math.PI, -this.lean, -this.px, this.py, this.tags);
  }
}

interface TextLook {
  /** Lit (no baked shade) — tubes and glass. */
  flat?: boolean;
  /** Paint that has flaked: this share of pixels gone, the rest a little uneven. */
  chip?: number;
  rng?: Rng;
  /** Neon: each letter its own flicker tag, from this base. */
  tagBase?: number;
}
/** Lit pixels of `text`, centred on (cx, cy) in the frame's plane at depth lz. */
function lettering(f: SignFrame, t: PixelText, cx: number, cy: number, lz: number, px: number, depth: number, color: Color, look: TextLook = {}): void {
  const c = new Color();
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    if (!t.bits[y * t.w + x]) continue;
    if (look.chip && look.rng && look.rng.next() < look.chip) continue;
    c.copy(color);
    if (look.chip && look.rng) c.multiplyScalar(look.rng.range(0.84, 1.04));
    if (look.tagBase !== undefined) f.tag = look.tagBase + 1 + Math.floor(x / 6);
    f.box(cx + (x - (t.w - 1) / 2) * px, cy + ((t.h - 1) / 2 - y) * px, lz, px * 0.94, px * 0.94, depth, c, look.flat);
  }
  f.tag = 0;
}

const shade = (c: Color, hex: string, rng: Rng, lo = 0.88, hi = 1.06): Color => c.set(hex).multiplyScalar(rng.range(lo, hi));

/**
 * A board of planks built from narrow staves, so a crooked board steps like
 * hand-cut wood: each plank its own wood and ragged ends, the bottom one
 * darker where the water sits, algae along its lower edge, two nails a
 * plank where it meets the post.
 */
function planks(f: SignFrame, rng: Rng, w: number, h: number, d: number, v: number, posts: readonly number[]): void {
  const rows = Math.max(2, Math.round(h / (3.6 * v)));
  const rh = h / rows, c = new Color(), stave = 2 * v;
  for (let r = 0; r < rows; r++) {
    const wood = WOOD[Math.floor(rng.next() * WOOD.length)]!;
    const wet = r === 0 ? 0.78 : 1;
    const left = -w / 2 - rng.range(-1.5, 1.5) * v, right = w / 2 + rng.range(-1.5, 1.5) * v;
    const y = -h / 2 + rh * (r + 0.5);
    for (let x = left; x < right - 1e-6; x += stave) {
      const sw = Math.min(stave, right - x);
      // Grain: neighbouring staves a shade apart; an end stave chewed a little shorter.
      const end = x === left || x + sw >= right - 1e-6;
      f.box(x + sw / 2, y, 0, sw * 1.02, rh * (end ? rng.range(0.7, 0.92) : 0.94), d, shade(c, wood, rng, 0.88 * wet, 1.05 * wet));
      if (r === 0 && rng.next() < 0.35) f.box(x + sw / 2, y - rh * 0.42, d * 0.25, sw, v * 0.7, d * 0.6, shade(c, '#4f7a3a', rng, 0.8, 1.1));
    }
    for (const px of posts) for (const side of [1, -1]) f.box(px, y, side * d * 0.55, v * 0.45, v * 0.45, v * 0.3, c.set('#a9a39a'), true);
  }
}

/** A post of stacked blocks (so it can lean), algae at its foot, a few pebbles round it. */
function post(f: SignFrame, rng: Rng, x: number, lz: number, top: number, wide: number, color: string, ground: SignFrame): void {
  const c = new Color();
  for (let y = -3 * wide; y < top; y += wide * 1.5) {
    f.box(x, y + wide * 0.75, lz, wide, Math.min(wide * 1.5, top - y) + 0.02, wide, shade(c, color, rng, 0.86, 1.04));
  }
  for (let k = 0; k < 4; k++) {
    if (rng.next() < 0.6) f.box(x + rng.range(-0.55, 0.55) * wide, rng.range(0, 1.6) * wide, lz + rng.range(-0.5, 0.5) * wide, wide * 0.5, wide * 0.6, wide * 1.1, shade(c, '#4f7a3a', rng, 0.75, 1.1));
  }
  // Pebbles kicked up round its foot, half sunk.
  for (let k = 0; k < 5; k++) {
    const a = rng.next() * Math.PI * 2, r = rng.range(0.9, 1.8) * wide, sz = rng.range(0.35, 0.7) * wide;
    ground.box(x + Math.cos(a) * r, sz * 0.15, lz + Math.sin(a) * r, sz, sz * 0.8, sz * rng.range(0.8, 1.2), shade(c, '#6b6458', rng, 0.75, 1.1));
  }
}

/** A ring of cubes (a porthole's brass, a life-ring's foam). */
function ring(f: SignFrame, cx: number, cy: number, r: number, thick: number, lz: number, d: number, colorAt: (a: number) => Color): void {
  const steps = Math.max(16, Math.round((r * Math.PI * 2) / (thick * 0.7)));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    f.box(cx + Math.cos(a) * r, cy + Math.sin(a) * r, lz, thick, thick, d, colorAt(a));
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
uniform vec4 uLedSwap;   // time the text last changed, -, -, -
uniform vec3 uLedColor;
uniform float uLedId;    // its power supply
uniform float uSignAmount;
varying vec2 vLedUv;
vec3 mqLed() {
  vec2 cell = vLedUv * vec2(${LED_COLS}.0, ${LED_ROWS}.0);
  ivec2 c = ivec2(floor(cell));
  vec2 f = fract(cell) - 0.5;
  float w = uLedInfo.x;
  // Columns of the text under this LED. A line longer than the board is a
  // marquee: it enters at the right edge when it is set, crosses, and comes
  // round again. A short one sits centred.
  float k = floor(max(0.0, uLedInfo.y - uLedSwap.x) * 7.0);
  float col = uLedInfo.z > 0.5
    ? float(c.x) - ${LED_COLS}.0 + mod(k, w + ${LED_COLS}.0)
    : float(c.x) - floor((${LED_COLS}.0 - w) * 0.5);
  // The supply: a tear slips a few rows sideways for a moment.
  float t = uLedInfo.y;
  vec3 ev = mqSupplyEvent(uLedId, t, uSignAmount);
  float u = t - ev.y;
  int r0 = 1 + int(ev.z * 5.0);
  if (ev.x == 3.0 && u >= 0.0 && u < 0.15 && c.y >= r0 && c.y < r0 + 3) col -= 1.0 + floor(ev.z * 2.0 + 0.5);
  int row = ${LED_ROWS} - 2 - c.y;
  float on = 0.0;
  if (row >= 0 && row < ${FONT_H} && col >= 0.0 && col < w) on = texelFetch(uLedText, ivec2(int(col), row), 0).r;
  // A row driver (or a run of columns) gone for a couple of seconds.
  if (ev.x == 2.0 && u >= 0.0 && u < 2.0 + ev.z * 0.5) {
    bool dead = ev.z < 0.5 ? c.y == 1 + int(ev.z * 12.0) : mod(float(c.x) + floor(ev.z * 97.0), 17.0) < 3.0;
    if (dead) on = 0.0;
  }
  float level = mqSupplyHum(uLedId, t, uSignAmount, ev);
  // A brown-out reboot: dark for a second, then the rows wake top to bottom.
  if (ev.x == 4.0 && u >= 0.0 && u < 2.2) level *= u < 1.0 ? 0.0 : step(float(${LED_ROWS} - 1 - c.y) / ${LED_ROWS}.0, (u - 1.0) / 1.2);
  // A round LED in its socket; the dark ones just there.
  float dotr = 1.0 - smoothstep(0.30, 0.42, length(f));
  return (uLedColor * dotr * (on * uLedInfo.w + 0.06) + uLedColor * 0.01) * level;
}
`;

function textTexture(t: PixelText): DataTexture {
  const data = new Uint8Array(Math.max(1, t.w) * t.h);
  for (let i = 0; i < t.bits.length; i++) data[i] = t.bits[i] ? 255 : 0;
  const tex = new DataTexture(data, Math.max(1, t.w), t.h, RedFormat, UnsignedByteType);
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  tex.userData.mqOwned = true;
  return tex;
}

/** What swaps an LED board's text without rebuilding the world: a new texture, the marquee restarted. */
export type LedBoard = (text: string) => void;

function ledMaterial(t: PixelText, color: Color, clocks: { value: number }[], supply: number, flicker: { value: number }): { material: MeshBasicMaterial; swap: LedBoard } {
  const tex = textTexture(t);
  const mat = new MeshBasicMaterial({ color, side: FrontSide });
  mat.userData.mqOwned = true;
  mat.userData.mqNoCaustic = true; // a display, not a surface
  mat.userData.mqDispose = () => text.value.dispose(); // the text texture lives in a uniform, not `map` (and a swap replaces it)
  mat.userData.mqGlowColor = color.getHex();
  const info = { value: new Vector4(t.w, 0, t.w > LED_COLS ? 1 : 0, 1) };
  const swapAt = { value: new Vector4(0, 0, 0, 0) };
  const text = { value: tex };
  const uniforms = { uLedText: text, uLedInfo: info, uLedSwap: swapAt, uLedColor: { value: color.clone() }, uLedId: { value: supply }, uSignAmount: flicker };
  // The scenery sets every clock to the scene time each frame: that is the scroll.
  clocks.push({ get value() { return info.value.y; }, set value(t: number) { info.value.y = t; } });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec2 vLedUv;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLedUv = uv;');
    shader.fragmentShader = SUPPLY_GLSL + LED_GLSL + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = mqLed();');
  };
  mat.customProgramCacheKey = () => 'mq-sign-led-v3';
  const swap: LedBoard = (next) => {
    const r = rasterText(next);
    text.value.dispose();
    text.value = textTexture(r);
    info.value.x = r.w;
    info.value.z = r.w > LED_COLS ? 1 : 0;
    swapAt.value.x = info.value.y; // the marquee starts again from the right edge, now
  };
  return { material: mat, swap };
}

/**
 * Where each sign stands. Beside its mark, on whichever side is clear (a sign
 * on the doorstep or the gate itself would block it); in the open, a seeded
 * spot across the front of the tank.
 */
function siteOf(e: SignEntry, i: number, ctx: SignContext, width: number, taken: Array<{ x: number; z: number; r: number }>): { x: number; z: number } | null {
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
  // In the open, a sign also keeps its own lane across the front: two clear
  // on the ground can still stand one behind the other as the camera sees
  // them, and the near one hides the far one's words.
  // Depth does not help: seen from the front, any two in one lane overlap.
  const ownLane = (x: number): boolean => !taken.some((t) => Math.abs(x - t.x) < t.r + r);
  for (let k = 0; k < 64; k++) {
    const x = rng.range(-150, 150) * s, z = rng.range(15, 85) * s;
    if (clear(x, z) && ownLane(x)) return { x, z };
  }
  for (let k = 0; k < 48; k++) {
    const x = rng.range(-110, 110) * s, z = rng.range(15, 85) * s;
    if (clear(x, z)) return { x, z };
  }
  // A crowded tank: search a wider band, still checked. No clear spot, no sign.
  const wide = ctx.rng.fork(200 + i);
  for (let k = 0; k < 96; k++) {
    const x = wide.range(-260, 260) * s, z = wide.range(10, 130) * s;
    if (clear(x, z)) return { x, z };
  }
  return null;
}

/** The lit parts' life: a slow hum, and now and then one letter of a neon sign
 *  hiccups (two short dips, a third of a second, once in many seconds — far
 *  under three changes a second, and a small part of the frame). */
const SIGN_LIT_GLSL = /* glsl */ `
uniform float uSignTime;
uniform float uSignAmount;
varying float vFlick;
// A tag is supply·64 + what it is: 1+ a letter, 63 the rim tube; 0 is steady glass.
float mqFlicker(float tag, float t) {
  if (tag < 0.5) return 1.0;
  float id = floor(tag / 64.0), letter = mod(tag, 64.0) - 1.0;
  vec3 e = mqSupplyEvent(id, t, uSignAmount);
  float u = t - e.y, level = mqSupplyHum(id, t, uSignAmount, e);
  // A tube gone for a couple of seconds; a letter buzzing dim for a moment.
  if (e.x == 2.0 && u >= 0.0 && u < 2.0 + e.z * 0.5 && letter == floor(e.z * 7.0)) level *= 0.08;
  if (e.x == 3.0 && u >= 0.0 && u < 0.15 && letter == floor(e.z * 5.0)) level *= 0.6;
  // A reboot: dark, then the tubes strike again left to right.
  if (e.x == 4.0 && u >= 0.0 && u < 2.2) level *= u < 1.0 ? 0.0 : step(min(letter, 9.0) * 0.12, u - 1.0);
  return level;
}
`;

export function buildSigns(entries: readonly SignEntry[], ctx: SignContext): BuiltSigns {
  const group = new Group();
  group.name = 'signs';
  const wood = new CubeWriter(), glow = new CubeWriter();
  const tags: number[] = [];
  const obstacles: BuiltSigns['obstacles'] = [], halos: BuiltSigns['halos'] = [], lights: Emitter[] = [];
  const taken: Array<{ x: number; z: number; r: number }> = [];
  // Each board knows which LED entry it is, so a skipped sign does not shift the others' words.
  const boards: Array<{ swap: LedBoard; text: string; ordinal: number }> = [];
  let ledOrdinal = 0, built = 0;
  const flicker = ctx.flicker ?? { value: 0 };
  const s = ctx.scale;
  const c = new Color();
  entries.forEach((e, i) => {
    const rng = ctx.rng.fork(i + 1);
    // Its own power supply, by its place in the list: the same sign keeps the same wiring.
    const supply = i + 1;
    // LEDs and neon tubes read from further off: their pixels are bigger.
    const v = PX * s * e.size * (e.kind === 'led' ? 1.45 : e.kind === 'neon' ? 1.25 : 1);
    const t = rasterText(e.text);
    const color = new Color(e.color ?? DEFAULT_COLOR[e.kind]);
    const textW = Math.max(t.w, 1) * v;
    // A porthole's glass grows to take its word (a 4-letter word is 23 px wide).
    const portR = Math.max(7, Math.ceil((t.w + 2) / 2)) * v;
    const boardW = Math.max(12 * v, textW + 6 * v);
    // The footprint first, to find a site the sign fits. A fingerpost can point any way.
    const width = e.kind === 'led' ? (LED_COLS + 2) * v : e.kind === 'porthole' ? 2 * portR + 12 * v
      : e.kind === 'ring' ? Math.max(24 * v, textW + 6 * v) : e.kind === 'arrow' ? boardW + 8 * v : e.kind === 'neon' ? boardW + 8 * v : boardW;
    const ordinal = e.kind === 'led' ? ledOrdinal++ : -1;
    const site = siteOf(e, i, ctx, width, taken);
    if (!site) return;
    taken.push({ x: site.x, z: site.z, r: width / 2 + 6 * s });
    built += 1;
    // Faces the front, turned a little toward the middle so the edge ones read.
    const yaw = Math.max(-0.5, Math.min(0.5, -site.x / Math.max(60 * s, Math.abs(site.z) + 160 * s))) + rng.range(-0.08, 0.08);
    const ground = ctx.terrain(site.x, site.z);
    const G = new SignFrame(wood, site.x, ground, site.z, yaw);
    let top = 0, lightAt = 0;

    if (e.kind === 'plank') {
      // A hand-made sign: crooked boards on one post (two when it is wide),
      // lettered both sides, the paint flaking.
      const h = (FONT_H + 4) * v, d = 1.3 * v, cy = 12 * s * Math.sqrt(e.size) + h / 2, pw = 1.8 * v;
      // Posts never stand behind the words (the back is lettered too): a wide
      // board between two end posts, a short one on a post that stops under its words.
      const two = boardW > 30 * v;
      const posts = two ? [-boardW / 2 - pw / 2, boardW / 2 + pw / 2] : [0];
      const lean = rng.range(-0.045, 0.045);
      const P = new SignFrame(wood, site.x, ground, site.z, yaw, lean);
      for (const x of posts) {
        post(P, rng, x, two ? 0 : -(d / 2 + pw / 2), two ? cy + h / 2 + 1.5 * v : cy - h / 2 + 1.8 * v, pw, '#5b3a20', G);
      }
      const B = new SignFrame(wood, site.x, ground + cy, site.z, yaw, lean + rng.range(-0.07, 0.07));
      planks(B, rng, boardW, h, d, v, two ? posts.map((x) => x - Math.sign(x) * (pw / 2 + 0.8 * v)) : []);
      if (t.w > 1) {
        lettering(B, t, 0, 0, d * 0.6, v, d * 0.3, color, { chip: 0.07, rng });
        lettering(B.back(), t, 0, 0, d * 0.6, v, d * 0.3, color, { chip: 0.07, rng });
      }
      top = cy + h / 2 + 2 * v;
    } else if (e.kind === 'arrow') {
      // A fingerpost: a tall capped post, the finger aimed at its place.
      const H = 24 * s * Math.sqrt(e.size), pw = 2 * v, h = (FONT_H + 3) * v, d = 1.2 * v;
      const P = new SignFrame(wood, site.x, ground, site.z, yaw, rng.range(-0.03, 0.03));
      post(P, rng, 0, 0, H, pw, '#5b3a20', G);
      P.box(0, H + 0.4 * v, 0, 3 * v, 0.8 * v, 3 * v, shade(c, '#4a2f1a', rng));
      P.box(0, H + 1.4 * v, 0, 1.4 * v, 1.2 * v, 1.4 * v, shade(c, '#c9963c', rng));
      const target = e.target ? ctx.marks[e.target] : undefined;
      let dx = (target ? target.x : 0) - site.x, dz = (target ? target.z : 0) - site.z;
      if (Math.hypot(dx, dz) < 1e-3) { dx = 1; dz = 0; }
      const fyaw = Math.atan2(-dz, dx), off = 1.1 * v + boardW / 2, fy = H - h / 2 - 1.5 * v;
      const F = new SignFrame(wood, site.x + Math.cos(fyaw) * off, ground + fy, site.z - Math.sin(fyaw) * off, fyaw, rng.range(-0.04, 0.02));
      planks(F, rng, boardW, h, d, v, [-boardW / 2 + 0.8 * v]);
      // The point, stepped down a voxel a column.
      const wood1 = WOOD[i % WOOD.length]!;
      for (let k = 0; k < Math.ceil(h / v / 2); k++) F.box(boardW / 2 + (k + 0.5) * v, 0, 0, v, h - 2 * k * v, d, shade(c, wood1, rng));
      if (t.w > 1) {
        lettering(F, t, -v, 0, d * 0.6, v, d * 0.3, color, { chip: 0.05, rng });
        lettering(F.back(), t, v, 0, d * 0.6, v, d * 0.3, color, { chip: 0.05, rng });
      }
      obstacles.push({ x: site.x + Math.cos(fyaw) * off, y: ground + fy - h, z: site.z - Math.sin(fyaw) * off, r: boardW / 2 + 2 * s, h: 2 * h });
      top = H + 2 * v;
    } else if (e.kind === 'ring') {
      // A dock piling: barnacled, a rope coiled at the top, the ring on a peg, a plaque under it.
      const R = 8 * v, thick = 3 * v, pw = 3.4 * v, cy = 14 * s + R + 10 * v, H = cy + R + 5 * v;
      const P = new SignFrame(wood, site.x, ground, site.z, yaw, rng.range(-0.05, 0.05));
      post(P, rng, 0, 0, H, pw, '#5a4632', G);
      const rope = new Color();
      for (const ry of [H - 2 * v, H - 3.1 * v]) {
        for (const [ox, oz, sx, sz] of [[0, pw / 2 + 0.3 * v, pw + 0.6 * v, 0.6 * v], [0, -pw / 2 - 0.3 * v, pw + 0.6 * v, 0.6 * v], [pw / 2 + 0.3 * v, 0, 0.6 * v, pw + 0.6 * v], [-pw / 2 - 0.3 * v, 0, 0.6 * v, pw + 0.6 * v]] as const) {
          P.box(ox, ry, oz, sx, 0.9 * v, sz, shade(rope, '#cdb98a', rng));
        }
      }
      for (let k = 0; k < 14; k++) {
        const side = Math.floor(rng.next() * 4), along = rng.range(-0.45, 0.45) * pw, y = rng.range(0.3, 0.45 * H);
        const [ox, oz] = side === 0 ? [along, pw / 2] : side === 1 ? [along, -pw / 2] : side === 2 ? [pw / 2, along] : [-pw / 2, along];
        const b = rng.range(0.35, 0.7) * v;
        P.box(ox, y, oz, b, b, b, shade(c, '#d9d4c7', rng, 0.8, 1.05));
      }
      const front = pw / 2 + 1.6 * v;
      P.box(0, cy + R + 0.6 * v, pw / 2 + 0.6 * v, 0.6 * v, 0.6 * v, 1.6 * v, c.set('#8d8a83'));
      const white = new Color('#f1efe8');
      ring(P, 0, cy, R, thick, front, 2.4 * v, (a) => (Math.floor((a / (Math.PI * 2)) * 8 + 0.5) % 2 ? color : white));
      // A rope round the ring at the stripes' seams: a real buoy's grab line.
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        P.box(Math.cos(a) * R, cy + Math.sin(a) * R, front, thick * 1.1, 0.5 * v, 2.8 * v, rope.set('#cdb98a'));
      }
      if (t.w > 1) {
        // A name plaque in small stencil letters: it belongs to the ring, not the other way round.
        const q = 0.62 * v, pw2 = t.w * q + 3 * q, ph = (FONT_H + 2.4) * q, py = cy - R - thick - ph / 2 - 1.2 * v;
        P.box(0, py, pw / 2 + 0.5 * v, pw2, ph, 0.8 * v, shade(c, '#efe2bd', rng, 0.9, 1));
        for (const nx of [-pw2 / 2 + q, pw2 / 2 - q]) P.box(nx, py, pw / 2 + 0.95 * v, 0.4 * v, 0.4 * v, 0.25 * v, c.set('#8d8a83'), true);
        lettering(P, t, 0, py, pw / 2 + 0.95 * v, q, 0.25 * v, new Color('#2a1a10'), { chip: 0.04, rng });
      }
      top = H + v;
    } else if (e.kind === 'porthole') {
      // A torn plate of a wreck, half in the sand at a lean, its porthole still lit.
      const R = portR, pw = 2 * R + 10 * v, ph = 2 * R + 12 * v, bury = 4 * v, d = 1.6 * v;
      const lean = (rng.next() < 0.5 ? -1 : 1) * rng.range(0.1, 0.2);
      const P = new SignFrame(wood, site.x, ground, site.z, yaw, lean);
      const tile = 3 * v, cols = Math.ceil(pw / tile), rowsN = Math.ceil(ph / tile);
      const pcy = ph / 2 - bury;
      for (let r = 0; r < rowsN; r++) for (let k = 0; k < cols; k++) {
        const x = -pw / 2 + (k + 0.5) * tile, y = -bury + (r + 0.5) * tile;
        // Torn: the top rows ragged.
        if (r >= rowsN - 2 && rng.next() < (r === rowsN - 1 ? 0.55 : 0.2)) continue;
        if (Math.hypot(x, y - pcy) < R + 1.5 * v) continue; // the porthole's own hole
        const paint = rng.next() < 0.22 ? '#2f5f6b' : rng.next() < 0.5 ? '#8a4b2a' : '#6e3b22';
        P.box(x, y, 0, tile * 1.01, tile * 1.01, d, shade(c, paint, rng, 0.8, 1.08));
        if (k % 2 === 0 && r % 2 === 0) P.box(x - tile / 2, y - tile / 2, d * 0.55, 0.5 * v, 0.5 * v, 0.4 * v, c.set('#3b2a20'));
      }
      const brass = new Color('#c9963c'), brassDark = new Color('#8a6424');
      ring(P, 0, pcy, R + v, 2.2 * v, d * 0.7, 2.2 * v, (a) => (Math.floor(a * 4 / Math.PI + 0.25) % 2 ? brass : brassDark));
      ring(P.back(), 0, pcy, R + v, 2 * v, d * 0.7, 1.4 * v, () => brassDark);
      const L = new SignFrame(glow, site.x, ground, site.z, yaw, lean, 0, 0, tags);
      const art = t.w > 1 ? t : FISH_ICON;
      const ox = (art.w - 1) / 2, oy = (art.h - 1) / 2;
      const glass = color.clone().multiplyScalar(0.75), ink = color.clone().multiplyScalar(0.18);
      for (let gy = -R; gy <= R; gy += v) for (let gx = -R; gx <= R; gx += v) {
        if (Math.hypot(gx, gy) > R - 0.4 * v) continue;
        const ax = Math.round(gx / v + ox), ay = Math.round(oy - gy / v);
        const on = ax >= 0 && ax < art.w && ay >= 0 && ay < art.h && art.bits[ay * art.w + ax];
        L.box(gx, pcy + gy, 0, v, v, d * 0.9, on ? ink : glass, true);
      }
      // Kelp has taken hold at its foot.
      for (const side of [-1, 1]) {
        let kx = side * (pw / 2 - rng.range(1, 4) * v);
        const n = 4 + Math.floor(rng.next() * 5);
        for (let k = 0; k < n; k++) {
          kx += rng.range(-0.6, 0.6) * v;
          G.box(kx, (k + 0.5) * 1.4 * v, d * 1.4, v * 0.8, 1.4 * v, v * 0.8, shade(c, '#3f7a3a', rng, 0.8, 1.15));
        }
      }
      lightAt = pcy; top = ph - bury;
    } else if (e.kind === 'neon') {
      // A shop's bracket sign: a metal post and arm, the box hung on two chains,
      // tubes on both faces, each letter its own flicker.
      const tw = Math.max(t.w, 5) * v, h = (FONT_H + 6) * v, bw = tw + 8 * v, cy = 15 * s * Math.sqrt(e.size) + h / 2;
      const px0 = -(bw / 2 + 3 * v), armY = cy + h / 2 + 4 * v, pw = 1.6 * v;
      const P = new SignFrame(wood, site.x, ground, site.z, yaw);
      post(P, rng, px0, 0, armY + 1.5 * v, pw, '#3a3f48', G);
      for (let x = px0; x <= bw / 2 + 0.5 * v; x += v) P.box(x, armY, 0, v * 1.02, 0.9 * v, 0.9 * v, shade(c, '#3a3f48', rng, 0.9, 1.05));
      P.box(px0 + 2 * v, armY - 1.6 * v, 0, 0.7 * v, 3.2 * v, 0.7 * v, c.set('#30343c'));
      for (const cx of [-bw * 0.36, bw * 0.36]) {
        for (let y = cy + h / 2; y < armY - 0.2 * v; y += 0.8 * v) P.box(cx, y + 0.4 * v, 0, 0.45 * v, 0.7 * v, (Math.round(y / v) % 2 ? 0.45 : 0.25) * v, c.set('#8d8a83'));
      }
      const swing = rng.range(-0.025, 0.025);
      const B = new SignFrame(wood, site.x, ground + cy, site.z, yaw, swing);
      B.box(0, 0, 0, bw, h, 1.2 * v, c.set('#11141c'));
      const rim = color.clone().multiplyScalar(0.55);
      for (const face of [new SignFrame(glow, site.x, ground + cy, site.z, yaw, swing, 0, 0, tags), new SignFrame(glow, site.x, ground + cy, site.z, yaw + Math.PI, -swing, 0, 0, tags)]) {
        face.tag = supply * 64 + 63; // the rim tube: on the sign's supply, never one of its letters
        for (let x = -bw / 2 + v; x <= bw / 2 - v + 1e-6; x += v) for (const y of [h / 2 - v, -h / 2 + v]) face.box(x, y, 0.9 * v, 0.6 * v, 0.6 * v, 0.6 * v, rim, true);
        for (let y = -h / 2 + 2 * v; y <= h / 2 - 2 * v + 1e-6; y += v) for (const x of [-bw / 2 + v, bw / 2 - v]) face.box(x, y, 0.9 * v, 0.6 * v, 0.6 * v, 0.6 * v, rim, true);
        face.tag = 0;
        if (t.w > 1) lettering(face, t, 0, 0, 1.0 * v, v, 0.8 * v, color, { flat: true, tagBase: supply * 64 });
      }
      obstacles.push({ x: site.x - Math.cos(yaw) * (bw / 2 + 3 * v), y: ground, z: site.z + Math.sin(yaw) * (bw / 2 + 3 * v), r: 3 * s, h: armY + 2 * v });
      lightAt = cy; top = cy + h / 2 + 5 * v;
    } else {
      // LED board: a housing on two legs, a face on each side its shader draws.
      const fw = LED_COLS * v, fh = LED_ROWS * v, cy = 16 * s * Math.sqrt(e.size) + fh / 2, hd = 1.6 * v;
      for (const lx of [-fw * 0.38, fw * 0.38]) post(G, rng, lx, 0, cy - fh / 2, 1.4 * v, '#2b2f38', G);
      G.box(0, cy, 0, fw + 2 * v, fh + 2 * v, hd, c.set('#1b1d22'));
      for (const [bx, by] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
        for (const side of [1, -1]) G.box(bx * (fw / 2 + 0.4 * v), cy + by * (fh / 2 + 0.4 * v), side * hd * 0.52, 0.45 * v, 0.45 * v, 0.2 * v, c.set('#6b6f78'), true);
      }
      const led = ledMaterial(t, color, ctx.clocks, supply, flicker);
      boards.push({ swap: led.swap, text: e.text, ordinal });
      for (const side of [1, -1]) {
        const quad = new PlaneGeometry(fw, fh);
        quad.userData.mqOwned = true;
        const face = new Mesh(quad, led.material);
        face.name = 'sign-led';
        const out = hd / 2 + 0.05 * v;
        face.position.set(site.x + Math.sin(yaw) * out * side, ground + cy, site.z + Math.cos(yaw) * out * side);
        face.rotation.y = side > 0 ? yaw : yaw + Math.PI;
        group.add(face);
      }
      lightAt = cy; top = cy + fh / 2 + v;
    }

    obstacles.push({ x: site.x, y: ground, z: site.z, r: Math.max(3 * s, Math.min(width, 40 * s) / 2), h: top + 4 * s });
    if (lightAt) {
      const y = ground + lightAt;
      halos.push({ x: site.x, y, z: site.z + 2 * s, color: `#${color.getHexString()}`, size: Math.min(60, width * 0.9), ...(e.kind === 'neon' || e.kind === 'led' ? { supply } : {}) });
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
    if (name === 'signs-lit') {
      m.userData.mqNoCaustic = true;
      g.setAttribute('aFlick', new BufferAttribute(new Float32Array(tags), 1));
      const time = { value: 0 };
      ctx.clocks.push(time);
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uSignTime = time;
        shader.uniforms.uSignAmount = flicker;
        shader.vertexShader = 'attribute float aFlick; varying float vFlick;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vFlick = aFlick;');
        shader.fragmentShader = SUPPLY_GLSL + SIGN_LIT_GLSL + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mqFlicker(vFlick, uSignTime);');
      };
      m.customProgramCacheKey = () => 'mq-signs-lit-v2';
    }
    const mesh = new Mesh(g, m);
    mesh.name = name;
    group.add(mesh);
  };
  add(wood, 'signs');
  add(glow, 'signs-lit');
  return {
    group, obstacles, halos, lights, count: built,
    setLedTexts(texts) {
      for (const b of boards) {
        const next = texts[b.ordinal];
        if (next === undefined || next === b.text) continue;
        b.text = next;
        b.swap(next);
      }
    },
  };
}
