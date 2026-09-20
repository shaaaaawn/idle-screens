import type { ControlTrack, SaverContext, SaverInstance, SaverPlugin } from '@idle-screens/core';
import { detectCapabilities, computeTier } from '@idle-screens/capabilities';
import {
  metaquariumManifest,
  paramSpaceWith,
  type MetaquariumOptions,
} from './manifest';

export function createMetaquarium(opts: MetaquariumOptions = {}): SaverPlugin {
  if (opts.backend === 'lofi' && opts.catalog) {
    // The lofi tank fetches icons by numeric id from the live IPFS asset set
    // (`fishAsset` in farm.ts) — that lookup never consults a `FishEntry[]`,
    // so a custom catalog's `localGlb`/closed-world guarantees (which the
    // webgl tank honors via `parseFishMix(mix, catalog)`) can't be honored
    // here: a closed-world id would still try to resolve a live icon instead
    // of failing closed, or resolve to the wrong fish entirely. Silently
    // dropping `catalog` would let that mismatch pass unnoticed, so reject
    // the combination instead of half-applying it.
    throw new Error(
      "[metaquarium] createMetaquarium({ backend: 'lofi', catalog }) is unsupported — the lofi renderer resolves fish icons by id " +
        'from the live asset set and cannot honor a custom fish catalog. Pass `catalog` only with the default webgl backend.',
    );
  }
  const space = paramSpaceWith(opts.params);
  return {
    manifest: {
      ...metaquariumManifest,
      id: opts.id ?? metaquariumManifest.id,
      label: opts.label ?? metaquariumManifest.label,
      paramSpace: space,
      // The lofi backend only ever touches a 2d canvas, at a fraction of the
      // WebGL tank's cost — capability gating (evaluateSaver/eligibleSavers)
      // must see that, or it blocks lofi on exactly the hardware it targets.
      minBackend: opts.backend === 'lofi' ? 'canvas2d' : metaquariumManifest.minBackend,
      costTier: opts.backend === 'lofi' ? 'low' : metaquariumManifest.costTier,
    },
    async mount(ctx: SaverContext): Promise<SaverInstance> {
      if (opts.backend === 'lofi') {
        // Its own lazy chunk: the lofi tank never pulls three.js.
        const [{ mountLofi }, caps] = await Promise.all([
          import('./lofi-tank'),
          detectCapabilities(),
        ]);
        return mountLofi(ctx, space, computeTier(caps));
      }
      const [{ mountTank }, caps] = await Promise.all([
        import('./tank'),
        detectCapabilities(),
      ]);
      return mountTank(ctx, space, computeTier(caps), opts.catalog);
    },
  };
}

export const metaquarium: SaverPlugin = createMetaquarium();

/** A 40s looping tour of every steerable feature: camera orbit, fog color
 *  and depth, the swimSpeed glide (closed-form integral — no teleport),
 *  fishCount growth (pool spawns on demand), plankton motes, floor tint.
 *  Every param returns to its default before the loop ends, so wraps are
 *  seamless and the resting tank is the published default. */
export const demoTrack: ControlTrack = {
  program: 'metaquarium',
  seed: 42,
  duration: 40_000,
  loop: true,
  deltas: [
    { t: 5_000, path: 'autoRotate', value: 3, dur: 4_000 },
    { t: 6_000, path: 'fishCount', value: 5, ease: 'step' },
    { t: 8_000, path: 'swimSpeed', value: 2.4, dur: 3_000 },
    { t: 10_000, path: 'moteDensity', value: 0.8, dur: 4_000 },
    { t: 12_000, path: 'fogNear', value: 32, dur: 4_000 },
    { t: 12_000, path: 'fogFar', value: 280, dur: 4_000 },
    { t: 15_000, path: 'fogColor', value: '#04002c', dur: 5_000 },
    { t: 16_000, path: 'floorColor', value: '#0d3330', dur: 4_000 },
    { t: 20_000, path: 'swimSpeed', value: 1, dur: 4_000 },
    { t: 24_000, path: 'fogColor', value: '#030009', dur: 5_000 },
    { t: 27_000, path: 'fogNear', value: 60, dur: 5_000 },
    { t: 27_000, path: 'fogFar', value: 500, dur: 5_000 },
    { t: 29_000, path: 'floorColor', value: '#0a1d33', dur: 4_000 },
    { t: 31_000, path: 'moteDensity', value: 0, dur: 5_000 },
    { t: 33_000, path: 'autoRotate', value: 0, dur: 4_000 },
    { t: 36_000, path: 'fishCount', value: 1, ease: 'step' },
  ],
};
