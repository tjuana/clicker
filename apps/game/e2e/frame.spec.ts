import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';

/**
 * A race frame, measured in plan 14's prototype on the M2 and on CI's software renderer alike:
 * three track layers, the ground, the barriers, four car parts and the sky, then five draws into
 * the sun's shadow map. Cars that are not on the field stay in their instanced mesh at zero scale,
 * so the count does not move with the number of cars. Plus two particle pools, dust and sparks:
 * the count does not depend on what is alive either, because a dead particle is still drawn,
 * collapsed to a point.
 */
const RACE_CALLS = 17;
/**
 * The arena: 30 draws at most. Each is one of: the scene (grid, walls, bikes, the floor's plane,
 * four border boxes: 8), the floor's reflection (three's Reflector draws the arena again without
 * the grid: walls, bikes, four borders: 6), the floor's two blur passes (across, then down: 2),
 * and the bloom and output passes (14). 30 is the structure's ceiling: with the border boxes'
 * culling turned off a frame still reads 30, so it is not a lucky reading. It was 33 with drei's
 * reflector, whose Kawase blur spent more passes than these two.
 *
 * The minimum is not the structure's floor. Three issues no draw for an instanced mesh with zero
 * instances, and the walls (none at the start) and the bikes (those shown) are instanced meshes;
 * the border boxes the view culls drop out as well, so a frame may read fewer. 22 guards the
 * meter: a frame reads 1 when three's per-render reset is left on, and the race's gates cannot see that, as
 * its last render does not reset. It holds at the gate's moment because the spawn cells are
 * already walls when it reads.
 */
const CYCLES_CALLS = { min: 22, max: 30 };

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

/**
 * A clicker round with `players` people, each from a context of their own; returns the host. Every
 * context opened is pushed to `opened`, for the caller to close: a context left running keeps its
 * room and its canvas (software GL in headless Chromium) alive and starves the tests after it.
 */
async function clicker(browser: Browser, players: number, opened: BrowserContext[]): Promise<Page> {
  const open = async (): Promise<Page> => {
    const context = await browser.newContext();
    opened.push(context);
    return context.newPage();
  };
  const page = await open();
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.getByTestId('name-input').fill('Anna');
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('start')).toBeVisible();
  for (let guest = 1; guest < players; guest += 1) {
    const other = await open();
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
  const opened: BrowserContext[] = [];
  try {
    const alone = await drawCalls(await clicker(browser, 1, opened));
    const four = await drawCalls(await clicker(browser, 4, opened));
    expect(four).toBe(alone);
  } finally {
    await Promise.all(opened.map((context) => context.close()));
  }
});
