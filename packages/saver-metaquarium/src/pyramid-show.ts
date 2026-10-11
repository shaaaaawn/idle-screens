/**
 * The light shows a lit pyramid (`led`, `neon`, or a stone one's lit trim) runs:
 * an arena's pyramid of light, under water.
 *
 *   rings      bands of light climbing the layers
 *   beam       a beam sweeping round the faces, a fainter one behind it
 *   edges      the edges and the base lit, a pulse running up them
 *   equalizer  bars rising and falling up every face, green to red
 *   rainbow    a rainbow washing across the cubes
 *   twinkle    every lamp on its own slow twinkle
 *   faces      each face its own colour, the colours turning round
 *   rain       drops of light running down the faces
 *   spiral     a helix of light winding up
 *   breathe    the whole pyramid breathing, a wave up through it
 *   ripple     rings dropping from the apex
 *
 * The field plays as one (`pyramidShow`): every lit pyramid on one clock and
 * one routine — a wave rolling across the field, each a beat behind the one
 * before it — through the routines in turn, or a named one, or a cue sheet
 * (`8s:rings, 8s:beam, 16s:equalizer`). `solo` gives each its own. With
 * `pyramidBpm` the motion steps on the beat (move, hold) and each beat lifts
 * the lamps a little — under a tenth, so a beat is never a flash.
 *
 * Small ones (under six layers) have too few cubes for a beam or an
 * equalizer to read: they run a show that does (`smallShow`).
 *
 * ONE model, written twice: `showLamp` here (the halo, the floor's light, the
 * flash-safety test) and SHOW_GLSL for the lamps. Their constants are the
 * same table (`K`). The hash differs (float32 sin in GLSL), so a twinkle's
 * phases do; its rates, and so its flash count, do not.
 */

export const PYRAMID_SHOWS = ['rings', 'beam', 'edges', 'equalizer', 'rainbow', 'twinkle', 'faces', 'rain', 'spiral', 'breathe', 'ripple'] as const;
export type PyramidShow = (typeof PYRAMID_SHOWS)[number];

/** Seconds a routine runs in the field's own sequence, and the crossfade into the next. */
export const SHOW_HOLD = 24;
export const SHOW_FADE = 3;
/** The beat's lift: under the 10% a flash needs. */
export const BEAT_LIFT = 0.08;
/** The fastest the tempo goes (2.33 beats a second: a step a beat stays well under three flashes a second). */
export const MAX_BPM = 140;
/** How fast the field's wave rolls across it, in world units a second. */
export const WAVE_SPEED = 120;

/** The shows' constants, shared by both copies. Every rate is radians (or cycles) a second at its fastest per lamp. */
const K = {
  ringsSpeed: 0.25, ringsWidth: 0.14,
  beamSpeed: 0.16,
  edgePulse: 2.0,
  eqA: 1.3, eqB: 0.7,
  rainbowSpeed: 1.1,
  twinkleMin: 2.0, twinkleSpan: 2.0,
  facesSpeed: 0.9,
  rainSpeed: 0.35,
  spiralSpeed: 0.2,
  breatheSpeed: 0.9,
  rippleSpeed: 0.3,
} as const;

const frac = (x: number): number => x - Math.floor(x);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const band = (x: number, w: number): number => { const f = frac(x); return 1 - smoothstep(0, w, Math.min(f, 1 - f)); };
const hash = (x: number, y: number, z: number): number => frac(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);

/** The show a small pyramid runs in place of one that needs more cubes than it has. */
export function smallShow(p: number, top: number): number {
  if (top >= 6) return p;
  // beam → faces, equalizer → breathe, rain → twinkle, spiral → rings
  return p === 1 ? 6 : p === 3 ? 9 : p === 7 ? 5 : p === 8 ? 0 : p;
}

/**
 * One lamp: how lit (0..1) and its hue, in show `p` at show time `t`. `c` is
 * its cube (x, z about the axis, y the layer), `u`/`w` the sorted |x|, |z|,
 * `top` the apex layer, `seed` the pyramid's own number.
 */
