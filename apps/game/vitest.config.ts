import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // In tests the round takes a fraction of a second, not thirteen.
      miniflare: {
        bindings: { COUNTDOWN_MS: '50', ROUND_MS: '200' },
      },
    }),
  ],
  // End-to-end tests live in e2e/ and run under Playwright: they can't run inside workerd.
  test: { include: ['test/**/*.test.ts'] },
});
