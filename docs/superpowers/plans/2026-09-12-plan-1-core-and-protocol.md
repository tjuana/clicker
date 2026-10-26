# Clicker Foundation Implementation Plan (plan 1 of 3: core and protocol)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo and two packages with no external dependencies — the game rules (`packages/game`) and the message protocol (`packages/protocol`) — fully covered by tests, with a linter, a type check and CI.

**Architecture:** The game rules are pure functions: only `apply(state, command, now, config)` changes the room state, time arrives as a parameter, and the input state is never mutated. The protocol is described by valibot schemas, the types are inferred from the schemas, and the protocol also turns the state into a snapshot for clients. Neither package knows anything about Cloudflare, WebSocket or the DOM — the server (plan 2) and the client (plan 3) will be their adapters.

**Tech Stack:** pnpm 12.4.1 (via corepack), TypeScript 7.0.2, Vitest 4.1.11, valibot 1.5.0, Biome 2.5.13, Node 22, GitHub Actions.

Specification: [2026-09-11-clicker-foundation-design.md](../specs/2026-09-11-clicker-foundation-design.md), sections 3, 5, 6, 10, 11.

---

## Checked before the plan was written

All the code below was written and run in a temporary folder on this machine: 44 `packages/game` tests, 23 `packages/protocol` tests, `tsc --noEmit` for both packages and `biome check` — all green. Versions were taken from npm on 2026-09-12.

Two facts that decided the choice of versions:
- `@cloudflare/vitest-plugin` (needed in plan 2) requires Vitest `^4.1.0`, so we take 4.1.11, not the newly released 5.0.
- Vitest 4.1 and TypeScript 7 work with this `tsconfig` without a single change.

## How to execute

- Work in a separate worktree (skill superpowers:using-git-worktrees), branch `feat/core-and-protocol`.
- One task, one commit. Commit messages follow Conventional Commits, in English, **with no Claude signatures**.
- The order of the tasks must not change: each one builds on the files of the previous one.

## File structure

Created in this plan:

```
package.json                      scripts for the whole repository, Biome as a devDependency
pnpm-workspace.yaml               list of packages
tsconfig.base.json                shared TypeScript settings
biome.json                        linter and formatter
.gitignore  .nvmrc
.github/workflows/ci.yml          checks on push and pull request

packages/game/
  package.json  tsconfig.json
  src/config.ts       rules settings: durations, limits
  src/state.ts        state types and createRoomState
  src/commands.ts     commands, events, error codes
  src/results.ts      round results calculation
  src/advance.ts      advancing the state through time
  src/apply.ts        the single point where state changes
  src/deadline.ts     the nearest deadline for the alarm
  src/recovery.ts     recovery after a server restart
  src/index.ts        the package's public entry point
  test/support.ts     test helpers
  test/*.test.ts      one file for each part

packages/protocol/
  package.json  tsconfig.json
  src/ids.ts          identifier format and generation
  src/client.ts       client message schemas and their parsing
  src/server.ts       server message schemas, parsing and snapshot building
  src/index.ts        the package's public entry point
  test/*.test.ts
```

---

### Task 1: Repository skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.gitignore`, `.nvmrc`

- [ ] **Step 1: Enable pnpm**

Run: `corepack enable pnpm`
Expected: the command finishes silently. Node is installed through nvm, no root rights needed.

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "clicker",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.4.1",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "check": "biome check .",
    "format": "biome check --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.13"
  }
}
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"

onlyBuiltDependencies:
  - esbuild
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  }
}
```

- [ ] **Step 5: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.13/schema.json",
  "vcs": { "enabled": false, "clientKind": "git", "useIgnoreFile": false },
  "files": { "ignoreUnknown": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": { "preset": "recommended" }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always",
      "trailingCommas": "all"
    }
  },
  "assist": {
    "enabled": true,
    "actions": { "source": { "organizeImports": "on" } }
  }
}
```

- [ ] **Step 6: Create `.gitignore`**

```gitignore
node_modules/
dist/
.wrangler/
.dev.vars
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 7: Create `.nvmrc`**

```
22
```

- [ ] **Step 8: Install the dependencies**

Run: `pnpm install`
Expected: `devDependencies: + @biomejs/biome 2.5.13` and `Done in ...`. `pnpm-lock.yaml` appears.

- [ ] **Step 9: Check the format and commit**

```bash
pnpm format
pnpm check
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json biome.json .gitignore .nvmrc
git commit -m "chore: set up pnpm workspace with typescript and biome"
```
Expected for `pnpm check`: `Checked N files ... No fixes applied.` and a zero exit code.

---

### Task 2: The packages/game package and the room state

**Files:**
- Create: `packages/game/package.json`, `packages/game/tsconfig.json`, `packages/game/src/config.ts`, `packages/game/src/state.ts`
- Test: `packages/game/test/state.test.ts`

- [ ] **Step 1: Create `packages/game/package.json`**

```json
{
  "name": "@clicker/game",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

- [ ] **Step 2: Create `packages/game/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install the package's dependencies**

Run: `pnpm install`
Expected: `Scope: all 2 workspace projects`, typescript and vitest get installed.

- [ ] **Step 4: Write the failing test `packages/game/test/state.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createRoomState } from '../src/state';

describe('createRoomState', () => {
  it('starts in an empty lobby', () => {
    expect(createRoomState()).toEqual({
      phase: 'lobby',
      hostKey: null,
      hosts: [],
      players: {},
      nextSeq: 1,
      round: null,
      results: null,
      notice: null,
    });
  });
});
```

- [ ] **Step 5: Confirm the test fails**

Run: `pnpm --filter @clicker/game test`
Expected: FAIL, `Cannot find module "../src/state"`.

- [ ] **Step 6: Create `packages/game/src/config.ts`**

```ts
export interface GameConfig {
  /** How long the countdown before a round lasts. */
  countdownMs: number;
  /** How long a round lasts. */
  roundMs: number;
  /** How long clicks are still accepted after the round ends: a margin for network delay. */
  lateGraceMs: number;
  /** The refill rate of the token bucket. */
  clicksPerSecond: number;
  /** The capacity of the token bucket. */
  burst: number;
  /** How long a disconnected player stays in the list. */
  reconnectGraceMs: number;
  /** The maximum number of players in a room. */
  maxPlayers: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  countdownMs: 3000,
  roundMs: 10000,
  lateGraceMs: 250,
  clicksPerSecond: 15,
  burst: 15,
  reconnectGraceMs: 30000,
  maxPlayers: 50,
};
```

- [ ] **Step 7: Create `packages/game/src/state.ts`**

```ts
export type Phase = 'lobby' | 'countdown' | 'running' | 'results';

export type Notice = 'round_aborted';

export interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface Player {
  /** Public identifier: only this one goes out to clients. */
  publicId: string;
  name: string;
  /** How many connections are open for this playerId. */
  connections: number;
  disconnectedAt: number | null;
  clicks: number;
  lastCountedAt: number | null;
  bucket: Bucket;
}

export interface ResultRow {
  publicId: string;
  name: string;
  clicks: number;
  rank: number;
}

export interface Round {
  goAt: number;
  endsAt: number;
}

export interface RoomState {
  phase: Phase;
  hostKey: string | null;
  /** The hosts' playerIds. */
  hosts: string[];
  /** The key is the secret playerId. */
  players: Record<string, Player>;
  nextSeq: number;
  round: Round | null;
  results: ResultRow[] | null;
  notice: Notice | null;
}

