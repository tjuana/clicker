# Clicker Client Implementation Plan (plan 3 of 3: client, scene, deploy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the project to a playable state: a React browser client with a 3D scene, end-to-end tests in two real browsers, and a one-command deploy to the Cloudflare free tier.

**Architecture:** The client and the Worker live in one app, `apps/game`. The `@cloudflare/vite-plugin` plugin runs the Worker inside the Vite dev server and builds both parts into one deploy: the client into `dist/client`, the Worker and the generated config into `dist/clicker`. The client is thin: it knows no game rules, it sends commands and draws the snapshots the server sends.

**Tech Stack:** Vite 8.3.0, React 19.2.8, @vitejs/plugin-react 6.1.1, @cloudflare/vite-plugin 1.54.8, three 0.186.0, @react-three/fiber 9.7.0, @react-three/drei 10.7.8, zustand 5.0.15, partysocket 1.3.0, Playwright 1.63.0, TypeScript 7.0.2.

Spec: [2026-09-11-clicker-foundation-design.md](../specs/2026-09-11-clicker-foundation-design.md), sections 3, 4, 8, 10, 11. Plans 1 and 2 are done and merged into `main`.

---

## What was verified before this plan

The prototype was built and run on this machine end to end: build, typecheck, an end-to-end test in two browsers (18.3 s, real round timings), `wrangler deploy --dry-run`, and two test runners working side by side.

Six findings that shaped this plan:

1. **The Cloudflare plugin builds the client and the Worker together.** `vite build` produces `dist/client` with the static files and `dist/<name>/index.js` with the Worker and a generated `wrangler.json`; after that `wrangler deploy` goes out with no extra configuration — checked with a dry run, which found the static files, the Durable Object binding and the variables. So the client and the server are one app, and the earlier idea of proxying `/parties` to a separate `wrangler dev` is dropped.
2. **Two Vite configs in one package get along**, but by default `vitest` also picks up the Playwright end-to-end tests and tries to run them inside workerd — it fails on `playwright-core`. One line fixes it: `test: { include: ['test/**/*.test.ts'] }`.
3. **React is pinned at 19.2.8.** `@react-three/fiber@9.7.0` requires `react >=19 <19.3`, and the latest React is 19.3. 19.3 must not be installed until R3F releases a compatible version.
4. **Playwright browsers must match its version.** The machine had builds 1193 and 1208; Playwright 1.63 needed 1243 and refused to start until `playwright install chromium` was run.
5. **The client bundle is 1.1 MB (302 KB gzipped)**, almost all of it three.js. The scene is loaded lazily so that the entry screen does not drag it in.
6. **`THREE.Clock: This module has been deprecated`** is a warning from inside react-three-fiber, not from our code. It breaks nothing and there is nothing to fix it with.
7. **The first version of the scene looked broken, and only eyes found it.** Three mistakes, all accounted for in the code below: the column height was computed relative to the leader, so a player alone in the room always sat at the maximum and never saw any growth; the camera was not told where to look, so the frame came out random — the column drifted off the top edge; a full-width canvas at a height of 240 pixels gave an aspect ratio of about 8:1 and squashed the scene into a strip. Hence the rule: check the scene with a screenshot from a real browser, not only with tests.

## How to execute

- Branch `feat/client`, we work in the repository itself.
- One task, one commit. Conventional Commits, English, **no Claude attribution**.
- Checks before every commit: `pnpm format`, then `pnpm check`, `pnpm typecheck`, `pnpm test`.

## File structure

```
apps/game/                     (moves from apps/server)
  index.html
  vite.config.ts               react() + cloudflare()
  vitest.config.ts             Worker tests, scope limited to test/
  playwright.config.ts         end-to-end tests, starts the dev server itself
  wrangler.jsonc               main → src/worker/worker.ts, assets, Durable Object
  tsconfig.client.json         DOM and JSX
  tsconfig.worker.json         Workers types
  src/worker/worker.ts         room routing           (moves)
  src/worker/room.ts           the room               (moves)
  src/client/main.tsx          entry point
  src/client/app.tsx           screen choice by phase
  src/client/net.ts            connection and commands
  src/client/store.ts          client state (zustand)
  src/client/room-link.ts      room ids, host key, links
  src/client/theme.ts          palette
  src/client/strings.ts        interface texts
  src/client/screens/*.tsx     Landing, Join, Lobby, Arena, Results
  src/client/scene/race.tsx    scene on react-three-fiber
  test/*.test.ts               Worker tests            (move)
  e2e/round.spec.ts            end-to-end test
```

---

### Task 1: Turn apps/server into apps/game

**Files:**
- Move: `apps/server` → `apps/game`, inside it `src/worker.ts` and `src/room.ts` into `src/worker/`
- Modify: `apps/game/package.json`, `apps/game/wrangler.jsonc`, `apps/game/tsconfig.json`, `apps/game/vitest.config.ts`

