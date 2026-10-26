# Clicker Server Implementation Plan (plan 2 of 3: the room on partyserver)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring up `apps/server` — a Worker with a single room as a Durable Object that accepts players over WebSocket, runs rounds on an alarm and broadcasts state snapshots ten times a second, fully covered by integration tests in the real Workers runtime.

**Architecture:** The room is a class on partyserver on top of a hibernating Durable Object. It holds no game rules: every message becomes a command and goes to `apply` from `@clicker/game`, and state goes out through `toSnapshot` from `@clicker/protocol`. Phase changes are driven by the Durable Object alarm, not by in-memory timers, so a round still ends after the object wakes up.

**Tech Stack:** partyserver 0.5.10, wrangler 4.131.1, @cloudflare/vitest-plugin 1.1.8, Vitest 4.1.11, TypeScript 7.0.2, Node 22, pnpm 12.4.1.

Spec: [2026-09-11-clicker-foundation-design.md](../specs/2026-09-11-clicker-foundation-design.md), sections 4, 7, 9, 10. Plan 1 (the core and the protocol) is done and merged into `main`.

---

## Verified before writing the plan

All the code below was built and run in a temporary folder on this machine: 6 integration tests in the real Workers runtime (workerd), `tsc --noEmit` with no errors, Biome with no findings. The tests connect to the Worker for real, over WebSocket, and play a full round.

Five findings that made the prototype worth building:

1. **In pnpm 12 the permission for build scripts is called `allowBuilds` and lives in `pnpm-workspace.yaml`.** The old `onlyBuiltDependencies` works nowhere: in `package.json` pnpm complains that it no longer reads the `pnpm` field, and in yaml it has been silently ignored since version 11. Until this is fixed, `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`, `workerd` is not unpacked and the server tests do not run. The repository currently has the old variant — Task 1 fixes it.
2. **A phase change must be broadcast at once.** If we rely only on the snapshot timer, clients learn about the start of a round with a delay of up to 100 ms, and a short countdown may not be seen at all. In the prototype a test caught this.
3. **A soft eviction of the object (`evictDurableObject`) during a round does not work:** the object is busy with the broadcast timer, and the eviction waits for it to become free. A restart in the middle of a game is tested with `abortAllDurableObjects()`.
4. **`SELF` and `env` from `cloudflare:test` are marked deprecated** in favour of `exports` and `env` from `cloudflare:workers`, but `exports.default` currently has no `default` type, and `tsc` fails on it. For now we use `SELF` — it works and is typed.
5. **partyserver addresses the room through `idFromName`**, and the name comes from the address `/parties/room/<name>`. This will be useful when a test needs to reach a specific object.

## How to execute

- Branch `feat/server`, working in the repository itself.
- One task, one commit. Conventional Commits, English, **no Claude signatures**.
- The order of the tasks must not change.
- A Cloudflare account is not needed for this plan: the tests run locally in workerd. It is needed only for the deploy in plan 3.

## File structure

```
apps/server/
  package.json           @clicker/server: dependencies and scripts
  wrangler.jsonc         Durable Object binding, SQLite migration, variables
  tsconfig.json          Workers and test plugin types
  vitest.config.ts       runs the tests inside workerd, short round durations
  src/worker.ts          routing of /parties/*, room id check
  src/room.ts            the Room class: connections, commands, alarm, broadcast
  test/support.ts        WebSocket client for the tests
  test/room.test.ts      routing, joining, refusing a non-host, a full round
  test/lifecycle.test.ts connection drop and object restart
```

Also changed: `pnpm-workspace.yaml`, the root `package.json`, `.gitignore`.

---

### Task 1: Prepare the monorepo for apps

**Files:**
- Modify: `pnpm-workspace.yaml`, `package.json`, `.gitignore`

- [ ] **Step 1: Rewrite `pnpm-workspace.yaml` in full**

We add the apps and allow build scripts. The key is exactly `allowBuilds`: the former `onlyBuiltDependencies` has no effect in pnpm 12, either here or in `package.json`.

