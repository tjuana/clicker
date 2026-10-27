import { test } from '@playwright/test';
import { host } from './host';

/**
 * `LABEL=before pnpm --filter @clicker/app run shots`: the arena at the same moments every time,
 * saved as `shots/<label>-<moment>.png`, so a change to the picture sits beside what it replaced.
 * On the real GPU like `measure`, and at the device scale of the owner's screen: this is about how
 * it looks to him.
 */
test.use({ deviceScaleFactor: 2 });

const LABEL = process.env.LABEL ?? 'now';

test('the arena, at the same moments', async ({ page }) => {
  await host(page, 'cycles', 3);
  // The moments are times on purpose: what is compared is the picture, not a state to wait for.
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `shots/${LABEL}-chase.png` });
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `shots/${LABEL}-turn.png` });
});
