/**
 * Single source of truth for which savers the Mac wrapper ships. Imported by
 * the runtime host page AND (via gen-catalog.mjs) used to generate the Swift
 * SaverCatalog so the menu and the web page never drift.
 *
 * Passthrough savers (black hole, spotlight) need a live page to eat, so they
 * are excluded — in the wrapper the page is nothing but the saver itself.
 */
import type { SaverPlugin } from '@idle-screens/core';
import { createMetaquarium } from '@idle-screens/saver-metaquarium';
import { CLASSIC_SAVERS } from '@idle-screens/savers-classic';
import {
  compileSaver,
  AQUARIUM_SPEC,
  AURORA_SPEC,
  COMETS_SPEC,
  CONSTELLATION_SPEC,
  DASHBOARD_SPEC,
  LANTERNS_SPEC,
  MATRIX_RAIN_SPEC,
  NOSTALGHIA_CANDLE_SPEC,
  ORRERY_SPEC,
  POLYGONS_SPEC,
  PROCESSION_SPEC,
  RAIN_SPEC,
  SAKURA_SPEC,
  SNOWFALL_SPEC,
  WARP_TUNNEL_SPEC,
} from '@idle-screens/schema';

export const SAVERS: SaverPlugin[] = [
  ...CLASSIC_SAVERS.filter((s) => !s.manifest.passthrough),
  // The tank. It is not in CLASSIC_SAVERS (its own package, so the barrel
  // stays three.js-free), which is the whole reason the native hosts silently
  // had no aquarium while the web did. Listed explicitly so that cannot
  // recur quietly.
  //
  // Two things it does that no other saver here does: it needs WebGL2, and it
  // streams its fish over the network. Neither is fatal — the host skips a
  // saver that fails to mount, and a fish that will not load falls back to a
  // procedural body rather than an empty tank.
  //
  // `dracoPath` is not optional here the way it is in Vite. The package's
  // default resolves its decoder through `import.meta.url`, and this bundle is
  // an IIFE (WKWebView refuses module scripts over file://) where esbuild
  // cannot fill that in — it warns and emits a URL that resolves nowhere. So
  // point it at the copy build.mjs stages beside the bundle, relative to
  // index.html.
  createMetaquarium({ params: { dracoPath: 'assets/draco/' } }),
  compileSaver(SNOWFALL_SPEC),
  compileSaver(LANTERNS_SPEC),
  compileSaver(SAKURA_SPEC),
  compileSaver(DASHBOARD_SPEC),
  compileSaver(AQUARIUM_SPEC),
  compileSaver(AURORA_SPEC),
  compileSaver(COMETS_SPEC),
  compileSaver(CONSTELLATION_SPEC),
  compileSaver(MATRIX_RAIN_SPEC),
  compileSaver(NOSTALGHIA_CANDLE_SPEC),
  compileSaver(ORRERY_SPEC),
  compileSaver(POLYGONS_SPEC),
  compileSaver(PROCESSION_SPEC),
  compileSaver(RAIN_SPEC),
  compileSaver(WARP_TUNNEL_SPEC),
];

export interface SaverEntry {
  id: string;
  label: string;
}

export const SAVER_CATALOG: SaverEntry[] = SAVERS.map((s) => ({
  id: s.manifest.id,
  label: s.manifest.label,
}));
