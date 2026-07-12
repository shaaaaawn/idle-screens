import type { ControlTrack, ParamSpace, SaverPlugin } from '@idle-screens/core';
import { demoTrack } from '@idle-screens/saver-black-hole';

export const PREVIEW_DURATION_MS = 6000;

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

  if (id === 'black-hole' && saver.manifest.paramSpace) {
    return profileFromTrack(saver, demoTrack, seed, 'track');
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
