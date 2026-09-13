# Clicker: основа для realtime-мультиплеера на Cloudflare — дизайн

Дата: 2026-09-11 · Статус: утверждён в брейншторме, ждёт ревью файла

## 1. Контекст и цель

Личный проект на личном аккаунте Cloudflare, с рабочей инфраструктурой не связан. Цель — чистая основа
для браузерных мультиплеерных игр в реальном времени, на которой потом вырастет 3D-игра на three.js.
Первый режим — кликер-гонка: хост запускает раунд, все одновременно кликают 10 секунд, побеждает тот,
кто накликал больше.

Первая версия готова, когда:
- хост создаёт комнату и делится ссылкой, игроки заходят по ней с ноутбуков и телефонов;
- раунд идёт у всех синхронно: отсчёт 3 с, 10 с кликов, у всех один и тот же победитель;
- во время раунда у всех живая 3D-сцена со счётом игроков;
- правила покрыты юнит-тестами, сервер — интеграционными, полный раунд — e2e-тестом;
- деплой идёт из `main` через GitHub Actions на бесплатный тариф Cloudflare.

Простой кликер для рабочего колеса делается отдельно в рабочем репозитории и сюда не относится.

## 2. Что сейчас не делаем

- Авторизацию и аккаунты: игрок — это ник и `playerId` из localStorage.
- Историю игр и общие таблицы рекордов.
- Реестр игровых режимов и общий интерфейс режима: выделим, когда появится второй режим.
- ECS, физику, бинарный протокол, подбор игроков.
- Мультиязычность: тексты интерфейса на русском, собраны в одном файле.
- Детектор автокликеров: честность на доверии, сервер только ограничивает частоту.

## 3. Архитектура

### Слои и зависимости

```
apps/game          клиент и Worker в одном приложении:
                   src/client — экраны, 3D-сцена, сеть   React 19.2, react-three-fiber, drei, zustand, partysocket
                   src/worker — Worker и комната         partyserver, Durable Objects, Workers Static Assets
packages/protocol  схемы сообщений и типы     valibot
packages/game      состояние и правила        без зависимостей
e2e                сквозные тесты             Playwright
```

- `packages/game` не импортирует ничего: ни Cloudflare, ни DOM, ни `Date.now()`, ни `Math.random()`.
  Время и конфиг приходят параметрами.
- `packages/protocol` зависит только от `packages/game` (типы и функция снимка).
- `apps/game` зависит от обоих пакетов. Клиент и Worker живут в одном приложении, потому что
  плагин `@cloudflare/vite-plugin` собирает их вместе и деплоит одной командой; общего кода у них
  нет, всё общее лежит в пакетах.

### Репозиторий

```
clicker/
  apps/
    server/
      src/worker.ts        /parties/* → комната; остальное Worker не видит, отдаёт Static Assets
      src/room.ts          класс Room (partyserver): адаптер между соединениями и ядром
      test/                интеграционные тесты (@cloudflare/vitest-plugin)
      wrangler.jsonc
    web/
      src/main.tsx
      src/app.tsx          выбор экрана по маршруту и фазе
      src/net/             соединение, отправка команд, поправка часов
      src/store.ts         zustand
      src/screens/         Landing, Join, Lobby, Arena, Results
      src/scene/           RaceScene (react-three-fiber)
      src/theme.ts         палитра
      src/strings.ts       тексты интерфейса
  packages/
    game/src/              config, state, apply, advance, clicker, results, deadline
    protocol/src/          ids, client, server, snapshot
  e2e/
  docs/superpowers/specs/
  .github/workflows/ci.yml
  biome.json  pnpm-workspace.yaml  tsconfig.base.json  package.json
```

## 4. Комнаты и доступ

Общих секретов нет: доступ дают ссылки с неугадываемыми идентификаторами.

- **Идентификаторы.** `roomId`, `hostKey` и `playerId` — 16 случайных байт из `crypto.getRandomValues`
  в base64url, 22 символа. Формат: `^[A-Za-z0-9_-]{22}$`.
