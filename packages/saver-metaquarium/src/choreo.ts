/**
 * Choreography: an authored dance on the beat. A cue sheet per dancer says
 * which move it dances for how many beats, where it travels, which way it
 * faces, how far it turns and how high it leaps — so a dance can follow a
 * piece of music (or a reference dance) instead of looping a fixed routine.
 * Zero-dep and pure in beats, like the dance clock it runs on: the same sheet
 * at the same beat is the same pose on every screen, and a renderer can seek.
 *
 *   choreography   `a: 8:lie, 4:rise, 4:reach >right @cam | b: 8:march ~360 | *: 16:jacks`
 *     actors       `a b c …` are the dancers in order (the class's slots: the
 *                  instructor first), `*` every dancer without a line of its own.
 *                  Lines are separated by `|`; a sheet with no actor is `*`.
 *     cue          `<beats>:<move> [modifiers]` — beats may be fractional
 *                  (`2.5:rise`), so a cue can follow a phrase that is not on a
 *                  bar line. The rig's table says which moves there are.
 *     modifiers    `>mark` or `>side,depth` travel there over the cue (marks:
 *                  home centre left right front back; numbers in spacings from
 *                  the dancer's own spot, depth toward the room);
 *                  `@deg` | `@mark` | `@cam` | `@room` face that way over the
 *                  cue's first beat (degrees clockwise from the room);
 *                  `~deg` turn that far over the cue (360 a spin; it adds up);
 *                  `^h` leap: an arc h body-lengths high, landing as the cue ends;
 *                  `/deg` lean (+ forward); `%s` crouch (a height scale: `%0.7`
 *                  bends low, `%1.15` stretches tall); `*a` groove: a dip of a
 *                  (0.06 is a nod) into every beat, lowest exactly on it — the
 *                  pulse a move without its own hits (reach, twist, sway) needs;
 *                  `xN` speed: the move's clip N times as fast (`x2` double time,
 *                  footwork on the eighths; `x0.5` half time); `=f` a pose: the
 *                  move's clip held at f of its cycle (`rise =0.4` sits up,
 *                  `jacks =0.25` arms up and legs wide) — a still to hit.
 *   ON THE BEAT: what a cue IS — its clip, its posture, facing, lean and
 *   crouch — has fully arrived at the cue's first beat: the dancer moves into
 *   it over the end of the cue before (half a beat at most). What a cue DOES
 *   — travel, turns, a leap's arc — runs through it and lands as it ends. A
 *   leap crouches into its take-off and squashes as it lands.
 *   Each dancer's line loops over its own length; give the lines the same
 *   number of beats and end where you began, and the class stays together.
 */

/** The starfish's moves (starfish.ts STARFISH_MOVES says which clip each plays): the eight dance moves, partner
 *  moves danced solo, and the floor — lying, curling, waving, rising, sitting back down, walking and crawling. */
export const STARFISH_MOVE_NAMES = [
  'march', 'jacks', 'reach', 'kick', 'twist', 'circles', 'disco', 'spin',
  'mambo', 'sway', 'twirl', 'dip',
  'hold', 'walk', 'lie', 'crawl', 'curl', 'wave', 'pop', 'rise', 'sit',
] as const;

export const CHOREO_MARKS: Readonly<Record<string, readonly [side: number, depth: number] | 'centre'>> = {
  home: [0, 0], left: [-2, 0], right: [2, 0], front: [0, 1.2], back: [0, -1.5], centre: 'centre',
};

