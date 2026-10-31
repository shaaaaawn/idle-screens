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
 *                  `^h` leap: an arc h body-lengths high, landing as the cue ends.
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
      const m = /^(\d+(?:\.\d+)?|\.\d+)\s*:\s*([a-z][a-z_]*)\s*(.*)$/.exec(raw);
      if (!m) { problems.push(`"${raw}" is not <beats>:<move>`); continue; }
      const beats = Number(m[1]);
      if (!(beats > 0)) { problems.push(`"${raw}": a cue needs some beats`); continue; }
      if (!known.has(m[2]!)) { problems.push(`"${raw}": no move "${m[2]}" (moves: ${moves.join(' ')})`); continue; }
      const cue: ChoreoCue = { b0, beats: Math.min(beats, 512), move: m[2]!, turn: 0, lift: 0 };
      for (const tok of (m[3] ?? '').replace(/^[,\s]+/, '').split(/\s+/).filter(Boolean)) {
        const mod = /^([>@~^])(.+)$/.exec(tok);
        if (!mod) { problems.push(`"${raw}": "${tok}" is not >to, @face, ~turn or ^leap`); continue; }
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
  /** The cue before (looping round), for the handover. */
  prev: ChoreoCue;
  /** Where it is: an offset from its spot in spacings, or a blend toward the class's centre (`centre` 0..1 of the way). */
  side: number; depth: number; centre: number;
  /** Where it faces (degrees from the room) and how far it has turned in all, and whether `cam` is asked of the face. */
  face: number; faceCam: number; turn: number;
  /** Height above the floor, body lengths. */
  lift: number;
}

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
  const cue = line.cues[i]!, prev = line.cues[(i + n - 1) % n]!;
  // every lap starts at the dancer's own spot, facing the room: a sheet that travels and never comes home starts
  // where it should, and one meant to loop shows its seam (end where you began) instead of hiding an offset
  let side = 0, depth = 0, centre = 0, face = 0, faceCam = 0, turn = 0;
  const end = (c: ChoreoCue): void => {
    if (c.to === 'centre') centre = 1;
    else if (c.to) { side = c.to[0]; depth = c.to[1]; centre = 0; }
    if (c.face === 'cam') faceCam = 1; else if (c.face !== undefined) { face = c.face; faceCam = 0; }
    turn += c.turn;
  };
  for (let k = 0; k < i; k++) end(line.cues[k]!);
  const beat = b - cue.b0, u = clamp(beat / cue.beats, 0, 1);
  // this cue's own glides
  const s = smooth(u);
  if (cue.to === 'centre') centre += (1 - centre) * s;
  else if (cue.to) { side += (cue.to[0] - side) * s; depth += (cue.to[1] - depth) * s; centre *= 1 - s; }
  const fu = smooth(Math.min(1, beat / Math.min(1, cue.beats)));
  if (cue.face === 'cam') faceCam += (1 - faceCam) * fu;
  else if (cue.face !== undefined) { face += angleTo(face, cue.face) * fu; faceCam *= 1 - fu; }
  turn += cue.turn * s;
  const lift = cue.lift > 0 ? cue.lift * Math.sin(Math.PI * u) : 0;
  return { cue, beat, u, prev, side, depth, centre, face, faceCam, turn, lift };
}

/** The short way round from a to b, degrees. */
function angleTo(a: number, b: number): number { return posMod(b - a + 180, 360) - 180; }
