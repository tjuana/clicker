# Clicker Server Implementation Plan (план 2 из 3: комната на partyserver)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять `apps/server` — Worker с одной комнатой на Durable Object, который принимает игроков по WebSocket, крутит раунды по будильнику и рассылает снимки состояния десять раз в секунду, полностью покрытый интеграционными тестами в настоящем рантайме Workers.

**Architecture:** Комната — класс на partyserver поверх Durable Object со сном. Правил игры в ней нет: любое сообщение превращается в команду и уходит в `apply` из `@clicker/game`, а наружу состояние отдаётся через `toSnapshot` из `@clicker/protocol`. Смену фаз двигает будильник Durable Object, а не таймеры в памяти, поэтому раунд закончится даже после пробуждения объекта.

**Tech Stack:** partyserver 0.5.10, wrangler 4.131.1, @cloudflare/vitest-plugin 1.1.8, Vitest 4.1.11, TypeScript 7.0.2, Node 22, pnpm 12.4.1.

Спецификация: [2026-09-11-clicker-foundation-design.md](../specs/2026-09-11-clicker-foundation-design.md), разделы 4, 7, 9, 10. План 1 (ядро и протокол) уже выполнен и влит в `main`.

---

## Проверено перед написанием плана

Весь код ниже собран и прогнан во временной папке на этой машине: 6 интеграционных тестов в настоящем рантайме Workers (workerd), `tsc --noEmit` без ошибок, Biome без замечаний. Тесты подключаются к Worker по-настоящему, через WebSocket, и играют полный раунд.

Пять находок, ради которых стоило собрать прототип:

1. **В pnpm 12 разрешение сборочных скриптов называется `allowBuilds` и живёт в `pnpm-workspace.yaml`.** Старый `onlyBuiltDependencies` не работает нигде: в `package.json` pnpm ругается, что поле `pnpm` больше не читает, а в yaml он молча игнорируется с 11-й версии. Пока это не поправлено, `pnpm install` падает с `ERR_PNPM_IGNORED_BUILDS`, `workerd` не разворачивается и тесты сервера не запускаются. В репозитории сейчас лежит старый вариант — Task 1 это чинит.
2. **Смену фазы нужно рассылать сразу.** Если полагаться только на таймер снимков, клиенты узнают о старте раунда с задержкой до 100 мс, а короткий отсчёт можно вообще не увидеть. В прототипе это поймал тест.
3. **Мягкое выселение объекта (`evictDurableObject`) во время раунда не срабатывает:** объект занят таймером рассылки, и выселение ждёт его освобождения. Перезапуск посреди игры проверяется через `abortAllDurableObjects()`.
4. **`SELF` и `env` из `cloudflare:test` помечены устаревшими** в пользу `exports` и `env` из `cloudflare:workers`, но у `exports.default` сейчас нет типа `default`, и `tsc` на нём падает. Пока берём `SELF` — он работает и типизирован.
5. **partyserver адресует комнату через `idFromName`**, имя берётся из адреса `/parties/room/<имя>`. Это пригодится, когда понадобится достать конкретный объект в тестах.

## Как выполнять

- Ветка `feat/server`, работаем в самом репозитории.
- Один таск — один коммит. Conventional Commits, английский, **без подписей Claude**.
- Порядок тасков менять нельзя.
- Аккаунт Cloudflare для этого плана не нужен: тесты идут локально в workerd. Он понадобится только для деплоя в плане 3.

## Файловая структура

```
apps/server/
  package.json           @clicker/server: зависимости и скрипты
  wrangler.jsonc         привязка Durable Object, миграция на SQLite, переменные
  tsconfig.json          типы Workers и плагина тестов
  vitest.config.ts       запуск тестов внутри workerd, короткие длительности раунда
  src/worker.ts          маршрутизация /parties/*, проверка идентификатора комнаты
  src/room.ts            класс Room: соединения, команды, будильник, рассылка
  test/support.ts        клиент WebSocket для тестов
  test/room.test.ts      маршрутизация, вход, отказ не-хосту, полный раунд
  test/lifecycle.test.ts обрыв связи и перезапуск объекта
```

Меняются также: `pnpm-workspace.yaml`, корневой `package.json`, `.gitignore`.

---

### Task 1: Подготовить монорепозиторий к приложениям

**Files:**
- Modify: `pnpm-workspace.yaml`, `package.json`, `.gitignore`

- [ ] **Step 1: Переписать `pnpm-workspace.yaml` целиком**

Добавляем приложения и разрешаем сборочные скрипты. Ключ именно `allowBuilds`: прежний `onlyBuiltDependencies` в pnpm 12 не действует ни здесь, ни в `package.json`.

