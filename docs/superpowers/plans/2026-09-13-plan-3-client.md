# Clicker Client Implementation Plan (план 3 из 3: клиент, сцена, деплой)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести проект до играбельного состояния: браузерный клиент на React с 3D-сценой, сквозные тесты в двух настоящих браузерах и деплой одной командой на бесплатный тариф Cloudflare.

**Architecture:** Клиент и Worker живут одним приложением `apps/game`. Плагин `@cloudflare/vite-plugin` запускает Worker прямо внутри dev-сервера Vite и собирает обе части в один деплой: клиент в `dist/client`, Worker и сгенерированный конфиг в `dist/clicker`. Клиент — тонкий: он не знает правил игры, а отправляет команды и рисует снимки, которые присылает сервер.

**Tech Stack:** Vite 8.3.0, React 19.2.8, @vitejs/plugin-react 6.1.1, @cloudflare/vite-plugin 1.54.8, three 0.186.0, @react-three/fiber 9.7.0, @react-three/drei 10.7.8, zustand 5.0.15, partysocket 1.3.0, Playwright 1.63.0, TypeScript 7.0.2.

Спецификация: [2026-09-11-clicker-foundation-design.md](../specs/2026-09-11-clicker-foundation-design.md), разделы 3, 4, 8, 10, 11. Планы 1 и 2 выполнены и влиты в `main`.

---

## Проверено перед написанием плана

Прототип собран и прогнан на этой машине целиком: сборка, проверка типов, сквозной тест в двух браузерах (18,3 с, реальные тайминги раунда), `wrangler deploy --dry-run` и совместная работа двух бегунков тестов.

Шесть находок, которые определили этот план:

1. **Плагин Cloudflare собирает клиент и Worker вместе.** `vite build` даёт `dist/client` со статикой и `dist/<имя>/index.js` с Worker и сгенерированным `wrangler.json`; после этого `wrangler deploy` уезжает без единой дополнительной настройки — проверено сухим прогоном, он нашёл статику, привязку Durable Object и переменные. Поэтому клиент и сервер — одно приложение, а описанное раньше проксирование `/parties` на отдельный `wrangler dev` отменяется.
2. **Два конфига Vite в одном пакете уживаются**, но `vitest` по умолчанию хватает и сквозные тесты Playwright и пытается запустить их внутри workerd — падает на `playwright-core`. Лечится одной строкой: `test: { include: ['test/**/*.test.ts'] }`.
3. **React закрепляем на 19.2.8.** `@react-three/fiber@9.7.0` требует `react >=19 <19.3`, а последний React — 19.3. Ставить 19.3 нельзя, пока R3F не выпустит совместимую версию.
4. **Браузеры Playwright должны совпадать с его версией.** На машине лежали сборки 1193 и 1208, Playwright 1.63 потребовал 1243 и отказался стартовать, пока не выполнить `playwright install chromium`.
5. **Клиентский бандл — 1,1 МБ (302 КБ сжатым)**, почти целиком three.js. Сцена подключается лениво, чтобы экран входа не тянул её за собой.
6. **`THREE.Clock: This module has been deprecated`** — предупреждение из внутренностей react-three-fiber, не из нашего кода. Ничего не ломает, исправить нечем.

## Как выполнять

- Ветка `feat/client`, работаем в самом репозитории.
- Один таск — один коммит. Conventional Commits, английский, **без подписей Claude**.
- Проверки перед каждым коммитом: `pnpm format`, затем `pnpm check`, `pnpm typecheck`, `pnpm test`.

## Файловая структура

