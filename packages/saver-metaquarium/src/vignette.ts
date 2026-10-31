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

export interface Mark {
  x: number; y: number; z: number;
  /** One actor at a time (the club's mic): an actor there stands ON it, not round it in a ring. */
  solo?: boolean;
}
export type Marks = Readonly<Record<string, Mark>>;

/** Break-dance moves: a fish with the clips for them (a betafish, beta.ts) dances them
 *  with its own body; any other fish gets the whole-body version below. */
export const DANCES = ['toprock', 'footwork', 'windmill', 'headspin', 'freeze', 'drop'] as const;
export type Dance = (typeof DANCES)[number];
/** `ink` is the octopus's own (it lets go a cloud of ink; the tank does that, not the pose): any other breed ignores it, with a warning. */
export const GESTURES = ['talk', 'nod', 'shake', 'hop', 'spin', 'wiggle', 'rest', 'peek', 'bow', 'ink', 'puff', ...DANCES] as const;
/** Gestures only some breeds can make, and which. */
export const BREED_GESTURES: Readonly<Partial<Record<Gesture, readonly string[]>>> = { ink: ['octopus'], puff: ['blowfish'] };
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
  // Behind the mic stand (`stageSet: club` stands it here, facing front).
  mic: { x: 0, y: 36, z: -4, solo: true },
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
  /** A later beat's `=mark`: the actor is AT the mark from the beat's first
   *  moment (`from` holds it), a cut, not a walk — what `=` means in any beat. */
  placed?: boolean;
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
  /** Its audience: fish slot → seat (front row first), for the fish cast `@audience`. */
  seats: ReadonlyMap<number, number>;
  /** The middle of the stage the audience faces. */
  centre: Mark;
}

/** Actor letters: up to four (a host and three comics). */
const ACTOR = 'abcd';
const CRUISE = 17; // units / second — an unhurried fish
const STANDOFF = 20; // how far apart actors sharing a mark hold — a fish is 18 long

/** An actor's own spot AT a mark: a ring round it, so two fish "at the table"
 *  sit either side of it instead of inside each other. */
function spot(mark: Mark, actor: number, actors: number): Mark {
  if (actors === 1 || mark.solo) return mark;
  const a = (actor / actors) * Math.PI * 2 + 0.6;
  return { x: mark.x + Math.cos(a) * STANDOFF, y: mark.y + (actor % 2 ? 2.5 : 0), z: mark.z + Math.sin(a) * STANDOFF };
}

/**
 * `audience`: the fish slots cast `@audience`, in order. Any the script does not name as an actor take a
 * seat out front (`crowdPose`).
 */
