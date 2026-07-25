/**
 * Side-effect test: writes runs/<runId>/ + runs/latest/ when executed.
 * Invoked via `pnpm --filter @idle-screens/playground eval:styles`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getCatalog } from './catalog';
import { scoreSuite } from './score';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('write style-eval baseline artifact', () => {
  it.skipIf(!process.env.WRITE_STYLE_EVAL_BASELINE)('scores the suite and writes runs/', () => {
    const catalog = getCatalog();
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}-baseline-v0`;
    const { results, summary } = scoreSuite(catalog.screens, catalog.artists, runId);
    const outDir = join(__dirname, 'runs', runId);
    mkdirSync(outDir, { recursive: true });

    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(
      join(outDir, 'results.jsonl'),
      `${results.map((r) => JSON.stringify(r)).join('\n')}\n`,
    );

    const gaps = [
      `# Gaps — ${runId}`,
      '',
      `Suite median: **${summary.suiteMedian.toFixed(3)}**`,
      `Screens: ${results.length} · Invalid: ${results.filter((r) => !r.valid).length}`,
      '',
      '## Next cycle inputs',
      '',
      `Weak artists: ${summary.nextCycle.weakArtists.join(', ') || '(none)'}`,
      '',
      `Collapsed benchmarks (low cross-artist variance): ${summary.nextCycle.collapsedBenchmarks.join(', ') || '(none)'}`,
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
    writeFileSync(join(latest, 'summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(join(latest, 'gaps.md'), gaps);
    writeFileSync(
      join(latest, 'results.jsonl'),
      `${results.map((r) => JSON.stringify(r)).join('\n')}\n`,
    );

    // eslint-disable-next-line no-console
    console.log(`Wrote ${outDir} suiteMedian=${summary.suiteMedian.toFixed(3)}`);
    expect(results.every((r) => r.valid)).toBe(true);
    expect(summary.suiteMedian).toBeGreaterThan(0);
  });
});