```yaml
packages:
  - "packages/*"
  - "apps/*"

# Allow build scripts: without them workerd does not start the Workers runtime in the tests.
allowBuilds:
  esbuild: true
  workerd: true
```

- [ ] **Step 2: Make sure the root `package.json` has no `pnpm` field**

If it appears there, pnpm will print a warning on every install that the field is no longer read. Install settings live only in `pnpm-workspace.yaml`.

- [ ] **Step 3: Add the generated Worker types to `.gitignore`**

`worker-configuration.d.ts` is produced by `wrangler types` from `wrangler.jsonc`; git does not need it, and the typecheck script recreates it.

```gitignore
worker-configuration.d.ts
```

- [ ] **Step 4: Check that the workspace is intact**

Run: `pnpm install`
Expected: the install passes with no warnings about the `pnpm` field and no `ERR_PNPM_IGNORED_BUILDS` error.

Run: `pnpm test`
Expected: as before, 60 tests in game and 31 in protocol.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml .gitignore pnpm-lock.yaml
git commit -m "chore: add apps to the workspace and allow workerd build scripts"
```

---

### Task 2: The apps/server package skeleton

**Files:**
- Create: `apps/server/package.json`, `apps/server/wrangler.jsonc`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`

- [ ] **Step 1: Create `apps/server/package.json`**

`typecheck` first recreates the environment types: the file is not kept in git, and CI and the local check must work the same way.

```json
{
  "name": "@clicker/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "types": "wrangler types",
    "typecheck": "wrangler types && tsc --noEmit"
  },
  "dependencies": {
    "@clicker/game": "workspace:*",
    "@clicker/protocol": "workspace:*",
    "partyserver": "0.5.10"
  },
  "devDependencies": {
    "@cloudflare/vitest-plugin": "1.1.8",
    "@cloudflare/workers-types": "5.20260911.1",
    "typescript": "7.0.2",
    "vitest": "4.1.11",
    "wrangler": "4.131.1"
  }
}
```

- [ ] **Step 2: Create `apps/server/wrangler.jsonc`**

Serving the built client will arrive in plan 3 together with the client itself; for now the Worker serves only `/parties/*`.

```jsonc
{
  "name": "clicker",
  "main": "src/worker.ts",
  "compatibility_date": "2026-09-11",
  "durable_objects": {
    "bindings": [{ "name": "Room", "class_name": "Room" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }],
  "vars": { "COUNTDOWN_MS": "3000", "ROUND_MS": "10000" }
}
```

- [ ] **Step 3: Create `apps/server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-plugin/types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test", "vitest.config.ts", "worker-configuration.d.ts"]
}
```

- [ ] **Step 4: Create `apps/server/vitest.config.ts`**

```ts
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // A round in the tests lasts fractions of a second, not thirteen.
      miniflare: {
        bindings: { COUNTDOWN_MS: '50', ROUND_MS: '200' },
      },
    }),
  ],
});
```

- [ ] **Step 5: Install the dependencies**

Run: `pnpm install`
Expected: `Scope: all 4 workspace projects`; partyserver, wrangler and the test plugin are installed, and the `workerd` postinstall runs. The `ERR_PNPM_IGNORED_BUILDS` error must not appear — if it does, `allowBuilds` from Task 1 is not in place.

- [ ] **Step 6: Check the environment type generation**

Run: `pnpm --filter @clicker/server run types`
Expected: `apps/server/worker-configuration.d.ts` is created and contains `interface Env`. The warning about `@types/node` can be ignored: the package does not use Node compatibility.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add apps/server pnpm-lock.yaml
git commit -m "chore(server): scaffold the worker package"
```

---

### Task 3: Room routing

**Files:**
- Create: `apps/server/src/worker.ts`, `apps/server/src/room.ts`, `apps/server/test/support.ts`
- Test: `apps/server/test/room.test.ts`

- [ ] **Step 1: Create the test helper `apps/server/test/support.ts`**

```ts
import { SELF } from 'cloudflare:test';
import { parseServerMessage, type ServerMessage } from '@clicker/protocol';
import { expect } from 'vitest';

