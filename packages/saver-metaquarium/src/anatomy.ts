/**
 * A metaquarium scene, read back as parts — for anyone who has only its
 * params: the viewer's scene card, a channel's getState, an agent with no eyes.
 *
 * A SaverSpec explains itself (its layers ARE the parts list). A classic saver
 * is `{id: "metaquarium"}` plus a control track of ~90 params, and the viewer
 * card used to give up on it: "no layers to take apart". This does the taking
 * apart, from the same parsers and presets the tank runs, so what it says is
 * what renders:
 *
 *   cast      one row per fishMix entry: how many, which breed, how it moves,
 *             which slots it fills (the numbering follow/spots/vignettes use)
 *   sections  Room · World · Stage · Camera · Motion · Look — only what the
 *             author set, plus the room and the camera, which every scene has
 *   palette   the colours on screen: the author's, else the room's own
 *   timed     choreographed changes the track plays after mount
 *   problems  params set but doing nothing (validateMetaquariumParams)
 *
 * Zero-dep and exported through `./manifest`, like the guide. It describes
 * only what the params say; behaviour a breed has on its own (a blowfish's
 * flirting) is the guide's to tell.
 */

import { parsePropMix } from './crystals';
import { breedOf, isMintedId } from './farm';
import { environmentOf } from './environments';
import { validateMetaquariumParams, type ParamProblem } from './guide';
import { expandFishMixSlots, parseFishMix } from './ipfs';
import { METAQUARIUM_PARAMS } from './manifest';
import { parseSpotCues, parseSpotRig } from './spots';
import { VIGNETTES } from './vignette';

type Params = Readonly<Record<string, unknown>>;

export interface AnatomyCastRow {
  /** Slots this entry fills, inclusive: [first, last]. */
  slots: [number, number];
  count: number;
  /** How many of `count` fit under the cap and swim. */
  visible: number;
  breed: string;
  /** What to call it: "tang", "baby fish", "angelfish #257". */
  label: string;
  /** How it moves: its `@style`, the scene's swimStyle, or "floor" for the walkers. */
  motion: string;
  /** Its own `*size`, when it has one. */
  size: number | null;
  /** Every slot of this entry is past the device cap: cast but never swimming. An entry that straddles the cap is not offstage; `visible` counts its swimmers. */
  offstage: boolean;
}

export interface AnatomySection { name: 'Room' | 'World' | 'Stage' | 'Camera' | 'Motion' | 'Look'; items: string[] }

export interface MetaquariumAnatomy {
  summary: string;
  cast: AnatomyCastRow[];
  /** Fish that swim (capped). */
  castTotal: number;
  sections: AnatomySection[];
  palette: string[];
  /** Deltas the track plays after mount: a camera cut at 40 s, a day turning to night. */
  timed: Array<{ atMs: number; path: string; value: unknown }>;
  problems: ParamProblem[];
}

const CAST_CAP = 24;
const FLOOR_BREEDS = new Set(['crab', 'starfish', 'octopus']);
const BREED_NOUN: Record<string, [string, string]> = {
  dori: ['tang', 'tangs'],
  babyfish: ['baby fish', 'baby fish'],
  blowfish: ['blowfish', 'blowfish'],
  octopus: ['octopus', 'octopuses'],
  starfish: ['starfish', 'starfish'],
  crab: ['crab', 'crabs'],
  shark: ['shark', 'sharks'],
  glowfish: ['glowfish', 'glowfish'],
  hackerfish: ['hackerfish', 'hackerfish'],
  betafish: ['betafish', 'betafish'],
  angelfish: ['angelfish', 'angelfish'],
  seahorse: ['seahorse', 'seahorses'],
  seaturtle: ['sea turtle', 'sea turtles'],
};
const noun = (breed: string, n: number): string => (BREED_NOUN[breed] ?? [breed, `${breed}s`])[n === 1 ? 0 : 1];

/**
 * The params a track holds at mount, plus the deltas it plays later. A delta
 * is in force from the start when it has `t` 0 (or none) or a `liveAt` (a
 * live steer: already arrived for anyone mounting now); later ones are
 * choreography. Same path: the last one wins, as in the tank.
 *
 * `ParamDelta` carries no wall-clock marker, so a steer that has already
 * happened is told apart only by the caller stamping `liveAt` on it: without
 * that, a steer at a positive `t` reads as future choreography.
 */
