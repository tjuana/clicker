# Platform Seams Implementation Plan (план 4: одна база — много игр)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Развести общую комнату и конкретную игру так, чтобы второй режим — тест на реакцию, змейка, что угодно — добавлялся, не ломая ни протокол, ни клиент.

**Architecture:** `packages/game` делится на `room/` (игроки, хост, фазы, время, сроки) и `modes/clicker/` (ввод, ведро токенов, итоги). Комната зовёт режим через одну точку входа и не знает слова «клик». В протоколе появляется версия, обобщённый `input`, слот `data` для данных режима и отдельное личное сообщение. Реестра режимов нет и не будет, пока не появится второй: интерфейс выводится из двух реализаций, а не из одной.

**Tech Stack:** без новых зависимостей. TypeScript 7.0.2, Vitest 4.1.11, valibot 1.5.0.

Спецификация: [2026-09-11-clicker-foundation-design.md](../specs/2026-09-11-clicker-foundation-design.md), разделы 3, 5, 6, 7.

---

## Проверено перед написанием плана

Задачи 1–3 собраны и прогнаны во временной папке целиком: `tsc --noEmit` без ошибок, 60 тестов в `packages/game`, 32 в `packages/protocol` (31 перенесённый плюс новый на версию), Biome чист. Весь код этих задач приведён ниже дословно из рабочего прототипа.

Две находки оттуда, обе стоили бы дорого:

1. **Ссылочное равенство состояния — это контракт, а не случайность.** Отбитый лимитом клик обязан вернуть тот же самый объект комнаты: на этом держится дешёвая проверка «ничего не изменилось, снимок можно не рассылать». Первая версия перекладки его потеряла, и перенесённый тест это поймал.
2. **Ключ данных режима — `publicId`, а не секретный `playerId`.** Иначе счёт пришлось бы перекладывать при каждой сборке снимка, а секрет — таскать через слой, которому он не нужен.

**Чего прототип не проверял:** задачи 4 и 5 — сервер и клиент. Их код выведен из проверенного, но не исполнялся. Гейт для них — 15 интеграционных тестов сервера в настоящем рантайме Workers и сборка клиента.

## Как выполнять

- Ветка `feat/platform-seams`.
- Один таск — один коммит. Conventional Commits, английский, **без подписей Claude**.
- Перед каждым коммитом: `pnpm format`, затем `pnpm check`, `pnpm typecheck`, `pnpm test`.
- Задачи 1–3 идут подряд: между ними репозиторий не собирается, это нормально — они одна перекладка, разбитая для обозримости. Зелёным всё становится в конце задачи 3.

---

### Task 1: Разделить правила на комнату и режим

**Files:**
- Create: `packages/game/src/room/{state,commands,config,advance,apply,deadline,recovery}.ts`, `packages/game/src/modes/clicker/{state,results,index}.ts`
- Delete: `packages/game/src/{state,commands,config,advance,apply,deadline,recovery,results}.ts`
- Modify: `packages/game/src/index.ts`

- [ ] **Step 1: Создать `packages/game/src/modes/clicker/state.ts`**

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

- [ ] **Step 2: Создать `packages/game/src/modes/clicker/results.ts`**

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

- [ ] **Step 3: Создать `packages/game/src/room/config.ts`**

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

- [ ] **Step 4: Создать `packages/game/src/room/state.ts`**

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

- [ ] **Step 5: Создать `packages/game/src/room/commands.ts`**

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

- [ ] **Step 6: Создать `packages/game/src/modes/clicker/index.ts`** — единственная дверь между комнатой и игрой

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

- [ ] **Step 7: Создать `packages/game/src/room/advance.ts`**

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

- [ ] **Step 8: Создать `packages/game/src/room/apply.ts`**

Обрати внимание на конец `input`: при отбитом клике возвращается тот же объект состояния. Это контракт, а не мелочь.

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

