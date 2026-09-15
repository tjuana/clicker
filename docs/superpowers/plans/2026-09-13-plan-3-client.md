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
7. **Первая версия сцены выглядела сломанной, и это нашлось только глазами.** Три ошибки, все учтены в коде ниже: высота столбика считалась относительно лидера, поэтому игрок, который в комнате один, всегда упирался в максимум и роста не видел; камере не задавали, куда смотреть, и кадр получался случайным — столбик уезжал за верхний край; полотно во всю ширину при высоте 240 пикселей давало соотношение сторон около 8:1 и сплющивало сцену в полоску. Отсюда правило: сцену проверять снимком экрана из настоящего браузера, а не только тестами.

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
    <title>Clicker</title>
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
  return <main>Clicker</main>;
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

> **Выполнено, но частично устарело.** Код этой задачи уже в репозитории. Формат сообщений после неё
> изменился: у каждого сообщения появилось поле версии `v`, а `{ type: 'click' }` стал
> `{ type: 'input', input: { type: 'click' } }`. Приводит их в порядок план 4 — здесь снипеты
> оставлены как есть, чтобы история задачи совпадала с тем, что было сделано.

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

### Task 4: Меню, вход по имени и экраны

**Files:**
- Create: `apps/game/src/client/theme.ts`, `apps/game/src/client/strings.ts`, `apps/game/src/client/clock.ts`, `apps/game/src/client/ui.tsx`, `apps/game/src/client/hud.tsx`, `apps/game/src/client/screens/{landing,join,lobby,arena,results}.tsx`
- Modify: `apps/game/src/client/app.tsx`

Интерфейс на обычном React и inline-стилях из `theme.ts`: отдельная система стилей этому проекту не нужна. Тексты — только на английском и только через `strings.ts`, чтобы язык менялся в одном месте.

**Путь игрока.** Главная → «Create room» → адрес комнаты → **имя спрашиваем до входа в комнату** →
лобби → отсчёт и раунд → результаты → «Play again». Имя запоминается, и во второй раз экран входа
не показывается; сменить имя можно из лобби.

**HUD** виден в отсчёте, раунде и результатах и всегда отвечает на четыре вопроса: какая фаза,
сколько осталось, сколько у меня, кто ведёт. Он же показывает число игроков и состояние связи.

> **Поправки по факту (2026-09-14).** План писался до плана 4, и три места устарели:
>
> 1. **`strings.errors` неполон.** `ServerErrorCode` теперь включает `invalid_message` и
>    `bad_version`. Нужны оба ключа: игрок со старой вкладкой должен прочитать, что её надо
>    перезагрузить, а не увидеть пустоту.
> 2. **`index.html` объявляет `lang="ru"`**, хотя весь интерфейс английский. Правильно `lang="en"` —
>    иначе браузер предлагает перевести страницу с несуществующего языка, а скринридер читает
>    английский текст с русской фонетикой.
> 3. **Счёт лежит в слоте режима.** У игрока в `players[]` только `{ id, name, connected }`, а число
>    кликов — в `snapshot.data.scores[id]`. Код HUD в Step 5 уже правильный; проза в Step 6 местами
>    говорит о старом формате, и верить надо коду.

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

- [ ] **Step 3: Создать часы `apps/game/src/client/clock.ts`**

Снимки приходят десять раз в секунду, а таймер должен идти плавно и по серверному времени.
Отдельный тик на 100 мс держит только те компоненты, которым нужно время, — перерисовывать из-за
него весь экран незачем.

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

- [ ] **Step 4: Создать общие элементы `apps/game/src/client/ui.tsx`**

Три штуки, которые повторяются на всех экранах: `Screen` (тёмный фон, центральная колонка шириной до
860 пикселей, отступы), `Button` (крупная кнопка, `touch-action: manipulation`, состояние
`disabled`), `CopyButton` (копирует строку в буфер и на две секунды меняет надпись на `Copied`).
`CopyButton` обязан переживать отказ `navigator.clipboard`: в этом случае показывает саму ссылку,
чтобы её можно было выделить руками.

- [ ] **Step 5: Создать HUD `apps/game/src/client/hud.tsx`**

Одна строка на широком экране, две — на узком. Слева фаза и таймер, в центре свой счёт, справа
лидер и число игроков. Значения берутся из снимка, время — из `useServerClock`.

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

- [ ] **Step 6: Создать экраны в `apps/game/src/client/screens/`**

- **`landing.tsx`** — название, строка `tagline`, одна кнопка `createRoom` с `data-testid="create-room"`.
  По нажатию: `createRoom()` из `room-link.ts`, затем `history.pushState` на `/r/<roomId>`.
- **`join.tsx`** — заголовок с номером комнаты, поле `data-testid="name-input"` (значение из
  `savedName()`, `maxLength` из `MAX_NAME_LENGTH` протокола) и кнопка `data-testid="enter"`.
  Кнопка неактивна, пока в поле после `trim` пусто. По нажатию: `saveName(name)` и вход в комнату.