export function showLamp(p: number, cx: number, cy: number, cz: number, u: number, w: number, top: number, seed: number, t: number): [number, number] {
  const y = cy / Math.max(top, 1), ang = Math.atan2(cz, cx) / 6.2832 + 0.5;
  switch (p) {
    case 0: return [band(y * 1.5 - t * K.ringsSpeed, K.ringsWidth), y * 0.5 + t * 0.03];
    case 1: return [Math.max(band(ang - t * K.beamSpeed, 0.1), 0.6 * band(ang + 0.5 - t * K.beamSpeed, 0.08)), ang + t * 0.02];
    case 2: {
      const edge = Math.max(u >= w - 0.5 ? 1 : 0, cy <= 0.5 ? 1 : 0);
      return [edge * (0.6 + 0.4 * Math.sin(t * K.edgePulse - cy * 0.5)), 0.55 + 0.05 * Math.sin(t * 0.3)];
    }
    case 3: {
      const h = top * (0.3 + 0.35 * (0.5 + 0.5 * Math.sin(t * K.eqA + u * 0.9 + seed * 5)) + 0.3 * (0.5 + 0.5 * Math.sin(t * K.eqB + u * 0.37)));
      return [(cy <= h ? 1 : 0) * (0.55 + 0.45 * cy / Math.max(h, 1)), 0.33 - 0.33 * y];
    }
    case 4: return [0.7 + 0.3 * Math.sin(t * K.rainbowSpeed + (u + cy) * 0.5), frac(cy * 0.04 + u * 0.03 - t * 0.06)];
    case 5: {
      const r = hash(cx + seed, cy + seed, cz + seed);
      const rate = K.twinkleMin + K.twinkleSpan * hash(cx * 1.7 + seed, cy * 1.7 + seed, cz * 1.7 + seed);
      return [(0.5 + 0.5 * Math.sin(t * rate + r * 6.2832)) ** 3, r];
    }
    case 6: {
      const f = Math.abs(cx) >= Math.abs(cz) ? (cx >= 0 ? 0 : 2) : (cz >= 0 ? 1 : 3);
      return [0.8 + 0.2 * Math.sin(t * K.facesSpeed + f * 1.5708), f * 0.25 + t * 0.03];
    }
    case 7: {
      const f = Math.abs(cx) >= Math.abs(cz) ? (cx >= 0 ? 0 : 2) : (cz >= 0 ? 1 : 3);
      const col = hash(u, f, seed), s = top - cy;
      const drop = frac(t * K.rainSpeed * (0.7 + 0.6 * col) + col * 3.1) * (top + 6) - 2;
      const tail = drop - s;
      return [tail >= 0 ? 1 - smoothstep(0, 4, tail) : 0, 0.58 + 0.1 * col];
    }
    case 8: return [band(ang * 2 + y * 1.5 - t * K.spiralSpeed, 0.1), y * 0.3 + t * 0.02 + 0.8];
    case 9: return [0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * K.breatheSpeed - y * 1.2)), 0.62 + 0.1 * Math.sin(t * 0.13)];
    default: return [band(y * 2 + t * K.rippleSpeed, 0.12), 0.9 + y * 0.2];
  }
}

