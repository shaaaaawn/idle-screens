import { defineConfig, devices } from '@playwright/test';

// E2E gets its OWN port, deliberately not the 5177 that `pnpm dev` uses.
//
// `reuseExistingServer` will happily adopt whatever is already listening, and
// on a shared machine that is somebody's long-lived dev session from a
// DIFFERENT checkout. A run then tests their working tree while reporting on
// yours: a reviewer and I both spent an afternoon on an "MQ7 fails on base"
// that was this, and it passes 3/3 against its own server.
//
// Overridable so parallel checkouts (worktrees, agents) can run e2e at once.
const PORT = Number(process.env.PLAYGROUND_PORT) || 5188;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  // 1 retry absorbs the Vite cold-start "504 Outdated Optimize Dep" race: the first
  // attempt warms the optimize cache, the retry runs against a warm server.
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      // Hermetic Playwright Chromium (CI caches ~/.cache/ms-playwright).
      // To skip the browser download entirely and use the Google Chrome that
      // ships on ubuntu-latest runners, set PLAYWRIGHT_CHROME_CHANNEL=chrome
      // and drop `playwright install` (keep install-deps if needed). Tradeoff:
      // less hermetic — Chrome version tracks the runner image, not PW.
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PLAYWRIGHT_CHROME_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHROME_CHANNEL as 'chrome' | 'chromium' | 'msedge' }
          : {}),
      },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: `http://localhost:${PORT}`,
    // Pass the port through, or `pnpm dev` binds 5177 and the run waits on a
    // URL nothing is serving.
    env: { PLAYGROUND_PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
