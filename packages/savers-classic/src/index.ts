import type { SaverPlugin } from '@idle-screens/core';

import { toasters } from './toasters';
import { dvd, dvdDemoTrack } from './dvd';
import { warp, warpDemoTrack } from './warp';
import { fish } from './fish';
import { rainstorm } from './rainstorm';
import { hardRain } from './hard-rain';
import { globe, globeDemoTrack } from './globe';
import { spotlight } from './spotlight';
import { fadeOut, fadeOutDemoTrack } from './fade-out';
import { bouncingBall } from './bouncing-ball';
import { messages, messagesDemoTrack } from './messages';
import { pipes, pipesDemoTrack } from './pipes';
import { bsod } from './bsod';
import { flurry, flurryDemoTrack } from './flurry';
import { fluid } from './fluid';
import { reactionDiffusion } from './reaction-diffusion';
import { mystify } from './mystify';

export {
  toasters,
  dvd,
  warp,
  fish,
  rainstorm,
  hardRain,
  globe,
  spotlight,
  fadeOut,
  bouncingBall,
  messages,
  pipes,
  bsod,
  flurry,
  fluid,
  reactionDiffusion,
  mystify,
};

/** All classic savers, for bulk registration. */
export { messagesDemoTrack, dvdDemoTrack, warpDemoTrack, globeDemoTrack, fadeOutDemoTrack, flurryDemoTrack, pipesDemoTrack };

export const CLASSIC_SAVERS: SaverPlugin[] = [
  toasters,
  dvd,
  warp,
  fish,
  rainstorm,
  hardRain,
  globe,
  spotlight,
  fadeOut,
  bouncingBall,
  messages,
  pipes,
  bsod,
  flurry,
  fluid,
  reactionDiffusion,
  mystify,
];
