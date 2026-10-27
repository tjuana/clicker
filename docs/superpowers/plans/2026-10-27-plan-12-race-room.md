# Ring Race Room and Protocol Implementation Plan (plan 12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A room can run the ring race: the host picks it, seats bots, starts; the Durable Object ticks it at 30 Hz, streams one `full` and a `delta` a tick, takes the players' key masks, and ends the round itself when the race is over. The race is not on screen yet (plan 13); a room in race mode shows a placeholder.

**Architecture:** The race joins the mode unions (`ModeId`, `ModeState`, `ModeInput`, the changes of a tick), and the `Mode` interface gets its constraints back. A mode may say its round is over (`over`), checked where the room already ends a deserted round. `full` and `delta` become variants on `mode`, like the snapshot; the protocol goes to version 4.

**Tech Stack:** TypeScript, valibot, Vitest (node and workerd), partyserver 0.5.10.

Spec: [ring race design](../specs/2026-10-26-ring-race-design.md), §4 and §6, and "Decisions made while building plan 11".

---

## What was verified before this plan

No new library or runtime seam. Plan 5 measured a 30 Hz tick on real Cloudflare (900 of 900 steps,
33 ms intervals) and the accumulator that drives it already runs the light cycles. The race rules
(plan 11) are pure and tested; this plan wires them where the light cycles are wired. The one
number nobody has measured is the size of a race delta: Task 3 measures it in a test and records it.

---

## How to execute

- Branch `plan-12-race-room` from `main` after plan 11 is merged.
- One task, one commit; Conventional Commits; English; **no attribution of any kind**.
- Before every commit: `pnpm format && pnpm check && pnpm typecheck && pnpm test`.
- Zones: tasks 1–4 `engine`, task 5 `ui`, task 6 `qa`, task 7 the main session.

---

### Task 1: The race joins the modes (engine)

**Files:** `packages/game/src/modes/index.ts`, `packages/game/src/room/{commands,apply,config,state}.ts`, `packages/game/src/index.ts`, tests.

- [ ] `ModeId` gains `'race'`; `ModeState` gains `RaceState`; `ModeInput` gains `RaceInput`; `MODES.race = raceMode`.
- [ ] The `Mode` interface gets its constraints back (`S extends ModeState`, `_I extends ModeInput`), and the changes of a tick become a union the room carries without looking inside: the `stepped` event carries `{ mode, changes }` so a reader can narrow on `mode`.
- [ ] **Acceptance, from plan 11's review (finding 3):** the reviewer added `'race'` to the unions, `race: raceMode` to `MODES` and `race: {}` to `MODE_CONFIG`, and `tsc` passed for the rules and the worker — the default changes type and the double cast in `modeFor` hid that the worker would broadcast a delta with `cells`, `heads` and `events` all undefined. After this task, the same registration without the worker and `toDelta` narrowing on `mode` must be a type error: add a `ModeChanges = TickChanges | RaceChanges` union, have `modeFor` return `Mode<ModeState, ModeInput, ModeChanges>` (or make it generic over the id), and type the `stepped` event's changes as `ModeChanges`. Show the type error once with the narrowing removed.
- [ ] `MODE_CONFIG.race = { roundMs: 300_000, maxPlayers: 20, tickMs: 1000 / 30 }` — the round's length is the race's cap; the race ends itself before it (Task 2).
- [ ] Tests: `setMode` to the race reseats everyone as cars; bots can be added and removed; a started race places the grid; a step in a running race advances its tick; the clicker and the light cycles are unchanged (their suites).
- [ ] Commit: `feat(game): let a room run the ring race`.

### Task 2: A mode can end its own round (engine)

**Files:** `packages/game/src/modes/index.ts`, `packages/game/src/room/advance.ts`, tests.

- [ ] `Mode` gains `over(state): boolean`; the clicker and the light cycles answer `false`; the race answers its rules' `over` (every car finished, 30 s after the first finisher, or the cap).
- [ ] `advance` ends a running round when the mode says it is over, exactly where it ends a deserted one, and the results follow as for any ended round.
- [ ] Tests: a race whose cars have all finished moves to results at the next command or alarm; a race with one finisher moves 30 s of ticks later; a light-cycle round never ends early this way.
- [ ] Commit: `feat(game): let a mode say its round is over`.

### Task 3: Protocol version 4 (engine)

**Files:** `packages/protocol/src/{client,server,index}.ts`, tests.

- [ ] Client: `raceInputSchema = { type: 'keys', mask: integer 0…15 }` in the input union; `setMode` accepts `'race'`.
- [ ] Server: the snapshot's `data` variant gains `race` (results rows: rank, name, laps, best lap, finish tick or distance short). `full` and `delta` become variants on `mode`: the light cycles' as today plus `mode: 'cycles'`; the race's `full` carries `tick`, `tickMs`, `track`, `laps` and every car (`slot`, `id`, `bot`, `x`, `y`, `heading`, `speed`, `lap`, `finish`); its `delta` carries `t`, `cars` as flat 7-tuples (slot, x, y, heading, speed, lap, flags — bit 0 finished, bit 1 on grass, bit 2 touching a wall) and the tick's events (`lap`, `finished`, `bump`). `toFull`/`toDelta` take the mode from the state.
- [ ] `PROTOCOL_VERSION` 4, with the reason in its comment.
- [ ] Test: strictness (unknown fields, a mask of 16, a `full` without `mode`); a version-3 message answered `bad_version`; and **the size of a race delta** for twenty cars at speed, measured and written into the test's comment and the spec (plan 5's A14: binary only after measuring).
- [ ] Commit: `feat(protocol): carry the ring race on the wire (version 4)`.

### Task 4: The worker runs the race (engine)

**Files:** `apps/game/src/worker/room.ts`, `apps/game/test/race.test.ts` (new, workerd).

- [ ] The worker routes the race's input and sends its `full` on join, on resync and at the start of a round, and its `delta` every step — one string for the room, as for the light cycles. Nothing in the worker knows what a car is.
- [ ] Tests in workerd: a race room ticks at its pace with consecutive `t`; a player's key mask reaches its car (its speed rises under gas in the next deltas); a round where everyone finishes ends with results before the cap (a short race through the test bindings — see how the light-cycle tests shorten their round); a join mid-race gets a `full`.
- [ ] Commit: `feat(app): run the ring race in the room server`.

### Task 5: The client survives a race room (ui)

**Files:** `apps/game/src/client/{app.tsx,net.ts,strings.ts}`, the screens that switch on the mode.

- [ ] The client parses version 4. A room in race mode shows the lobby as usual (host settings: the mode list stays clicker and light cycles until plan 13 adds the race), and a running race shows a placeholder line ("The ring race is coming") instead of an arena; race `full`/`delta` messages are accepted and ignored.
- [ ] Commit: `feat(app): keep the client steady in a race room`.

### Task 6: End to end (qa) — dropped

A whole three-lap race takes over a minute of real time in workerd, and the worker knows nothing
about laps, so there is no honest way to shorten it there. The "everyone finished" end is tested on
the rules (Task 2), the clock end and the rest in workerd (Task 4); plan 13's end-to-end test races
in a browser. What was planned:


- [ ] workerd: twenty-car race room with nineteen bots and one player who sends gas; it finishes and every result row is present. Playwright is not needed until plan 13.
- [ ] Commit: `test: run a whole ring race through the room`.

### Task 7: Document (main session)

- [ ] Design: "Decisions made while building plan 12" (the wire shapes, the measured delta size, `over`).
- [ ] README: protocol version 4; the race in the status table.
- [ ] Then `review-and-merge`.
