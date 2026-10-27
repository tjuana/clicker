import { expect, type Page, test } from '@playwright/test';

/** The rules' bit for gas; the wire carries masks, so the test names the one it expects. */
const GAS = 1;
const RACERS = 4;

/** The masks this tab sent, read off the socket, in order. */
function masksSent(page: Page): number[] {
  const sent: number[] = [];
  page.on('websocket', (socket) => {
    // Vite's own hot-reload socket is not ours.
    if (!socket.url().includes('/parties/')) return;
    socket.on('framesent', ({ payload }) => {
      const input = (JSON.parse(String(payload)) as { input?: { type: string; mask?: number } })
        .input;
      if (input?.type === 'keys' && input.mask !== undefined) sent.push(input.mask);
    });
  });
  return sent;
}

interface Pose {
  x: number;
  y: number;
  speed: number;
}

/**
 * Where this tab's own car has been, read off the frames the page receives. The slot comes from
 * the race's full snapshot, matched to the public id in welcome; the poses from every delta after.
 * A server that ignored the keys would leave the car standing at its start.
 */
function ownCar(page: Page): { poses: Pose[] } {
  const poses: Pose[] = [];
  let you: string | undefined;
  let slot: number | undefined;
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/parties/')) return;
    socket.on('framereceived', ({ payload }) => {
      const frame = JSON.parse(String(payload)) as {
        type: string;
        mode?: string;
        you?: string;
        cars?: Array<{ slot: number; id: string }> | number[];
      };
      if (frame.type === 'welcome') you = frame.you;
      if (frame.mode !== 'race') return;
      if (frame.type === 'full') {
        slot = (frame.cars as Array<{ slot: number; id: string }>).find(
          (car) => car.id === you,
        )?.slot;
      } else if (frame.type === 'delta' && slot !== undefined) {
        const cars = frame.cars as number[];
        // 7-tuples: slot, x, y, heading, speed, lap, flags.
        for (let at = 0; at < cars.length; at += 7) {
          const [id, x, y, , speed] = cars.slice(at, at + 7);
          if (id === slot && x !== undefined && y !== undefined && speed !== undefined)
            poses.push({ x, y, speed });
        }
      }
    });
  });
  return { poses };
}

/** Waits until a pose with speed shows the car has left where it started. */
async function carMovesUnderGas(poses: Pose[]): Promise<void> {
  await expect.poll(() => poses.length).toBeGreaterThan(0);
  const start = { ...poses[0] };
  await expect
    .poll(() => poses.some((p) => p.speed > 0 && (p.x !== start.x || p.y !== start.y)))
    .toBe(true);
}

/**
 * One racer, three bots, the ring. Resolves once the HUD is on screen. One page on purpose, as in
 * cycles.spec.ts; the round ends by ROUND_MS from playwright.config.ts, not by the race's own cap
 * of five minutes.
 */
async function startRace(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.getByTestId('name-input').fill('Anna');
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('start')).toBeVisible();

  await page.getByTestId('mode-race').click();
  await expect(page.getByTestId('mode-race')).toHaveAttribute('aria-pressed', 'true');

  const badges = page.getByTestId('bot-badge');
  for (let seated = 1; seated <= 3; seated += 1) {
    await page.getByTestId('add-bot').click();
    await expect(badges).toHaveCount(seated);
  }
  await page.getByTestId('start').click();
  await expect(page.getByTestId('hud')).toBeVisible();
}

/** Nobody has touched a key, so the clock reads the same until the server says go. */
async function raceIsLive(page: Page): Promise<void> {
  const time = page.getByTestId('hud-time');
  const before = await time.textContent();
  await expect.poll(async () => await time.textContent()).not.toBe(before);
}

async function endOfRound(page: Page): Promise<void> {
  const results = page.getByTestId('results');
  await expect(results).toBeVisible();
  const rows = results.locator('tbody tr');
  await expect(rows).toHaveCount(RACERS);
  for (const name of ['Anna', 'Bot 1', 'Bot 2', 'Bot 3']) {
    await expect(results.locator('tbody')).toContainText(name);
  }
}

test('holding W is gas on the wire, the clock runs, four rows at the end', async ({ page }) => {
  const sent = masksSent(page);
  const { poses } = ownCar(page);
  await startRace(page);

  await page.keyboard.down('KeyW');
  await raceIsLive(page);
  expect(sent).toEqual([GAS]);
  await carMovesUnderGas(poses);
  await page.keyboard.up('KeyW');
  await expect.poll(() => sent).toEqual([GAS, 0]);

  await endOfRound(page);
});

test('holding the Gas button is gas on the wire, the clock runs, four rows at the end', async ({
  page,
}) => {
  const sent = masksSent(page);
  const { poses } = ownCar(page);
  await startRace(page);

  const gas = page.getByTestId('gas');
  await expect(gas).toBeEnabled();
  await gas.hover();
  await page.mouse.down();
  await raceIsLive(page);
  expect(sent).toEqual([GAS]);
  await carMovesUnderGas(poses);
  await page.mouse.up();
  await expect.poll(() => sent).toEqual([GAS, 0]);

  await endOfRound(page);
});
