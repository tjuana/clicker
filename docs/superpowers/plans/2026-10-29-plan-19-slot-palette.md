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

---

## Where reality differed (2026-10-29)

- **Task 1's third breakage check could not go red as planned.** Building the bikes from the raw
  colours changed no test: `BIKE`, `DIM` and `WALL` were private to `cycles.tsx` and `walls.ts`, and
  the bloom test read `SLOT_GLOW`. They became `BIKE_COLOURS`, `DIM_COLOURS` and `WALL_COLOURS` in
  `look.ts`, and the bloom tests read those — the colours the meshes are painted in. A wall built
  from raw colours still passes the wall ceiling (0.59 against 0.6), so "every slot glows equally
  bright" covers lit, unlit and wall tables, and that is the test that catches it (`9f59545`).
- **Task 2: the HUD's lookups live in `slots.ts`, not in the HUD.** The test project has no JSX
  setting, so a test cannot import `slotColour` from a `.tsx`; `race/hud.tsx` and
  `screens/race-room.tsx` read them too. `slotColour` (arena, from one) and `raceColour` (race, from
  zero) sit beside `SLOT_HEX` (`37e5d22`, `01d9b25`).
- **The red commit does not build alone.** `a566566` imports what `65b402c` and `18271f7` add, as
  plan 18's red commit did.
- **Pictures** (`vite dev` on 5174, headed Metal, dpr 2, scratch spec deleted after):
  `shots/p19-arena.png`, twenty riders — every bike's rims and every wall's top glow, blue and
  violet included; `shots/p19-race-grid.png`, twenty racers — the HUD names match the car colours.
  The pictures are not in git (`shots/` is ignored).

## Review (2026-10-29, independent Opus reviewer, read-only)

No correctness defects: slot indexing (arena from one, race from zero), the luminance the bloom's
high-pass sees (three 0.186 builds it from the same coefficients; nothing clamps a channel past 1
before the high-pass) and every consumer of the old list were checked, some by a throwaway test.

1. **The ΔE ≥ 0.09 promise holds for the hexes, not for the glow on screen** — confirmed by
   arithmetic, not by eye: the arena's canvas leaves R3F's default ACES tone mapping, which washes
   the scaled-up HDR glow towards white; on the lit rims slots 7/8 come out ΔE 0.020 apart, 6/7
   0.023, 11/12 0.029 (the old palette: 0.011). Under `NeutralToneMapping`, which the race already
   uses, the closest rim pair is 0.057 and hues hold (`shots/p19-neutral-arena.png`, by a one-line
   scratch change, reverted). Changing the arena's tone mapping changes its whole look: **the
   owner's call, not in this branch.**
2. **Nothing tied the scene's per-slot lookup to the HUD's colour** — confirmed: with `walls.ts`
   indexing `slot % length` all 332 app tests stayed green. Fixed in `fd44e45`: `glowFor` in
   `look.ts`, used by bikes and walls, and a test over slots 1–20 that the bike's and the wall's
   hue is `slotColour`'s; both mutations go red. Left: a wrong slot passed to `glowFor` inside
   `drawBike` itself is not caught, since `drawBike` is private.
3. **Stale comments** (race-look's "twenty hues", `SLOT_LUMINANCE`'s "middle of the run" and its
   gain figures) — fixed in `c14e7ce`.
4. **The race spec said nothing of the wrap** — a twenty-car race has eight pairs of cars, and HUD
   names, in one colour. Recorded in the spec, `fb05fcb`; marking them apart is not in this plan.
   Also noted: slot 1 is red `#fe052c`, near the race's red kerbs and the HUD's danger colour.

Seen during verification, not caused by this branch (it touches no worker or package file): two
different worker room tests each failed once under a full parallel `pnpm test` — "ends with
light-cycle results, after which nothing more is streamed" and "sends everyone the whole round
again when a bike joins mid-round" — and passed alone six times in a row and in two full reruns.

Verified: `pnpm check`, `pnpm typecheck`, `pnpm test` — 410 + 123 + 334 tests, twice in a row.

---

### Task 4 (`graphics`), the owner's call of 2026-10-30 on review finding 1: the arena under Neutral

The arena's canvas sets no tone mapping, so R3F's default ACES applies, and ACES washes the glow
colours towards white: the lit rims of slots 7/8 reach the screen ΔE 0.020 apart. Under
`NeutralToneMapping` (three's Khronos PBR Neutral, which the race already uses, `race-look.ts`)
the closest pair of lit rims is ΔE 0.057 and the hues hold (`shots/p19-neutral-arena.png`).

**Files:** `apps/game/src/client/scene/look.ts`, `cycles.tsx`; a test in `apps/game/test/`.

- [ ] Red first: "on screen, no two slots' lit rims are closer than ΔE 0.05". The test takes each
  `BIKE_COLOURS` entry (rim level 1), passes it through the arena's tone mapping, sRGB-encodes it
  and measures OKLab distances. The tone mapping comes from a constant in `look.ts`,
  `ARENA_TONE_MAPPING`; the test ports three 0.186's GLSL for `ACESFilmicToneMapping` and
  `NeutralToneMapping` (`tonemapping_pars_fragment`, exposure 1) to a few lines of TypeScript and
  picks by that constant. With `ACESFilmicToneMapping` it is red (0.020).
- [ ] `look.ts`: `ARENA_TONE_MAPPING = NeutralToneMapping`, with the why. `cycles.tsx` passes it to
  the canvas (`gl={{ antialias: false, toneMapping: ARENA_TONE_MAPPING }}`); `OutputPass` reads the
  renderer's tone mapping, so the whole picture, glow included, goes through it once.
- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test`; break-check by setting the constant back to ACES.
- [ ] Commit: `feat(scene): the arena tone-maps with Neutral, so slot hues survive the glow`.
- [ ] Main session: screenshots of the arena with 20 riders in the chase view and the overview,
  against `shots/p19-arena.png`; the spec's scene section says the arena tone-maps with Neutral.
