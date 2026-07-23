import type { SaverSpec } from '../types';
import { AQUARIUM_SPEC } from './aquarium';
import { AURORA_SPEC } from './aurora';
import { COMETS_SPEC } from './comets';
import { CONSTELLATION_SPEC } from './constellation';
import { DASHBOARD_SPEC } from './dev-dashboard';
import { LANTERNS_SPEC } from './lanterns';
import { MATRIX_RAIN_SPEC } from './matrix-rain';
import { POLYGONS_SPEC } from './polygons';
import { ORRERY_SPEC } from './orrery';
import { PROCESSION_SPEC } from './procession';
import { RAIN_SPEC } from './rain';
import { SAKURA_SPEC } from './sakura';
import { SNOWFALL_SPEC } from './snowfall';
import { WARP_TUNNEL_SPEC } from './warp-tunnel';

export { AQUARIUM_SPEC } from './aquarium';
export { COMETS_SPEC } from './comets';
export { CONSTELLATION_SPEC } from './constellation';
export { RAIN_SPEC } from './rain';
export { SNOWFALL_SPEC } from './snowfall';
export { LANTERNS_SPEC } from './lanterns';
export { SAKURA_SPEC } from './sakura';
export { DASHBOARD_SPEC } from './dev-dashboard';
export { ORRERY_SPEC } from './orrery';
export { AURORA_SPEC } from './aurora';
export { MATRIX_RAIN_SPEC } from './matrix-rain';
export { POLYGONS_SPEC } from './polygons';
export { PROCESSION_SPEC } from './procession';
export { WARP_TUNNEL_SPEC } from './warp-tunnel';

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
] as const;

/** All example specs in catalog order (tests, batch compile). */
export const EXAMPLE_SPECS: SaverSpec[] = SCHEMA_EXAMPLES.map((e) => e.spec);

/** Lookup by saver id. */
export const EXAMPLE_BY_ID: Readonly<Record<string, SaverSpec>> = Object.fromEntries(
  SCHEMA_EXAMPLES.map((e) => [e.id, e.spec]),
);