- **Создание комнаты.** Кнопка «Создать комнату» на главной генерирует `roomId` и `hostKey`,
  сохраняет ключ в localStorage (`hostKeys[roomId]`) и переходит на `/r/<roomId>`. Отдельного запроса
  нет: объект комнаты создаётся при первом подключении.
- **Хост.** Первый `join` с `hostKey` в комнате без ключа закрепляет этот ключ за комнатой.
  Каждый `join` с тем же ключом делает игрока хостом. `join` с другим ключом проходит как обычный вход,
  в `welcome` приходит `isHost: false`.
- **Второе устройство хоста.** В лобби у хоста есть кнопка «Скопировать ссылку хоста»:
  `/r/<roomId>#host=<hostKey>`. Клиент при загрузке читает ключ из фрагмента, сохраняет его
  в localStorage и сразу убирает фрагмент через `history.replaceState`. Фрагмент не уходит на сервер.
- **Приглашение.** Обычная ссылка `/r/<roomId>`.
- **Проверка на входе.** Worker отвечает 404 до подключения, если `roomId` не соответствует формату.

## 5. Ядро (packages/game)

### Конфиг

```ts
export interface GameConfig {
  countdownMs: number;      // 3000
  roundMs: number;          // 10000
  lateGraceMs: number;      // 250: клики принимаются ещё столько после конца раунда
  clicksPerSecond: number;  // 15: скорость пополнения ведра
  burst: number;            // 15: ёмкость ведра
  reconnectGraceMs: number; // 30000
  maxPlayers: number;       // 50
}
export const DEFAULT_CONFIG: GameConfig;
```

### Состояние

```ts
export type Phase = 'lobby' | 'countdown' | 'running' | 'results';

export interface RoomState {
  phase: Phase;
  hostKey: string | null;
  hosts: string[];                   // playerId хостов
  players: Record<string, Player>;   // ключ — секретный playerId
  nextSeq: number;                   // счётчик для publicId, начинается с 1
  round: { goAt: number; endsAt: number } | null;
  results: ResultRow[] | null;
  notice: 'round_aborted' | null;
}

export interface Player {
  publicId: string;                  // String(nextSeq) на момент входа
  name: string;
  connectionIds: string[];           // id открытых соединений этого игрока
  disconnectedAt: number | null;
  clicks: number;
  lastCountedAt: number | null;      // время последнего засчитанного клика
  bucket: { tokens: number; updatedAt: number };
}

export interface ResultRow { publicId: string; name: string; clicks: number; rank: number }
```

Состояние — простой JSON-сериализуемый объект: его можно сохранить в хранилище объекта как есть.

Фазы: `lobby → countdown → running → results`. Из `results` хост сразу запускает следующий раунд
(`results → countdown`), отдельного возврата в лобби нет.

### API