/** The GLSL copy of `showLamp` (and `smallShow`), its constants from the same table. Needs `mqPyrH` and `mqBand`. */
export const SHOW_GLSL = /* glsl */ `
float mqSmallShow(float p, float top) {
  if (top >= 6.0) return p;
  return p == 1.0 ? 6.0 : p == 3.0 ? 9.0 : p == 7.0 ? 5.0 : p == 8.0 ? 0.0 : p;
}
float mqFace(vec3 c) { return abs(c.x) >= abs(c.z) ? (c.x >= 0.0 ? 0.0 : 2.0) : (c.z >= 0.0 ? 1.0 : 3.0); }
vec2 mqPyrShow(float p, vec3 c, float u, float w, float top, float seed, float t) {
  float y = c.y / max(top, 1.0), ang = atan(c.z, c.x) / 6.2832 + 0.5;
  if (p < 0.5) return vec2(mqBand(y * 1.5 - t * ${K.ringsSpeed}, ${K.ringsWidth}), y * 0.5 + t * 0.03);
  if (p < 1.5) return vec2(max(mqBand(ang - t * ${K.beamSpeed}, 0.1), 0.6 * mqBand(ang + 0.5 - t * ${K.beamSpeed}, 0.08)), ang + t * 0.02);
  if (p < 2.5) {
    float edge = max(u >= w - 0.5 ? 1.0 : 0.0, c.y <= 0.5 ? 1.0 : 0.0);
    return vec2(edge * (0.6 + 0.4 * sin(t * ${K.edgePulse.toFixed(2)} - c.y * 0.5)), 0.55 + 0.05 * sin(t * 0.3));
  }
  if (p < 3.5) {
    float h = top * (0.3 + 0.35 * (0.5 + 0.5 * sin(t * ${K.eqA} + u * 0.9 + seed * 5.0)) + 0.3 * (0.5 + 0.5 * sin(t * ${K.eqB} + u * 0.37)));
    return vec2((c.y <= h ? 1.0 : 0.0) * (0.55 + 0.45 * c.y / max(h, 1.0)), 0.33 - 0.33 * y);
  }
  if (p < 4.5) return vec2(0.7 + 0.3 * sin(t * ${K.rainbowSpeed} + (u + c.y) * 0.5), fract(c.y * 0.04 + u * 0.03 - t * 0.06));
  if (p < 5.5) {
    float r = mqPyrH(c + seed);
    float rate = ${K.twinkleMin.toFixed(2)} + ${K.twinkleSpan.toFixed(2)} * mqPyrH(c * 1.7 + seed);
    return vec2(pow(0.5 + 0.5 * sin(t * rate + r * 6.2832), 3.0), r);
  }
  if (p < 6.5) { float f = mqFace(c); return vec2(0.8 + 0.2 * sin(t * ${K.facesSpeed} + f * 1.5708), f * 0.25 + t * 0.03); }
  if (p < 7.5) {
    float f = mqFace(c), col = mqPyrH(vec3(u, f, seed)), s = top - c.y;
    float drop = fract(t * ${K.rainSpeed} * (0.7 + 0.6 * col) + col * 3.1) * (top + 6.0) - 2.0, tail = drop - s;
    return vec2(tail >= 0.0 ? 1.0 - smoothstep(0.0, 4.0, tail) : 0.0, 0.58 + 0.1 * col);
  }
  if (p < 8.5) return vec2(mqBand(ang * 2.0 + y * 1.5 - t * ${K.spiralSpeed}, 0.1), y * 0.3 + t * 0.02 + 0.8);
  if (p < 9.5) return vec2(0.25 + 0.75 * (0.5 + 0.5 * sin(t * ${K.breatheSpeed} - y * 1.2)), 0.62 + 0.1 * sin(t * 0.13));
  return vec2(mqBand(y * 2.0 + t * ${K.rippleSpeed}, 0.12), 0.9 + y * 0.2);
}
`;

// ---------------------------------------------------------------------------
// The field's choreography
// ---------------------------------------------------------------------------

export interface ShowCue { seconds: number; show: number }
export type ShowPlan = { mode: 'solo' } | { mode: 'sequence' } | { mode: 'cues'; cues: ShowCue[]; length: number };

/** `pyramidShow`: '' or `auto` (the field in unison, through every routine), `solo` (each its own), a routine's name, or a cue sheet `8s:rings, 8s:beam`. */
export function parsePyramidShow(src: string): { plan: ShowPlan; problems: string[] } {
  const s = src.trim().toLowerCase();
  if (!s || s === 'auto') return { plan: { mode: 'sequence' }, problems: [] };
  if (s === 'solo') return { plan: { mode: 'solo' }, problems: [] };
  const named = PYRAMID_SHOWS.indexOf(s as PyramidShow);
  if (named >= 0) return { plan: { mode: 'cues', cues: [{ seconds: 1e9, show: named }], length: 1e9 }, problems: [] };
  const cues: ShowCue[] = [], problems: string[] = [];
  for (const raw of s.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^([0-9]+(?:\.[0-9]+)?)\s*s\s*:\s*([a-z]+)$/.exec(part);
    const show = m ? PYRAMID_SHOWS.indexOf(m[2] as PyramidShow) : -1;
    if (!m || show < 0 || !(Number(m[1]) >= 2)) {
      problems.push(`"${part}": expected <seconds ≥ 2>s:<routine>, the routines ${PYRAMID_SHOWS.join(' ')}`);
      continue;
    }
    cues.push({ seconds: Number(m[1]), show });
  }
  if (!cues.length) return { plan: { mode: 'sequence' }, problems: problems.length ? problems : ['an empty cue sheet'] };
  return { plan: { mode: 'cues', cues, length: cues.reduce((n, c) => n + c.seconds, 0) }, problems };
}

