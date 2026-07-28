import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/mac/web/src/**/*.test.ts',
      'apps/playground/src/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      // Gate unit-tested modules only. Saver canvases + <idle-screen> are covered by Playwright e2e.
      include: [
        'packages/core/src/**/*.ts',
        'packages/savers-classic/src/**/*.ts',
        'apps/mac/web/src/host-controller.ts',
        'packages/schema/src/**/*.ts',
        'packages/validator/src/**/*.ts',
        'packages/capabilities/src/**/*.ts',
        'packages/saver-tide/src/**/*.ts',
        'packages/saver-limelight/src/**/*.ts',
        'packages/saver-slipstream/src/**/*.ts',
        'packages/saver-catwalk/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        'packages/core/src/index.ts',
        'packages/schema/src/index.ts',
        'packages/validator/src/index.ts',
        'packages/capabilities/src/index.ts',
        'packages/savers-classic/src/index.ts',
        'packages/savers-classic/src/idle-worker.ts',
        'packages/savers-classic/src/*-assets.ts',
        'packages/savers-classic/src/*-shared.ts',
        // WebGPU backends — unit-hostile; covered by e2e / device-tier paths.
        'packages/savers-classic/src/*-gpu.ts',
        'packages/saver-tide/src/index.ts',
        'packages/saver-limelight/src/index.ts',
        'packages/saver-slipstream/src/index.ts',
        'packages/saver-catwalk/src/index.ts',
        // Covered by playground e2e (element.spec.ts, worker.spec.ts).
        'packages/core/src/idle-screen.element.ts',
      ],
      // ── Re-baselined 2026-07-26 for vitest 4 ──────────────────────────────
      // vitest 4 dropped `v8-to-istanbul` in favour of `ast-v8-to-istanbul`,
      // and the escape hatches are gone: `experimentalAstAwareRemapping` and
      // `ignoreEmptyLines` no longer exist in CoverageOptions, so the vitest 3
      // accounting is NOT recoverable by configuration. The same 61 files are
      // measured before and after (`include`/`exclude` semantics unchanged) —
      // only the node counting differs, and it is strictly more accurate:
      //   • data literals collapse: schema/examples/dev-dashboard.ts went from
      //     325 "statements" (all trivially covered, inflating every ratio) to 1;
      //   • real branches surface: schema/compile.ts went from 90 branch nodes
      //     to 254 (default params, `??`, `?.`, nested ternaries);
      //   • same-line guard consequents are no longer credited by their `if`
      //     test — validator/flash.ts:99 (`if (e < s) e = s`) and
      //     validator/perf.ts:36 (`if (sorted.length === 0) return 0`) read as
      //     covered under vitest 3 and are correctly uncovered under vitest 4.
      // Every floor below is therefore the SAME `measured − 2` ratchet against
      // the SAME test suite — re-measured, not diluted. A floor only ever moves
      // UP: where the new counter reads higher than the old floor + 2, the floor
      // is raised; where it reads lower, the floor is NOT dropped below a value
      // that still passes.
      // The table below is both sides measured at b3f8009 (same commit, same
      // 531 tests) so it isolates the counter change; savers-classic was then
      // re-derived on top of workshop batch 1 (2e0b591), which added tests.
      // vitest 3 → vitest 4 measured, per package (stmt/branch/func/line):
      //   core          91.34/86.03/87.50/91.34 → 85.04/76.78/85.54/87.11
      //   schema        91.02/79.57/94.68/91.02 → 82.24/76.29/90.44/85.20
      //   validator    100.00/84.21/100.0/100.0 → 98.25/85.71/100.0/100.0
      //   capabilities  97.99/92.00/94.12/97.99 → 95.18/89.61/89.47/98.61
      //   savers-classic 91.84/77.80/91.18/91.84 → 84.97/61.48/83.40/89.26
      //   saver-tide    97.46/82.24/94.29/97.46 → 92.96/70.96/89.47/97.27
      //   saver-limelight 94.36/73.19/90.70/94.36 → 90.59/62.89/86.95/95.12
      //   saver-slipstream 96.67/80.85/92.86/96.67 → 92.05/70.29/87.88/96.55
      //   saver-catwalk 91.10/86.87/88.89/91.10 → 88.22/83.84/80.43/90.68
      //   GLOBAL        92.32/81.00/91.42/92.32 → 86.29/74.76/86.41/89.82
      thresholds: {
        // Coarse legacy floor for already-gated modules (ratchet — do not dilute).
        // statements/functions/lines still clear their pre-vitest-4 values and are
        // left untouched; only branches is breached by the new branch detector, so
        // it alone is re-baselined at measured (74.76) − 2. Ratcheting the other
        // three up to measured − 2 is a separate, deliberate change.
        statements: 70,
        branches: 72,
        functions: 75,
        lines: 70,
        // schema: measured 2026-07-26 → 82.24 / 76.29 / 90.44 / 85.2; gate at −2.
        'packages/schema/src/**': {
          statements: 80,
          branches: 74,
          functions: 88,
          lines: 83,
        },
        // validator: measured 2026-07-26 → 99.1 / 86.76 / 100 / 100; gate at −2.
        // Statements is not 100: flash.ts's `if (e < s)` window guard is unreachable
        // for contract-conforming input and is deliberately left uncovered.
        'packages/validator/src/**': {
          statements: 97,
          branches: 84,
          functions: 98,
          lines: 98,
        },
        // capabilities: measured 2026-07-26 → 97.59 / 89.61 / 100 / 100; gate at −2.
        'packages/capabilities/src/**': {
          statements: 95,
          branches: 87,
          functions: 98,
          lines: 98,
        },
        // savers-classic (non-GPU): re-measured after workshop batch 1 (2e0b591)
        // → 86.27 / 64.65 / 82.59 / 90.23; gate at −2. Functions stays at 81
        // (measured −1.59): it already passes, and a ratchet only moves up.
        'packages/savers-classic/src/**': {
          statements: 84,
          branches: 62,
          functions: 81,
          lines: 88,
        },
        // saver-tide: measured 2026-07-26 → 92.96 / 70.96 / 89.47 / 97.27; gate at −2.
        'packages/saver-tide/src/**': {
          statements: 90,
          branches: 68,
          functions: 87,
          lines: 95,
        },
        // saver-limelight: measured 2026-07-26 → 90.59 / 62.89 / 86.95 / 95.12; gate at −2.
        'packages/saver-limelight/src/**': {
          statements: 88,
          branches: 60,
          functions: 84,
          lines: 93,
        },
        // saver-slipstream: measured 2026-07-26 → 92.05 / 70.29 / 87.88 / 96.55; gate at −2.
        'packages/saver-slipstream/src/**': {
          statements: 90,
          branches: 68,
          functions: 85,
          lines: 94,
        },
        // saver-catwalk: measured 2026-07-26 → 88.22 / 83.84 / 80.43 / 90.68; gate at −2.
        'packages/saver-catwalk/src/**': {
          statements: 86,
          branches: 81,
          functions: 78,
          lines: 88,
        },
      },
    },
  },
});
