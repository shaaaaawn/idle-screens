import type { SaverSpec } from '../types';
import { AQUARIUM_SPEC } from './aquarium';
import { AURORA_SPEC } from './aurora';
import { COMETS_SPEC } from './comets';
import { CONSTELLATION_SPEC } from './constellation';
import { DASHBOARD_SPEC } from './dev-dashboard';
import { SPARSE_NIGHT_SPEC } from './sparse-night';
import { FACETS_SPEC } from './facets';
import { HAIKU_SPEC } from './haiku';
import { LANTERNS_SPEC } from './lanterns';
import { LOBBY_TALK_SPEC } from './lobby-talk';
import { MATRIX_RAIN_SPEC } from './matrix-rain';
import { NOSTALGHIA_CANDLE_SPEC } from './nostalghia-candle';
import { POLYGONS_SPEC } from './polygons';
import { ORRERY_SPEC } from './orrery';
import { PINGS_SPEC } from './pings';
import { PROCESSION_SPEC } from './procession';
import { RAIN_SPEC } from './rain';
import { RELAY_BOARD_SPEC } from './relay-board';
import { SAKURA_SPEC } from './sakura';
import { SNOWFALL_SPEC } from './snowfall';
import { THERMAL_FIELD_SPEC } from './thermal-field';
import { WARP_TUNNEL_SPEC } from './warp-tunnel';
import { TYPED_CUE_SPEC } from './typed-cue';

export { AQUARIUM_SPEC } from './aquarium';
export { COMETS_SPEC } from './comets';
export { CONSTELLATION_SPEC } from './constellation';
export { RAIN_SPEC } from './rain';
export { SNOWFALL_SPEC } from './snowfall';
export { LANTERNS_SPEC } from './lanterns';
export { LOBBY_TALK_SPEC } from './lobby-talk';
export { SAKURA_SPEC } from './sakura';
export { DASHBOARD_SPEC } from './dev-dashboard';
export { HAIKU_SPEC } from './haiku';
export { ORRERY_SPEC } from './orrery';
export { AURORA_SPEC } from './aurora';
export { MATRIX_RAIN_SPEC } from './matrix-rain';
export { NOSTALGHIA_CANDLE_SPEC } from './nostalghia-candle';
export { PINGS_SPEC } from './pings';
export { FACETS_SPEC } from './facets';
export { RELAY_BOARD_SPEC } from './relay-board';
export { POLYGONS_SPEC } from './polygons';
export { PROCESSION_SPEC } from './procession';
export { WARP_TUNNEL_SPEC } from './warp-tunnel';
export { THERMAL_FIELD_SPEC } from './thermal-field';
export { SPARSE_NIGHT_SPEC } from './sparse-night';
export { TYPED_CUE_SPEC } from './typed-cue';

/** Catalog entry for a bundled schema example. */
export interface SchemaExample {
  id: string;
  label: string;
  spec: SaverSpec;
}

/** Ordered catalog of bundled schema examples. Add new specs as standalone files, then register here. */
export const SCHEMA_EXAMPLES: readonly SchemaExample[] = [
  { id: 'aquarium', label: 'Aquarium', spec: AQUARIUM_SPEC },
  { id: 'rain', label: 'Rain', spec: RAIN_SPEC },
  { id: 'snowfall', label: 'Snowfall', spec: SNOWFALL_SPEC },
  { id: 'lanterns', label: 'Night Lanterns', spec: LANTERNS_SPEC },
  { id: 'sakura', label: 'Sakura Drift', spec: SAKURA_SPEC },
  { id: 'dev-dashboard', label: 'Control Center', spec: DASHBOARD_SPEC },
  { id: 'orrery', label: 'Orrery', spec: ORRERY_SPEC },
  { id: 'constellation', label: 'Constellation', spec: CONSTELLATION_SPEC },
  { id: 'comets', label: 'Comet Shower', spec: COMETS_SPEC },
  { id: 'aurora', label: 'Aurora', spec: AURORA_SPEC },
  { id: 'warp-tunnel', label: 'Warp Tunnel', spec: WARP_TUNNEL_SPEC },
  { id: 'polygons', label: 'Polygons', spec: POLYGONS_SPEC },
  { id: 'matrix-rain', label: 'Matrix Rain', spec: MATRIX_RAIN_SPEC },
  { id: 'procession', label: 'Night Procession', spec: PROCESSION_SPEC },
  { id: 'nostalghia-candle', label: "Nostalghia's Candle", spec: NOSTALGHIA_CANDLE_SPEC },
  { id: 'haiku', label: 'Haiku', spec: HAIKU_SPEC },
  { id: 'pings', label: 'Pings', spec: PINGS_SPEC },
  { id: 'facets', label: 'Facets', spec: FACETS_SPEC },
  { id: 'relay-board', label: 'Relay Board', spec: RELAY_BOARD_SPEC },
  { id: 'lobby-talk', label: 'Lobby Talk', spec: LOBBY_TALK_SPEC },
  { id: 'thermal-field', label: 'Thermal Field', spec: THERMAL_FIELD_SPEC },
  { id: 'sparse-night', label: 'Sparse Night', spec: SPARSE_NIGHT_SPEC },
  { id: 'typed-cue', label: 'Typed Cue', spec: TYPED_CUE_SPEC },
] as const;

/** All example specs in catalog order (tests, batch compile). */
export const EXAMPLE_SPECS: SaverSpec[] = SCHEMA_EXAMPLES.map((e) => e.spec);

/** Lookup by saver id. */
export const EXAMPLE_BY_ID: Readonly<Record<string, SaverSpec>> = Object.fromEntries(
  SCHEMA_EXAMPLES.map((e) => [e.id, e.spec]),
);
