# Clicker: a foundation for realtime multiplayer on Cloudflare — design

Date: 2026-09-11 · Status: approved in the brainstorm, waiting for the file review

## 1. Context and goal

A personal project on a personal Cloudflare account, unrelated to any work infrastructure. The goal
is a clean foundation for realtime browser multiplayer games, on which a 3D game on three.js will
later grow. The first mode is a click race: the host starts a round, everyone clicks for 10 seconds
at once, and whoever clicked more wins.

The first version is ready when:
- the host creates a room and shares a link, and players join through it from laptops and phones;
- the round runs in sync for everyone: a 3 s countdown, 10 s of clicks, the same winner for all;
- during the round everyone sees a live 3D scene with the players' scores;
- the rules are covered by unit tests, the server by integration tests, a full round by an e2e test;
- deploys go from `main` through GitHub Actions to the Cloudflare free tier.

A simple clicker for the work wheel is made separately in the work repository and is not part of
this one.

## 2. What we are not doing now

- Authorization and accounts: a player is a name and a `playerId` from localStorage.
- Game history and shared leaderboards.
- A registry of game modes and a shared mode interface: we will extract them when a second mode
  appears.
- ECS, physics, a binary protocol, matchmaking.
- Multiple languages: the interface has one language, kept in one file (Russian when this was
  written, English since).
- An autoclicker detector: fairness rests on trust, the server only limits the rate.

## 3. Architecture

### Layers and dependencies

```
apps/game          client and Worker in one app:
                   src/client — screens, 3D scene, network   React 19.2, react-three-fiber, drei, zustand, partysocket
                   src/worker — Worker and room              partyserver, Durable Objects, Workers Static Assets
packages/protocol  message schemas and types     valibot
packages/game      state and rules               no dependencies
e2e                end-to-end tests              Playwright
```

- `packages/game` imports nothing: no Cloudflare, no DOM, no `Date.now()`, no `Math.random()`.
  Time and config arrive as parameters.
- `packages/protocol` depends only on `packages/game` (types, the mode's data schema and the
  snapshot function).
- **A platform, not one game.** The room, lobby, host, connections, phases, alarm, snapshots and
  recovery do not know the word "click": everything that belongs to a particular game lives in the
  mode's folder and in a separate slot of the protocol. There is no mode registry and will not be
  until a second mode appears: an interface derived from one implementation always turns out
  wrong. For now we fix only what is expensive to change later — the message format and the state
  boundaries.
- `apps/game` depends on both packages. The client and the Worker live in one app because the
  `@cloudflare/vite-plugin` plugin builds them together and deploys with one command; they share no
  code, everything shared lives in the packages.

### Repository

```
clicker/
  apps/game/
    src/worker/worker.ts   /parties/* → room; the Worker sees nothing else, Static Assets serves it
    src/worker/room.ts     the Room class (partyserver): an adapter between connections and the core
    src/client/            screens, HUD, scene, connection, state
    src/client/modes/      the arena and scene of a particular mode
    test/                  integration tests (@cloudflare/vitest-plugin)
    e2e/                   end-to-end tests (Playwright)
    index.html  vite.config.ts  vitest.config.ts  wrangler.jsonc
  packages/
    game/src/room/         shared: state, players, host, phases, advancing time, deadlines
    game/src/modes/clicker/  the clicker's rules: input, token bucket, results
    protocol/src/          ids, client, server, snapshot
  docs/superpowers/
  .github/workflows/ci.yml
  biome.json  pnpm-workspace.yaml  tsconfig.base.json  package.json
```

## 4. Rooms and access

There are no shared secrets: access is given by links with unguessable identifiers.

- **Identifiers.** `roomId`, `hostKey` and `playerId` are 16 random bytes from
  `crypto.getRandomValues` in base64url, 22 characters. Format: `^[A-Za-z0-9_-]{22}$`.
- **Creating a room.** The "Create room" button on the landing page generates a `roomId` and a
  `hostKey`, saves the key in localStorage (`hostKeys[roomId]`) and navigates to `/r/<roomId>`.
  There is no separate request: the room object is created on the first connection.
- **Host.** The first `join` with a `hostKey` in a room without a key pins that key to the room.
  Every `join` with the same key makes the player a host. A `join` with a different key goes through
  as an ordinary entry, and `welcome` carries `isHost: false`.
