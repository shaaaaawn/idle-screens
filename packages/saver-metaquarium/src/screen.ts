/**
 * A fish's screen: the hackerfish's face is a display, not paint.
 *
 * A `SCREEN-` material (the breed intake names them) becomes this display: a
 * 10×10 grid of phosphor pixels drawn on the screen voxels' FRONT faces — the
 * designer's own 5×5 face at twice the resolution, so every voxel of glass is
 * 2×2 pixels. The model is untouched; the display reads the model-space
 * position (before skinning), so it rides the screen bone and never swims.
 *
 * What it shows is set per frame by the breed's driver (hacker.ts): a glyph
 * (a face), the glyph it is wiping to (a scan-down refresh), or a mode — code
 * rain, a boot spinner, a glitch. All of it is a closed form in t, and none of
 * it flashes: a pixel changes at most a few times a second (WCAG's line is 3
 * flashes a second; the rain and the spinner change each pixel about once).
 */
import { Color, DataTexture, MeshBasicMaterial, NearestFilter, RedFormat, UnsignedByteType, Vector4, type Material, type Mesh, type Object3D } from 'three';

/** The faces, 10×10, top row first. `neutral` is the designer's own face, doubled. */
export const GLYPHS = {
  neutral: [
    '..........', '..........', '..##..##..', '..##..##..', '..........',
    '..........', '..######..', '..######..', '..........', '..........',
  ],
  blink: [
    '..........', '..........', '..........', '..##..##..', '..........',
    '..........', '..######..', '..######..', '..........', '..........',
  ],
  happy: [
    '..........', '..........', '..#....#..', '.#.#..#.#.', '..........',
    '.#......#.', '..######..', '...####...', '..........', '..........',
  ],
  wink: [
    '..........', '..........', '......##..', '.###..##..', '..........',
    '.#......#.', '..######..', '..........', '..........', '..........',
  ],
  love: [
    '..........', '..##..##..', '.########.', '.########.', '..######..',
    '...####...', '....##....', '..........', '..........', '..........',
  ],
  surprised: [
    '..........', '.###..###.', '.#.#..#.#.', '.###..###.', '..........',
    '....##....', '...#..#...', '...#..#...', '....##....', '..........',
  ],
  sleepy: [
    '......###.', '.......#..', '......###.', '.###..###.', '..........',
    '..........', '...####...', '..........', '..........', '..........',
  ],
  cool: [
    '..........', '##########', '.####.####', '.###...###', '..........',
    '..........', '.....###..', '..####....', '..........', '..........',
  ],
  focus: [
    '..........', '.##....##.', '..##..##..', '..##..##..', '..........',
    '..........', '...####...', '..........', '..........', '..........',
  ],
  glitchy: [
    '..........', '.#......#.', '..#....#..', '.#......#.', '..........',
    '..........', '..######..', '..#.##.#..', '..........', '..........',
  ],
  dead: [
    '..........', '.#.#..#.#.', '..#....#..', '.#.#..#.#.', '..........',
    '..........', '..######..', '..........', '..........', '..........',
  ],
} as const;
export type Glyph = keyof typeof GLYPHS;
export const GLYPH_NAMES = Object.keys(GLYPHS) as Glyph[];

/** What the screen is doing: faces (wiping from one to the next), or a mode. */
export const SCREEN_MODES = { face: 0, rain: 1, boot: 2, glitch: 3 } as const;
export type ScreenMode = keyof typeof SCREEN_MODES;

export interface ScreenState {
  /** The face showing, and the one being wiped in (the same when still). */
  from: Glyph;
  to: Glyph;
  /** 0..1: how far the scan-down refresh has drawn `to` over `from`. */
  wipe: number;
  mode: ScreenMode;
  /** 0..1: how bright the screen is (it dims to boot). */
  level: number;
}

/** The phosphors a screen comes in, one per fish: green, amber, cyan, the designer's pink, cold white. */
export const PHOSPHORS = ['#39ff88', '#ffb43a', '#4fd8ff', '#ff5fd2', '#dceaff'] as const;

let ATLAS: DataTexture | null = null;
/** Every glyph side by side, one byte a pixel, top row first. */
function atlas(): DataTexture {
  if (ATLAS) return ATLAS;
  const W = 10 * GLYPH_NAMES.length, data = new Uint8Array(W * 10);
  GLYPH_NAMES.forEach((name, g) => GLYPHS[name].forEach((row, y) => {
    for (let x = 0; x < 10; x++) data[y * W + g * 10 + x] = row[x] === '#' ? 255 : 0;
  }));
  ATLAS = new DataTexture(data, W, 10, RedFormat, UnsignedByteType);
  ATLAS.magFilter = ATLAS.minFilter = NearestFilter;
  ATLAS.needsUpdate = true;
  return ATLAS;
}

