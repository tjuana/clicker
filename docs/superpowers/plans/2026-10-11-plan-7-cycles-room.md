# Light-Cycle Room, Tick and Protocol Implementation Plan (plan 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the light-cycle rules (plan 6) into the room: a mode interface, mode choice and bots in the lobby, a 20 Hz server tick, and `full` and `delta` messages. The clicker keeps working exactly as before.

**Architecture:** The room stops knowing about the clicker — it calls the mode through a `Mode` interface derived from the two implementations. A living mode declares `tickMs`; the Durable Object wakes itself with a timer, and a clock-driven accumulator decides how many steps are owed. Each step is a `step` command through the same `apply`; its changes go to everyone as a single `delta` string. A player who joins or comes back gets `full`.

**Tech Stack:** TypeScript 7.0.2, valibot (already in `packages/protocol`), partyserver 0.5.10, Vitest 4.1.11 with `@cloudflare/vitest-plugin` 1.1.8. No new dependencies.

Spec: [2026-10-10-light-cycles-design.md](../specs/2026-10-10-light-cycles-design.md), sections 5–7 and 9. Rules: [plan 6](2026-10-11-plan-6-cycles-rules.md), already in `main`.

---

## What was verified, and how this plan differs from plan 6

In plan 6 every line of code ran in a scratch copy first. This plan is deliberately different:

- **The risky seam has been run.** A tick inside a Durable Object at 15, 20 and 30 Hz was prototyped in local workerd and on real Cloudflare (plan 5, stage 2): 600 of 600 steps at 20 Hz, the production timer firing every 50 ms exactly. A clock-driven accumulator is required: locally the timer runs late, in production it sometimes fires early. The accumulator code in task 5 comes from that prototype.
- **The rest is wiring along existing patterns:** room commands, valibot schemas, integration tests in workerd. The plan gives **contracts** — types, schemas, signatures, the accumulator — and **the tests with their expected behaviour**. Function bodies are written test-first, and the main session verifies every task itself: diff, tests, mutations.

Decisions the spec did not make (task 7 records them there):

1. **The host chooses the mode in the lobby** with a `setMode` command, not when the room is created: rooms are created by a link, and carrying the mode through the URL is machinery for nothing. Changing the mode recreates the mode state and seats every player in it again.
2. **`full` carries trails as lists of cells**, not the field: twenty trails of 200 cells are about 24 KB, against 33 KB of mostly zeros for a 128×128 field. The client rebuilds the field itself.
3. **`delta` is minimal:** cells added, cells freed, events. A bike's head is the last cell added for its slot; its direction follows from its last two heads.
4. **No token bucket for the light cycles.** A queue of two turns and the boost cooldown already bound what input can change in the state.
5. **Only the light cycles have bots.** A bot would do nothing in the clicker; the command answers `not_supported` there.

## How to execute

- Branch `feat/cycles-room` from `main`.
- One task, one commit. Conventional Commits, English, **no Claude attribution**: no `Co-Authored-By`, no "Generated with", no emoji.
- Order inside each task: tests → red run → code → green run → checks → commit.
- Before every commit, from the repository root:

```bash
pnpm format && pnpm check && pnpm typecheck && pnpm test
```

- `pnpm typecheck` prints a lot of wrangler output — judge it by its exit code.
- `apps/game/src/client` changes only in task 6, and only so that the client compiles and the clicker works. The light-cycle client is plan 8.

## File structure

```
packages/game/src/
  modes/index.ts          NEW  ModeId, ModeState, ModeInput, the Mode interface, MODES, modeFor
  modes/clicker/mode.ts   NEW  the clicker behind Mode
  modes/cycles/mode.ts    NEW  the light cycles behind Mode
  room/state.ts           Player.bot; modeState: ModeState; ModeId moves to modes/index.ts
  room/commands.ts        setMode, addBot, removeBot, step; the stepped event; not_supported
  room/config.ts          MODE_CONFIG and configFor: what a mode changes about the room
  room/apply.ts           commands through modeFor(state.mode); the new commands
  room/advance.ts         through the interface; early end when no person is left in a live round
  room/recovery.ts        through the interface
  index.ts                exports
packages/protocol/src/
  client.ts               setMode, addBot, removeBot, resync; light-cycle input
  server.ts               mode cycles, players[].bot, mode data, full, delta, builders
apps/game/src/worker/room.ts   config per mode, the tick accumulator, delta, full
apps/game/wrangler.jsonc       ROUND_MS and COUNTDOWN_MS leave vars: the defaults live in code
apps/game/src/client/*         narrowing the mode data type only (task 6)
```