- **The host's second device.** In the lobby the host has a "Copy host link" button:
  `/r/<roomId>#host=<hostKey>`. On load the client reads the key from the fragment, saves it in
  localStorage and immediately removes the fragment with `history.replaceState`. The fragment never
  goes to the server.
- **Invitation.** The plain link `/r/<roomId>`.
- **Check on entry.** The Worker answers 404 before connecting if `roomId` does not match the
  format.

## 5. The core (packages/game)

### Config

```ts
export interface GameConfig {
  countdownMs: number;      // 3000
  roundMs: number;          // 10000
  lateGraceMs: number;      // 250: clicks are still accepted this long after the round ends
  clicksPerSecond: number;  // 30: bucket refill rate, deliberately above any human
  burst: number;            // 15: bucket capacity
  reconnectGraceMs: number; // 30000
  maxPlayers: number;       // 50
  /**
   * How often the room advances time by itself during a round.
   * `null` — only on commands and the alarm: that is how the clicker lives, it has no need to move.
   * A number — the simulation step in milliseconds: a snake has to move even when nobody presses.
   */
  tickMs: number | null;    // null for the clicker
}
export const DEFAULT_CONFIG: GameConfig;
```

`clicksPerSecond` and `burst` are the clicker's knowledge, and when a second mode appears they will
move into the mode's config together with its rules. There is nothing to split the config on right
now: deriving the boundary from one implementation is exactly the way to draw it wrong.

### State

```ts
export type Phase = 'lobby' | 'countdown' | 'running' | 'results';
export type ModeId = 'clicker';

/** Shared by all games. Nothing about a particular game belongs here. */
export interface RoomState {
  mode: ModeId;                      // chosen when the room is created and never changes
  phase: Phase;
  hostKey: string | null;
  hosts: string[];                   // playerId of the hosts
  players: Record<string, Player>;   // the key is the secret playerId
  nextSeq: number;                   // counter for publicId, starts at 1
  round: { goAt: number; endsAt: number } | null;
  notice: 'round_aborted' | null;
  /** Everything only the mode knows: the players' scores, results, internal timers. */
  modeState: ClickerState;
}

export interface Player {
  publicId: string;                  // String(nextSeq) at the moment of joining
  name: string;
  connectionIds: string[];           // ids of this player's open connections
  disconnectedAt: number | null;
}

/** The clicker's state. The keys are publicId: the same identifiers go outward. */
export interface ClickerState {
  scores: Record<string, ClickerScore>;
  results: ResultRow[] | null;
}

export interface ClickerScore {
  clicks: number;
  lastCountedAt: number | null;      // time of the last counted click
  bucket: { tokens: number; updatedAt: number };
}

export interface ResultRow { publicId: string; name: string; clicks: number; rank: number }
```

The state is a plain JSON-serializable object: it can be saved to the object's storage as it is.

Phases: `lobby → countdown → running → results`. From `results` the host starts the next round
straight away (`results → countdown`); there is no separate return to the lobby.

### API

```ts
export type Command =
  | { type: 'join'; playerId: string; connectionId: string; name: string; hostKey?: string }
  | { type: 'leave'; playerId: string; connectionId: string }
  | { type: 'start'; playerId: string }
  | { type: 'input'; playerId: string; input: ClickerInput }
  | { type: 'tick' };

/** The mode's input. For the clicker it is empty: the press itself is the input. */
export type ClickerInput = { type: 'click' };

export type ErrorCode = 'not_joined' | 'not_host' | 'wrong_phase' | 'room_full';

export type GameEvent =
  | { type: 'welcome'; playerId: string; publicId: string; isHost: boolean }
  | { type: 'rejected'; playerId: string; code: ErrorCode }
  | { type: 'phaseChanged'; phase: Phase };

export function createRoomState(): RoomState;
export function apply(state: RoomState, command: Command, now: number, config?: GameConfig):
  { state: RoomState; events: GameEvent[] };
export function nextDeadline(state: RoomState, config?: GameConfig): number | null;
export function abortRound(state: RoomState): RoomState;
export function syncConnections(state: RoomState, live: Record<string, string[]>, now: number): RoomState;
```

`apply`, `abortRound` and `syncConnections` do not mutate the input state.

### Advancing time

Every command first runs `advance(state, now)` and is then handled itself; `tick` is only
`advance`. So the rules do not depend on the alarm's precision: a late alarm, or a click after the
round has ended, will see the round already closed.

