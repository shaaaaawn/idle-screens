/**
 * Vignettes — small scenes for two or three fish.
 *
 * The swim system answers "how does a population move through a tank". A
 * vignette answers a different question: what happens BETWEEN two characters
 * in a room. A visitor knocks, is let in, they talk over tea, one tells a
 * story, the other laughs; somebody hides and somebody seeks. That is turn-
 * taking, and turn-taking is a script, not a flock.
 *
 * So a vignette is a script of BEATS. In each beat every actor may move to a
 * MARK (a named place the space provides — `door`, `table`, `stove`, `bed`…),
 * face someone or something, and make one GESTURE. While one fish talks the
 * other listens and nods; the next beat they swap. The actors are the first
 * fish of the cast (`a`, `b`, `c` = slots 0, 1, 2); any other fish keep
 * swimming as they always did.
 *
 *   4s: a =table, b =door            (= starts there, no travel)
 *   b >table @a                      (> go there, @ face)
 *   a @b talk, b @a nod
 *   b @a talk, a @b shake
 *   a b hop                          (several actors, one cue)
 *   b >stove peek, a @b wiggle
 *   a b circle rug
 *
 * Beats are separated by `|` or newlines. A leading `6s:` sets the beat's
 * length (default: long enough for its longest walk, at least 3.5 s).
 *
 * Everything is CLOSED FORM: `poseOf(scene, actor, t)` is a pure function, so
 * a vignette is frame-addressable and identical on every wall, like the rest
 * of the tank. The script loops; a closing beat walks everyone back to where
 * they began so the loop has no cut. Zero-dep, so the server can validate a
 * script through `./manifest` without three.js.
 */

export interface Mark { x: number; y: number; z: number }
export type Marks = Readonly<Record<string, Mark>>;

export const GESTURES = ['talk', 'nod', 'shake', 'hop', 'spin', 'wiggle', 'rest', 'peek', 'bow'] as const;
export type Gesture = (typeof GESTURES)[number];

/** Marks any open tank has, for vignettes played outside a room. */
export const OPEN_MARKS: Marks = {
  centre: { x: 0, y: 36, z: 0 },
  left: { x: -70, y: 34, z: 0 },
  right: { x: 70, y: 34, z: 0 },
  front: { x: 0, y: 30, z: 60 },
  back: { x: 0, y: 40, z: -70 },
  high: { x: 10, y: 62, z: -10 },
  low: { x: -10, y: 18, z: 10 },
};

interface ActorBeat {
  /** Where the actor is when the beat ends (and rests, if it does not move). */
  to: Mark;
  /** The first beat only: where the actor was before it — its opening spot
   *  on the centre ring, or where `=` placed it — so an opening `>mark` is a
   *  walk, and the loop's closing beat comes back HERE. Later beats start
   *  where the beat before ended. */
  from?: Mark;
  moved: boolean;
  /** Another actor's index, a fixed point, or nothing. */
  faceActor: number | null;
  facePoint: Mark | null;
  gesture: Gesture | null;
  circle: { actor: number | null; point: Mark | null } | null;
  follow: number | null;
}

interface Beat { t0: number; dur: number; actors: ActorBeat[] }

export interface Vignette {
  actors: number;
  beats: Beat[];
  duration: number;
  problems: string[];
}

const ACTOR = 'abc';
const CRUISE = 17; // units / second — an unhurried fish
const STANDOFF = 20; // how far apart actors sharing a mark hold — a fish is 18 long

/** An actor's own spot AT a mark: a ring round it, so two fish "at the table"
 *  sit either side of it instead of inside each other. */
function spot(mark: Mark, actor: number, actors: number): Mark {
  if (actors === 1) return mark;
  const a = (actor / actors) * Math.PI * 2 + 0.6;
  return { x: mark.x + Math.cos(a) * STANDOFF, y: mark.y + (actor % 2 ? 2.5 : 0), z: mark.z + Math.sin(a) * STANDOFF };
}

