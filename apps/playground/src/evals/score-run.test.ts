/**
 * Score a run directory of AGENT-AUTHORED specs — the entry point a model
 * under test uses to grade its own work, with no second LLM transport.
 *
 *   EVAL_RUN_DIR=/abs/path/datasets/evals/<suite>/<runId> \
 *     pnpm --filter @idle-screens/playground eval:score-run
 *
 * Two modes, chosen by env:
 *
 *   EVAL_FIXTURES=1   write <run>/fixtures.json — every screen the suite
 *                     wants (id, artist, kind, title, intent) plus the full
 *                     StyleDNA profiles — and an empty <run>/specs/. The
 *                     agent then authors one <run>/specs/<screen.id>.json
 *                     per fixture from that file.
 *
 *   (default)         read <run>/specs/*.json, validate + score each against
 *                     its artist's profile with the house scorer, and write
 *                     summary.json, results.jsonl and gaps.md into <run>.
 *                     Re-runnable at any point: a partial spec set scores as
 *                     a partial run (fixturesRun < fixturesTotal), never as
 *                     a full run of zeros.
 *
 * Optional env: EVAL_SUITE (style-authoring-v1, the default, or
 * style-authoring-holdout-v1 — which needs IDLE_EVAL_HOLDOUT_DIR), EVAL_LABEL,
 * EVAL_NOTE, EVAL_OPERATOR, EVAL_MODEL (the resolved model id), EVAL_AXES
 * (JSON, the fixture scope that was asked for), EVAL_TRIALS.
 *
 * WHY this is a vitest file and not a script: the scorer (score.ts) and the
 * catalog are playground TypeScript that resolve @idle-screens/* through
 * vite, and vitest is the runtime where they load — the same reason
 * write-baseline.test.ts is shaped this way. Before this existed, every agent
 * asked to run a trial had to reinvent this file inside the repo; one wrote a
 * template generator instead of authoring, scored 75 null specs as failures,
 * and reported success. Nothing here writes inside the repository — the run
 * directory is wherever the caller points it (datasets/evals/ in the mono).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SaverSpec } from '@idle-screens/schema';
import { getCatalog } from './catalog';
import { getHoldoutCatalog } from './holdout';
import { scoreSuite } from './score';
import type { ArtistStyleProfile, EvalScreen } from './types';

const RUN_DIR = process.env.EVAL_RUN_DIR ? resolve(process.env.EVAL_RUN_DIR) : '';
const SUITE = process.env.EVAL_SUITE || 'style-authoring-v1';

function suiteCatalog(): { profiles: ArtistStyleProfile[]; screens: EvalScreen[] } {
  if (SUITE === 'style-authoring-holdout-v1') {
    const h = getHoldoutCatalog();
    if (!h) {
      throw new Error(
        'holdout suite requested but no fixtures are configured — set IDLE_EVAL_HOLDOUT_DIR (mono: make evals-holdout)',
      );
    }
    return h;
  }
  if (SUITE !== 'style-authoring-v1') throw new Error(`unknown EVAL_SUITE: ${SUITE}`);
  const c = getCatalog();
  return { profiles: c.artists, screens: c.screens };
}

describe('score-run: grade a directory of agent-authored specs', () => {
  it.skipIf(!RUN_DIR)('writes fixtures.json, or scores specs/, in EVAL_RUN_DIR', () => {
    mkdirSync(RUN_DIR, { recursive: true });
    const { profiles, screens } = suiteCatalog();
    const runId = basename(RUN_DIR);

    if (process.env.EVAL_FIXTURES) {
      const fixtures = {
        evalId: SUITE,
        runId,
        fixturesTotal: screens.length,
        howTo: 'author one SaverSpec per screen and save it as specs/<screen.id>.json; then run eval:score-run again without EVAL_FIXTURES',
        profiles,
        screens: screens.map((s) => ({
          id: s.id, artistId: s.artistId, kind: s.kind, screenId: s.screenId, title: s.title, intent: s.intent,
        })),
      };
      writeFileSync(join(RUN_DIR, 'fixtures.json'), `${JSON.stringify(fixtures, null, 2)}\n`);
      mkdirSync(join(RUN_DIR, 'specs'), { recursive: true });
      console.log(`[score-run] ${screens.length} fixtures → ${join(RUN_DIR, 'fixtures.json')}`);
      return;
    }

    const specsDir = join(RUN_DIR, 'specs');
    const files = existsSync(specsDir) ? readdirSync(specsDir).filter((f) => f.endsWith('.json')).sort() : [];
    const byId = new Map(screens.map((s) => [s.id, s]));
    const authored: EvalScreen[] = [];
    const unknown: string[] = [];
    const unreadable: Array<{ file: string; error: string }> = [];
    for (const f of files) {
      const screen = byId.get(f.slice(0, -'.json'.length));
      if (!screen) { unknown.push(f); continue; }
      try {
        authored.push({ ...screen, spec: JSON.parse(readFileSync(join(specsDir, f), 'utf8')) as SaverSpec });
      } catch (e) {
        unreadable.push({ file: f, error: (e as Error).message });
      }
    }
    if (!authored.length) {
      throw new Error(
        `no authored specs in ${specsDir} — write specs/<screen.id>.json for the fixtures in fixtures.json first` +
        `${unknown.length ? ` (${unknown.length} file(s) did not match any fixture id: ${unknown.slice(0, 5).join(', ')})` : ''}`,
      );
    }

    // scoreSuite reports a median per profile it is handed, so a partial run
    // is scored over the artists it actually touched — not fifteen artists
    // of which twelve are zero because nobody authored them.
    const touched = new Set(authored.map((s) => s.artistId));
    const scoredProfiles = profiles.filter((p) => touched.has(p.id));
    const { results, summary } = scoreSuite(authored, scoredProfiles, {
      runId,
      request: {
        label: process.env.EVAL_LABEL || `${SUITE} · agent-authored trial`,
        note: process.env.EVAL_NOTE || '',
        harness: 'agent-authored',
        ...(process.env.EVAL_OPERATOR ? { operator: process.env.EVAL_OPERATOR } : {}),
        ...(process.env.EVAL_MODEL ? { modelName: process.env.EVAL_MODEL } : {}),
      },
    });
    let axes: unknown = {};
    try {
      axes = JSON.parse(process.env.EVAL_AXES || '{}');
    } catch {
      axes = { raw: process.env.EVAL_AXES };
    }
    const out = {
      ...summary,
      evalId: SUITE,
      axes,
      trials: Number(process.env.EVAL_TRIALS) || 1,
      fixturesRun: authored.length,
      fixturesTotal: screens.length,
      partial: authored.length < screens.length,
      ...(process.env.EVAL_MODEL ? { model: process.env.EVAL_MODEL } : {}),
      specsUnknown: unknown,
      specsUnreadable: unreadable,
    };
    writeFileSync(join(RUN_DIR, 'summary.json'), `${JSON.stringify(out, null, 2)}\n`);
    writeFileSync(join(RUN_DIR, 'results.jsonl'), `${results.map((r) => JSON.stringify(r)).join('\n')}\n`);

    const invalid = results.filter((r) => !r.valid);
    const gaps = [
      `# Gaps — ${runId}`,
      '',
      `Label: **${summary.provenance.label}**`,
      `Suite median: **${summary.suiteMedian.toFixed(3)}** over ${results.length} authored screen${results.length === 1 ? '' : 's'}`,
      `Fixtures: ${authored.length} / ${screens.length}${authored.length < screens.length ? ' (partial)' : ''} · Invalid: ${invalid.length}`,
      `Harness: \`agent-authored\` · StyleDNA \`${summary.provenance.versions.styleDnaHash}\``,
      '',
      ...(invalid.length
        ? ['## Invalid specs (fix these, then re-score)', '',
           ...invalid.slice(0, 40).map((r) => `- \`${r.screenId}\`: ${r.validationErrors.join('; ') || 'validation failed'}`), '']
        : []),
      ...(unknown.length ? ['## Files that matched no fixture', '', ...unknown.map((f) => `- ${f}`), ''] : []),
      ...(unreadable.length ? ['## Unreadable spec files', '', ...unreadable.map((u) => `- ${u.file}: ${u.error}`), ''] : []),
      '## Per-artist medians',
      '',
      ...summary.perArtist.map((a) => `- ${a.artistId}: ${a.median.toFixed(3)} (n=${a.n})`),
      '',
      '## Next cycle',
      '',
      ...summary.nextCycle.suggestedActions.map((a, i) => `${i + 1}. ${a}`),
      '',
      '## Top schema gaps',
      '',
      ...summary.nextCycle.topGaps.map((g, i) => `${i + 1}. ${g}`),
    ];
    writeFileSync(join(RUN_DIR, 'gaps.md'), `${gaps.join('\n')}\n`);
    console.log(
      `[score-run] ${runId}: ${authored.length}/${screens.length} fixtures authored, ` +
      `${results.length - invalid.length} valid, suite median ${summary.suiteMedian.toFixed(3)} → ${RUN_DIR}`,
    );
    expect(existsSync(join(RUN_DIR, 'summary.json'))).toBe(true);
  });
});