export type Snapshot = Extract<ServerMessage, { type: 'snapshot' }>;
export type Welcome = Extract<ServerMessage, { type: 'welcome' }>;
export type ServerError = Extract<ServerMessage, { type: 'error' }>;

export const isWelcome = (message: ServerMessage): message is Welcome => message.type === 'welcome';
export const isSnapshot = (message: ServerMessage): message is Snapshot =>
  message.type === 'snapshot';
export const isError = (message: ServerMessage): message is ServerError => message.type === 'error';

/** Collects incoming messages and lets a test wait for the one it needs. */
export class Client {
  readonly received: ServerMessage[] = [];

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      const message = parseServerMessage(event.data);
      if (message !== null) this.received.push(message);
    });
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }

  async waitFor<T extends ServerMessage>(
    predicate: (message: ServerMessage) => message is T,
    timeoutMs = 2000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.received.find(predicate);
      if (found !== undefined) return found;
      if (Date.now() > deadline) {
        throw new Error(`timed out; received: ${JSON.stringify(this.received)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export async function connect(roomId: string): Promise<Client> {
  const response = await SELF.fetch(
    new Request(`https://example.com/parties/room/${roomId}`, {
      headers: { Upgrade: 'websocket' },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error('no websocket in the response');
  socket.accept();
  return new Client(socket);
}
```

- [ ] **Step 2: Write the failing test `apps/server/test/room.test.ts`**

For now only the address check; the other tests in this file are added in the following tasks.

```ts
import { SELF } from 'cloudflare:test';
import { generateId } from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { connect } from './support';

describe('room over websocket', () => {
  it('refuses a malformed room id before connecting', async () => {
    const response = await SELF.fetch(
      new Request('https://example.com/parties/room/not-a-room', {
        headers: { Upgrade: 'websocket' },
      }),
    );

    expect(response.status).toBe(404);
  });

  it('accepts a connection to a well-formed room id', async () => {
    const client = await connect(generateId());

    expect(client.received).toEqual([]);

    client.close();
  });
});
```

- [ ] **Step 3: Make sure the test fails**

Run: `pnpm --filter @clicker/server test`
Expected: FAIL, `Cannot find module './room'` or `Cannot find module '../src/worker'` — the sources do not exist yet.

- [ ] **Step 4: Create the room stub `apps/server/src/room.ts`**

```ts
import { Server } from 'partyserver';

export class Room extends Server<Env> {
  static options = { hibernate: true };
}
```

- [ ] **Step 5: Create `apps/server/src/worker.ts`**

```ts
import { routePartykitRequest } from 'partyserver';
import { Room } from './room';

export { Room };

/** The same format as the protocol's identifiers: 16 random bytes in base64url. */
const ROOM_ID = /^[A-Za-z0-9_-]{22}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routePartykitRequest(request, env, {
      onBeforeConnect: (_request, lobby) =>
        ROOM_ID.test(lobby.name) ? undefined : new Response('Not found', { status: 404 }),
    });

    return response ?? new Response('Not found', { status: 404 });
  },
};
```

- [ ] **Step 6: Make sure the tests pass**

Run: `pnpm --filter @clicker/server test`
Expected: `Test Files 1 passed (1)`, `Tests 2 passed (2)`.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): route rooms and reject malformed ids"
```

---

### Task 4: A player joins, snapshots are broadcast

**Files:**
- Modify: `apps/server/src/room.ts`, `apps/server/test/room.test.ts`

- [ ] **Step 1: Add a failing test to `apps/server/test/room.test.ts`**

The file's imports become:

```ts
import { SELF } from 'cloudflare:test';
import { generateId } from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { connect, isSnapshot, isWelcome } from './support';
```

Replace the test "accepts a connection to a well-formed room id" with:

```ts
  it('greets a player and shows them in the snapshot', async () => {
    const client = await connect(generateId());
    const playerId = generateId();

    client.send({ type: 'join', playerId, name: 'Аня' });

    const welcome = await client.waitFor(isWelcome);
    expect(welcome).toEqual({ type: 'welcome', you: '1', isHost: false });

    const snapshot = await client.waitFor(isSnapshot);
    expect(snapshot.phase).toBe('lobby');
    expect(snapshot.players).toEqual([{ id: '1', name: 'Аня', clicks: 0, connected: true }]);
    expect(JSON.stringify(snapshot)).not.toContain(playerId);

    client.close();
  });
```