`advance` runs these steps in order, and one call can go through several:
1. `countdown` and `now ≥ goAt` → `running`, a `phaseChanged` event.
2. `running` and `now ≥ endsAt + lateGraceMs` → `results`, the results are computed, a
   `phaseChanged` event.
3. In `lobby` and `results`, players with no open connections and with
   `disconnectedAt + reconnectGraceMs ≤ now` are removed, and their `playerId` is taken out of
   `hosts`. Rows in the already computed `results` stay.

### Rules

- **join**
  - A player with this `playerId` already exists: `connectionId` is added to `connectionIds` if it
    is not there yet, `disconnectedAt = null`, the name is updated, the score is kept. A repeated
    `join` from the same connection changes nothing: the connection count cannot be inflated by
    sending `join` many times.
  - A new player is not let in when there are `maxPlayers` players: `rejected room_full`.
    Otherwise they are added with `publicId = String(nextSeq)` and `connectionIds = [connectionId]`;
    `nextSeq += 1`. Then the mode creates their score row: for the clicker that is `clicks = 0`,
    `lastCountedAt = null`, `bucket = { tokens: burst, updatedAt: now }` in
    `modeState.scores[publicId]`.
  - Host: if a `hostKey` is passed and `state.hostKey === null`, the key is pinned and `playerId` is
    added to `hosts`. If a key is passed and matches, `playerId` is added to `hosts`. There are no
    duplicates in `hosts`. In all other cases the host status does not change.
  - A `welcome` event with `isHost = hosts.includes(playerId)`.
  - Joining is possible in any phase. A new player during a round starts from zero.
- **leave.** `connectionId` is removed from `connectionIds`. If the list became empty and
  `disconnectedAt` was not yet set — `disconnectedAt = now`; a repeated `leave` of the same
  connection changes nothing and does not move the removal deadline. During `countdown` and
  `running` the player is not removed, and the score is kept.
- **start.** Unknown `playerId` → `not_joined`; a player not in `hosts` → `not_host`; a phase that
  is neither `lobby` nor `results` → `wrong_phase`. Otherwise:
  `phase = countdown`, `round = { goAt: now + countdownMs, endsAt: now + countdownMs + roundMs }`;
  then the mode resets its score — for the clicker every player gets `clicks = 0`,
  `lastCountedAt = null`, `bucket = { tokens: burst, updatedAt: goAt }`, and
  `modeState.results = null`; `notice = null`; a `phaseChanged` event.
- **input.** The shared part decides little: unknown `playerId` → `not_joined`, outside the
  `running` phase the input is silently ignored. After that the input is handed to the mode, and
  only the mode knows what it means. The clicker receives `{ type: 'click' }` and works with its own
  row in `modeState.scores[publicId]`: the bucket refills by
  `(now − updatedAt) × clicksPerSecond / 1000`, but not above `burst`. If there are ≥ 1 tokens, one
  token is spent, `clicks += 1`, `lastCountedAt = now`, `updatedAt = max(updatedAt, now)`. If there
  is less than one token, the state does not change at all. Both rules guard against a timestamp
  from the past: it must not move the reference point back and give the player an extra reserve of
  clicks.
- **Results are a mode rule.** The clicker sorts: `clicks` descending → `lastCountedAt` ascending
  (`null` last) → `publicId` ascending as numbers. `rank` is the position starting from 1. The
  winner is the first row if its `clicks > 0`; otherwise there is no winner. The finished rows are
  put into `modeState.results`; the shared part of the room knows nothing about them.
- **abortRound.** Only from `countdown` and `running`, otherwise the state is returned as it is.
  `phase = lobby`, `round = null`, `notice = 'round_aborted'`; then the mode clears its score — for
  the clicker every player gets `clicks = 0` and `lastCountedAt = null`: there is no reason to show
  the score of an aborted round in the lobby.
- **syncConnections.** For each player `connectionIds = live[playerId] ?? []`. If the list is empty
  and `disconnectedAt === null` — `disconnectedAt = now`; if it is not empty —
  `disconnectedAt = null`. A disconnect time that is already set is kept.

### nextDeadline

The minimum of:
- `goAt` in `countdown`;
- `endsAt + lateGraceMs` in `running`;
- `disconnectedAt + reconnectGraceMs` of the disconnected players in `lobby` and `results`.

`null` if there are no deadlines.

## 6. Protocol (packages/protocol)

