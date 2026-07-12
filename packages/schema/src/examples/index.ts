import type { SaverSpec } from '../types';
import { AQUARIUM_SPEC } from './aquarium';
import { DASHBOARD_SPEC } from './dev-dashboard';
import { LANTERNS_SPEC } from './lanterns';
import { RAIN_SPEC } from './rain';
import { SAKURA_SPEC } from './sakura';
import { SNOWFALL_SPEC } from './snowfall';

export { AQUARIUM_SPEC } from './aquarium';
export { RAIN_SPEC } from './rain';
export { SNOWFALL_SPEC } from './snowfall';
export { LANTERNS_SPEC } from './lanterns';
export { SAKURA_SPEC } from './sakura';
export { DASHBOARD_SPEC } from './dev-dashboard';

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
  { id: 'dev-dashboard', label: 'Dev Dashboard', spec: DASHBOARD_SPEC },
] as const;

/** All example specs in catalog order (tests, batch compile). */
export const EXAMPLE_SPECS: SaverSpec[] = SCHEMA_EXAMPLES.map((e) => e.spec);

/** Lookup by saver id. */
export const EXAMPLE_BY_ID: Readonly<Record<string, SaverSpec>> = Object.fromEntries(
  SCHEMA_EXAMPLES.map((e) => [e.id, e.spec]),
);
