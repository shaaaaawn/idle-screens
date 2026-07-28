import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  // 1 retry absorbs the Vite cold-start "504 Outdated Optimize Dep" race: the first
  // attempt warms the optimize cache, the retry runs against a warm server.
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5177',
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
    url: 'http://localhost:5177',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