All messages are JSON objects with a `type` field and a `v` field — the protocol version. The
schemas are in valibot, and the types are inferred from the schemas. Extra fields in incoming
messages are an error.

**Version.** `v: 1` in every message in both directions. The server answers a foreign version with
`error: bad_version`, and the client shows "update the page". One number now spares us a migration
on the day snapshots become deltas or binary — and for a live simulation they will.

**What is shared and what belongs to the mode.** The shared part describes the room: who is in it,
whether they are connected, which phase it is, when the round starts and ends. Everything else lies
in the `mode` slot, which the mode describes with its own schema. After this the shared part does
not change when games are added.

Client → server:

```ts
{ v: 1; type: 'join'; playerId: Id; name: Name; hostKey?: Id }
{ v: 1; type: 'start' }
{ v: 1; type: 'input'; input: { type: 'click' } }   // the mode describes the content of input
```

- `Id` — a string of the format from §4.
- `Name` — a string whose length after `trim` is from 1 to 20 characters (counted in code points);
  from then on the trimmed value is used everywhere. Control characters and text direction marks
  (U+202A–U+202E, U+2066–U+2069) are forbidden: the name goes to all players in every snapshot.

Server → client:

```ts
{ v: 1; type: 'welcome'; you: string; isHost: boolean }
{ v: 1; type: 'snapshot'; serverNow: number; mode: ModeId; phase: Phase;
  players: { id: string; name: string; connected: boolean }[];   // ascending id as numbers
  round: { goAt: number; endsAt: number } | null;
  notice: 'round_aborted' | null;
  // The mode slot: for the clicker — the score by publicId and the round's results.
  data: { scores: Record<string, number>;
          results: { id: string; name: string; clicks: number; rank: number }[] | null } }
{ v: 1; type: 'private'; data: unknown }   // the private part, different for each connection
{ v: 1; type: 'error'; code: ErrorCode | 'invalid_message' | 'bad_version' }
```

`id` in the messages is the `publicId`. The server never sends `playerId` or `hostKey`.

**The private part.** `snapshot` goes to everyone as one string — this must stay so, it is the hot
path. Where a player needs to see something of their own (a role in mafia, the word in charades,
cards), the mode returns a private part, and the server sends it to each connection separately and
only when it changes. The clicker does not need it and it costs nothing: the mode simply does not
return it.

The package exports:
- `parseClientMessage(raw: string): ParsedClientMessage` — either `{ ok: true, message }` or
  `{ ok: false, reason }`. `reason` is `'invalid_message'` for strings longer than 1024 bytes,
  malformed JSON and anything that did not pass the schema, and `'bad_version'` for a message with
  a foreign `v`. A bare `null` will not do here: the server has to tell a foreign version from
  garbage, otherwise it cannot answer `bad_version` — and in that case the player only has to
  reload the tab;
- `parseServerMessage(raw: string): ServerMessage | null` — for the client; its limit is larger,
  64 KB: a snapshot for 50 players takes about 3 KB, but it is an order of magnitude bigger than
  the client's messages;
- `toSnapshot(state: RoomState, now: number): SnapshotMessage`;
- `generateId(): string` — for `roomId`, `hostKey`, `playerId` on the client.

## 7. Server (apps/game/src/worker)

### wrangler.jsonc

```jsonc
{
  "name": "clicker",
  "main": "src/worker/worker.ts",
  "compatibility_date": "2026-09-11",
  // The Vite plugin fills in the directory of built static files, no need to set it by hand.
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/parties/*"]
  },
  "durable_objects": { "bindings": [{ "name": "Room", "class_name": "Room" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }],
  "vars": { "COUNTDOWN_MS": "3000", "ROUND_MS": "10000" }
}
```

### Worker

The Worker runs only for `/parties/*`: everything else is served by Static Assets with a fallback
to `index.html` for the SPA. The Worker calls `routePartykitRequest` and checks the `roomId` format
in two places: `onBeforeConnect` — for WebSocket connections, `onBeforeRequest` — for ordinary
requests. The second is mandatory: without it a plain GET to the room's address bypasses the check
and creates a Durable Object before anyone opens a socket. The format is taken from the protocol
package's `isId`, so that the definition does not diverge in two places. On an error the answer is
404, and if the route matched no room — also 404.

The room's address: `/parties/room/<roomId>` (the name `room` comes from the name of the `Room`
binding).

### Room

