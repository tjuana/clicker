import { defineConfig } from '@playwright/test';

/**
 * `pnpm --filter @clicker/app measure`: what a frame costs on the owner's machine. Never in CI:
 * headless Chromium draws with a software rasteriser that has no GPU timer and says nothing about
 * a real GPU. Headed and with vsync on — the timer queries measure the GPU's work, not the wait for
 * the display, and plan 13 ruled out uncapped runs on this machine. Rounds run at their real
 * length, so the race and the arena last long enough to sample. It measures `vite dev`: React's
 * StrictMode and unminified code, so its CPU figures are an upper bound for the built game.
 *
 * Two projects, one per pixel density: the owner's screen is dpr 2 (the canvases use `dpr={[1, 2]}`)
 * and costs about 2.5x the fragment work, and in plan 16 each finding showed at one density only —
 * the arena's OutputPass at dpr 1, the floor's interrupted multisampled pass at dpr 2.
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
    launchOptions: { args: ['--use-angle=metal'] },
  },
  projects: [
    { name: 'dpr1', use: { deviceScaleFactor: 1 } },
    { name: 'dpr2', use: { deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'pnpm exec vite dev --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
