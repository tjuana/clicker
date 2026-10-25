import { expect, type Page, test } from '@playwright/test';

const RIDERS = ['Anna', 'Bot 1', 'Bot 2', 'Bot 3'];

/** The rider's energy as the bar shows it; null while the bar is not on screen. */
const energyOf = async (page: Page): Promise<number | null> => {
  // Read in the page: a locator would wait for a bar that is gone while the bike is dead.
  const raw = await page.evaluate(
    () => document.querySelector('[data-testid="energy"]')?.getAttribute('data-energy') ?? null,
  );
  return raw === null ? null : Number(raw);
};

/**
 * One rider, three bots, walls on a key, in a live round. Resolves once the bar shows full energy,
 * with that figure.
 *
 * One page on purpose, as in cycles.spec.ts. The round is ten seconds because playwright.config.ts
 * starts the server with ROUND_MS; a bike that is never turned meets the arena's edge a few
 * seconds in, so everything that follows has to fit in the first of them.
 */
async function startWallsOnAKey(page: Page): Promise<number> {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.getByTestId('name-input').fill('Anna');
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('start')).toBeVisible();

  await page.getByTestId('mode-cycles').click();
  await expect(page.getByTestId('mode-cycles')).toHaveAttribute('aria-pressed', 'true');
  // The walls row appears with the mode the server confirmed; the click that waits for it.
  await page.getByTestId('walls-button').click();
  await expect(page.getByTestId('walls-button')).toHaveAttribute('aria-pressed', 'true');

  const badges = page.getByTestId('bot-badge');
  for (let seated = 1; seated <= 3; seated += 1) {
    await page.getByTestId('add-bot').click();
    await expect(badges).toHaveCount(seated);
  }
  await page.getByTestId('start').click();

  // The controls are dead until the server says the round is live.
  await expect(page.getByTestId('turn-left')).toBeEnabled();
  const energy = page.getByTestId('energy');
  await expect(energy).toBeVisible();
  const full = Number(await energy.getAttribute('data-cap'));
  expect(full).toBeGreaterThan(0);
  // Nobody has pressed anything: a bike starts with a full bar.
  await expect(energy).toHaveAttribute('data-energy', String(full));
  return full;
}

/** Waits for the bar to leave `from` on the side `falls` says, and returns where it got to. */
async function barMovesFrom(page: Page, from: number, falls: boolean): Promise<number> {
  let reached = from;
  await expect
    .poll(async () => {
      const now = await energyOf(page);
      if (now !== null) reached = now;
      return now !== null && (falls ? now < from : now > from);
    })
    .toBe(true);
  return reached;
}

async function endOfRound(page: Page) {
  // The round was not lost to a crash on the way: a death gives a full bar back, which would
  // make "the bar rose" true for the wrong reason.
  await expect(page.getByTestId('hud-deaths')).toContainText('0');
  const results = page.getByTestId('results');
  await expect(results).toBeVisible();
  await expect(results.locator('tbody tr')).toHaveCount(RIDERS.length);
}

test('holding W lays a wall and spends energy; letting go refills it', async ({ page }) => {
  const full = await startWallsOnAKey(page);

  await page.keyboard.down('KeyW');
  const spent = await barMovesFrom(page, full, true);
  await page.keyboard.up('KeyW');
  // A tick or two may still arrive before the release does; the bar stops falling, then rises.
  const floor = (await energyOf(page)) ?? spent;
  await barMovesFrom(page, floor, false);

  await endOfRound(page);
});

test('holding the Wall button lays a wall and spends energy; letting go refills it', async ({
  page,
}) => {
  const full = await startWallsOnAKey(page);

  const wall = page.getByTestId('wall');
  await wall.hover();
  await page.mouse.down();
  const spent = await barMovesFrom(page, full, true);
  await page.mouse.up();
  const floor = (await energyOf(page)) ?? spent;
  await barMovesFrom(page, floor, false);

  await endOfRound(page);
});