---

### Task 1: The mode interface, with the clicker behind it

Behaviour does not change: every existing test stays green without edits, other than imports of `ModeId`.

**Files:**
- Create: `packages/game/src/modes/index.ts`, `packages/game/src/modes/clicker/mode.ts`, `packages/game/src/modes/cycles/mode.ts`
- Modify: `packages/game/src/room/state.ts`, `apply.ts`, `advance.ts`, `recovery.ts`, `config.ts`, `packages/game/src/index.ts`
- Test: `packages/game/test/modes.test.ts`

Contract for `packages/game/src/modes/index.ts`:

```ts
import type { GameConfig } from '../room/config';
import { clickerMode } from './clicker/mode';
import type { ClickerInput, ClickerState } from './clicker/state';
import { cyclesMode } from './cycles/mode';
import type { CyclesInput, CyclesState } from './cycles/state';
import type { TickChanges } from './cycles/step';

export type ModeId = 'clicker' | 'cycles';
export type ModeState = ClickerState | CyclesState;
export type ModeInput = ClickerInput | CyclesInput;

/**
 * Everything the room asks of a game. Derived from two implementations, not designed ahead of
 * them: the clicker and the light cycles, which is the moment CLAUDE.md names for it.
 */
export interface Mode<S extends ModeState, I extends ModeInput> {
  create(seed: number): S;
  addPlayer(state: S, publicId: string, bot: boolean, now: number, config: GameConfig): S;
  removePlayers(state: S, publicIds: string[]): S;
  startRound(state: S, goAt: number, config: GameConfig): S;
  /** Foreign input — a click sent to the cycles — is ignored: the state comes back as it was. */
  applyInput(state: S, publicId: string, input: ModeInput, now: number, config: GameConfig): S;
  /** Only living modes have it; the room calls it once per tick while a round runs. */
  step: ((state: S) => { state: S; changes: TickChanges }) | null;
  /** A player gone mid-round. The clicker keeps the score; the cycles take the bike off the field. */
  abandon(state: S, publicId: string): S;
  finish(state: S, names: Record<string, string>): S;
  /** An interrupted round: nothing of it may be left on screen in the lobby. */
  clear(state: S): S;
  /** Whether bots can take part. */
  bots: boolean;
}

export const MODES = { clicker: clickerMode, cycles: cyclesMode } as const;

/**
 * The one place the mode's type is widened. `state.mode` and `state.modeState` always travel
 * together — `apply` never sets one without the other — but TypeScript cannot see that through
 * a spread, so the pairing is asserted here instead of at every call site.
 */
export function modeFor(id: ModeId): Mode<ModeState, ModeInput> {
  return MODES[id] as unknown as Mode<ModeState, ModeInput>;
}
```

Add to `packages/game/src/room/config.ts` (the `DEFAULT_CONFIG` defaults do not change):

```ts
/** What a mode changes about the room. Anything not named here comes from DEFAULT_CONFIG. */
export const MODE_CONFIG: Record<ModeId, Partial<GameConfig>> = {
  clicker: {},
  cycles: { tickMs: 50, roundMs: 180_000, maxPlayers: 20 },
};

export function configFor(mode: ModeId, base: GameConfig = DEFAULT_CONFIG): GameConfig {
  return { ...base, ...MODE_CONFIG[mode] };
}
```

`clickerMode` wraps the existing functions of `modes/clicker/index.ts` without changing their behaviour: `create` returns `createClickerState()` and ignores the seed; `addPlayer` ignores `bot`; `applyInput` lets only `{ type: 'click' }` through; `step: null`; `abandon` returns the state unchanged; `clear` is `clearScores`; `bots: false`.

