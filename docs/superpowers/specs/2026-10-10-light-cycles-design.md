# Световые байки: второй режим и живой тик — дизайн

Дата: 2026-10-10 · Статус: части 1–2 утверждены в брейншторме, часть 3 и файл ждут ревью

Дорожная карта, исследование чужих проектов и замеры прототипа тика:
[план 5](../plans/2026-10-10-plan-5-roadmap-realtime-modes.md). Основа платформы:
[спецификация кликера](2026-09-11-clicker-foundation-design.md).

## 1. Контекст и цель

Второй режим платформы — байки, оставляющие за собой след. Врезался в след — выбыл и через пару
секунд вернулся. Раунд идёт на время, очки — за соперников, которые врезались в твой след. Стиль —
неоновая сетка в духе «Трон: Наследие». Музыка и название — свои: саундтрек Daft Punk и имя Tron
принадлежат Disney. Рабочее имя режима — «Неоновые байки», в коде — `cycles`.

Режим нужен не только сам по себе. На нём впервые появляются серверный тик, интерфейс режимов и
мир, который живёт без ввода игроков. Всё это потом понадобится кольцевой гонке.

Версия готова, когда:
- хост создаёт комнату с режимом «байки», добавляет ботов, и раунд играется с клавиатуры;
- у всех игроков одинаковое поле, одинаковые смерти и одинаковая таблица;
- в одиночку с ботами играется так же, как с людьми;
- правила, боты и стоимость тика покрыты тестами, включая тесты асимптотики и детерминизма;
- оформление неоновое: меню режима, HUD, лидерборд, процедурная музыка;
- 20 участников (люди плюс боты) держат 60 fps на M2 и укладываются в замеренный бюджет трафика.

## 2. Что сейчас не делаем

- **Предсказание своего байка на клиенте.** Сначала играем без него и меряем, насколько ощутима
  задержка. Отдельная спецификация, этап 4 дорожной карты.
- **Бэкдейтинг поворотов** по схеме Armagetron. Задержку прощает резина (раздел 4); перемотка
  состояния на сервере — только если резины не хватит на живой игре.
- Перевод всей платформы в неон: решаем после того, как поиграем в байков.
- Управление с телефона: только клавиатура.
- Бинарный протокол: дельты в JSON укладываются в бюджет (раздел 6).

## 3. Слои: что где меняется

Слои и их запреты прежние. Правила остаются чистыми.

```
packages/game/src/modes/cycles   правила байков и боты              новое
packages/game/src/modes/index    интерфейс режима и выбор по ModeId  новое
packages/game/src/room           комната вызывает режим через интерфейс, тик
packages/protocol                сообщения full, delta, ввод байков
apps/game/src/worker             накопитель тика в комнате
apps/game/src/client             сцена, HUD, лидерборд, музыка байков
```

## 4. Правила (`packages/game/src/modes/cycles`)

### Поле

- Сетка `Uint16Array`, индекс клетки — `y * side + x`. Хеш не нужен: поле ограничено.
- В клетке `0` (пусто) или номер слота владельца следа (1…n). Номер слота, а не `publicId`:
  слотов не больше `maxPlayers`, а `publicId` растут без предела.
- Сторона поля фиксируется на старте раунда: `side = max(40, round(k · √n))`, где n — участники с
  ботами. На игрока приходится k² клеток независимо от их числа. При `k = 28,6` и хвосте 200
  занято около 24 % поля. Граница поля — стена.

### Байк

- Голова `(x, y)`, направление `dir` 0–3; поворот — `(dir ± 1) & 3`.
- **Хвост — кольцевой буфер** клеток фиксированной длины L (по умолчанию 200). Новая клетка
  записывается на место самой старой, та освобождается.
- Очередь поворотов глубиной 2. Применяется не больше одного поворота за тик, поэтому разворот
  занимает два тика с шагом между ними: байк уходит в соседнюю полосу и в себя не въезжает.
- Резина: запас R тиков (по умолчанию 3, это 150 мс при 20 Гц). Вдали от препятствий
  восстанавливается на 1 тик в секунду.
- Рывок: 1 с двойной скорости, перезарядка 4 с.

### Тик — все байки одновременно