- [ ] **Step 1: Move the app and the Worker sources**

```bash
git mv apps/server apps/game
mkdir apps/game/src/worker
git mv apps/game/src/room.ts apps/game/src/worker/room.ts
git mv apps/game/src/worker.ts apps/game/src/worker/worker.ts
```

- [ ] **Step 2: Rename the package in `apps/game/package.json`**

The name `@clicker/game` is already taken by the rules package, so the app is called `@clicker/app`.

```json
  "name": "@clicker/app",
```

- [ ] **Step 3: Fix the entry path in `apps/game/wrangler.jsonc`**

```jsonc
  "main": "src/worker/worker.ts",
```

- [ ] **Step 4: Limit the scope of vitest in `apps/game/vitest.config.ts`**

Add after the `plugins` array:

```ts
  // End-to-end tests live in e2e/ and are run by Playwright: they cannot go inside workerd.
  test: { include: ['test/**/*.test.ts'] },
```

- [ ] **Step 5: Check that nothing broke**

```bash
pnpm install
pnpm --filter @clicker/app test
pnpm check
```
Expected: `Test Files 2 passed (2)`, `Tests 15 passed (15)`; Biome reports nothing.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add -A apps/game pnpm-lock.yaml
git commit -m "refactor: turn the server app into the game app"
```

---

### Task 2: The client skeleton on Vite and React

**Files:**
- Modify: `apps/game/package.json`, `apps/game/wrangler.jsonc`, `apps/game/tsconfig.json` → delete, replacing it with two new ones
- Create: `apps/game/vite.config.ts`, `apps/game/index.html`, `apps/game/tsconfig.client.json`, `apps/game/tsconfig.worker.json`, `apps/game/src/client/main.tsx`, `apps/game/src/client/app.tsx`

- [ ] **Step 1: Add the client dependencies to `apps/game/package.json`**

Versions are pinned exactly: React must be exactly 19.2.8, otherwise react-three-fiber refuses to install.

```json
  "dependencies": {
    "@clicker/game": "workspace:*",
    "@clicker/protocol": "workspace:*",
    "@react-three/drei": "10.7.8",
    "@react-three/fiber": "9.7.0",
    "partyserver": "0.5.10",
    "partysocket": "1.3.0",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "three": "0.186.0",
    "zustand": "5.0.15"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "1.54.8",
    "@cloudflare/vitest-plugin": "1.1.8",
    "@cloudflare/workers-types": "5.20260911.1",
    "@playwright/test": "1.63.0",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
    "@types/three": "0.186.0",
    "@vitejs/plugin-react": "6.1.1",
    "typescript": "7.0.2",
    "vite": "8.3.0",
    "vitest": "4.1.11",
    "wrangler": "4.131.1"
  }
```

And the scripts:

```json
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "deploy": "vite build && wrangler deploy",
    "e2e": "playwright test",
    "test": "vitest run",
    "types": "wrangler types",
    "typecheck": "wrangler types && tsc -p tsconfig.client.json --noEmit && tsc -p tsconfig.worker.json --noEmit"
  },
```

- [ ] **Step 2: Create `apps/game/vite.config.ts`**

```ts
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), cloudflare({ configPath: './wrangler.jsonc' })],
});
```

- [ ] **Step 3: Add the static files to `apps/game/wrangler.jsonc`**

The plugin fills in the directory of the built static files; we do not set it by hand.

```jsonc
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/parties/*"]
  },
```

- [ ] **Step 4: Create `apps/game/index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Clicker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Replace `apps/game/tsconfig.json` with two configs**

Delete `tsconfig.json` and create `apps/game/tsconfig.client.json`:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2022", "dom", "dom.iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/client", "vite.config.ts", "playwright.config.ts", "e2e"]
}
```

and `apps/game/tsconfig.worker.json`:

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
  "include": ["src/worker", "test", "vitest.config.ts", "worker-configuration.d.ts"]
}
```

- [ ] **Step 6: Create `apps/game/src/client/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';

const container = document.getElementById('root');
if (container === null) throw new Error('root element is missing');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 7: Create a temporary `apps/game/src/client/app.tsx`**

The real screens arrive in Task 4; for now the minimum is enough to check the build.

```tsx
export function App() {
  return <main>Clicker</main>;
}
```

- [ ] **Step 8: Check the install and the build**

```bash
pnpm install
pnpm --filter @clicker/app run build
pnpm --filter @clicker/app typecheck
pnpm --filter @clicker/app test
```
Expected: the build prints two parts — `dist/clicker/index.js` with the Worker and `dist/client/…` with the static files; the typecheck is silent; the Worker tests are still 15.

- [ ] **Step 9: Add the build output to `.gitignore` and commit**

```gitignore
dist/
```

```bash
pnpm format
git add -A
git commit -m "feat(app): serve the client and the worker from one vite app"
```

---

### Task 3: Connection, state and room links

> **Done, but partly out of date.** The code of this task is already in the repository. The message
> format changed after it: every message gained a version field `v`, and `{ type: 'click' }` became
> `{ type: 'input', input: { type: 'click' } }`. Plan 4 brings them in order — the snippets here are
> left as they are, so that the history of the task matches what was done.

**Files:**
- Create: `apps/game/src/client/room-link.ts`, `apps/game/src/client/store.ts`, `apps/game/src/client/net.ts`

- [ ] **Step 1: Create `apps/game/src/client/room-link.ts`**

Ids come from the protocol package — the same place where the server checks them.

```ts
import { generateId, isId } from '@clicker/protocol';

const HOST_KEYS = 'clicker.hostKeys';
const PLAYER_ID = 'clicker.playerId';
const NAME = 'clicker.name';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A private window or a ban on storage: this does not stop play.
  }
}

/** The player's permanent id. It is a session secret and never leaves the client. */
export function playerId(): string {
  const stored = read(PLAYER_ID);
  if (stored !== null && isId(stored)) return stored;
  const created = generateId();
  write(PLAYER_ID, created);
  return created;
}