export interface ChoreoCue {
  b0: number; beats: number; move: string;
  /** Travel target: an offset from the dancer's spot in spacings, or the class's centre. */
  to?: readonly [number, number] | 'centre';
  /** Face: degrees from the room, or the camera. */
  face?: number | 'cam';
  /** Turn over the cue, degrees. */
  turn: number;
  /** Leap height, body lengths. */
  lift: number;
  /** Lean, degrees (+ forward, toward where it faces), and crouch (a height scale, 1 = standing tall), held through the cue. */
  lean?: number;
  squash?: number;
  /** Groove: a dip of this depth (0.02–0.3 of its height) into every beat, lowest exactly on the beat. */
  groove?: number;
  /** Speed: the move's clip this many times as fast (0.25–4; 2 is double time). */
  rate?: number;
  /** A pose: the move's clip held at this fraction of its cycle (0–1) through the cue. */
  pose?: number;
}
export interface ChoreoLine { cues: ChoreoCue[]; beats: number }
export interface ChoreoSheet { lines: Map<number | '*', ChoreoLine>; problems: string[] }

const MAX_CUES = 256;

/** Parse a sheet against a rig's move names; a bad token is a problem and is dropped, never fatal. */
export function parseChoreography(value: string, moves: readonly string[]): ChoreoSheet {
  const lines = new Map<number | '*', ChoreoLine>(), problems: string[] = [];
  const known = new Set(moves);
  for (const rawLine of value.split('|').map((s) => s.trim()).filter(Boolean)) {
    const head = /^([a-z]|\*)\s*:\s*(?=\d|\.)/.exec(rawLine);
    // `a: 4:march` names an actor; a line that starts with a cue (`4:march`) is everyone's
    const actor: number | '*' = head ? (head[1] === '*' ? '*' : head[1]!.charCodeAt(0) - 97) : '*';
    const body = head ? rawLine.slice(head[0].length) : rawLine;
    if (lines.has(actor)) problems.push(`dancer ${actor === '*' ? '*' : String.fromCharCode(97 + actor)} has two lines; the later one wins`);
    const cues: ChoreoCue[] = [];
    let b0 = 0;
    // a comma that starts a new `<beats>:` cue splits; the one in `>side,depth` does not
    for (const raw of body.split(/,\s*(?=(?:\d+(?:\.\d+)?|\.\d+)\s*:)/).map((s) => s.trim()).filter(Boolean)) {
      if (cues.length >= MAX_CUES) { problems.push(`more than ${MAX_CUES} cues on one line; the rest are dropped`); break; }
      // No `\s*` before the rest: it and `(.*)` could both take the same spaces (CodeQL polynomial ReDoS); the rest is trimmed below.
      const m = /^(\d+(?:\.\d+)?|\.\d+)\s*:\s*([a-z][a-z_]*)(.*)$/.exec(raw);
      if (!m) { problems.push(`"${raw}" is not <beats>:<move>`); continue; }
      const beats = Number(m[1]);
      if (!(beats > 0)) { problems.push(`"${raw}": a cue needs some beats`); continue; }
      if (!known.has(m[2]!)) { problems.push(`"${raw}": no move "${m[2]}" (moves: ${moves.join(' ')})`); continue; }
      const cue: ChoreoCue = { b0, beats: Math.min(beats, 512), move: m[2]!, turn: 0, lift: 0 };
      for (const tok of (m[3] ?? '').replace(/^[,\s]+/, '').split(/\s+/).filter(Boolean)) {
        const mod = /^([>@~^/%*x=])(.+)$/.exec(tok);
        if (!mod) { problems.push(`"${raw}": "${tok}" is not >to, @face, ~turn, ^leap, /lean, %crouch, *groove, xspeed or =pose`); continue; }
        const [, op, arg] = mod as unknown as [string, string, string];
        if (op === '>') {
          const mark = CHOREO_MARKS[arg];
          const xy = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(arg);
          if (mark) cue.to = mark;
          else if (xy) cue.to = [clamp(Number(xy[1]), -6, 6), clamp(Number(xy[2]), -6, 6)];
          else problems.push(`"${raw}": travel to "${arg}" — a mark (${Object.keys(CHOREO_MARKS).join(' ')}) or side,depth`);
        } else if (op === '@') {
          const named: Record<string, number | 'cam'> = { cam: 'cam', room: 0, front: 0, back: 180, left: -90, right: 90 };
          if (arg in named) cue.face = named[arg]!;
          else if (Number.isFinite(Number(arg))) cue.face = Number(arg);
          else problems.push(`"${raw}": face "${arg}" — degrees, cam, room, left, right or back`);
        } else if (op === '/') {
          if (Number.isFinite(Number(arg))) cue.lean = clamp(Number(arg), -60, 60);
          else problems.push(`"${raw}": lean "${arg}" is not degrees`);
        } else if (op === '%') {
          if (Number.isFinite(Number(arg)) && Number(arg) > 0) cue.squash = clamp(Number(arg), 0.4, 1.5);
          else problems.push(`"${raw}": crouch "${arg}" is not a height scale`);
        } else if (op === '=') {
          if (arg !== '' && Number.isFinite(Number(arg)) && Number(arg) >= 0 && Number(arg) <= 1) cue.pose = Number(arg);
          else problems.push(`"${raw}": pose "${arg}" is not a fraction of the move (0–1)`);
        } else if (op === 'x') {
          if (Number.isFinite(Number(arg)) && Number(arg) > 0) cue.rate = clamp(Number(arg), 0.25, 4);
          else problems.push(`"${raw}": speed "${arg}" is not a multiple`);
        } else if (op === '*') {
          if (Number.isFinite(Number(arg)) && Number(arg) > 0) cue.groove = clamp(Number(arg), 0.02, 0.3);
          else problems.push(`"${raw}": groove "${arg}" is not a depth`);
        } else if (op === '~') {
          if (Number.isFinite(Number(arg))) cue.turn = clamp(Number(arg), -1440, 1440);
          else problems.push(`"${raw}": turn "${arg}" is not degrees`);
        } else {
          if (Number.isFinite(Number(arg)) && Number(arg) >= 0) cue.lift = Math.min(Number(arg), 3);
          else problems.push(`"${raw}": leap "${arg}" is not a height`);
        }
      }
      cues.push(cue);
      b0 += cue.beats;
    }
    if (cues.length) lines.set(actor, { cues, beats: b0 });
    else problems.push(`line "${rawLine}" has no cues`);
  }
  return { lines, problems };
}