```yaml
packages:
  - "packages/*"
  - "apps/*"

# Разрешаем сборочные скрипты: без workerd не поднимется рантайм Workers в тестах.
allowBuilds:
  esbuild: true
  workerd: true
```

- [ ] **Step 2: Убедиться, что в корневом `package.json` нет поля `pnpm`**

Если оно там появится, pnpm при каждой установке будет печатать предупреждение, что это поле больше не читается. Настройки установки живут только в `pnpm-workspace.yaml`.

- [ ] **Step 3: Добавить в `.gitignore` сгенерированные типы Worker**

Файл `worker-configuration.d.ts` делает `wrangler types` из `wrangler.jsonc`; в git он не нужен, его пересоздаёт скрипт проверки типов.

```gitignore
worker-configuration.d.ts
```

- [ ] **Step 4: Проверить, что воркспейс цел**

Run: `pnpm install`
Expected: установка проходит без предупреждений про поле `pnpm` и без ошибки `ERR_PNPM_IGNORED_BUILDS`.

Run: `pnpm test`
Expected: как и раньше, 60 тестов в game и 31 в protocol.

- [ ] **Step 5: Закоммитить**

```bash
git add pnpm-workspace.yaml .gitignore pnpm-lock.yaml
git commit -m "chore: add apps to the workspace and allow workerd build scripts"
```

---

### Task 2: Каркас пакета apps/server

**Files:**
- Create: `apps/server/package.json`, `apps/server/wrangler.jsonc`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`

- [ ] **Step 1: Создать `apps/server/package.json`**

`typecheck` сначала пересоздаёт типы окружения: файл не хранится в git, а CI и локальная проверка должны работать одинаково.

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

- [ ] **Step 2: Создать `apps/server/wrangler.jsonc`**

Раздача собранного клиента появится в плане 3 вместе с самим клиентом; сейчас Worker обслуживает только `/parties/*`.

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

- [ ] **Step 3: Создать `apps/server/tsconfig.json`**

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

- [ ] **Step 4: Создать `apps/server/vitest.config.ts`**

```ts
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Раунд в тестах идёт доли секунды, а не тринадцать.
      miniflare: {
        bindings: { COUNTDOWN_MS: '50', ROUND_MS: '200' },
      },
    }),
  ],
});
```

- [ ] **Step 5: Установить зависимости**

Run: `pnpm install`
Expected: `Scope: all 4 workspace projects`, ставятся partyserver, wrangler, плагин тестов, у `workerd` отрабатывает postinstall. Ошибки `ERR_PNPM_IGNORED_BUILDS` быть не должно — если она появилась, значит `allowBuilds` из Task 1 не на месте.

- [ ] **Step 6: Проверить генерацию типов окружения**

Run: `pnpm --filter @clicker/server run types`
Expected: создаётся `apps/server/worker-configuration.d.ts`, в нём есть `interface Env`. Предупреждение про `@types/node` можно игнорировать: пакет Node-совместимость не использует.

- [ ] **Step 7: Закоммитить**

```bash
pnpm format
git add apps/server pnpm-lock.yaml
git commit -m "chore(server): scaffold the worker package"
```

---

### Task 3: Маршрутизация комнат

**Files:**
- Create: `apps/server/src/worker.ts`, `apps/server/src/room.ts`, `apps/server/test/support.ts`
- Test: `apps/server/test/room.test.ts`

- [ ] **Step 1: Создать помощник тестов `apps/server/test/support.ts`**

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

/** Копит входящие сообщения и позволяет дождаться нужного. */
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

- [ ] **Step 2: Написать падающий тест `apps/server/test/room.test.ts`**

Пока только проверка адреса; остальные тесты этого файла добавятся в следующих тасках.

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

- [ ] **Step 3: Убедиться, что тест падает**

Run: `pnpm --filter @clicker/server test`
Expected: FAIL, `Cannot find module './room'` или `Cannot find module '../src/worker'` — исходников ещё нет.

- [ ] **Step 4: Создать заготовку комнаты `apps/server/src/room.ts`**

```ts
import { Server } from 'partyserver';

export class Room extends Server<Env> {
  static options = { hibernate: true };
}
```

- [ ] **Step 5: Создать `apps/server/src/worker.ts`**

```ts
import { routePartykitRequest } from 'partyserver';
import { Room } from './room';

export { Room };

/** Тот же формат, что у идентификаторов протокола: 16 случайных байт в base64url. */
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

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `pnpm --filter @clicker/server test`
Expected: `Test Files 1 passed (1)`, `Tests 2 passed (2)`.

- [ ] **Step 7: Закоммитить**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): route rooms and reject malformed ids"
```

---

### Task 4: Вход игрока и рассылка снимков