```
apps/game/                     (переезжает из apps/server)
  index.html
  vite.config.ts               react() + cloudflare()
  vitest.config.ts             тесты Worker, область ограничена test/
  playwright.config.ts         сквозные тесты, сам поднимает dev-сервер
  wrangler.jsonc               main → src/worker/worker.ts, assets, Durable Object
  tsconfig.client.json         DOM и JSX
  tsconfig.worker.json         типы Workers
  src/worker/worker.ts         маршрутизация комнат   (переезжает)
  src/worker/room.ts           комната                (переезжает)
  src/client/main.tsx          точка входа
  src/client/app.tsx           выбор экрана по фазе
  src/client/net.ts            соединение и команды
  src/client/store.ts          состояние клиента (zustand)
  src/client/room-link.ts      идентификаторы комнаты, ключ хоста, ссылки
  src/client/theme.ts          палитра
  src/client/strings.ts        тексты интерфейса
  src/client/screens/*.tsx     Landing, Join, Lobby, Arena, Results
  src/client/scene/race.tsx    сцена на react-three-fiber
  test/*.test.ts               тесты Worker            (переезжают)
  e2e/round.spec.ts            сквозной тест
```

---

### Task 1: Превратить apps/server в apps/game

**Files:**
- Move: `apps/server` → `apps/game`, внутри — `src/worker.ts` и `src/room.ts` в `src/worker/`
- Modify: `apps/game/package.json`, `apps/game/wrangler.jsonc`, `apps/game/tsconfig.json`, `apps/game/vitest.config.ts`

- [ ] **Step 1: Переместить приложение и исходники Worker**

```bash
git mv apps/server apps/game
mkdir apps/game/src/worker
git mv apps/game/src/room.ts apps/game/src/worker/room.ts
git mv apps/game/src/worker.ts apps/game/src/worker/worker.ts
```

- [ ] **Step 2: Переименовать пакет в `apps/game/package.json`**

Имя `@clicker/game` уже занято пакетом с правилами, поэтому приложение называется `@clicker/app`.

```json
  "name": "@clicker/app",
```

- [ ] **Step 3: Поправить путь входа в `apps/game/wrangler.jsonc`**

```jsonc
  "main": "src/worker/worker.ts",
```

- [ ] **Step 4: Ограничить область vitest в `apps/game/vitest.config.ts`**

Добавить после массива `plugins`:

```ts
  // Сквозные тесты лежат в e2e/ и запускаются Playwright: внутрь workerd им нельзя.
  test: { include: ['test/**/*.test.ts'] },
```

- [ ] **Step 5: Проверить, что ничего не сломалось**

```bash
pnpm install
pnpm --filter @clicker/app test
pnpm check
```
Expected: `Test Files 2 passed (2)`, `Tests 15 passed (15)`; Biome без замечаний.

- [ ] **Step 6: Закоммитить**

```bash
pnpm format
git add -A apps/game pnpm-lock.yaml
git commit -m "refactor: turn the server app into the game app"
```

---

### Task 2: Каркас клиента на Vite и React

**Files:**
- Modify: `apps/game/package.json`, `apps/game/wrangler.jsonc`, `apps/game/tsconfig.json` → удалить, заменив на два новых
- Create: `apps/game/vite.config.ts`, `apps/game/index.html`, `apps/game/tsconfig.client.json`, `apps/game/tsconfig.worker.json`, `apps/game/src/client/main.tsx`, `apps/game/src/client/app.tsx`

- [ ] **Step 1: Добавить зависимости клиента в `apps/game/package.json`**

Версии закреплены точно: React именно 19.2.8, иначе react-three-fiber откажется ставиться.

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

И скрипты:

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

- [ ] **Step 2: Создать `apps/game/vite.config.ts`**

```ts
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), cloudflare({ configPath: './wrangler.jsonc' })],
});
```

- [ ] **Step 3: Добавить статику в `apps/game/wrangler.jsonc`**

Каталог собранной статики подставляет плагин, руками его не указываем.

```jsonc
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/parties/*"]
  },
```

