import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/mac/web/src/**/*.test.ts',
      'apps/playground/src/evals/**/*.test.ts',
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
        // Covered by playground e2e (element.spec.ts, worker.spec.ts).
        'packages/core/src/idle-screen.element.ts',
      ],
      thresholds: {
        // Existing floor for already-gated modules (ratchet — do not dilute).
        statements: 70,
        branches: 75,
        functions: 75,
        lines: 70,
        // schema: measured 2026-07-25 → 90.71 / 79.51 / 96.73 / 90.71; gate at −2.
        'packages/schema/src/**': {
          statements: 88,
          branches: 77,
          functions: 94,
          lines: 88,
        },
        // validator: measured 2026-07-25 → 100 / 84.21 / 100 / 100; gate at −2.
        'packages/validator/src/**': {
          statements: 98,
          branches: 82,
          functions: 98,
          lines: 98,
        },
        // capabilities: measured 2026-07-25 → 97.98 / 92 / 94.11 / 97.98; gate at −2.
        'packages/capabilities/src/**': {
          statements: 95,
          branches: 90,
          functions: 92,
          lines: 95,
        },
        // savers-classic (non-GPU): measured 2026-07-25 → 91.85 / 78.83 / 92.2 / 91.85; gate at −2.
        'packages/savers-classic/src/**': {
          statements: 89,
          branches: 76,
          functions: 90,
          lines: 89,
        },
        // saver-tide: measured 2026-07-25 → 95.75 / 81.37 / 88.23 / 95.75; gate at −2.
        'packages/saver-tide/src/**': {
          statements: 93,
          branches: 79,
          functions: 86,
          lines: 93,
        },
        // saver-limelight: measured 2026-07-25 → 96.36 / 72.51 / 92.68 / 96.36; gate at −2.
        'packages/saver-limelight/src/**': {
          statements: 94,
          branches: 70,
          functions: 90,
          lines: 94,
        },
      },
    },
  },
});