- **`lobby.tsx`** — список игроков `data-testid="players"` (у отключённых приглушённый цвет),
  `CopyButton` с приглашением, у хоста ещё `CopyButton` со ссылкой хоста и кнопка
  `data-testid="start"`. Не хосту вместо кнопки — строка `waiting`. Плюс ссылка `changeName`,
  возвращающая на экран входа.
- **`arena.tsx`** — `Hud`, сцена (Task 5) и кнопка `data-testid="click"` во всю ширину, высотой не
  меньше 96 пикселей, по `onPointerDown`. Кнопка активна строго внутри раунда по серверному времени:

```tsx
const live = snapshot.round !== null && now >= snapshot.round.goAt && now <= snapshot.round.endsAt;
```

- **`results.tsx`** — `Hud`, сцена с подсвеченным победителем, баннер `data-testid="winner"`
  (`«<name> wins!»` или `nobodyClicked`, если у первого места ноль кликов) и таблица мест
  `data-testid="results"`. У хоста — кнопка `again` с тем же `data-testid="start"`, чтобы сквозной
  тест не зависел от того, первый это раунд или второй.

- [ ] **Step 7: Собрать `apps/game/src/client/app.tsx`**

Порядок выбора экрана: нет комнаты в адресе → `Landing`; имя не сохранено → `Join`; снимка ещё нет →
`Lobby` со списком из одного себя; дальше по фазе — `lobby`, `arena` (`countdown` и `running`),
`results`.

Поверх всего два оповещения: плашка `reconnecting`, когда `status !== 'open'`, и `roundAborted`,
когда `notice === 'round_aborted'`. Ошибка из `lastError` показывается текстом из `strings.errors`
рядом с той кнопкой, которая её вызвала, и гаснет при следующем действии игрока.

- [ ] **Step 8: Проверить глазами**

Собрать (`pnpm --filter @clicker/app run build`), поднять `pnpm --filter @clicker/app dev`, открыть
две вкладки в одной комнате и пройти путь целиком: создание, ввод имени, лобби, отсчёт, раунд,
результаты. Отдельно посмотреть на узком экране (в браузере — режим телефона): HUD должен
переноситься на две строки, кнопка клика оставаться во всю ширину, зум по двойному тапу не срабатывать.

- [ ] **Step 9: Закоммитить**

```bash
pnpm format
pnpm --filter @clicker/app typecheck
pnpm --filter @clicker/app run build
git add apps/game
git commit -m "feat(app): add the menu, name entry, hud and screens"
```

---

### Task 5: Сцена гонки на three.js

> **Выполнено и проверено (2026-09-15), коммит `1ef26d7`.** Метафора выбрана другая, чем была
> изначально: не столбики, растущие со счётом, а **честная гонка** — игроки едут по дорожке,
> положение = число кликов, камера держит в кадре всё поле.
>
> Порядок здесь обратный обычному намеренно: сцена сперва заработала и была снята с экрана, и только
> потом её код попал в план. В прошлый раз задача была написана «из головы» — получились столбики,
> которые прошли все проверки и выглядели сломанными. Ниже дословный код из репозитория.

**Files:**
- Create: `apps/game/src/client/scene/race.tsx`
- Modify: `apps/game/src/client/screens/arena.tsx`, `apps/game/src/client/screens/results.tsx`

- [x] **Step 1: Создать `apps/game/src/client/scene/race.tsx`**

Положение бегуна догоняет цель каждый кадр через `damp`, без `setState`: так снимки, приходящие
десять раз в секунду, превращаются в плавное движение.

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

- [x] **Step 2: Подключить сцену лениво**

В `arena.tsx` и `results.tsx` — рядом с импортами:

```tsx
import { lazy, Suspense } from 'react';

/** three.js is about a megabyte: the entry screens must not carry it. */
const Race = lazy(() => import('../scene/race'));
```

и в теле компонента ещё одна строка, без которой подсветка «своего» работать не будет:

```tsx
  const you = useClient((state) => state.you);
```

Контейнер сцены обязан держать пропорции — иначе она сплющивается в полоску во всю ширину экрана:

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

- [x] **Step 3: Проверить размер сборки**

Run: `pnpm --filter @clicker/app run build`
Фактический результат:

```
dist/client/assets/index-DM0_z0xy.js  224.32 kB │ gzip:  71.13 kB
dist/client/assets/race-gis0Yue6.js   894.80 kB │ gzip: 236.44 kB
```

Сцена уезжает отдельным чанком, вход остаётся 224 КБ — в этом и весь смысл ленивой загрузки.

- [x] **Step 4: Проверить глазами**

Пройти раунд целиком в двух контекстах настоящего браузера (десктоп 1280×860 и Pixel 7) и посмотреть
на снимки. Зелёная сборка о внешнем виде не говорит ничего.

- [x] **Step 5: Закоммитить**

```bash
pnpm format
git add apps/game/src/client
git commit -m "feat(app): draw the round as a race on a lane, framed to keep the field in view"
```

## Что выяснилось на этой задаче

1. **Масштаб фиксированный, а не относительно лидера.** При относительном игрок, который в комнате
   один, всегда упёрт в максимум и роста не видит — этим и были плохи столбики.
