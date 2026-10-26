# Platform Seams Implementation Plan (plan 4: one base, many games)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the shared room from the concrete game so that a second mode — a reaction test, a snake, anything — can be added without breaking either the protocol or the client.

**Architecture:** `packages/game` is split into `room/` (players, host, phases, time, deadlines) and `modes/clicker/` (input, token bucket, results). The room calls the mode through a single entry point and does not know the word "click". The protocol gets a version, a generic `input`, a `data` slot for the mode's data and a separate private message. There is no mode registry and there will not be one until a second mode appears: the interface is derived from two implementations, not from one.

**Tech Stack:** no new dependencies. TypeScript 7.0.2, Vitest 4.1.11, valibot 1.5.0.

Spec: [2026-09-11-clicker-foundation-design.md](../specs/2026-09-11-clicker-foundation-design.md), sections 3, 5, 6, 7.

---

## Verified before writing the plan

Tasks 1–3 were built and run in full in a temporary folder: `tsc --noEmit` with no errors, 60 tests in `packages/game`, 32 in `packages/protocol` (31 carried over plus a new one for the version), Biome clean. All the code of these tasks is given below verbatim from the working prototype.

Two findings from it, both of which would have been expensive:

1. **Reference equality of the state is a contract, not an accident.** A click refused by the limit must return the very same room object: the cheap check "nothing changed, no need to broadcast a snapshot" rests on it. The first version of the move lost it, and a ported test caught that.
2. **The key of the mode's data is `publicId`, not the secret `playerId`.** Otherwise the score would have to be re-keyed every time a snapshot is built, and the secret would have to be dragged through a layer that does not need it.

**What the prototype did not check:** tasks 4 and 5 — the server and the client. Their code is derived from what was verified, but has not been run. The gate for them is the 15 integration tests of the server in the real Workers runtime and the client build.

## How to execute

- Branch `feat/platform-seams`.
- One task, one commit. Conventional Commits, English, **no Claude signatures**.
- Before each commit: `pnpm format`, then `pnpm check`, `pnpm typecheck`, `pnpm test`.
- Tasks 1–3 go one after another: between them the repository does not build, and that is fine — they are one move, split up to keep it readable. Everything turns green at the end of task 3.

---

### Task 1: Split the rules into a room and a mode

**Files:**
- Create: `packages/game/src/room/{state,commands,config,advance,apply,deadline,recovery}.ts`, `packages/game/src/modes/clicker/{state,results,index}.ts`
- Delete: `packages/game/src/{state,commands,config,advance,apply,deadline,recovery,results}.ts`
- Modify: `packages/game/src/index.ts`

- [ ] **Step 1: Create `packages/game/src/modes/clicker/state.ts`**

```ts
/** What the clicker counts for one player. Keyed by publicId, like everything the mode shows. */
export interface ClickerScore {
  clicks: number;
  /** Time of the last counted click: it breaks ties. */
  lastCountedAt: number | null;
  bucket: { tokens: number; updatedAt: number };
}

export interface ResultRow {
  publicId: string;
  name: string;
  clicks: number;
  rank: number;
}

export interface ClickerState {
  scores: Record<string, ClickerScore>;
  results: ResultRow[] | null;
}

/** The clicker's own input. Pressing the button is the whole of it. */
export type ClickerInput = { type: 'click' };

export function createClickerState(): ClickerState {
  return { scores: {}, results: null };
}

export function emptyScore(now: number, burst: number): ClickerScore {
  return { clicks: 0, lastCountedAt: null, bucket: { tokens: burst, updatedAt: now } };
}
```

- [ ] **Step 2: Create `packages/game/src/modes/clicker/results.ts`**

```ts
import type { ClickerScore, ResultRow } from './state';

/** Public ids are decimal strings, so they compare as numbers. */
export function comparePublicIds(a: string, b: string): number {
  return Number(a) - Number(b);
}

/**
 * More clicks wins. On a tie the player who reached that score first wins.
 * A full tie falls back to publicId so the order is predictable.
 */
function compare(a: ResultRow, b: ResultRow, scores: Record<string, ClickerScore>): number {
  if (a.clicks !== b.clicks) return b.clicks - a.clicks;
  const aTime = scores[a.publicId]?.lastCountedAt ?? Number.POSITIVE_INFINITY;
  const bTime = scores[b.publicId]?.lastCountedAt ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return comparePublicIds(a.publicId, b.publicId);
}

/** `names` maps publicId to the player's name: the room owns names, the mode owns scores. */
export function computeResults(
  scores: Record<string, ClickerScore>,
  names: Record<string, string>,
): ResultRow[] {
  return Object.entries(scores)
    .map(([publicId, score]) => ({
      publicId,
      name: names[publicId] ?? '',
      clicks: score.clicks,
      rank: 0,
    }))
    .sort((a, b) => compare(a, b, scores))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
```

- [ ] **Step 3: Create `packages/game/src/room/config.ts`**

```ts
export interface GameConfig {
  /** Countdown before the round. */
  countdownMs: number;
  /** Round length. */
  roundMs: number;
  /** How long clicks are still accepted after the round ends: slack for network delay. */
  lateGraceMs: number;
  /** Token bucket refill rate. */
  clicksPerSecond: number;
  /** Token bucket capacity. */
  burst: number;
  /** How long a disconnected player stays in the list. */
  reconnectGraceMs: number;
  /** Maximum players in a room. */
  maxPlayers: number;
  /**
   * How often the room advances time on its own during a round.
   * `null` — only commands and the alarm move it: that is the clicker, it has nowhere to move.
   * A number — the simulation step in milliseconds: a snake has to keep crawling while nobody types.
   */
  tickMs: number | null;
}

export const DEFAULT_CONFIG: GameConfig = {
  countdownMs: 3000,
  roundMs: 10000,
  lateGraceMs: 250,
  clicksPerSecond: 15,
  burst: 15,
  reconnectGraceMs: 30000,
  maxPlayers: 50,
  tickMs: null,
};
```