export function parseVignette(script: string, marks: Marks): Vignette {
  const problems: string[] = [];
  const raw = String(script ?? '').split(/[|\n]/).map((b) => b.trim()).filter(Boolean);
  // Who is in it: the highest actor letter the script names.
  let actors = 0;
  for (const beat of raw) {
    for (const cue of beat.replace(/^\d+(?:\.\d+)?s\s{0,16}:/, '').split(',')) {
      for (const word of cue.trim().split(/\s+/)) {
        if (!/^[abc]$/.test(word)) break;
        actors = Math.max(actors, ACTOR.indexOf(word) + 1);
      }
    }
  }
  if (!raw.length || !actors) return { actors: 0, beats: [], duration: 0, problems: raw.length ? ['no actor (a, b, c) named'] : [] };

  const centre = marks.centre ?? marks.rug ?? OPEN_MARKS.centre!;
  let at: Mark[] = Array.from({ length: actors }, (_, i) => spot(centre, i, actors));
  const start: Mark[] = [];
  const beats: Beat[] = [];
  let t0 = 0;

  raw.forEach((text, bi) => {
    let body = text;
    let dur: number | null = null;
    // Whitespace runs around the colon are bounded — the script is authored
    // content, not attacker-shaped, but an unbounded `\s*` here is exactly
    // the polynomial-backtracking shape CodeQL flags on uncontrolled input.
    const timed = /^(\d+(?:\.\d+)?)s\s{0,16}:\s{0,16}(.*)$/.exec(text);
    if (timed) { dur = Math.min(30, Math.max(1, Number(timed[1]))); body = timed[2]!; }
    const state: ActorBeat[] = at.map((p) => ({ to: p, moved: false, faceActor: null, facePoint: null, gesture: null, circle: null, follow: null }));
    let longest = 0;
    for (const cue of body.split(',').map((c) => c.trim()).filter(Boolean)) {
      const words = cue.split(/\s+/);
      const who: number[] = [];
      while (words.length && /^[abc]$/.test(words[0]!)) who.push(ACTOR.indexOf(words.shift()!));
      if (!who.length) { problems.push(`beat ${bi + 1}: "${cue}" names no actor`); continue; }
      for (let w = 0; w < words.length; w += 1) {
        const word = words[w]!;
        const target = (name: string): { actor: number | null; point: Mark | null } | null => {
          if (/^[abc]$/.test(name) && ACTOR.indexOf(name) < actors) return { actor: ACTOR.indexOf(name), point: null };
          const mk = marks[name];
          if (mk) return { actor: null, point: mk };
          problems.push(`beat ${bi + 1}: no mark or actor "${name}" (marks: ${Object.keys(marks).join(', ')})`);
          return null;
        };
        if (word[0] === '>' || word[0] === '=') {
          const mk = marks[word.slice(1)];
          if (!mk) { problems.push(`beat ${bi + 1}: no mark "${word.slice(1)}" (marks: ${Object.keys(marks).join(', ')})`); continue; }
          for (const i of who) {
            const dest = spot(mk, i, actors);
            if (word[0] === '=') at[i] = dest; // placed, not walked
            else longest = Math.max(longest, Math.hypot(dest.x - at[i]!.x, dest.y - at[i]!.y, dest.z - at[i]!.z) / CRUISE);
            state[i] = { ...state[i]!, to: dest, moved: word[0] === '>', facePoint: state[i]!.facePoint ?? mk };
          }
        } else if (word[0] === '@') {
          const tg = target(word.slice(1));
          if (tg) for (const i of who) state[i] = { ...state[i]!, faceActor: tg.actor === i ? null : tg.actor, facePoint: tg.point };
        } else if (word === 'circle' || word === 'follow') {
          const tg = target(words[w + 1] ?? '');
          w += 1;
          if (!tg) continue;
          for (const i of who) {
            if (word === 'follow' && tg.actor !== null && tg.actor !== i) state[i] = { ...state[i]!, follow: tg.actor };
            else if (word === 'circle') state[i] = { ...state[i]!, circle: tg, faceActor: null };
          }
          // Joining a ring or a leader from across the room takes as long as
          // the swim over: a fixed beat length made that a 140 u/s lunge.
          for (const i of who) {
            const goal = tg.point ?? at[tg.actor ?? i]!;
            longest = Math.max(longest, 3.4 + Math.hypot(goal.x - at[i]!.x, goal.z - at[i]!.z) / CRUISE);
          }
        } else if ((GESTURES as readonly string[]).includes(word)) {
          for (const i of who) state[i] = { ...state[i]!, gesture: word as Gesture };
        } else {
          problems.push(`beat ${bi + 1}: unknown word "${word}" (gestures: ${GESTURES.join(', ')}; also >mark =mark @target circle follow)`);
        }
      }
    }
    // A follower ends the beat beside wherever its leader ended up.
    state.forEach((sb, i) => {
      if (sb.follow === null) return;
      const lead = state[sb.follow]!.to;
      state[i] = { ...sb, moved: true, to: { x: lead.x + Math.cos(i * 2.1 + 1) * STANDOFF, y: lead.y - 2, z: lead.z + Math.sin(i * 2.1 + 1) * STANDOFF } };
    });
    // The opening positions: `at` still holds them here (`=` has written its
    // placements into it; `>` has not). The loop closes back to them.
    if (bi === 0) {
      start.push(...at);
      state.forEach((sb, i) => { sb.from = at[i]!; });
    }
    const length = dur ?? Math.max(3.5, longest / 0.62 + 0.6);
    beats.push({ t0, dur: length, actors: state });
    at = state.map((sb) => sb.to);
    t0 += length;
  });

  // Close the loop: everyone walks home, so t = duration meets t = 0.
  const home = at.some((p, i) => Math.hypot(p.x - start[i]!.x, p.z - start[i]!.z, p.y - start[i]!.y) > 1);
  if (home) {
    const far = Math.max(...at.map((p, i) => Math.hypot(p.x - start[i]!.x, p.y - start[i]!.y, p.z - start[i]!.z)));
    const length = Math.max(3.5, far / CRUISE / 0.62 + 0.6);
    beats.push({ t0, dur: length, actors: start.map((p) => ({ to: p, moved: true, faceActor: null, facePoint: null, gesture: null, circle: null, follow: null })) });
    t0 += length;
  }
  return { actors, beats, duration: t0, problems };
}

