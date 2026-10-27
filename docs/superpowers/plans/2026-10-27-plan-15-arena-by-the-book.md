# Plan 15 — the arena by the book: the instruments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything the owner needs before he writes the arena's three exercises himself — a
command that pictures the arena at the same moments, the floor's red test, and a note per exercise
built on a prototype that ran.

**Architecture:** No change to the game. A Playwright script beside `measure` saves labelled
screenshots on the real GPU; a stub `scene/blur-kernel.ts` fixes the contract the floor's red test
holds the owner's kernel to; the study's section 6 is reordered and annotated. The exercises
themselves — `OutputPass`, the floor, the bike's surface — are the owner's, not this plan's.

**Tech Stack:** Playwright 1.63 (headed Chromium, `--use-angle=metal`), Vitest in workerd,
three 0.186 (`Reflector`, `FullScreenQuad`), R3F 9.7.

**Spec:** [the arena by the book](../specs/2026-10-27-arena-by-the-book-design.md).

---

## What the prototype found (2026-10-27)

Run in the real arena by patching `scene/floor.tsx` and `scene/cycles.tsx` in the working tree
(backups in the scratch directory, restored after; nothing committed). The floor became three's
`Reflector` with a throwaway two-pass blur in its `onBeforeRender`; a probe pushed `u` from the
arena's priority −1 update and `r` from the floor's `onBeforeRender`.

**Frame order.** The probe read `urururur…` with no `rr` and no `uu` over every frame of a round: the
reflection is rendered inside the main render, after this frame's update. The lag plan 9 fought
with drei — which renders its mirror at `useFrame` priority 0 — cannot happen with `Reflector`.

**Layers.** The reflection camera's mask read 1 (layer 0 only) even without setting it — luck, not
design. `Reflector` clones the main camera once, on its first render, and `Object3D.copy` copies the
layer mask. The first render came before `Field`'s effect enabled layer 1 on the main camera, so the
clone missed it; a floor built after that effect, for a new field size, would clone mask 3 and
mirror the grid. The exercise sets the reflection camera to layer 0 itself.

**Brightness.** `Reflector`'s target is half-float: reflected bikes stay above 1 and the bloom finds
them (seen in the screenshots).

**Its material.** Built from the `shader` option, a `ShaderMaterial` without fog unless the shader
merges `UniformsLib.fog`, includes the fog chunks and the material is given `fog = true`.

**A blur inside `onBeforeRender`.** Works after calling `Reflector`'s own: save
`renderer.getRenderTarget()`, draw the passes with `FullScreenQuad`
(`three/examples/jsm/postprocessing/Pass.js`), restore the target, and point the floor's
`tDiffuse` at the result.

**Taps more than two texels apart band.** The throwaway blur stepped three texels: the reflection
became a vertical streak — no blob, no copies — crossed by horizontal bands. The red test's
"no gaps" property is that defect.

**Cost.** `measure`'s method, arena only, M2 Pro, 1280 × 760, device scale 1, twenty players,
vsync on, ten one-second samples:

| Floor | GPU median | GPU worst p95 | Draw calls |
|---|---|---|---|
| drei `MeshReflectorMaterial` (today), two runs | 2.64 / 2.70 ms | 4.66 / 4.40 ms | 29–33 |
| none at all, two runs | 2.71 / 2.73 ms | 4.34 / 4.02 ms | 20–21 |
| `Reflector`, 512², 4× MSAA (its default), no blur | 2.99 ms | 4.64 ms | 24–28 |
| `Reflector`, 256², no MSAA, two blur passes | 2.68 ms | 4.46 ms | 26–30 |

On the M2 the floor costs nothing the meter can separate from run-to-run noise (about 0.1 ms):
exercise B is about the picture, not speed. The one cost that showed is MSAA on a reflection that
is blurred anyway — 0.3 ms for edges nobody sees. The arena's 2.7 ms go elsewhere; the bloom's
passes and the full-screen multisampled target are the suspects, for a bottleneck hunt by RTR
18.2's method later. drei's floor takes 9 to 12 draw calls; `Reflector` takes 4 to 7 — the scene
again — plus one per blur pass.

Commands, from `apps/game`, with the patched files in place:

```bash
node zz-probe.mjs blur '{"blur":true,"size":256,"msaa":0,"layers":true}'
# {"frames":40,"rr":0,"uu":0,"tail":"urururururururururururur","mask":1,"calls":"30"}
PROTO='{"none":true,"blur":false,"size":256,"msaa":0,"layers":true}' \
  pnpm exec playwright test -c playwright.measure.config.ts zz-proto
# PROTO {"none":true,…}: GPU median 2.71 ms, worst p95 4.34 ms, calls 20-21
```

---

## Task 1: A command that pictures the arena

**Agent:** `qa`, `model: sonnet`.

