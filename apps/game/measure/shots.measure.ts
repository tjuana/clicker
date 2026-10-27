import { expect, test } from '@playwright/test';
import { host } from './host';

/**
 * `LABEL=before pnpm --filter @clicker/app run shots`: the arena at the same moments every time,
 * saved as `shots/<label>-<moment>.png`, so a change to the picture sits beside what it replaced.
 * On the real GPU like `measure`, and at the device scale of the owner's screen: this is about how
 * it looks to him.
 *
 * The moments are the same, the arena is not: the room seeds each round from the clock, so spawns
 * and the bots' turns differ from run to run. Compare the own bike and the floor around it.
 */
test.use({ deviceScaleFactor: 2 });

const LABEL = process.env.LABEL ?? 'now';

test('the arena, at the same moments', async ({ page }) => {
  await host(page, 'cycles', 3);
  // The HUD is up through the countdown, so it says nothing about the start. Waited out three
  // seconds from the HUD, the first picture landed on the boundary: no trail yet, overlay or not.
  const countdown = page.getByTestId('countdown');
  await expect(countdown).toBeVisible();
  await expect(countdown).toBeHidden();
  // From here the moments are times on purpose: what is compared is the picture, not a state.
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `shots/${LABEL}-chase.png` });
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `shots/${LABEL}-turn.png` });
});