```ts
export type Command =
  | { type: 'join'; playerId: string; connectionId: string; name: string; hostKey?: string }
  | { type: 'leave'; playerId: string; connectionId: string }
  | { type: 'start'; playerId: string }
  | { type: 'click'; playerId: string }
  | { type: 'tick' };

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

`apply`, `abortRound` и `syncConnections` не мутируют входное состояние.

### Продвижение времени

Любая команда сначала выполняет `advance(state, now)`, потом обрабатывается сама; `tick` — это только
`advance`. Поэтому правила не зависят от точности будильника: опоздавший будильник или клик после
конца раунда увидят уже закрытый раунд.

`advance` выполняет шаги по порядку, за один вызов можно пройти несколько:
1. `countdown` и `now ≥ goAt` → `running`, событие `phaseChanged`.
2. `running` и `now ≥ endsAt + lateGraceMs` → `results`, считаются результаты, событие `phaseChanged`.
3. В `lobby` и `results` удаляются игроки без открытых соединений, у которых `disconnectedAt + reconnectGraceMs ≤ now`,
   их `playerId` убирается из `hosts`. Строки в уже посчитанных `results` остаются.

### Правила

- **join**
  - Игрок с таким `playerId` уже есть: `connectionId` добавляется в `connectionIds`, если его там
    ещё нет, `disconnectedAt = null`, ник обновляется, счёт сохраняется. Повторный `join` с того же
    соединения ничего не меняет: счёт соединений нельзя накрутить, отправив `join` много раз.
  - Нового игрока при `maxPlayers` игроках не пускаем: `rejected room_full`. Иначе он добавляется
    с `publicId = String(nextSeq)`, `clicks = 0`, `lastCountedAt = null`,
    `bucket = { tokens: burst, updatedAt: now }`, `connectionIds = [connectionId]`; `nextSeq += 1`.
  - Хост: если передан `hostKey` и `state.hostKey === null`, ключ закрепляется и `playerId` добавляется
    в `hosts`. Если ключ передан и совпадает, `playerId` добавляется в `hosts`. Повторов в `hosts` нет.
    В остальных случаях статус хоста не меняется.
  - Событие `welcome` с `isHost = hosts.includes(playerId)`.
  - Войти можно в любой фазе. Новый игрок во время раунда начинает с нуля.
- **leave.** `connectionId` убирается из `connectionIds`. Если список опустел и `disconnectedAt`
  ещё не стоял — `disconnectedAt = now`; повторный `leave` того же соединения ничего не меняет и не
  сдвигает срок удаления. Во время `countdown` и `running` игрок не удаляется, счёт сохраняется.
- **start.** Неизвестный `playerId` → `not_joined`; игрок не из `hosts` → `not_host`; фаза не `lobby`
  и не `results` → `wrong_phase`. Иначе:
  `phase = countdown`, `round = { goAt: now + countdownMs, endsAt: now + countdownMs + roundMs }`;
  у всех игроков `clicks = 0`, `lastCountedAt = null`, `bucket = { tokens: burst, updatedAt: goAt }`;
  `results = null`, `notice = null`; событие `phaseChanged`.
- **click.** Неизвестный `playerId` → `not_joined`. Вне фазы `running` клик молча игнорируется.
  В `running` ведро пополняется на `(now − updatedAt) × clicksPerSecond / 1000`, но не выше `burst`.
  Если токенов ≥ 1 — токен списывается, `clicks += 1`, `lastCountedAt = now`,
  `updatedAt = max(updatedAt, now)`. Если токенов меньше одного, состояние не меняется вообще.
  Оба правила защищают от метки времени из прошлого: она не должна сдвигать точку отсчёта назад
  и дарить игроку лишний запас кликов.
- **Результаты.** Сортировка: `clicks` по убыванию → `lastCountedAt` по возрастанию (`null` в конце) →
  `publicId` по возрастанию как числа. `rank` — позиция начиная с 1. Победитель — первая строка,
  если у неё `clicks > 0`; иначе победителя нет.
- **abortRound.** Только из `countdown` и `running`, иначе состояние возвращается как есть.
  `phase = lobby`, `round = null`, `notice = 'round_aborted'`, у всех игроков `clicks = 0`
  и `lastCountedAt = null`: показывать в лобби счёт прерванного раунда незачем.
- **syncConnections.** Для каждого игрока `connectionIds = live[playerId] ?? []`. Если список пуст
  и `disconnectedAt === null` — `disconnectedAt = now`; если не пуст — `disconnectedAt = null`.
  Уже проставленное время отключения сохраняется.

### nextDeadline

Минимум из:
- `goAt` в `countdown`;
- `endsAt + lateGraceMs` в `running`;
- `disconnectedAt + reconnectGraceMs` отключённых игроков в `lobby` и `results`.

`null`, если сроков нет.

## 6. Протокол (packages/protocol)

Все сообщения — JSON-объекты с полем `type`. Схемы на valibot, типы выводятся из схем.
Лишние поля во входящих сообщениях — ошибка.

Клиент → сервер:

```ts
{ type: 'join'; playerId: Id; name: Name; hostKey?: Id }
{ type: 'start' }
{ type: 'click' }
```

- `Id` — строка формата из §4.
- `Name` — строка, после `trim` длиной от 1 до 20 символов (считаются code points); дальше везде
  используется обрезанное значение. Управляющие символы и знаки смены направления письма
  (U+202A–U+202E, U+2066–U+2069) запрещены: ник уходит всем игрокам в каждом снимке.

Сервер → клиент:

```ts
{ type: 'welcome'; you: string; isHost: boolean }
{ type: 'snapshot'; serverNow: number; phase: Phase;
  players: { id: string; name: string; clicks: number; connected: boolean }[];   // по возрастанию id как чисел
  round: { goAt: number; endsAt: number } | null;
  results: { id: string; name: string; clicks: number; rank: number }[] | null;
  notice: 'round_aborted' | null }
{ type: 'error'; code: ErrorCode | 'invalid_message' }
```

`id` в сообщениях — это `publicId`. `playerId` и `hostKey` сервер не отправляет никогда.

Пакет экспортирует:
- `parseClientMessage(raw: string): ClientMessage | null` — `null` для строк длиннее 1024 байт,
  некорректного JSON и всего, что не прошло схему;
- `parseServerMessage(raw: string): ServerMessage | null` — для клиента; его предел больше,
  64 КБ: снимок на 50 игроков занимает около 3 КБ, но он на порядок крупнее сообщений клиента;
- `toSnapshot(state: RoomState, now: number): SnapshotMessage`;
- `generateId(): string` — для `roomId`, `hostKey`, `playerId` на клиенте.

## 7. Сервер (apps/game/src/worker)

### wrangler.jsonc

```jsonc
{
  "name": "clicker",
  "main": "src/worker/worker.ts",
  "compatibility_date": "2026-09-11",
  // Каталог собранной статики подставляет плагин Vite, руками его указывать не нужно.
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

Worker запускается только для `/parties/*`: остальное отдаёт Static Assets с переходом на
`index.html` для SPA. Worker вызывает `routePartykitRequest` и проверяет формат `roomId` в двух
местах: `onBeforeConnect` — для подключений по WebSocket, `onBeforeRequest` — для обычных запросов.
Второе обязательно: без него простой GET по адресу комнаты минует проверку и создаст объект
Durable Object раньше, чем кто-либо откроет сокет. Формат берётся из `isId` пакета протокола, чтобы
определение не разошлось в двух местах. При ошибке — ответ 404, и если маршрут не совпал ни с одной
комнатой — тоже 404.

Адрес комнаты: `/parties/room/<roomId>` (имя `room` получается из имени привязки `Room`).

### Room

`class Room extends Server<Env>`, `static options = { hibernate: true }`.
В памяти: `state: RoomState`, `config: GameConfig`, таймер рассылки.
В состоянии соединения (переживает сон): `{ playerId, publicId }` после успешного `join`.

- **onStart**
  1. `state = (await ctx.storage.get('state')) ?? createRoomState()`; `config` — `DEFAULT_CONFIG`
     с `COUNTDOWN_MS` и `ROUND_MS` из `env`. Этот же `config` передаётся и в `apply`,
     и в `nextDeadline`: если отдать его только в одно место, будильник пойдёт по стандартным
     длительностям, правила — по своим, и раунд зависнет до следующего сообщения от игрока.
  2. Если загруженная фаза `countdown` или `running`, значит объект перезапустился посреди раунда
     и клики в памяти потеряны: `state = abortRound(state)`.
  3. Сверка соединений: по `getConnections()` и их состоянию собираются id живых соединений
     на каждый `playerId`, затем `state = syncConnections(state, live, now)`.
  4. Сохранение, будильник и снимок всем: после восстановления клиенты должны сразу увидеть
     настоящее состояние, а не ждать чужого сообщения, глядя на несуществующий отсчёт.
- **onConnect** — ничего: игрок появляется только после `join`.
- **onMessage(conn, raw)**
  1. Бинарное сообщение или `parseClientMessage(raw) === null` — `error invalid_message` этому соединению.
  2. В командах `join` и `leave` всегда передаётся `connectionId` — это `conn.id` из partyserver.
     `join`: если у соединения уже есть другой `playerId`, сначала `leave` для старого.
     `start` и `click`: `playerId` берётся из состояния соединения; если его нет — `error not_joined`.
  3. `apply(state, command, Date.now(), config)`.
  4. События: `welcome` — `conn.setState({ playerId, publicId })` и отправка `welcome` этому соединению;
     `rejected` — `error` этому соединению; `phaseChanged` — управление рассылкой (ниже).
  5. Сохранение, будильник, рассылка.
- **onClose(conn)** — если у соединения есть `playerId`: `apply(leave)`, сохранение, будильник, рассылка.
- **onError(conn)** — то же самое. Аварийно оборванные сокеты partyserver отправляет сюда, и `onClose`
  за ними может не прийти; без этого игрок навсегда останется «подключённым» и будет занимать место
  в комнате. Повторный `leave` безопасен: он идемпотентен.
- **onAlarm** — `apply(tick)`, сохранение, будильник, рассылка.

### Рассылка

- В `lobby` и `results` — снимок всем после каждого изменения состояния.
- При переходе в `countdown` запускается `setInterval` на 100 мс, который шлёт снимок всем.
  Таймер держит объект бодрствующим до конца раунда. При переходе в `results` таймер останавливается,
  и сразу уходит снимок с результатами.

### Хранение

`ctx.storage.put('state', state)` вызывается всегда, когда сменилась фаза, и при командах `join`,
`leave`, `start`, а также в `onStart`. Важно: смену фазы может принести и обычный клик — `advance`
выполняется перед каждой командой, поэтому именно клик способен закрыть раунд. Решать по типу
команды нельзя, иначе итоги раунда уйдут игрокам, но не в хранилище. Не сохраняются только клики,
которые всего лишь увеличили счёт.

### Будильник

После каждой обработки: `d = nextDeadline(state, config)`. Если `d !== null` — `ctx.storage.setAlarm(d)`,
иначе `ctx.storage.deleteAlarm()`. Срок сравнивается с уже поставленным, и лишний раз будильник не
трогаем: это запись в хранилище, а во время раунда срок постоянен — иначе каждый клик оборачивался бы
записью на диск.

## 8. Клиент (apps/game/src/client)

### Маршруты

Без библиотеки маршрутизации: `/` — главная, `/r/:roomId` — комната, всё остальное → главная.

### localStorage

`playerId` (генерируется при первом заходе), `name`, `hostKeys` (`roomId → hostKey`).
Все обращения в try/catch. Без localStorage игра работает, но после перезагрузки игрок считается новым.

### net/

- Соединение: `new PartySocket({ host: location.host, party: 'room', room: roomId })`.
- На каждое событие `open` отправляется `join` с `playerId`, `name` и `hostKey`, если он есть для этой комнаты.
- `start` и `click` отправляются только при открытом соединении. То, что нажато без связи, не копится
  и не отправляется потом.
- Входящие сообщения разбираются `parseServerMessage` и кладутся в стор.
- Поправка часов: на каждый снимок считается `serverNow − Date.now()`. Поправка — максимум из последних
  10 значений: сетевая задержка только уменьшает значение, поэтому максимум ближе всего к правде.
  Серверное время на клиенте — `Date.now() + offset`.

### Стор (zustand)

`{ status: 'connecting' | 'open' | 'reconnecting', you, isHost, snapshot, offset, localClicks, lastError }`.
`localClicks` — число своих нажатий в текущем раунде, сбрасывается при переходе в `countdown`.

### Экраны

- **Landing** — кнопка «Создать комнату».
- **Join** — поле ника и кнопка «Войти». Если ник уже сохранён, экран пропускается.
- **Lobby** — список игроков (отключённые приглушены), «Скопировать приглашение»; у хоста ещё
  «Скопировать ссылку хоста» и «Старт».
- **Arena** (`countdown` и `running`) — сцена сверху, крупный таймер, крупная кнопка снизу на всю ширину
  (на телефоне — нижняя половина экрана). Кнопка активна с `goAt` до `endsAt` по серверному времени
  клиента. На кнопке — `localClicks`, в сцене — серверные числа всех игроков.
- **Results** — сцена с подсвеченным победителем, таблица мест, баннер «<ник> побеждает!» или
  «Никто не кликал»; у хоста — «Ещё раунд».
- Поверх любого экрана: плашка «Переподключение…», когда статус не `open`; сообщение
  «Раунд прерван, начните заново», когда `notice = round_aborted`.

### Сцена (scene/RaceScene)

- `<Canvas>` из react-three-fiber, камера смотрит на колонны игроков.
- Одна колонна на игрока, по порядку `publicId`, до 12 в ряд, дальше следующий ряд.
- Целевая высота пропорциональна `clicks / max(1, наибольший clicks)`. Текущая высота каждый кадр
  догоняет целевую через `THREE.MathUtils.damp` в `useFrame`, без `setState`.
- Ники — через `Html` из drei.
- Победитель на экране результатов — золотой материал с эмиссией.
- Буфер снимков с интерполяцией по времени не нужен, пока в сцене нет движущихся объектов;
  появится вместе с ними.

### Ввод

Кнопка слушает `pointerdown`, в CSS `touch-action: manipulation` и `user-select: none`.
Каждое событие — один клик, несколько пальцев считаются.

### Палитра (theme.ts)

Стартовые значения, подбираются на глаз. Выставляются CSS-переменными на `:root` и используются
в материалах сцены.

```ts
export const theme = {
  bg: '#0b0d14', surface: '#151a26', border: '#262c3d',
  text: '#ece8df', muted: '#8b90a3',
  gold: '#d4a93c', goldBright: '#f2d47a', danger: '#e5534b',
};
```

### Тексты

Все строки интерфейса — в `strings.ts`, на русском.

## 9. Ошибки и крайние случаи

| Ситуация | Поведение |
|---|---|
| Некорректный JSON, не прошло схему, больше 1024 байт | `error invalid_message` отправителю, соединение остаётся |
| `start` или `click` до `join` | `error not_joined` |
| `start` не от хоста | `error not_host` |
| `start` в `countdown` или `running` | `error wrong_phase` |
| `join` в полную комнату | `error room_full` |
| Клик вне `running` или сверх лимита | молча игнорируется |
| Две вкладки с одним `playerId` | один игрок; отключён, когда закрыты обе |
| Повторный `join` с того же соединения | ничего не меняется: соединение уже учтено |
| Лишний `leave` того же соединения | ничего не меняется: живые соединения не трогаются, срок удаления не сдвигается |
| Обрыв связи | PartySocket переподключается, клиент снова шлёт `join`; в лобби игрок ждёт 30 с, в раунде счёт сохраняется |
| Объект перезапустился посреди раунда | `abortRound`: лобби и `notice = round_aborted` |
| Будильник опоздал | не влияет: команды и `tick` сначала продвигают время |
| Неверный формат `roomId` | 404 до подключения |
| Хост ушёл | комната живёт, хост возвращается по сохранённому ключу |

## 10. Тестирование

- **packages/game — Vitest, по TDD.**
  - join: новый игрок, повторный вход, вторая вкладка, полная комната, закрепление ключа хоста,
    вход с верным и неверным ключом;
  - start: не хост, неверная фаза, сброс счёта, старт из `results`;
  - click: вне раунда, запас ведра 15, пополнение 15/с, граница `endsAt + lateGraceMs`;
  - advance: каждый переход, несколько переходов за один вызов, удаление отключённых только вне раунда;
  - результаты: ничья по `lastCountedAt`, полная ничья по `publicId`, никто не кликал;
  - `nextDeadline`, `abortRound`, `syncConnections`, неизменность входного состояния.
- **packages/protocol — Vitest.** Корректные сообщения; ник из пробелов и длиннее 20; лишние поля;
  сообщение длиннее 1024 байт; в снимке нет `playerId` и `hostKey`.
- **Worker — `@cloudflare/vitest-plugin`.** WebSocket к настоящему Worker: два игрока, хост
  стартует, клики, результаты в снимке; `start` не от хоста; неверный `roomId` → 404.
  Длительности: отсчёт 50 мс, раунд 200 мс.
- **e2e — Playwright** против dev-сервера Vite, который поднимает сам Playwright: два браузерных
  контекста (десктоп и мобильный вьюпорт), создание комнаты, вход по ссылке, раунд, одинаковый
  победитель у обоих. Отдельный `wrangler dev` не нужен: Worker работает внутри dev-сервера.

## 11. Инструменты, разработка, CI

- Node 22, pnpm через corepack, pnpm workspaces. Версии зависимостей фиксируются в плане реализации
  по актуальным стабильным релизам.
- TypeScript в режиме `strict`, общий `tsconfig.base.json`. Проверка типов идёт по пакетам:
  `tsc --noEmit` в каждом, запуск через `pnpm -r typecheck`. Project references не нужны: пакеты
  отдают исходники на TypeScript напрямую, собирать и упорядочивать нечего.
- Biome — линтер и форматтер для всего репозитория.
- Локальная разработка: одна команда `vite dev`. Плагин `@cloudflare/vite-plugin` запускает Worker
  прямо внутри dev-сервера, поэтому второй процесс и проксирование `/parties` не нужны. Сборка
  `vite build` кладёт клиент в `dist/client`, Worker и сгенерированный конфиг — в `dist/<имя>`,
  после чего `wrangler deploy` уезжает без единой дополнительной настройки.
- React закреплён на 19.2: `@react-three/fiber` 9.7 требует строго ниже 19.3.
- Браузеры Playwright должны совпадать с его версией: перед первым запуском и в CI нужен
  `playwright install chromium`.
- Сцена на three.js подключается лениво: она тянет около мегабайта, и держать её в основном бандле,
  который нужен уже на экране входа, незачем.
- CI в GitHub Actions:
  - на любой push и на pull request: Biome, проверка типов, тесты пакетов и Worker, сборка, установка браузера и Playwright;
  - на push в `main` после проверок: `wrangler deploy` с `CLOUDFLARE_API_TOKEN` и
    `CLOUDFLARE_ACCOUNT_ID` из секретов репозитория.

## 12. Внешние зависимости и доступы

- Личный аккаунт Cloudflare на бесплатном тарифе, поддомен workers.dev, `wrangler login` для ручного деплоя.
- API-токен Cloudflare (шаблон «Edit Cloudflare Workers») и Account ID в секретах GitHub-репозитория
  `tjuana/clicker`.
- Серверные секреты не нужны.

## 13. Риски

| Риск | Решение |
|---|---|
| Кто-то массово создаёт комнаты или флудит сообщениями и выедает дневной лимит бесплатного тарифа | Принимаем: худший исход — игра стоит до конца суток, без счёта. Если случится — Turnstile на создание комнаты и лимит сообщений на соединение |
| Автокликер на 15 кликов/с обгоняет любого человека | Принимаем, игра на доверии |
| Сетевая задержка урезает окно удалённым игрокам | Кнопка включается по серверному времени с поправкой часов, сервер принимает клики ещё 250 мс после конца раунда |
| API partyserver, partysocket или vitest-plugin отличается в деталях от описанного | Точные сигнатуры сверяются с документацией при написании плана |
