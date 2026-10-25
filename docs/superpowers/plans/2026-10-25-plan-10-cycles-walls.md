# Light-Cycle Walls on a Button Implementation Plan (plan 10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host setting lets the light cycles' walls be laid only while a key is held, from a limited store of energy; bots use it too.

**Architecture:** The room's light-cycle settings become one object, `{ speed, walls }`, handed to the mode where the speed is handed today. The rules gain the held key, a lit flag and energy per bike; a bike without a wall vacates its own head cell when it moves, which the step's existing "a tail moves out of the way" machinery already knows how to settle, plus one rule against two bikes swapping cells. The protocol goes to version 3. The client draws walls only where the rules have them, dims a bike that is not walling, and shows an energy bar.

**Tech Stack:** TypeScript, valibot, Vitest (node for the rules and protocol, workerd for the app), Playwright 1.63.0.

Spec: [polish and walls design](../specs/2026-10-25-light-cycles-polish-and-walls-design.md), §3.

## What was verified before this plan

No new library, tool or runtime seam: every change lands in code that runs and is covered — the
rules' step and its worklist settlement, the protocol's strict schemas, the room's `setSpeed` path
that `setWalls` mirrors, the client model's replay test. The plan was written from reading that
code (`modes/cycles/{step,state,trail,bot,index,mode}.ts`, `room/{apply,state,recovery}.ts`,
`protocol/src/{client,server}.ts`, `client/cycles/model.ts`), so per `prototype-before-planning`
there is no scratch project; the tests of each task are the prototype.

---

## Decisions this plan makes that the spec left open

