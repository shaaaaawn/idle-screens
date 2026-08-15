import type { ControlTrack, SaverContext, SaverInstance, SaverPlugin } from '@idle-screens/core';
import { detectCapabilities, computeTier } from '@idle-screens/capabilities';
import {
  metaquariumManifest,
  paramSpaceWith,
  type MetaquariumOptions,
} from './manifest';

export function createMetaquarium(opts: MetaquariumOptions = {}): SaverPlugin {
  const space = paramSpaceWith(opts.params);
  return {
    manifest: {
      ...metaquariumManifest,
      id: opts.id ?? metaquariumManifest.id,
      label: opts.label ?? metaquariumManifest.label,
      paramSpace: space,
    },
    async mount(ctx: SaverContext): Promise<SaverInstance> {
      const [{ mountTank }, caps] = await Promise.all([
        import('./tank'),
        detectCapabilities(),
      ]);
      return mountTank(ctx, space, computeTier(caps), opts.catalog);
    },
  };
}

export const metaquarium: SaverPlugin = createMetaquarium();

export const demoTrack: ControlTrack = {
  program: 'metaquarium',
  seed: 42,
  duration: 30_000,
  loop: true,
  deltas: [
    { t: 5_000, path: 'autoRotate', value: 3, dur: 4_000 },
    { t: 15_000, path: 'fogColor', value: '#04002c', dur: 5_000 },
    { t: 22_000, path: 'fogColor', value: '#030009', dur: 5_000 },
    { t: 25_000, path: 'autoRotate', value: 0, dur: 4_000 },
  ],
};
