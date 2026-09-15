import { defineConfig, devices } from '@playwright/test';

/**
 * A round runs on real server timings — three seconds of countdown and ten of play — so the
 * timeouts here are generous on purpose. Nothing is waited on with a sleep: every assertion
 * waits for something the server actually said.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 25_000 },
  // One worker: two players in one round already use two browser contexts, and parallel
  // rounds would fight over the dev server for no gain.
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
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
