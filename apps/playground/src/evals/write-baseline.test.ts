/**
 * Side-effect test: writes runs/<runId>/ + runs/latest/ + runs/index.json.
 * Invoked via `pnpm --filter @idle-screens/playground eval:styles`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getCatalog } from './catalog';
import { toIndexEntry } from './provenance';
import { scoreSuite } from './score';
import type { RunIndexEntry, RunSummary } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('write style-eval baseline artifact', () => {
  it.skipIf(!process.env.WRITE_STYLE_EVAL_BASELINE)('scores the suite and writes runs/', () => {
    const catalog = getCatalog();
    const indexPath = join(__dirname, 'runs', 'index.json');
    let prior: RunSummary | null = null;
    try {
      const idx = JSON.parse(readFileSync(indexPath, 'utf8')) as { runs: RunIndexEntry[] };
      const latestId = idx.runs[0]?.runId;
      if (latestId) {
        prior = JSON.parse(
          readFileSync(join(__dirname, 'runs', latestId, 'summary.json'), 'utf8'),
        ) as RunSummary;
      }
    } catch {
      prior = null;
    }

    const runId = `run-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}-baseline`;
    const { results, summary } = scoreSuite(catalog.screens, catalog.artists, {
      runId,
      request: {
        label: prior ? 'baseline re-run' : 'baseline v0',
        note: prior
          ? `Headless re-score vs ${prior.runId}`
          : 'Initial StyleDNA catalog — 15 artists × 10 screens. Locked growth origin.',
        harness: 'headless-vitest',
        operator: 'eval:styles',
        parentRunId: prior?.runId,
      },
      parentSummary: prior,
    });
    const outDir = join(__dirname, 'runs', runId);
    mkdirSync(outDir, { recursive: true });

    writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(
      join(outDir, 'results.jsonl'),
      `${results.map((r) => JSON.stringify(r)).join('\n')}\n`,
    );

    const gaps = [
      `# Gaps — ${runId}`,
      '',
      `Label: **${summary.provenance.label}**`,
      `Suite median: **${summary.suiteMedian.toFixed(3)}**`,
      `Harness: \`${summary.provenance.harness}\` · StyleDNA \`${summary.provenance.versions.styleDnaHash}\``,
      `Screens: ${results.length} · Invalid: ${results.filter((r) => !r.valid).length}`,
      '',
      '## Suggested actions',
      ...summary.nextCycle.suggestedActions.map((a, i) => `${i + 1}. ${a}`),
      '',
      '## Next cycle inputs',
      '',
      `Weak artists: ${summary.nextCycle.weakArtists.join(', ') || '(none)'}`,
      '',
      `Collapsed benchmarks: ${summary.nextCycle.collapsedBenchmarks.join(', ') || '(none)'}`,
      '',
      '### Top schema gaps',
      ...summary.nextCycle.topGaps.map((g, i) => `${i + 1}. ${g}`),
      '',
      '### Per-artist medians',
      ...summary.perArtist.map((a) => `- ${a.artistId}: ${a.median.toFixed(3)}`),
      '',
      '### Failures',
      ...(summary.failures.length
        ? summary.failures.slice(0, 40).map((f) => `- \`${f.screenId}\`: ${f.reason}`)
        : ['- (none)']),
      '',
    ].join('\n');
    writeFileSync(join(outDir, 'gaps.md'), gaps);

    const latest = join(__dirname, 'runs', 'latest');
    mkdirSync(latest, { recursive: true });
    writeFileSync(join(latest, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(join(latest, 'gaps.md'), gaps);
    writeFileSync(
      join(latest, 'results.jsonl'),
      `${results.map((r) => JSON.stringify(r)).join('\n')}\n`,
    );

    // Prepend to index (newest first).
    let runs: RunIndexEntry[] = [];
    try {
      runs = (JSON.parse(readFileSync(indexPath, 'utf8')) as { runs: RunIndexEntry[] }).runs;
    } catch {
      runs = [];
    }
    const entry = toIndexEntry(summary, 'disk');
    runs = [entry, ...runs.filter((r) => r.runId !== entry.runId)];
    writeFileSync(indexPath, `${JSON.stringify({ runs }, null, 2)}\n`);

     
    console.log(`Wrote ${outDir} suiteMedian=${summary.suiteMedian.toFixed(3)} dna=${summary.provenance.versions.styleDnaHash}`);
    expect(results.every((r) => r.valid)).toBe(true);
    expect(summary.provenance).toBeDefined();
    expect(summary.nextCycle.suggestedActions.length).toBeGreaterThan(0);
    expect(summary.suiteMedian).toBeGreaterThan(0);
  });
});
