import type { ControlTrack, ParamSpace, SaverPlugin } from '@idle-screens/core';
import { demoTrack as blackHoleDemo } from '@idle-screens/saver-black-hole';
import { demoTrack as tideDemo } from '@idle-screens/saver-tide';
import { demoTrack as limelightDemo } from '@idle-screens/saver-limelight';
import { demoTrack as slipstreamDemo } from '@idle-screens/saver-slipstream';
import { demoTrack as catwalkDemo } from '@idle-screens/saver-catwalk';
import { demoTrack as metaquariumDemo } from '@idle-screens/saver-metaquarium';
import { messagesDemoTrack, dvdDemoTrack, warpDemoTrack, globeDemoTrack, fadeOutDemoTrack, flurryDemoTrack, pipesDemoTrack, mystifyDemoTrack } from '@idle-screens/savers-classic';

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
      holdTrack(id, seed, PREVIEW_DURATION_MS, saver.manifest.paramSpace),
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