export function createRoomState(): RoomState {
  return {
    phase: 'lobby',
    hostKey: null,
    hosts: [],
    players: {},
    nextSeq: 1,
    round: null,
    results: null,
    notice: null,
  };
}
```

- [ ] **Step 8: Confirm the test passes**

Run: `pnpm --filter @clicker/game test`
Expected: `Test Files 1 passed (1)`, `Tests 1 passed (1)`.

- [ ] **Step 9: Commit**

```bash
pnpm format
git add packages/game pnpm-lock.yaml
git commit -m "feat(game): add room state and config"
```

---

### Task 3: Round results

**Files:**
- Create: `packages/game/src/results.ts`, `packages/game/test/support.ts`
- Test: `packages/game/test/results.test.ts`

- [ ] **Step 1: Create the helper `packages/game/test/support.ts`**

```ts
import { DEFAULT_CONFIG, type GameConfig } from '../src/config';
import { createRoomState, type Player, type RoomState } from '../src/state';

export function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

/** Freezes the state: if the code tries to change it, the test fails. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function player(overrides: Partial<Player> & { publicId: string }): Player {
  return {
    name: 'player',
    connections: 1,
    disconnectedAt: null,
    clicks: 0,
    lastCountedAt: null,
    bucket: { tokens: 15, updatedAt: 0 },
    ...overrides,
  };
}

export function room(overrides: Partial<RoomState> = {}): RoomState {
  return { ...createRoomState(), ...overrides };
}
```

- [ ] **Step 2: Write the failing test `packages/game/test/results.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { computeResults } from '../src/results';
import { player } from './support';

describe('computeResults', () => {
  it('puts the biggest score first and numbers the ranks', () => {
    const rows = computeResults({
      a: player({ publicId: '1', name: 'Аня', clicks: 10, lastCountedAt: 500 }),
      b: player({ publicId: '2', name: 'Боря', clicks: 30, lastCountedAt: 500 }),
      c: player({ publicId: '3', name: 'Вера', clicks: 20, lastCountedAt: 500 }),
    });

    expect(rows.map((row) => [row.name, row.rank])).toEqual([
      ['Боря', 1],
      ['Вера', 2],
      ['Аня', 3],
    ]);
  });

  it('gives an equal score to whoever reached it first', () => {
    const rows = computeResults({
      a: player({ publicId: '1', name: 'Аня', clicks: 10, lastCountedAt: 900 }),
      b: player({ publicId: '2', name: 'Боря', clicks: 10, lastCountedAt: 700 }),
    });

    expect(rows.map((row) => row.name)).toEqual(['Боря', 'Аня']);
  });

  it('falls back to publicId when nobody clicked', () => {
    const rows = computeResults({
      b: player({ publicId: '2', name: 'Боря' }),
      a: player({ publicId: '1', name: 'Аня' }),
    });

    expect(rows.map((row) => row.name)).toEqual(['Аня', 'Боря']);
    expect(rows.every((row) => row.clicks === 0)).toBe(true);
  });
});
```

- [ ] **Step 3: Confirm the test fails**

Run: `pnpm --filter @clicker/game test`
Expected: FAIL, `Cannot find module "../src/results"`.

- [ ] **Step 4: Create `packages/game/src/results.ts`**

```ts
import type { Player, ResultRow } from './state';

/**
 * More clicks rank higher. On a tie, whoever reached the score first wins.
 * A complete tie is broken by publicId, so the order is predictable.
 */
function compare(a: Player, b: Player): number {
  if (a.clicks !== b.clicks) return b.clicks - a.clicks;
  const aTime = a.lastCountedAt ?? Number.POSITIVE_INFINITY;
  const bTime = b.lastCountedAt ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return Number(a.publicId) - Number(b.publicId);
}

export function computeResults(players: Record<string, Player>): ResultRow[] {
  return Object.values(players)
    .sort(compare)
    .map((player, index) => ({
      publicId: player.publicId,
      name: player.name,
      clicks: player.clicks,
      rank: index + 1,
    }));
}
```

- [ ] **Step 5: Confirm the tests pass**

Run: `pnpm --filter @clicker/game test`
Expected: `Test Files 2 passed (2)`, `Tests 4 passed (4)`.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add packages/game
git commit -m "feat(game): compute round results"
```

---

### Task 4: Advancing the state through time

**Files:**
- Create: `packages/game/src/advance.ts`
- Test: `packages/game/test/advance.test.ts`

The `apply` test at the end of the file is added in Task 5 — we do not write it now.

- [ ] **Step 1: Write the failing test `packages/game/test/advance.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { advance } from '../src/advance';
import type { RoomState } from '../src/state';
import { config, player, room } from './support';

const CONFIG = config({
  countdownMs: 3000,
  roundMs: 10000,
  lateGraceMs: 250,
  reconnectGraceMs: 30000,
});

/** The countdown is running: the round opens at 4000 and closes at 14000. */
function countdown(): RoomState {
  return room({
    phase: 'countdown',
    hostKey: 'key-1',
    hosts: ['secret-1'],
    players: { 'secret-1': player({ publicId: '1', name: 'Аня' }) },
    nextSeq: 2,
    round: { goAt: 4000, endsAt: 14000 },
  });
}

describe('advance', () => {
  it('waits while the countdown is still running', () => {
    const result = advance(countdown(), 3999, CONFIG);

    expect(result.state.phase).toBe('countdown');
    expect(result.phases).toEqual([]);
  });

  it('opens the round when the countdown is over', () => {
    const result = advance(countdown(), 4000, CONFIG);

    expect(result.state.phase).toBe('running');
    expect(result.phases).toEqual(['running']);
  });

  it('keeps the round open inside the grace window', () => {
    const running: RoomState = { ...countdown(), phase: 'running' };

    const result = advance(running, 14249, CONFIG);

    expect(result.state.phase).toBe('running');
    expect(result.phases).toEqual([]);
  });

  it('closes the round after the grace window and fills the results', () => {
    const running: RoomState = { ...countdown(), phase: 'running' };

    const result = advance(running, 14250, CONFIG);

    expect(result.state.phase).toBe('results');
    expect(result.state.round).toBeNull();
    expect(result.state.results).toEqual([{ publicId: '1', name: 'Аня', clicks: 0, rank: 1 }]);
    expect(result.phases).toEqual(['results']);
  });

  it('walks through both transitions when the alarm is late', () => {
    const result = advance(countdown(), 20000, CONFIG);

    expect(result.state.phase).toBe('results');
    expect(result.phases).toEqual(['running', 'results']);
  });

  it('drops a disconnected player from the lobby after the grace period', () => {
    const state = room({
      hosts: ['secret-1'],
      players: { 'secret-1': player({ publicId: '1', connections: 0, disconnectedAt: 1000 }) },
    });

    const before = advance(state, 30999, CONFIG);
    const after = advance(state, 31000, CONFIG);

    expect(Object.keys(before.state.players)).toEqual(['secret-1']);
    expect(after.state.players).toEqual({});
    expect(after.state.hosts).toEqual([]);
  });

  it('keeps a disconnected player while the round is on', () => {
    const state = room({
      phase: 'running',
      round: { goAt: 4000, endsAt: 14000 },
      players: { 'secret-1': player({ publicId: '1', connections: 0, disconnectedAt: 1000 }) },
    });

    const result = advance(state, 13000, CONFIG);

    expect(Object.keys(result.state.players)).toEqual(['secret-1']);
  });
});
```

- [ ] **Step 2: Confirm the test fails**

Run: `pnpm --filter @clicker/game test`
Expected: FAIL, `Cannot find module "../src/advance"`.

- [ ] **Step 3: Create `packages/game/src/advance.ts`**