- [ ] **Step 4: Создать `apps/game/index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Кликер</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Заменить `apps/game/tsconfig.json` двумя конфигами**

Удалить `tsconfig.json` и создать `apps/game/tsconfig.client.json`:

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

и `apps/game/tsconfig.worker.json`:

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

- [ ] **Step 6: Создать `apps/game/src/client/main.tsx`**

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

- [ ] **Step 7: Создать временный `apps/game/src/client/app.tsx`**

Настоящие экраны появятся в Task 4; сейчас нужен минимум, чтобы проверить сборку.

```tsx
export function App() {
  return <main>Кликер</main>;
}
```

- [ ] **Step 8: Проверить установку и сборку**

```bash
pnpm install
pnpm --filter @clicker/app run build
pnpm --filter @clicker/app typecheck
pnpm --filter @clicker/app test
```
Expected: сборка печатает две части — `dist/clicker/index.js` с Worker и `dist/client/…` со статикой; проверки типов молчат; тесты Worker по-прежнему 15.

- [ ] **Step 9: Добавить в `.gitignore` сборку и закоммитить**

```gitignore
dist/
```

```bash
pnpm format
git add -A
git commit -m "feat(app): serve the client and the worker from one vite app"
```

---

### Task 3: Соединение, состояние и ссылки на комнату

**Files:**
- Create: `apps/game/src/client/room-link.ts`, `apps/game/src/client/store.ts`, `apps/game/src/client/net.ts`

- [ ] **Step 1: Создать `apps/game/src/client/room-link.ts`**

Идентификаторы берём из пакета протокола — там же, где их проверяет сервер.

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
    // Приватное окно или запрет на хранилище: играть это не мешает.
  }
}

/** Постоянный идентификатор игрока. Это секрет сессии, наружу он не уходит. */
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

/** `/r/<roomId>` — сама ссылка и есть приглашение. */
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
 * Ключ хоста приходит во фрагменте адреса: он не уходит на сервер.
 * Сразу после чтения стираем его из строки браузера — на дейли экран показывают всем.
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

- [ ] **Step 2: Создать `apps/game/src/client/store.ts`**

```ts
import type { ServerErrorCode, SnapshotMessage } from '@clicker/protocol';
import { create } from 'zustand';

export type Status = 'connecting' | 'open' | 'reconnecting';