1. Из очереди каждого байка применяется один поворот.
2. **Подшаг 1** для всех живых байков, **подшаг 2** только для тех, у кого рывок. Внутри подшага:
   1. освободить последние клетки хвостов — за чужим хвостом можно ехать впритык;
   2. посчитать новую голову каждого;
   3. две и больше головы в одной клетке — гибнут все;
   4. голова в клетке, занятой **до хода** (чужой или свой след, другая голова, стена), — это
      препятствие. Встречные байки из соседних клеток врезаются друг в друга, а не проезжают
      насквозь;
   5. перед препятствием байк не гибнет, а стоит на месте и тратит единицу резины (одну за
      подшаг, так что на рывке она тратится вдвое быстрее). Пока он стоит, хвост
      не двигается. Кончилась резина — гибнет, и **виновник** — владелец клетки впереди.
3. Обход игроков — по возрастанию слота, но порядок на результат не влияет: каждый подшаг сначала
   вычисляется целиком, а потом применяется.

Все числа целые. Случайность — только сидированный ГПСЧ (mulberry32 на `Math.imul` и сдвигах)
внутри состояния режима.

### Смерть, очки, респаун

- Врезался в чужой след — виновник получает **+1** и **+25 клеток хвоста** (потолок L = 400).
  Стена или свой след — очков никому, но смерть засчитывается.
- След погибшего гаснет сразу.
- Через 2 с — респаун **в самой свободной точке**. Многоисточниковый BFS от всех занятых клеток
  даёт расстояние до ближайшего препятствия за O(клеток); берём клетку с максимумом, равенство
  разбивает ГПСЧ. Направление — в ту сторону, где до препятствия дальше. Хвост начинается с длины 0
  и дорастает до своего L.
- **Старт раунда — решёткой, а не поиском.** √n колонок и столько рядов, сколько нужно под всех, каждый
  байк в середине своего блока и лицом туда, где по полю на этот момент дальше всего до препятствия
  (при равенстве — меньший индекс направления). Поиск самой свободной точки для каждого байка
  стоил бы O(n × клеток), а клеток тем больше, чем больше игроков, — квадрат (план 6, находка 4).
- После смерти хвост возвращается к базовой длине: удлинения за убийства живут одну жизнь.
- Ушедший из раунда игрок только помечается. Байк снимает следующий тик — как смерть без виновника,
  поэтому его клетки и событие уходят в `changes`, как и всё остальное. Вернувшийся занимает прежний
  слот и ждёт обычное время возрождения.
- Таблица мест: убийства по убыванию, затем смерти по возрастанию, затем самая долгая жизнь.

### Раунд

Обратный отсчёт и фазы — общие для платформы (лобби → отсчёт → игра → результаты). Длина раунда —
3 минуты. Тик — 50 мс (20 Гц).

### Боты

- Бот — участник со слотом, как игрок, но решение за него принимает чистая функция
  `decide(state, slot)` на каждом тике, до шага.
- Решение — заливка пространства (BFS) для трёх вариантов: прямо, влево, вправо. Выбирается вариант
  с наибольшей достижимой областью. Заливка **ограничена бюджетом** в 256 клеток на вариант и
  запускается, только когда препятствие ближе 8 клеток; иначе бот едет прямо с небольшой
  случайностью из ГПСЧ.
- Ничья по площади решается длиной свободного прогона (до 32 клеток), затем случайно из ГПСЧ;
  случайный поворот на простом участке проходит ту же проверку площадью. Без этого боты въезжали в
  стены, в тупики и закручивались спиралью внутрь (план 6, находки 1–3). Одиночный бот гибнет в
  среднем 0,7 раза за раунд — гейт от ухудшения, а не цель.
- Сложность — бюджет заливки и доля случайных ошибок. На первую версию один уровень.

## 5. Комната и интерфейс режимов

Интерфейс выводится из двух реализаций, кликера и байков, как предписывает CLAUDE.md:

```ts
interface Mode<State, Input> {
  create(config: GameConfig, seed: number): State;
  addPlayer(state: State, publicId: string, now: number, config: GameConfig): State;
  removePlayers(state: State, publicIds: string[]): State;
  startRound(state: State, goAt: number, config: GameConfig): State;
  applyInput(state: State, publicId: string, input: Input, now: number, config: GameConfig): State;
  /**
   * Есть только у живых режимов. Возвращает и то, что изменилось за тик: шаг и так это знает,
   * а сравнение полей до и после было бы лишним проходом по всем клеткам.
   */
  step?(state: State, now: number, config: GameConfig): { state: State; changes: TickChanges };
  finish(state: State, names: Record<string, string>): State;
}
```