- [ ] **Step 9: Создать `packages/game/src/room/deadline.ts`**

Содержимое прежнее, меняются только импорты: `./config` и `./state` теперь лежат рядом, а условие про соединения читает `connectionIds.length === 0`.

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

- [ ] **Step 10: Создать `packages/game/src/room/recovery.ts`**

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

- [ ] **Step 11: Заменить `packages/game/src/index.ts`**

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

- [ ] **Step 12: Удалить старые плоские файлы**

```bash
git rm packages/game/src/{state,commands,config,advance,apply,deadline,recovery,results}.ts
```

- [ ] **Step 13: Убедиться, что исходники компилируются**

Run: `pnpm --filter @clicker/game exec tsc --noEmit`
Expected: ошибки **только** в `test/` — это устаревшие пути импорта, их чинит Task 3. В `src/` ошибок быть не должно; если они есть, останавливайся и разбирайся, дальше идти нельзя.

- [ ] **Step 14: Закоммитить**

```bash
git add packages/game/src
git commit -m "refactor(game): split the rules into a room and a game mode"
```

---

### Task 2: Протокол — версия, обобщённый ввод, слот режима

**Files:**
- Modify: `packages/protocol/src/client.ts`, `packages/protocol/src/server.ts`, `packages/protocol/src/index.ts`

- [ ] **Step 1: Заменить `packages/protocol/src/client.ts`**

**Важно:** `FORBIDDEN_NAME_CHARS` и весь `nameSchema` переносятся из текущего файла как есть — их правка в эту задачу не входит. В блоке ниже невидимые символы диапазонов могли исказиться при копировании; верная форма строки ровно та, что уже лежит в репозитории:

```ts
const FORBIDDEN_NAME_CHARS = /[\p{Cc}‪-‮⁦-⁩]/u;
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
const FORBIDDEN_NAME_CHARS = /[\p{Cc}‪-‮⁦-⁩]/u;

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

- [ ] **Step 2: Заменить `packages/protocol/src/server.ts`**

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

- [ ] **Step 3: Заменить `packages/protocol/src/index.ts`**

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

- [ ] **Step 4: Проверить компиляцию исходников**

Run: `pnpm --filter @clicker/protocol exec tsc --noEmit`
Expected: ошибки только в `test/`.

- [ ] **Step 5: Закоммитить**

```bash
git add packages/protocol/src
git commit -m "feat(protocol): add a version, a generic input and a slot for mode data"
```

---

### Task 3: Перенести тесты

**Files:**
- Modify: все файлы в `packages/game/test` и `packages/protocol/test`

Это перенос, а не переписывание: смысл каждой проверки сохраняется, меняется только форма. Ни одного теста не удалять и не ослаблять.

- [ ] **Step 1: Заменить `packages/game/test/support.ts`**

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

- [ ] **Step 2: Обновить пути импорта во всех тестах**

| Было | Стало |
|---|---|
| `../src/apply` | `../src/room/apply` |
| `../src/advance` | `../src/room/advance` |
| `../src/state` | `../src/room/state` |
| `../src/config` | `../src/room/config` |
| `../src/deadline` | `../src/room/deadline` |
| `../src/recovery` | `../src/room/recovery` |
| `../src/results` | `../src/modes/clicker/results` |

Файлы `leave.test.ts`, `deadline.test.ts` и `ids.test.ts` этим и ограничиваются — больше в них менять нечего.

- [ ] **Step 3: Перевести команды и обращения к счёту**

Во всех тестах `packages/game/test`:

- Команда `{ type: 'click', playerId: 'secret-1' }` → `{ type: 'input', playerId: 'secret-1', input: { type: 'click' } }`.
- Обращения `state.players['secret-1']?.clicks` и `?.lastCountedAt` → `state.modeState.scores['1']?.clicks` и `?.lastCountedAt`. Ключ `'1'` — это `publicId` первого вошедшего игрока, он детерминирован.
- `state.results` → `state.modeState.results`.
- В `join.test.ts` поле `clicks: 0` больше не может лежать внутри `toMatchObject` по игроку: вынеси его отдельной проверкой на `result.state.modeState.scores['1']?.clicks`.
- В `start.test.ts` «грязный» счёт перед раундом (`clicks: 42`, `lastCountedAt: 900`) строится в `modeState.scores['1']`, а `results: []` — в `modeState.results`.
- В `advance.test.ts` фикстура отсчёта должна завести счёт игроку: `modeState: { scores: { '1': score() }, results: null }`, иначе итоги считать не из чего.
- В `recovery.test.ts` комната в фазе результатов строится с `modeState: { scores: {}, results: [...] }`.

- [ ] **Step 4: Заменить два файла целиком**

У этих двух сменилась не форма записи, а сигнатура проверяемого, поэтому они приводятся дословно, а не правилами замены.

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

`packages/game/test/results.test.ts` — `computeResults(scores, names)` принимает две записи, обе с ключом `publicId`:

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

`click.test.ts` имя сохраняет: он и проверяет клик — теперь как ввод режима.

- [ ] **Step 5: Обновить тесты протокола**

- Каждому сообщению добавить `v: PROTOCOL_VERSION`.
- `{ type: 'click' }` → `{ type: 'input', input: { type: 'click' } }`.
- `parseClientMessage` теперь возвращает результат: `expect(...).toBeNull()` → `expect(...).toEqual({ ok: false, reason: 'invalid_message' })`, а удачный разбор → `{ ok: true, message: {...} }`.
- `snapshot.results` → `snapshot.data.results`.
- **Добавить новый тест:** сообщение с `v: 2` даёт `{ ok: false, reason: 'bad_version' }`. Ради этого поля всё и затевалось.

- [ ] **Step 6: Прогнать и сверить пофайлово**

```bash
pnpm --filter @clicker/game test
pnpm --filter @clicker/protocol test
pnpm typecheck
```

Общего числа мало: перенос легко «проходит», потеряв пару проверок. Сверяй пофайлово — числа те же, что были до переноса, кроме `client.test.ts`, где прибавился тест на версию:

| Файл | Тестов |
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
| **game — всего** | **60** |
| `protocol/test/client.test.ts` | 20 |
| `protocol/test/ids.test.ts` | 4 |
| `protocol/test/server.test.ts` | 8 |
| **protocol — всего** | **32** |

Не сходится хоть одна строка — ищи потерянный тест, а не подгоняй итог. Проверка типов при этом молчит.

- [ ] **Step 7: Закоммитить**

```bash
pnpm format
git add packages
git commit -m "test: port the suites to the room and mode layout"
```

---

### Task 4: Сервер под новый протокол

**Files:**
- Modify: `apps/game/src/worker/room.ts`

Код этой задачи выведен из проверенного, но в прототипе не исполнялся. Гейт — 15 интеграционных тестов в настоящем рантайме Workers.

- [ ] **Step 1: Импортировать версию протокола**

Строка 13, добавить `PROTOCOL_VERSION`:

```ts
import { PROTOCOL_VERSION, parseClientMessage, type ServerMessage, toSnapshot } from '@clicker/protocol';
```

- [ ] **Step 2: Обновить разбор сообщения в `onMessage`**

`parseClientMessage` больше не возвращает `null`, а различает мусор и чужую версию. Строки 65–74 целиком:

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

- [ ] **Step 3: Переименовать `parsed` в ветке join**

Строки 76–95 обращаются к разобранному сообщению как `parsed`; теперь оно называется `incoming`. Заменить `parsed.type`, `parsed.playerId`, `parsed.name` и оба `parsed.hostKey` — сама логика ветки не меняется.

- [ ] **Step 4: Перевести хвост `onMessage` на `input`**

Строки 97–103 сейчас перебрасывают `start` и `click` одной строкой, потому что у обоих одна форма. У `input` есть полезная нагрузка, поэтому ветки расходятся:

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

- [ ] **Step 5: Поправить условие записи в хранилище**

Строки 141–145. Это то самое место, где раньше терялся результат раунда: клик, закрывший раунд, не сохранялся. Условие обязано остаться таким же по смыслу — просто команда теперь зовётся иначе. Если оставить `'click'`, TypeScript промолчит (сравнение с литералом, которого нет в объединении, он не ловит), а раунд снова начнёт пропадать после перезапуска:

```ts
    // An input can also close the round: advance runs before every command.
    // We skip persisting only for inputs that merely bumped the score.
    if (phaseChanged || command.type !== 'input') {
      await this.#persist();
    }