**Files:**
- Create: `apps/game/measure/host.ts`
- Create: `apps/game/measure/shots.measure.ts`
- Modify: `apps/game/measure/frame.measure.ts` (use the shared `host`)
- Modify: `apps/game/package.json` (scripts `measure`, `shots`)
- Modify: `.gitignore`

- [ ] **Step 1: Move `host` out of `frame.measure.ts`**

`apps/game/measure/host.ts`:

```ts
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
```

In `frame.measure.ts`, delete its own `host` and add `import { host } from './host';`. Its
`type Page` import goes if nothing else uses it.

- [ ] **Step 2: Write the shots script**

`apps/game/measure/shots.measure.ts`:

```ts
import { test } from '@playwright/test';
import { host } from './host';

/**
 * `LABEL=before pnpm --filter @clicker/app run shots`: the arena at the same moments every time,
 * saved as `shots/<label>-<moment>.png`, so a change to the picture sits beside what it replaced.
 * On the real GPU like `measure`, and at the device scale of the owner's screen: this is about how
 * it looks to him.
 */
test.use({ deviceScaleFactor: 2 });

const LABEL = process.env.LABEL ?? 'now';

test('the arena, at the same moments', async ({ page }) => {
  await host(page, 'cycles', 3);
  // The moments are times on purpose: what is compared is the picture, not a state to wait for.
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `shots/${LABEL}-chase.png` });
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `shots/${LABEL}-turn.png` });
});
```

- [ ] **Step 3: Scripts and ignore**

In `apps/game/package.json`, `scripts`:

```json
"measure": "playwright test -c playwright.measure.config.ts frame",
"shots": "playwright test -c playwright.measure.config.ts shots",
```

In the root `.gitignore`, after `playwright-report/`:

```
apps/game/shots/
```

- [ ] **Step 4: Run both**

```bash
cd apps/game
pnpm exec playwright test -c playwright.measure.config.ts frame --list   # frame.measure.ts only: 2 tests
LABEL=baseline pnpm run shots
ls shots/                                                                # baseline-chase.png baseline-turn.png
```

Expected: `--list` shows the race and cycles tests and nothing from `shots`; two PNG files of
2560 × 1520. Open both and describe them in the report: the own bike in the middle, the floor's
blob behind it, the grid.

- [ ] **Step 5: Checks and commit**

```bash
pnpm check && pnpm typecheck
git add apps/game/measure .gitignore apps/game/package.json
git commit -m "feat(app): picture the arena at the same moments for side-by-side looks"
```

## Task 2: The floor's red test

**Files:**
- Create: `apps/game/src/client/scene/blur-kernel.ts` (main session: the contract, a stub)
- Create: `apps/game/test/scene-blur-kernel.test.ts` (`qa`, `model: sonnet`)

