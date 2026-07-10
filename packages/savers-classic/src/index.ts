import type { SaverPlugin } from '@idle-screens/core';

import { toasters } from './toasters';
import { dvd } from './dvd';
import { warp } from './warp';
import { fish } from './fish';
import { rainstorm } from './rainstorm';
import { hardRain } from './hard-rain';
import { globe } from './globe';
import { spotlight } from './spotlight';
import { fadeOut } from './fade-out';
import { bouncingBall } from './bouncing-ball';
import { logo } from './logo';
import { messages } from './messages';
import { messages2 } from './messages2';
import { pipes } from './pipes';
import { bsod } from './bsod';
import { flurry } from './flurry';
import { fluid } from './fluid';
import { reactionDiffusion } from './reaction-diffusion';

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
  logo,
  messages,
  messages2,
  pipes,
  bsod,
  flurry,
  fluid,
  reactionDiffusion,
};

/** All classic savers, for bulk registration. */
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
  logo,
  messages,
  messages2,
  pipes,
  bsod,
  flurry,
  fluid,
  reactionDiffusion,
];