export interface ActorPose {
  x: number; y: number; z: number;
  /** Unit-ish forward vector. */
  fx: number; fy: number; fz: number;
  roll: number;
  /** For `inspect()` and tests: what the actor is doing right now. */
  doing: string;
  /** What the actor is facing this beat — another actor, a mark — for its EYES. */
  lookAt: Mark | null;
}

const smoother = (u: number): number => { const c = Math.min(1, Math.max(0, u)); return c * c * c * (c * (c * 6 - 15) + 10); };
const bell = (u: number): number => Math.sin(Math.min(1, Math.max(0, u)) * Math.PI);

/** Where an actor IS at time t (no heading) — also what others face / follow. */
function placeOf(v: Vignette, actor: number, tSec: number, depth = 0): Mark {
  const t = ((tSec % v.duration) + v.duration) % v.duration;
  let bi = v.beats.findIndex((b) => t < b.t0 + b.dur);
  if (bi < 0) bi = v.beats.length - 1;
  const beat = v.beats[bi]!, me = beat.actors[actor]!;
  const prev = v.beats[(bi + v.beats.length - 1) % v.beats.length]!.actors[actor]!;
  const from = bi === 0 ? me.from ?? me.to : prev.to;
  const u = (t - beat.t0) / beat.dur;
  if (me.follow !== null && depth < 2) {
    // Behind the leader, a beat late: where they were a moment ago, a little low.
    const lead = placeOf(v, me.follow, tSec - 1.7, depth + 1); // a body length and a half behind
    const k = smoother(Math.min(1, u * 2)), land = smoother((u - 0.72) / 0.28);
    const tx = from.x + (lead.x - from.x) * k, ty = from.y + (lead.y - 3 - from.y) * k, tz = from.z + (lead.z - from.z) * k;
    return { x: tx + (me.to.x - tx) * land, y: ty + (me.to.y - ty) * land, z: tz + (me.to.z - tz) * land };
  }
  if (me.circle && depth < 2) {
    const c = me.circle.point ?? placeOf(v, me.circle.actor!, tSec, depth + 1);
    // Ease out from where we stood onto the ring, go round, ease back.
    const k = smoother(Math.min(1, u * 2.2)) * (1 - smoother(Math.max(0, (u - 0.72) / 0.28)));
    const a = u * Math.PI * 2 + actor * 2.1;
    return {
      x: from.x + (c.x + Math.cos(a) * 22 - from.x) * k,
      y: from.y + (c.y + Math.sin(a * 2) * 3 - from.y) * k,
      z: from.z + (c.z + Math.sin(a) * 22 - from.z) * k,
    };
  }
  if (!me.moved) return from;
  // Walks take the first 62 % of the beat; the rest is for arriving and acting.
  const w = smoother(u / 0.62);
  const dx = me.to.x - from.x, dz = me.to.z - from.z, dist = Math.hypot(dx, dz);
  // Not a ruler line: a shallow arc, and a rise and fall like a real glide.
  const arc = bell(w) * dist * 0.12 * (actor % 2 ? 1 : -1);
  return {
    x: from.x + dx * w + (-dz / (dist || 1)) * arc,
    y: from.y + (me.to.y - from.y) * w + bell(w) * Math.min(7, dist * 0.06),
    z: from.z + dz * w + (dx / (dist || 1)) * arc,
  };
}