```ts
import type { GameConfig } from './config';
import { computeResults } from './results';
import type { Phase, RoomState } from './state';

export interface AdvanceResult {
  state: RoomState;
  /** The phases that were entered, in order. */
  phases: Phase[];
}

/**
 * Advances the state through time. Called before handling any command,
 * so the rules do not depend on whether the alarm fired on time.
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
      next = { ...next, phase: 'results', round: null, results: computeResults(next.players) };
      phases.push('results');
      continue;
    }
    break;
  }

  return { state: removeExpired(next, now, config), phases };
}

/** Disconnected players are removed only outside a round: during a round their score is needed. */
function removeExpired(state: RoomState, now: number, config: GameConfig): RoomState {
  if (state.phase !== 'lobby' && state.phase !== 'results') return state;

  const expired = Object.entries(state.players)
    .filter(
      ([, player]) =>
        player.connections === 0 &&
        player.disconnectedAt !== null &&
        player.disconnectedAt + config.reconnectGraceMs <= now,
    )
    .map(([playerId]) => playerId);

  if (expired.length === 0) return state;

  const players = { ...state.players };
  for (const playerId of expired) delete players[playerId];

  return {
    ...state,
    players,
    hosts: state.hosts.filter((playerId) => !expired.includes(playerId)),
  };
}
```

- [ ] **Step 4: Confirm the tests pass**

Run: `pnpm --filter @clicker/game test`
Expected: `Test Files 3 passed (3)`, `Tests 11 passed (11)`.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/game
git commit -m "feat(game): advance room state over time"
```

---

### Task 5: The `join` command and the `apply` entry point

**Files:**
- Create: `packages/game/src/commands.ts`, `packages/game/src/apply.ts`
- Modify: `packages/game/test/advance.test.ts` (add a block about `apply` at the end of the file)
- Test: `packages/game/test/join.test.ts`

- [ ] **Step 1: Write the failing test `packages/game/test/join.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply';
import { createRoomState } from '../src/state';
import { config, deepFreeze } from './support';

describe('join', () => {
  it('adds a new player and answers with welcome', () => {
    const state = deepFreeze(createRoomState());

    const result = apply(state, { type: 'join', playerId: 'secret-1', name: 'Аня' }, 1000);

    expect(result.state.players['secret-1']).toMatchObject({
      publicId: '1',
      name: 'Аня',
      connections: 1,
      clicks: 0,
      disconnectedAt: null,
    });
    expect(result.state.nextSeq).toBe(2);
    expect(result.events).toEqual([
      { type: 'welcome', playerId: 'secret-1', publicId: '1', isHost: false },
    ]);
  });

  it('does not mutate the input state', () => {
    const state = deepFreeze(createRoomState());

    apply(state, { type: 'join', playerId: 'secret-1', name: 'Аня' }, 1000);

    expect(state.players).toEqual({});
    expect(state.nextSeq).toBe(1);
  });

  it('counts a second tab as one more connection of the same player', () => {
    const first = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня' },
      1000,
    );

    const second = apply(first.state, { type: 'join', playerId: 'secret-1', name: 'Аня' }, 2000);

    expect(Object.keys(second.state.players)).toEqual(['secret-1']);
    expect(second.state.players['secret-1']?.connections).toBe(2);
    expect(second.state.players['secret-1']?.publicId).toBe('1');
  });

  it('keeps the score and clears disconnectedAt when a player comes back', () => {
    const joined = apply(createRoomState(), { type: 'join', playerId: 'secret-1', name: 'Аня' }, 0);
    const left = apply(joined.state, { type: 'leave', playerId: 'secret-1' }, 1000);

    const back = apply(left.state, { type: 'join', playerId: 'secret-1', name: 'Аня Б' }, 2000);

    expect(back.state.players['secret-1']).toMatchObject({
      name: 'Аня Б',
      connections: 1,
      disconnectedAt: null,
    });
  });

  it('rejects a new player when the room is full', () => {
    const full = config({ maxPlayers: 1 });
    const first = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня' },
      0,
      full,
    );

    const second = apply(
      first.state,
      { type: 'join', playerId: 'secret-2', name: 'Боря' },
      0,
      full,
    );

    expect(Object.keys(second.state.players)).toEqual(['secret-1']);
    expect(second.events).toEqual([{ type: 'rejected', playerId: 'secret-2', code: 'room_full' }]);
  });

  it('claims the host key on the first join that carries one', () => {
    const result = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      0,
    );

    expect(result.state.hostKey).toBe('key-1');
    expect(result.state.hosts).toEqual(['secret-1']);
    expect(result.events).toEqual([
      { type: 'welcome', playerId: 'secret-1', publicId: '1', isHost: true },
    ]);
  });

  it('grants host to anyone who brings the same key, without duplicates', () => {
    const host = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      0,
    );

    const secondDevice = apply(
      host.state,
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      1000,
    );

    expect(secondDevice.state.hosts).toEqual(['secret-1']);
  });

  it('lets a wrong key in as a regular player', () => {
    const host = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      0,
    );

    const guest = apply(
      host.state,
      { type: 'join', playerId: 'secret-2', name: 'Боря', hostKey: 'wrong' },
      0,
    );

    expect(guest.state.hostKey).toBe('key-1');
    expect(guest.state.hosts).toEqual(['secret-1']);
    expect(guest.events).toEqual([
      { type: 'welcome', playerId: 'secret-2', publicId: '2', isHost: false },
    ]);
  });
});
```

- [ ] **Step 2: Confirm the test fails**

Run: `pnpm --filter @clicker/game test`
Expected: FAIL, `Cannot find module "../src/apply"`.

- [ ] **Step 3: Create `packages/game/src/commands.ts`**

```ts
import type { Phase } from './state';

export interface JoinCommand {
  type: 'join';
  playerId: string;
  name: string;
  hostKey?: string;
}

export type Command =
  | JoinCommand
  | { type: 'leave'; playerId: string }
  | { type: 'start'; playerId: string }
  | { type: 'click'; playerId: string }
  | { type: 'tick' };

export type ErrorCode = 'not_joined' | 'not_host' | 'wrong_phase' | 'room_full';

export type GameEvent =
  | { type: 'welcome'; playerId: string; publicId: string; isHost: boolean }
  | { type: 'rejected'; playerId: string; code: ErrorCode }
  | { type: 'phaseChanged'; phase: Phase };
```

- [ ] **Step 4: Create `packages/game/src/apply.ts` handling `tick`, `join` and `leave`**

`leave` is needed right now: without it the return of a player cannot be checked. The other commands are added in the following tasks.

```ts
import { advance } from './advance';
import type { Command, ErrorCode, GameEvent, JoinCommand } from './commands';
import { DEFAULT_CONFIG, type GameConfig } from './config';
import type { Player, RoomState } from './state';

export interface ApplyResult {
  state: RoomState;
  events: GameEvent[];
}