`class Room extends Server<Env>`, `static options = { hibernate: true }`.
In memory: `state: RoomState`, `config: GameConfig`, the broadcast timer.
In the connection state (survives sleep): `{ playerId, publicId }` after a successful `join`.

- **onStart**
  1. `state = (await ctx.storage.get('state')) ?? createRoomState()`; `config` is `DEFAULT_CONFIG`
     with `COUNTDOWN_MS` and `ROUND_MS` from `env`. The same `config` is passed to both `apply` and
     `nextDeadline`: if it is given to only one of them, the alarm will follow the default
     durations and the rules their own, and the round will hang until the next message from a
     player.
  2. If the loaded phase is `countdown` or `running`, the object restarted in the middle of a round
     and the clicks in memory are lost: `state = abortRound(state)`.
  3. Reconciling connections: from `getConnections()` and their state, the ids of the live
     connections of each `playerId` are collected, then
     `state = syncConnections(state, live, now)`.
  4. Save, alarm and a snapshot to everyone: after recovery the clients must see the real state at
     once, not wait for someone else's message while looking at a countdown that does not exist.
- **onConnect** — nothing: a player appears only after `join`.
- **onMessage(conn, raw)**
  1. A binary message or `parseClientMessage(raw) === null` — `error invalid_message` to this
     connection.
  2. The `join` and `leave` commands always carry `connectionId` — this is `conn.id` from
     partyserver. `join`: if the connection already has a different `playerId`, `leave` for the old
     one first. `start` and `input`: `playerId` is taken from the connection state; if there is
     none — `error not_joined`.
  3. `apply(state, command, Date.now(), config)`.
  4. Events: `welcome` — `conn.setState({ playerId, publicId })` and `welcome` is sent to this
     connection; `rejected` — `error` to this connection; `phaseChanged` — controls the broadcast
     (below).
  5. Save, alarm, broadcast.
- **onClose(conn)** — if the connection has a `playerId`: `apply(leave)`, save, alarm, broadcast.
- **onError(conn)** — the same. partyserver sends abnormally dropped sockets here, and `onClose` may
  not follow them; without this the player would stay "connected" forever and take up a place in
  the room. A repeated `leave` is safe: it is idempotent.
- **onAlarm** — `apply(tick)`, save, alarm, broadcast.

### Broadcast

- In `lobby` and `results` — a snapshot to everyone after every state change.
- On the transition to `countdown` a `setInterval` of 100 ms starts, which sends a snapshot to
  everyone. The timer keeps the object awake until the end of the round. On the transition to
  `results` the timer stops, and a snapshot with the results goes out at once.
- The shared snapshot is built once per tick and goes out as one string to everyone at once — this
  is the hot path, and it must not be built per connection.
- The private part is a separate message to each connection and only when it has changed. A mode
  that does not need it returns nothing, and the server sends nothing.
- **Simulation tick.** If the mode has `tickMs !== null`, the same room timer first advances time
  with the `tick` command, and only then broadcasts a snapshot. The clicker's `tickMs` is empty:
  it has no simulation step, and time is advanced by incoming commands, the alarm and the snapshot
  timer, which applies a `tick` before every broadcast (plan 17: a late alarm had left every
  snapshot saying `countdown` past `goAt`). A beat that changes nothing writes nothing. A snake, on the contrary, has to move even when nobody presses keys — there the simulation
  step will become the main engine of the round. The broadcast rate stays its own: the simulation
  can run more often than snapshots go out.

### Storage

`ctx.storage.put('state', state)` is always called when the phase has changed, and on the `join`,
`leave`, `start` commands, and also in `onStart`. This matters: a phase change can also be brought
by an ordinary click — `advance` runs before every command, so it is a click that can close the
round. Deciding by the type of the command is not allowed, or the round's results would reach the
players but not the storage. The only things not saved are clicks that merely raised the score.

### Alarm

After every handling: `d = nextDeadline(state, config)`. If `d !== null` —
`ctx.storage.setAlarm(d)`, otherwise `ctx.storage.deleteAlarm()`. The deadline is compared with the
one already set, and the alarm is not touched needlessly: it is a storage write, and during a round
the deadline is constant — otherwise every click would turn into a disk write.

## 8. Client (apps/game/src/client)

### Routes

No routing library: `/` is the landing page, `/r/:roomId` is the room, everything else → the
landing page.

### localStorage

