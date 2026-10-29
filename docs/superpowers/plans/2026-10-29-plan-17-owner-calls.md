# Plan 17 — the owner's calls after plan 16

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** settle three of the five questions plan 16 left with the owner, on his "го делать" of
2026-10-29: `measure` at both pixel densities, the arena's composer without multisampling on
dense screens, and the clicker's heartbeat applying time so a late alarm cannot leave the room in
a countdown that has ended.

**Architecture:** three independent changes in three zones — `qa` (the measure config), `graphics`
(the arena's composer), `engine` (the room's heartbeat). No rules change, no wire format change.

**Tech stack:** Playwright projects; three 0.186 `EffectComposer` / `WebGLRenderTarget.samples`;
partyserver `Server` on a Durable Object, Vitest in workerd.

Not in this plan: (3) a lit bike's rims glow on only half the palette — still the owner's eye;
(5) the push — done by the owner at 09:04 on 2026-10-29 (`origin/main` = d3e66fd, the live bundle
matched a local build).

---

## What the prototype found (2026-10-29, main session, M2 Pro, headed Metal, vsync on)

Arena, twenty riders, 1280 × 760 at `deviceScaleFactor: 2`, composer target samples changed by hand
between runs, in the order run:

| samples | GPU median | worst p95 | calls |
|---|---|---|---|
| 2 | 5.05 ms | 5.92 ms | 30 |
| 4 | 6.39 ms | 7.84 ms | 30 |
| 2 | 5.05 ms | 5.98 ms | 30 |
| 0 | 2.78 ms | 3.60 ms | 30 |

Two samples keep most of the cost, so there is no cheap middle: on a dense screen the target goes
without multisampling at all. CPU 0.10 ms in every run; the draw count does not move.

Pictures (`LABEL=p17-msaa` / `p17-nomsaa pnpm run shots`): at full size no difference shows. Cropped
1:1, a nearly horizontal wall top shows a one-device-pixel step without multisampling — half a CSS
pixel on this screen. The grid and the bikes' seams are antialiased in their shaders (`fwidth`) and
do not change.

---

### Task 1 (`qa`): `measure` at dpr 1 and dpr 2

**Files:** `apps/game/playwright.measure.config.ts`, `apps/game/measure/frame.measure.ts`,
`apps/game/package.json` (the `shots` script).

- [ ] Two Playwright projects in the measure config, `dpr1` (`deviceScaleFactor: 1`) and `dpr2`
  (`deviceScaleFactor: 2`); the shared `use` keeps everything else. The comment says why: the
  owner's screen is dpr 2 and costs about 2.5× the fragment work; plan 16's findings each showed at
  one density only (A's cost at dpr 1, the floor's interrupted pass at dpr 2).