/**
 * The single point where the room state changes.
 * The input state is not mutated, time arrives as a parameter.
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
      return leave(state, command.playerId, now);
    default:
      return { state, events: [] };
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
  let player: Player;

  if (existing !== undefined) {
    player = {
      ...existing,
      name: command.name,
      connections: existing.connections + 1,
      disconnectedAt: null,
    };
  } else {
    if (Object.keys(state.players).length >= config.maxPlayers) {
      return reject(state, command.playerId, 'room_full');
    }
    player = {
      publicId: String(state.nextSeq),
      name: command.name,
      connections: 1,
      disconnectedAt: null,
      clicks: 0,
      lastCountedAt: null,
      bucket: { tokens: config.burst, updatedAt: now },
    };
    nextSeq = state.nextSeq + 1;
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
    state: { ...withPlayer(state, command.playerId, player), nextSeq, hostKey, hosts },
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

function leave(state: RoomState, playerId: string, now: number): ApplyResult {
  const player = state.players[playerId];
  if (player === undefined) return { state, events: [] };

  const connections = Math.max(0, player.connections - 1);
  return {
    state: withPlayer(state, playerId, {
      ...player,
      connections,
      disconnectedAt: connections === 0 ? now : player.disconnectedAt,
    }),
    events: [],
  };
}
```

- [ ] **Step 5: Append a check of the `apply` events to the end of `packages/game/test/advance.test.ts`**

Add the `apply` import as the second import (`import { apply } from '../src/apply';` after the `advance` import) and a block at the end of the file:

```ts
describe('apply', () => {
  it('reports the phases it walked through before handling the command', () => {
    const result = apply(countdown(), { type: 'click', playerId: 'nobody' }, 4000, CONFIG);

    expect(result.events).toEqual([
      { type: 'phaseChanged', phase: 'running' },
      { type: 'rejected', playerId: 'nobody', code: 'not_joined' },
    ]);
  });
});
```

This test fails: `click` is not handled yet. That is expected — it turns green in Task 8, when click handling appears.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @clicker/game test`
Expected: PASS for all the `join` tests, FAIL for exactly one — `apply > reports the phases it walked through before handling the command`, because an empty list of events arrives instead of `rejected`.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add packages/game
git commit -m "feat(game): handle join and leave"
```

---

### Task 6: Player disconnect

**Files:**
- Test: `packages/game/test/leave.test.ts`

The `leave` code was already written in Task 5; here we cover it with tests.

- [ ] **Step 1: Write the test `packages/game/test/leave.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply';
import { createRoomState } from '../src/state';

function withPlayer() {
  return apply(createRoomState(), { type: 'join', playerId: 'secret-1', name: 'Аня' }, 0).state;
}

describe('leave', () => {
  it('marks the player as disconnected when the last connection closes', () => {
    const result = apply(withPlayer(), { type: 'leave', playerId: 'secret-1' }, 5000);

    expect(result.state.players['secret-1']).toMatchObject({
      connections: 0,
      disconnectedAt: 5000,
    });
  });

  it('keeps the player connected while another tab is open', () => {
    const twoTabs = apply(
      withPlayer(),
      { type: 'join', playerId: 'secret-1', name: 'Аня' },
      1000,
    ).state;

    const result = apply(twoTabs, { type: 'leave', playerId: 'secret-1' }, 5000);

    expect(result.state.players['secret-1']).toMatchObject({
      connections: 1,
      disconnectedAt: null,
    });
  });

  it('ignores an unknown player', () => {
    const state = withPlayer();

    const result = apply(state, { type: 'leave', playerId: 'nobody' }, 5000);

    expect(result.state.players).toEqual(state.players);
    expect(result.events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @clicker/game test`
Expected: all three `leave` tests pass; only the `apply` test from Task 5 still fails.

- [ ] **Step 3: Commit**

```bash
pnpm format
git add packages/game
git commit -m "test(game): cover leaving and reconnecting"
```

---

### Task 7: Starting a round

**Files:**
- Modify: `packages/game/src/apply.ts`
- Test: `packages/game/test/start.test.ts`

- [ ] **Step 1: Write the failing test `packages/game/test/start.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply';
import { createRoomState, type RoomState } from '../src/state';
import { config } from './support';

const CONFIG = config({ countdownMs: 3000, roundMs: 10000 });

/** Host "secret-1" and ordinary player "secret-2" in the lobby. */
function lobby(): RoomState {
  const host = apply(
    createRoomState(),
    { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
    0,
    CONFIG,
  );
  return apply(host.state, { type: 'join', playerId: 'secret-2', name: 'Боря' }, 0, CONFIG).state;
}

describe('start', () => {
  it('opens the countdown and plans the round', () => {
    const result = apply(lobby(), { type: 'start', playerId: 'secret-1' }, 1000, CONFIG);

    expect(result.state.phase).toBe('countdown');
    expect(result.state.round).toEqual({ goAt: 4000, endsAt: 14000 });
    expect(result.events).toEqual([{ type: 'phaseChanged', phase: 'countdown' }]);
  });

  it('resets scores and refills the buckets from the go moment', () => {
    const played: RoomState = {
      ...lobby(),
      phase: 'results',
      results: [],
    };
    const scored: RoomState = {
      ...played,
      players: {
        ...played.players,
        'secret-1': {
          ...(played.players['secret-1'] as NonNullable<(typeof played.players)['secret-1']>),
          clicks: 42,
          lastCountedAt: 900,
        },
      },
    };

    const result = apply(scored, { type: 'start', playerId: 'secret-1' }, 1000, CONFIG);

    expect(result.state.players['secret-1']).toMatchObject({
      clicks: 0,
      lastCountedAt: null,
      bucket: { tokens: CONFIG.burst, updatedAt: 4000 },
    });
    expect(result.state.results).toBeNull();
  });

  it('refuses a player who is not the host', () => {
    const result = apply(lobby(), { type: 'start', playerId: 'secret-2' }, 1000, CONFIG);

    expect(result.state.phase).toBe('lobby');
    expect(result.events).toEqual([{ type: 'rejected', playerId: 'secret-2', code: 'not_host' }]);
  });

  it('refuses an unknown player', () => {
    const result = apply(lobby(), { type: 'start', playerId: 'nobody' }, 1000, CONFIG);

    expect(result.events).toEqual([{ type: 'rejected', playerId: 'nobody', code: 'not_joined' }]);
  });

  it('refuses a second start while the round is on', () => {
    const started = apply(lobby(), { type: 'start', playerId: 'secret-1' }, 1000, CONFIG);

    const again = apply(started.state, { type: 'start', playerId: 'secret-1' }, 2000, CONFIG);

    expect(again.events).toEqual([{ type: 'rejected', playerId: 'secret-1', code: 'wrong_phase' }]);
  });

  it('allows the next round straight from the results screen', () => {
    const started = apply(lobby(), { type: 'start', playerId: 'secret-1' }, 1000, CONFIG);
    const finished = apply(started.state, { type: 'tick' }, 14250, CONFIG);
    expect(finished.state.phase).toBe('results');

    const again = apply(finished.state, { type: 'start', playerId: 'secret-1' }, 15000, CONFIG);

    expect(again.state.phase).toBe('countdown');
    expect(again.state.round).toEqual({ goAt: 18000, endsAt: 28000 });
  });
});
```

- [ ] **Step 2: Confirm the tests fail**

Run: `pnpm --filter @clicker/game test`
Expected: FAIL for six `start` tests — the state stays in the lobby, there are no events.

- [ ] **Step 3: Add a `start` branch to `handle` in `packages/game/src/apply.ts`**

In `handle`, replace the `default:` line with the `start` branch, leaving `default` for the not yet implemented `click`:

```ts
    case 'start':
      return start(state, command.playerId, now, config);
    default:
      return { state, events: [] };
```

- [ ] **Step 4: Add the `start` function to the end of `packages/game/src/apply.ts`**

```ts
function start(state: RoomState, playerId: string, now: number, config: GameConfig): ApplyResult {
  if (state.players[playerId] === undefined) return reject(state, playerId, 'not_joined');
  if (!state.hosts.includes(playerId)) return reject(state, playerId, 'not_host');
  if (state.phase !== 'lobby' && state.phase !== 'results')
    return reject(state, playerId, 'wrong_phase');

  const goAt = now + config.countdownMs;
  const endsAt = goAt + config.roundMs;
  const players: Record<string, Player> = {};
  for (const [id, player] of Object.entries(state.players)) {
    players[id] = {
      ...player,
      clicks: 0,
      lastCountedAt: null,
      bucket: { tokens: config.burst, updatedAt: goAt },
    };
  }

  return {
    state: {
      ...state,
      phase: 'countdown',
      round: { goAt, endsAt },
      players,
      results: null,
      notice: null,
    },
    events: [{ type: 'phaseChanged', phase: 'countdown' }],
  };
}
```

- [ ] **Step 5: Confirm the tests pass**

Run: `pnpm --filter @clicker/game test`
Expected: all `start` tests are green; only the `apply` test from Task 5 fails.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add packages/game
git commit -m "feat(game): handle round start"
```

---

### Task 8: Counting clicks with a token bucket

**Files:**
- Modify: `packages/game/src/apply.ts`
- Test: `packages/game/test/click.test.ts`

- [ ] **Step 1: Write the failing test `packages/game/test/click.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply';
import { createRoomState, type RoomState } from '../src/state';
import { config } from './support';

const CONFIG = config({ countdownMs: 3000, roundMs: 10000, burst: 15, clicksPerSecond: 15 });
const GO_AT = 4000;
const ENDS_AT = 14000;

/** A host in the room, the round started at 1000: countdown until 4000, end at 14000. */
function started(): RoomState {
  const host = apply(
    createRoomState(),
    { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
    0,
    CONFIG,
  );
  return apply(host.state, { type: 'start', playerId: 'secret-1' }, 1000, CONFIG).state;
}

function clickTimes(state: RoomState, times: number[]): RoomState {
  let next = state;
  for (const time of times) {
    next = apply(next, { type: 'click', playerId: 'secret-1' }, time, CONFIG).state;
  }
  return next;
}

describe('click', () => {
  it('is ignored during the countdown, without an error', () => {
    const result = apply(started(), { type: 'click', playerId: 'secret-1' }, 2000, CONFIG);

    expect(result.state.players['secret-1']?.clicks).toBe(0);
    expect(result.events).toEqual([]);
  });

  it('counts a click inside the round', () => {
    const result = apply(started(), { type: 'click', playerId: 'secret-1' }, GO_AT, CONFIG);

    expect(result.state.phase).toBe('running');
    expect(result.state.players['secret-1']).toMatchObject({ clicks: 1, lastCountedAt: GO_AT });
  });

  it('counts a click that arrives inside the late grace window', () => {
    const result = apply(started(), { type: 'click', playerId: 'secret-1' }, ENDS_AT + 249, CONFIG);

    expect(result.state.players['secret-1']?.clicks).toBe(1);
  });

  it('ignores a click that arrives after the grace window', () => {
    const result = apply(started(), { type: 'click', playerId: 'secret-1' }, ENDS_AT + 250, CONFIG);

    expect(result.state.phase).toBe('results');
    expect(result.state.results?.[0]?.clicks).toBe(0);
  });

  it('lets a burst of 15 clicks through at the same instant and stops the 16th', () => {
    const times = Array.from({ length: 16 }, () => GO_AT);

    const state = clickTimes(started(), times);

    expect(state.players['secret-1']?.clicks).toBe(15);
  });

  it('refills the bucket over time', () => {
    const spent = clickTimes(
      started(),
      Array.from({ length: 16 }, () => GO_AT),
    );

    const later = apply(spent, { type: 'click', playerId: 'secret-1' }, GO_AT + 100, CONFIG);

    expect(later.state.players['secret-1']?.clicks).toBe(16);
  });

  it('refuses a click from an unknown player', () => {
    const running = apply(started(), { type: 'tick' }, GO_AT, CONFIG).state;

    const result = apply(running, { type: 'click', playerId: 'nobody' }, GO_AT + 10, CONFIG);

    expect(result.events).toEqual([{ type: 'rejected', playerId: 'nobody', code: 'not_joined' }]);
  });
});
```

- [ ] **Step 2: Confirm the tests fail**

Run: `pnpm --filter @clicker/game test`
Expected: FAIL for the `click` tests that expect a counted click or a rejection.

- [ ] **Step 3: Replace `default` with the `click` branch in `handle` in `packages/game/src/apply.ts`**

Now all the commands are handled, and `default` is no longer needed:

```ts
function handle(state: RoomState, command: Command, now: number, config: GameConfig): ApplyResult {
  switch (command.type) {
    case 'tick':
      return { state, events: [] };
    case 'join':
      return join(state, command, now, config);
    case 'leave':
      return leave(state, command.playerId, now);
    case 'start':
      return start(state, command.playerId, now, config);
    case 'click':
      return click(state, command.playerId, now, config);
  }
}
```

- [ ] **Step 4: Add the `click` function to the end of `packages/game/src/apply.ts`**

```ts
function click(state: RoomState, playerId: string, now: number, config: GameConfig): ApplyResult {
  const player = state.players[playerId];
  if (player === undefined) return reject(state, playerId, 'not_joined');
  // A click outside a round is not an error: the client may not have learned of the end in time.
  if (state.phase !== 'running') return { state, events: [] };

  const elapsed = Math.max(0, now - player.bucket.updatedAt);
  const tokens = Math.min(
    config.burst,
    player.bucket.tokens + (elapsed * config.clicksPerSecond) / 1000,
  );

  if (tokens < 1) {
    return {
      state: withPlayer(state, playerId, { ...player, bucket: { tokens, updatedAt: now } }),
      events: [],
    };
  }

  return {
    state: withPlayer(state, playerId, {
      ...player,
      clicks: player.clicks + 1,
      lastCountedAt: now,
      bucket: { tokens: tokens - 1, updatedAt: now },
    }),
    events: [],
  };
}
```

- [ ] **Step 5: Confirm all the package's tests pass, including the one postponed from Task 5**

Run: `pnpm --filter @clicker/game test`
Expected: `Test Files 7 passed (7)`, `Tests 36 passed (36)`.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add packages/game
git commit -m "feat(game): count clicks with a token bucket"
```

---

### Task 9: The nearest deadline for the alarm

**Files:**
- Create: `packages/game/src/deadline.ts`
- Test: `packages/game/test/deadline.test.ts`

- [ ] **Step 1: Write the failing test `packages/game/test/deadline.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply';
import { nextDeadline } from '../src/deadline';
import { createRoomState } from '../src/state';
import { config } from './support';

const CONFIG = config({
  countdownMs: 3000,
  roundMs: 10000,
  lateGraceMs: 250,
  reconnectGraceMs: 30000,
});

describe('nextDeadline', () => {
  it('has nothing to wait for in an empty lobby', () => {
    expect(nextDeadline(createRoomState(), CONFIG)).toBeNull();
  });

  it('waits for the go moment during the countdown', () => {
    const joined = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      0,
      CONFIG,
    );
    const started = apply(joined.state, { type: 'start', playerId: 'secret-1' }, 1000, CONFIG);

    expect(nextDeadline(started.state, CONFIG)).toBe(4000);
  });

  it('waits for the end of the round plus the grace window', () => {
    const joined = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      0,
      CONFIG,
    );
    const started = apply(joined.state, { type: 'start', playerId: 'secret-1' }, 1000, CONFIG);
    const running = apply(started.state, { type: 'tick' }, 4000, CONFIG);

    expect(nextDeadline(running.state, CONFIG)).toBe(14250);
  });

  it('waits to drop a disconnected player in the lobby', () => {
    const joined = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня' },
      0,
      CONFIG,
    );
    const left = apply(joined.state, { type: 'leave', playerId: 'secret-1' }, 1000, CONFIG);

    expect(nextDeadline(left.state, CONFIG)).toBe(31000);
  });

  it('takes the earliest of several deadlines', () => {
    const first = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня' },
      0,
      CONFIG,
    );
    const second = apply(
      first.state,
      { type: 'join', playerId: 'secret-2', name: 'Боря' },
      0,
      CONFIG,
    );
    const leftFirst = apply(second.state, { type: 'leave', playerId: 'secret-1' }, 1000, CONFIG);
    const leftSecond = apply(
      leftFirst.state,
      { type: 'leave', playerId: 'secret-2' },
      2000,
      CONFIG,
    );

    expect(nextDeadline(leftSecond.state, CONFIG)).toBe(31000);
  });
});
```

- [ ] **Step 2: Confirm the test fails**

Run: `pnpm --filter @clicker/game test`
Expected: FAIL, `Cannot find module "../src/deadline"`.

- [ ] **Step 3: Create `packages/game/src/deadline.ts`**

```ts
import { DEFAULT_CONFIG, type GameConfig } from './config';
import type { RoomState } from './state';

