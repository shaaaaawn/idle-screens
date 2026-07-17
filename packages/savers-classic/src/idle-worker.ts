import { runIdleWorker } from '@idle-screens/core';
import { compileSaver } from '@idle-screens/schema';
import { warp } from './warp';
import { hardRain } from './hard-rain';
import { rainstorm } from './rainstorm';
import { globe } from './globe';
import { spotlight } from './spotlight';
import { mystify } from './mystify';
import { pipes } from './pipes';
import { flurry } from './flurry';
import { fluid } from './fluid';
import { reactionDiffusion } from './reaction-diffusion';

runIdleWorker(
  {
    [warp.manifest.id]: warp,
    [hardRain.manifest.id]: hardRain,
    [rainstorm.manifest.id]: rainstorm,
    [globe.manifest.id]: globe,
    [spotlight.manifest.id]: spotlight,
    [mystify.manifest.id]: mystify,
    [pipes.manifest.id]: pipes,
    [flurry.manifest.id]: flurry,
    [fluid.manifest.id]: fluid,
    [reactionDiffusion.manifest.id]: reactionDiffusion,
  },
  { compiler: compileSaver },
);
