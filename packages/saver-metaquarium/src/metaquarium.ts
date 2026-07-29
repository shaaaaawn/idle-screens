import type { ControlTrack, SaverContext, SaverInstance, SaverPlugin } from '@idle-screens/core';
import { detectCapabilities, computeTier } from '@idle-screens/capabilities';
import {
  metaquariumManifest,
  paramSpaceWith,
  type MetaquariumOptions,
} from './manifest';

/**
 * Build a Metaquarium saver variant: same tank, different id/label and param
 * defaults (e.g. a farm-connected tank vs the bundled-fish default). three
 * loads lazily on first mount via the dynamic import, so registering variants
 * costs nothing until one runs. Device tier (WebGPU-class → 'high') scales
 * pixel ratio, AA, bloom resolution and fish cap inside the tank.
 */
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
      return mountTank(ctx, space, computeTier(caps));
    },
  };
}

/** The default Metaquarium saver (bundled hero fish until a farm is set). */
export const metaquarium: SaverPlugin = createMetaquarium();

/** Workbench demo: a slow orbit pull-back, a bloom swell, and a fog-color
 *  drift into deep violet and back. All eases smooth; nothing steps. */
export const demoTrack: ControlTrack = {
  program: 'metaquarium',
  seed: 42,
  duration: 30_000,
  loop: true,
  deltas: [
    { t: 4_000, path: 'cameraDistance', value: 220, dur: 6_000 },
    { t: 8_000, path: 'fogColor', value: '#04002c', dur: 5_000 },
    { t: 12_000, path: 'bloomStrength', value: 0.6, dur: 4_000 },
    { t: 18_000, path: 'cameraElevation', value: 32, dur: 5_000 },
    { t: 22_000, path: 'fogColor', value: '#030009', dur: 5_000 },
    { t: 24_000, path: 'bloomStrength', value: 0.35, dur: 4_000 },
    { t: 28_000, path: 'cameraDistance', value: 140, dur: 2_000 },
    { t: 29_000, path: 'cameraElevation', value: 15, dur: 1_000 },
  ],
};