export function savedName(): string {
  return read(NAME) ?? '';
}

export function saveName(name: string): void {
  write(NAME, name);
}

/** `/r/<roomId>` — the link itself is the invitation. */
export function roomIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]{22})$/);
  return match?.[1] ?? null;
}

function hostKeys(): Record<string, string> {
  const raw = read(HOST_KEYS);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function hostKeyFor(roomId: string): string | undefined {
  return hostKeys()[roomId];
}

export function rememberHostKey(roomId: string, key: string): void {
  write(HOST_KEYS, JSON.stringify({ ...hostKeys(), [roomId]: key }));
}

/**
 * The host key arrives in the URL fragment: it does not go to the server.
 * Right after reading it we erase it from the browser's address bar — on a screen share at the
 * daily stand-up, everyone sees it.
 */
export function takeHostKeyFromHash(roomId: string): void {
  const match = window.location.hash.match(/^#host=([A-Za-z0-9_-]{22})$/);
  if (match?.[1] === undefined) return;
  rememberHostKey(roomId, match[1]);
  window.history.replaceState(null, '', window.location.pathname);
}

export function createRoom(): { roomId: string; hostKey: string } {
  const roomId = generateId();
  const hostKey = generateId();
  rememberHostKey(roomId, hostKey);
  return { roomId, hostKey };
}

export function inviteLink(roomId: string): string {
  return `${window.location.origin}/r/${roomId}`;
}

export function hostLink(roomId: string, hostKey: string): string {
  return `${inviteLink(roomId)}#host=${hostKey}`;
}
```

- [ ] **Step 2: Create `apps/game/src/client/store.ts`**

```ts
import type { ServerErrorCode, SnapshotMessage } from '@clicker/protocol';
import { create } from 'zustand';

export type Status = 'connecting' | 'open' | 'reconnecting';

interface ClientState {
  status: Status;
  you: string | null;
  isHost: boolean;
  snapshot: SnapshotMessage | null;
  /** The difference between the server and browser clocks, by the maximum of the latest values. */
  offset: number;
  localClicks: number;
  lastError: ServerErrorCode | 'invalid_message' | null;
  setStatus: (status: Status) => void;
  welcome: (you: string, isHost: boolean) => void;
  receive: (snapshot: SnapshotMessage) => void;
  fail: (code: ServerErrorCode | 'invalid_message') => void;
  countClick: () => void;
}

const OFFSET_SAMPLES = 10;
const samples: number[] = [];

export const useClient = create<ClientState>((set) => ({
  status: 'connecting',
  you: null,
  isHost: false,
  snapshot: null,
  offset: 0,
  localClicks: 0,
  lastError: null,
  setStatus: (status) => set({ status }),
  welcome: (you, isHost) => set({ you, isHost }),
  receive: (snapshot) => {
    // Network delay only shrinks the difference, so we take the maximum of the latest samples.
    samples.push(snapshot.serverNow - Date.now());
    if (samples.length > OFFSET_SAMPLES) samples.shift();
    set((state) => ({
      snapshot,
      offset: Math.max(...samples),
      localClicks: snapshot.phase === 'countdown' ? 0 : state.localClicks,
    }));
  },
  fail: (code) => set({ lastError: code }),
  countClick: () => set((state) => ({ localClicks: state.localClicks + 1 })),
}));

/** Server time by the browser's clock. */
export function serverNow(): number {
  return Date.now() + useClient.getState().offset;
}
```

- [ ] **Step 3: Create `apps/game/src/client/net.ts`**

```ts
import { parseServerMessage } from '@clicker/protocol';
import PartySocket from 'partysocket';
import { hostKeyFor, playerId } from './room-link';
import { useClient } from './store';

export interface Connection {
  start: () => void;
  click: () => void;
  close: () => void;
}

export function connect(roomId: string, name: string): Connection {
  const socket = new PartySocket({
    host: window.location.host,
    party: 'room',
    room: roomId,
  });

  const send = (message: unknown): void => {
    // Presses must not pile up during a drop: they would land in a bunch after the round ends.
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  };

  socket.addEventListener('open', () => {
    useClient.getState().setStatus('open');
    const hostKey = hostKeyFor(roomId);
    send({
      type: 'join',
      playerId: playerId(),
      name,
      ...(hostKey === undefined ? {} : { hostKey }),
    });
  });

  socket.addEventListener('close', () => useClient.getState().setStatus('reconnecting'));

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    const message = parseServerMessage(event.data);
    if (message === null) return;
    if (message.type === 'welcome') useClient.getState().welcome(message.you, message.isHost);
    if (message.type === 'snapshot') useClient.getState().receive(message);
    if (message.type === 'error') useClient.getState().fail(message.code);
  });

  return {
    start: () => send({ type: 'start' }),
    click: () => {
      useClient.getState().countClick();
      send({ type: 'click' });
    },
    close: () => socket.close(),
  };
}
```

- [ ] **Step 4: Check the types and commit**

```bash
pnpm format
pnpm --filter @clicker/app typecheck
git add apps/game
git commit -m "feat(app): connect to a room and keep client state"
```

---

### Task 4: Menu, name entry and screens

**Files:**
- Create: `apps/game/src/client/theme.ts`, `apps/game/src/client/strings.ts`, `apps/game/src/client/clock.ts`, `apps/game/src/client/ui.tsx`, `apps/game/src/client/hud.tsx`, `apps/game/src/client/screens/{landing,join,lobby,arena,results}.tsx`
- Modify: `apps/game/src/client/app.tsx`

The interface is plain React with inline styles from `theme.ts`: this project needs no separate styling system. Texts are English only and only through `strings.ts`, so the language changes in one place.

**The player's path.** Home → "Create room" → room address → **we ask for the name before entering
the room** → lobby → countdown and round → results → "Play again". The name is remembered, and the
second time the entry screen is not shown; the name can be changed from the lobby.

**HUD** is visible in the countdown, the round and the results, and always answers four questions:
which phase, how much time is left, how many I have, who is leading. It also shows the number of
players and the state of the connection.

> **Corrections after the fact (2026-09-14).** The plan was written before plan 4, and three places
> went out of date:
>
> 1. **`strings.errors` is incomplete.** `ServerErrorCode` now includes `invalid_message` and
>    `bad_version`. Both keys are needed: a player with an old tab must read that it needs a reload,
>    not see emptiness.
> 2. **`index.html` declares `lang="ru"`**, although the whole interface is English. The right value
>    is `lang="en"` — otherwise the browser offers to translate the page from a language that is not
>    there, and a screen reader reads English text with Russian phonetics.
> 3. **The score lives in the mode's slot.** A player in `players[]` has only
>    `{ id, name, connected }`, and the click count is in `snapshot.data.scores[id]`. The HUD code in
>    Step 5 is already right; the prose in Step 6 sometimes speaks of the old format, and the code is
>    the one to trust.

- [ ] **Step 1: Create `apps/game/src/client/theme.ts`**

```ts
export const theme = {
  bg: '#0b0d14',
  surface: '#151a26',
  border: '#262c3d',
  text: '#ece8df',
  muted: '#8b90a3',
  gold: '#d4a93c',
  goldBright: '#f2d47a',
  danger: '#e5534b',
};
```

- [ ] **Step 2: Create `apps/game/src/client/strings.ts`**

```ts
export const strings = {
  title: 'Clicker',
  tagline: 'Ten seconds. One button. Most clicks wins.',
  createRoom: 'Create room',
  nameLabel: 'Your name',
  namePlaceholder: 'Anna',
  enter: 'Enter',
  changeName: 'Change name',
  waiting: 'Waiting for the host to start',
  players: 'Players',
  copyInvite: 'Copy invite link',
  copyHostLink: 'Copy host link',
  copied: 'Copied',
  start: 'Start',
  again: 'Play again',
  click: 'CLICK',
  getReady: 'Get ready',
  go: 'Go!',
  finished: 'Finished',
  you: 'You',
  leader: 'Leader',
  reconnecting: 'Reconnecting…',
  roundAborted: 'The round was interrupted. Start a new one.',
  nobodyClicked: 'Nobody clicked',
  wins: 'wins!',
  errors: {
    not_host: 'Only the host can start a round',
    not_joined: 'You are not in the room yet',
    wrong_phase: 'Not now',
    room_full: 'The room is full',
    invalid_message: 'The server did not understand that',
  },
};
```

- [ ] **Step 3: Create the clock `apps/game/src/client/clock.ts`**

Snapshots arrive ten times a second, while the timer must run smoothly and by server time.
A separate 100 ms tick feeds only the components that need the time — there is no reason to redraw
the whole screen because of it.

```ts
import { useEffect, useState } from 'react';
import { serverNow } from './store';