- [ ] **Step 4: Create `packages/game/src/room/state.ts`**

```ts
import type { ClickerState } from '../modes/clicker/state';
import { createClickerState } from '../modes/clicker/state';

export type Phase = 'lobby' | 'countdown' | 'running' | 'results';

export type Notice = 'round_aborted';

/** Only one mode exists today; the union is where the next one is added. */
export type ModeId = 'clicker';

/** Generic room player. Nothing about a specific game belongs here. */
export interface Player {
  /** Public identifier: this is the only one clients ever see. */
  publicId: string;
  name: string;
  /** Ids of the open connections of this player. */
  connectionIds: string[];
  disconnectedAt: number | null;
}

export interface Round {
  goAt: number;
  endsAt: number;
}

export interface RoomState {
  /** Chosen when the room is created and never changes afterwards. */
  mode: ModeId;
  phase: Phase;
  hostKey: string | null;
  /** playerIds of the hosts. */
  hosts: string[];
  /** Keyed by the secret playerId. */
  players: Record<string, Player>;
  nextSeq: number;
  round: Round | null;
  notice: Notice | null;
  /** Everything only the mode knows: scores, results, its own timers. */
  modeState: ClickerState;
}

export function createRoomState(): RoomState {
  return {
    mode: 'clicker',
    phase: 'lobby',
    hostKey: null,
    hosts: [],
    players: {},
    nextSeq: 1,
    round: null,
    notice: null,
    modeState: createClickerState(),
  };
}
```

- [ ] **Step 5: Create `packages/game/src/room/commands.ts`**

```ts
import type { ClickerInput } from '../modes/clicker/state';
import type { Phase } from './state';

export interface JoinCommand {
  type: 'join';
  playerId: string;
  connectionId: string;
  name: string;
  hostKey?: string;
}

/** The mode decides what an input means; the room only routes it. */
export interface InputCommand {
  type: 'input';
  playerId: string;
  input: ClickerInput;
}

export type Command =
  | JoinCommand
  | { type: 'leave'; playerId: string; connectionId: string }
  | { type: 'start'; playerId: string }
  | InputCommand
  | { type: 'tick' };

export type ErrorCode = 'not_joined' | 'not_host' | 'wrong_phase' | 'room_full';

export type GameEvent =
  | { type: 'welcome'; playerId: string; publicId: string; isHost: boolean }
  | { type: 'rejected'; playerId: string; code: ErrorCode }
  | { type: 'phaseChanged'; phase: Phase };
```

- [ ] **Step 6: Create `packages/game/src/modes/clicker/index.ts`** — the single door between the room and the game

```ts
import type { GameConfig } from '../../room/config';
import { computeResults } from './results';
import { type ClickerInput, type ClickerState, emptyScore } from './state';

export { comparePublicIds, computeResults } from './results';
export {
  type ClickerInput,
  type ClickerScore,
  type ClickerState,
  createClickerState,
  type ResultRow,
} from './state';

/**
 * The single door between the room and this game.
 * The room calls these and knows nothing else about clicking; when a second mode
 * appears, this shape is what becomes an interface — derived from two implementations, not one.
 */

export function addPlayer(
  state: ClickerState,
  publicId: string,
  now: number,
  config: GameConfig,
): ClickerState {
  return { ...state, scores: { ...state.scores, [publicId]: emptyScore(now, config.burst) } };
}

export function removePlayers(state: ClickerState, publicIds: string[]): ClickerState {
  if (publicIds.length === 0) return state;
  const scores = { ...state.scores };
  for (const publicId of publicIds) delete scores[publicId];
  return { ...state, scores };
}

/** A new round wipes the scores: the previous one must not leak into it. */
export function startRound(state: ClickerState, goAt: number, config: GameConfig): ClickerState {
  const scores: ClickerState['scores'] = {};
  for (const publicId of Object.keys(state.scores)) {
    scores[publicId] = emptyScore(goAt, config.burst);
  }
  return { scores, results: null };
}

export function applyInput(
  state: ClickerState,
  publicId: string,
  _input: ClickerInput,
  now: number,
  config: GameConfig,
): ClickerState {
  const score = state.scores[publicId];
  if (score === undefined) return state;

  const elapsed = Math.max(0, now - score.bucket.updatedAt);
  const tokens = Math.min(
    config.burst,
    score.bucket.tokens + (elapsed * config.clicksPerSecond) / 1000,
  );
  // Not enough tokens: change nothing at all, so a stale timestamp cannot rewind the anchor.
  if (tokens < 1) return state;

  return {
    ...state,
    scores: {
      ...state.scores,
      [publicId]: {
        clicks: score.clicks + 1,
        lastCountedAt: now,
        bucket: { tokens: tokens - 1, updatedAt: Math.max(score.bucket.updatedAt, now) },
      },
    },
  };
}

/** `names` maps publicId to the player's name: the room owns names, the mode owns scores. */
export function finish(state: ClickerState, names: Record<string, string>): ClickerState {
  return { ...state, results: computeResults(state.scores, names) };
}

/** An interrupted round leaves no score behind: the lobby must not show it. */
export function clearScores(state: ClickerState): ClickerState {
  const scores: ClickerState['scores'] = {};
  for (const [publicId, score] of Object.entries(state.scores)) {
    scores[publicId] = { ...score, clicks: 0, lastCountedAt: null };
  }
  return { ...state, scores };
}

/** The mode's slot in the snapshot. Only public ids and numbers leave this function. */
export function toData(state: ClickerState): {
  scores: Record<string, number>;
  results: { id: string; name: string; clicks: number; rank: number }[] | null;
} {
  const scores: Record<string, number> = {};
  for (const [publicId, score] of Object.entries(state.scores)) scores[publicId] = score.clicks;

  return {
    scores,
    results:
      state.results === null
        ? null
        : state.results.map((row) => ({
            id: row.publicId,
            name: row.name,
            clicks: row.clicks,
            rank: row.rank,
          })),
  };
}
```