`cyclesMode` wraps plan 6 with `CYCLES_CONFIG`: `create` is `createCyclesState(seed)`; `startRound` ignores `goAt` (light-cycle time is counted in ticks); `applyInput` lets only `turn` and `boost` through; `step` is `(state) => step(state, CYCLES_CONFIG)`; `abandon` is `leave`; `clear` returns a lobby: an empty field, no living bike, scores at zero, the players and their slots unchanged; `bots: true`.

In `room/state.ts`: `ModeId` is imported from `modes/index.ts`; `modeState: ModeState`; `createRoomState()` still creates a clicker.

In `room/apply.ts`, `advance.ts`, `recovery.ts`: `import * as mode from '../modes/clicker'` becomes `modeFor(state.mode)`.

Tests in `packages/game/test/modes.test.ts`:

- `modeFor('clicker')` and `modeFor('cycles')` are different modes; the clicker's `step` is `null`, the cycles' is a function.
- A click sent to the cycles, and a turn sent to the clicker, return **the same** state (`toBe`).
- `cyclesMode.clear` after some ticks: a field of zeros only, no living bike, `kills === 0` for everyone, the same slots and `publicId`s.
- `configFor('cycles').tickMs === 50`, `configFor('clicker').tickMs === null`.

- [ ] **Step 1:** write `modes.test.ts`; confirm it fails on the missing module.
- [ ] **Step 2:** implement the contract; move `room/*` onto `modeFor`.
- [ ] **Step 3:** `pnpm --filter @clicker/game test` — the previous 119 and the new tests all green.
- [ ] **Step 4:** checks; commit `refactor(game): put both modes behind one interface`.

---

### Task 2: Mode choice and bots in the lobby

**Files:**
- Modify: `packages/game/src/room/state.ts` (the `bot` field), `commands.ts`, `apply.ts`
- Test: `packages/game/test/mode-select.test.ts`, `packages/game/test/bots.test.ts`

Contract for `commands.ts` — new commands and an error code:

```ts
export type Command =
  | JoinCommand
  | { type: 'leave'; playerId: string; connectionId: string }
  | { type: 'start'; playerId: string }
  | InputCommand
  | { type: 'tick' }
  | { type: 'step' }
  | { type: 'setMode'; playerId: string; mode: ModeId }
  | { type: 'addBot'; playerId: string }
  | { type: 'removeBot'; playerId: string };

export type ErrorCode = 'not_joined' | 'not_host' | 'wrong_phase' | 'room_full' | 'not_supported';
```

`InputCommand.input` becomes `ModeInput`. `Player` gains `bot: boolean` (`false` for people).

Rules:
- `setMode`, `addBot` and `removeBot` are for the host only, and only in `lobby` or `results`; otherwise `not_host` / `wrong_phase`.
- `setMode`: `modeState = modeFor(mode).create(seed)` with `seed = now | 0`; every player is added to it again, in `publicId` order; `results` are cleared. Switching to a mode without bots **removes the bots** from the room. Choosing the mode already in play changes nothing (the same state).
- `addBot`: in a mode without bots — `not_supported`; at `maxPlayers` from `configFor(state.mode)` — `room_full`. A bot is a player with `playerId = 'bot-' + publicId`, the name `Bot N` (N counts bots from one), `bot: true`, `connectionIds: []`, `disconnectedAt: null`. Such a player never expires: `removeExpired` looks at `disconnectedAt`.
- `removeBot` removes the bot with the highest `publicId`; with no bots it changes nothing.
- `join` checks `maxPlayers` from `configFor(state.mode)`.

Tests:
- `mode-select.test.ts`: the host switches to `cycles` — `state.mode === 'cycles'` and every player is in `modeState.index`; a non-host gets `not_host`; during a round — `wrong_phase`; switching back to `clicker` removes the bots and zeroes the scores; choosing the same mode returns `toBe(state)`.
- `bots.test.ts`: a bot joins with `bot: true` and the name `Bot 1`, the next one `Bot 2`; in the clicker — `not_supported`; the twenty-first participant — `room_full`; `removeBot` removes the last; a bot is still there after `reconnectGraceMs` in the lobby (`tick` far in the future).

- [ ] **Step 1:** tests, red run. **Step 2:** implementation. **Step 3:** green run. **Step 4:** commit `feat(game): let the host pick the mode and seat bots`.