/**
 * The nearest moment at which the state must change by itself.
 * The server sets a Durable Object alarm for it.
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
      if (player.connections === 0 && player.disconnectedAt !== null) {
        candidates.push(player.disconnectedAt + config.reconnectGraceMs);
      }
    }
  }

  return candidates.length === 0 ? null : Math.min(...candidates);
}
```

- [ ] **Step 4: Confirm the tests pass**

Run: `pnpm --filter @clicker/game test`
Expected: `Test Files 8 passed (8)`, `Tests 41 passed (41)`.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/game
git commit -m "feat(game): expose the next deadline"
```

---

### Task 10: Recovery after a server restart

**Files:**
- Create: `packages/game/src/recovery.ts`
- Test: `packages/game/test/recovery.test.ts`

- [ ] **Step 1: Write the failing test `packages/game/test/recovery.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply';
import { abortRound, syncConnections } from '../src/recovery';
import { createRoomState, type RoomState } from '../src/state';
import { config, deepFreeze } from './support';

const CONFIG = config({ countdownMs: 3000, roundMs: 10000 });

function running(): RoomState {
  const joined = apply(
    createRoomState(),
    { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
    0,
    CONFIG,
  );
  const started = apply(joined.state, { type: 'start', playerId: 'secret-1' }, 1000, CONFIG);
  return apply(started.state, { type: 'tick' }, 4000, CONFIG).state;
}

describe('abortRound', () => {
  it('returns everybody to the lobby with a notice', () => {
    const state = deepFreeze(running());

    const aborted = abortRound(state);

    expect(aborted.phase).toBe('lobby');
    expect(aborted.round).toBeNull();
    expect(aborted.notice).toBe('round_aborted');
    expect(state.phase).toBe('running');
  });
});

describe('syncConnections', () => {
  it('marks a player without live connections as disconnected', () => {
    const state = deepFreeze(running());

    const synced = syncConnections(state, {}, 9000);

    expect(synced.players['secret-1']).toMatchObject({ connections: 0, disconnectedAt: 9000 });
  });

  it('keeps the earlier disconnect time', () => {
    const joined = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня' },
      0,
      CONFIG,
    );
    const left = apply(joined.state, { type: 'leave', playerId: 'secret-1' }, 1000, CONFIG);

    const synced = syncConnections(left.state, {}, 9000);

    expect(synced.players['secret-1']?.disconnectedAt).toBe(1000);
  });

  it('restores a player who has live connections', () => {
    const joined = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня' },
      0,
      CONFIG,
    );
    const left = apply(joined.state, { type: 'leave', playerId: 'secret-1' }, 1000, CONFIG);

    const synced = syncConnections(left.state, { 'secret-1': 2 }, 9000);

    expect(synced.players['secret-1']).toMatchObject({ connections: 2, disconnectedAt: null });
  });
});
```

- [ ] **Step 2: Confirm the test fails**

Run: `pnpm --filter @clicker/game test`
Expected: FAIL, `Cannot find module "../src/recovery"`.

- [ ] **Step 3: Create `packages/game/src/recovery.ts`**

```ts
import type { Player, RoomState } from './state';

/**
 * The round is aborted: the server restarted and the clicks held in memory are lost.
 */