export function parseVignette(script: string, marks: Marks, audience: readonly number[] = []): Vignette {
  const problems: string[] = [];
  const raw = String(script ?? '').split(/[|\n]/).map((b) => b.trim()).filter(Boolean);
  // Who is in it: the highest actor letter the script names.
  let actors = 0;
  for (const beat of raw) {
    for (const cue of beat.replace(/^\d+(?:\.\d+)?s\s{0,16}:/, '').split(',')) {
      for (const word of cue.trim().split(/\s+/)) {
        if (!/^[abcd]$/.test(word)) break;
        actors = Math.max(actors, ACTOR.indexOf(word) + 1);
      }
    }
  }
  const centre = marks.centre ?? marks.rug ?? OPEN_MARKS.centre!;
  if (!raw.length || !actors) return { actors: 0, beats: [], duration: 0, problems: raw.length ? ['no actor (a–d) named'] : [], seats: new Map(), centre };

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
      while (words.length && /^[abcd]$/.test(words[0]!)) who.push(ACTOR.indexOf(words.shift()!));
      if (!who.length) { problems.push(`beat ${bi + 1}: "${cue}" names no actor`); continue; }
      for (let w = 0; w < words.length; w += 1) {
        const word = words[w]!;
        const target = (name: string): { actor: number | null; point: Mark | null } | null => {
          if (/^[abcd]$/.test(name) && ACTOR.indexOf(name) < actors) return { actor: ACTOR.indexOf(name), point: null };
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
            // A later beat's `=` places from the beat's start (the first beat's
            // opening places are written below, into `from` for every actor).
            if (word[0] === '=' && bi > 0) state[i] = { ...state[i]!, from: dest, placed: true };
          }
        } else if (word[0] === '@') {
          const tg = target(word.slice(1));
          if (tg) for (const i of who) state[i] = { ...state[i]!, faceActor: tg.actor === i ? null : tg.actor, facePoint: tg.point };
        } else if (word === 'circle' || word === 'follow') {
          const targetName = words[w + 1] ?? '';
          const tg = target(targetName);
          w += 1;
          if (!tg) continue;
          if (word === 'follow' && tg.actor === null) {
            problems.push(`beat ${bi + 1}: "follow ${targetName}" needs another actor, not a mark`);
            continue;
          }
          for (const i of who) {
            if (word === 'follow' && tg.actor !== i) state[i] = { ...state[i]!, follow: tg.actor };
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
    // A circle beat leaves the actor back where it started (`placeOf`'s ring
    // eases out from `from` and back to it by u = 1) — `to` must say so, or
    // the NEXT beat's `from` (which reads `prev.to`) starts from the stale
    // `>` destination processed earlier in this same beat and the actor
    // teleports across the beat boundary.
    state.forEach((sb, i) => {
      if (sb.circle) state[i] = { ...sb, to: at[i]! };
    });
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
  const seats = new Map<number, number>();
  for (const slot of audience) if (slot >= actors && !seats.has(slot)) seats.set(slot, seats.size);
  return { actors, beats, duration: t0, problems, seats, centre };
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
  /** The gesture under way: which, seconds into it, seconds into its beat (a
   *  loop phased on that stays on the bar: beats are whole seconds), and its
   *  envelope (0..1) — for a rigged fish that plays the move with clips of its own. */
  gesture?: { name: Gesture; at: number; bar: number; weight: number };
  /** An audience member's laugh breaking: a bubble out of it, once per `key`, let go at `t` (the tank's burps). */
  burst?: { key: string; t: number };
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
  // The first beat starts at the opening places; a later `=` at its mark; any other where the beat before ended.
  const from = me.from ?? (bi === 0 ? me.to : prev.to);
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

/**
 * Whether a later beat's `=mark` cuts this actor across the room between `t1`
 * and `t2` (either order, loop-wrapped). Anything that samples a script a
 * moment ahead or behind — a heading, a pace, a dodge, a trail — must not read
 * velocity across a cut.
 */
export function snapBetween(v: Vignette, actor: number, t1: number, t2: number): boolean {
  if (!v.duration || actor >= v.actors) return false;
  const lo = Math.min(t1, t2), span = Math.abs(t2 - t1);
  const a = ((lo % v.duration) + v.duration) % v.duration;
  return v.beats.some((b) => {
    if (!b.actors[actor]?.placed) return false;
    const d = (((b.t0 - a) % v.duration) + v.duration) % v.duration;
    return d > 0 && d <= span;
  });
}

/** The pose `dt` seconds on (or back) — or, across a cut, the pose now (no velocity through a snap). */
export function poseAcross(v: Vignette, actor: number, tSec: number, dt: number, own?: (g: Gesture) => boolean): ActorPose | null {
  return poseOf(v, actor, snapBetween(v, actor, tSec, tSec + dt) ? tSec : tSec + dt, own);
}

/** Full pose. Pure in (vignette, actor, t). */
/**
 * `own`: gestures this actor performs with its own body (a betafish's dance
 * clips). Their whole-body version is left out — the clip moves the body, and
 * both would turn it twice — but the gesture is still reported in `gesture`.
 */
export function poseOf(v: Vignette, actor: number, tSec: number, own?: (g: Gesture) => boolean): ActorPose | null {
  if (!v.duration) return null;
  const seat = v.seats.get(actor);
  if (seat !== undefined) return crowdPose(v, seat, tSec, own);
  if (actor >= v.actors) return null;
  const t = ((tSec % v.duration) + v.duration) % v.duration;
  let bi = v.beats.findIndex((b) => t < b.t0 + b.dur);
  if (bi < 0) bi = v.beats.length - 1;
  const beat = v.beats[bi]!, me = beat.actors[actor]!;
  const u = (t - beat.t0) / beat.dur;
  const p = placeOf(v, actor, tSec);
  // The way it is going: a look a moment ahead — or, with a `=` cut coming, a
  // moment back, so the heading never swings toward a mark it does not walk to.
  const cut = snapBetween(v, actor, tSec, tSec + 0.12);
  const ahead = placeOf(v, actor, tSec + (cut ? -0.12 : 0.12));
  const tx = (ahead.x - p.x) * (cut ? -1 : 1), ty = (ahead.y - p.y) * (cut ? -1 : 1), tz = (ahead.z - p.z) * (cut ? -1 : 1);
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
    // (Across a `=` cut, the last walk is the one before it.)
    const end = me.placed ? beat.t0 - 1e-3 : beat.t0;
    const back = placeOf(v, actor, end - 0.2), here = placeOf(v, actor, end);
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
  let gesture: ActorPose['gesture'];

  // The gesture plays once the actor has arrived (or for the whole beat, if
  // it did not travel), under an envelope so it starts and stops softly.
  if (me.gesture) {
    const g0 = me.moved ? 0.64 : 0.06;
    const gu = (u - g0) / (1 - g0 - 0.04);
    if (gu > 0 && gu < 1) {
      // Real seconds: into the gesture, and into its beat. (Scaled to span the
      // envelope's shortened window, a gesture's clock ran 4–12 % fast, and a
      // dance slid off the bar.)
      const e = bell(gu) ** 0.6, gt = (u - g0) * beat.dur, bt = u * beat.dur;
      let yaw = 0, pitch = 0;
      doing = me.gesture;
      gesture = { name: me.gesture, at: gt, bar: bt, weight: e };
      switch (own?.(me.gesture) ? null : me.gesture) {
        case 'talk': pitch = Math.sin(gt * 8.5) * 0.11 * e; y += Math.abs(Math.sin(gt * 4.25)) * 1.4 * e; break;
        case 'nod': pitch = Math.sin(gt * 5.5) * 0.3 * e; break;
        case 'shake': yaw = Math.sin(gt * 9) * 0.38 * e; break;
        case 'hop': y += Math.abs(Math.sin(gt * 4.2)) * 6.5 * e; pitch = Math.cos(gt * 4.2) * 0.12 * e; break;
        case 'spin': yaw = smoother(gu) * Math.PI * 2; y += bell(gu) * 3; break;
        case 'wiggle': roll += Math.sin(gt * 11) * 0.34 * e; yaw = Math.sin(gt * 5.5) * 0.12 * e; break;
        case 'bow': pitch = -bell(gu) * 0.55; y -= bell(gu) * 2; break;
        case 'peek': { const k = Math.sin(gt * 2.4) * e; x += -fz * k * 7; z += fx * k * 7; roll += k * 0.18; break; }
        case 'rest': y -= 5 * e; roll += 0.22 * e; pitch = -0.08 * e; break;
        // ink: the body holds still; the octopus squirts its cloud (the tank's InkLayer) and pales.
        // puff: the body holds still; the blowfish gulps itself round (puffer.ts PufferInput.puffCue).
        // The dances, for a fish with no clips for them: the whole body does what it can.
        case 'toprock': roll += Math.sin(bt * Math.PI * 2) * 0.3 * e; y += Math.abs(Math.sin(bt * Math.PI * 2)) * 1.5 * e; break;
        case 'footwork': yaw = Math.sin(bt * Math.PI) * 0.5 * e; y -= 3 * e; roll += Math.sin(bt * Math.PI * 3) * 0.15 * e; break;
        case 'windmill': roll += smoother(gu) * Math.PI * 2 * Math.max(1, Math.round(beat.dur / 1.5)); break;
        case 'headspin': pitch = -1.2 * e; yaw = gu * Math.PI * 2 * Math.max(1, Math.round(beat.dur)); break;
        case 'freeze': pitch = 0.9 * Math.min(1, gu * 6) * (1 - smoother((gu - 0.85) / 0.15)); roll += 0.3 * e; break;
        case 'drop': pitch = -bell(Math.min(1, gu * 1.6)) * 0.7; y -= bell(gu) * 6; break;
      }
      if (yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); const nx = fx * c - fz * s; fz = fx * s + fz * c; fx = nx; }
      if (pitch) { fy += Math.tan(pitch) * Math.hypot(fx, fz); fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl; }
    }
  }
  return { x, y: Math.max(9, y), z, fx, fy, fz, roll, doing, lookAt: target ?? null, ...(gesture ? { gesture } : {}) };
}

// ── The audience ────────────────────────────────────────────────────────────
// A fish cast `@audience` in a scene with a vignette sits out front in rows,
// facing the stage, and watches whoever holds it. It reacts to the script, not
// to a clock of its own: a laugh breaks as every `talk` beat ends (the
// punchline) and rolls on past it, and every `bow` gets applause. Each seat
// takes the laugh a beat late or early and a few are a tough crowd, so a room
// never moves as one. Pure in (vignette, seat, t), like everything here.

export const CROWD = {
  /** Rows out from the stage's middle, front (nearest the camera) first: distance, height, seats.
   *  Raked: each row higher than the one before, so the back rows see over the front. */
  rows: [{ r: 48, y: 15, n: 6 }, { r: 64, y: 21, n: 8 }, { r: 80, y: 27, n: 10 }],
  /** How far round each row reaches, radians either side of straight out front. */
  arc: 0.7,
  /** A laugh: it breaks this long before the talk ends, and rolls on this long. */
  lead: 0.45, laugh: 2.8,
  /** Seconds a seat can be late to a laugh or the applause. */
  late: 0.55,
  /** One seat in this many is a tough crowd: it chuckles where the rest laugh. */
  tough: 5,
  /** Seconds the room's heads take to follow the stage: they look where it was, a moment ago. */
  follow: 1.05,
} as const;

/** 0..1, fixed per seat (and per beat when `k` differs). */
const seatHash = (seat: number, k = 0): number => {
  const s = Math.sin(seat * 127.1 + k * 311.7 + 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Where a seat is. */
export function crowdSeat(v: Vignette, seat: number): Mark {
  let row = 0, first = 0;
  while (row < CROWD.rows.length - 1 && seat >= first + CROWD.rows[row]!.n) { first += CROWD.rows[row]!.n; row += 1; }
  const r = CROWD.rows[row]!;
  // Past the last row's seats, the last row goes on filling outward (a packed house stands at the back).
  const inRow = Math.min(r.n, v.seats.size - first);
  // Filled from the middle out, alternating sides: the mix's first kinds take the middle, the rest spread
  // evenly either side (filled left to right, a mix's kinds bunched on one side of the house).
  const mid = (inRow - 1) / 2;
  const order = Array.from({ length: inRow }, (_, p) => p).sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid) || q - p);
  const i = order[seat - first] ?? seat - first;
  const step = (CROWD.arc * 2) / Math.max(1, r.n - 1);
  const a = (i - (inRow - 1) / 2) * step + (seatHash(seat, 1) - 0.5) * step * 0.3;
  const d = r.r + (seatHash(seat, 2) - 0.5) * 5;
  return { x: v.centre.x + Math.sin(a) * d, y: r.y + (seatHash(seat, 3) - 0.5) * 3, z: v.centre.z + Math.cos(a) * d };
}

interface Reactions { laughs: number[]; claps: Array<[number, number]> }
const REACTIONS = new WeakMap<Vignette, Reactions>();
/** When the room laughs (each `talk` beat's end) and applauds (each `bow` beat), in one loop of the script. */
function reactionsOf(v: Vignette): Reactions {
  let r = REACTIONS.get(v);
  if (r) return r;
  r = { laughs: [], claps: [] };
  for (const b of v.beats) {
    if (b.actors.some((a) => a.gesture === 'talk')) r.laughs.push(b.t0 + b.dur);
    if (b.actors.some((a) => a.gesture === 'bow')) r.claps.push([b.t0, b.t0 + b.dur]);
  }
  REACTIONS.set(v, r);
  return r;
}

/** Who holds the stage at t: whoever is talking, else whoever is on (or headed for) its middle. Not whoever
 *  is merely doing something: comics nodding along in the wings would steal the room's eyes. */
function holderAt(v: Vignette, tSec: number): number {
  const t = ((tSec % v.duration) + v.duration) % v.duration;
  const beat = v.beats.find((b) => t < b.t0 + b.dur) ?? v.beats[v.beats.length - 1]!;
  const talking = beat.actors.findIndex((a) => a.gesture === 'talk');
  if (talking >= 0) return talking;
  let best = 0, bestD = Infinity;
  beat.actors.forEach((a, i) => { const d = Math.hypot(a.to.x - v.centre.x, a.to.z - v.centre.z); if (d < bestD) { bestD = d; best = i; } });
  return best;
}

/** How far into a reaction at t (0..1, loop-wrapped), or -1; `shift` says which loop's (-1, 0, +1) it is. */
function within(v: Vignette, t: number, start: number, len: number, out?: { shift: number }): number {
  for (const shift of [-1, 0, 1]) {
    const u = (t - start - shift * v.duration) / len;
    if (u > 0 && u < 1) { if (out) out.shift = shift; return u; }
  }
  return -1;
}

/** An audience member's pose (`poseOf` for a seated slot). */
function crowdPose(v: Vignette, seat: number, tSec: number, own?: (g: Gesture) => boolean): ActorPose {
  const p = crowdSeat(v, seat);
  const t = ((tSec % v.duration) + v.duration) % v.duration;
  // Its eyes on the stage: where whoever holds it was a moment ago, so heads turn with a walk, not ahead of it.
  let gx = 0, gy = 0, gz = 0;
  const taps = 4;
  for (let k = 0; k < taps; k++) {
    const tk = tSec - (k / (taps - 1)) * CROWD.follow;
    const m = placeOf(v, holderAt(v, tk), tk);
    gx += m.x / taps; gy += m.y / taps; gz += m.z / taps;
  }
  const look = { x: gx, y: gy, z: gz };
  let fx = gx - p.x, fy = (gy - p.y) * 0.4, fz = gz - p.z;
  let fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;

  const { x, z } = p;
  let y = p.y + Math.sin(tSec * 1.1 + seat * 2.3) * 0.7;
  let roll = Math.sin(tSec * 0.7 + seat) * 0.03;
  let pitch = 0;
  let doing = 'watching';
  let gesture: ActorPose['gesture'];
  const { laughs, claps } = reactionsOf(v);
  const late = seatHash(seat, 4) * CROWD.late;
  // The laugh: the strongest under way (two can overlap when the jokes come fast).
  let lu = -1, lat = 0, lk = 0;
  const loop = { shift: 0 }, lap = Math.floor(tSec / v.duration);
  let burst: ActorPose['burst'];
  for (let k = 0; k < laughs.length; k++) {
    const at = laughs[k]!;
    const len = CROWD.laugh * (0.8 + 0.45 * seatHash(seat, 10 + k));
    const u = within(v, t, at - CROWD.lead + late, len, loop);
    if (u > lu) { lu = u; lat = u * len; lk = k; }
  }
  if (lu > 0) {
    // It breaks fast and dies away slowly; a tough crowd only chuckles.
    const e = Math.min(1, lu * 6) * (1 - smoother((lu - 0.35) / 0.65));
    const tough = seatHash(seat, 5) < 1 / CROWD.tough;
    const amp = tough ? 0.4 : 0.75 + 0.5 * seatHash(seat, 6);
    const hz = 5.5 + 2.5 * seatHash(seat, 7);
    doing = 'laughing';
    pitch = (0.3 + Math.sin(lat * hz * 2) * 0.1) * e * amp; // the head goes back
    y += Math.abs(Math.sin(lat * hz)) * 3.4 * e * amp;
    roll += Math.sin(lat * hz) * 0.16 * e * amp;
    if (own?.('talk')) gesture = { name: 'talk', at: lat, bar: lat, weight: e * amp };
    // A real laugh lets a bubble go as it breaks — this loop's, so it comes round again.
    if (!tough) {
      const start = laughs[lk]! - CROWD.lead + late + (lap + loop.shift) * v.duration;
      burst = { key: `crowd:${seat}:${lk}:${lap + loop.shift}`, t: start + 0.25 };
    }
  }
  for (const [a, b] of claps) {
    const u = within(v, t, a + late, b - a);
    if (u <= 0) continue;
    const e = bell(u) ** 0.6, ct = u * (b - a);
    doing = 'applauding';
    y += Math.abs(Math.sin(ct * 6.5)) * 1.3 * e;
    roll += Math.sin(ct * 13) * 0.22 * e; // its fins going
    if (own?.('wiggle')) gesture = { name: 'wiggle', at: ct, bar: ct, weight: e };
    break;
  }
  if (pitch) { fy += Math.tan(pitch) * Math.hypot(fx, fz); fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl; }
  return { x, y: Math.max(9, y), z, fx, fy, fz, roll, doing, lookAt: look, ...(gesture ? { gesture } : {}), ...(burst ? { burst } : {}) };
}

/** Where a fish hovers to be "at" each thing in the geode interior — a body
 *  length in from the furniture, at a height that reads as using it. Kept here
 *  (zero-dep) beside the scripts that name them; `interior.ts` places the
 *  furniture from the same polar numbers. */
const polar = (deg: number, r: number, y: number): Mark => ({ x: Math.cos((deg * Math.PI) / 180) * r, y, z: Math.sin((deg * Math.PI) / 180) * r });
/** The furniture marks as placed round the room: bearing in degrees (0° = +x, 90° = +z),
 *  distance from the middle, height — at room scale 1 (the room and its marks scale by
 *  `roomScale(crystalScale)`, never below 0.85). The guide prints this as a table. */
export const INTERIOR_MARK_POLAR: Readonly<Record<string, { deg: number; r: number; y: number; note?: string }>> = {
  door: { deg: 28, r: 124, y: 22 },
  stove: { deg: 88, r: 106, y: 33 },
  window: { deg: 128, r: 124, y: 46 },
  table: { deg: 150, r: 46, y: 27, note: 'on the rug' },
  bed: { deg: 205, r: 104, y: 21 },
  chest: { deg: 232, r: 110, y: 24 },
  lamp: { deg: 262, r: 102, y: 32 },
  armchair: { deg: 271, r: 100, y: 22 },
  shelf: { deg: 330, r: 110, y: 30 },
};
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
  // Open mic: a host (d) brings on three comics (a b c) in turn — each two bits and a bow — and sends them off;
  // the two waiting stand in the wings and watch whoever has the mic, nodding along when the room laughs. Then
  // a goodnight from the host, and the company bows from where it stands. Written for an `@audience` out front (it laughs as each talk
  // ends), `stageSet: club` and one spot standing on the mic (`spotRig: @mic`): whoever steps up is lit.
  // openmic cues: 4s:-, 5s:a, 5s:a, 3s:a, 5s:a, 6s:a, 3s:a, 6s:a, 3s:a, 5s:a, 4s:a, 3s:a, 5s:a, 6s:a, 3s:a, 6s:a, 3s:a, 5s:a, 4s:a, 3s:a, 5s:a, 6s:a, 3s:a, 6s:a, 3s:a, 5s:a, 5s:a, 4s:a, 5s:-
  openmic: [
    '4s: a =left, b =right, c =left, d =right',
    '5s: d >mic @front, a @mic nod, b @mic nod, c @mic nod',
    '5s: d @front talk, a @mic, b @mic, c @mic',
    '3s: d @a wiggle, a @mic nod, b @mic nod, c @mic nod',
    '5s: d >right, a >mic @front, b @mic, c @mic',
    '6s: a @front talk, b @mic, c @mic, d @mic nod',
    '3s: a @front nod, b @mic nod, c @mic nod, d @mic nod',
    '6s: a @front talk, b @mic, c @mic, d @mic',
    '3s: a @front bow, b @mic nod, c @mic nod, d @mic nod',
    '5s: a >left, d >mic @front, b @mic, c @mic',
    '4s: d @front talk, a @mic nod, b @mic, c @mic',
    '3s: d @b wiggle, a @mic, b @mic nod, c @mic',
    '5s: d >right, b >mic @front, a @mic, c @mic',
    '6s: b @front talk, a @mic, c @mic, d @mic nod',
    '3s: b @front rest, a @mic nod, c @mic nod, d @mic nod',
    '6s: b @front talk, a @mic, c @mic, d @mic',
    '3s: b @front bow, a @mic nod, c @mic nod, d @mic nod',
    '5s: b >right, d >mic @front, a @mic, c @mic',
    '4s: d @front talk, a @mic, b @mic nod, c @mic',
    '3s: d @c wiggle, a @mic, b @mic, c @mic nod',
    '5s: d >right, c >mic @front, a @mic, b @mic',
    '6s: c @front talk, a @mic, b @mic, d @mic nod',
    '3s: c @front shake, a @mic nod, b @mic nod, d @mic nod',
    '6s: c @front talk, a @mic, b @mic, d @mic',
    '3s: c @front bow, a @mic nod, b @mic nod, d @mic nod',
    '5s: c >left, d >mic @front, a @mic, b @mic',
    '5s: d @front talk, a @mic nod, b @mic, c @mic nod',
    '4s: a @front bow, b @front bow, c @front bow, d @front bow',
    '5s: d >right, a @mic, b @mic, c @mic',
  ].join(' | '),
};

/** The cue sheet that lights a staged preset, spot for spot (`spotRig` a b c = its spots, in order). */
export const VIGNETTE_CUES: Readonly<Record<string, string>> = {
  duet: '4s:-, 7s:a, 5s:a, 7s:b, 5s:b, 6s:a+b, 8s:a+b, 6s:a+b, 5s:a+b',
  trio: '4s:-, 6s:a, 6s:b, 6s:c, 7s:a+b, 7s:b+c, 9s:a+b+c, 6s:a+b+c, 5s:c, 5s:-',
  openmic: '4s:-, 5s:a, 5s:a, 3s:a, 5s:a, 6s:a, 3s:a, 6s:a, 3s:a, 5s:a, 4s:a, 3s:a, 5s:a, 6s:a, 3s:a, 6s:a, 3s:a, 5s:a, 4s:a, 3s:a, 5s:a, 6s:a, 3s:a, 6s:a, 3s:a, 5s:a, 5s:a, 4s:a, 5s:-',
};

/** A preset's name, or the script itself. */
export function resolveVignette(value: string): string {
  const v = String(value ?? '').trim();
  return VIGNETTES[v] ?? v;
}