---

### Task 3: The living round — step, leaving, ending early

**Files:**
- Modify: `packages/game/src/room/commands.ts` (the event), `apply.ts`, `advance.ts`
- Test: `packages/game/test/step.test.ts`

Contract for the event:

```ts
export type GameEvent =
  | { type: 'welcome'; playerId: string; publicId: string; isHost: boolean }
  | { type: 'rejected'; playerId: string; code: ErrorCode }
  | { type: 'phaseChanged'; phase: Phase }
  | { type: 'stepped'; tick: number; changes: TickChanges };
```

Rules:
- `step` outside `running`, or in a mode without `step`, changes nothing and emits nothing. It is not an error: a timer can wake on the edge of a phase.
- `step` in `running` replaces `modeState` with the result of the mode's `step` and emits `stepped` with the tick number of the new state (`modeState.tick`) and the changes.
- `start` in the light cycles calls the mode's `startRound`, as it does for the clicker.
- A `leave` that leaves a player with no connections, during `running`, calls the mode's `abandon`. For the clicker that changes nothing — its behaviour stays as it was.
- `advance`: during `running` in a mode with `step`, if no person (`bot === false`) has a connection, the round ends at once — phase `results`, exactly as if time had run out. The clicker is not affected.
- `finish` receives the names of every player, bots included.

Tests in `step.test.ts` (a room in `cycles`, the host and two bots, the round started and moved into `running` by a `tick` after `goAt`):
- `step` emits exactly one `stepped`; `tick` grows by one per step; `changes.added` is not empty;
- `step` in the lobby, and in the clicker, returns the same state (`toBe`) and no events;
- the host disconnects mid-round: the next command moves the phase to `results`, because the host was the only person; with a second, connected person the round goes on, and the host's bike is no longer alive and owns no cells;
- a round played to `endsAt + lateGraceMs` ends in `results` that include the bots' rows under their names.

- [ ] **Steps 1–4** as above; commit `feat(game): step a living mode and end its round when the people leave`.

---

### Task 4: The protocol

**Files:**
- Modify: `packages/protocol/src/client.ts`, `packages/protocol/src/server.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/client.test.ts`, `packages/protocol/test/server.test.ts` (extend)

Contract for client messages (add to `client.ts`):

```ts
export const cyclesInputSchema = v.variant('type', [
  v.strictObject({ type: v.literal('turn'), side: v.picklist(['left', 'right']) }),
  v.strictObject({ type: v.literal('boost') }),
]);
// inputSchema.input becomes: v.union([clickerInputSchema, cyclesInputSchema])

export const setModeSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('setMode'),
  mode: v.picklist(['clicker', 'cycles']),
});
export const addBotSchema = v.strictObject({ v: versionSchema, type: v.literal('addBot') });
export const removeBotSchema = v.strictObject({ v: versionSchema, type: v.literal('removeBot') });
/** The client noticed a gap in tick numbers and asks for the whole state again. */
export const resyncSchema = v.strictObject({ v: versionSchema, type: v.literal('resync') });
```

Contract for server messages (`server.ts`):

```ts
/** A full round is far bigger than a snapshot: twenty trails of up to 400 cells. */
export const MAX_SERVER_MESSAGE_BYTES = 128 * 1024;

// modeSchema: v.picklist(['clicker', 'cycles'])
// errorCodeSchema: + 'not_supported'
// players[]: + bot: v.boolean()

export const cyclesDataSchema = v.strictObject({
  results: v.nullable(
    v.array(
      v.strictObject({
        id: v.string(),
        name: v.string(),
        kills: v.number(),
        deaths: v.number(),
        longest: v.number(),
        rank: v.number(),
      }),
    ),
  ),
});
// snapshotSchema.data: v.union([clickerDataSchema, cyclesDataSchema])

const eventSchema = v.variant('type', [
  v.strictObject({ type: v.literal('died'), slot: v.number(), by: v.nullable(v.number()) }),
  v.strictObject({ type: v.literal('respawned'), slot: v.number() }),
  v.strictObject({ type: v.literal('boost'), slot: v.number() }),
]);

/** Everything about the round right now. Sent on joining, on rejoining and on request. */
export const fullSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('full'),
  tick: v.number(),
  side: v.number(),
  bikes: v.array(
    v.strictObject({
      slot: v.number(),
      id: v.string(),
      alive: v.boolean(),
      dir: v.number(),
      /** Oldest first; the head is the last cell. Empty for a dead bike. */
      trail: v.array(v.number()),
      kills: v.number(),
      deaths: v.number(),
      rubber: v.number(),
      boost: v.number(),
      cooldown: v.number(),
      respawnIn: v.number(),
    }),
  ),
});

/** One tick, the same string for everyone. */
export const deltaSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('delta'),
  t: v.number(),
  added: v.array(v.number()),
  freed: v.array(v.number()),
  events: v.array(eventSchema),
});
```