- [ ] **Step 7: Create `packages/game/src/room/advance.ts`**

```ts
import * as mode from '../modes/clicker';
import type { GameConfig } from './config';
import type { Phase, RoomState } from './state';

export interface AdvanceResult {
  state: RoomState;
  /** Phases entered, in order. */
  phases: Phase[];
}

/** publicId → name, the only thing the mode needs from the room to build results. */
function names(state: RoomState): Record<string, string> {
  const result: Record<string, string> = {};
  for (const player of Object.values(state.players)) result[player.publicId] = player.name;
  return result;
}

/**
 * Moves the state through time. Runs before every command, so the rules do not
 * depend on the alarm being punctual.
 */
export function advance(state: RoomState, now: number, config: GameConfig): AdvanceResult {
  let next = state;
  const phases: Phase[] = [];

  for (;;) {
    if (next.phase === 'countdown' && next.round !== null && now >= next.round.goAt) {
      next = { ...next, phase: 'running' };
      phases.push('running');
      continue;
    }
    if (
      next.phase === 'running' &&
      next.round !== null &&
      now >= next.round.endsAt + config.lateGraceMs
    ) {
      next = {
        ...next,
        phase: 'results',
        round: null,
        modeState: mode.finish(next.modeState, names(next)),
      };
      phases.push('results');
      continue;
    }
    break;
  }

  return { state: removeExpired(next, now, config), phases };
}

/** Disconnected players are dropped outside a round only: their score matters while it runs. */
function removeExpired(state: RoomState, now: number, config: GameConfig): RoomState {
  if (state.phase !== 'lobby' && state.phase !== 'results') return state;

  const expired = Object.entries(state.players)
    .filter(
      ([, player]) =>
        player.connectionIds.length === 0 &&
        player.disconnectedAt !== null &&
        player.disconnectedAt + config.reconnectGraceMs <= now,
    )
    .map(([playerId]) => playerId);

  if (expired.length === 0) return state;

  const players = { ...state.players };
  const publicIds: string[] = [];
  for (const playerId of expired) {
    const player = players[playerId];
    if (player !== undefined) publicIds.push(player.publicId);
    delete players[playerId];
  }

  return {
    ...state,
    players,
    hosts: state.hosts.filter((playerId) => !expired.includes(playerId)),
    modeState: mode.removePlayers(state.modeState, publicIds),
  };
}
```

- [ ] **Step 8: Create `packages/game/src/room/apply.ts`**

Note the end of `input`: when a click is refused, the same state object is returned. This is a contract, not a detail.

```ts
import * as mode from '../modes/clicker';
import { advance } from './advance';
import type { Command, ErrorCode, GameEvent, InputCommand, JoinCommand } from './commands';
import { DEFAULT_CONFIG, type GameConfig } from './config';
import type { Player, RoomState } from './state';

export interface ApplyResult {
  state: RoomState;
  events: GameEvent[];
}

/**
 * The only place the room state changes.
 * The input state is never mutated and time always arrives as a parameter.
 */
export function apply(
  state: RoomState,
  command: Command,
  now: number,
  config: GameConfig = DEFAULT_CONFIG,
): ApplyResult {
  const advanced = advance(state, now, config);
  const phaseEvents: GameEvent[] = advanced.phases.map((phase) => ({
    type: 'phaseChanged',
    phase,
  }));
  const handled = handle(advanced.state, command, now, config);
  return { state: handled.state, events: [...phaseEvents, ...handled.events] };
}

function handle(state: RoomState, command: Command, now: number, config: GameConfig): ApplyResult {
  switch (command.type) {
    case 'tick':
      return { state, events: [] };
    case 'join':
      return join(state, command, now, config);
    case 'leave':
      return leave(state, command.playerId, command.connectionId, now);
    case 'start':
      return start(state, command.playerId, now, config);
    case 'input':
      return input(state, command, now, config);
  }
}

function reject(state: RoomState, playerId: string, code: ErrorCode): ApplyResult {
  return { state, events: [{ type: 'rejected', playerId, code }] };
}

function withPlayer(state: RoomState, playerId: string, player: Player): RoomState {
  return { ...state, players: { ...state.players, [playerId]: player } };
}

function join(
  state: RoomState,
  command: JoinCommand,
  now: number,
  config: GameConfig,
): ApplyResult {
  const existing = state.players[command.playerId];
  let nextSeq = state.nextSeq;
  let modeState = state.modeState;
  let player: Player;

  if (existing !== undefined) {
    player = {
      ...existing,
      name: command.name,
      connectionIds: existing.connectionIds.includes(command.connectionId)
        ? existing.connectionIds
        : [...existing.connectionIds, command.connectionId],
      disconnectedAt: null,
    };
  } else {
    if (Object.keys(state.players).length >= config.maxPlayers) {
      return reject(state, command.playerId, 'room_full');
    }
    const publicId = String(state.nextSeq);
    player = {
      publicId,
      name: command.name,
      connectionIds: [command.connectionId],
      disconnectedAt: null,
    };
    nextSeq = state.nextSeq + 1;
    modeState = mode.addPlayer(state.modeState, publicId, now, config);
  }

  let hostKey = state.hostKey;
  let hosts = state.hosts;
  if (command.hostKey !== undefined) {
    if (hostKey === null) hostKey = command.hostKey;
    if (hostKey === command.hostKey && !hosts.includes(command.playerId)) {
      hosts = [...hosts, command.playerId];
    }
  }

  return {
    state: { ...withPlayer(state, command.playerId, player), nextSeq, hostKey, hosts, modeState },
    events: [
      {
        type: 'welcome',
        playerId: command.playerId,
        publicId: player.publicId,
        isHost: hosts.includes(command.playerId),
      },
    ],
  };
}

function leave(state: RoomState, playerId: string, connectionId: string, now: number): ApplyResult {
  const player = state.players[playerId];
  if (player === undefined) return { state, events: [] };

  const connectionIds = player.connectionIds.filter((id) => id !== connectionId);
  // The id was not there: a repeated leave must not move the eviction deadline.
  if (connectionIds.length === player.connectionIds.length) return { state, events: [] };

  return {
    state: withPlayer(state, playerId, {
      ...player,
      connectionIds,
      disconnectedAt:
        connectionIds.length === 0 && player.disconnectedAt === null ? now : player.disconnectedAt,
    }),
    events: [],
  };
}

function start(state: RoomState, playerId: string, now: number, config: GameConfig): ApplyResult {
  if (state.players[playerId] === undefined) return reject(state, playerId, 'not_joined');
  if (!state.hosts.includes(playerId)) return reject(state, playerId, 'not_host');
  if (state.phase !== 'lobby' && state.phase !== 'results')
    return reject(state, playerId, 'wrong_phase');

  const goAt = now + config.countdownMs;
  const endsAt = goAt + config.roundMs;

  return {
    state: {
      ...state,
      phase: 'countdown',
      round: { goAt, endsAt },
      notice: null,
      modeState: mode.startRound(state.modeState, goAt, config),
    },
    events: [{ type: 'phaseChanged', phase: 'countdown' }],
  };
}

function input(
  state: RoomState,
  command: InputCommand,
  now: number,
  config: GameConfig,
): ApplyResult {
  const player = state.players[command.playerId];
  if (player === undefined) return reject(state, command.playerId, 'not_joined');
  // Input outside a round is not an error: the client may not know it ended yet.
  if (state.phase !== 'running') return { state, events: [] };

  const modeState = mode.applyInput(state.modeState, player.publicId, command.input, now, config);
  // The mode returns the same reference when nothing changed — a refused click, for instance.
  // Keep that identity: callers rely on it to skip broadcasting a snapshot that is not new.
  if (modeState === state.modeState) return { state, events: [] };

  return { state: { ...state, modeState }, events: [] };
}
```