- [ ] **Step 2: Make sure the test fails**

Run: `pnpm --filter @clicker/server test`
Expected: FAIL with a timeout waiting for `welcome`: the room does not answer anything yet.

- [ ] **Step 3: Write `apps/server/src/room.ts` in full**

```ts
import {
  apply,
  type Command,
  createRoomState,
  DEFAULT_CONFIG,
  type GameConfig,
  type GameEvent,
  nextDeadline,
  type RoomState,
} from '@clicker/game';
import { parseClientMessage, type ServerMessage, toSnapshot } from '@clicker/protocol';
import { type Connection, Server, type WSMessage } from 'partyserver';

/** What we remember about a connection: it survives the object's sleep. */
interface Session {
  playerId: string;
  publicId: string;
}

export class Room extends Server<Env> {
  static options = { hibernate: true };

  #state: RoomState = createRoomState();
  #config: GameConfig = DEFAULT_CONFIG;

  override async onStart(): Promise<void> {
    this.#config = {
      ...DEFAULT_CONFIG,
      countdownMs: Number(this.env.COUNTDOWN_MS ?? DEFAULT_CONFIG.countdownMs),
      roundMs: Number(this.env.ROUND_MS ?? DEFAULT_CONFIG.roundMs),
    };

    this.#state = (await this.ctx.storage.get<RoomState>('state')) ?? createRoomState();
    await this.#scheduleAlarm();
  }

  override async onMessage(connection: Connection<Session>, message: WSMessage): Promise<void> {
    if (typeof message !== 'string') {
      this.#send(connection, { type: 'error', code: 'invalid_message' });
      return;
    }

    const parsed = parseClientMessage(message);
    if (parsed === null) {
      this.#send(connection, { type: 'error', code: 'invalid_message' });
      return;
    }

    if (parsed.type === 'join') {
      const previous = connection.state;
      if (previous !== null && previous.playerId !== parsed.playerId) {
        await this.#run(
          { type: 'leave', playerId: previous.playerId, connectionId: connection.id },
          connection,
        );
      }
      await this.#run(
        {
          type: 'join',
          playerId: parsed.playerId,
          connectionId: connection.id,
          name: parsed.name,
          ...(parsed.hostKey === undefined ? {} : { hostKey: parsed.hostKey }),
        },
        connection,
      );
      return;
    }

    this.#send(connection, { type: 'error', code: 'not_joined' });
  }

  /** The only way state changes: rules, events, storage, alarm, broadcast. */
  async #run(command: Command, source?: Connection<Session>): Promise<void> {
    const applied = apply(this.#state, command, Date.now(), this.#config);
    this.#state = applied.state;

    for (const event of applied.events) {
      this.#handleEvent(event, source);
    }

    if (command.type !== 'click') {
      await this.#persist();
    }
    await this.#scheduleAlarm();
    this.#broadcastSnapshot();
  }

  #handleEvent(event: GameEvent, source?: Connection<Session>): void {
    if (event.type === 'welcome' && source !== undefined) {
      source.setState({ playerId: event.playerId, publicId: event.publicId });
      this.#send(source, { type: 'welcome', you: event.publicId, isHost: event.isHost });
      return;
    }
    if (event.type === 'rejected' && source !== undefined) {
      this.#send(source, { type: 'error', code: event.code });
    }
  }

  /** The snapshot is built once for everyone, not once per connection. */
  #broadcastSnapshot(): void {
    this.broadcast(JSON.stringify(toSnapshot(this.#state, Date.now())));
  }

  #send(connection: Connection<Session>, message: ServerMessage): void {
    connection.send(JSON.stringify(message));
  }

  async #persist(): Promise<void> {
    await this.ctx.storage.put('state', this.#state);
  }

  async #scheduleAlarm(): Promise<void> {
    const deadline = nextDeadline(this.#state, this.#config);
    if (deadline === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(deadline);
  }
}
```