Builders in `server.ts`: `toFull(state: RoomState): FullMessage | null` — `null` when the mode is not the light cycles or there is no field yet (`side === 0`); `toDelta(tick: number, changes: TickChanges): DeltaMessage`. `toSnapshot` puts in `data` whatever the mode provides (the clicker's `toData`, or `{ results }` of the light cycles in the `cyclesDataSchema` shape) and adds `bot` to the player list. The secret `playerId` and `hostKey` reach no message.

Tests:
- `client.test.ts`: `setMode`, `addBot`, `removeBot`, `resync`, and `turn` and `boost` input are accepted; `turn` with `side: 'up'`, `setMode` with an unknown mode, and an extra field in `boost` are rejected.
- `server.test.ts`: `toFull` for a light-cycle room of 20 bots after 400 steps passes `parseServerMessage` and stays under `MAX_SERVER_MESSAGE_BYTES`; a trail in `full` runs from its oldest cell to the head; `toFull` for the clicker is `null`; `toDelta` passes the parser; neither `toSnapshot` nor `toFull` contains any `playerId` (`JSON.stringify(...).includes(playerId) === false`).

- [ ] **Steps 1–4**; commit `feat(protocol): describe mode choice, bots and the living round on the wire`.

---

### Task 5: The server — tick, deltas, full state

**Files:**
- Modify: `apps/game/src/worker/room.ts`, `apps/game/wrangler.jsonc`
- Test: `apps/game/test/cycles.test.ts` (new, integration in workerd)

Config: `this.#config` is `configFor(state.mode, base)`, where `base` is `DEFAULT_CONFIG` with the overrides from the environment (`COUNTDOWN_MS`, `ROUND_MS`); it is recomputed when the mode changes. Remove the `COUNTDOWN_MS` and `ROUND_MS` `vars` from `wrangler.jsonc`: otherwise the clicker's ten production seconds would become the length of a light-cycle round. The test bindings in `vitest.config.ts` stay.

The tick accumulator (from the prototype, plan 5 stage 2):

```ts
/** A stall longer than this is skipped, not replayed in one burst (Armagetron bug #321694). */
const MAX_CATCH_UP = 10;

#ticker: ReturnType<typeof setInterval> | null = null;
#nextStepAt = 0;

/** Runs while a living mode's round runs, and only then: an idle room must be free to sleep. */
#syncTicker(): void {
  const tickMs = this.#config.tickMs;
  const live = tickMs !== null && this.#state.phase === 'running';
  if (live && this.#ticker === null) {
    this.#nextStepAt = Date.now() + tickMs;
    // The timer only wakes the room; the clock decides how many steps are owed. Locally the
    // timer runs late, in production it sometimes fires early — both measured.
    this.#ticker = setInterval(() => this.#catchUp(), tickMs);
    return;
  }
  if (!live && this.#ticker !== null) {
    clearInterval(this.#ticker);
    this.#ticker = null;
  }
}

#catchUp(): void {
  const tickMs = this.#config.tickMs;
  if (tickMs === null) return;
  const now = Date.now();
  if (now < this.#nextStepAt) return;
  let owed = Math.floor((now - this.#nextStepAt) / tickMs) + 1;
  if (owed > MAX_CATCH_UP) {
    this.#nextStepAt += (owed - MAX_CATCH_UP) * tickMs;
    owed = MAX_CATCH_UP;
  }
  for (let i = 0; i < owed && this.#state.phase === 'running'; i += 1) {
    this.#step(now);
    this.#nextStepAt += tickMs;
  }
}
```

The arithmetic of `#catchUp` is extracted into a pure, exported function `owedSteps(now, nextStepAt, tickMs, max): { owed: number; nextStepAt: number }` with its own unit test in `apps/game/test/ticker.test.ts`: no step before the deadline; one step on it; three steps after a pause of three periods; `max` steps and a skipped remainder after a long stall. Workerd offers no fake clock, so this is the only way to test the accumulator itself.

`#step(now)` is a synchronous path: `apply(state, { type: 'step' }, now, config)`; each `stepped` event goes to everyone through `broadcast(JSON.stringify(toDelta(...)))` — the string is built once per room. If a step changed the phase (the round ended), the ordinary path follows: persist, alarm, snapshot. **Nothing is written to storage per step.**

The rest of `room.ts`:
- `#syncTicker()` is called wherever `#syncSnapshotTimer()` is called now. The 10 Hz snapshot timer stays only for a mode without `tickMs`; in the light cycles a snapshot goes out only on room changes and phase changes.
- After `welcome` during a live light-cycle round, the connection receives `toFull(state)`; on `resync` too.
- The client messages `setMode`, `addBot` and `removeBot` become the commands of the same names, with `playerId` from the session.

Integration tests in `apps/game/test/cycles.test.ts` (in tests `ROUND_MS` is 200 and `COUNTDOWN_MS` is 50):
- the host switches the mode and adds three bots; the snapshot shows `mode: 'cycles'` and players with `bot: true`;
- after `start`, `delta` messages arrive and their `t` runs on without gaps for one client;
- a second player joining mid-round receives `full` right after `welcome`, with the bikes of every participant;
- `resync` returns `full`;
- the round ends with a `results` snapshot carrying light-cycle data, after which no `delta` arrives (wait 300 ms and check no new one did);
- nothing is written to storage per step: count `storage.put` calls through `runInDurableObject` around ten steps;
- every existing test in `room.test.ts` and `lifecycle.test.ts` still passes.

- [ ] **Steps 1–4**; commit `feat(app): tick the light-cycle round in the room and stream it`.

---

### Task 6: The client compiles and the clicker works

**Files:**
- Modify: `apps/game/src/client/hud.tsx`, `standings.tsx`, `screens/arena.tsx`, `screens/results.tsx`, `net.ts`

Type narrowing only: the mode data in a snapshot is now a union. The clicker's screens read `snapshot.data` after checking `snapshot.mode === 'clicker'` (a small helper such as `clickerData(snapshot)` that returns the clicker's data or empty data). `net.ts` ignores `full` and `delta` — plan 8 handles them. The clicker behaves exactly as before: its end-to-end tests and `pnpm --filter @clicker/app test` pass.