- `RoomState.mode` выбирается при создании комнаты и не меняется. `modeState` становится
  объединением состояний режимов. `room/*` перестаёт импортировать кликер напрямую.
- Новая команда комнаты — `addBot` / `removeBot`, доступна только хосту и только в лобби.
- `TickChanges` — клетки, которые тик записал, каждая со значением после тика (0 — пусто; список
  «добавлено/освобождено» терял порядок, когда клетку занимали и освобождали за один тик), головы
  живых байков (слот, клетка, направление) и события тика. Комната пересылает их в `delta`, не
  заглядывая внутрь.
- `tick` с живым режимом вызывает `step` столько раз, сколько тиков задолжал накопитель (раздел 7).
- Ввод байков — `{ type: 'turn', side: 'left' | 'right' }` и `{ type: 'boost' }`. Token bucket
  настраивается для режима: 10 действий в секунду, запас 4.
- Предел участников режима — 20, вместе с ботами.

## 6. Протокол

Новые типы сообщений. Старые не ломаются, поэтому `v` остаётся `1`. *(Superseded: the protocol moved to version 2 — see "Decisions made while building plan 7".)*

- **`full`** — всё состояние раунда: сторона поля, байки (слот, публичный id, голова, направление,
  хвост списком клеток, резина, рывок), счёт. Шлётся при входе, переподключении и по запросу
  клиента, который заметил разрыв в номерах тиков.
- **`delta`** — каждый тик, **одна строка на всю комнату**: номер тика `t`; новые клетки
  `[cell, slot]`; освобождённые клетки; события (`died`, `killed`, `respawned`, `boost`).
- Клиент проверяет, что `t` идёт подряд. Разрыв — запрос `full`. Сам WebSocket упорядочен и надёжен:
  в прототипе на 20 сокетах пропусков не было.
- Бюджет по прототипу: ~234 Б на дельту, 4,6 КБ/с на игрока, ~91 КБ/с из комнаты при 20 участниках.

## 7. Сервер (`apps/game/src/worker/room.ts`)

- Пока раунд живого режима идёт, таймер `setInterval(tickMs)` **только будит** комнату. Сколько
  шагов сделать, решает накопитель: `while (now >= next) { run tick; next += tickMs }`. Прототип
  показал, что таймер ошибается в обе стороны: локальный workerd опаздывает на 1–2 мс за период (шаг
  на пробуждение терял 2–5 % тиков), а в проде таймер иногда будит раньше срока. Накопитель дал
  ровно ожидаемое число шагов в обоих случаях.
- Нагон после паузы ограничен 10 шагами. Если долг больше, лишнее время пропускается, а не
  догоняется пачкой — урок ошибки Armagetron #321694 про неограниченную поправку.
- Дельта собирается и рассылается один раз за шаг. В хранилище на тик ничего не пишется.
- Таймер гаснет вместе с раундом, и комната снова может уснуть.

## 8. Клиент

### Сцена

- Чёрный пол с неоновой сеткой, края поля — светящаяся стена.
- **Следы — `InstancedMesh`**, по одному инстансу на клетку хвоста. Слот инстанса совпадает с
  индексом кольцевого буфера хвоста, поэтому дельта обновляет ровно те инстансы, что изменились, —
  без пересоздания и без аллокаций в кадре. Предел — 20 × 400 = 8000 инстансов.
- Байки — низкополигональные светящиеся модели из примитивов. Цвет из палитры слотов; свой байк
  ярче остальных.
- Свечение — bloom-проход постобработки. Если он съедает fps на M2 по замеру, его ослабляем.

### Камера

За спиной своего байка, с затуханием, как сейчас в гонке (`MathUtils.damp`). На повороте плавно
доворачивается. Пока ждёшь респауна — смотрит на того, кто тебя сбил.

### Интерполяция

Клиент рисует мир на 100 мс в прошлом, между двумя полученными тиками. Пачка дельт после паузы
сервера не даёт рывка, а плавно нагоняется. Свой байк интерполируется так же: предсказания в этой
версии нет.

