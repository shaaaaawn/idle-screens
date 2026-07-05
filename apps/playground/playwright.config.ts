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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5177',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
