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
 * What this tab sent about the wall, read off the socket: `on` and `off`, in order. Letting go
 * changes nothing on screen that a crash could not also change (a death refills the bar too), so
 * the wire is where the release is seen; the refill itself is held in the room's workerd test.
 */
function wallsSent(page: Page): string[] {
  const sent: string[] = [];
  page.on('websocket', (socket) => {
    // Vite's own hot-reload socket is not ours.
    if (!socket.url().includes('/parties/')) return;
    socket.on('framesent', ({ payload }) => {
      const input = (JSON.parse(String(payload)) as { input?: { type: string; on?: boolean } })
        .input;
      if (input?.type === 'wall') sent.push(input.on === true ? 'on' : 'off');
    });
  });
  return sent;
}

/**
 * One rider, three bots, walls on a key, in a live round. Resolves once the bar shows full energy,
 * with that figure.
 *
 * One page on purpose, as in cycles.spec.ts. The round is ten seconds because playwright.config.ts
 * starts the server with ROUND_MS. Nothing here waits on the bike surviving: the first lit tick
 * lowers the bar at once, and everything after that is read off the wire.
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

/** Waits for the bar to fall below `from`: the first lit tick has reached the screen. */
async function barFallsFrom(page: Page, from: number): Promise<void> {
  await expect
    .poll(async () => {
      const now = await energyOf(page);
      return now !== null && now < from;
    })
    .toBe(true);
}

async function endOfRound(page: Page) {
  const results = page.getByTestId('results');
  await expect(results).toBeVisible();
  await expect(results.locator('tbody tr')).toHaveCount(RIDERS.length);
}

test('holding W lays a wall and spends energy; letting go says so', async ({ page }) => {
  const sent = wallsSent(page);
  const full = await startWallsOnAKey(page);

  await page.keyboard.down('KeyW');
  await barFallsFrom(page, full);
  await page.keyboard.up('KeyW');
  await expect.poll(() => sent).toEqual(['on', 'off']);

  await endOfRound(page);
});

test('holding the Wall button lays a wall and spends energy; letting go says so', async ({
  page,
}) => {
  const sent = wallsSent(page);
  const full = await startWallsOnAKey(page);

  const wall = page.getByTestId('wall');
  await wall.hover();
  await page.mouse.down();
  await barFallsFrom(page, full);
  await page.mouse.up();
  await expect.poll(() => sent).toEqual(['on', 'off']);

  await endOfRound(page);
});
