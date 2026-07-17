import type { SaverContext, SaverInstance, SaverPlugin } from '@idle-screens/core';
import { metaquariumManifest } from './manifest';

/**
 * Metaquarium: a three.js fish tank. three loads lazily on first mount via the
 * dynamic import, so registering this saver costs nothing until it runs.
 */
export const metaquarium: SaverPlugin = {
  manifest: metaquariumManifest,
  async mount(ctx: SaverContext): Promise<SaverInstance> {
    const { mountTank } = await import('./tank');
    return mountTank(ctx);
  },
};
