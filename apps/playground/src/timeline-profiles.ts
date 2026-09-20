import type { ControlTrack, ParamSpace, SaverPlugin } from '@idle-screens/core';
import { demoTrack as blackHoleDemo } from '@idle-screens/saver-black-hole';
import { demoTrack as tideDemo } from '@idle-screens/saver-tide';
import { demoTrack as limelightDemo } from '@idle-screens/saver-limelight';
import { demoTrack as slipstreamDemo } from '@idle-screens/saver-slipstream';
import { demoTrack as catwalkDemo } from '@idle-screens/saver-catwalk';
import { demoTrack as metaquariumDemo } from '@idle-screens/saver-metaquarium';
import { messagesDemoTrack, dvdDemoTrack, warpDemoTrack, globeDemoTrack, fadeOutDemoTrack, flurryDemoTrack, pipesDemoTrack, mystifyDemoTrack } from '@idle-screens/savers-classic';

import { INTERIOR_MARKS, OPEN_MARKS, parseVignette, resolveVignette, type Marks } from '@idle-screens/saver-metaquarium';

export const PREVIEW_DURATION_MS = 6000;

/**
 * Savers that ship a canonical demo track. The timeline runs at the track's own
 * duration, so the scrubber covers one full cycle of the visual instead of the
 * generic 6s hold — a saver whose program is longer than that (tide floods over
 * 24s) otherwise resets a fraction of the way in and reads as broken.
 */
const DEMO_TRACKS: Record<string, ControlTrack> = {
  'black-hole': blackHoleDemo,
  tide: tideDemo,
  limelight: limelightDemo,
  slipstream: slipstreamDemo,
  catwalk: catwalkDemo,
  metaquarium: metaquariumDemo,
  messages: messagesDemoTrack,
  dvd: dvdDemoTrack,
  warp: warpDemoTrack,
  globe: globeDemoTrack,
  'fade-out': fadeOutDemoTrack,
  flurry: flurryDemoTrack,
  pipes: pipesDemoTrack,
  mystify: mystifyDemoTrack,
};

export type TimelineMode = 'track' | 'addressable' | 'live';

export interface TimelineLaneView {
  key: string;
  label: string;
  kind: 'param' | 'playback' | 'motion';
  hint?: string;
}

export interface TimelineProfile {
  program: string;
  duration: number;
  loop: boolean;
  mode: TimelineMode;
  lanes: TimelineLaneView[];
  track: ControlTrack;
  seed: number;
}

const SCHEMA_IDS = new Set(['snowfall', 'lanterns', 'sakura', 'dev-dashboard', 'aquarium', 'rain']);

function playbackTrack(program: string, seed: number, duration: number): ControlTrack {
  return { program, seed, duration, loop: true, deltas: [] };
}

function holdTrack(
  program: string,
  seed: number,
  duration: number,
  space: ParamSpace,
): ControlTrack {
  return {
    program,
    seed,
    duration,
    loop: true,
    deltas: Object.entries(space).map(([path, def]) => ({
      t: 0,
      path,
      value: def.default,
      ease: 'step' as const,
    })),
  };
}

function profileFromTrack(
  saver: SaverPlugin,
  track: ControlTrack,
  seed: number,
  mode: TimelineMode,
): TimelineProfile {
  const space = saver.manifest.paramSpace!;
  return {
    program: track.program,
    duration: track.duration ?? PREVIEW_DURATION_MS,
    loop: track.loop ?? true,
    mode,
    lanes: Object.entries(space).map(([key, def]) => ({
      key,
      label: key,
      kind: 'param' as const,
      hint: def.type,
    })),
    track: { ...track, seed: track.seed ?? seed },
    seed: track.seed ?? seed,
  };
}

/**
 * A rough stand-in for the world marks the running tank adds on top of
 * `OPEN_MARKS` (see `tank.ts`'s `buildVignette` → `this.scenery.marks`, built
 * by `scenery.ts`'s `buildScenery`). That builder is three.js- and
 * rng-driven — too heavy to run here just to size a timeline — so this
 * approximates the same named marks (`home1`/`home1in`…, `gate`/`plaza`/
 * `courtyard`, `hub`) at roughly the distances `scenery.ts` places them,
 * scaled by `crystalScale`. Good enough for a duration estimate: a default
 * recipe that names `home1`/`gate`/`hub` should walk there and back, not
 * parse as if those marks did not exist and settle for a shorter, wrong loop.
 */