- [ ] **Step 9: Create `packages/game/src/room/deadline.ts`**

The content is the same as before; only the imports change: `./config` and `./state` now sit next to it, and the condition on connections reads `connectionIds.length === 0`.

```ts
import { DEFAULT_CONFIG, type GameConfig } from './config';
import type { RoomState } from './state';

/**
 * The next moment the state has to change on its own.
 * The server sets the Durable Object alarm to it.
 */
export function nextDeadline(state: RoomState, config: GameConfig = DEFAULT_CONFIG): number | null {
  const candidates: number[] = [];

  if (state.phase === 'countdown' && state.round !== null) {
    candidates.push(state.round.goAt);
  }
  if (state.phase === 'running' && state.round !== null) {
    candidates.push(state.round.endsAt + config.lateGraceMs);
  }
  if (state.phase === 'lobby' || state.phase === 'results') {
    for (const player of Object.values(state.players)) {
      if (player.connectionIds.length === 0 && player.disconnectedAt !== null) {
        candidates.push(player.disconnectedAt + config.reconnectGraceMs);
      }
    }
  }

  return candidates.length === 0 ? null : Math.min(...candidates);
}
```

- [ ] **Step 10: Create `packages/game/src/room/recovery.ts`**

```ts
import * as mode from '../modes/clicker';
import type { Player, RoomState } from './state';

/**
 * The round is over before it ended: the server restarted and the in-memory clicks are gone.
 * Only from countdown or running — anywhere else the state comes back untouched.
 */
export function abortRound(state: RoomState): RoomState {
  if (state.phase !== 'countdown' && state.phase !== 'running') return state;

  return {
    ...state,
    phase: 'lobby',
    round: null,
    notice: 'round_aborted',
    modeState: mode.clearScores(state.modeState),
  };
}

/**
 * Recounts the connections after the server wakes up or restarts.
 * `live` holds the ids of the connections each playerId has right now.
 */
export function syncConnections(
  state: RoomState,
  live: Record<string, string[]>,
  now: number,
): RoomState {
  const players: Record<string, Player> = {};
  for (const [playerId, player] of Object.entries(state.players)) {
    const connectionIds = live[playerId] ?? [];
    players[playerId] = {
      ...player,
      connectionIds,
      disconnectedAt: connectionIds.length > 0 ? null : (player.disconnectedAt ?? now),
    };
  }
  return { ...state, players };
}
```

- [ ] **Step 11: Replace `packages/game/src/index.ts`**

```ts
export {
  type ClickerInput,
  type ClickerScore,
  type ClickerState,
  comparePublicIds,
  type ResultRow,
  toData as toModeData,
} from './modes/clicker';
export { type ApplyResult, apply } from './room/apply';
export type {
  Command,
  ErrorCode,
  GameEvent,
  InputCommand,
  JoinCommand,
} from './room/commands';
export { DEFAULT_CONFIG, type GameConfig } from './room/config';
export { nextDeadline } from './room/deadline';
export { abortRound, syncConnections } from './room/recovery';
export type { ModeId, Notice, Phase, Player, RoomState, Round } from './room/state';
export { createRoomState } from './room/state';
```

- [ ] **Step 12: Delete the old flat files**

```bash
git rm packages/game/src/{state,commands,config,advance,apply,deadline,recovery,results}.ts
```