- [ ] **Step 1:** `pnpm typecheck` shows errors in these files. **Step 2:** narrow. **Step 3:** checks. **Step 4:** commit `refactor(app): read the clicker's data only when the room plays the clicker`.

---

### Task 7: Bring the spec up to date

**Files:**
- Modify: `docs/superpowers/specs/2026-10-10-light-cycles-design.md`

Record in sections 5–6 the five decisions at the top of this plan (mode chosen in the lobby, trails in `full`, a minimal `delta`, no token bucket for the light cycles, bots only in the light cycles), and that `wrangler.jsonc` no longer sets the round length. The spec was written in Russian; the additions are in English, under a heading `Decisions made while building plan 7`. Commit `docs: record how the light-cycle room diverged from the spec`.

---

## Verifying the whole plan

1. `pnpm format && pnpm check && pnpm typecheck && pnpm test` — green in every package.
2. Mutations that must be caught (the main session checks them after tasks 3 and 5):
   - `step` runs outside `running` → «`step` in the lobby returns the same state» fails;
   - no early end → the test with the only person leaving fails;
   - one step per wake-up instead of the owed number → the `owedSteps` unit test fails;
   - a storage write per step → the `storage.put` count test fails.
3. Then the `review-and-merge` skill: independent review, verified fixes, a `--no-ff` merge with a description.
