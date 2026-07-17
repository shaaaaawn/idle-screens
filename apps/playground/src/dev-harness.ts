import type { SaverPlugin } from '@idle-screens/core';
import {
  computeTier,
  costBudget,
  detectCapabilities,
  eligibleSavers,
  type Capabilities,
  type SaverInfo,
} from '@idle-screens/capabilities';
import { compileSaver, SCHEMA_EXAMPLES, validateSpec } from '@idle-screens/schema';
import { sampleSaver } from './validate';

const pretty = (spec: (typeof SCHEMA_EXAMPLES)[number]['spec']): string => JSON.stringify(spec, null, 2);

const toInfo = (s: SaverPlugin): SaverInfo => ({
  id: s.manifest.id,
  minBackend: s.manifest.minBackend,
  costTier: s.manifest.costTier,
  motionIntensity: s.manifest.motionIntensity,
  reducedMotionFallback: s.manifest.reducedMotionFallback,
});

/** E2e / debug API — no UI. */
export async function wireCapabilitiesHarness(savers: SaverPlugin[]): Promise<void> {
  const infos = savers.map(toInfo);
  const real = await detectCapabilities();
  (window as unknown as { __caps?: unknown }).__caps = {
    detect: () => detectCapabilities(),
    tier: (c: Capabilities) => computeTier(c),
    budget: (c: Capabilities) => costBudget(computeTier(c)),
    evaluate: (c: Capabilities) => eligibleSavers(infos, c),
    real: () => real,
  };
}

/** E2e / debug API — no UI. */
export function wireSchemaHarness(): void {
  (window as unknown as { __schema?: unknown }).__schema = {
    validate: (json: string) => validateSpec(JSON.parse(json)),
    sample: (json: string) => sampleSaver(compileSaver(JSON.parse(json)), { seconds: 1.5 }),
    examples: Object.fromEntries(
      SCHEMA_EXAMPLES.map((e) => [e.id === 'dev-dashboard' ? 'dashboard' : e.id, pretty(e.spec)]),
    ),
  };
}