/** Where the field is in its plan at `t`: the routine, the next, and how far into the crossfade (0..1). `a` is -1 for solo. */
export function showState(plan: ShowPlan, t: number): { a: number; b: number; mix: number } {
  if (plan.mode === 'solo') return { a: -1, b: -1, mix: 0 };
  if (plan.mode === 'sequence') {
    const slot = Math.floor(t / SHOW_HOLD), into = t - slot * SHOW_HOLD;
    const at = (k: number): number => ((k % PYRAMID_SHOWS.length) + PYRAMID_SHOWS.length) % PYRAMID_SHOWS.length;
    return { a: at(slot), b: at(slot + 1), mix: smoothstep(SHOW_HOLD - SHOW_FADE, SHOW_HOLD, into) };
  }
  const { cues, length } = plan;
  let into = ((t % length) + length) % length, i = 0;
  while (into >= cues[i]!.seconds) { into -= cues[i]!.seconds; i = (i + 1) % cues.length; }
  const cue = cues[i]!, next = cues[(i + 1) % cues.length]!;
  const fade = Math.min(SHOW_FADE, cue.seconds * 0.4);
  return { a: cue.show, b: next.show, mix: cues.length > 1 ? smoothstep(cue.seconds - fade, cue.seconds, into) : 0 };
}

/** The shows' clock: seconds, or — with a tempo — stepped on the beat (move half a beat, hold half), and the beat's lift. */
export function showTime(t: number, bpm: number): { t: number; lift: number } {
  if (!(bpm > 0)) return { t, lift: 0 };
  const bps = Math.min(MAX_BPM, bpm) / 60, b = t * bps, k = Math.floor(b), f = b - k;
  return { t: (k + smoothstep(0, 0.5, f)) / bps, lift: BEAT_LIFT * (1 - smoothstep(0, 0.6, f)) };
}

/** A solo pyramid's own routines: its own sequence, offset by its seed (as the GLSL's). */
export function soloState(seed: number, t: number): { a: number; b: number; mix: number } {
  const tt = t + seed * 40, slot = Math.floor(tt / SHOW_HOLD), into = tt - slot * SHOW_HOLD;
  const at = (k: number): number => Math.floor(frac(seed * 7.13 + k * 0.618) * PYRAMID_SHOWS.length);
  return { a: at(slot), b: at(slot + 1), mix: smoothstep(SHOW_HOLD - SHOW_FADE, SHOW_HOLD, into) };
}

/** A lamp's light (0..1) in the field's show at `t` — the whole of what the shader draws but the colour. */
export function lampLevel(plan: ShowPlan, bpm: number, phase: number, seed: number, cx: number, cy: number, cz: number, top: number, t: number): number {
  // The field switches routines together; the wave is in the motion (as the GLSL's).
  const st = plan.mode === 'solo' ? soloState(seed, t) : showState(plan, t);
  return lampLevelIn(st, bpm, phase, seed, cx, cy, cz, top, t);
}

/** `lampLevel` for a known show state (a, b, mix; a -1 for solo, as the shader's uniforms carry it). */
export function lampLevelIn(state: { a: number; b: number; mix: number }, bpm: number, phase: number, seed: number, cx: number, cy: number, cz: number, top: number, t: number): number {
  const st = state.a < 0 ? soloState(seed, t) : state;
  const u = Math.min(Math.abs(cx), Math.abs(cz)), w = Math.max(Math.abs(cx), Math.abs(cz));
  const clock = showTime(t - phase, bpm);
  const a = showLamp(smallShow(st.a, top), cx, cy, cz, u, w, top, seed, clock.t)[0];
  const b = showLamp(smallShow(st.b, top), cx, cy, cz, u, w, top, seed, clock.t)[0];
  const v = a + (b - a) * st.mix;
  // A big one keeps its outline faintly lit, so its shape holds in a show's dark phase.
  const outline = top >= 8 && (u >= w - 0.5 || cy <= 0.5) ? 0.16 : 0;
  return Math.min(1, Math.max(v, outline) * (1 + clock.lift));
}

/** How brightly a whole lit pyramid shines at `t`: its lamps' mean over a spread of them (its light on the floor). */
export function pyramidGlowLevel(state: { a: number; b: number; mix: number }, bpm: number, phase: number, seed: number, top: number, t: number): number {
  let sum = 0, n = 0;
  for (let y = 0; y <= top; y += Math.max(1, Math.floor(top / 4))) {
    const w = top - y;
    for (const [x, z] of [[w, 0], [0, w], [-w, Math.floor(w / 2)], [w, w]] as const) { sum += lampLevelIn(state, bpm, phase, seed, x, y, z, top, t); n++; }
  }
  return n ? sum / n : 0;
}