/** Full pose. Pure in (vignette, actor, t). */
export function poseOf(v: Vignette, actor: number, tSec: number): ActorPose | null {
  if (actor >= v.actors || !v.duration) return null;
  const t = ((tSec % v.duration) + v.duration) % v.duration;
  let bi = v.beats.findIndex((b) => t < b.t0 + b.dur);
  if (bi < 0) bi = v.beats.length - 1;
  const beat = v.beats[bi]!, me = beat.actors[actor]!;
  const u = (t - beat.t0) / beat.dur;
  const p = placeOf(v, actor, tSec);
  const ahead = placeOf(v, actor, tSec + 0.12);
  const tx = ahead.x - p.x, ty = ahead.y - p.y, tz = ahead.z - p.z;
  const speed = Math.hypot(tx, ty, tz) / 0.12;

  // Heading: along the path while travelling, toward the target once there.
  let fx = tx, fy = ty * 0.5, fz = tz;
  const target = me.faceActor !== null ? placeOf(v, me.faceActor, tSec) : me.facePoint;
  const settled = speed < 2.5 ? 1 : speed > 9 ? 0 : 1 - (speed - 2.5) / 6.5;
  if (target && settled > 0) {
    const gx = target.x - p.x, gy = (target.y - p.y) * 0.4, gz = target.z - p.z, gl = Math.hypot(gx, gy, gz) || 1;
    const ml = Math.hypot(fx, fy, fz);
    if (ml < 1e-4) { fx = gx / gl; fy = gy / gl; fz = gz / gl; } else {
      fx = (fx / ml) * (1 - settled) + (gx / gl) * settled;
      fy = (fy / ml) * (1 - settled) + (gy / gl) * settled;
      fz = (fz / ml) * (1 - settled) + (gz / gl) * settled;
    }
  } else if (Math.hypot(fx, fz) < 1e-4) {
    // Standing with nobody to face: keep the heading of the last walk in.
    const back = placeOf(v, actor, beat.t0 - 0.2), here = placeOf(v, actor, beat.t0);
    fx = here.x - back.x; fz = here.z - back.z; fy = 0;
    if (Math.hypot(fx, fz) < 1e-4) { fx = -p.x; fz = -p.z - 1e-3; }
  }
  let fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;

  // Alive even when still: a slow bob, each fish on its own phase.
  let { x, y, z } = p;
  y += Math.sin(tSec * 1.25 + actor * 2.4) * 0.9;
  let roll = Math.sin(tSec * 0.8 + actor) * 0.03;
  let doing = speed > 2.5 ? 'moving' : 'idle';

  // The gesture plays once the actor has arrived (or for the whole beat, if
  // it did not travel), under an envelope so it starts and stops softly.
  if (me.gesture) {
    const g0 = me.moved ? 0.64 : 0.06;
    const gu = (u - g0) / (1 - g0 - 0.04);
    if (gu > 0 && gu < 1) {
      const e = bell(gu) ** 0.6, gt = gu * (beat.dur * (1 - g0));
      let yaw = 0, pitch = 0;
      doing = me.gesture;
      switch (me.gesture) {
        case 'talk': pitch = Math.sin(gt * 8.5) * 0.11 * e; y += Math.abs(Math.sin(gt * 4.25)) * 1.4 * e; break;
        case 'nod': pitch = Math.sin(gt * 5.5) * 0.3 * e; break;
        case 'shake': yaw = Math.sin(gt * 9) * 0.38 * e; break;
        case 'hop': y += Math.abs(Math.sin(gt * 4.2)) * 6.5 * e; pitch = Math.cos(gt * 4.2) * 0.12 * e; break;
        case 'spin': yaw = smoother(gu) * Math.PI * 2; y += bell(gu) * 3; break;
        case 'wiggle': roll += Math.sin(gt * 11) * 0.34 * e; yaw = Math.sin(gt * 5.5) * 0.12 * e; break;
        case 'bow': pitch = -bell(gu) * 0.55; y -= bell(gu) * 2; break;
        case 'peek': { const k = Math.sin(gt * 2.4) * e; x += -fz * k * 7; z += fx * k * 7; roll += k * 0.18; break; }
        case 'rest': y -= 5 * e; roll += 0.22 * e; pitch = -0.08 * e; break;
      }
      if (yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); const nx = fx * c - fz * s; fz = fx * s + fz * c; fx = nx; }
      if (pitch) { fy += Math.tan(pitch) * Math.hypot(fx, fz); fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl; }
    }
  }
  return { x, y: Math.max(9, y), z, fx, fy, fz, roll, doing, lookAt: target ?? null };
}