- [ ] **Step 4: Make sure the tests pass**

Run: `pnpm --filter @clicker/server test`
Expected: `Test Files 1 passed (1)`, `Tests 2 passed (2)`.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): join a room and broadcast snapshots"
```

---

### Task 5: Host and click commands

**Files:**
- Modify: `apps/server/src/room.ts`, `apps/server/test/room.test.ts`

- [ ] **Step 1: Add a failing test to `apps/server/test/room.test.ts`**

Add `isError` to the imports, and add this test at the end of the `describe`:

```ts
  it('refuses to start a round for a player who is not the host', async () => {
    const client = await connect(generateId());
    client.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await client.waitFor(isWelcome);

    client.send({ type: 'start' });

    const error = await client.waitFor(isError);
    expect(error.code).toBe('not_host');

    client.close();
  });
```

- [ ] **Step 2: Make sure the test fails**

Run: `pnpm --filter @clicker/server test`
Expected: FAIL — `not_joined` arrives instead of `not_host`: the `start` and `click` commands do not reach the rules yet.

- [ ] **Step 3: Replace the last lines of `onMessage` in `apps/server/src/room.ts`**

Instead of the unconditional `not_joined`:

```ts
    const session = connection.state;
    if (session === null) {
      this.#send(connection, { type: 'error', code: 'not_joined' });
      return;
    }

    await this.#run({ type: parsed.type, playerId: session.playerId }, connection);
```

- [ ] **Step 4: Make sure the tests pass**

Run: `pnpm --filter @clicker/server test`
Expected: `Test Files 1 passed (1)`, `Tests 3 passed (3)`.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): pass host and click commands to the rules"
```

---

### Task 6: A whole round: the alarm and the snapshot stream

**Files:**
- Modify: `apps/server/src/room.ts`, `apps/server/test/room.test.ts`

- [ ] **Step 1: Add a failing test to `apps/server/test/room.test.ts`**

Add the `Snapshot` type to the imports from `./support`, and add this test at the end of the `describe`:

```ts
  it('plays a whole round and agrees on the winner in both clients', async () => {
    const roomId = generateId();
    const hostKey = generateId();
    const host = await connect(roomId);
    const guest = await connect(roomId);

    host.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey });
    guest.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    const hostWelcome = await host.waitFor(isWelcome);
    expect(hostWelcome.isHost).toBe(true);
    await guest.waitFor(isWelcome);

    host.send({ type: 'start' });

    // Countdown 50 ms, round 200 ms: the values are set in vitest.config.ts.
    await new Promise((resolve) => setTimeout(resolve, 80));
    for (let i = 0; i < 5; i += 1) {
      guest.send({ type: 'click' });
    }
    host.send({ type: 'click' });

    const hasResults = (message: Parameters<typeof isSnapshot>[0]): message is Snapshot =>
      isSnapshot(message) && message.results !== null;
    const results = await host.waitFor(hasResults);
    const guestResults = await guest.waitFor(hasResults);

    expect(results.results?.[0]).toMatchObject({ name: 'Боря', clicks: 5, rank: 1 });
    expect(guestResults.results).toEqual(results.results);

    host.close();
    guest.close();
  });
```

- [ ] **Step 2: Make sure the test fails**

Run: `pnpm --filter @clicker/server test`
Expected: FAIL with a timeout: the round ends only when someone sends a message, and nobody sends snapshots during the round.

- [ ] **Step 3: Add the snapshot timer and the alarm to `apps/server/src/room.ts`**

Next to the `Session` interface add a constant:

```ts
const SNAPSHOT_INTERVAL_MS = 100;
```

Add the timer to the class fields:

```ts
  #timer: ReturnType<typeof setInterval> | null = null;
```

Add the alarm handler (after `onMessage`):

```ts
  override async onAlarm(): Promise<void> {
    await this.#run({ type: 'tick' });
  }
```

Replace the tail of `#run` (everything after the loop over events):

