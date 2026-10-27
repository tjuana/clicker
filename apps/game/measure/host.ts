import { expect, type Page } from '@playwright/test';

/** Host a room in `mode`, seat `bots` bots one at a time, start, and wait for the HUD. */
export async function host(page: Page, mode: 'race' | 'cycles', bots: number): Promise<void> {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.getByTestId('name-input').fill('Anna');
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId(`mode-${mode}`).click();
  await expect(page.getByTestId(`mode-${mode}`)).toHaveAttribute('aria-pressed', 'true');
  const badges = page.getByTestId('bot-badge');
  for (let seated = 1; seated <= bots; seated += 1) {
    await page.getByTestId('add-bot').click();
    await expect(badges).toHaveCount(seated);
  }
  await page.getByTestId('start').click();
  await expect(page.getByTestId('hud')).toBeVisible();
}