- [ ] **Step 1: The stub** (main session — production code is not `qa`'s)

```ts
/**
 * The taps of a Gaussian blur along one axis: offsets in texels from the centre, ascending, and
 * the weight of each. A tap may sit between two texels, so that one bilinear read weighs both
 * (RTR 12.1).
 *
 * Exercise B of the arena by the book, written by the owner against
 * `test/scene-blur-kernel.test.ts`.
 */
export interface Taps {
  offsets: Float32Array;
  weights: Float32Array;
}

export function gaussianTaps(sigma: number): Taps {
  throw new Error(`gaussianTaps(${sigma}): exercise B, RTR 12.1, is not written yet`);
}
```

- [ ] **Step 2: The test** (`qa`)

`apps/game/test/scene-blur-kernel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gaussianTaps } from '../src/client/scene/blur-kernel';

/** From a hair to a wide smear, in texels. */
const SIGMAS = [1, 1.5, 2, 3, 5, 8, 13];

/**
 * Every tap spread onto the two texels a bilinear read blends: the kernel the GPU actually sums.
 * A tap on a whole texel stays on it.
 */
function texels(sigma: number): Map<number, number> {
  const { offsets, weights } = gaussianTaps(sigma);
  const kernel = new Map<number, number>();
  const add = (texel: number, weight: number): void => {
    kernel.set(texel, (kernel.get(texel) ?? 0) + weight);
  };
  offsets.forEach((offset, i) => {
    const weight = weights[i] as number;
    const low = Math.floor(offset);
    const f = offset - low;
    add(low, weight * (1 - f));
    if (f > 0) add(low + 1, weight * f);
  });
  return kernel;
}

// The owner's exercise B (docs/superpowers/specs/2026-10-27-arena-by-the-book-design.md, §3 B).
// Skipped until he starts it: take `.skip` off and watch every test fail against the stub first.
describe.skip('the floor blur kernel', () => {
  it('neither brightens nor darkens what it blurs', () => {
    for (const sigma of SIGMAS) {
      const { weights } = gaussianTaps(sigma);
      expect(weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 5);
    }
  });

  it('does not slide the reflection sideways', () => {
    for (const sigma of SIGMAS) {
      const { offsets, weights } = gaussianTaps(sigma);
      const n = offsets.length;
      for (let i = 0; i < n; i += 1) {
        expect(offsets[i]).toBeCloseTo(-(offsets[n - 1 - i] as number), 5);
        expect(weights[i]).toBeCloseTo(weights[n - 1 - i] as number, 5);
      }
    }
  });

  // drei's blur left gaps between its taps wider than anything in the picture, and the floor
  // showed a row of copies of every bike; the prototype's three-texel steps showed as bands.
  it('leaves no gap between taps for copies to show through', () => {
    for (const sigma of SIGMAS) {
      const { offsets } = gaussianTaps(sigma);
      for (let i = 1; i < offsets.length; i += 1) {
        const gap = (offsets[i] as number) - (offsets[i - 1] as number);
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThanOrEqual(2);
      }
    }
  });

  it('is the Gaussian it was asked for', () => {
    for (const sigma of SIGMAS) {
      let variance = 0;
      for (const [texel, weight] of texels(sigma)) variance += weight * texel * texel;
      expect(variance / (sigma * sigma)).toBeGreaterThan(0.95);
      expect(variance / (sigma * sigma)).toBeLessThan(1.05);
    }
  });

  // RTR 12.1: a separable filter reads 2d texels where a square one reads d². Ten times wider
  // costs about ten times the reads; a hundred would mean a square kernel in disguise.
  it('reads the texture a number of times that grows with the width, not its square', () => {
    const ratio = gaussianTaps(20).offsets.length / gaussianTaps(2).offsets.length;
    expect(ratio).toBeGreaterThan(4);
    expect(ratio).toBeLessThan(20);
  });
});
```

- [ ] **Step 3: Prove the test can fail and can pass** (`qa`)

Nothing of this step is committed. In the working tree, take `.skip` off and run
`pnpm --filter @clicker/app exec vitest run test/scene-blur-kernel.test.ts` against:

1. the stub — expected: all five red;
2. a correct kernel written for the purpose — sampled Gaussian to 3σ, normalised, neighbouring
   texels merged into one bilinear tap outwards from a centre tap — expected: all five green;
3. that kernel unnormalised — expected: "neither brightens nor darkens" red (the variance, summed
   from the raw weights, goes red with it);
4. merged in pairs from the centre outwards on both sides, (0,1), (2,3) and (−1,−2) … — expected:
   "does not slide" red;
5. one tap every three texels — expected: "leaves no gap" red;
6. truncated at 1.5σ — expected: "is the Gaussian" red;
7. one tap per texel of a square kernel, (6σ + 1)² of them — expected: "grows with the width" red.

Report each run's result. Then restore the stub (`git checkout -- apps/game/src/client/scene/blur-kernel.ts`)
and put `.skip` back. The correct kernel lives only in the scratch directory: it is the exercise.

- [ ] **Step 4: Checks and commit**

```bash
pnpm check && pnpm typecheck && pnpm --filter @clicker/app test
git status --short   # the stub and the test only
git add apps/game/src/client/scene/blur-kernel.ts apps/game/test/scene-blur-kernel.test.ts
git commit -m "test(app): hold the floor's blur kernel to what a viewer would see go wrong"
```

## Task 3: The exercises, annotated (main session)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-real-time-rendering-study.md` §6

- [ ] **Step 1:** Reorder the exercise list: instancing the clicker; A, the colour chain; B, the
floor; C, the bike's surface; capsules; depth; particles; ambient occlusion. Mark P1's shared
module as deferred to ambient occlusion (spec §2.6).
- [ ] **Step 2:** Under each of A, B and C: what to read, where it lives in our code, its proof,
the numbers to record, and the prototype's traps for B. C also notes that
`test/cycle-model.test.ts` asserts the per-vertex brightnesses (16, 32, 100) the procedural texture
replaces: that assertion is rewritten with the exercise.
- [ ] **Step 3:** Record the finding that the arena's GPU time is not the floor's, for a later
bottleneck hunt (track B, step 7).
- [ ] **Step 4:** Commit: `docs: annotate the arena's exercises from plan 15's prototype`.

## Task 4: Finish

- [ ] README: the `shots` command under Commands; the app's test count.
- [ ] `pnpm format && pnpm check && pnpm typecheck && pnpm test`; `e2e` frame and cycles specs.
- [ ] `review-and-merge`: an Opus reviewer, every finding reproduced first, `--no-ff` into local
  `main`. Not pushed: that is the owner's call.
- [ ] A Russian summary for the owner: what is ready for each exercise, the prototype's numbers,
  and the baseline pictures.