- [ ] **Step 13: Make sure the sources compile**

Run: `pnpm --filter @clicker/game exec tsc --noEmit`
Expected: errors **only** in `test/` — these are outdated import paths, and Task 3 fixes them. There must be no errors in `src/`; if there are, stop and sort it out, you cannot go further.

- [ ] **Step 14: Commit**

```bash
git add packages/game/src
git commit -m "refactor(game): split the rules into a room and a game mode"
```

---

### Task 2: Protocol — a version, a generic input, a mode slot

**Files:**
- Modify: `packages/protocol/src/client.ts`, `packages/protocol/src/server.ts`, `packages/protocol/src/index.ts`

- [ ] **Step 1: Replace `packages/protocol/src/client.ts`**

**Important:** `FORBIDDEN_NAME_CHARS` and the whole `nameSchema` are carried over from the current file as they are — changing them is not part of this task. In the block below the invisible characters of the ranges may have been distorted by copying; the correct form of the line is exactly the one already in the repository:

```ts
const FORBIDDEN_NAME_CHARS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;
```

```ts
import * as v from 'valibot';
import { ID_PATTERN } from './ids';

/** Anything longer never reaches the parser. */
export const MAX_MESSAGE_BYTES = 1024;
export const MAX_NAME_LENGTH = 20;
/** Bumped when the wire format changes in a way an old client cannot read. */
export const PROTOCOL_VERSION = 1;

const encoder = new TextEncoder();

const idSchema = v.pipe(v.string(), v.regex(ID_PATTERN));
const versionSchema = v.literal(PROTOCOL_VERSION);

/** Control characters and bidi overrides (U+202A–U+202E, U+2066–U+2069). */
const FORBIDDEN_NAME_CHARS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

/** The name is stored trimmed and its length is counted in code points. */
const nameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.check((value) => {
    const length = [...value].length;
    return length >= 1 && length <= MAX_NAME_LENGTH;
  }, 'name must be 1..20 characters'),
  v.check((value) => !FORBIDDEN_NAME_CHARS.test(value), 'name must not contain control characters'),
);

/** The clicker's input. What it means is the mode's business, not the room's. */
export const clickerInputSchema = v.strictObject({ type: v.literal('click') });

export const joinSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('join'),
  playerId: idSchema,
  name: nameSchema,
  hostKey: v.optional(idSchema),
});

export const startSchema = v.strictObject({ v: versionSchema, type: v.literal('start') });

export const inputSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('input'),
  input: clickerInputSchema,
});

export const clientMessageSchema = v.variant('type', [joinSchema, startSchema, inputSchema]);

export type ClientMessage = v.InferOutput<typeof clientMessageSchema>;
export type JoinMessage = v.InferOutput<typeof joinSchema>;

/**
 * A wrong version is worth telling apart from garbage: the player only needs to reload,
 * and the server can say so instead of silently ignoring them.
 */
export type ParsedClientMessage =
  | { ok: true; message: ClientMessage }
  | { ok: false; reason: 'invalid_message' | 'bad_version' };

export function parseClientMessage(raw: string): ParsedClientMessage {
  // UTF-8 is never shorter than UTF-16 in units, so this rejects the huge frames for free.
  if (raw.length > MAX_MESSAGE_BYTES) return { ok: false, reason: 'invalid_message' };
  if (encoder.encode(raw).length > MAX_MESSAGE_BYTES)
    return { ok: false, reason: 'invalid_message' };

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_message' };
  }

  const result = v.safeParse(clientMessageSchema, data);
  if (result.success) return { ok: true, message: result.output };

  // Shaped like one of ours but from another build: worth a clear answer.
  const version = (data as { v?: unknown } | null)?.v;
  if (typeof version === 'number' && version !== PROTOCOL_VERSION) {
    return { ok: false, reason: 'bad_version' };
  }
  return { ok: false, reason: 'invalid_message' };
}
```

- [ ] **Step 2: Replace `packages/protocol/src/server.ts`**

```ts
import { comparePublicIds, type RoomState, toModeData } from '@clicker/game';
import * as v from 'valibot';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from './client';

/** A snapshot is far bigger than anything a client sends, so its limit is separate. */
export const MAX_SERVER_MESSAGE_BYTES = 64 * 1024;

const versionSchema = v.literal(PROTOCOL_VERSION);
const phaseSchema = v.picklist(['lobby', 'countdown', 'running', 'results']);
const modeSchema = v.picklist(['clicker']);

const errorCodeSchema = v.picklist([
  'not_joined',
  'not_host',
  'wrong_phase',
  'room_full',
  'invalid_message',
  'bad_version',
]);

export const welcomeSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('welcome'),
  you: v.string(),
  isHost: v.boolean(),
});

/** The mode's slot. The room never looks inside it. */
export const clickerDataSchema = v.strictObject({
  scores: v.record(v.string(), v.number()),
  results: v.nullable(
    v.array(
      v.strictObject({
        id: v.string(),
        name: v.string(),
        clicks: v.number(),
        rank: v.number(),
      }),
    ),
  ),
});

export const snapshotSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('snapshot'),
  serverNow: v.number(),
  mode: modeSchema,
  phase: phaseSchema,
  players: v.array(
    v.strictObject({
      id: v.string(),
      name: v.string(),
      connected: v.boolean(),
    }),
  ),
  round: v.nullable(v.strictObject({ goAt: v.number(), endsAt: v.number() })),
  notice: v.nullable(v.literal('round_aborted')),
  data: clickerDataSchema,
});

/** Sent to one connection only: a role, a word, a hand of cards. */
export const privateSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('private'),
  data: v.unknown(),
});

export const errorSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('error'),
  code: errorCodeSchema,
});

export const serverMessageSchema = v.variant('type', [
  welcomeSchema,
  snapshotSchema,
  privateSchema,
  errorSchema,
]);

export type ServerMessage = v.InferOutput<typeof serverMessageSchema>;
export type SnapshotMessage = v.InferOutput<typeof snapshotSchema>;
export type PrivateMessage = v.InferOutput<typeof privateSchema>;
export type ServerErrorCode = v.InferOutput<typeof errorCodeSchema>;

export function parseServerMessage(raw: string): ServerMessage | null {
  if (raw.length > MAX_SERVER_MESSAGE_BYTES) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = v.safeParse(serverMessageSchema, data);
  return result.success ? result.output : null;
}

/** The secret playerId and hostKey never get in here. */
export function toSnapshot(state: RoomState, now: number): SnapshotMessage {
  return {
    v: PROTOCOL_VERSION,
    type: 'snapshot',
    serverNow: now,
    mode: state.mode,
    phase: state.phase,
    players: Object.values(state.players)
      .map((player) => ({
        id: player.publicId,
        name: player.name,
        connected: player.connectionIds.length > 0,
      }))
      .sort((a, b) => comparePublicIds(a.id, b.id)),
    round: state.round === null ? null : { goAt: state.round.goAt, endsAt: state.round.endsAt },
    notice: state.notice,
    data: toModeData(state.modeState),
  };
}

/** Kept next to the other limits so the client and the server agree on them. */
export { MAX_MESSAGE_BYTES };
```