export function abortRound(state: RoomState): RoomState {
  return { ...state, phase: 'lobby', round: null, notice: 'round_aborted' };
}

/**
 * Recounts the number of connections after a wake-up or a server restart.
 * `counts` — how many live connections each playerId has right now.
 */
export function syncConnections(
  state: RoomState,
  counts: Record<string, number>,
  now: number,
): RoomState {
  const players: Record<string, Player> = {};
  for (const [playerId, player] of Object.entries(state.players)) {
    const connections = counts[playerId] ?? 0;
    players[playerId] = {
      ...player,
      connections,
      disconnectedAt: connections > 0 ? null : (player.disconnectedAt ?? now),
    };
  }
  return { ...state, players };
}
```

- [ ] **Step 4: Confirm the tests pass**

Run: `pnpm --filter @clicker/game test`
Expected: `Test Files 9 passed (9)`, `Tests 45 passed (45)`.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/game
git commit -m "feat(game): recover state after a restart"
```

---

### Task 11: The public entry point of the game package

**Files:**
- Create: `packages/game/src/index.ts`

- [ ] **Step 1: Create `packages/game/src/index.ts`**

```ts
export { type ApplyResult, apply } from './apply';
export type { Command, ErrorCode, GameEvent, JoinCommand } from './commands';
export { DEFAULT_CONFIG, type GameConfig } from './config';
export { nextDeadline } from './deadline';
export { abortRound, syncConnections } from './recovery';
export type { Bucket, Notice, Phase, Player, ResultRow, RoomState, Round } from './state';
export { createRoomState } from './state';
```

`advance` and `computeResults` are not exported: they are called only inside `apply`.

- [ ] **Step 2: Check the types and the tests**

Run: `pnpm --filter @clicker/game typecheck && pnpm --filter @clicker/game test`
Expected: `tsc --noEmit` prints nothing, `Tests 45 passed (45)`.

- [ ] **Step 3: Commit**

```bash
pnpm format
git add packages/game
git commit -m "feat(game): expose the package entry point"
```

---

### Task 12: The packages/protocol package and identifiers