/** Server time, refreshed ten times a second. */
export function useServerClock(): number {
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(timer);
  }, []);

  return now;
}

/** Whole seconds left, never negative. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}
```

- [ ] **Step 4: Create the shared elements `apps/game/src/client/ui.tsx`**

Three pieces that repeat on every screen: `Screen` (a dark background, a central column up to
860 pixels wide, padding), `Button` (a large button, `touch-action: manipulation`, a `disabled`
state), `CopyButton` (copies a string to the clipboard and for two seconds changes the label to
`Copied`). `CopyButton` must survive a `navigator.clipboard` refusal: in that case it shows the link
itself, so that it can be selected by hand.

- [ ] **Step 5: Create the HUD `apps/game/src/client/hud.tsx`**

One row on a wide screen, two on a narrow one. Phase and timer on the left, the player's own score
in the centre, the leader and the number of players on the right. Values come from the snapshot,
time from `useServerClock`.

```tsx
import { strings } from './strings';
import { secondsLeft, useServerClock } from './clock';
import { useClient } from './store';
import { theme } from './theme';

export function Hud() {
  const now = useServerClock();
  const snapshot = useClient((state) => state.snapshot);
  const you = useClient((state) => state.you);
  const localClicks = useClient((state) => state.localClicks);
  if (snapshot === null) return null;

  const players = snapshot.players;
  // Scores live in the mode's slot: the generic part of a snapshot knows nothing about clicks.
  const scoreOf = (id: string): number => snapshot.data.scores[id] ?? 0;
  const leader = players.reduce<(typeof players)[number] | null>(
    (best, player) => (best === null || scoreOf(player.id) > scoreOf(best.id) ? player : best),
    null,
  );

  // The countdown counts to goAt, the round counts to endsAt.
  const deadline =
    snapshot.phase === 'countdown'
      ? (snapshot.round?.goAt ?? now)
      : (snapshot.round?.endsAt ?? now);
  const label =
    snapshot.phase === 'countdown'
      ? strings.getReady
      : snapshot.phase === 'running'
        ? strings.go
        : strings.finished;

  return (
    <div
      data-testid="hud"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
      }}
    >
      <span data-testid="hud-phase">
        {label}
        {snapshot.round !== null && snapshot.phase !== 'results' ? (
          <strong data-testid="hud-timer" style={{ marginLeft: 8, color: theme.goldBright }}>
            {secondsLeft(deadline, now)}
          </strong>
        ) : null}
      </span>
      <span data-testid="hud-you">
        {strings.you}: <strong>{localClicks}</strong>
      </span>
      <span data-testid="hud-leader" style={{ color: theme.muted }}>
        {leader === null ? '—' : `${strings.leader}: ${leader.name} ${scoreOf(leader.id)}`} ·{' '}
        {players.length}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Create the screens in `apps/game/src/client/screens/`**

- **`landing.tsx`** — the title, the `tagline` line, one `createRoom` button with
  `data-testid="create-room"`. On press: `createRoom()` from `room-link.ts`, then `history.pushState`
  to `/r/<roomId>`.
- **`join.tsx`** — a heading with the room number, a `data-testid="name-input"` field (value from
  `savedName()`, `maxLength` from the protocol's `MAX_NAME_LENGTH`) and a `data-testid="enter"`
  button. The button is disabled while the field is empty after `trim`. On press: `saveName(name)`
  and entering the room.
- **`lobby.tsx`** — a `data-testid="players"` list of players (disconnected ones in a muted
  colour), a `CopyButton` with the invite, and for the host also a `CopyButton` with the host link
  and a `data-testid="start"` button. A non-host gets the `waiting` line instead of the button. Plus
  a `changeName` link that returns to the entry screen.
- **`arena.tsx`** — `Hud`, the scene (Task 5) and a `data-testid="click"` button of full width, at
  least 96 pixels tall, on `onPointerDown`. The button is active strictly inside the round, by
  server time:

```tsx
const live = snapshot.round !== null && now >= snapshot.round.goAt && now <= snapshot.round.endsAt;
```

- **`results.tsx`** — `Hud`, the scene with the winner highlighted, a `data-testid="winner"` banner
  (`"<name> wins!"` or `nobodyClicked` if first place has zero clicks) and a table of places
  `data-testid="results"`. The host gets an `again` button with the same `data-testid="start"`, so
  that the end-to-end test does not depend on whether this is the first round or the second.

- [ ] **Step 7: Assemble `apps/game/src/client/app.tsx`**

The order of screen choice: no room in the address → `Landing`; name not saved → `Join`; no
snapshot yet → `Lobby` with a list of just yourself; after that by phase — `lobby`, `arena`
(`countdown` and `running`), `results`.

On top of everything two notices: a `reconnecting` banner when `status !== 'open'`, and
`roundAborted` when `notice === 'round_aborted'`. An error from `lastError` is shown with the text
from `strings.errors` next to the button that caused it, and goes away at the player's next action.

- [ ] **Step 8: Check by eye**

Build (`pnpm --filter @clicker/app run build`), start `pnpm --filter @clicker/app dev`, open
two tabs in one room and walk the whole path: creation, name entry, lobby, countdown, round,
results. Look separately at a narrow screen (in the browser, phone mode): the HUD must wrap onto two
lines, the click button must stay full width, double-tap zoom must not trigger.

- [ ] **Step 9: Commit**

```bash
pnpm format
pnpm --filter @clicker/app typecheck
pnpm --filter @clicker/app run build
git add apps/game
git commit -m "feat(app): add the menu, name entry, hud and screens"
```

---

### Task 5: The race scene on three.js

> **Done and verified (2026-09-15), commit `1ef26d7`.** A different metaphor was chosen than the
> original one: not columns growing with the score, but an **honest race** — players run down a lane,
> position = number of clicks, the camera keeps the whole field in frame.
>
> The order here is deliberately the reverse of the usual: the scene first worked and was captured
> from the screen, and only then did its code go into the plan. Last time the task was written off
> the cuff — the result was columns that passed every check and looked broken. Below is the verbatim
> code from the repository.

**Files:**
- Create: `apps/game/src/client/scene/race.tsx`
- Modify: `apps/game/src/client/screens/arena.tsx`, `apps/game/src/client/screens/results.tsx`

- [x] **Step 1: Create `apps/game/src/client/scene/race.tsx`**

A runner's position catches up with its target every frame through `damp`, without `setState`:
this turns snapshots arriving ten times a second into smooth motion.

```tsx
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { type Group, MathUtils } from 'three';
import { theme } from '../theme';

export interface Racer {
  id: string;
  clicks: number;
}

/**
 * One click is always this far. A fixed scale, not one relative to the leader:
 * with a relative scale a player alone in a room sits pinned at the front and never
 * sees themselves move.
 */
