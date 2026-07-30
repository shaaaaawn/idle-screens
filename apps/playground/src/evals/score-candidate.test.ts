/**
 * Side-effect test: score ONE externally-authored candidate spec against a
 * catalog screen. This is the headless half of the agent loop — used by mono
 * eval sets where the "model" under test is an agent CLI authoring files on
 * disk rather than an OpenRouter chat transport (see
 * `collect-agent-set.test.ts` for the aggregation half).
 *
 * Gated on IDLE_SCORE_REQ — skips in CI. Request JSON:
 *
 *   { "screenId": "monet--benchmark--calm-horizon",
 *     "specPath": "/abs/path/v1.json",
 *     "outPath":  "/abs/path/v1.score.json" }
 *
 * Run: IDLE_SCORE_REQ=/abs/req.json pnpm exec vitest run src/evals/score-candidate.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adviseSpec, validateSpec, type SaverSpec } from '@idle-screens/schema';
import { getCatalog } from './catalog';
import { explainIntentFit, explainStyleFit, scoreScreen } from './score';

interface ScoreRequest {
  screenId: string;
  specPath: string;
  outPath: string;
}

const VIEWPORT = { width: 1920, height: 1080 };

describe('score external candidate', () => {
  it.skipIf(!process.env.IDLE_SCORE_REQ)('scores the requested spec against its screen', () => {
    const req = JSON.parse(readFileSync(process.env.IDLE_SCORE_REQ!, 'utf8')) as ScoreRequest;
    const catalog = getCatalog();
    const screen = catalog.screens.find((s) => s.id === req.screenId);
    expect(screen, `unknown screen id: ${req.screenId}`).toBeTruthy();
    const profile = catalog.artists.find((a) => a.id === screen!.artistId);
    expect(profile, `unknown artist for ${req.screenId}`).toBeTruthy();

    const spec = JSON.parse(readFileSync(req.specPath, 'utf8')) as SaverSpec;
    const validation = validateSpec(spec);
    const out: Record<string, unknown> = { ok: true, screenId: req.screenId };
    if (!validation.valid) {
      out.valid = false;
      out.validationErrors = validation.errors.map((e) => `${e.path}: ${e.message}`);
    } else {
      const scoredScreen = { ...screen!, spec };
      const scored = scoreScreen(scoredScreen, profile!);
      out.valid = true;
      out.score = scored;
      out.styleTerms = explainStyleFit(spec, profile!);
      out.intentTerms = explainIntentFit(scoredScreen, spec, scored.perception);
      out.advisories = adviseSpec(spec, VIEWPORT).map((a) => `${a.code}: ${a.message}`);
    }
    writeFileSync(req.outPath, JSON.stringify(out, null, 2));
  });
});
