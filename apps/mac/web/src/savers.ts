/**
 * Single source of truth for which savers the Mac wrapper ships. Imported by
 * the runtime host page AND (via gen-catalog.mjs) used to generate the Swift
 * SaverCatalog so the menu and the web page never drift.
 *
 * Passthrough savers (black hole, spotlight) need a live page to eat, so they
 * are excluded — in the wrapper the page is nothing but the saver itself.
 */
import type { SaverPlugin } from '@idle-screens/core';
import { CLASSIC_SAVERS } from '@idle-screens/savers-classic';
import {
  compileSaver,
  DASHBOARD_SPEC,
  LANTERNS_SPEC,
  SAKURA_SPEC,
  SNOWFALL_SPEC,
} from '@idle-screens/schema';

export const SAVERS: SaverPlugin[] = [
  ...CLASSIC_SAVERS.filter((s) => !s.manifest.passthrough),
  compileSaver(SNOWFALL_SPEC),
  compileSaver(LANTERNS_SPEC),
  compileSaver(SAKURA_SPEC),
  compileSaver(DASHBOARD_SPEC),
];

export interface SaverEntry {
  id: string;
  label: string;
}

export const SAVER_CATALOG: SaverEntry[] = SAVERS.map((s) => ({
  id: s.manifest.id,
  label: s.manifest.label,
}));