`playerId` (generated on the first visit), `name`, `hostKeys` (`roomId → hostKey`).
All accesses are in try/catch. Without localStorage the game works, but after a reload the player
counts as new.

### net/

- Connection: `new PartySocket({ host: location.host, party: 'room', room: roomId })`.
- On every `open` event a `join` is sent with `playerId`, `name` and `hostKey` if there is one for
  this room.
- `start` and `input` are sent only while the connection is open. What is pressed without a
  connection is not queued and not sent later.
- Incoming messages are parsed by `parseServerMessage` and put into the store.
- Clock correction: for every snapshot `serverNow − Date.now()` is computed. The correction is the
  maximum of the last 10 values: network delay only lowers the value, so the maximum is closest to
  the truth. Server time on the client is `Date.now() + offset`.

### Store (zustand)

`{ status: 'connecting' | 'open' | 'reconnecting', you, isHost, snapshot, offset, localClicks, lastError }`.
`localClicks` is the number of one's own presses in the current round, reset on the transition to
`countdown`.

### Screens

- **Landing** — the "Create room" button.
- **Join** — a name field and an "Enter" button. If a name is already saved, the screen is skipped.
- **Lobby** — the list of players (disconnected ones are dimmed), "Copy invite link"; for the host
  also "Copy host link" and "Start".
- **Arena** (`countdown` and `running`) — the scene on top, a large timer, a large full-width
  button at the bottom (on a phone — the bottom half of the screen). The button is active from
  `goAt` to `endsAt` by the client's server time. The button shows `localClicks`, the scene shows
  the server numbers of all players.
- **Results** — the scene with the winner highlighted, a table of places, the banner "<name>
  wins!" or "Nobody clicked"; for the host — "Play again".
- Over any screen: a "Reconnecting…" strip when the status is not `open`; the message "The round was
  interrupted. Start a new one." when `notice = round_aborted`.

### Scene (scene/RaceScene)

- A `<Canvas>` from react-three-fiber, the camera looks at the players' columns.
- One column per player, in `publicId` order, up to 12 in a row, then the next row.
- The target height is proportional to `clicks / max(1, the largest clicks)`. Each frame the current
  height catches up with the target through `THREE.MathUtils.damp` in `useFrame`, without
  `setState`.
- Names go through `Html` from drei.
- The winner on the results screen is a gold material with emission.
- A snapshot buffer with interpolation over time is not needed while the scene has no moving
  objects; it will appear together with them.

### Input

Input is separated from the screen: the mode's adapter translates browser events into that mode's
`input`, and the arena shows its control. Otherwise the arena will forever remain "a button labelled
Click", and the next game will need arrow keys on the keyboard and swipes.

- **Clicker.** The button listens to `pointerdown`, with `touch-action: manipulation` and
  `user-select: none` in CSS. Every event is one click, several fingers count. Input:
  `{ type: 'click' }`.
- **Keyboard** (a snake and anything that moves will need it). The adapter attaches a listener to
  the document, translates the arrows and WASD into the mode's input, suppresses page scrolling for
  the arrows and space, and does not send a repeat while a key is held: the server waits for an
  intent, not a stream of events. On a phone the same input is given by a swipe across the arena.
- The general rule: the adapter does not know the rules of the game and decides nothing — it only
  translates a gesture into an intent. The server decides.

### Palette (theme.ts)

Starting values, to be tuned by eye. They are set as CSS variables on `:root` and used in the
scene's materials.

```ts
export const theme = {
  bg: '#0b0d14', surface: '#151a26', border: '#262c3d',
  text: '#ece8df', muted: '#8b90a3',
  gold: '#d4a93c', goldBright: '#f2d47a', danger: '#e5534b',
};
```

### Texts

All interface strings are in `strings.ts`, in one language (Russian when this was written, English
since).

## 9. Errors and edge cases

| Situation | Behaviour |
|---|---|
| Malformed JSON, failed the schema, more than 1024 bytes | `error invalid_message` to the sender, the connection stays |
| `start` or `input` before `join` | `error not_joined` |
| `start` not from the host | `error not_host` |
| `start` in `countdown` or `running` | `error wrong_phase` |
| `join` into a full room | `error room_full` |
| A click outside `running` or over the limit | silently ignored |
| Two tabs with the same `playerId` | one player; disconnected when both are closed |
| A repeated `join` from the same connection | nothing changes: the connection is already counted |
| An extra `leave` of the same connection | nothing changes: live connections are not touched, the removal deadline does not move |
| Connection lost | PartySocket reconnects, the client sends `join` again; in the lobby the player waits 30 s, in a round the score is kept |
| The object restarted in the middle of a round | `abortRound`: lobby and `notice = round_aborted` |
| The alarm is late | no effect: commands and `tick` advance time first |
| Wrong `roomId` format | 404 before connecting |
| The host left | the room lives, the host returns with the saved key |

