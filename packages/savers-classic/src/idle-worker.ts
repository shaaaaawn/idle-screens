import { runIdleWorker } from '@idle-screens/core';
import { warp } from './warp';
import { hardRain } from './hard-rain';
import { rainstorm } from './rainstorm';
import { globe } from './globe';
import { spotlight } from './spotlight';

runIdleWorker({
  [warp.manifest.id]: warp,
  [hardRain.manifest.id]: hardRain,
  [rainstorm.manifest.id]: rainstorm,
  [globe.manifest.id]: globe,
  [spotlight.manifest.id]: spotlight,
});