- [ ] **Step 3: Replace `packages/protocol/src/index.ts`**

```ts
export {
  type ClientMessage,
  clickerInputSchema,
  clientMessageSchema,
  inputSchema,
  type JoinMessage,
  joinSchema,
  MAX_MESSAGE_BYTES,
  MAX_NAME_LENGTH,
  type ParsedClientMessage,
  PROTOCOL_VERSION,
  parseClientMessage,
  startSchema,
} from './client';
export { generateId, ID_PATTERN, isId } from './ids';
export {
  clickerDataSchema,
  errorSchema,
  MAX_SERVER_MESSAGE_BYTES,
  type PrivateMessage,
  parseServerMessage,
  privateSchema,
  type ServerErrorCode,
  type ServerMessage,
  type SnapshotMessage,
  serverMessageSchema,
  snapshotSchema,
  toSnapshot,
  welcomeSchema,
} from './server';
```

- [ ] **Step 4: Check that the sources compile**

Run: `pnpm --filter @clicker/protocol exec tsc --noEmit`
Expected: errors only in `test/`.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src
git commit -m "feat(protocol): add a version, a generic input and a slot for mode data"
```

---

### Task 3: Port the tests

**Files:**
- Modify: all the files in `packages/game/test` and `packages/protocol/test`

This is a port, not a rewrite: the meaning of every check is kept, only the form changes. Do not delete or weaken a single test.

- [ ] **Step 1: Replace `packages/game/test/support.ts`**

```ts
import { type ClickerScore, emptyScore } from '../src/modes/clicker/state';
import { DEFAULT_CONFIG, type GameConfig } from '../src/room/config';
import { createRoomState, type Player, type RoomState } from '../src/room/state';

export function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

/** Freezes the state: if code tries to mutate it, the test fails. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/** A generic room player. Nothing about a specific game belongs here. */
export function player(overrides: Partial<Player> & { publicId: string }): Player {
  return {
    name: 'player',
    connectionIds: ['conn-1'],
    disconnectedAt: null,
    ...overrides,
  };
}

/** A score row for the clicker mode, keyed by publicId in modeState.scores. */
export function score(overrides: Partial<ClickerScore> = {}): ClickerScore {
  return { ...emptyScore(0, DEFAULT_CONFIG.burst), ...overrides };
}

export function room(overrides: Partial<RoomState> = {}): RoomState {
  return { ...createRoomState(), ...overrides };
}
```

- [ ] **Step 2: Update the import paths in all the tests**

| Was | Becomes |
|---|---|
| `../src/apply` | `../src/room/apply` |
| `../src/advance` | `../src/room/advance` |
| `../src/state` | `../src/room/state` |
| `../src/config` | `../src/room/config` |
| `../src/deadline` | `../src/room/deadline` |
| `../src/recovery` | `../src/room/recovery` |
| `../src/results` | `../src/modes/clicker/results` |

The files `leave.test.ts`, `deadline.test.ts` and `ids.test.ts` stop at this — there is nothing more to change in them.

- [ ] **Step 3: Convert the commands and the score accesses**

In all the tests of `packages/game/test`:

- The command `{ type: 'click', playerId: 'secret-1' }` → `{ type: 'input', playerId: 'secret-1', input: { type: 'click' } }`.
- The accesses `state.players['secret-1']?.clicks` and `?.lastCountedAt` → `state.modeState.scores['1']?.clicks` and `?.lastCountedAt`. The key `'1'` is the `publicId` of the first player to join; it is deterministic.
- `state.results` → `state.modeState.results`.
- In `join.test.ts` the field `clicks: 0` can no longer sit inside the player's `toMatchObject`: move it into a separate check on `result.state.modeState.scores['1']?.clicks`.
- In `start.test.ts` the "dirty" score before a round (`clicks: 42`, `lastCountedAt: 900`) is built in `modeState.scores['1']`, and `results: []` in `modeState.results`.
- In `advance.test.ts` the countdown fixture must give the player a score: `modeState: { scores: { '1': score() }, results: null }`, otherwise there is nothing to compute the results from.
- In `recovery.test.ts` a room in the results phase is built with `modeState: { scores: {}, results: [...] }`.

- [ ] **Step 4: Replace two files in full**

For these two it is not the form of the code but the signature of what is tested that changed, so they are given verbatim, not as replacement rules.

`packages/game/test/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRoomState } from '../src/room/state';