```ts
    if (command.type !== 'click') {
      await this.#persist();
    }
    await this.#scheduleAlarm();
    this.#syncSnapshotTimer();

    // During a round the timer sends snapshots, outside a round every change does.
    // A phase change is sent at once: waiting up to a hundred milliseconds is not acceptable here.
    if (phaseChanged || this.#timer === null) {
      this.#broadcastSnapshot();
    }
```

and introduce a flag in the loop over events itself:

```ts
    let phaseChanged = false;
    for (const event of applied.events) {
      if (event.type === 'phaseChanged') phaseChanged = true;
      this.#handleEvent(event, source);
    }
```

Add the timer itself (before `#broadcastSnapshot`):

```ts
  #syncSnapshotTimer(): void {
    const live = this.#state.phase === 'countdown' || this.#state.phase === 'running';
    if (live && this.#timer === null) {
      this.#timer = setInterval(() => this.#broadcastSnapshot(), SNAPSHOT_INTERVAL_MS);
      return;
    }
    if (!live && this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
```

- [ ] **Step 4: Make sure the tests pass**

Run: `pnpm --filter @clicker/server test`
Expected: `Test Files 1 passed (1)`, `Tests 4 passed (4)`.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): drive rounds with an alarm and stream snapshots"
```

---

### Task 7: Connection drop

**Files:**
- Modify: `apps/server/src/room.ts`
- Test: `apps/server/test/lifecycle.test.ts`

- [ ] **Step 1: Write the failing test `apps/server/test/lifecycle.test.ts`**

```ts
import { generateId } from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { connect, isSnapshot, isWelcome, type Snapshot } from './support';

describe('room lifecycle', () => {
  it('marks a player as disconnected when their socket closes', async () => {
    const roomId = generateId();
    const staying = await connect(roomId);
    const leaving = await connect(roomId);

    staying.send({ type: 'join', playerId: generateId(), name: 'Аня' });
    leaving.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await staying.waitFor(isWelcome);
    await leaving.waitFor(isWelcome);
    await staying.waitFor(
      (message): message is Snapshot => isSnapshot(message) && message.players.length === 2,
    );

    leaving.close();

    const snapshot = await staying.waitFor(
      (message): message is Snapshot =>
        isSnapshot(message) &&
        message.players.some((player) => player.name === 'Боря' && !player.connected),
    );

    // The player stays in the list: they have time to come back.
    expect(snapshot.players).toHaveLength(2);
    staying.close();
  });
});
```

- [ ] **Step 2: Make sure the test fails**

Run: `pnpm --filter @clicker/server test`
Expected: FAIL with a timeout: closing the socket is not reflected in the state in any way.

- [ ] **Step 3: Add `onClose` to `apps/server/src/room.ts`** (after `onMessage`)

```ts
  override async onClose(connection: Connection<Session>): Promise<void> {
    const session = connection.state;
    if (session === null) return;
    await this.#run(
      { type: 'leave', playerId: session.playerId, connectionId: connection.id },
      connection,
    );
  }
```

- [ ] **Step 4: Make sure the tests pass**

Run: `pnpm --filter @clicker/server test`
Expected: `Test Files 2 passed (2)`, `Tests 5 passed (5)`.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): release the connection when a socket closes"
```

---

### Task 8: Object restart in the middle of a round

**Files:**
- Modify: `apps/server/src/room.ts`, `apps/server/test/lifecycle.test.ts`

- [ ] **Step 1: Add a failing test to `apps/server/test/lifecycle.test.ts`**

As the first line of the file add the import `import { abortAllDurableObjects } from 'cloudflare:test';`, and add this test at the end of the `describe`:

```ts
  it('aborts the round when the object restarts mid-game', async () => {
    const roomId = generateId();
    const host = await connect(roomId);

    host.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey: generateId() });
    await host.waitFor(isWelcome);
    host.send({ type: 'start' });
    await host.waitFor(
      (message): message is Snapshot => isSnapshot(message) && message.phase === 'countdown',
    );

    // Restarting the object: memory is reset, storage stays.
    // A soft eviction does not fit here — during a round the object is busy with the broadcast timer.
    await abortAllDurableObjects();

    const returning = await connect(roomId);
    returning.send({ type: 'join', playerId: generateId(), name: 'Боря' });

    const snapshot = await returning.waitFor(isSnapshot);
    expect(snapshot.phase).toBe('lobby');
    expect(snapshot.notice).toBe('round_aborted');
    expect(snapshot.round).toBeNull();

    returning.close();
  });
```