```

- [ ] **Step 6: Добавить версию в исходящие сообщения `#handleEvent`**

Строки 156–165:

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

Снимок трогать не нужно: `toSnapshot` проставляет версию сам.

- [ ] **Step 7: Прогнать тесты сервера**

Run: `pnpm --filter @clicker/app test`
Expected: `Test Files 2 passed (2)`, `Tests 15 passed (15)`. Тесты сервера строят сообщения сами — если они падают на отсутствии `v`, поправь тесты: это часть той же смены формата.

- [ ] **Step 5: Закоммитить**

```bash
pnpm format
git add apps/game
git commit -m "feat(server): speak the versioned protocol with generic input"
```

---

### Task 5: Клиент под новый протокол

**Files:**
- Modify: `apps/game/src/client/net.ts`, `apps/game/src/client/store.ts`

- [ ] **Step 1: Импортировать версию протокола в `net.ts`**

Строка 1:

```ts
import { PROTOCOL_VERSION, parseServerMessage } from '@clicker/protocol';
```

- [ ] **Step 2: Добавить версию и обобщённый ввод в `net.ts`**

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

и в возвращаемом объекте:

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

- [ ] **Step 2: Ничего не менять в `store.ts`, кроме типа ошибки**

`ServerErrorCode` теперь включает `bad_version`; отдельной правки не требуется, но убедись, что `pnpm --filter @clicker/app typecheck` проходит.

- [ ] **Step 3: Проверить**

```bash
pnpm --filter @clicker/app typecheck
pnpm --filter @clicker/app run build
```

- [ ] **Step 4: Закоммитить**

```bash
pnpm format
git add apps/game
git commit -m "feat(app): send versioned messages and generic input"
```

---

### Task 6: Общая проверка

- [ ] **Step 1: Прогнать всё**

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
pnpm --filter @clicker/app run build
```
Expected: линтер и типы чисты, 60 + 32 + 15 = 107 тестов, обе части сборки на месте.

- [ ] **Step 2: Сверить со спецификацией**

Разделы 3, 5, 6 и 7 описывают ровно то, что теперь в коде: режим как поле комнаты, состояние режима в отдельном слоте, обобщённый ввод, версия протокола, личное сообщение и тик симуляции в конфиге. Личное сообщение и тик пока никем не используются — это заложенные швы, и так и задумано.

- [ ] **Step 3: Закоммитить, если формат что-то поправил**

```bash
git add -A && git commit -m "style: apply formatting after the seams"
```

---

## Проверка результата

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm --filter @clicker/app run build
```

Ожидается: 107 тестов, ноль падений, обе части сборки.

Главный признак, что швы получились: в `packages/game/src/room/` не встречается ни слова о кликах, а в `apps/game/src/worker/room.ts` — ни одного `if` про игровые правила.

## Что дальше

С этими швами второй режим — тест на реакцию или змейка — добавляется, не трогая ни комнату, ни протокол: новый каталог в `modes/`, своя схема ввода и данных, своя арена на клиенте. Тогда же появятся и настоящий интерфейс режима, и реестр — выведенные из двух реализаций.