**Files:**
- Modify: `apps/server/src/room.ts`, `apps/server/test/room.test.ts`

- [ ] **Step 1: Добавить падающий тест в `apps/server/test/room.test.ts`**

Импорты файла становятся такими:

```ts
import { SELF } from 'cloudflare:test';
import { generateId } from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { connect, isSnapshot, isWelcome } from './support';
```

Тест «accepts a connection to a well-formed room id» заменить на:

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

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm --filter @clicker/server test`
Expected: FAIL с таймаутом ожидания `welcome`: комната пока ничего не отвечает.

- [ ] **Step 3: Написать `apps/server/src/room.ts` целиком**

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

/** Что помним про соединение: переживает сон объекта. */
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

  /** Единственный путь изменения состояния: правила, события, хранилище, будильник, рассылка. */
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

  /** Снимок собирается один раз на всех, а не на каждое соединение. */
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

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter @clicker/server test`
Expected: `Test Files 1 passed (1)`, `Tests 2 passed (2)`.

- [ ] **Step 5: Закоммитить**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): join a room and broadcast snapshots"
```

---

### Task 5: Команды хоста и кликов

**Files:**
- Modify: `apps/server/src/room.ts`, `apps/server/test/room.test.ts`

- [ ] **Step 1: Добавить падающий тест в `apps/server/test/room.test.ts`**

В импорты добавить `isError`, в конец `describe` — тест:

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

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm --filter @clicker/server test`
Expected: FAIL — приходит `not_joined` вместо `not_host`: команды `start` и `click` пока не доходят до правил.

- [ ] **Step 3: Заменить последние строки `onMessage` в `apps/server/src/room.ts`**

Вместо безусловного `not_joined`:

```ts
    const session = connection.state;
    if (session === null) {
      this.#send(connection, { type: 'error', code: 'not_joined' });
      return;
    }

    await this.#run({ type: parsed.type, playerId: session.playerId }, connection);
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter @clicker/server test`
Expected: `Test Files 1 passed (1)`, `Tests 3 passed (3)`.

- [ ] **Step 5: Закоммитить**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): pass host and click commands to the rules"
```

---

### Task 6: Раунд целиком: будильник и поток снимков

**Files:**
- Modify: `apps/server/src/room.ts`, `apps/server/test/room.test.ts`

- [ ] **Step 1: Добавить падающий тест в `apps/server/test/room.test.ts`**

В импорты из `./support` добавить тип `Snapshot`, в конец `describe` — тест:

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

    // Отсчёт 50 мс, раунд 200 мс: значения заданы в vitest.config.ts.
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

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm --filter @clicker/server test`
Expected: FAIL с таймаутом: раунд заканчивается только когда кто-то пришлёт сообщение, а снимки во время раунда никто не шлёт.

- [ ] **Step 3: Добавить таймер снимков и будильник в `apps/server/src/room.ts`**

Рядом с интерфейсом `Session` добавить константу:

```ts
const SNAPSHOT_INTERVAL_MS = 100;
```

В поля класса добавить таймер:

```ts
  #timer: ReturnType<typeof setInterval> | null = null;
```

Добавить обработчик будильника (после `onMessage`):

```ts
  override async onAlarm(): Promise<void> {
    await this.#run({ type: 'tick' });
  }
```

Заменить хвост `#run` (всё после цикла по событиям):

```ts
    if (command.type !== 'click') {
      await this.#persist();
    }
    await this.#scheduleAlarm();
    this.#syncSnapshotTimer();

    // Во время раунда снимки шлёт таймер, вне раунда — каждое изменение.
    // Смену фазы отправляем сразу: ждать до сотни миллисекунд тут нельзя.
    if (phaseChanged || this.#timer === null) {
      this.#broadcastSnapshot();
    }
```

и в самом цикле по событиям завести флаг:

```ts
    let phaseChanged = false;
    for (const event of applied.events) {
      if (event.type === 'phaseChanged') phaseChanged = true;
      this.#handleEvent(event, source);
    }
```

Добавить сам таймер (перед `#broadcastSnapshot`):

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

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter @clicker/server test`
Expected: `Test Files 1 passed (1)`, `Tests 4 passed (4)`.

- [ ] **Step 5: Закоммитить**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): drive rounds with an alarm and stream snapshots"
```

---

### Task 7: Обрыв связи

**Files:**
- Modify: `apps/server/src/room.ts`
- Test: `apps/server/test/lifecycle.test.ts`