const UNIT = 0.14;
/** Distance between lanes across the track. */
const LANE = 1.15;
/** Marks every metre; without them a racer over a flat floor looks motionless. */
const MARKS = 48;
const MARK_SPACING = 1;

/** Smoothing: snapshots land ten times a second, the eye wants sixty. */
const damp = (current: number, target: number, delta: number, rate = 7): number =>
  MathUtils.damp(current, target, rate, delta);

/** Named apart from the `Racer` data type on purpose: one is a shape on the track, the other a row of numbers. */
function Runner({ x, z, gold }: { x: number; z: number; gold: boolean }) {
  const group = useRef<Group>(null);

  useFrame((_state, delta) => {
    if (group.current === null) return;
    group.current.position.x = damp(group.current.position.x, x, delta);
  });

  return (
    <group ref={group} position={[0, 0, z]}>
      {/* A body and a nose: enough of a shape to tell which way it is facing. */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[0.72, 0.42, 0.56]} />
        <meshStandardMaterial
          color={gold ? theme.goldBright : '#4d5a85'}
          metalness={0.1}
          roughness={0.55}
        />
      </mesh>
      <mesh position={[0.46, 0.24, 0]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.26, 0.26, 0.5]} />
        <meshStandardMaterial
          color={gold ? theme.gold : '#3f4a6d'}
          metalness={0.1}
          roughness={0.6}
        />
      </mesh>
    </group>
  );
}