- **`heads` entries are eight numbers**, not seven: slot, head cell, direction, rubber, boost cooldown, energy, energy capacity, lit (1 or 0). Without `lit` a client cannot tell a freshly respawned bike in button mode (never lit) from one in always mode when it stalled at its spawn, and the scene needs "is the wall on right now" to dim the bike. `full` gains `energy`, `cap` and `lit` per bike.
- **A trail can have gaps now.** `full` still lists a bike's trail cells oldest first, but two consecutive cells are joined by a wall segment on the client only when they are neighbours.
- **Holding the key through a death does not light the wall at respawn**: a respawned bike is unlit, and lighting takes a fresh press, the same rule as after running empty.
- **No token bucket for the wall input.** A message only sets two booleans of one bike; repeating it changes nothing, and a toggle costs one bike copy.
- **Raw bidi characters in `packages/protocol/src/client.ts`** (the name filter's regex holds U+202A–U+202E and U+2066–U+2069 as raw characters) break CLAUDE.md's "no invisible characters in source"; they become escapes, and a test makes the rule executable.

---

## How to execute

- Branch `plan-10-cycles-walls` from `main` after plan 9 is merged.
- One task, one commit; Conventional Commits; English; **no attribution of any kind**.
- Before every commit: `pnpm format && pnpm check && pnpm typecheck && pnpm test`.
- Zones: tasks 0–3 `engine`; task 4 `ui`; task 5 `graphics`; task 6 `qa`; task 7 the main session. Run in order: each depends on the one before, except 5 and 6, which may run beside each other after 4.
- No load or stress experiments on the owner's machine.

---

### Task 0: Invisible characters are a test failure, not a paragraph (engine)

**Files:** `packages/protocol/src/client.ts`, a new test beside the purity test (`packages/game/test/source-text.test.ts`, which already reads files with `node:fs`).

- [ ] The test walks every git-tracked `*.ts`, `*.tsx`, `*.md`, `*.json`, `*.jsonc` file under `packages/`, `apps/game/src`, `apps/game/test`, `apps/game/e2e`, `docs/` and `.claude/` (`git ls-files` through `node:child_process`, or a directory walk that skips `node_modules` and `dist`) and fails, naming file and line, on any raw U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+007F, U+200B–U+200F, U+202A–U+202E, U+2066–U+2069 or U+FEFF. The test's own source writes every one of them as an escape.
- [ ] Watch it fail on `client.ts:21` today, then write the regex as `/[\p{Cc}‪-‮⁦-⁩]/u` and watch it pass; the protocol's name tests stay green.
- [ ] Commit: `test: fail the build on invisible characters in source`.

### Task 1: The light cycles' settings as one object, and `setWalls` (engine)

**Files:** `packages/game/src/modes/cycles/config.ts`, `packages/game/src/modes/index.ts`, `packages/game/src/modes/cycles/mode.ts`, `packages/game/src/room/{state,commands,apply,config,recovery}.ts`, `packages/protocol/src/{client,server,index}.ts`, `apps/game/src/worker/room.ts`, tests beside each.

```ts
// packages/game/src/modes/cycles/config.ts
export const WALL_MODES = ['always', 'button'] as const;
export type WallMode = (typeof WALL_MODES)[number];
/** The room's settings that only the light cycles read. */
export interface CyclesSettings { speed: Speed; walls: WallMode; }
export const DEFAULT_CYCLES_SETTINGS: CyclesSettings = { speed: DEFAULT_SPEED, walls: 'always' };
export function cyclesConfigFor(settings: CyclesSettings): CyclesConfig; // was (speed)
```

- [ ] `RoomState.speed` becomes `RoomState.settings: CyclesSettings` (the comment keeps its reason: it outlasts a trip through the clicker). Every `speed` parameter of the `Mode` interface becomes `settings: CyclesSettings`; the clicker ignores it as it ignored the speed. `configFor(mode, env, speed)` and `tickMsFor(speed)` keep taking the speed: the tick follows the speed alone.
- [ ] `CyclesConfig` gains `walls: WallMode`, `energyTicks` (capacity a life starts with: 4 s), `energyMaxTicks` (8 s), `energyKillTicks` (1 s), `energyRegenTicks` (2: ticks of riding without a wall that buy one unit back — 4 s spent, 8 s to refill). `cyclesConfigFor` converts the seconds with the speed, like the boost; `CYCLES_CONFIG` (20 cells a second) gets 80, 160, 20 and 2.
- [ ] Command `{ type: 'setWalls'; playerId; walls: WallMode }`, handled like `setSpeed`: lobby host only, `not_supported` outside the light cycles, `wrong_phase` in a round, no-op when unchanged.
- [ ] Recovery: a stored room with `speed` and no `settings` reads as `{ speed: stored.speed ?? DEFAULT_SPEED, walls: 'always' }`.
- [ ] Protocol: `setWallsSchema` (`walls: v.picklist(WALL_MODES)`), the cycles snapshot `data` gains `walls`, `PROTOCOL_VERSION` 3 with the reason in its comment (a strict version-2 client rejects the new field). The worker routes `setWalls`; its config still only changes with the mode or the speed.
- [ ] Tests: `setWalls` accepted from the host in the lobby and on results, refused from a guest, in a round and in the clicker; recovery of a speed-only stored room; the snapshot carries `walls`; a version-2 message gets `bad_version`; the worker routes `setWalls` (workerd).
- [ ] Commit: `feat(game): give the light cycles a walls setting beside the speed`.

### Task 2: Walls on a button in the rules (engine)

**Files:** `packages/game/src/modes/cycles/{state,trail,step,index,mode}.ts`, `packages/protocol/src/{client,server}.ts`, tests in `packages/game/test/cycles-walls.test.ts` (new) and the protocol tests.

State:

```ts
export type CyclesInput = { type: 'turn'; side: Turn } | { type: 'boost' } | { type: 'wall'; on: boolean };
// Bike gains:
/** The wall key as the player last reported it. */
held: boolean;
/** Laying a wall right now. Always true in `always` mode. */
lit: boolean;
energy: number;
/** Capacity in this life: grows with kills up to `energyMaxTicks`. */
energyCap: number;
/** Ticks without a wall counted towards the next unit of energy. */
energyRegen: number;
```

Rules (button mode; `always` mode keeps `lit` true and never reads the rest):

- [ ] `wall` input: ignored in `always` mode. `on` after not held → `held = true`, `lit = energy > 0` (and the bike is alive); `on` while held → nothing; `off` → `held = false`, `lit = false`.
- [ ] A lit bike that advances spends one unit per cell (per substep, so a boost spends twice as fast); at zero it goes unlit and stays so until the next fresh press.
- [ ] An unlit bike's energy comes back one unit per `energyRegenTicks` ticks alive, up to `energyCap`.
- [ ] **Vacating the head.** In `substep`, the cell a mover gives up is its oldest cell when it is lit and its trail is full (as now), and its **head cell** when it is unlit. An unlit mover that advances drops its newest trail cell instead of its oldest (`dropNewest` in `trail.ts`) and frees that cell, then pushes the new head as usual. The existing settlement — a bike aiming at a cell that is being vacated advances only if the vacating bike does — then covers following directly behind a wall-less bike.
- [ ] **No swapping.** A bike may not take a vacated head cell when the bike vacating it is aiming at the first bike's own head: two bikes face to face in neighbouring cells block each other and both stall, exactly as two walled bikes do now. Without it each would step into the cell the other left and pass through. In `blocked(i)`: when the target's vacating owner is still advancing, the target is free unless that owner vacates its head and aims at `i`'s head — a check that needs no second pass, because it does not depend on anyone's fate.
- [ ] Kill reward in button mode: `energyCap = min(energyMaxTicks, energyCap + energyKillTicks)` and `energy = min(energyCap, energy + energyKillTicks)`; the trail's cap does not grow. In always mode, +25 cells as now.
- [ ] `place` (spawn and respawn): `energy = energyCap = energyTicks`, `energyRegen = 0`, `lit = walls === 'always'`; `held` is left as it is.
- [ ] `TickChanges.heads` entries become eight numbers (see the decision above); `full` bikes gain `energy`, `cap`, `lit`; the protocol's `cyclesInputSchema` gains `{ type: 'wall', on: boolean }`; the delta schema's comment describes the eight.

Tests (each seen failing first):
- [ ] An unlit bike's previous cell is empty after it moves, and its trail did not grow.
- [ ] A lit bike spends one unit per cell; a boosting one two per tick; at zero it stops laying and holding the key does not relight it; releasing and pressing relights it once energy is back.
- [ ] Energy comes back at one unit per two ticks unlit, and not past the capacity.
- [ ] A kill in button mode grows the capacity by `energyKillTicks` up to `energyMaxTicks` and no further, and adds as much energy; a respawn resets both.
- [ ] Two unlit bikes face to face in neighbouring cells both stall; an unlit bike followed directly by another: both advance, nobody stalls.
- [ ] Always mode: the whole existing rule suite unchanged and green; a `wall` input changes nothing.
- [ ] Determinism: the replay test with random `wall` inputs in button mode gives bit-identical states.
- [ ] Commit: `feat(game): let light cycles lay their walls only while a key is held`.

### Task 3: Bots light their walls near a rival (engine)

**Files:** `packages/game/src/modes/cycles/bot.ts`, `step.ts`, `packages/game/test/cycles-complexity.test.ts`, `packages/game/test/bots.test.ts`.

- [ ] `wantsWall(field, side, bike, bikes, config): boolean` — false in always mode or without energy; otherwise true when a 9 × 9 window around the bot's head (clipped to the field) holds another living bike's head: a cell holding slot `s ≠ own` is a head when it equals `bikes[s - 1]`'s head. In the step, a bot's `lit` follows `wantsWall` each tick (bots have no key; the fresh-press rule is for people).
- [ ] Complexity: the number of field reads of one decision does not grow with the field (side 40 vs 400) or with the bikes (2 vs 20); use `counted` from `complexity.ts` on the field.
- [ ] Behaviour: a bot alone on the field never lights its wall; a bot with a rival's head inside the window does; a bot does not die more often in button mode than the always-mode gate allows (reuse the existing lone-bot gate).
- [ ] Commit: `feat(game): have bots light their walls when a rival is near`.

### Task 4: The client — model, input, HUD, settings (ui)

**Files:** `apps/game/src/client/cycles/{model,store,hud}.tsx?`, `screens/{cycles-arena,host-settings,lobby}.tsx`, `net.ts`, `app.tsx`, `strings.ts`, tests `apps/game/test/cycles-model.test.ts`.

Model:
- [ ] `Head` gains `energy`, `cap`, `lit` (from the eight-number entries and from `full`) and `drawn`: whether its cell carries a wall instance.
- [ ] Delta: a cell the bike left behind (the previous head, and the middle cell of a two-cell step) is drawn only if it is still the bike's after the delta — absent from `cells` or with its slot as final value (a `Map` from cell to final value, built once per delta). The head is put with `from` = the cell before it only if that cell is still the bike's; otherwise nothing is put and `drawn` is false. A previous head that was not drawn and is now kept (the bike lit up there) is put first with `from = -1`. A respawned bike is drawn only if `lit`.
- [ ] Full: consecutive trail cells are joined (`from` = the previous cell) only when they are neighbours; the head is drawn only if the cell before it is a neighbour.
- [ ] The replay property, extended: a recorded button-mode round produced by the real rules with bots (they toggle their walls) and random `wall` inputs for one rider: after every delta, every drawn cell is a real wall of its slot, and every real wall is drawn except possibly a bike's own head cell. Watch it fail against a model that ignores `cells` when laying.

Input and screens:
- [ ] W and ↑ held send `wall: true`, released `false`; `event.repeat` ignored; `blur` and `visibilitychange` to hidden send `false` if held. Only in button mode (`snapshot.data.walls`). The same listener as the turns, a plain `useEffect` (plan 9's review: a layout effect gains nothing in React 19.2).
- [ ] A hold button beside the boost in button mode (`data-testid="wall"`): pointer down → on, up, cancel or leave → off; `touch-action: none` so a held finger does not scroll.
- [ ] HUD: an energy bar beside the rubber, `data-testid="energy"`, `data-energy` and `data-cap` attributes, only in button mode. It subscribes to the model itself, as a leaf like `BoostButton`: the arena must not go back to re-rendering on every message (plan 9 took it from 274 renders in seven seconds to 4).
- [ ] Host settings: "Walls" with "Always" and "On a key" (`data-testid="walls-always"`, `"walls-button"`), in the lobby and on the results, like the speed; `net.setWalls`.
- [ ] "How to play" explains the key and the energy in button mode; every string in `strings.ts`.
- [ ] Commit: `feat(app): hold a key to lay a light-cycle wall`.

Verify visually: lobby with the setting, a button-mode round with the bar falling and refilling, 390 px wide.

### Task 5: A bike without its wall is drawn dimmer (graphics)

**Files:** `apps/game/src/client/scene/{cycles.tsx,look.ts}`.

- [ ] `DIM_LEVEL` in `look.ts`, below the bloom threshold, with the why. `drawBike` picks it when the head it is drawn towards is not `lit`.
- [ ] `walls.put` draws a box from `from` to `cell` whatever their distance (plan 9's review: a `from` four cells away drew a 7-cell bar). Task 4 makes the model pass `-1` for non-neighbours; the scene keeps a guard anyway — a `from` that is not a neighbour is treated as `-1` — with a test.
- [ ] Commit: `feat(app): dim a light cycle that is not laying its wall`.

Verify visually: a button-mode round, a lit and an unlit bike side by side.

### Task 6: End to end and in the room (qa)

- [ ] workerd: a host sets `walls: button`, a round starts, `wall: true` from the player reaches the rules (the next deltas show the bike's energy falling).
- [ ] Playwright, one browser: button mode, three bots, start; hold W for a second (`keyboard.down`, wait for `data-energy` to fall, `keyboard.up`), then see it rise; the results table appears.
- [ ] Commit: `test: play a light-cycle round with walls on a key`.

### Task 7: Look, document (main session)

- [ ] `verify-visually` of a button-mode round: dim and lit bikes, gaps in trails, the energy bar; at 20 participants.
- [ ] Spec: §3 of the design gets "Decisions made while building plan 10" (the eight-number heads, gaps in `full`, respawn needs a fresh press); the light-cycles spec's "Decisions" gain a pointer.
- [ ] README: the wall key under the controls, protocol version 3.
- [ ] Then `review-and-merge`.
