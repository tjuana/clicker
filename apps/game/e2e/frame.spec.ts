import { type Browser, expect, type Page, test } from '@playwright/test';

/**
 * A race frame, measured in plan 14's prototype on the M2 and on CI's software renderer alike:
 * three track layers, the ground, the barriers, four car parts and the sky, then five draws into
 * the sun's shadow map. Cars that are not on the field stay in their instanced mesh at zero scale,
 * so the count does not move with the number of cars.
 */
const RACE_CALLS = 15;
/**
 * The arena: 29 draws in every frame (the scene, the floor's reflection, the bloom's passes),
 * plus each of the four border boxes while in view. With their culling turned off the count sits
 * at 33, so 33 is the structure's ceiling, not a lucky reading. The minimum also guards the meter:
 * with three's per-render reset left on, a frame reads 1 — the race's gates cannot see that, as
 * its last render does not reset.
 */
const CYCLES_CALLS = { min: 29, max: 33 };

/** Host a room in `mode`, seat `bots` bots one at a time, start, and wait for the HUD. */
async function host(page: Page, mode: 'race' | 'cycles', bots: number): Promise<void> {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.getByTestId('name-input').fill('Anna');
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId(`mode-${mode}`).click();
  await expect(page.getByTestId(`mode-${mode}`)).toHaveAttribute('aria-pressed', 'true');
  // One bot at a time, each waited for: clicks in a row would race the snapshots they cause.
  const badges = page.getByTestId('bot-badge');
  for (let seated = 1; seated <= bots; seated += 1) {
    await page.getByTestId('add-bot').click();
    await expect(badges).toHaveCount(seated);
  }
  await page.getByTestId('start').click();
  await expect(page.getByTestId('hud')).toBeVisible();
}

/** Shows the line and reads the draw calls of a frame once the scene has measured one. */
async function drawCalls(page: Page): Promise<number> {
  await page.keyboard.press('KeyP');
  const meter = page.getByTestId('frame-meter');
  await expect(meter).toHaveAttribute('data-calls', /^[1-9]\d*$/);
  return Number(await meter.getAttribute('data-calls'));
}

for (const racers of [4, 20]) {
  test(`a race frame costs ${RACE_CALLS} draw calls with ${racers} cars`, async ({ page }) => {
    await host(page, 'race', racers - 1);
    expect(await drawCalls(page)).toBe(RACE_CALLS);
  });
}

// A phone sent to the background or a driver reset takes the canvas's context away; on its return
// three builds a new `renderer.info`, and a meter still reading the old one counted 0 for good.
test('the line counts again once the GPU gives the canvas back', async ({ page }) => {
  await host(page, 'race', 1);
  expect(await drawCalls(page)).toBe(RACE_CALLS);
  await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    (window as { lost?: WEBGL_lose_context | null }).lost = gl?.getExtension('WEBGL_lose_context');
    (window as { lost?: WEBGL_lose_context | null }).lost?.loseContext();
  });
  const meter = page.getByTestId('frame-meter');
  // Nothing is drawn while the context is gone: the line says so before it comes back.
  await expect(meter).toHaveAttribute('data-calls', '0');
  await page.evaluate(() =>
    (window as { lost?: WEBGL_lose_context | null }).lost?.restoreContext(),
  );
  await expect(meter).toHaveAttribute('data-calls', String(RACE_CALLS));
});

for (const riders of [4, 20]) {
  test(`an arena frame costs the same draw calls with ${riders} riders`, async ({ page }) => {
    await host(page, 'cycles', riders - 1);
    const calls = await drawCalls(page);
    expect(calls).toBeGreaterThanOrEqual(CYCLES_CALLS.min);
    expect(calls).toBeLessThanOrEqual(CYCLES_CALLS.max);
  });
}

/** A clicker round with `players` people, each from a context of their own; returns the host. */
async function clicker(browser: Browser, players: number): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.getByTestId('name-input').fill('Anna');
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('start')).toBeVisible();
  for (let guest = 1; guest < players; guest += 1) {
    const other = await (await browser.newContext()).newPage();
    await other.goto(page.url());
    await other.getByTestId('name-input').fill(`Guest ${guest}`);
    await other.getByTestId('enter').click();
    await expect(page.getByTestId('players')).toContainText(`Guest ${guest}`);
  }
  await page.getByTestId('start').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  return page;
}

// The clicker's cars are two instanced meshes (the livery part and the rest of the car) and its
// forty-eight metre marks one more, so a frame costs the same draw calls for one player as for
// fifty. Each racer used to be a clone with five meshes of its own: 53 + 6 per player, 59 alone,
// 77 with four, about 173 with twenty.
test('a clicker frame costs the same draw calls for four players as for one', async ({
  browser,
}) => {
  const alone = await drawCalls(await clicker(browser, 1));
  const four = await drawCalls(await clicker(browser, 4));
  expect(four).toBe(alone);
});
