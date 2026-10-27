import { defineConfig } from '@playwright/test';

/**
 * `pnpm --filter @clicker/app measure`: what a frame costs on the owner's machine. Never in CI:
 * headless Chromium draws with a software rasteriser that has no GPU timer and says nothing about
 * a real GPU. Headed and with vsync on — the timer queries measure the GPU's work, not the wait for
 * the display, and plan 13 ruled out uncapped runs on this machine. Rounds run at their real
 * length, so the race and the arena last long enough to sample.
 */
export default defineConfig({
  testDir: './measure',
  testMatch: '*.measure.ts',
  timeout: 120_000,
  globalTimeout: 10 * 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    browserName: 'chromium',
    headless: false,
    viewport: { width: 1280, height: 760 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-angle=metal'] },
  },
  webServer: {
    command: 'pnpm exec vite dev --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