/**
 * The camera frames the whole field, not the leader: following the leader alone pushes
 * everyone behind them out of the left edge, and the gap between players is the one thing
 * a race has to show.
 */
function Rig({ firstX, lastX }: { firstX: number; lastX: number }) {
  const { camera } = useThree();

  useFrame((_state, delta) => {
    const focus = (firstX + lastX) / 2;
    const spread = firstX - lastX;
    // Pull back as the field stretches, but never closer than a readable minimum.
    const distance = MathUtils.clamp(6 + spread * 0.45, 6, 16);

    // Mostly behind the field and only a little to the side: from side-on the track
    // crosses the frame as a diagonal band instead of receding down the lane.
    camera.position.x = damp(camera.position.x, focus - distance * 0.85, delta, 4);
    camera.position.y = damp(camera.position.y, 1.8 + distance * 0.1, delta, 4);
    camera.position.z = damp(camera.position.z, distance * 0.55, delta, 4);
    camera.lookAt(focus + 1.2, 0.4, 0);
  });

  return null;
}

function Track({ lanes }: { lanes: number }) {
  const width = Math.max(6, lanes * LANE + 3);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, width]} />
        <meshStandardMaterial color="#1b2136" roughness={0.95} />
      </mesh>

      {/* The start line, and then a mark every metre to make speed legible. */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.12, width]} />
        <meshBasicMaterial color={theme.gold} />
      </mesh>
      {/* Keyed by the distance each mark stands for, which is what actually identifies it. */}
      {Array.from({ length: MARKS }, (_, index) => (index + 1) * MARK_SPACING).map((distance) => (
        <mesh key={distance} position={[distance, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.04, width]} />
          <meshBasicMaterial color="#2c3450" />
        </mesh>
      ))}
    </group>
  );
}

