import type { SaverContext, SaverInstance, SaverPlugin } from '@idle-screens/core';
import {
  metaquariumManifest,
  paramSpaceWith,
  type MetaquariumOptions,
} from './manifest';

/**
 * Build a Metaquarium saver variant: same tank, different id/label and param
 * defaults (e.g. a farm-connected tank vs the bundled-fish default). three
 * loads lazily on first mount via the dynamic import, so registering variants
 * costs nothing until one runs.
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
      const { mountTank } = await import('./tank');
      return mountTank(ctx, space);
    },
  };
}

/** The default Metaquarium saver (bundled single breed until a farm is set). */
export const metaquarium: SaverPlugin = createMetaquarium();