/** A dancer's pose on the sheet at `beats`: rig-independent; the rig turns it into clips and a place. */
export interface ChoreoPose {
  /** The cue it is on, how many beats into it, and how far through (0..1). */
  cue: ChoreoCue; beat: number; u: number;
  /** The cue after (looping round) and how far the dancer has moved into it (0..1): it arrives on that cue's beat. */
  next: ChoreoCue; ahead: number;
  /** Where it is: an offset from its spot in spacings, or a blend toward the class's centre (`centre` 0..1 of the way). */
  side: number; depth: number; centre: number;
  /** Where it faces (degrees from the room) and how far it has turned in all, and whether `cam` is asked of the face. */
  face: number; faceCam: number; turn: number;
  /** Height above the floor, body lengths; lean in degrees (+ forward); crouch as a height scale. */
  lift: number; lean: number; squash: number;
}

/** Beats over which a dancer moves into the next cue, ending exactly on its first beat. */
export const CHOREO_HANDOVER = 0.5;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smooth = (u: number): number => { const c = clamp(u, 0, 1); return c * c * (3 - 2 * c); };
const posMod = (v: number, m: number): number => ((v % m) + m) % m;

/** The line for dancer `slot` (its own, else `*`), or null when the sheet has none for it. */
export function choreoLine(sheet: ChoreoSheet | null, slot: number): ChoreoLine | null {
  return sheet?.lines.get(slot) ?? sheet?.lines.get('*') ?? null;
}

/**
 * Where a dancer is on its line at `beats`. Everything carried from cue to cue
 * (place, facing, turns) is folded from the line's start, so the pose is a
 * pure function of the beat. Each lap starts at home, facing the room: a line
 * that ends where it began (home, turns adding up to whole spins) loops
 * without a seam.
 */