export default function Race({ racers, you }: { racers: Racer[]; you: string | null }) {
  const clicks = racers.map((racer) => racer.clicks);
  const firstX = (clicks.length === 0 ? 0 : Math.max(...clicks)) * UNIT;
  const lastX = (clicks.length === 0 ? 0 : Math.min(...clicks)) * UNIT;

  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: [-4.2, 2.1, 6.4], fov: 42 }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={[theme.surface]} />
      <fog attach="fog" args={[theme.surface, 16, 34]} />

      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 9, 6]} intensity={1.5} castShadow />

      <Track lanes={racers.length} />
      {racers.map((racer, index) => (
        <Runner
          key={racer.id}
          x={racer.clicks * UNIT}
          z={(index - (racers.length - 1) / 2) * LANE}
          gold={racer.id === you}
        />
      ))}

      <Rig firstX={firstX} lastX={lastX} />
    </Canvas>
  );
}
```

- [x] **Step 2: Hook the scene up lazily**

In `arena.tsx` and `results.tsx`, next to the imports:

```tsx
import { lazy, Suspense } from 'react';

/** three.js is about a megabyte: the entry screens must not carry it. */
const Race = lazy(() => import('../scene/race'));
```

and one more line in the component body, without which highlighting "your own" will not work:

```tsx
  const you = useClient((state) => state.you);
```

The scene container must keep its proportions — otherwise it is squashed into a strip the full width of the screen:

```tsx
<div
  style={{
    aspectRatio: '3 / 2',
    maxHeight: 420,
    background: theme.surface,
    borderRadius: 12,
    overflow: 'hidden',
  }}
>
  <Suspense fallback={null}>
    {/* The scene knows nothing about the wire format: it gets ids and numbers. */}
    <Race
      racers={snapshot.players.map((player) => ({
        id: player.id,
        clicks: snapshot.data.scores[player.id] ?? 0,
      }))}
      you={you}
    />
  </Suspense>
