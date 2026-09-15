import { type Browser, expect, type Page, test } from '@playwright/test';

/**
 * A page in its own browser context. Never a second tab: tabs share localStorage, so the
 * second player would inherit the first one's saved name and playerId and join as the very
 * same player.
 */
async function openPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/** The name screen only exists once there is a room to join. */
async function enterName(page: Page, name: string): Promise<void> {
  await page.getByTestId('name-input').fill(name);
  await page.getByTestId('enter').click();
}

test('two players race a round and agree on the winner', async ({ browser }) => {
  const host = await openPlayer(browser);
  await host.goto('/');
  await host.getByTestId('create-room').click();
  await enterName(host, 'Anna');
  await expect(host.getByTestId('start')).toBeVisible();

  const guest = await openPlayer(browser);
  await guest.goto(host.url());
  await enterName(guest, 'Boris');

  // Each sees the other before anything starts.
  await expect(host.getByTestId('players')).toContainText('Boris');
  await expect(guest.getByTestId('players')).toContainText('Anna');

  await host.getByTestId('start').click();

  // The track shows anonymous shapes, so the standings are the only place a player can see
  // who else is racing and how they are doing.
  await expect(host.getByTestId('standings')).toContainText('Boris');
  await expect(guest.getByTestId('standings')).toContainText('Anna');

  // The button stays disabled until the server reports the round live. Clicking it before
  // that does nothing at all — silently — and the round would end goalless.
  const click = guest.getByTestId('click');
  await expect(click).toBeEnabled();
  for (let index = 0; index < 5; index += 1) await click.click();

  // The end of the round comes from the server, so it is waited for, never slept through.
  await expect(host.getByTestId('results')).toBeVisible();
  await expect(guest.getByTestId('results')).toBeVisible();

  // The whole point of the game: both screens name the same winner.
  await expect(host.getByTestId('winner')).toContainText('Boris');
  await expect(guest.getByTestId('winner')).toContainText('Boris');
  await expect(host.getByTestId('results')).toContainText('Anna');

  await host.context().close();
  await guest.context().close();
});

test('a player can leave the room and come back to the start', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.getByTestId('name-input').fill('Anna');
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('players')).toBeVisible();

  await page.getByTestId('leave').click();

  await expect(page.getByTestId('create-room')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
});