describe('createRoomState', () => {
  it('starts in an empty lobby', () => {
    expect(createRoomState()).toEqual({
      mode: 'clicker',
      phase: 'lobby',
      hostKey: null,
      hosts: [],
      players: {},
      nextSeq: 1,
      round: null,
      notice: null,
      modeState: { scores: {}, results: null },
    });
  });
});
```

`packages/game/test/results.test.ts` — `computeResults(scores, names)` takes two records, both keyed by `publicId`:

```ts
import { describe, expect, it } from 'vitest';
import { comparePublicIds, computeResults } from '../src/modes/clicker/results';
import { score } from './support';

describe('computeResults', () => {
  it('puts the biggest score first and numbers the ranks', () => {
    const rows = computeResults(
      {
        '1': score({ clicks: 10, lastCountedAt: 500 }),
        '2': score({ clicks: 30, lastCountedAt: 500 }),
        '3': score({ clicks: 20, lastCountedAt: 500 }),
      },
      { '1': 'Аня', '2': 'Боря', '3': 'Вера' },
    );

    expect(rows.map((row) => [row.name, row.rank])).toEqual([
      ['Боря', 1],
      ['Вера', 2],
      ['Аня', 3],
    ]);
  });

  it('gives an equal score to whoever reached it first', () => {
    const rows = computeResults(
      {
        '1': score({ clicks: 10, lastCountedAt: 900 }),
        '2': score({ clicks: 10, lastCountedAt: 700 }),
      },
      { '1': 'Аня', '2': 'Боря' },
    );

    expect(rows.map((row) => row.name)).toEqual(['Боря', 'Аня']);
  });

  it('falls back to publicId when nobody clicked', () => {
    const rows = computeResults({ '2': score(), '1': score() }, { '2': 'Боря', '1': 'Аня' });

    expect(rows.map((row) => row.name)).toEqual(['Аня', 'Боря']);
    expect(rows.every((row) => row.clicks === 0)).toBe(true);
  });

  it('breaks a full tie by publicId as a number, not as a string', () => {
    const rows = computeResults(
      {
        '10': score({ clicks: 10, lastCountedAt: 700 }),
        '2': score({ clicks: 10, lastCountedAt: 700 }),
      },
      { '10': 'Боря', '2': 'Аня' },
    );

    expect(rows.map((row) => row.publicId)).toEqual(['2', '10']);
  });
});

describe('comparePublicIds', () => {
  it('orders ids as numbers', () => {
    expect(comparePublicIds('2', '10')).toBeLessThan(0);
    expect(comparePublicIds('10', '2')).toBeGreaterThan(0);
    expect(comparePublicIds('7', '7')).toBe(0);
  });

  it('sorts a list the way a string sort would not', () => {
    expect(['10', '2', '1'].sort(comparePublicIds)).toEqual(['1', '2', '10']);
  });
});
```

`click.test.ts` keeps its name: it still tests the click — now as a mode input.

- [ ] **Step 5: Update the protocol tests**

- Add `v: PROTOCOL_VERSION` to every message.
- `{ type: 'click' }` → `{ type: 'input', input: { type: 'click' } }`.
- `parseClientMessage` now returns a result: `expect(...).toBeNull()` → `expect(...).toEqual({ ok: false, reason: 'invalid_message' })`, and a successful parse → `{ ok: true, message: {...} }`.
- `snapshot.results` → `snapshot.data.results`.
- **Add a new test:** a message with `v: 2` gives `{ ok: false, reason: 'bad_version' }`. This field is what the whole change is for.

- [ ] **Step 6: Run and compare file by file**

```bash
pnpm --filter @clicker/game test
pnpm --filter @clicker/protocol test
pnpm typecheck
```

The total alone is not enough: a port easily "passes" after losing a couple of checks. Compare file by file — the numbers are the same as before the port, except `client.test.ts`, which gained the version test:

| File | Tests |
|---|---|
| `game/test/advance.test.ts` | 8 |
| `game/test/click.test.ts` | 11 |
| `game/test/deadline.test.ts` | 5 |
| `game/test/join.test.ts` | 11 |
| `game/test/leave.test.ts` | 5 |
| `game/test/recovery.test.ts` | 7 |
| `game/test/results.test.ts` | 6 |
| `game/test/start.test.ts` | 6 |
| `game/test/state.test.ts` | 1 |
| **game — total** | **60** |
| `protocol/test/client.test.ts` | 20 |
| `protocol/test/ids.test.ts` | 4 |
| `protocol/test/server.test.ts` | 8 |
| **protocol — total** | **32** |

If even one row does not match, look for the lost test, do not adjust the total. The typecheck stays silent about it.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add packages
git commit -m "test: port the suites to the room and mode layout"
```

---

### Task 4: The server for the new protocol

**Files:**
- Modify: `apps/game/src/worker/room.ts`

The code of this task is derived from what was verified but was not run in the prototype. The gate is the 15 integration tests in the real Workers runtime.

- [ ] **Step 1: Import the protocol version**

Line 13, add `PROTOCOL_VERSION`:

```ts
import { PROTOCOL_VERSION, parseClientMessage, type ServerMessage, toSnapshot } from '@clicker/protocol';
```

- [ ] **Step 2: Update the message parsing in `onMessage`**

`parseClientMessage` no longer returns `null`; it tells garbage from a foreign version. Lines 65–74 in full:

```ts
    if (typeof message !== 'string') {
      this.#send(connection, { v: PROTOCOL_VERSION, type: 'error', code: 'invalid_message' });
      return;
    }

    const parsed = parseClientMessage(message);
    if (!parsed.ok) {
      this.#send(connection, { v: PROTOCOL_VERSION, type: 'error', code: parsed.reason });
      return;
    }
    const incoming = parsed.message;
```