**Files:**
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/src/ids.ts`
- Test: `packages/protocol/test/ids.test.ts`

- [ ] **Step 1: Create `packages/protocol/package.json`**

```json
{
  "name": "@clicker/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@clicker/game": "workspace:*",
    "valibot": "1.5.0"
  },
  "devDependencies": {
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

- [ ] **Step 2: Create `packages/protocol/tsconfig.json`**

`dom` in `lib` is needed for `crypto.getRandomValues`, `btoa` and `TextEncoder`: these APIs exist both in the browser and in Workers.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["es2022", "dom"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install the dependencies**

Run: `pnpm install`
Expected: `Scope: all 3 workspace projects`, valibot 1.5.0 gets installed, `@clicker/game` is linked from the workspace.

- [ ] **Step 4: Write the failing test `packages/protocol/test/ids.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { generateId, isId } from '../src/ids';

describe('generateId', () => {
  it('makes a 22 character id that passes the check', () => {
    const id = generateId();

    expect(id).toHaveLength(22);
    expect(isId(id)).toBe(true);
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));

    expect(ids.size).toBe(1000);
  });
});

describe('isId', () => {
  it('rejects a wrong length', () => {
    expect(isId('short')).toBe(false);
    expect(isId('a'.repeat(23))).toBe(false);
  });

  it('rejects characters outside base64url', () => {
    expect(isId(`${'a'.repeat(21)}+`)).toBe(false);
    expect(isId(`${'a'.repeat(21)}/`)).toBe(false);
  });
});
```

- [ ] **Step 5: Confirm the test fails**

Run: `pnpm --filter @clicker/protocol test`
Expected: FAIL, `Cannot find module "../src/ids"`.

- [ ] **Step 6: Create `packages/protocol/src/ids.ts`**

```ts
/** 16 16 random bytes in base64url: 22 characters. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
```

- [ ] **Step 7: Confirm the tests pass**

Run: `pnpm --filter @clicker/protocol test`
Expected: `Test Files 1 passed (1)`, `Tests 4 passed (4)`.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add packages/protocol pnpm-lock.yaml
git commit -m "feat(protocol): add id helpers"
```

---

### Task 13: Parsing client messages

**Files:**
- Create: `packages/protocol/src/client.ts`
- Test: `packages/protocol/test/client.test.ts`

- [ ] **Step 1: Write the failing test `packages/protocol/test/client.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_BYTES, parseClientMessage } from '../src/client';
import { generateId } from '../src/ids';

const playerId = generateId();
const hostKey = generateId();

function encode(value: unknown): string {
  return JSON.stringify(value);
}

describe('parseClientMessage', () => {
  it('accepts join with a host key', () => {
    const raw = encode({ type: 'join', playerId, name: 'Аня', hostKey });

    expect(parseClientMessage(raw)).toEqual({ type: 'join', playerId, name: 'Аня', hostKey });
  });

  it('accepts join without a host key', () => {
    const raw = encode({ type: 'join', playerId, name: 'Аня' });

    expect(parseClientMessage(raw)).toEqual({ type: 'join', playerId, name: 'Аня' });
  });

  it('trims the name', () => {
    const raw = encode({ type: 'join', playerId, name: '   Аня   ' });

    expect(parseClientMessage(raw)).toEqual({ type: 'join', playerId, name: 'Аня' });
  });

  it('accepts start and click', () => {
    expect(parseClientMessage(encode({ type: 'start' }))).toEqual({ type: 'start' });
    expect(parseClientMessage(encode({ type: 'click' }))).toEqual({ type: 'click' });
  });

  it('measures the name in code points, not in UTF-16 units', () => {
    const name = '😀'.repeat(11); // 11 characters, but 22 UTF-16 units

    expect(parseClientMessage(encode({ type: 'join', playerId, name }))).not.toBeNull();
  });

  it('rejects an empty name', () => {
    expect(parseClientMessage(encode({ type: 'join', playerId, name: '   ' }))).toBeNull();
  });

  it('rejects a name longer than 20 characters', () => {
    expect(parseClientMessage(encode({ type: 'join', playerId, name: 'a'.repeat(21) }))).toBeNull();
  });

  it('rejects a malformed player id', () => {
    expect(parseClientMessage(encode({ type: 'join', playerId: 'nope', name: 'Аня' }))).toBeNull();
  });

  it('rejects unknown fields', () => {
    expect(parseClientMessage(encode({ type: 'click', extra: 1 }))).toBeNull();
  });

  it('rejects an unknown message type', () => {
    expect(parseClientMessage(encode({ type: 'kick', playerId }))).toBeNull();
  });

  it('rejects broken json', () => {
    expect(parseClientMessage('{')).toBeNull();
  });

  it('rejects an oversized message before parsing it', () => {
    const raw = `"${'x'.repeat(MAX_MESSAGE_BYTES)}"`;

    expect(parseClientMessage(raw)).toBeNull();
  });
});
```

- [ ] **Step 2: Confirm the test fails**

Run: `pnpm --filter @clicker/protocol test`
Expected: FAIL, `Cannot find module "../src/client"`.

- [ ] **Step 3: Create `packages/protocol/src/client.ts`**

```ts
import * as v from 'valibot';
import { ID_PATTERN } from './ids';

/** Anything longer never reaches parsing. */
export const MAX_MESSAGE_BYTES = 1024;
export const MAX_NAME_LENGTH = 20;

const idSchema = v.pipe(v.string(), v.regex(ID_PATTERN));

/** The nickname is stored trimmed, the length is counted in code points. */
const nameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.check((value) => {
    const length = [...value].length;
    return length >= 1 && length <= MAX_NAME_LENGTH;
  }, 'name must be 1..20 characters'),
);

export const joinSchema = v.strictObject({
  type: v.literal('join'),
  playerId: idSchema,
  name: nameSchema,
  hostKey: v.optional(idSchema),
});

export const startSchema = v.strictObject({ type: v.literal('start') });

export const clickSchema = v.strictObject({ type: v.literal('click') });

export const clientMessageSchema = v.variant('type', [joinSchema, startSchema, clickSchema]);

export type ClientMessage = v.InferOutput<typeof clientMessageSchema>;
export type JoinMessage = v.InferOutput<typeof joinSchema>;