### HUD и лидерборд

- Таймер раунда, свои убийства и смерти, кольцо перезарядки рывка, полоска резины.
- Лента событий: «A срезал B».
- Живой топ-5 в углу. Полная таблица — на экране результатов.
- В лобби: выбор режима при создании комнаты, кнопки хоста «+ бот» и «− бот».

### Звук

- **Процедурный синтвейв на WebAudio**: бас-арпеджио на пиле через фильтр, 120 BPM. Последние
  30 секунд раунда темп растёт. Килобайты кода вместо мегабайтов файлов.
- Синтезированные эффекты: поворот, рывок, взрыв.
- Кнопка «звук» — состояние в `localStorage`.

### Ввод

A/D или ←/→ — поворот, пробел — рывок. `event.repeat` игнорируется, как в кликере.

## 9. Ошибки и крайние случаи

- Игрок вышел посреди раунда — байк гибнет без виновника, слот освобождается в конце раунда.
- Переподключение в течение отведённого времени — тот же слот, клиент получает `full`.
- Респаун, когда свободных клеток нет: возрождение откладывается до следующего тика.
- Все люди вышли, остались только боты — раунд завершается досрочно.
- Сообщения с неизвестным полем или неправильным типом отвергаются парсером протокола, как сейчас.

## 10. Тестирование

- **Правила** — юнит-тесты на каждое правило тика: встречное движение, две головы в одной клетке,
  езда за хвостом впритык, резина спасает и кончается, виновник смерти, рывок через два подшага,
  разворот без самоубийства.
- **Детерминизм** — один и тот же набор вводов, проигранный дважды, даёт бит в бит одинаковое
  состояние; перестановка порядка игроков в состоянии результат не меняет.
- **Асимптотика** (`complexity.ts`) — шаг O(клеток + игроков); решение бота не растёт с размером
  поля; респаун O(клеток).
- **Чистота** — скан расширяется на трансцендентные функции (`Math.sin`, `cos`, `atan2`, `exp`,
  `pow`) в `modes/cycles`.
- **Боты** — бот на пустом поле живёт до конца раунда; два бота сами доигрывают раунд без ошибок.
- **Сервер** — интеграционный тест в workerd: тик идёт, дельты подряд, `full` при входе.
- **Сквозной** — один браузер против ботов: войти, выбрать режим, добавить ботов, сыграть раунд,
  увидеть таблицу.
- **Глазами** — снимки сцены на 2 и 20 участниках, как для гонки.
- Каждый новый тест сначала проверяется на неисправном коде: он должен упасть.

## 11. Риски

- ~~Тик на настоящем Cloudflare не проверен~~ — проверен 2026-10-10 на временном аккаунте: 600 из
  600 шагов на 20 Гц, интервал таймера ровно 50 мс; разрывы до 180 мс у клиента — это сеть
  (план 5, этап 2).
- **Без предсказания поворот ощущается с задержкой** в RTT плюс до одного тика. Резина прощает
  смерти, но не ощущение. Меряем на живой игре; если мешает — этап 4.
- **Bloom на слабых ноутбуках.** Включаем по замеру.
- Объём: спецификация разворачивается в несколько планов — правила и боты; комната, тик и
  протокол; клиент и оформление.

## Decisions made while building plan 7

Recorded in English from here on; the sections above stay as written.

- **The host picks the mode in the lobby** with `setMode`, rather than when the room is created:
  rooms are created by a link. Switching recreates the mode state and reseats every player;
  switching from results returns the room to the lobby; a mode whose player limit is below the
  head count refuses with `room_full`.
- **Bots exist only in the light cycles.** Elsewhere `addBot` answers `not_supported`. A bot is a
  room player with no connection and is never expired.
- **`full` carries each bike's trail as a list of cells**, oldest first, instead of the field. It is
  sent after `welcome` once a round has started — during the countdown too, since the bikes are
  already placed — and on `resync`.
- **`delta` carries each changed cell's final value** (`cells`), the living bikes' heads (`heads`)
  and events. Two lists of added and freed cells could not be replayed: within one tick a cell can
  be both (plan 6 review, finding A). A client applies only deltas with `t` above the `full` it
  started from — `broadcast` reaches a connection before its own `join` has been answered.
