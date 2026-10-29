# Plan 19 — a slot palette players can tell apart, glowing alike

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** settle plan 17's open question (3), "a lit bike's rims glow on only half the palette", on
the owner's word of 2026-10-29 ("цвет в байках чет так себе"): twelve hues that are far apart,
and every bike as bright as every other.

**Architecture:** one list of slot hexes for the HUD and the scene; the scene's glowing things —
bikes and walls — take each colour scaled to one luminance, the race's car bodies take it as it is.
Two zones: `graphics` (the scene and the list), `ui` (the HUD reads the same list). No rules, no
wire format, no server.

**Tech stack:** three 0.186 `Color`, `ColorManagement.getLuminanceCoefficients`; Vitest.

Not in this plan, the owner's choice of 2026-10-29: slots 13–20 get no mark of their own (a white
core on the wall and the livery, name tags over vehicles); they repeat slots 1–12. The clicker's car
body is not tinted by slot either.

---

## What the measurement found (2026-10-29, main session)

OKLab distance between every pair of today's twenty `SLOT_COLOURS`, and each lit rim's luminance
(colour × `BIKE_LEVEL` 1.25, linear Rec. 709 weights) against `BLOOM.threshold` 0.6:

- The twenty read as about nine. Closest pairs: `#b5ff3d`/`#9eff3d` ΔE 2.4, `#7dff6a`/`#3dff6a` 3.6,
  `#ff3df2`/`#f03dff` 3.6, `#ffe066`/`#ffd23d` 3.8, `#00f0ff`/`#3dfff0` 5.4 — four greens, three
  magentas, two yellows, two cyans.
- Rim luminance runs 0.23 to 1.02; 10 of 20 rims stay under the threshold (every blue, violet,
  magenta and red), so a yellow bike blazes and a blue one looks switched off.

Twelve hues at each hue's most saturated sRGB point (OKLCH cusp, lightness floored at 0.62), at
hues 25, 50, 90, 125, 150, 180, 210, 240, 270, 300, 325, 350:

`#fe052c #fe7802 #fdca0e #c2fd0a #0dfd78 #12fcdf #0fe3fe #04acfb #5977ff #a052fe #f007ff #ff05a9`

Closest pair ΔE 9.4 (`#12fcdf`/`#0fe3fe`). Their luminance runs 0.21 to 0.82; holding that range
in the colour and lifting dark hues to one brightness would wash blues to pastel (tried: equal OKLab
lightness 0.80 gives closest pair 5.6). So the brightness goes in a per-slot scale instead: each
colour scaled to luminance `SLOT_LUMINANCE` 0.6, a gain of ×0.92 to ×3.62. Then:

| part | level × 1.25 × 0.6 | blooms (0.6) |
|---|---|---|
| lit rim, stripe (1) | 0.75 | every slot |
| lit seam (0.7) | 0.525 | no slot (was 8 of 20) |
| lit body at a grazing edge (0.32 + 0.25) | 0.43 | no |
| unlit bike, brightest surface (1.25 × 0.45) | 0.34 | no |
| wall body (`WALL_LEVEL` 0.3, no 1.25), up to × (1 + `RIM` + `PULSE`) | 0.18 to 0.43 | no |
| wall top band (body ≈ 0.9, + `TOP` 4) | ≈ 0.88 | every slot |

The design canvas shows both palettes side by side ("Player slot palette").

---

### Task 1 (`graphics`): one list, twelve hues, one brightness

**Files:** new `apps/game/src/client/slots.ts`; `apps/game/src/client/scene/look.ts`,
`cycles.tsx`, `walls.ts`, `race.tsx`, `race-cars.ts`; `apps/game/test/cycle-bloom.test.ts`, new
`apps/game/test/slot-palette.test.ts`, `apps/game/test/scene-race-cars.test.ts`.

- [ ] **Red first.** In `cycle-bloom.test.ts`, replace "the rims and stripe of the brightest slot
  bloom" with "every slot's lit rims and stripe bloom" (over every slot, not the brightest), and add
  "every slot glows equally bright" (the glow colours' luminances equal within 1e-6). Make the
  existing two no-bloom tests read the glow colours. New `slot-palette.test.ts`: "no two slots are
  closer than ΔE 0.09 in OKLab" — the conversion is a dozen lines in the test, from the sRGB hex
  (Björn Ottosson's matrices). Run: the bloom test and the distance test fail on today's palette.
- [ ] `slots.ts` exports `SLOT_HEX`, the twelve hexes above in that order, with a comment saying
  why it lives outside the scene: the HUD needs it, and importing `scene/look` would pull three into
  the HUD's bundle.
- [ ] `look.ts`: `SLOT_COLOURS = SLOT_HEX.map((hex) => new Color(hex))` (the race bodies' colour),
  `SLOT_LUMINANCE = 0.6`, and `SLOT_GLOW`: each colour scaled to that luminance with three's own
  coefficients. Rewrite the comments that carried the old facts — the "Known, and the owner's call"
  paragraph, `DIM_LEVEL`'s arithmetic, `CYCLE_SEAM`'s "8 of 20", `CYCLE_RIM`'s "0.582" — with the
  table above.
- [ ] `cycles.tsx` builds `BIKE` and `DIM` from `SLOT_GLOW`; `walls.ts` builds `WALL` from it.
  Both already index `% length`, so slots 13–20 repeat.
- [ ] **The race's trap.** `race.tsx` paints body instances with `SLOT_COLOURS.forEach`, so with
  twelve colours instances 12–19 keep three's default white. Red first: in `scene-race-cars.test.ts`,
  "paints every car body a slot colour, the thirteenth like the first" against a new
  `paintBodies(mesh)` in `race-cars.ts` (a real `InstancedMesh` of `CAR.capacity`, `getColorAt`).
  Then `paintBodies` loops to `CAR.capacity` with `slot % SLOT_COLOURS.length`, and `race.tsx`
  calls it.
- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test`. Break each new test once: put a near-duplicate
  hex back, drop the `%`, use `SLOT_COLOURS` for `BIKE` — each must go red.
- [ ] Commits: `test(scene): every slot blooms alike and stands apart`, then
  `feat(scene): twelve slot hues, each glowing at one luminance`, then
  `fix(scene): race cars past the palette take a slot colour, not white`.

### Task 2 (`ui`): the HUD names a player in the colour the scene paints them

**Files:** `apps/game/src/client/cycles/hud.tsx`; new test in `apps/game/test/`.

- [ ] Red first: "the HUD's colour for a slot is the scene's" — for slots 1–20 in the arena
  (`slotColour`, 1-based) and 0–19 in the race (`raceColour`), equal to the hex of
  `SLOT_COLOURS[slot % 12]`. Red until the HUD reads the shared list.
- [ ] `SLOT_CSS` becomes `SLOT_HEX` from `../slots`; delete the old twenty.
- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test`.
- [ ] Commit: `refactor(ui): the HUD reads the slot colours the scene uses`.

### Task 3 (main session): look at it, write it down

- [ ] Screenshots, headed on the real GPU, dpr 2: the arena with 20 riders (19 bots) mid-round and
  the race with 20 racers, from `vite dev`. Look at them: every bike's rims glow, no two neighbours
  are the same colour, no white car. Compare with `shots/p17-after-chase.png`.
- [ ] Spec, light cycles §"the scene": the palette is twelve hues from `slots.ts`, every lit rim
  blooms, slots 13–20 repeat; strike the "owner's call" sentence. Same pass.
- [ ] Commit: `docs(spec): the light cycles' slot palette`.
- [ ] Review per `review-and-merge`; PR for the history; the owner merges.