- [ ] **Step 2: Make sure the test fails**

Run: `pnpm --filter @clicker/server test`
Expected: FAIL, `expected 'countdown' to be 'lobby'` — the state is restored from storage as it is, together with the interrupted round.

- [ ] **Step 3: Extend `onStart` in `apps/server/src/room.ts`**

Add `abortRound` and `syncConnections` to the imports from `@clicker/game`. The body of `onStart` after the `#config` setup:

```ts
    const stored = await this.ctx.storage.get<RoomState>('state');
    let state = stored ?? createRoomState();

    // A round phase in storage means the object restarted in the middle of a game
    // and the clicks held in memory are lost.
    if (state.phase === 'countdown' || state.phase === 'running') {
      state = abortRound(state);
    }

    const live: Record<string, string[]> = {};
    for (const connection of this.getConnections<Session>()) {
      const session = connection.state;
      if (session !== null) {
        const ids = live[session.playerId] ?? [];
        ids.push(connection.id);
        live[session.playerId] = ids;
      }
    }

    this.#state = syncConnections(state, live, Date.now());
    await this.#persist();
    await this.#scheduleAlarm();
```

- [ ] **Step 4: Make sure all the tests pass**

Run: `pnpm --filter @clicker/server test`
Expected: `Test Files 2 passed (2)`, `Tests 6 passed (6)`.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): abort a round left over from a restart"
```

---

### Task 9: Whole-repository check

**Files:** none new, only a run

- [ ] **Step 1: Run everything**

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
```
Expected:
- Biome: `No fixes applied.`;
- typecheck: `tsc --noEmit` three times, with the `wrangler types` output before the server one, no errors;
- tests: 60 in game, 31 in protocol, 6 in server.

- [ ] **Step 2: Start the server locally and make sure it starts**

Run: `pnpm --filter @clicker/server run dev`
Expected: wrangler prints a local address like `http://localhost:8787`. There is no client yet, so we check only that it starts and that the console shows no errors, then stop it with Ctrl+C.

- [ ] **Step 3: Commit if anything changed**

If `pnpm format` changed files:

```bash
git add -A
git commit -m "style: apply formatting after the server package"
```

---

## Checking the result

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
```

Expected: the linter is clean, the typecheck is silent, 97 tests in total (60 + 31 + 6), zero failures.

Check against the spec:
- §4 "Rooms and access" — the room id format is checked before connecting; the room is created on demand;
- §7 "Server" — a hibernating room on partyserver, connection state, the alarm as the phase engine, storage, snapshot broadcast, durations from environment variables;
- §9 "Errors and edge cases" — a malformed message, a command without joining, a start from a non-host, a connection drop, an object restart;
- §10 "Testing" — integration tests of the server in the Workers runtime.

What is left for plan 3: serving the client through Static Assets (`assets` in `wrangler.jsonc`), end-to-end Playwright tests and the deploy.

## What we need from you

- **During this plan:** nothing. The tests run locally in workerd, no Cloudflare account is needed.
- **Before plan 3:** a Cloudflare account on the free tier, a `<name>.workers.dev` subdomain and `npx wrangler@latest login` — they will be needed for the first deploy.

## Notes for the future

- `SELF` from `cloudflare:test` is marked deprecated in favour of `exports.default` from `cloudflare:workers`, but the latter currently has no `default` type and `tsc` fails on it. When the types are fixed, the replacement is made in one place — in `test/support.ts`.
- A snapshot for 50 players takes about 3 KB; it is built once per tick and broadcast to everyone, not rebuilt for each connection. This is worth keeping in any change to the broadcast.
- During a round the object holds a timer and does not sleep — that is intended: a round lasts thirteen seconds. In the lobby the timer is cleared, and the object can sleep.
