import { expect, type Locator, type Page, test } from '@playwright/test';

/** Everything a frame does, GPU and CPU together, has to fit here for 60 frames a second. */
const FRAME_MS = 1000 / 60;
/** One sample a second: each readout spans the last 120 frames, so the samples do not overlap. */
const SAMPLES = 10;

interface Sample {
  gpuMedian: number;
  gpuP95: number;
  cpuMedian: number;
  cpuP95: number;
  calls: number;
  tris: number;
}

async function read(meter: Locator): Promise<Sample> {
  const value = async (name: string): Promise<number> => Number(await meter.getAttribute(name));
  return {
    gpuMedian: await value('data-gpu-median'),
    gpuP95: await value('data-gpu-p95'),
    cpuMedian: await value('data-cpu-median'),
    cpuP95: await value('data-cpu-p95'),
    calls: await value('data-calls'),
    tris: await value('data-tris'),
  };
}

async function host(page: Page, mode: 'race' | 'cycles', bots: number): Promise<void> {
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

const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] as number;

for (const mode of ['race', 'cycles'] as const) {
  test(`${mode}, twenty players: a frame fits in 60 fps`, async ({ page }) => {
    await host(page, mode, 19);
    // The player's own car drives, so the chase camera moves as it does in play.
    if (mode === 'race') await page.keyboard.down('ArrowUp');
    await page.keyboard.press('KeyP');
    const meter = page.getByTestId('frame-meter');
    // A GPU figure means the timer exists here; without one this command has nothing to say.
    await expect(meter).toHaveAttribute('data-gpu-p95', /\d/);

    const samples: Sample[] = [];
    // Sampling over time is the point here, so these waits are the measurement, not a race.
    await page.waitForTimeout(2000); // shaders compiled on the first frames stay out of it
    for (let i = 0; i < SAMPLES; i++) {
      await page.waitForTimeout(1000);
      samples.push(await read(meter));
    }

    const gpu = {
      median: median(samples.map((s) => s.gpuMedian)),
      worst: Math.max(...samples.map((s) => s.gpuP95)),
    };
    const cpu = {
      median: median(samples.map((s) => s.cpuMedian)),
      worst: Math.max(...samples.map((s) => s.cpuP95)),
    };
    const calls = Math.max(...samples.map((s) => s.calls));
    const tris = Math.max(...samples.map((s) => s.tris));
    const headroom = FRAME_MS - gpu.worst - cpu.worst;
    console.log(
      [
        `${mode}, 20 players, 1280x760`,
        `  GPU  median ${gpu.median.toFixed(2)} ms, worst p95 ${gpu.worst.toFixed(2)} ms`,
        `  CPU  median ${cpu.median.toFixed(2)} ms, worst p95 ${cpu.worst.toFixed(2)} ms`,
        `  ${calls} draw calls, ${Math.round(tris / 1000)}k triangles`,
        `  headroom to 60 fps: ${headroom.toFixed(2)} of ${FRAME_MS.toFixed(2)} ms`,
      ].join('\n'),
    );
    expect(headroom).toBeGreaterThan(0);
  });
}
