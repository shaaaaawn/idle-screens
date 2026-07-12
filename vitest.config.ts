import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/mac/web/src/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      // Gate unit-tested modules only. Saver canvases + <idle-screen> are covered by Playwright e2e.
      include: [
        'packages/core/src/**/*.ts',
        'packages/savers-classic/src/gpu-eligible.ts',
        'apps/mac/web/src/host-controller.ts',
      ],
      exclude: [
        '**/*.test.ts',
        'packages/core/src/index.ts',
        // Covered by playground e2e (element.spec.ts, worker.spec.ts).
        'packages/core/src/idle-screen.element.ts',
      ],
      thresholds: {
        statements: 70,
        branches: 75,
        functions: 75,
        lines: 70,
      },
    },
  },
});