</div>
```

- [x] **Step 3: Check the build size**

Run: `pnpm --filter @clicker/app run build`
Actual result:

```
dist/client/assets/index-DM0_z0xy.js  224.32 kB │ gzip:  71.13 kB
dist/client/assets/race-gis0Yue6.js   894.80 kB │ gzip: 236.44 kB
```

The scene ships as a separate chunk, the entry stays at 224 KB — which is the whole point of lazy loading.

- [x] **Step 4: Check by eye**

Play a whole round in two contexts of a real browser (desktop 1280×860 and Pixel 7) and look at
the screenshots. A green build says nothing about how it looks.

- [x] **Step 5: Commit**

```bash
pnpm format
git add apps/game/src/client
git commit -m "feat(app): draw the round as a race on a lane, framed to keep the field in view"
```

## What came out of this task

1. **A fixed scale, not one relative to the leader.** With a relative one a player alone in the
   room is always pinned at the maximum and sees no growth — which is what was wrong with the
   columns.
2. **Motion does not read without markings.** A runner over a plain-coloured plane looks motionless;
   cross marks every metre and a start line give the eye something to catch on.
3. **The camera leads the field, not the leader.** The first version followed the leader, and the
   one behind slid past the left edge of the frame — exactly what a race exists to show vanished.
4. **No name labels in 3D.** `drei/Text` pulls a font from an external CDN: an extra network
   dependency on Cloudflare. The leader's name is in the HUD anyway.
5. **The key for the marks is the distance, not the array index.** Biome rightly complains about
   `key={index}`; the right answer here is not to suppress the rule but to take a real identifier.
6. **three.js spews warnings from its own internals** — `PCFSoftShadowMap has been removed` and
   `THREE.Clock deprecated`. That is react-three-fiber, not our code, and there is nothing to fix
   them with.

### About taking screenshots

The screenshot tool turned out to be the source of three false diagnoses in a row, and this is worth remembering:

- **Polling the page with Playwright locators during a round hangs for minutes.** The page itself
  holds 60 frames per second meanwhile — checked with a `requestAnimationFrame` counter inside the
  page. All waits in the script must be on the node side, not through `waitForTimeout`/locators.
- **Two tabs of one context are one player.** They share `localStorage`, so they share `playerId`:
  the guest silently joins as the host. Two different browser contexts are needed.
- **Presses on a disabled button vanish without a trace.** `dispatchEvent` on a `disabled` element
  does nothing, and the round ends with a score of 0:0 without a single error. The script must
  report that the button was disabled, otherwise it reads as "the game does not count clicks".

---

### Task 6: End-to-end test in two browsers

> **Done (2026-09-15), commit `1fd01b0`.** Run: **4 passed in 33.3 s** — two tests in two
> projects. Differences from what is written below, all from the work itself:
>
> - the test timeout is 90 s, not 60: the round runs on real server timings, 3 + 10 seconds;
> - `workers: 1` — two players in one round already take two contexts, parallel rounds would only
>   fight over the dev server;
> - `trace: 'retain-on-failure'` — a failed round cannot be figured out from the log alone;
> - the projects are named `desktop` and `mobile`;
> - there are two tests: the round itself and leaving the room.
>
> **The error the script failed on the first time:** the login helper went to `/` and immediately
> looked for the name field, but `/` is the home page with the Create room button — the field
> appears only after a room is created. Both "race" tests hung until the timeout, and the whole run
> took 3.1 minutes instead of 33 seconds.

**Files:**
- Create: `apps/game/playwright.config.ts`, `apps/game/e2e/round.spec.ts`

- [ ] **Step 1: Install the browser**

Run: `pnpm --filter @clicker/app exec playwright install chromium`
Expected: a build matching the Playwright version is downloaded. Without it the tests do not start.

- [ ] **Step 2: Create `apps/game/playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: { baseURL: 'http://localhost:5173' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm exec vite dev --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Write `apps/game/e2e/round.spec.ts`**

The scenario: the host opens the home page and creates a room; the second player enters by its address; both enter nicknames and see each other in the lobby; the host starts a round; after the countdown the second clicks five times; both wait for the results and see the same table with the winner. The phase must be awaited by the snapshot, not by a timer: `await expect(page.getByTestId('hud-phase')).toContainText('Go!')`.

- [ ] **Step 4: Run**

Run: `pnpm --filter @clicker/app run e2e`
Expected: the tests pass in both projects. The round runs with real durations, so one run takes about 20 seconds.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/game
git commit -m "test(app): play a round in two real browsers"
```

---

### Task 7: CI

> **Done (2026-09-15), commit `139626e`.** The workflow gained a build, a browser install with
> system dependencies and an end-to-end run; the report and traces are uploaded as an artifact on
> failure. Along the way the only remaining Russian comment in the file was translated into English.
>
> **Not checked by a machine:** the system has neither PyYAML nor `js-yaml`, so the YAML syntax is
> confirmed by eye only. The real check is the first push, which will start the workflow.

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the build, the browser and the end-to-end tests**

After the `pnpm test` step:

```yaml
      - run: pnpm --filter @clicker/app run build
      - run: pnpm --filter @clicker/app exec playwright install --with-deps chromium
      - run: pnpm --filter @clicker/app run e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/game/playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build the app and run the end-to-end round"
```

---

### Task 8: Deploy

**Files:** none new, only running

- [ ] **Step 1: Make sure the build deploys**

Run: `pnpm --filter @clicker/app run build && pnpm --filter @clicker/app exec wrangler deploy --dry-run`
Expected: wrangler reads the generated `dist/clicker/wrangler.json`, finds the static files in `dist/client`, shows the `env.Room` binding and the variables, then exits.

- [ ] **Step 2: 👤 Your steps before the first real deploy**

1. Create a personal account at dash.cloudflare.com, do not attach a card.
2. Set the `<name>.workers.dev` subdomain in the Workers & Pages section.
3. Run `npx wrangler@latest login` and confirm the login in the browser.

- [ ] **Step 3: Deploy**

Run: `pnpm --filter @clicker/app run deploy`
Expected: wrangler prints an address of the form `https://clicker.<subdomain>.workers.dev`.

- [ ] **Step 4: Check the game live**

Open the address, create a room, send the link to a phone, play a round with two. Check: both sides see each other, the countdown matches, the winner is the same, the button on the phone does not trigger zoom.

---

## Verifying the result

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
pnpm --filter @clicker/app run build
pnpm --filter @clicker/app run e2e
```

Expected: the linter and types are clean, 107 tests (60 + 32 + 15), the build gives two parts, the end-to-end test passes in the desktop and mobile projects.

> **Correction after the fact (2026-09-14).** This used to say 106 (60 + 31 + 15). Plan 4 added a
> check for a foreign message version to the protocol, and `packages/protocol` now has 32 tests.

Check against the spec: §4 (invite links and the host key in the fragment), §8 (screens, input, scene, palette), §10 (end-to-end tests), §11 (one command for development, CI, deploy).

## What is needed from you

- **During the plan:** nothing except `playwright install chromium` — which can also be done with the command from Task 6.
- **At the end:** a Cloudflare account, a subdomain and `wrangler login`, to deploy. The push to GitHub is up to you, as before.

## What next

The foundation is closed: rules, protocol, server, client, tests at every level, and deploy. Next the project grows wider — a second game mode, sound, a winners' history, polishing the race scene. The layer boundaries are already ready for that: the rules know nothing about transport, transport knows nothing about rendering.