/** Where a fish hovers to be "at" each thing in the geode interior — a body
 *  length in from the furniture, at a height that reads as using it. Kept here
 *  (zero-dep) beside the scripts that name them; `interior.ts` places the
 *  furniture from the same polar numbers. */
const polar = (deg: number, r: number, y: number): Mark => ({ x: Math.cos((deg * Math.PI) / 180) * r, y, z: Math.sin((deg * Math.PI) / 180) * r });
export const INTERIOR_MARKS: Marks = {
  rug: { x: 6, y: 26, z: -4 },
  centre: { x: 6, y: 30, z: -4 },
  table: polar(150, 46, 27),
  bed: polar(205, 104, 21),
  shelf: polar(330, 110, 30),
  stove: polar(88, 106, 33),
  lamp: polar(262, 102, 32),
  armchair: polar(271, 100, 22),
  door: polar(28, 124, 22),
  window: polar(128, 124, 46),
  chest: polar(232, 110, 24),
  chandelier: { x: 0, y: 72, z: 0 },
};

/** Example scripts. Marks are the geode interior's (`INTERIOR_MARKS`). */
export const VIGNETTES: Readonly<Record<string, string>> = {
  // Two friends: one is home, the other calls round for tea.
  tea: [
    '3s: a =table, b =door',
    'b hop, a @door shake',
    'a >door @b',
    'a @b bow, b @a bow',
    'a >table, b follow a',
    'b >table @a, a @b',
    'a @b talk, b @a nod',
    'b @a talk, a @b wiggle',
    'a >stove peek, b @a',
    'a >table @b, b @a hop',
    'a b circle rug',
    'b >door @a, a @b nod',
  ].join(' | '),
  // The end of the day: lamps, a last word, bed.
  bedtime: [
    '3s: a =shelf, b =armchair',
    'a @shelf peek, b @a',
    'a >armchair @b talk, b @a nod',
    'b >lamp spin',
    'a >bed, b @a',
    '6s: a @b rest, b >bed @a',
    '7s: a rest, b @a rest',
  ].join(' | '),
  // Three: somebody hides, somebody seeks, somebody gives it away.
  seek: [
    '3s: a =rug, b =rug, c =rug',
    'a @rug spin, b >shelf, c >window',
    'a >stove peek, b @a peek, c @a wiggle',
    'a >bed peek, c @b shake',
    'a >window @c, c @a hop',
    'a @c talk, c @shelf nod',
    'a >shelf @b, b @a hop',
    'b follow a, a >rug, c >rug',
    'a b c circle rug',
  ].join(' | '),
  // FOR THE OPEN STAGE (OPEN_MARKS), written to be lit: every beat is timed, and
  // everyone ends where they began, so a `spotCues` sheet stays in step forever.
  // duet cues:  4s:-, 7s:a, 5s:a, 7s:b, 5s:b, 6s:a+b, 8s:a+b, 6s:a+b, 5s:a+b
  duet: [
    '4s: a =left, b =right',
    '7s: a >centre spin',
    '5s: a >front bow',
    '7s: b >centre hop, a >left @b',
    '5s: b @a wiggle, a @b nod',
    '6s: a >centre @b, b @a',
    '8s: a b circle centre',
    '6s: a @b bow, b @a bow',
    '5s: a >left, b >right',
  ].join(' | '),
  // trio cues:  4s:-, 6s:a, 6s:b, 6s:c, 7s:a+b, 7s:b+c, 9s:a+b+c, 6s:a+b+c, 5s:c, 5s:-
  trio: [
    '4s: a =left, b =right, c =back',
    '6s: a >front spin',
    '6s: b >high hop, a @b',
    '6s: c >centre wiggle, a @c, b @c',
    '7s: a >centre @b, b >centre @a',
    '7s: b @c talk, c @b nod, a >left',
    '9s: a b c circle centre',
    '6s: a @c bow, b @c bow, c >front bow',
    '5s: a >left, b >right, c @front shake',
    '5s: c >back',
  ].join(' | '),
};

/** The cue sheet that lights a staged preset, spot for spot (`spotRig` a b c = slots 0 1 2). */
export const VIGNETTE_CUES: Readonly<Record<string, string>> = {
  duet: '4s:-, 7s:a, 5s:a, 7s:b, 5s:b, 6s:a+b, 8s:a+b, 6s:a+b, 5s:a+b',
  trio: '4s:-, 6s:a, 6s:b, 6s:c, 7s:a+b, 7s:b+c, 9s:a+b+c, 6s:a+b+c, 5s:c, 5s:-',
};

/** A preset's name, or the script itself. */
export function resolveVignette(value: string): string {
  const v = String(value ?? '').trim();
  return VIGNETTES[v] ?? v;
}