- [ ] The printed block names the density: `cycles, 20 players, 1280x760 at dpr 2`. Read it from
  `testInfo.project.use.deviceScaleFactor` (the test's own argument), not from the project name.
- [ ] `shots` stays at dpr 2 only: its script gets `--project=dpr2` (the file's own `test.use` sets
  dpr 2 already, so without it both projects would take the same pictures twice).
- [ ] Run `pnpm --filter @clicker/app run measure` once; four blocks print, two per mode, and each
  density's block says which it is. Do not run anything else heavy at the same time.
- [ ] Commit: `test(measure): measure the frame at both pixel densities`.

### Task 2 (`graphics`): no multisampling in the arena's composer on dense screens

**Files:** `apps/game/src/client/scene/cycles.tsx` (the composer in `Field`), a small pure helper
next to it, a unit test.

- [ ] Red first: a unit test of `composerSamples(dpr)` — 4 at dpr 1 and 1.5, 0 at dpr 2 and 3.
  Watch it fail against a helper that returns 4.
- [ ] `composerSamples(dpr: number): number` — `dpr >= 2 ? 0 : 4`. Its comment carries the
  prototype's numbers above and the reason: on a dense screen a pixel is half a CSS pixel, and the
  multisampled half-float target is half the arena's GPU time.
- [ ] `Field` reads `useThree((s) => s.viewport.dpr)` and the composer's `useMemo` depends on it,
  so a window moved between screens rebuilds the chain at the right density (the composer reads the
  renderer's pixel ratio when it is built). The dispose effect already follows the memo.
- [ ] `measure` before and after at both densities, alternating, two runs each, nothing else heavy
  running: dpr 2 should fall by about half, dpr 1 not move.
- [ ] `verify-visually`: `LABEL=p17-after pnpm run shots`, look at the full picture and a 1:1 crop
  of a wall edge; describe them.
- [ ] Commit: `perf(app): no multisampling in the arena's composer on dense screens`.

### Task 3 (`engine`): the clicker's heartbeat applies time

**Files:** `apps/game/src/worker/room.ts`, `apps/game/test/room.test.ts`.

The defect (diagnosed in plan 16): a phase moves only when a command arrives or the alarm fires.
The 10 Hz snapshot timer of a clicker round broadcasts `toSnapshot(this.#state, Date.now())`
without applying the time first, so when the alarm at `goAt` is late — the full suite running in
parallel is enough — every snapshot until it fires still says `countdown`. "streams more than one
snapshot during a running round" (`test/room.test.ts:229`) then fails about one run in nine: the
test's round is 200 ms (`COUNTDOWN_MS 50`, `ROUND_MS 200` in `vitest.config.ts`).

- [ ] Reproduce the flake before touching anything: run the whole `pnpm test` in a sequential
  loop (never parallel loops on this machine) until that test fails, and keep the failing output.
  Record how many runs it took.
- [ ] Red, deterministic: a test that removes the alarm right after `start`
  (`runInDurableObject(stub, (_i, state) => state.storage.deleteAlarm())`) and then waits for a
  running snapshot. Today nothing moves the phase, so it fails every run. If the 50 ms countdown can
  end before the alarm is deleted, find a way that cannot race — do not paper over it with timing.
- [ ] Green: the timer's callback applies a `tick` before it broadcasts, the way `#stepOnce` does
  for the living modes — `#apply({ type: 'tick' })`, and on a phase change `#settle` (which
  persists, schedules the alarm and broadcasts); otherwise only the snapshot. No storage write on a
  beat that changed nothing: the heartbeat is on the hot path.
- [ ] Then judge the flake itself: run the sequential loop again, at least as many runs as it took
  to fail. If the test can still fail because it counts beats inside a 200 ms window, the race is in
  the test: remove it (the title asks for "more than one" snapshot), never widen a timeout.
- [ ] Commit(s): `fix(worker): the clicker's heartbeat applies time before it reports it` (+ a
  `test(worker): …` commit if the test changes on its own).

### Task 4 (main session): documents, checks, review, merge

- [ ] Study doc §6: a Progress row for the composer (RTR 5.4.2: multisampling's cost is in its
  samples' storage) and the "Where the arena's time goes" paragraph marked answered and acted on.
- [ ] Light-cycles spec: the decision and its numbers. README: `measure` prints both densities.
- [ ] `pnpm check && pnpm typecheck && pnpm test`, the e2e suite, `review-and-merge`.
- [ ] Russian summary to the owner with the numbers.

---

## Where reality changed the plan

- **Task 3's flake was the alarm, and it was not alone.** Before the fix, fifteen sequential runs of
  the whole suite failed four times: "streams more than one snapshot" once (run 14: snapshots at
  goAt + 51 … 453 ms all said `countdown`, the next one already `results`), "does not rewrite the
  alarm" twice and the arena's "answers resync with the whole round" twice — each waits for a state
  the alarm should have moved. After it, fourteen runs, no failure of any kind.
- **The beat-counting test was dropped, then had to come back.** The engine agent removed it as a
  race (three beats inside a 450 ms round). Mutating the beat so a beat that changes nothing no
  longer broadcasts then left the whole app suite green, 323/323: it had been the only guard on
  mid-round streaming. It is back without the race — a 5 s round, two snapshots with different
  `serverNow` — and red on that mutation.
- **Task 2's numbers**, `measure -g cycles` alternating after/before, two runs each, nothing else
  running: dpr 2 6.36 / 6.36 ms → 2.76 / 2.77 ms GPU median (worst p95 7.31 / 7.53 → 3.55 / 3.27);
  dpr 1 2.37 / 2.33 → 2.34 / 2.36. 30 calls in every run. Not checked in a real window: a window
  moved between screens of different density (the memo depends on the canvas's `dpr`).