2. **Движение не читается без разметки.** Бегун над однотонной плоскостью выглядит неподвижным;
   поперечные отметки через метр и линия старта дают глазу за что зацепиться.
3. **Камера ведёт поле, а не лидера.** Первая версия следила за лидером, и отстающий уезжал за левый
   край кадра — пропадало ровно то, ради чего гонка и нужна.
4. **Подписи имён в 3D не делаем.** `drei/Text` тянет шрифт с внешнего CDN: лишняя сетевая
   зависимость на Cloudflare. Имя лидера и так в HUD.
5. **Ключ для отметок — расстояние, а не индекс массива.** Biome справедливо ругается на `key={index}`;
   правильный ответ здесь не подавить правило, а взять настоящий идентификатор.
6. **three.js сыплет предупреждениями из своих внутренностей** — `PCFSoftShadowMap has been removed`
   и `THREE.Clock deprecated`. Это react-three-fiber, не наш код, и исправить их нечем.

### Про съёмку экранов

Инструмент съёмки оказался источником трёх ложных диагнозов подряд, и это стоит помнить:

- **Опрос страницы локаторами Playwright во время раунда залипает на минуты.** Сама страница при этом
  держит 60 кадров в секунду — проверено счётчиком `requestAnimationFrame` внутри страницы. Все
  ожидания в сценарии должны быть на стороне node, а не через `waitForTimeout`/локаторы.
- **Две вкладки одного контекста — это один игрок.** У них общий `localStorage`, а значит общий
  `playerId`: гость молча входит под хостом. Нужны два разных контекста браузера.
- **Нажатия по отключённой кнопке пропадают бесследно.** `dispatchEvent` на `disabled` элементе не
  делает ничего, и раунд заканчивается со счётом 0:0 без единой ошибки. Сценарий обязан сообщать,
  что кнопка была отключена, иначе это читается как «игра не считает клики».

---

### Task 6: Сквозной тест в двух браузерах

> **Выполнено (2026-09-15), коммит `1fd01b0`.** Прогон: **4 passed за 33,3 с** — два теста в двух
> проектах. Отличия от написанного ниже, все по факту работы:
>
> - таймаут теста 90 с, а не 60: раунд идёт на настоящих серверных таймингах, 3 + 10 секунд;
> - `workers: 1` — два игрока в одном раунде уже занимают два контекста, параллельные раунды
>   только дрались бы за dev-сервер;
> - `trace: 'retain-on-failure'` — упавший раунд по одному логу не разобрать;
> - проекты названы `desktop` и `mobile`;
> - тестов два: сам раунд и выход из комнаты.
>
> **Ошибка, на которой сценарий упал с первого раза:** хелпер входа шёл на `/` и сразу искал поле
> имени, но на `/` находится главная с кнопкой Create room — поле появляется только после создания
> комнаты. Оба «race» теста висели до таймаута, весь прогон занимал 3,1 минуты вместо 33 секунд.

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

Сценарий: хост открывает главную и создаёт комнату; второй игрок заходит по её адресу; оба вводят ники и видят друг друга в лобби; хост запускает раунд; после отсчёта второй кликает пять раз; оба дожидаются результатов и видят одинаковую таблицу с победителем. Ждать фазу нужно по снимку, а не по таймеру: `await expect(page.getByTestId('hud-phase')).toContainText('Go!')`.

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

> **Выполнено (2026-09-15), коммит `139626e`.** В workflow добавлены сборка, установка браузера
> с системными зависимостями и сквозной прогон; отчёт и трассы выгружаются артефактом при падении.
> Заодно переведён на английский единственный оставшийся русский комментарий в файле.
>
> **Не проверено машиной:** в системе нет ни PyYAML, ни `js-yaml`, поэтому синтаксис YAML
> подтверждён только глазами. Настоящая проверка — первый же push, который запустит workflow.

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

Ожидается: линтер и типы чистые, 107 тестов (60 + 32 + 15), сборка даёт две части, сквозной тест проходит в десктопном и мобильном проектах.

> **Поправка по факту (2026-09-14).** Здесь стояло 106 (60 + 31 + 15). План 4 добавил в протокол
> проверку на чужую версию сообщения, и тестов в `packages/protocol` стало 32.

Сверить со спецификацией: §4 (ссылки-приглашения и ключ хоста во фрагменте), §8 (экраны, ввод, сцена, палитра), §10 (сквозные тесты), §11 (одна команда для разработки, CI, деплой).

## Что нужно от тебя

- **Во время плана:** ничего, кроме `playwright install chromium` — это можно сделать и командой из Task 6.
- **В конце:** аккаунт Cloudflare, поддомен и `wrangler login`, чтобы задеплоить. Пуш в GitHub, как и раньше, за тобой.

## Что дальше

Основа закрыта: правила, протокол, сервер, клиент, тесты на всех уровнях и деплой. Дальше проект растёт вширь — второй игровой режим, звук, история победителей, доводка сцены гонки. Границы слоёв под это уже готовы: правила не знают про транспорт, транспорт не знает про рендер.