export function metaquariumParamsFromTrack(
  deltas: ReadonlyArray<{ t?: unknown; path?: unknown; value?: unknown; liveAt?: unknown }> | undefined,
): { params: Record<string, unknown>; timed: Array<{ atMs: number; path: string; value: unknown }> } {
  const params: Record<string, unknown> = {};
  const timed: Array<{ atMs: number; path: string; value: unknown }> = [];
  for (const d of deltas ?? []) {
    if (!d || typeof d.path !== 'string') continue;
    const t = typeof d.t === 'number' && Number.isFinite(d.t) ? d.t : 0;
    if (t <= 0 || typeof d.liveAt === 'number') params[d.path] = d.value;
    else timed.push({ atMs: t, path: d.path, value: d.value });
  }
  timed.sort((a, b) => a.atMs - b.atMs);
  return { params, timed };
}

/** Read at call time: manifest re-exports this module, so at load METAQUARIUM_PARAMS may not exist yet. */
const defaultOf = (k: string): unknown => (METAQUARIUM_PARAMS as unknown as Record<string, { default?: unknown }>)[k]?.default;

/** Read the scene as parts. `params` is what the author set (unset = default). */
export function describeMetaquarium(params: Params, timed: MetaquariumAnatomy['timed'] = []): MetaquariumAnatomy {
  const has = (k: string): boolean => params[k] !== undefined && params[k] !== null && params[k] !== '';
  const val = (k: string): unknown => (has(k) ? params[k] : defaultOf(k));
  const num = (k: string): number => { const n = Number(val(k)); return Number.isFinite(n) ? n : 0; };
  const str = (k: string): string => String(val(k) ?? '').trim();
  const pct = (k: string): string => `${Math.round(num(k) * 100)}%`;

  // ---- cast ---------------------------------------------------------------
  const cast: AnatomyCastRow[] = [];
  const swimStyle = str('swimStyle');
  const motionOf = (breed: string, style?: string): string =>
    FLOOR_BREEDS.has(breed) ? 'floor' : (style ?? (has('swimStyle') ? swimStyle : 'swims'));
  const mix = has('fishMix') ? parseFishMix(str('fishMix')).entries : [];
  if (mix.length) {
    const slots = expandFishMixSlots(mix, Number.MAX_SAFE_INTEGER);
    let at = 0;
    for (const e of mix) {
      const minted = isMintedId(e.id);
      cast.push({
        slots: [at, at + e.count - 1],
        count: e.count,
        visible: Math.max(0, Math.min(e.count, CAST_CAP - at)),
        breed: e.breed,
        label: minted ? (e.count > 1 ? `${e.breed} from #${e.id}` : `${e.breed} #${e.id}`) : noun(e.breed, e.count),
        motion: motionOf(e.breed, e.style),
        size: slots[at]?.size ?? null,
        offstage: at >= CAST_CAP,
      });
      at += e.count;
    }
  } else {
    const n = Math.min(Math.max(1, Math.round(num('fishCount'))), CAST_CAP);
    const id = Number(/fish_(\d+)_/.exec(str('fishUrl'))?.[1] ?? NaN);
    const breed = (Number.isFinite(id) && breedOf(id)) || 'fish';
    cast.push({ slots: [0, n - 1], count: n, visible: n, breed, label: Number.isFinite(id) ? `${breed} #${id}` : breed, motion: motionOf(breed), size: null, offstage: false });
  }
  const castTotal = Math.min(cast.reduce((n, r) => n + r.count, 0), CAST_CAP);
  const slotName = (slot: number): string => {
    const row = cast.find((r) => slot >= r.slots[0] && slot <= r.slots[1]);
    return row ? `slot ${slot} (${row.breed === 'fish' ? 'fish' : noun(row.breed, 1)})` : `slot ${slot} (empty)`;
  };

  // ---- room ---------------------------------------------------------------
  const env = environmentOf(str('environment'));
  const room: string[] = [env.label];
  if (has('floorKind') && str('floorKind') !== 'auto') room.push(`${str('floorKind')} floor`);
  else room.push(`${env.floor} floor`);
  if (env.water) room.push('water overhead');
  if (num('water') > 0) room.push(`water ${pct('water')}${has('waterClarity') ? `, clarity ${pct('waterClarity')}` : ''}`);
  if (num('caustics') > 0) room.push(`caustics ${pct('caustics')}`);
  if (num('surfaceMirror') > 0) room.push(`surface mirror ${pct('surfaceMirror')}`);
  // rayStrength -1 (the default) defers to the room preset's own shafts, as the tank does.
  const rays = has('rayStrength') && num('rayStrength') >= 0 ? num('rayStrength') : env.rays?.strength ?? null;
  if (rays !== null) room.push(rays === 0 ? 'no light shafts' : `light shafts ${Math.round(rays * 100)}%`);
  if (has('fogNear') || has('fogFar')) room.push(`fog ${num('fogNear')}–${num('fogFar')}`);
  if (str('interior') === 'geode') room.push('inside a geode home');

  // ---- world --------------------------------------------------------------
  const world: string[] = [];
  if (str('landmark') !== 'none') world.push(`the ${str('landmark')}`);
  if (num('geodeHomes') > 0) world.push(`${num('geodeHomes')} geode home${num('geodeHomes') === 1 ? '' : 's'}`);
  if (num('paths') > 0) world.push(`paths${has('pathMaterial') && str('pathMaterial') !== 'auto' ? ` (${str('pathMaterial')})` : ''}`);
  if (str('fountain') !== 'none') world.push(`${str('fountain')} fountain`);
  if (num('streetLamps') > 0) world.push('street lamps');
  if (num('floraDensity') > 0) world.push(`plants ${pct('floraDensity')}${has('floraMix') ? `: ${str('floraMix')}` : ''}`);
  if (num('rockDensity') > 0) world.push(`rocks ${pct('rockDensity')}`);
  if (num('geodes') > 0) world.push(`wild geodes ${pct('geodes')}`);
  if (has('propMix')) {
    const props = parsePropMix(str('propMix')).entries;
    const n = props.reduce((k, e) => k + e.count, 0);
    if (n) world.push(`${n} crystal${n === 1 ? '' : 's'}: ${props.map((e) => `${e.count > 1 ? `${e.count} ` : ''}${e.palette === 'env' ? '' : `${e.palette} `}${e.habit}${e.size > 1 ? ` ×${e.size}` : ''}`).join(', ')}`);
  }
  if (num('skyLanterns') > 0) world.push('jellyfish lanterns overhead');
  if (num('horizon') > 0) world.push('a far horizon');
  if (num('bubbleVents') > 0) world.push('bubble vents');
  if (num('marineSnow') > 0) world.push('marine snow');
  if (num('co2Mist') > 0) world.push('CO₂ mist');
  if (num('pearling') > 0) world.push('pearling plants');
  if (Math.round(num('shoal') * CAST_CAP * 2.5) >= 3) world.push(`a school of ${str('shoalKind')}`);

  // ---- stage --------------------------------------------------------------
  const stage: string[] = [];
  const rig = parseSpotRig(str('spotRig')).spots;
  if (rig.length) stage.push(`${rig.length} spotlight${rig.length === 1 ? '' : 's'} on ${rig.map((s) => slotName(s.slot)).join(', ')}`);
  else if (num('followSpot') >= 0) stage.push(`follow-spot on ${slotName(num('followSpot'))}`);
  if (has('spotCues') && (rig.length || num('followSpot') >= 0)) {
    const sheet = parseSpotCues(str('spotCues'), Math.max(1, rig.length));
    stage.push(`${sheet.cues.length} light cues, ${Math.round(sheet.duration)}s loop`);
  }
  if (has('vignette')) {
    const v = str('vignette');
    stage.push(VIGNETTES[v] ? `vignette: ${v}` : `vignette: ${v.split(/[|\n]/).filter((b) => b.trim()).length} beats`);
  }
  if (str('starfishDance') !== 'off') stage.push(`starfish ${str('starfishDance')}${has('danceTempo') ? ` at ${num('danceTempo')} bpm` : ''}`);

  // ---- camera -------------------------------------------------------------
  const camera: string[] = [];
  const follow = Math.round(num('cameraFollow'));
  if (follow >= 0) {
    camera.push(`rides with ${slotName(follow)}`);
    if (has('followDistance')) camera.push(`${num('followDistance')} behind`);
    if (has('followAngle') && num('followAngle') !== 0) camera.push(`${num('followAngle')}° round`);
  } else {
    if (str('shot') !== 'orbit') camera.push(`${str('shot')} shot`);
    camera.push(`distance ${num('cameraDistance')}`, `elevation ${num('cameraElevation')}°`);
    const spin = num('autoRotate');
    camera.push(spin > 0 ? `orbits ${spin}°/s` : 'holds still');
  }

  // ---- motion -------------------------------------------------------------
  const motion: string[] = [];
  if (has('swimSpeed')) motion.push(`speed ×${num('swimSpeed')}`);
  if (has('pathShape')) motion.push(`${str('pathShape')} paths`);
  if (has('formationShape')) motion.push(`${str('formationShape')} formation`);
  if (str('maneuver') !== 'none') motion.push(`${str('maneuver')} maneuvers`);
  if (num('bodyWiggle') > 0) motion.push(`wiggle ${pct('bodyWiggle')}`);
  if (has('fishSize') && num('fishSize') !== 1) motion.push(`fish ×${num('fishSize')} size`);

  // ---- look ---------------------------------------------------------------
  const look: string[] = [];
  if (str('fishLighting') === 'flat') look.push('flat-lit fish');
  if (str('fishLook') === 'neon') look.push('neon (blacklight) coats');
  if (num('eyeLife') > 0) look.push('living eyes');
  if (num('finish') > 0) look.push(`finish ${pct('finish')}`);
  if (has('fishGlow')) look.push(`glow ${pct('fishGlow')}`);
  if (num('fishAmbient') > 0) look.push(`fish ambient ${pct('fishAmbient')}`);
  if (str('dither') === 'on') look.push('dither');

  const sections: AnatomySection[] = (
    [['Room', room], ['World', world], ['Stage', stage], ['Camera', camera], ['Motion', motion], ['Look', look]] as const
  ).filter(([, items]) => items.length > 0).map(([name, items]) => ({ name, items: [...items] }));

  // ---- palette: the author's colour, else the room's own -------------------
  const palette: string[] = [];
  const add = (c: unknown): void => {
    if (typeof c === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(c) && !palette.includes(c.toLowerCase())) palette.push(c.toLowerCase());
  };
  const roomOr = (k: string, room: string | undefined): void => add(has(k) ? params[k] : room ?? defaultOf(k));
  roomOr('fogColor', env.palette?.fog);
  roomOr('floorColor', env.palette?.floor);
  if (num('moteDensity') > 0 || num('marineSnow') > 0 || env.palette) roomOr('moteColor', env.palette?.mote);
  if (num('water') > 0) roomOr('waterTint', env.palette?.tint);
  for (const s of rig) add(s.color);
  if (!rig.length && num('followSpot') >= 0) add(str('spotColor'));
  if (has('floraPalette')) for (const c of str('floraPalette').split(',')) add(c.trim());

  // ---- summary ------------------------------------------------------------
  const swimming = cast.filter((r) => r.visible > 0);
  // A cut-off entry is named for who actually swims ("an octopus", not "an octopuses").
  const nameOf = (r: AnatomyCastRow): string => (r.visible < r.count && !r.label.includes('#') ? noun(r.breed, r.visible) : r.label);
  const names = swimming.map((r) => (r.visible === 1 ? `${/^[aeiou]/.test(nameOf(r)) ? 'an' : 'a'} ${nameOf(r)}` : `${r.visible} ${nameOf(r)}`));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? 'no fish';
  const where = str('interior') === 'geode' ? 'inside a geode home' : `in the ${env.label.toLowerCase()}`;
  // The headline act: a dance, then a vignette, then the lights.
  const act = stage.find((x) => x.startsWith('starfish ')) ?? stage.find((x) => x.startsWith('vignette')) ?? stage[0];
  const extra = act ?? (str('landmark') !== 'none' ? `around the ${str('landmark')}` : num('geodeHomes') > 0 ? 'in a village' : null);
  const cam = follow >= 0 ? `following ${slotName(follow)}` : num('autoRotate') > 0 ? 'slow orbit' : 'still camera';
  const summary = `${list} ${where}${extra ? `, ${extra}` : ''}; ${cam}.`;

  return { summary, cast, castTotal, sections, palette, timed, problems: validateMetaquariumParams(params) };
}