- [ ] **Step 1: Написать падающий тест `apps/server/test/lifecycle.test.ts`**

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

    // Игрок остаётся в списке: у него есть время вернуться.
    expect(snapshot.players).toHaveLength(2);
    staying.close();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm --filter @clicker/server test`
Expected: FAIL с таймаутом: закрытие сокета никак не отражается в состоянии.

- [ ] **Step 3: Добавить `onClose` в `apps/server/src/room.ts`** (после `onMessage`)

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

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter @clicker/server test`
Expected: `Test Files 2 passed (2)`, `Tests 5 passed (5)`.

- [ ] **Step 5: Закоммитить**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): release the connection when a socket closes"
```

---

### Task 8: Перезапуск объекта посреди раунда

**Files:**
- Modify: `apps/server/src/room.ts`, `apps/server/test/lifecycle.test.ts`

- [ ] **Step 1: Добавить падающий тест в `apps/server/test/lifecycle.test.ts`**

Первой строкой файла добавить импорт `import { abortAllDurableObjects } from 'cloudflare:test';`, в конец `describe` — тест:

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

    // Перезапуск объекта: память сбрасывается, хранилище остаётся.
    // Мягкое выселение тут не подходит — во время раунда объект занят таймером рассылки.
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

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm --filter @clicker/server test`
Expected: FAIL, `expected 'countdown' to be 'lobby'` — состояние поднимается из хранилища как есть, вместе с оборванным раундом.

- [ ] **Step 3: Дополнить `onStart` в `apps/server/src/room.ts`**

В импорты из `@clicker/game` добавить `abortRound` и `syncConnections`. Тело `onStart` после настройки `#config`:

```ts
    const stored = await this.ctx.storage.get<RoomState>('state');
    let state = stored ?? createRoomState();

    // Фаза раунда в хранилище означает, что объект перезапустился посреди игры
    // и клики из памяти потеряны.
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

- [ ] **Step 4: Убедиться, что все тесты проходят**

Run: `pnpm --filter @clicker/server test`
Expected: `Test Files 2 passed (2)`, `Tests 6 passed (6)`.

- [ ] **Step 5: Закоммитить**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): abort a round left over from a restart"
```

---

### Task 9: Общая проверка репозитория

**Files:** нет новых, только запуск

- [ ] **Step 1: Прогнать всё**

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
```
Expected:
- Biome: `No fixes applied.`;
- проверка типов: три раза `tsc --noEmit`, перед серверной — вывод `wrangler types`, ошибок нет;
- тесты: 60 в game, 31 в protocol, 6 в server.

- [ ] **Step 2: Поднять сервер локально и убедиться, что он стартует**

Run: `pnpm --filter @clicker/server run dev`
Expected: wrangler печатает локальный адрес вида `http://localhost:8787`. Клиента ещё нет, поэтому проверяем только запуск и отсутствие ошибок в консоли, затем останавливаем через Ctrl+C.

- [ ] **Step 3: Закоммитить, если что-то поменялось**

Если `pnpm format` изменил файлы:

```bash
git add -A
git commit -m "style: apply formatting after the server package"
```

---

## Проверка результата

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
```

Ожидается: линтер чист, проверка типов молчит, 97 тестов суммарно (60 + 31 + 6), ноль падений.

Сверить со спецификацией:
- §4 «Комнаты и доступ» — проверка формата идентификатора комнаты до подключения; создание комнаты по требованию;
- §7 «Сервер» — комната на partyserver со сном, состояние соединения, будильник как двигатель фаз, хранилище, рассылка снимков, длительности из переменных окружения;
- §9 «Ошибки и крайние случаи» — некорректное сообщение, команда без входа, старт не от хоста, обрыв связи, перезапуск объекта;
- §10 «Тестирование» — интеграционные тесты сервера в рантайме Workers.

Остаётся на план 3: раздача клиента через Static Assets (`assets` в `wrangler.jsonc`), сквозные тесты Playwright и деплой.

## Что нужно от тебя

- **Во время этого плана:** ничего. Тесты идут локально в workerd, аккаунт Cloudflare не нужен.
- **Перед планом 3:** аккаунт Cloudflare на бесплатном тарифе, поддомен `<имя>.workers.dev` и `npx wrangler@latest login` — они понадобятся для первого деплоя.

## Заметки на будущее

- `SELF` из `cloudflare:test` помечен устаревшим в пользу `exports.default` из `cloudflare:workers`, но у того сейчас нет типа `default` и `tsc` на нём падает. Когда типы починят, замена делается в одном месте — в `test/support.ts`.
- Снимок на 50 игроков занимает около 3 КБ; он собирается один раз за тик и рассылается всем, а не собирается заново на каждое соединение. Это стоит сохранить при любых правках рассылки.
- Во время раунда объект держит таймер и не засыпает — так и задумано: раунд длится тринадцать секунд. В лобби таймер снимается, и объект может заснуть.