export function choreoAt(line: ChoreoLine, beats: number): ChoreoPose {
  const b = posMod(beats, line.beats);
  const n = line.cues.length;
  let i = 0;
  while (i < n - 1 && b >= line.cues[i]!.b0 + line.cues[i]!.beats) i++;
  const cue = line.cues[i]!, next = line.cues[(i + 1) % n]!, prev = line.cues[(i + n - 1) % n]!;
  // every lap starts at the dancer's own spot, facing the room: a sheet that travels and never comes home starts
  // where it should, and one meant to loop shows its seam (end where you began) instead of hiding an offset
  let side = 0, depth = 0, centre = 0, face = 0, faceCam = 0, turn = 0;
  const end = (c: ChoreoCue): void => {
    if (c.to === 'centre') centre = 1;
    else if (c.to) { side = c.to[0]; depth = c.to[1]; centre = 0; }
    turn += c.turn;
  };
  const facing = (c: ChoreoCue): void => { if (c.face === 'cam') faceCam = 1; else if (c.face !== undefined) { face = c.face; faceCam = 0; } };
  for (let k = 0; k < i; k++) { end(line.cues[k]!); facing(line.cues[k]!); }
  facing(cue); // a cue's facing has arrived by its first beat
  const beat = b - cue.b0, u = clamp(beat / cue.beats, 0, 1);
  // what this cue does runs through it and lands at its end: travel, turns, the leap's arc
  const s = smooth(u);
  if (cue.to === 'centre') centre += (1 - centre) * s;
  else if (cue.to) { side += (cue.to[0] - side) * s; depth += (cue.to[1] - depth) * s; centre *= 1 - s; }
  turn += cue.turn * s;
  const lift = cue.lift > 0 ? cue.lift * Math.sin(Math.PI * u) : 0;
  // what the next cue is arrives on its first beat: the dancer moves into it over the end of this one
  const last = i === n - 1;
  const h = Math.min(CHOREO_HANDOVER, cue.beats / 2, next.beats / 2);
  const ahead = smooth((beat - (cue.beats - h)) / h);
  if (ahead > 0) {
    if (next.face === 'cam') faceCam += (1 - faceCam) * ahead;
    else if (next.face !== undefined && !last) { face += angleTo(face, next.face) * ahead; faceCam *= 1 - ahead; }
    else if (last) { face += angleTo(face, next.face === undefined ? 0 : next.face as number) * ahead; faceCam *= 1 - ahead; }
  }
  const lean = (cue.lean ?? 0) + ((next.lean ?? 0) - (cue.lean ?? 0)) * ahead;
  let squash = (cue.squash ?? 1) + ((next.squash ?? 1) - (cue.squash ?? 1)) * ahead;
  // a leap: crouch into the take-off, stretch in the air, squash on landing and come back up
  if (next.lift > 0) squash *= 1 - 0.16 * ahead;
  if (cue.lift > 0) squash *= u < 0.15 ? 0.84 + 0.26 * smooth(u / 0.15) : 1 + 0.1 * Math.sin(Math.PI * u) - 0.16 * smooth((u - 0.85) / 0.15);
  if (prev.lift > 0 && n > 1) squash *= 0.84 + 0.16 * smooth(beat / Math.min(0.75, cue.beats));
  // the groove: lowest on every beat of the dance clock (a cosine, so its turning point — the hit — is the beat itself)
  const groove = cue.groove ?? 0;
  if (groove > 0 && cue.lift === 0) squash *= 1 - groove * (1 + Math.cos(2 * Math.PI * posMod(beats, 1))) / 2;
  return { cue, beat, u, next, ahead, side, depth, centre, face, faceCam, turn, lift, lean, squash };
}

/** The short way round from a to b, degrees. */
function angleTo(a: number, b: number): number { return posMod(b - a + 180, 360) - 180; }
