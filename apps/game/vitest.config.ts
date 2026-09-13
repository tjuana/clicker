import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Раунд в тестах идёт доли секунды, а не тринадцать.
      miniflare: {
        bindings: { COUNTDOWN_MS: '50', ROUND_MS: '200' },
      },
    }),
  ],
  // Сквозные тесты лежат в e2e/ и запускаются Playwright: внутрь workerd им нельзя.
  test: { include: ['test/**/*.test.ts'] },
});