export function parseClientMessage(raw: string): ClientMessage | null {
  if (new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = v.safeParse(clientMessageSchema, data);
  return result.success ? result.output : null;
}
```

- [ ] **Step 4: Confirm the tests pass**

Run: `pnpm --filter @clicker/protocol test`
Expected: `Test Files 2 passed (2)`, `Tests 16 passed (16)`.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/protocol
git commit -m "feat(protocol): parse client messages"
```

---

### Task 14: Server messages and the state snapshot

**Files:**
- Create: `packages/protocol/src/server.ts`
- Test: `packages/protocol/test/server.test.ts`

- [ ] **Step 1: Write the failing test `packages/protocol/test/server.test.ts`**

```ts
import { apply, createRoomState, type RoomState } from '@clicker/game';
import { describe, expect, it } from 'vitest';
import { parseServerMessage, toSnapshot } from '../src/server';

/** Host "secret-1" and player "secret-2", the round has been played. */
function playedRoom(): RoomState {
  const host = apply(
    createRoomState(),
    { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
    0,
  );
  const guest = apply(host.state, { type: 'join', playerId: 'secret-2', name: 'Боря' }, 0);
  const started = apply(guest.state, { type: 'start', playerId: 'secret-1' }, 1000);
  const clicked = apply(started.state, { type: 'click', playerId: 'secret-2' }, 5000);
  return apply(clicked.state, { type: 'tick' }, 999_999).state;
}

describe('toSnapshot', () => {
  it('shows public ids and hides the secrets', () => {
    const snapshot = toSnapshot(playedRoom(), 5000);
    const json = JSON.stringify(snapshot);

    expect(snapshot.players.map((player) => player.id)).toEqual(['1', '2']);
    expect(json).not.toContain('secret-1');
    expect(json).not.toContain('key-1');
  });

  it('sorts players by id as numbers', () => {
    let state = createRoomState();
    for (let index = 1; index <= 12; index += 1) {
      state = apply(
        state,
        { type: 'join', playerId: `secret-${index}`, name: `p${index}` },
        0,
      ).state;
    }
    const reversed: RoomState = {
      ...state,
      players: Object.fromEntries(Object.entries(state.players).reverse()),
    };

    const snapshot = toSnapshot(reversed, 0);

    expect(snapshot.players.map((player) => player.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ]);
  });

  it('carries the results of the finished round', () => {
    const snapshot = toSnapshot(playedRoom(), 999_999);

    expect(snapshot.phase).toBe('results');
    expect(snapshot.round).toBeNull();
    expect(snapshot.results).toEqual([
      { id: '2', name: 'Боря', clicks: 1, rank: 1 },
      { id: '1', name: 'Аня', clicks: 0, rank: 2 },
    ]);
  });

  it('reports the live round while it is on', () => {
    const host = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      0,
    );
    const started = apply(host.state, { type: 'start', playerId: 'secret-1' }, 1000);

    const snapshot = toSnapshot(started.state, 1000);

    expect(snapshot.phase).toBe('countdown');
    expect(snapshot.round).toEqual({ goAt: 4000, endsAt: 14000 });
    expect(snapshot.results).toBeNull();
    expect(snapshot.notice).toBeNull();
  });

  it('passes its own schema', () => {
    const snapshot = toSnapshot(playedRoom(), 42);

    expect(parseServerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe('parseServerMessage', () => {
  it('accepts welcome and error', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'welcome', you: '1', isHost: true }))).toEqual(
      {
        type: 'welcome',
        you: '1',
        isHost: true,
      },
    );
    expect(parseServerMessage(JSON.stringify({ type: 'error', code: 'not_host' }))).toEqual({
      type: 'error',
      code: 'not_host',
    });
  });

  it('rejects an unknown error code', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'error', code: 'nope' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Confirm the test fails**

Run: `pnpm --filter @clicker/protocol test`
Expected: FAIL, `Cannot find module "../src/server"`.

- [ ] **Step 3: Create `packages/protocol/src/server.ts`**

```ts
import type { RoomState } from '@clicker/game';
import * as v from 'valibot';
import { MAX_MESSAGE_BYTES } from './client';

const phaseSchema = v.picklist(['lobby', 'countdown', 'running', 'results']);

const errorCodeSchema = v.picklist([
  'not_joined',
  'not_host',
  'wrong_phase',
  'room_full',
  'invalid_message',
]);

export const welcomeSchema = v.strictObject({
  type: v.literal('welcome'),
  you: v.string(),
  isHost: v.boolean(),
});

export const snapshotSchema = v.strictObject({
  type: v.literal('snapshot'),
  serverNow: v.number(),
  phase: phaseSchema,
  players: v.array(
    v.strictObject({
      id: v.string(),
      name: v.string(),
      clicks: v.number(),
      connected: v.boolean(),
    }),
  ),
  round: v.nullable(v.strictObject({ goAt: v.number(), endsAt: v.number() })),
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
  notice: v.nullable(v.literal('round_aborted')),
});

export const errorSchema = v.strictObject({
  type: v.literal('error'),
  code: errorCodeSchema,
});

export const serverMessageSchema = v.variant('type', [welcomeSchema, snapshotSchema, errorSchema]);

export type ServerMessage = v.InferOutput<typeof serverMessageSchema>;
export type SnapshotMessage = v.InferOutput<typeof snapshotSchema>;
export type ServerErrorCode = v.InferOutput<typeof errorCodeSchema>;

export function parseServerMessage(raw: string): ServerMessage | null {
  if (new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES * 64) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = v.safeParse(serverMessageSchema, data);
  return result.success ? result.output : null;
}

/** The secret playerId and hostKey do not go out. */
export function toSnapshot(state: RoomState, now: number): SnapshotMessage {
  return {
    type: 'snapshot',
    serverNow: now,
    phase: state.phase,
    players: Object.values(state.players)
      .map((player) => ({
        id: player.publicId,
        name: player.name,
        clicks: player.clicks,
        connected: player.connections > 0,
      }))
      .sort((a, b) => Number(a.id) - Number(b.id)),
    round: state.round === null ? null : { goAt: state.round.goAt, endsAt: state.round.endsAt },
    results:
      state.results === null
        ? null
        : state.results.map((row) => ({
            id: row.publicId,
            name: row.name,
            clicks: row.clicks,
            rank: row.rank,
          })),
    notice: state.notice,
  };
}
```

- [ ] **Step 4: Confirm the tests pass**

Run: `pnpm --filter @clicker/protocol test`
Expected: `Test Files 3 passed (3)`, `Tests 23 passed (23)`.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/protocol
git commit -m "feat(protocol): build and parse server messages"
```

---

### Task 15: The public entry point of the protocol package and the overall check

**Files:**
- Create: `packages/protocol/src/index.ts`

- [ ] **Step 1: Create `packages/protocol/src/index.ts`**

```ts
export {
  type ClientMessage,
  clickSchema,
  clientMessageSchema,
  type JoinMessage,
  joinSchema,
  MAX_MESSAGE_BYTES,
  MAX_NAME_LENGTH,
  parseClientMessage,
  startSchema,
} from './client';
export { generateId, ID_PATTERN, isId } from './ids';
export {
  errorSchema,
  parseServerMessage,
  type ServerErrorCode,
  type ServerMessage,
  type SnapshotMessage,
  serverMessageSchema,
  snapshotSchema,
  toSnapshot,
  welcomeSchema,
} from './server';
```

- [ ] **Step 2: Run all the repository's checks**

```bash
pnpm check
pnpm typecheck
pnpm test
```
Expected:
- `pnpm check`: `Checked N files ... No fixes applied.`
- `pnpm typecheck`: two lines `$ tsc --noEmit` and nothing else;
- `pnpm test`: `Tests 45 passed (45)` for game and `Tests 23 passed (23)` for protocol.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): expose the package entry point"
```

---

### Task 16: CI in GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm typecheck
      - run: pnpm test
```

The pnpm version is taken from the `packageManager` field in the root `package.json`; it does not need to be specified separately.

- [ ] **Step 2: Check that the install reproduces with a frozen lockfile**

Run: `pnpm install --frozen-lockfile`
Expected: `Lockfile is up to date, resolution step is skipped` and `Done in ...`. If the command fails, `pnpm-lock.yaml` was not committed in full.

- [ ] **Step 3: Commit**

```bash
pnpm format
git add .github/workflows/ci.yml
git commit -m "ci: run lint, typecheck and tests on push"
```

---

## Checking the result

Run in the repository root:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
```

Expected:
- the linter and formatter have no remarks;
- both type checks are silent;
- 45 tests in `@clicker/game` and 23 tests in `@clicker/protocol`, zero failures.

Check against the specification sections:
- §5 "Core" — implemented in `packages/game`, including `apply`, `nextDeadline`, `abortRound`, `syncConnections`;
- §6 "Protocol" — implemented in `packages/protocol`, except sending messages: it appears in plan 2 together with the server;
- §10 "Testing" — the items about `packages/game` and `packages/protocol` are closed; the server tests, e2e and deploy belong to plans 2 and 3;
- §11 "Tooling" — pnpm workspaces, TypeScript, Biome and CI are done. Playwright and deploy appear in plan 3.

CI is checked only after the first push to GitHub: the workflow cannot be run locally.

## What I need from you

- **Before the first task:** run `corepack enable pnpm` (Node is installed through nvm, root is not needed).
- **After Task 16:** push the branch to `tjuana/clicker` and check that the "CI" workflow passed. I push only with your permission.
- **Not needed for this plan:** a Cloudflare account, `wrangler login` and a subdomain. They are needed in plan 2, when the server appears.

## What's next

Plan 2 (the server on partyserver): `Room extends Server`, room routing, alarms, snapshot broadcast 10 times a second, integration tests through `@cloudflare/vitest-plugin`, local `wrangler dev`. It is written after this plan is executed: that way the versions of `partyserver`, `wrangler` and the test plugin are checked at the time of writing, not in advance.
