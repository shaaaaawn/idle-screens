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

/** Workbench demo: the steering showcase — the fish greets the viewer up
 *  close, is steered across the tank via fishTarget*, darts off, then
 *  returns to auto-pilot while the mood drifts violet and back. */
export const demoTrack: ControlTrack = {
  program: 'metaquarium',
  seed: 42,
  duration: 40_000,
  loop: true,
  deltas: [
    { t: 3_000, path: 'behavior', value: 'greet' },
    { t: 10_000, path: 'behavior', value: 'goto' },
    { t: 10_000, path: 'fishTargetX', value: -0.8, dur: 1 },
    { t: 16_000, path: 'fishTargetX', value: 0.8, dur: 6_000 },
    { t: 16_000, path: 'fishTargetY', value: 0.8, dur: 6_000 },
    { t: 17_000, path: 'fogColor', value: '#04002c', dur: 5_000 },
    { t: 22_000, path: 'behavior', value: 'dart' },
    { t: 25_500, path: 'behavior', value: 'auto' },
    // Fish swap, live mid-swim (offline: the classic voxel beta joins, then
    // Fish #1 returns).
    { t: 27_000, path: 'fishUrl', value: '/assets/metaquarium/beta-fish.glb' },
    { t: 35_000, path: 'fishUrl', value: '/assets/metaquarium/hero-fish.glb' },
    { t: 26_000, path: 'bloomStrength', value: 0.6, dur: 4_000 },
    { t: 30_000, path: 'fogColor', value: '#030009', dur: 5_000 },
    { t: 34_000, path: 'bloomStrength', value: 0.35, dur: 4_000 },
    { t: 36_000, path: 'cameraElevation', value: 15, dur: 2_000 },
  ],
};