## 10. Testing

- **packages/game — Vitest, by TDD.**
  - join: a new player, a repeated entry, a second tab, a full room, pinning the host key, entry
    with a right and a wrong key;
  - start: not the host, a wrong phase, score reset, start from `results`;
  - click: outside a round, the bucket reserve of 15, refill at 15/s, the `endsAt + lateGraceMs`
    boundary;
  - advance: each transition, several transitions in one call, removing disconnected players only
    outside a round;
  - results: a tie broken by `lastCountedAt`, a full tie broken by `publicId`, nobody clicked;
  - `nextDeadline`, `abortRound`, `syncConnections`, the input state staying unchanged.
- **packages/protocol — Vitest.** Valid messages; a name of spaces and one longer than 20; extra
  fields; a message longer than 1024 bytes; no `playerId` or `hostKey` in the snapshot.
- **Worker — `@cloudflare/vitest-plugin`.** A WebSocket to a real Worker: two players, the host
  starts, clicks, results in the snapshot; `start` not from the host; a wrong `roomId` → 404.
  Durations: a 50 ms countdown, a 200 ms round.
- **e2e — Playwright** against the Vite dev server, which Playwright starts itself: two browser
  contexts (desktop and a mobile viewport), creating a room, joining by link, a round, the same
  winner for both. A separate `wrangler dev` is not needed: the Worker runs inside the dev server.

## 11. Tools, development, CI

- Node 22, pnpm through corepack, pnpm workspaces. Dependency versions are pinned in the
  implementation plan from the current stable releases.
- TypeScript in `strict` mode, a shared `tsconfig.base.json`. Type checking goes per package:
  `tsc --noEmit` in each, run through `pnpm -r typecheck`. Project references are not needed: the
  packages hand out TypeScript sources directly, so there is nothing to build or to order.
- Biome — the linter and formatter for the whole repository.
- Local development: one command, `vite dev`. The `@cloudflare/vite-plugin` plugin runs the Worker
  right inside the dev server, so a second process and proxying `/parties` are not needed.
  `vite build` puts the client in `dist/client`, the Worker and the generated config in
  `dist/<name>`, after which `wrangler deploy` goes out without a single extra setting.
- React is pinned to 19.2: `@react-three/fiber` 9.7 requires strictly below 19.3.
- Playwright's browsers must match its version: before the first run and in CI
  `playwright install chromium` is needed.
- The three.js scene is loaded lazily: it pulls in about a megabyte, and there is no reason to keep
  it in the main bundle, which is needed already on the entry screen.
- CI in GitHub Actions:
  - on every push and on a pull request: Biome, type checking, package and Worker tests, the build,
    installing the browser and Playwright;
  - on a push to `main` after the checks: `wrangler deploy` with `CLOUDFLARE_API_TOKEN` and
    `CLOUDFLARE_ACCOUNT_ID` from the repository secrets.

## 12. External dependencies and access

- A personal Cloudflare account on the free tier, a workers.dev subdomain, `wrangler login` for a
  manual deploy.
- A Cloudflare API token (the "Edit Cloudflare Workers" template) and the Account ID in the secrets
  of the GitHub repository `tjuana/clicker`.
- No server secrets are needed.

## 13. Risks

| Risk | Resolution |
|---|---|
| Someone mass-creates rooms or floods messages and eats the free tier's daily limit | Accepted: the worst outcome is that the game is down until the end of the day, with no score. If it happens — Turnstile on room creation and a per-connection message limit |
| An autoclicker outpaces any human | Accepted, the game rests on trust. The bucket was raised to 30 clicks/s on purpose: at 15 live players hit the ceiling and the team's round ended in a tie. Now the ceiling cannot be reached by hand and limits only a script |
| Network delay cuts the window for remote players | The button turns on by server time with the clock correction, and the server accepts clicks for another 250 ms after the round ends |
| The partyserver, partysocket or vitest-plugin API differs in details from what is described | The exact signatures are checked against the documentation when the plan is written |