const SCREEN_GLSL = /* glsl */ `
uniform sampler2D uScrAtlas;
uniform vec4 uScrRect;   // x of the screen's left edge as seen from in front (its max x), min y, width, height
uniform vec4 uScrState;  // glyph from, glyph to, wipe 0..1, mode
uniform vec4 uScrColor;  // phosphor rgb, level
uniform vec4 uScrTime;   // t, seed, front plane z, -
varying vec3 vScrP;
varying vec3 vScrN;
float mqScrHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mqScrGlyph(float g, ivec2 c) {
  return texelFetch(uScrAtlas, ivec2(int(g) * 10 + c.x, 9 - c.y), 0).r;
}
vec3 mqScreen(vec3 base) {
  // Only the glass's front: the recess's walls are dark bezel.
  if (vScrN.z < 0.5 || vScrP.z < uScrTime.z - 0.05) return vec3(0.015, 0.012, 0.022);
  vec2 uv = vec2((uScrRect.x - vScrP.x) / uScrRect.z, (vScrP.y - uScrRect.y) / uScrRect.w);
  vec2 g = clamp(uv, 0.0, 0.9999) * 10.0;
  ivec2 c = ivec2(floor(g));
  vec2 f = fract(g);
  float t = uScrTime.x, seed = uScrTime.y;
  int mode = int(uScrState.w + 0.5);
  float on = 0.0;
  if (mode == 1) {
    // Code rain: each column a drop falling at its own pace, a fading trail behind.
    float col = float(c.x);
    float speed = 0.45 + 0.6 * mqScrHash(vec2(col, seed));
    float head = fract(t * speed + mqScrHash(vec2(seed, col))) * 15.0 - 3.0;
    float d = head - float(9 - c.y);
    on = d >= 0.0 && d < 5.0 ? (d < 1.0 ? 1.0 : 0.75 - 0.15 * d) : 0.0;
  } else if (mode == 2) {
    // Booting: eight dots round a ring, one lit, the last few fading behind it.
    vec2 q = vec2(c) + 0.5 - 5.0;
    float r = length(q);
    if (r > 2.4 && r < 4.2) {
      float dot8 = floor(fract(-atan(q.y, q.x) / 6.2831853 + 0.25) * 8.0) / 8.0; // clockwise from the top
      float behind = fract(fract(t * 0.9) - dot8);  // how long since the light passed this dot
      on = behind < 0.375 ? 1.0 - behind * 2.2 : 0.06;
    }
  } else {
    ivec2 cc = c;
    if (mode == 3) {
      // Glitch: rows torn sideways, re-torn a couple of times a second.
      float k = floor((mqScrHash(vec2(float(c.y), floor(t * 2.5) + seed)) - 0.5) * 5.0);
      cc.x = int(mod(float(c.x) + k, 10.0));
    }
    float g0 = mqScrGlyph(uScrState.x, cc), g1 = mqScrGlyph(uScrState.y, cc);
    // The refresh scans down: rows above the beam already show the new face.
    on = float(9 - c.y) < uScrState.z * 10.0 ? g1 : g0;
  }
  // An LCD's pixel: a lit square with a dark gap, the unlit ones faintly there.
  vec2 e = min(f, 1.0 - f);
  float cell = smoothstep(0.06, 0.13, min(e.x, e.y));
  float scan = 0.92 + 0.08 * sin((uv.y * 40.0 - t * 1.2) * 3.14159);
  vec3 col = uScrColor.rgb;
  float lvl = uScrColor.w;
  // The unlit pixels just there, the glass between them near black.
  return col * cell * (on * lvl * scan + 0.03) + col * 0.008;
}
`;

/** The display material for one fish's screen, in its phosphor. */
export function screenMaterial(name: string, phosphor: Color): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({ color: phosphor });
  mat.name = name;
  mat.userData.mqOwned = true;
  mat.userData.mqNoCaustic = true; // a display, not a surface
  mat.userData.mqScreen = true;
  mat.userData.mqGlowColor = phosphor.getHex();
  const uniforms = {
    uScrAtlas: { value: atlas() },
    uScrRect: { value: new Vector4(5, -5, 10, 10) },
    uScrState: { value: new Vector4(0, 0, 0, 0) },
    uScrColor: { value: new Vector4(phosphor.r, phosphor.g, phosphor.b, 1) },
    uScrTime: { value: new Vector4(0, 0, 15, 0) },
  };
  mat.userData.mqScreenUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vScrP; varying vec3 vScrN;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vScrP = position; vScrN = normal;');
    shader.fragmentShader = SCREEN_GLSL
      + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = mqScreen(diffuseColor.rgb);');
  };
  mat.customProgramCacheKey = () => 'mq-screen-v1';
  return mat;
}

export function isScreen(m: Material): boolean {
  return /^SCREEN-/.test(m.name);
}

export interface ScreenRig {
  uniforms: Array<Record<string, { value: Vector4 }>>;
  seed: number;
}

/** Measures the screen on a freshly cloned body (identity transform) and
 *  hands back what the driver sets each frame; null when it has no screen. */
export function rigScreen(body: Object3D, seed: number): ScreenRig | null {
  const mats: MeshBasicMaterial[] = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = -Infinity;
  body.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || !mesh.material.userData.mqScreen) return;
    mats.push(mesh.material as MeshBasicMaterial);
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      x0 = Math.min(x0, p.getX(i)); x1 = Math.max(x1, p.getX(i));
      y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i));
      z1 = Math.max(z1, p.getZ(i));
    }
  });
  if (!mats.length) return null;
  const uniforms = mats.map((m) => m.userData.mqScreenUniforms as Record<string, { value: Vector4 }>);
  for (const u of uniforms) {
    // Seen from in front (the fish faces +z), the screen's left is its max x.
    u.uScrRect!.value.set(x1, y0, x1 - x0, y1 - y0);
    u.uScrTime!.value.set(0, seed, z1, 0);
  }
  return { uniforms, seed };
}

export function setScreen(rig: ScreenRig, t: number, s: ScreenState): void {
  for (const u of rig.uniforms) {
    u.uScrState!.value.set(GLYPH_NAMES.indexOf(s.from), GLYPH_NAMES.indexOf(s.to), s.wipe, SCREEN_MODES[s.mode]);
    u.uScrColor!.value.w = s.level;
    u.uScrTime!.value.x = t;
  }
}