- **No token bucket for the light cycles**: a queue of two turns and the boost cooldown bound what
  input can change.
- **Leaving and coming back go through the mode.** A bike whose player leaves is taken off by the
  next tick, so its cells reach clients through `delta`; a player who rejoins gets the bike back
  after the respawn wait. This applies from the countdown on.
- **Round length is code, not deployment config.** `wrangler.jsonc` no longer sets `ROUND_MS` or
  `COUNTDOWN_MS`; when the environment does set them — tests do — they override every mode.
- **The protocol version is 2, not 1** (supersedes "`v` stays `1`" in section 6). `players[]` in the
  snapshot gained a required `bot`, and the schemas are strict, so a tab running the old client
  would reject every new snapshot and show nothing. A version-1 message is now answered with
  `bad_version`, which sends the tab to reload. Players stored by an older build lack the flag;
  `syncConnections` (run whenever the object starts) turns it into `false`.
- **`full` also goes to everyone, unasked, at two moments.** When a round enters the countdown (slots
  are renumbered for every round, so no client already in the room could know them), right after
  the snapshot that announces it; and whenever a bike joins mid-round (a new slot appeared), in the
  same step as the newcomer's `welcome`. Both are one string built for the room, not per connection.
- **A living round with no person connected ends after a grace, not at once.** `desertedGraceMs`
  (10 s by default) counts from the moment the last person's connection closed; any person coming
  back inside it keeps the round going. Ending at the first step would have turned every network
  blip of a solo player into a finished round, long before the socket could reconnect. No alarm is
  needed for it: the ticker runs `advance` every step while the round runs.
- **`resync` is bounded.** A connection is answered at most once a second (the time is kept in the
  object's memory, not in storage; a request inside the window is dropped without an error), and
  the `full` string is built once per state: the cache is keyed on the mode's state object, which
  the rules replace on every change, so the same string serves the broadcasts and every `resync`
  until the next tick or bike change.
- **Each entry of `heads` is five numbers**, not three: slot, head cell, direction, rubber left,
  boost cooldown left. The client knows no rules, so after `full` it could not otherwise know
  either of the last two for the HUD.
- **A snapshot's `data` is tied to its `mode`.** The schema is a variant on `mode`: a light-cycle
  snapshot carrying clicker scores (or the reverse) no longer parses, and the type of `data`
  narrows on `mode` alone.

## Decisions made while building plan 8

- **Speed is a room setting.** The owner found 20 cells a second too fast to react to behind a
  chase camera; the default is now 8 and the host chooses among 8, 12, 16 and 20 in the lobby or
  on the results screen with `setSpeed` (host only; `not_supported` outside the light cycles,
  `wrong_phase` in a round). It lives in `RoomState`, not in the mode, so it survives a trip
  through the clicker; a stored room without it reads as 8. This supersedes the 50 ms tick of
  section 4: one cell per tick, so `tickMs = 1000 / speed`, and the worker recomputes its config
  when the speed changes exactly as it does when the mode changes.
- **Durations are designed in seconds**, then converted to ticks for the speed: a boost lasts one
  second, its cooldown four, a respawn two, and a unit of rubber regrows in one, at any speed.
  Rubber itself stays three ticks: it forgives latency, and a slower tick forgives more.
  `CYCLES_CONFIG` stays the 20-cells-a-second config (`cyclesConfigFor(20)` equals it).
- **The wire carries the pace.** `full` gains `tickMs` (the client places ticks in time with it),
  and the light-cycle snapshot's `data` gains `speed`. The protocol version stays 2: the light
  cycles have not been released, so no client of that version exists to be turned away.

## Measuring turn latency (2026-10-19)

The owner felt a delay between pressing a turn and seeing it. Before choosing a fix, the arena shows
a readout under the top bar (the `L` key hides it): how many cells late a turn lands compared with
where the player saw their bike when pressing, how long the turn took to reach the server, and how
long until the screen showed it, each with a median of the last ten. Locally, at 8 cells a second,
a turn lands about 0.8 cells late (up to 1.4); the number equals the screen time times the speed,
and each extra 100 ms of round trip adds about 0.8 cells at that speed. The decision on
client-side prediction is taken from these numbers measured over a real network.
