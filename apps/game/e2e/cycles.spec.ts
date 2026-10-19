import { expect, test } from '@playwright/test';

/** The host plus the three bots the lobby seats, named by the rules in the order they join. */
const RIDERS = ['Anna', 'Bot 1', 'Bot 2', 'Bot 3'];

/**
 * One person rides a whole light-cycle round against three bots, from the lobby to the results.
 *
 * One page on purpose: a second page in the same browser stalls the driver (see round.spec.ts),
 * and bots make a second person unnecessary. The round is ten seconds, not the three minutes the
 * rules give the mode, because playwright.config.ts starts the server with ROUND_MS.
 *
 * Ten seconds is short for a driver that has to click through a software-rendered 3D scene, where
 * one action costs a few hundred milliseconds. So the round is spent on the inputs alone, and
 * everything that holds in either phase is checked during the countdown, while no bike can have
 * crashed yet and a slow check costs nothing.
 */
test('a light-cycle round against three bots ends with all four in the results', async ({
  page,
}) => {
  // What this tab sent, read off the socket. A key that does nothing leaves no mark on the screen:
  // whether the bike turned depends on the bots, so the wire is the only place to see the input.
  const sent: string[] = [];
  page.on('websocket', (socket) => {
    // Vite's own hot-reload socket is not ours.
    if (!socket.url().includes('/parties/')) return;
    socket.on('framesent', ({ payload }) => {
      const message: unknown = JSON.parse(String(payload));
      const input = (message as { input?: { type: string; side?: string } }).input;
      if (input !== undefined)
        sent.push(input.side === undefined ? input.type : `turn ${input.side}`);
    });
  });

  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.getByTestId('name-input').fill('Anna');
  await page.getByTestId('enter').click();
  // Only the host gets the settings, and Start appears with the welcome that says who the host is.
  await expect(page.getByTestId('start')).toBeVisible();

  await page.getByTestId('mode-cycles').click();
  await expect(page.getByTestId('mode-cycles')).toHaveAttribute('aria-pressed', 'true');
  // The speed row exists only once the server confirmed the mode: this is the click that waits for it.
  await page.getByTestId('speed-12').click();
  await expect(page.getByTestId('speed-12')).toHaveAttribute('aria-pressed', 'true');

  // One bot at a time, each waited for: three clicks in a row would race the snapshots they cause.
  const badges = page.getByTestId('bot-badge');
  for (let seated = 1; seated <= 3; seated += 1) {
    await page.getByTestId('add-bot').click();
    await expect(badges).toHaveCount(seated);
  }
  for (const name of RIDERS) await expect(page.getByTestId('players')).toContainText(name);

  await page.getByTestId('start').click();

  // The countdown. The bikes are already placed and the client already has them (`full`), so this
  // is where the arena can be looked at without a clock running.
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('hud-kills')).toBeVisible();
  await expect(page.getByTestId('hud-deaths')).toBeVisible();
  await expect(page.getByTestId('scene').locator('canvas')).toBeVisible();
  // Drawn only once the client knows which of the bikes is its own.
  await expect(page.getByTestId('rubber')).toBeVisible();
  const topFive = page.getByTestId('top-five');
  await expect(topFive.locator('li')).toHaveCount(RIDERS.length);
  for (const name of RIDERS) await expect(topFive).toContainText(name);
  const mute = page.getByTestId('mute');
  await mute.click();
  await expect(mute).toHaveAttribute('data-muted', 'true');

  // The controls are dead until the server says the round is live, so this waits out the countdown.
  await expect(page.getByTestId('turn-left')).toBeEnabled();
  // Not "3:00": if the short round did not reach the server this fails here, at once and by name,
  // instead of the test running into its timeout minutes later.
  await expect(page.getByTestId('hud-timer')).toHaveText(/^0:\d\d$/);

  // Keys first, then the buttons: a button keeps focus, and Space on a focused button is a click.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('d');
  await page.keyboard.press('Space');
  await page.getByTestId('turn-right').click();
  await page.getByTestId('turn-left').click();
  await expect
    .poll(() => sent)
    .toEqual(['turn left', 'turn right', 'boost', 'turn right', 'turn left']);

  // The end of the round comes from the server, so it is waited for, never slept through.
  const results = page.getByTestId('results');
  await expect(results).toBeVisible();
  const rows = results.locator('tbody tr');
  await expect(rows).toHaveCount(RIDERS.length);
  const names = await rows.locator('td:nth-child(2)').allTextContents();
  expect([...names].sort()).toEqual(RIDERS);
  await expect(page.getByTestId('winner')).toHaveText(/\S/);

  // The host can change the room from here. The table is the round that was played: a life is
  // counted in ticks, and the new speed must not turn the same ticks into other seconds.
  const longest = rows.locator('td:nth-child(5)');
  const before = await longest.allTextContents();
  expect(before).toHaveLength(RIDERS.length);
  await expect(page.getByTestId('speed-12')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('speed-20').click();
  await expect(page.getByTestId('speed-20')).toHaveAttribute('aria-pressed', 'true');
  await expect(longest).toHaveText(before);

  await expect(page.getByTestId('bots')).toHaveText(/3$/);
  await page.getByTestId('add-bot').click();
  await expect(page.getByTestId('bots')).toHaveText(/4$/);
  // The table is not the next round's, so a new bot does not wipe it.
  await expect(rows).toHaveCount(RIDERS.length);

  // The other game is one click away; the results of this one mean nothing there, so the room
  // goes back to the lobby.
  await page.getByTestId('mode-clicker').click();
  await expect(page.getByTestId('players')).toBeVisible();
});