function approxWorldMarks(space: ParamSpace | undefined): Marks {
  const world: Record<string, { x: number; y: number; z: number }> = {};
  const rawScale = Number(space?.crystalScale?.default ?? 1);
  const s = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
  const homes = Math.min(3, Math.max(0, Math.round(Number(space?.geodeHomes?.default ?? 0))));
  for (let i = 1; i <= homes; i += 1) {
    const t = homes === 1 ? 0 : (i - 1) / (homes - 1) - 0.5;
    const x = t * 132 * s, z = (-38 + Math.abs(t) * 30) * s;
    world[`home${i}`] = { x, y: 2 * s, z: z - 20 * s };
    world[`home${i}in`] = { x, y: 0, z: z + 5 * s };
  }
  const landmark = space?.landmark?.default;
  if (landmark === 'castle' || landmark === 'citadel') {
    const cz = (homes ? -150 : -110) * s;
    world.gate = { x: 0, y: 0, z: cz + 40 * s };
    world.plaza = { x: 0, y: 0, z: cz + 8 * s };
    world.courtyard = { x: 0, y: 0, z: cz };
  }
  if (Number(space?.paths?.default ?? 0) > 0) {
    // The real hub sits among the doorsteps; the village's rough centre is
    // close enough for a travel-time estimate.
    world.hub = { x: 0, y: 30 * s, z: -30 * s };
  }
  return world;
}

/**
 * How long a saver with no demo track holds before the timeline loops.
 *
 * Six seconds is right for a 2D loop and wrong for a world: the metaquarium
 * scenes orbit at well under a degree a second and play scripted vignettes a
 * minute long, so a 6 s loop snapped the camera back before it had moved and
 * never let a scene past its first beat — the workbench could not show the
 * thing it was built to tune. A vignette runs exactly its own length (so the
 * loop point is the script's); any other tank holds two minutes.
 */
export function holdDurationFor(saver: SaverPlugin): number {
  const space = saver.manifest.paramSpace;
  const script = space?.vignette?.default;
  if (typeof script === 'string' && script.trim()) {
    const indoors = space?.interior?.default === 'geode';
    // Match the running tank's mark set (`tank.ts` around `buildVignette`):
    // indoors is the fixed INTERIOR_MARKS room; outdoors is OPEN_MARKS plus
    // whatever the world itself adds (village doors, a landmark, the path
    // hub) — a script naming `home1`/`gate`/`hub` should size against those,
    // not a shorter fallback that never saw them.
    const marks = indoors ? INTERIOR_MARKS : { ...OPEN_MARKS, ...approxWorldMarks(space) };
    const v = parseVignette(resolveVignette(script), marks);
    if (v.duration > 0) return Math.ceil(v.duration * 1000);
  }
  if (saver.manifest.id.startsWith('metaquarium')) return 120_000;
  return PREVIEW_DURATION_MS;
}

export function buildTimelineProfile(
  saver: SaverPlugin,
  seed: number,
  explicitTrack?: ControlTrack | null,
): TimelineProfile {
  const id = saver.manifest.id;

  if (explicitTrack && explicitTrack.program === id) {
    const mode: TimelineMode = saver.manifest.paramSpace ? 'track' : 'addressable';
    if (saver.manifest.paramSpace) {
      return profileFromTrack(saver, explicitTrack, seed, mode);
    }
    return {
      program: id,
      duration: explicitTrack.duration ?? PREVIEW_DURATION_MS,
      loop: explicitTrack.loop ?? true,
      mode: 'addressable',
      lanes: [{ key: '_time', label: 'time', kind: 'playback', hint: 'control track' }],
      track: explicitTrack,
      seed: explicitTrack.seed ?? seed,
    };
  }

  const demo = DEMO_TRACKS[id];
  if (demo && saver.manifest.paramSpace) {
    return profileFromTrack(saver, demo, seed, 'track');
  }

  if (saver.manifest.paramSpace) {
    return profileFromTrack(
      saver,
      holdTrack(id, seed, holdDurationFor(saver), saver.manifest.paramSpace),
      seed,
      'track',
    );
  }

  if (saver.spec || SCHEMA_IDS.has(id)) {
    return {
      program: id,
      duration: PREVIEW_DURATION_MS,
      loop: true,
      mode: 'addressable',
      lanes: [{ key: '_time', label: 'time', kind: 'playback', hint: 'renderFrame(t)' }],
      track: playbackTrack(id, seed, PREVIEW_DURATION_MS),
      seed,
    };
  }

  const motion = saver.manifest.motionIntensity ?? 'moderate';
  return {
    program: id,
    duration: PREVIEW_DURATION_MS,
    loop: true,
    mode: 'live',
    lanes: [
      { key: '_playback', label: 'playback', kind: 'playback', hint: `${PREVIEW_DURATION_MS / 1000}s preview` },
      { key: '_motion', label: 'motion', kind: 'motion', hint: motion },
    ],
    track: playbackTrack(id, seed, PREVIEW_DURATION_MS),
    seed,
  };
}