- [ ] **Step 3: Rename `parsed` in the join branch**

Lines 76–95 refer to the parsed message as `parsed`; now it is called `incoming`. Replace `parsed.type`, `parsed.playerId`, `parsed.name` and both `parsed.hostKey` — the logic of the branch itself does not change.

- [ ] **Step 4: Switch the tail of `onMessage` to `input`**

Lines 97–103 currently forward `start` and `click` in one line, because both have the same shape. `input` has a payload, so the branches part ways:

```ts
    const session = connection.state;
    if (session === null) {
      this.#send(connection, { v: PROTOCOL_VERSION, type: 'error', code: 'not_joined' });
      return;
    }

    if (incoming.type === 'input') {
      await this.#run(
        { type: 'input', playerId: session.playerId, input: incoming.input },
        connection,
      );
      return;
    }
    await this.#run({ type: 'start', playerId: session.playerId }, connection);
```

- [ ] **Step 5: Fix the condition for writing to storage**

Lines 141–145. This is the very place where the round result used to be lost: the click that closed the round was not persisted. The condition must stay the same in meaning — the command is just called something else now.

> **Correction after the fact (2026-09-14).** It used to say here that TypeScript would silently let a forgotten `'click'` through. That is wrong: after tasks 1–3 the compiler reports on this line `TS2367 — This comparison appears to be unintentional because the types '"input" | "join" | "leave" | "start" | "tick"' and '"click"' have no overlap`. There is a safety net here. The step still stays separate: what matters is not just to remove the type error but to keep the meaning of the condition — the temptation to "fix" it by throwing the check out altogether would bring back the loss of round results.

```ts
    // An input can also close the round: advance runs before every command.
    // We skip persisting only for inputs that merely bumped the score.
    if (phaseChanged || command.type !== 'input') {
      await this.#persist();
    }
```

- [ ] **Step 6: Add the version to the outgoing messages of `#handleEvent`**

Lines 156–165:

```ts
  #handleEvent(event: GameEvent, source?: Connection<Session>): void {
    if (event.type === 'welcome' && source !== undefined) {
      source.setState({ playerId: event.playerId, publicId: event.publicId });
      this.#send(source, {
        v: PROTOCOL_VERSION,
        type: 'welcome',
        you: event.publicId,
        isHost: event.isHost,
      });
      return;
    }
    if (event.type === 'rejected' && source !== undefined) {
      this.#send(source, { v: PROTOCOL_VERSION, type: 'error', code: event.code });
    }
  }
```

No need to touch the snapshot: `toSnapshot` sets the version itself.

- [ ] **Step 7: Run the server tests**

Run: `pnpm --filter @clicker/app test`
Expected: `Test Files 2 passed (2)`, `Tests 15 passed (15)`. The server tests build messages themselves — if they fail on a missing `v`, fix the tests: that is part of the same format change.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/game
git commit -m "feat(server): speak the versioned protocol with generic input"
```

---

### Task 5: The client for the new protocol

**Files:**
- Modify: `apps/game/src/client/net.ts`, `apps/game/src/client/store.ts`

- [ ] **Step 1: Import the protocol version in `net.ts`**

Line 1:

```ts
import { PROTOCOL_VERSION, parseServerMessage } from '@clicker/protocol';
```

- [ ] **Step 2: Add the version and the generic input to `net.ts`**

```ts
  socket.addEventListener('open', () => {
    useClient.getState().setStatus('open');
    const hostKey = hostKeyFor(roomId);
    send({
      v: PROTOCOL_VERSION,
      type: 'join',
      playerId: playerId(),
      name,
      ...(hostKey === undefined ? {} : { hostKey }),
    });
  });
```

and in the returned object:

```ts
  return {
    start: () => {
      useClient.getState().clearError();
      send({ v: PROTOCOL_VERSION, type: 'start' });
    },
    click: () => {
      useClient.getState().clearError();
      if (send({ v: PROTOCOL_VERSION, type: 'input', input: { type: 'click' } })) {
        useClient.getState().countClick();
      }
    },
    close: () => { … },
  };
```

- [ ] **Step 2: Change nothing in `store.ts` except the error type**

`ServerErrorCode` now includes `bad_version`; no separate edit is needed, but make sure `pnpm --filter @clicker/app typecheck` passes.

- [ ] **Step 3: Check**

```bash
pnpm --filter @clicker/app typecheck
pnpm --filter @clicker/app run build
```

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/game
git commit -m "feat(app): send versioned messages and generic input"
```

---

### Task 6: Whole-repository check

- [ ] **Step 1: Run everything**

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
pnpm --filter @clicker/app run build
```
Expected: the linter and the types are clean, 60 + 32 + 15 = 107 tests, both parts of the build in place.

- [ ] **Step 2: Check against the spec**

Sections 3, 5, 6 and 7 describe exactly what is now in the code: the mode as a field of the room, the mode's state in a separate slot, a generic input, the protocol version, a private message and a simulation tick in the config. Nothing uses the private message and the tick yet — they are seams laid in advance, and that is intended.

- [ ] **Step 3: Commit if the formatter changed anything**

```bash
git add -A && git commit -m "style: apply formatting after the seams"
```

---

## Checking the result

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm --filter @clicker/app run build
```

Expected: 107 tests, zero failures, both parts of the build.

The main sign that the seams worked out: `packages/game/src/room/` contains not a single word about clicks, and `apps/game/src/worker/room.ts` contains not a single `if` about game rules.

## What next

With these seams a second mode — a reaction test or a snake — is added without touching either the room or the protocol: a new directory in `modes/`, its own input and data schema, its own arena on the client. That is also when the real mode interface and the registry appear — derived from two implementations.