interface ClientState {
  status: Status;
  you: string | null;
  isHost: boolean;
  snapshot: SnapshotMessage | null;
  /** Разница между часами сервера и браузера, по максимуму последних значений. */
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
    // Задержка сети только уменьшает разницу, поэтому берём максимум из последних замеров.
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

/** Серверное время по часам браузера. */
export function serverNow(): number {
  return Date.now() + useClient.getState().offset;
}
```

- [ ] **Step 3: Создать `apps/game/src/client/net.ts`**

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
    // Копить нажатия во время обрыва нельзя: они долетят пачкой после конца раунда.
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

- [ ] **Step 4: Проверить типы и закоммитить**

```bash
pnpm format
pnpm --filter @clicker/app typecheck
git add apps/game
git commit -m "feat(app): connect to a room and keep client state"
```

---

### Task 4: Экраны

**Files:**
- Create: `apps/game/src/client/theme.ts`, `apps/game/src/client/strings.ts`, `apps/game/src/client/screens/*.tsx`
- Modify: `apps/game/src/client/app.tsx`

Экраны собираются на обычном React и inline-стилях из `theme.ts` — отдельная система стилей этому проекту не нужна.

- [ ] **Step 1: Создать `apps/game/src/client/theme.ts`**

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

- [ ] **Step 2: Создать `apps/game/src/client/strings.ts`**

```ts
export const strings = {
  title: 'Кликер',
  createRoom: 'Создать комнату',
  nameLabel: 'Как тебя зовут',
  enter: 'Войти',
  copyInvite: 'Скопировать приглашение',
  copyHostLink: 'Скопировать ссылку хоста',
  start: 'Старт',
  again: 'Ещё раунд',
  click: 'Клик',
  reconnecting: 'Переподключение…',
  roundAborted: 'Раунд прерван, начните заново',
  nobodyClicked: 'Никто не кликал',
  wins: 'побеждает!',
};
```

- [ ] **Step 3: Создать экраны**

Пять файлов в `apps/game/src/client/screens/`: `landing.tsx` (кнопка «Создать комнату», ведёт на `/r/<roomId>`), `join.tsx` (поле ника, 1–20 символов, кнопка «Войти»), `lobby.tsx` (список игроков, кнопки копирования ссылок, «Старт» у хоста), `arena.tsx` (таймер по серверному времени, крупная кнопка на `onPointerDown`, `touch-action: manipulation`, свой счёт из `localClicks`), `results.tsx` (таблица мест и баннер победителя).

Кнопка клика активна строго между `goAt` и `endsAt` по серверному времени:

```tsx
const live = snapshot.round !== null && now >= snapshot.round.goAt && now <= snapshot.round.endsAt;
```

- [ ] **Step 4: Собрать `apps/game/src/client/app.tsx`**

Выбор экрана: нет комнаты в адресе → Landing; нет ника → Join; иначе по фазе снимка → Lobby, Arena, Results. Поверх всего — плашка «Переподключение…», когда статус не `open`, и сообщение о прерванном раунде, когда `notice === 'round_aborted'`.

- [ ] **Step 5: Проверить и закоммитить**

```bash
pnpm format
pnpm --filter @clicker/app typecheck
pnpm --filter @clicker/app run build
git add apps/game
git commit -m "feat(app): add the game screens"
```

---

### Task 5: Сцена на three.js

**Files:**
- Create: `apps/game/src/client/scene/race.tsx`
- Modify: `apps/game/src/client/screens/arena.tsx`, `apps/game/src/client/screens/results.tsx`

- [ ] **Step 1: Создать `apps/game/src/client/scene/race.tsx`**

Каждому игроку — столбик, высота догоняет цель каждый кадр через `damp`, без `setState`. Так снимки, приходящие десять раз в секунду, превращаются в плавное движение.

```tsx
import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { MathUtils, type Mesh } from 'three';
import { theme } from '../theme';

interface Racer {
  id: string;
  clicks: number;
}

function Bar({ index, share, gold }: { index: number; share: number; gold: boolean }) {
  const mesh = useRef<Mesh>(null);

  useFrame((_state, delta) => {
    if (mesh.current === null) return;
    const target = 0.2 + share * 3;
    mesh.current.scale.y = MathUtils.damp(mesh.current.scale.y, target, 6, delta);
    mesh.current.position.y = mesh.current.scale.y / 2;
  });

  return (
    <mesh ref={mesh} position={[index * 1.4 - 2, 0, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={gold ? theme.goldBright : '#4a5170'} />
    </mesh>
  );
}

export default function Race({ racers, you }: { racers: Racer[]; you: string | null }) {
  const best = Math.max(1, ...racers.map((racer) => racer.clicks));

  return (
    <Canvas camera={{ position: [0, 3, 8], fov: 45 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 6, 3]} intensity={1.2} />
      {racers.map((racer, index) => (
        <Bar
          key={racer.id}
          index={index}
          share={racer.clicks / best}
          gold={racer.id === you}
        />
      ))}
    </Canvas>
  );
}
```

- [ ] **Step 2: Подключить сцену лениво**

В аренe и результатах:

```tsx
const Race = lazy(() => import('../scene/race'));
```
и обернуть в `<Suspense fallback={null}>`. Три.js весит около мегабайта, и экрану входа он не нужен.

- [ ] **Step 3: Проверить размер сборки**

Run: `pnpm --filter @clicker/app run build`
Expected: сцена уезжает в отдельный кусок, а начальный бандл заметно меньше мегабайта.

- [ ] **Step 4: Закоммитить**

```bash
pnpm format
git add apps/game
git commit -m "feat(app): draw the race in a lazily loaded 3d scene"
```

---

### Task 6: Сквозной тест в двух браузерах

**Files:**
- Create: `apps/game/playwright.config.ts`, `apps/game/e2e/round.spec.ts`

- [ ] **Step 1: Установить браузер**

Run: `pnpm --filter @clicker/app exec playwright install chromium`
Expected: скачивается сборка, совпадающая с версией Playwright. Без этого тесты не стартуют.

- [ ] **Step 2: Создать `apps/game/playwright.config.ts`**

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

- [ ] **Step 3: Написать `apps/game/e2e/round.spec.ts`**

Сценарий: хост открывает главную и создаёт комнату; второй игрок заходит по её адресу; оба вводят ники и видят друг друга в лобби; хост запускает раунд; после отсчёта второй кликает пять раз; оба дожидаются результатов и видят одинаковую таблицу с победителем. Ждать фазу нужно по снимку, а не по таймеру: `await expect(page.getByTestId('phase')).toHaveText('running')`.

- [ ] **Step 4: Прогнать**

Run: `pnpm --filter @clicker/app run e2e`
Expected: тесты проходят в обоих проектах. Раунд идёт с настоящими длительностями, поэтому один прогон занимает около 20 секунд.

- [ ] **Step 5: Закоммитить**

```bash
pnpm format
git add apps/game
git commit -m "test(app): play a round in two real browsers"
```

---

### Task 7: CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Добавить сборку, браузер и сквозные тесты**

После шага `pnpm test`:

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

- [ ] **Step 2: Закоммитить**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build the app and run the end-to-end round"
```

---

### Task 8: Деплой

**Files:** нет новых, только запуск

- [ ] **Step 1: Убедиться, что сборка деплоится**

Run: `pnpm --filter @clicker/app run build && pnpm --filter @clicker/app exec wrangler deploy --dry-run`
Expected: wrangler читает сгенерированный `dist/clicker/wrangler.json`, находит статику в `dist/client`, показывает привязку `env.Room` и переменные, затем выходит.

- [ ] **Step 2: 👤 Твои шаги перед первым настоящим деплоем**

1. Завести личный аккаунт на dash.cloudflare.com, карту не привязывать.
2. Задать поддомен `<имя>.workers.dev` в разделе Workers & Pages.
3. Выполнить `npx wrangler@latest login` и подтвердить вход в браузере.

- [ ] **Step 3: Задеплоить**

Run: `pnpm --filter @clicker/app run deploy`
Expected: wrangler печатает адрес вида `https://clicker.<поддомен>.workers.dev`.

- [ ] **Step 4: Проверить игру вживую**

Открыть адрес, создать комнату, отправить ссылку на телефон, сыграть раунд вдвоём. Проверить: обе стороны видят друг друга, отсчёт совпадает, победитель одинаковый, кнопка на телефоне не вызывает зум.

---

## Проверка результата

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
pnpm --filter @clicker/app run build
pnpm --filter @clicker/app run e2e
```

Ожидается: линтер и типы чистые, 106 тестов (60 + 31 + 15), сборка даёт две части, сквозной тест проходит в десктопном и мобильном проектах.

Сверить со спецификацией: §4 (ссылки-приглашения и ключ хоста во фрагменте), §8 (экраны, ввод, сцена, палитра), §10 (сквозные тесты), §11 (одна команда для разработки, CI, деплой).

## Что нужно от тебя

- **Во время плана:** ничего, кроме `playwright install chromium` — это можно сделать и командой из Task 6.
- **В конце:** аккаунт Cloudflare, поддомен и `wrangler login`, чтобы задеплоить. Пуш в GitHub, как и раньше, за тобой.

## Что дальше

Основа закрыта: правила, протокол, сервер, клиент, тесты на всех уровнях и деплой. Дальше проект растёт вширь — второй игровой режим, нормальная 3D-сцена вместо столбиков, звук, история победителей. Границы слоёв под это уже готовы: правила не знают про транспорт, транспорт не знает про рендер.
