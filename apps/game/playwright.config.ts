import { defineConfig, devices } from '@playwright/test';

/**
 * A round runs on real server timings — three seconds of countdown and ten of play — so the
 * timeouts here are generous on purpose. Nothing is waited on with a sleep: every assertion
 * waits for something the server actually said.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  // A hard cap on the whole run. The per-test timeout above has been observed not to fire,
  // and a suite that hangs for a quarter of an hour in CI is worse than one that fails.
  globalTimeout: 5 * 60_000,
  expect: { timeout: 25_000 },
  // One worker: a round already runs two browsers, and parallel rounds would fight over the
  // dev server for no gain.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // Kept as hygiene for a test that runs two players at once, not as a cure: background
    // timer throttling was measured and ruled out as the cause of the stalls below.
    launchOptions: {
      args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm exec vite dev --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
