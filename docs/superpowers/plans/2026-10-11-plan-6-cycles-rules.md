# Light-Cycle Rules and Bots Implementation Plan (план 6: правила и боты байков)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Правила режима «Неоновые байки» и боты — чистые функции в `packages/game/src/modes/cycles`, покрытые тестами правил, детерминизма, асимптотики и чистоты.

**Architecture:** Поле — `Uint16Array` клеток, в клетке номер слота владельца. Хвост — кольцевой буфер фиксированной ёмкости. Тик одновременный: судьба каждого байка решается по полю до хода, итерацией до неподвижной точки. Иммутабельность снаружи — тик копирует поле и хвосты и пишет только в копии. Боты — часть правил, со сидированным ГПСЧ. Комната, протокол и интерфейс режимов — план 7; здесь режим ещё не подключён к комнате.

**Tech Stack:** TypeScript 7.0.2, Vitest 4.1.11, Biome 2.5.13. Новых зависимостей нет.

Спецификация: [2026-10-10-light-cycles-design.md](../specs/2026-10-10-light-cycles-design.md), разделы 4 и 10. Дорожная карта: [план 5](2026-10-10-plan-5-roadmap-realtime-modes.md).

---

## Проверено перед написанием плана

Весь код ниже прогнан в черновой копии `packages/game`: 119 тестов зелёные, обе проверки типов, Biome. Каждый новый тест проверен намеренной поломкой — он падает.

Что нашлось по дороге и уже учтено в коде:

1. **Бот въезжал в стену при ничьей.** Когда впереди одна свободная клетка, а за ней стена, заливка из всех трёх вариантов упирается в один бюджет — ничья, побеждает «прямо». Теперь ничью решает длина свободного прогона, затем случайный выбор.
2. **Случайный поворот заводил бота в тупики** шириной в клетку: он проверял две клетки впереди, а не площадь за ними. Теперь он проходит ту же проверку площадью.
3. **Ничья всегда уходила «налево» и закручивала бота спиралью внутрь.** Разбивается ГПСЧ (выборка из резервуара по равным вариантам). Одиночный бот: было 2 смерти за раунд, стало около 0,7 на 30 сидах. Это не ноль — бот ещё сворачивается в плотные блоки; тест стоит как гейт от ухудшения.
4. **Старт раунда был O(игроков × клеток).** Каждый байк ставился полным поиском по полю, а клеток тем больше, чем больше игроков, — квадрат. Гейт на 1000 игроков упёрся в таймаут. Старт — равномерная решётка, O(n); поиск по полю остался только для респауна.
5. **Прокси подсчёта не работал с `Uint16Array`**: типизированный массив отказывается запускать свой геттер `length` на прокси. Исправлено в `complexity.ts` (задача 4).
6. **Гейт тика сначала пропустил скан**: в свежем раунде хвосты не полные, и ветка, где хвост уступает клетку, не выполнялась. Гейт гоняется с хвостами длиной 1.
7. `Object.freeze` не применим к типизированному массиву с элементами, поэтому `deepFreeze` из `support.ts` здесь не годится. Неизменность входа проверяется сравнением копий до и после шага.

Отступление от спецификации, раздел 4 «Смерть, очки, респаун»: на старте раунда байки ставятся решёткой, а не в «самую свободную точку» (находка 4). Длина хвоста после смерти сбрасывается к базовой — спецификация об этом молчала.

## Как выполнять

- Ветка `feat/cycles-rules` от `main`.
- Одна задача — один коммит. Conventional Commits, английский, **без подписей Claude**: никаких `Co-Authored-By`, «Generated with», эмодзи.
- Перед каждым коммитом:

```bash
pnpm format && pnpm check && pnpm typecheck && pnpm test
```

- Каждый новый тест сначала проверяется на неисправном коде: в задачах 3 и 4 перечислены поломки, которые тест обязан поймать.

## Файловая структура

```
packages/game/src/modes/cycles/
  random.ts      mulberry32: ГПСЧ на целых операциях, сид в состоянии
  config.ts      CyclesConfig — всё в тиках и клетках
  state.ts       типы: Bike, Trail, CyclesState, вход режима; направления DX/DY
  trail.ts       кольцевой буфер хвоста
  field.ts       размер поля, свободный прогон
  spawn.ts       расстояние до препятствий (многоисточниковый BFS), точка респауна
  bot.ts         решение бота: заливка с бюджетом
  step.ts        тик: подшаги, резина, смерть, респаун
  index.ts       API режима: игроки, старт раунда, ввод, выход, итоги
packages/game/test/
  cycles-support.ts         ручная сборка поля и проверка инвариантов
  cycles-random.test.ts     2 теста
  cycles-trail.test.ts      3 теста
  cycles-step.test.ts       18 тестов
  cycles-game.test.ts       11 тестов
  cycles-complexity.test.ts 4 теста
  complexity.ts             правка: прокси для типизированных массивов
  purity.test.ts            правка: запрет трансцендентных функций, раунд ботов под ловушками
```

Режим в этом плане не экспортируется из `packages/game/src/index.ts` — его подключает план 7.

---

### Task 1: Сидированный ГПСЧ

**Files:**
- Create: `packages/game/src/modes/cycles/random.ts`
- Test: `packages/game/test/cycles-random.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/game/test/cycles-random.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { random, randomBelow } from '../src/modes/cycles/random';

describe('the seeded generator', () => {
  it('draws the same sequence from the same seed', () => {
    const draw = (seed: number) => {
      const values: number[] = [];
      let current = seed;
      for (let i = 0; i < 5; i += 1) {
        const next = random(current);
        values.push(next.value);
        current = next.seed;
      }
      return values;
    };
    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(43));
  });

  it('stays in [0, 1) and spreads evenly enough to be fair', () => {
    const buckets = [0, 0, 0, 0];
    let seed = 1;
    for (let i = 0; i < 4000; i += 1) {
      const next = randomBelow(seed, 4);
      seed = next.seed;
      expect(next.value).toBeGreaterThanOrEqual(0);
      expect(next.value).toBeLessThan(4);
      buckets[next.value] = (buckets[next.value] ?? 0) + 1;
    }
    for (const count of buckets) expect(Math.abs(count - 1000)).toBeLessThan(120);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @clicker/game exec vitest run test/cycles-random.test.ts`
Expected: FAIL — `Failed to resolve import "../src/modes/cycles/random"`.

- [ ] **Step 3: Implement**

`packages/game/src/modes/cycles/random.ts`:

```ts
/**
 * mulberry32: a 32-bit generator built from multiplications and shifts alone.
 *
 * `Math.random` is banned in the rules, and for more than purity: the client will one day run
 * these same rules to predict its own bike, and only a generator made of integer operations is
 * guaranteed to produce the same sequence on every JavaScript engine. The seed lives in the
 * state, so a replay from the same state draws the same numbers.
 */
export function random(seed: number): { value: number; seed: number } {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), next | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next };
}

/** An integer in [0, bound). */
export function randomBelow(seed: number, bound: number): { value: number; seed: number } {
  const drawn = random(seed);
  return { value: Math.floor(drawn.value * bound), seed: drawn.seed };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @clicker/game exec vitest run test/cycles-random.test.ts`
Expected: `Tests  2 passed (2)`.

- [ ] **Step 5: Check and commit**

```bash
pnpm format && pnpm check && pnpm typecheck && pnpm test
```

```bash
git add packages/game/src/modes/cycles/random.ts packages/game/test/cycles-random.test.ts
git commit -m "feat(game): add a seeded generator for the light-cycle rules"
```

---

### Task 2: Состояние, кольцевой хвост, поле

**Files:**
- Create: `packages/game/src/modes/cycles/config.ts`, `state.ts`, `trail.ts`, `field.ts`
- Test: `packages/game/test/cycles-trail.test.ts`

Тест импортирует `cyclesConfig` из `cycles-support.ts`, а тот — модули задачи 3 не трогает, только `config`, `state` и `trail`. Поэтому `cycles-support.ts` создаётся здесь же.

- [ ] **Step 1: Write the failing tests**

`packages/game/test/cycles-support.ts`:

```ts
import { CYCLES_CONFIG, type CyclesConfig } from '../src/modes/cycles/config';
import type { Bike, CyclesState } from '../src/modes/cycles/state';
import { emptyTrail, forEachCell, pushNewest } from '../src/modes/cycles/trail';

export function cyclesConfig(overrides: Partial<CyclesConfig> = {}): CyclesConfig {
  return { ...CYCLES_CONFIG, ...overrides };
}

export interface BikeSpec {
  x: number;
  y: number;
  dir: number;
  /** Earlier cells of the trail, oldest first; the head is appended after them. */
  behind?: [number, number][];
  cap?: number;
  rubber?: number;
  bot?: boolean;
  turns?: ('left' | 'right')[];
}

/**
 * A hand-built field: the only honest way to stage a head-on collision or a tail chase at an
 * exact cell, which a random game would reach rarely and never on purpose.
 */
export function arena(side: number, specs: BikeSpec[], config = cyclesConfig()): CyclesState {
  const field = new Uint16Array(side * side);
  const bikes: Bike[] = specs.map((spec, position) => {
    const slot = position + 1;
    const trail = emptyTrail(config.trailMax);
    for (const [x, y] of [...(spec.behind ?? []), [spec.x, spec.y] as [number, number]]) {
      pushNewest(trail, y * side + x);
      field[y * side + x] = slot;
    }
    return {
      slot,
      publicId: String(slot),
      bot: spec.bot ?? false,
      alive: true,
      left: false,
      x: spec.x,
      y: spec.y,
      dir: spec.dir,
      trail,
      cap: spec.cap ?? config.trail,
      rubber: spec.rubber ?? config.rubber,
      regen: 0,
      boost: 0,
      cooldown: 0,
      turns: spec.turns ?? [],
      respawnIn: 0,
      kills: 0,
      deaths: 0,
      life: 0,
      longest: 0,
    };
  });
  const index: Record<string, number> = {};
  bikes.forEach((bike, position) => {
    index[bike.publicId] = position;
  });
  return { side, field, bikes, index, seed: 7, tick: 0, results: null };
}

export function trailOf(state: CyclesState, slot: number): [number, number][] {
  const bike = state.bikes[slot - 1];
  const cells: [number, number][] = [];
  if (bike === undefined) return cells;
  forEachCell(bike.trail, (cell) => cells.push([cell % state.side, Math.floor(cell / state.side)]));
  return cells;
}

/**
 * What must hold after every tick of every game: the field and the trails tell the same story.
 * Returns a description of the first contradiction, or null.
 */
export function contradiction(state: CyclesState): string | null {
  let owned = 0;
  for (const bike of state.bikes) {
    if (bike.trail.size > bike.cap && bike.alive) return `slot ${bike.slot}: trail longer than cap`;
    let broken: string | null = null;
    forEachCell(bike.trail, (cell) => {
      if (state.field[cell] !== bike.slot) broken = `slot ${bike.slot}: cell ${cell} not in field`;
    });
    if (broken !== null) return broken;
    owned += bike.trail.size;
    if (!bike.alive && bike.trail.size !== 0) return `slot ${bike.slot}: dead bike keeps a trail`;
    if (bike.alive) {
      const head = bike.y * state.side + bike.x;
      const newest =
        bike.trail.cells[(bike.trail.start + bike.trail.size - 1) % bike.trail.cells.length];
      if (head !== newest) return `slot ${bike.slot}: head is not the newest trail cell`;
    }
  }
  let occupied = 0;
  for (const cell of state.field) if (cell !== 0) occupied += 1;
  if (occupied !== owned) return `field has ${occupied} occupied cells, trails own ${owned}`;
  return null;
}
```

`packages/game/test/cycles-trail.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sideFor } from '../src/modes/cycles/field';
import {
  copyTrail,
  dropOldest,
  emptyTrail,
  forEachCell,
  oldestCell,
  pushNewest,
} from '../src/modes/cycles/trail';
import { cyclesConfig } from './cycles-support';

function cells(trail: ReturnType<typeof emptyTrail>): number[] {
  const out: number[] = [];
  forEachCell(trail, (cell) => out.push(cell));
  return out;
}

describe('the trail ring', () => {
  it('keeps cells oldest first across the wrap of its buffer', () => {
    const trail = emptyTrail(3);
    for (const cell of [10, 11, 12]) pushNewest(trail, cell);
    dropOldest(trail);
    pushNewest(trail, 13);
    expect(cells(trail)).toEqual([11, 12, 13]);
    expect(oldestCell(trail)).toBe(11);
  });

  it('copies into a buffer of its own', () => {
    const trail = emptyTrail(3);
    pushNewest(trail, 5);
    const copy = copyTrail(trail);
    pushNewest(copy, 6);
    expect(cells(trail)).toEqual([5]);
  });
});

describe('the field size', () => {
  it('gives every participant the same share of cells', () => {
    const config = cyclesConfig();
    expect(sideFor(20, config)).toBe(128);
    expect(sideFor(1, config)).toBe(config.minSide);
    const share = (n: number) => sideFor(n, config) ** 2 / n;
    expect(Math.abs(share(20) - share(10)) / share(20)).toBeLessThan(0.02);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @clicker/game exec vitest run test/cycles-trail.test.ts`
Expected: FAIL — `Failed to resolve import "../src/modes/cycles/field"`.

- [ ] **Step 3: Implement**

`packages/game/src/modes/cycles/config.ts`:

```ts
/** Everything here is counted in ticks or cells: the rules never see milliseconds. */
export interface CyclesConfig {
  /**
   * Field side per square root of the head count. Each participant gets k² cells whatever their
   * number, so four players and twenty find the field equally crowded.
   */
  sidePerRootPlayer: number;
  minSide: number;
  /** Trail length a bike starts every life with. */
  trail: number;
  /** The most a trail can grow to; also the ring buffer's capacity. */
  trailMax: number;
  /** Cells a trail gains for every rival that dies in it. */
  killBonus: number;
  /** Ticks a bike may stand against an obstacle before it dies. */
  rubber: number;
  /** Ticks of free movement that buy back one tick of rubber. */
  rubberRegenTicks: number;
  boostTicks: number;
  /** Counted from the moment a boost ends. */
  boostCooldownTicks: number;
  respawnTicks: number;
  /** Turns a player may queue ahead; one is spent per tick. */
  turnQueue: number;
  /** Cells a bot may flood-fill per option it weighs. */
  botBudget: number;
  /** A bot only thinks when an obstacle is closer than this. */
  botLookahead: number;
}

/** Tuned for a 20 Hz tick: the spec's seconds are these ticks divided by twenty. */
export const CYCLES_CONFIG: CyclesConfig = {
  sidePerRootPlayer: 28.6,
  minSide: 40,
  trail: 200,
  trailMax: 400,
  killBonus: 25,
  rubber: 3,
  rubberRegenTicks: 20,
  boostTicks: 20,
  boostCooldownTicks: 80,
  respawnTicks: 40,
  turnQueue: 2,
  botBudget: 256,
  botLookahead: 8,
};
```

`packages/game/src/modes/cycles/state.ts`:

```ts
/**
 * Directions, clockwise with y growing downwards: east, south, west, north. Turning is a step
 * around the compass, `(dir + 1) & 3` to the right and `(dir + 3) & 3` to the left.
 */
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export type Turn = 'left' | 'right';

export type CyclesInput = { type: 'turn'; side: Turn } | { type: 'boost' };

/**
 * A trail is a ring buffer over a fixed `Int32Array` of `trailMax` cells. The capacity never
 * changes: growing a trail after a kill only raises `cap`, so a cell keeps its index for its
 * whole life — which is what lets the client map trail cells to instances one to one.
 */
export interface Trail {
  cells: Int32Array;
  /** Index of the oldest cell. */
  start: number;
  size: number;
}

export interface Bike {
  /** 1…n. Written into the field, so it must stay small; never reused within a round. */
  slot: number;
  publicId: string;
  bot: boolean;
  alive: boolean;
  /** A player who left mid-round keeps the slot, dead, until the round ends. */
  left: boolean;
  x: number;
  y: number;
  dir: number;
  trail: Trail;
  /** How long the trail may grow in this life. */
  cap: number;
  rubber: number;
  /** Free ticks counted towards the next unit of rubber. */
  regen: number;
  boost: number;
  cooldown: number;
  turns: Turn[];
  respawnIn: number;
  kills: number;
  deaths: number;
  /** Ticks alive in the current life, and the best life so far. */
  life: number;
  longest: number;
}

export interface CyclesResultRow {
  publicId: string;
  name: string;
  kills: number;
  deaths: number;
  longest: number;
  rank: number;
}

export interface CyclesState {
  side: number;
  /** `0` is empty, otherwise the slot whose trail holds the cell. Index `y * side + x`. */
  field: Uint16Array;
  /** Ordered by slot. */
  bikes: Bike[];
  /** publicId → index into `bikes`: lookup by key, never a scan. */
  index: Record<string, number>;
  seed: number;
  tick: number;
  results: CyclesResultRow[] | null;
}

export function createCyclesState(seed: number): CyclesState {
  return {
    side: 0,
    field: new Uint16Array(0),
    bikes: [],
    index: {},
    seed,
    tick: 0,
    results: null,
  };
}
```

`packages/game/src/modes/cycles/trail.ts`:

```ts
import type { Trail } from './state';

export function emptyTrail(capacity: number): Trail {
  return { cells: new Int32Array(capacity), start: 0, size: 0 };
}

/** A copy the caller may write to: the step owns its copy, the previous state stays untouched. */
export function copyTrail(trail: Trail): Trail {
  return { cells: trail.cells.slice(), start: trail.start, size: trail.size };
}

export function oldestCell(trail: Trail): number {
  return trail.size === 0 ? -1 : (trail.cells[trail.start] ?? -1);
}

/** Drops the oldest cell of a trail the caller owns. O(1): the ring only moves its start. */
export function dropOldest(trail: Trail): void {
  if (trail.size === 0) return;
  trail.start = (trail.start + 1) % trail.cells.length;
  trail.size -= 1;
}

/** Appends the newest cell of a trail the caller owns. */
export function pushNewest(trail: Trail, cell: number): void {
  trail.cells[(trail.start + trail.size) % trail.cells.length] = cell;
  trail.size += 1;
}

export function forEachCell(trail: Trail, visit: (cell: number) => void): void {
  for (let offset = 0; offset < trail.size; offset += 1) {
    visit(trail.cells[(trail.start + offset) % trail.cells.length] ?? -1);
  }
}
```

`packages/game/src/modes/cycles/field.ts`:

```ts
import type { CyclesConfig } from './config';
import { DX, DY } from './state';

/** k·√n, so each participant gets k² cells. `Math.sqrt` is exactly rounded by IEEE 754. */
export function sideFor(participants: number, config: CyclesConfig): number {
  return Math.max(config.minSide, Math.round(config.sidePerRootPlayer * Math.sqrt(participants)));
}

/** Free cells straight ahead of (x, y) in `dir`, counting up to `limit`. */
export function freeRun(
  field: Uint16Array,
  side: number,
  x: number,
  y: number,
  dir: number,
  limit: number,
): number {
  const dx = DX[dir as 0] ?? 0;
  const dy = DY[dir as 0] ?? 0;
  let run = 0;
  let cx = x + dx;
  let cy = y + dy;
  while (
    run < limit &&
    cx >= 0 &&
    cy >= 0 &&
    cx < side &&
    cy < side &&
    field[cy * side + cx] === 0
  ) {
    run += 1;
    cx += dx;
    cy += dy;
  }
  return run;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @clicker/game exec vitest run test/cycles-trail.test.ts`
Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Check and commit**

```bash
pnpm format && pnpm check && pnpm typecheck && pnpm test
```

```bash
git add packages/game/src/modes/cycles/config.ts packages/game/src/modes/cycles/state.ts \
  packages/game/src/modes/cycles/trail.ts packages/game/src/modes/cycles/field.ts \
  packages/game/test/cycles-support.ts packages/game/test/cycles-trail.test.ts
git commit -m "feat(game): model the light-cycle field and ring-buffer trails"
```

---

### Task 3: Тик, респаун, боты и API режима

Одна логическая единица: тик вызывает бота и поиск респауна, тесты тика пользуются вводом из API. Разрезать их на отдельные коммиты — значит коммитить код, который не собирается.

**Files:**
- Create: `packages/game/src/modes/cycles/spawn.ts`, `bot.ts`, `step.ts`, `index.ts`
- Test: `packages/game/test/cycles-step.test.ts`, `packages/game/test/cycles-game.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/game/test/cycles-step.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyInput } from '../src/modes/cycles';
import type { CyclesState } from '../src/modes/cycles/state';
import { step } from '../src/modes/cycles/step';
import { arena, contradiction, cyclesConfig, trailOf } from './cycles-support';

const EAST = 0;
const SOUTH = 1;
const WEST = 2;

function run(state: CyclesState, ticks: number, config = cyclesConfig()): CyclesState {
  let current = state;
  for (let tick = 0; tick < ticks; tick += 1) current = step(current, config).state;
  return current;
}

describe('moving', () => {
  it('advances one cell a tick and leaves a trail behind', () => {
    const after = run(arena(10, [{ x: 2, y: 5, dir: EAST }]), 3);
    expect(trailOf(after, 1)).toEqual([
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ]);
    expect(contradiction(after)).toBeNull();
  });

  it('reports exactly the cells it changed', () => {
    const { changes } = step(
      arena(10, [{ x: 2, y: 5, dir: EAST, behind: [[1, 5]], cap: 2 }]),
      cyclesConfig(),
    );
    expect(changes.added).toEqual([5 * 10 + 3, 1]);
    expect(changes.freed).toEqual([5 * 10 + 1]);
  });

  it('never touches the state it was given', () => {
    const before = arena(10, [{ x: 2, y: 5, dir: EAST }]);
    const field = before.field.slice();
    const cells = before.bikes[0]?.trail.cells.slice();
    step(before, cyclesConfig());
    expect(before.field).toEqual(field);
    expect(before.bikes[0]?.trail.cells).toEqual(cells);
    expect(before.bikes[0]?.x).toBe(2);
  });
});

describe('turning', () => {
  it('turns right then left, one queued turn per tick', () => {
    const state = applyInput(
      applyInput(
        arena(10, [{ x: 2, y: 2, dir: EAST }]),
        '1',
        { type: 'turn', side: 'right' },
        cyclesConfig(),
      ),
      '1',
      { type: 'turn', side: 'left' },
      cyclesConfig(),
    );
    expect(trailOf(run(state, 2), 1)).toEqual([
      [2, 2],
      [2, 3],
      [3, 3],
    ]);
  });

  it('turns about in two ticks without riding into itself', () => {
    let state = arena(10, [
      {
        x: 5,
        y: 5,
        dir: EAST,
        behind: [
          [3, 5],
          [4, 5],
        ],
      },
    ]);
    state = applyInput(state, '1', { type: 'turn', side: 'right' }, cyclesConfig());
    state = applyInput(state, '1', { type: 'turn', side: 'right' }, cyclesConfig());
    const after = run(state, 3);
    expect(after.bikes[0]?.alive).toBe(true);
    expect(after.bikes[0]?.dir).toBe(WEST);
    expect([after.bikes[0]?.x, after.bikes[0]?.y]).toEqual([3, 6]);
  });

  it('drops a turn beyond the queue', () => {
    const config = cyclesConfig({ turnQueue: 1 });
    let state = arena(10, [{ x: 2, y: 2, dir: EAST }]);
    state = applyInput(state, '1', { type: 'turn', side: 'right' }, config);
    expect(applyInput(state, '1', { type: 'turn', side: 'left' }, config)).toBe(state);
  });
});

describe('trails', () => {
  it('lets go of the oldest cell once full', () => {
    const after = run(arena(10, [{ x: 2, y: 5, dir: EAST, cap: 2 }]), 3);
    expect(trailOf(after, 1)).toEqual([
      [4, 5],
      [5, 5],
    ]);
    expect(after.field[5 * 10 + 2]).toBe(0);
  });

  it('lets a bike ride into the cell a tail leaves on the same tick', () => {
    // Bike 2 heads east straight into bike 1's oldest cell, which bike 1 gives up as it moves.
    const state = arena(10, [
      { x: 4, y: 4, dir: SOUTH, behind: [[3, 4]], cap: 2 },
      { x: 2, y: 4, dir: EAST, rubber: 0 },
    ]);
    const after = step(state, cyclesConfig()).state;
    expect(after.bikes[1]?.alive).toBe(true);
    expect([after.bikes[1]?.x, after.bikes[1]?.y]).toEqual([3, 4]);
    expect(contradiction(after)).toBeNull();
  });

  it('blocks that cell when the tail cannot leave because its own bike is stuck', () => {
    // Bike 1 faces the wall, so it does not move and its tail stays where it is.
    const state = arena(10, [
      { x: 9, y: 4, dir: EAST, behind: [[8, 4]], cap: 2 },
      { x: 7, y: 4, dir: EAST },
    ]);
    const after = step(state, cyclesConfig()).state;
    expect([after.bikes[1]?.x, after.bikes[1]?.y]).toEqual([7, 4]);
    expect(after.bikes[1]?.rubber).toBe(cyclesConfig().rubber - 1);
  });
});

describe('collisions', () => {
  it('stops two bikes riding head-on instead of letting them pass through each other', () => {
    const state = arena(10, [
      { x: 4, y: 4, dir: EAST },
      { x: 5, y: 4, dir: WEST },
    ]);
    const after = step(state, cyclesConfig()).state;
    expect([after.bikes[0]?.x, after.bikes[1]?.x]).toEqual([4, 5]);
    expect(after.bikes.every((bike) => bike.alive)).toBe(true);
  });

  it('kills both bikes that reach the same cell together, crediting no one', () => {
    const state = arena(10, [
      { x: 3, y: 4, dir: EAST },
      { x: 5, y: 4, dir: WEST },
    ]);
    const { state: after, changes } = step(state, cyclesConfig());
    expect(after.bikes.map((bike) => bike.alive)).toEqual([false, false]);
    expect(changes.events).toEqual([
      { type: 'died', slot: 1, by: null },
      { type: 'died', slot: 2, by: null },
    ]);
    expect(contradiction(after)).toBeNull();
  });

  it('spends rubber against an obstacle and dies when it runs out', () => {
    const config = cyclesConfig({ rubber: 2 });
    const state = arena(10, [{ x: 9, y: 4, dir: EAST, rubber: 2 }], config);
    expect(run(state, 2, config).bikes[0]?.alive).toBe(true);
    expect(run(state, 3, config).bikes[0]?.alive).toBe(false);
  });

  it('survives an obstacle by turning while the rubber lasts', () => {
    let state = run(arena(10, [{ x: 9, y: 4, dir: EAST }]), 1);
    state = applyInput(state, '1', { type: 'turn', side: 'right' }, cyclesConfig());
    const after = run(state, 1);
    expect(after.bikes[0]?.alive).toBe(true);
    expect([after.bikes[0]?.x, after.bikes[0]?.y]).toEqual([9, 5]);
  });

  it('credits the owner of the trail with the kill and a longer trail', () => {
    const config = cyclesConfig({ rubber: 0 });
    const state = arena(
      10,
      [
        {
          x: 1,
          y: 1,
          dir: SOUTH,
          behind: [
            [5, 3],
            [5, 4],
            [5, 5],
          ],
          cap: 10,
        },
        { x: 4, y: 4, dir: EAST, rubber: 0 },
      ],
      config,
    );
    const { state: after, changes } = step(state, config);
    expect(changes.events).toContainEqual({ type: 'died', slot: 2, by: 1 });
    expect(after.bikes[0]?.kills).toBe(1);
    expect(after.bikes[0]?.cap).toBe(10 + config.killBonus);
  });

  it('credits no one for the wall or for a bike’s own trail', () => {
    const config = cyclesConfig({ rubber: 0 });
    const own = arena(10, [{ x: 4, y: 4, dir: EAST, behind: [[5, 4]] }], config);
    expect(step(own, config).changes.events).toEqual([{ type: 'died', slot: 1, by: null }]);
    const wall = arena(10, [{ x: 9, y: 4, dir: EAST }], config);
    expect(step(wall, config).changes.events).toEqual([{ type: 'died', slot: 1, by: null }]);
  });

  it('takes a dead bike’s trail off the field at once', () => {
    const config = cyclesConfig({ rubber: 0 });
    const after = step(
      arena(
        10,
        [
          {
            x: 9,
            y: 4,
            dir: EAST,
            behind: [
              [7, 4],
              [8, 4],
            ],
          },
        ],
        config,
      ),
      config,
    ).state;
    expect(after.field.every((cell) => cell === 0)).toBe(true);
    expect(contradiction(after)).toBeNull();
  });
});

describe('respawning', () => {
  it('brings a dead bike back after the wait, in the clearest spot of the field', () => {
    const config = cyclesConfig({ rubber: 0, respawnTicks: 3 });
    let state = step(arena(11, [{ x: 10, y: 5, dir: EAST }], config), config).state;
    expect(state.bikes[0]?.alive).toBe(false);
    state = run(state, 2, config);
    expect(state.bikes[0]?.alive).toBe(false);
    const { state: back, changes } = step(state, config);
    expect(changes.events).toContainEqual({ type: 'respawned', slot: 1 });
    // The first move of the tick happens straight after respawning, one cell from the centre.
    expect(Math.abs((back.bikes[0]?.x ?? 0) - 5) + Math.abs((back.bikes[0]?.y ?? 0) - 5)).toBe(1);
  });
});

describe('boost', () => {
  it('covers two cells a tick while it lasts, then waits out its cooldown', () => {
    const config = cyclesConfig({ boostTicks: 2, boostCooldownTicks: 3 });
    let state = applyInput(
      arena(30, [{ x: 1, y: 5, dir: EAST }], config),
      '1',
      { type: 'boost' },
      config,
    );
    state = run(state, 2, config);
    expect(state.bikes[0]?.x).toBe(5);
    state = run(state, 1, config);
    expect(state.bikes[0]?.x).toBe(6);
    expect(applyInput(state, '1', { type: 'boost' }, config)).toBe(state);
    state = run(state, 2, config);
    expect(applyInput(state, '1', { type: 'boost' }, config)).not.toBe(state);
  });
});
```

`packages/game/test/cycles-game.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addPlayer, createCyclesState, finish, leave, startRound } from '../src/modes/cycles';
import { decide, room } from '../src/modes/cycles/bot';
import { clearance, pickSpawn } from '../src/modes/cycles/spawn';
import type { CyclesState } from '../src/modes/cycles/state';
import { step } from '../src/modes/cycles/step';
import { arena, contradiction, cyclesConfig } from './cycles-support';

const config = cyclesConfig();

/** A round of nothing but bots, the way a lone player tests the mode. */
function botRound(bots: number, seed: number): CyclesState {
  let state = createCyclesState(seed);
  for (let index = 0; index < bots; index += 1)
    state = addPlayer(state, `bot-${index}`, true, config);
  return startRound(state, config);
}

function play(
  state: CyclesState,
  ticks: number,
  check?: (state: CyclesState) => void,
): CyclesState {
  let current = state;
  for (let tick = 0; tick < ticks; tick += 1) {
    current = step(current, config).state;
    check?.(current);
  }
  return current;
}

describe('clearance', () => {
  it('measures the distance to the nearest trail or edge', () => {
    const field = new Uint16Array(25);
    field[2 * 5 + 2] = 1;
    const distance = clearance(field, 5);
    expect(distance[2 * 5 + 2]).toBe(0);
    expect(distance[2 * 5 + 3]).toBe(1);
    expect(distance[0]).toBe(1);
    expect(distance[1 * 5 + 1]).toBe(2);
  });

  it('chooses the centre of an empty field and gives up on a full one', () => {
    expect(pickSpawn(new Uint16Array(121), 11, 1).spot).toMatchObject({ x: 5, y: 5 });
    expect(pickSpawn(new Uint16Array(9).fill(1), 3, 1).spot).toBeNull();
  });
});

describe('the round', () => {
  it('sizes the field for the head count and places everyone apart', () => {
    const state = botRound(20, 3);
    expect(state.side).toBe(128);
    expect(state.bikes.every((bike) => bike.alive)).toBe(true);
    expect(contradiction(state)).toBeNull();
  });

  it('keeps field and trails consistent through whole games', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      play(botRound(2 + (seed % 7), seed), 600, (state) => {
        const broken = contradiction(state);
        if (broken !== null) throw new Error(`seed ${seed}, tick ${state.tick}: ${broken}`);
      });
    }
  });

  it('replays to the same bit from the same state', () => {
    const a = play(botRound(8, 42), 500);
    const b = play(botRound(8, 42), 500);
    expect(Array.from(a.field)).toEqual(Array.from(b.field));
    expect(a.bikes.map((bike) => [bike.x, bike.y, bike.kills, bike.deaths])).toEqual(
      b.bikes.map((bike) => [bike.x, bike.y, bike.kills, bike.deaths]),
    );
    expect(a.seed).toBe(b.seed);
  });

  it('ranks by kills, then fewest deaths, then the longest life', () => {
    let state = botRound(3, 5);
    state = {
      ...state,
      bikes: state.bikes.map((bike, position) => ({
        ...bike,
        kills: [2, 2, 1][position] ?? 0,
        deaths: [3, 1, 0][position] ?? 0,
      })),
    };
    const results = finish(state, {}).results ?? [];
    expect(results.map((row) => row.publicId)).toEqual(['bot-1', 'bot-0', 'bot-2']);
    expect(results.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('takes a leaver’s bike off the field without crediting anyone', () => {
    const state = leave(botRound(2, 9), 'bot-0');
    expect(state.bikes[0]?.alive).toBe(false);
    expect(state.bikes[0]?.left).toBe(true);
    expect(contradiction(play(state, 100))).toBeNull();
    expect(play(state, 100).bikes[0]?.alive).toBe(false);
  });
});

describe('bots', () => {
  it('turns away from a wall rather than into it', () => {
    const state = arena(20, [{ x: 18, y: 10, dir: 0, bot: true }]);
    const bike = state.bikes[0];
    if (bike === undefined) throw new Error('no bike');
    expect(decide(state.field, state.side, bike, config, 1).turn).not.toBeNull();
  });

  it('picks the side with more room', () => {
    // A wall of trail just below: turning right (south) leads into a pocket of one row.
    const behind: [number, number][] = [];
    for (let x = 0; x < 12; x += 1) behind.push([x, 12]);
    const state = arena(20, [{ x: 12, y: 11, dir: 0, behind, bot: true, cap: 50 }]);
    const bike = state.bikes[0];
    if (bike === undefined) throw new Error('no bike');
    const field = state.field.slice();
    for (let x = 13; x < 20; x += 1) field[11 * 20 + x] = 9; // block ahead
    expect(decide(field, 20, bike, config, 1).turn).toBe('left');
  });

  it('stops counting room at its budget', () => {
    expect(room(new Uint16Array(100 * 100), 100, 5050, 256)).toBe(256);
  });

  /**
   * A regression gate, not a promise of perfection: over thirty seeds a lone bot averaged 0.7
   * deaths a round when this was written. It still coils itself into tight blocks now and then;
   * the threshold catches a bot that gets worse, and tightens as the bot gets better.
   */
  it('rarely dies alone: at most one death a round on average', () => {
    let deaths = 0;
    for (let seed = 1; seed <= 30; seed += 1)
      deaths += play(botRound(1, seed), 3600).bikes[0]?.deaths ?? 0;
    expect(deaths).toBeLessThanOrEqual(30);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @clicker/game exec vitest run test/cycles-step.test.ts test/cycles-game.test.ts`
Expected: FAIL — `Failed to resolve import "../src/modes/cycles"`.

- [ ] **Step 3: Implement**

`packages/game/src/modes/cycles/spawn.ts`:

```ts
import { freeRun } from './field';
import { randomBelow } from './random';

/**
 * Distance from every cell to the nearest obstacle — an occupied cell or the edge of the field.
 *
 * One breadth-first search seeded from every occupied cell at once, so the whole field costs
 * O(cells) however many trails there are; a search per trail would multiply that by the number
 * of players. The edge is folded in afterwards: the distance to it is plain arithmetic.
 */
export function clearance(field: Uint16Array, side: number): Int32Array {
  const cells = side * side;
  const distance = new Int32Array(cells).fill(-1);
  const queue = new Int32Array(cells);
  let head = 0;
  let tail = 0;

  for (let cell = 0; cell < cells; cell += 1) {
    if (field[cell] !== 0) {
      distance[cell] = 0;
      queue[tail] = cell;
      tail += 1;
    }
  }

  const reach = (neighbour: number, next: number): void => {
    if (distance[neighbour] !== -1) return;
    distance[neighbour] = next;
    queue[tail] = neighbour;
    tail += 1;
  };
  while (head < tail) {
    const cell = queue[head] ?? 0;
    head += 1;
    const x = cell % side;
    const next = (distance[cell] ?? 0) + 1;
    if (x + 1 < side) reach(cell + 1, next);
    if (x > 0) reach(cell - 1, next);
    if (cell + side < cells) reach(cell + side, next);
    if (cell >= side) reach(cell - side, next);
  }

  for (let cell = 0; cell < cells; cell += 1) {
    const x = cell % side;
    const y = (cell - x) / side;
    const toEdge = Math.min(x + 1, y + 1, side - x, side - y);
    const toTrail = distance[cell] ?? -1;
    distance[cell] = toTrail === -1 ? toEdge : Math.min(toTrail, toEdge);
  }
  return distance;
}

export interface Spot {
  x: number;
  y: number;
  dir: number;
}

/**
 * The free cell furthest from every obstacle, facing the longest open run. `null` when the field
 * has no free cell at all: the caller tries again next tick rather than spawning into a wall.
 */
export function pickSpawn(
  field: Uint16Array,
  side: number,
  seed: number,
): { spot: Spot | null; seed: number } {
  const distance = clearance(field, side);
  let best = 0;
  const candidates: number[] = [];
  for (let cell = 0; cell < distance.length; cell += 1) {
    const d = distance[cell] ?? 0;
    if (field[cell] !== 0 || d < best) continue;
    if (d > best) {
      best = d;
      candidates.length = 0;
    }
    candidates.push(cell);
  }
  if (best === 0) return { spot: null, seed };

  const drawn = randomBelow(seed, candidates.length);
  const cell = candidates[drawn.value] ?? 0;
  const x = cell % side;
  const y = (cell - x) / side;

  let dir = 0;
  let longest = -1;
  for (let candidate = 0; candidate < 4; candidate += 1) {
    const run = freeRun(field, side, x, y, candidate, side);
    if (run > longest) {
      longest = run;
      dir = candidate;
    }
  }
  return { spot: { x, y, dir }, seed: drawn.seed };
}
```

`packages/game/src/modes/cycles/bot.ts`:

```ts
import type { CyclesConfig } from './config';
import { freeRun } from './field';
import { random } from './random';
import { type Bike, DX, DY, type Turn } from './state';

/**
 * How many free cells are reachable from `start`, counting no further than `budget`.
 *
 * The classic light-cycle AI floods the whole field from each option and takes the roomiest.
 * Done in full that is O(cells) per option, per bot, per tick — twenty bots on a 128-cell field
 * would flood a million cells twenty times a second. The budget caps it at O(budget): past a few
 * hundred cells the bot is not trapped, and that is all it needs to know. The visited set is a
 * `Set` rather than a field-sized array for the same reason: allocating and clearing one would
 * cost O(cells) again.
 */
export function room(field: Uint16Array, side: number, start: number, budget: number): number {
  const seen = new Set<number>([start]);
  const queue = [start];
  const visit = (next: number): void => {
    if (field[next] !== 0 || seen.has(next)) return;
    seen.add(next);
    queue.push(next);
  };
  for (let head = 0; head < queue.length && seen.size < budget; head += 1) {
    const cell = queue[head] ?? 0;
    const x = cell % side;
    if (x + 1 < side) visit(cell + 1);
    if (x > 0) visit(cell - 1);
    if (cell + side < field.length) visit(cell + side);
    if (cell >= side) visit(cell - side);
  }
  return Math.min(seen.size, budget);
}

const OPTIONS: (Turn | null)[] = [null, 'left', 'right'];

/** How far a bot looks down each option to break a tie in room. A constant, so the cost stays put. */
const RUN_LIMIT = 32;

function turned(dir: number, turn: Turn | null): number {
  if (turn === null) return dir;
  return turn === 'left' ? (dir + 3) & 3 : (dir + 1) & 3;
}

/** The turn a bot makes this tick, or `null` to ride on. */
export function decide(
  field: Uint16Array,
  side: number,
  bike: Bike,
  config: CyclesConfig,
  seed: number,
): { turn: Turn | null; seed: number } {
  if (freeRun(field, side, bike.x, bike.y, bike.dir, config.botLookahead) >= config.botLookahead) {
    // Open road. An occasional turn keeps bots from riding the same straight lines forever.
    const roll = random(seed);
    if (roll.value >= 0.03) return { turn: null, seed: roll.seed };
    const side_ = random(roll.seed);
    const turn: Turn = side_.value < 0.5 ? 'left' : 'right';
    // A wander must pass the same test as an escape: two free cells ahead said nothing about
    // whether they led anywhere, and wandering into one-cell pockets was how lone bots died.
    const dir = turned(bike.dir, turn);
    const x = bike.x + (DX[dir as 0] ?? 0);
    const y = bike.y + (DY[dir as 0] ?? 0);
    const safe =
      x >= 0 &&
      y >= 0 &&
      x < side &&
      y < side &&
      field[y * side + x] === 0 &&
      room(field, side, y * side + x, config.botBudget) >= config.botBudget;
    return { turn: safe ? turn : null, seed: side_.seed };
  }

  // Something close ahead: weigh each option by the room behind it. Room alone ties whenever
  // every option opens into the same big region — the budget caps all three at once — and the
  // first option, riding straight, would then win and drive into the wall it was meant to avoid.
  // So a tie goes to the longer clear run, and only then to the earlier option: still no
  // randomness, still deterministic.
  let best: Turn | null = null;
  let bestRoom = -1;
  let bestRun = -1;
  let ties = 0;
  let current = seed;
  for (const option of OPTIONS) {
    const dir = turned(bike.dir, option);
    const x = bike.x + (DX[dir as 0] ?? 0);
    const y = bike.y + (DY[dir as 0] ?? 0);
    const inside = x >= 0 && y >= 0 && x < side && y < side;
    const cell = y * side + x;
    const score = inside && field[cell] === 0 ? room(field, side, cell, config.botBudget) : -1;
    const run = score < 0 ? -1 : freeRun(field, side, bike.x, bike.y, dir, RUN_LIMIT);
    if (score > bestRoom || (score === bestRoom && run > bestRun)) {
      bestRoom = score;
      bestRun = run;
      best = option;
      ties = 1;
    } else if (score === bestRoom && run === bestRun && score >= 0) {
      // Reservoir sampling over exact ties: each tied option ends up chosen with equal odds.
      ties += 1;
      const roll = random(current);
      current = roll.seed;
      if (roll.value * ties < 1) best = option;
    }
  }
  return { turn: best, seed: current };
}
```

`packages/game/src/modes/cycles/step.ts`:

```ts
import { decide } from './bot';
import type { CyclesConfig } from './config';
import { pickSpawn, type Spot } from './spawn';
import { type Bike, type CyclesState, DX, DY } from './state';
import { copyTrail, dropOldest, forEachCell, oldestCell, pushNewest } from './trail';

export type CyclesEvent =
  | { type: 'died'; slot: number; by: number | null }
  | { type: 'respawned'; slot: number }
  | { type: 'boost'; slot: number };

/**
 * What one tick changed. The step knows this already; recovering it by comparing two fields
 * would be a pass over every cell just to rediscover it.
 */
export interface TickChanges {
  /** Flat pairs: cell, slot. */
  added: number[];
  freed: number[];
  events: CyclesEvent[];
}

/** Everything a tick writes to: copies, so the state it was given is never touched. */
export interface Work {
  field: Uint16Array;
  side: number;
  bikes: Bike[];
  changes: TickChanges;
  config: CyclesConfig;
}

export function place(work: Work, bike: Bike, spot: Spot): void {
  const cell = spot.y * work.side + spot.x;
  bike.alive = true;
  bike.x = spot.x;
  bike.y = spot.y;
  bike.dir = spot.dir;
  bike.trail.start = 0;
  bike.trail.size = 0;
  pushNewest(bike.trail, cell);
  bike.cap = work.config.trail;
  bike.rubber = work.config.rubber;
  bike.regen = 0;
  bike.boost = 0;
  bike.turns = [];
  bike.life = 0;
  bike.respawnIn = 0;
  work.field[cell] = bike.slot;
  work.changes.added.push(cell, bike.slot);
}

function kill(work: Work, bike: Bike, by: number | null): void {
  bike.alive = false;
  bike.deaths += 1;
  bike.longest = Math.max(bike.longest, bike.life);
  bike.life = 0;
  bike.respawnIn = work.config.respawnTicks;
  bike.boost = 0;
  bike.turns = [];
  // The trail goes out with its rider: a dead bike must not keep walling the living in.
  forEachCell(bike.trail, (cell) => {
    work.field[cell] = 0;
    work.changes.freed.push(cell);
  });
  bike.trail.start = 0;
  bike.trail.size = 0;
  bike.cap = work.config.trail;
  work.changes.events.push({ type: 'died', slot: bike.slot, by });

  if (by === null) return;
  const killer = work.bikes[by - 1];
  if (killer === undefined) return;
  killer.kills += 1;
  killer.cap = Math.min(work.config.trailMax, killer.cap + work.config.killBonus);
}

const ADVANCE = 0;
const STALL = 1;
const CRASH = 2;

/**
 * One cell of movement for every bike in `movers`, all at once.
 *
 * Simultaneous, not in turn: each bike's fate is settled against the field as it stood before
 * anyone moved, so the order the bikes are listed in cannot change who lives. Two rules feed
 * each other — a tail only moves out of the way if its own bike advances, and a bike only
 * advances if its way is clear — so fates are settled by iterating to a fixed point. Fates only
 * ever change from "advance" to something else, which bounds the loop by the number of movers.
 */
function substep(work: Work, movers: Bike[]): void {
  const { field, side } = work;
  const count = movers.length;
  if (count === 0) return;

  const targets = new Int32Array(count);
  const tails = new Int32Array(count);
  const fates = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    const bike = movers[i] as Bike;
    const x = bike.x + (DX[bike.dir as 0] ?? 0);
    const y = bike.y + (DY[bike.dir as 0] ?? 0);
    targets[i] = x >= 0 && y >= 0 && x < side && y < side ? y * side + x : -1;
    // Only a full trail gives up its oldest cell; a growing one keeps it.
    tails[i] = bike.trail.size >= bike.cap ? oldestCell(bike.trail) : -1;
  }

  for (;;) {
    let changed = false;
    const vacated = new Set<number>();
    const aimed = new Map<number, number>();
    for (let i = 0; i < count; i += 1) {
      if (fates[i] !== ADVANCE) continue;
      if ((tails[i] ?? -1) >= 0) vacated.add(tails[i] ?? -1);
      const target = targets[i] ?? -1;
      if (target >= 0) aimed.set(target, (aimed.get(target) ?? 0) + 1);
    }
    for (let i = 0; i < count; i += 1) {
      if (fates[i] !== ADVANCE) continue;
      const target = targets[i] ?? -1;
      if (target < 0 || (field[target] !== 0 && !vacated.has(target))) {
        fates[i] = STALL;
        changed = true;
      } else if ((aimed.get(target) ?? 0) > 1) {
        fates[i] = CRASH;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Tails first, then heads: a head may take the very cell a tail just left.
  for (let i = 0; i < count; i += 1) {
    const tail = tails[i] ?? -1;
    if (fates[i] !== ADVANCE || tail < 0) continue;
    dropOldest((movers[i] as Bike).trail);
    field[tail] = 0;
    work.changes.freed.push(tail);
  }
  for (let i = 0; i < count; i += 1) {
    if (fates[i] !== ADVANCE) continue;
    const bike = movers[i] as Bike;
    const target = targets[i] ?? 0;
    field[target] = bike.slot;
    pushNewest(bike.trail, target);
    bike.x = target % side;
    bike.y = (target - bike.x) / side;
    work.changes.added.push(target, bike.slot);
    bike.regen += 1;
    if (bike.regen >= work.config.rubberRegenTicks) {
      bike.regen = 0;
      bike.rubber = Math.min(work.config.rubber, bike.rubber + 1);
    }
  }

  for (let i = 0; i < count; i += 1) {
    const bike = movers[i] as Bike;
    if (fates[i] === CRASH) {
      kill(work, bike, null);
    } else if (fates[i] === STALL) {
      bike.regen = 0;
      if (bike.rubber > 0) {
        bike.rubber -= 1;
        continue;
      }
      const target = targets[i] ?? -1;
      const owner = target < 0 ? 0 : (field[target] ?? 0);
      kill(work, bike, owner === 0 || owner === bike.slot ? null : owner);
    }
  }
}

export function step(
  prev: CyclesState,
  config: CyclesConfig,
): { state: CyclesState; changes: TickChanges } {
  const work: Work = {
    field: prev.field.slice(),
    side: prev.side,
    bikes: prev.bikes.map((bike) => ({
      ...bike,
      trail: copyTrail(bike.trail),
      turns: [...bike.turns],
    })),
    changes: { added: [], freed: [], events: [] },
    config,
  };
  let seed = prev.seed;

  for (const bike of work.bikes) {
    if (bike.alive || bike.left) continue;
    if (bike.respawnIn > 0) bike.respawnIn -= 1;
    if (bike.respawnIn > 0) continue;
    const picked = pickSpawn(work.field, work.side, seed);
    seed = picked.seed;
    if (picked.spot === null) continue;
    place(work, bike, picked.spot);
    work.changes.events.push({ type: 'respawned', slot: bike.slot });
  }

  for (const bike of work.bikes) {
    if (!bike.alive) continue;
    if (bike.bot && bike.turns.length === 0) {
      const decided = decide(work.field, work.side, bike, config, seed);
      seed = decided.seed;
      if (decided.turn !== null) bike.turns.push(decided.turn);
    }
    const turn = bike.turns.shift();
    if (turn !== undefined) bike.dir = turn === 'left' ? (bike.dir + 3) & 3 : (bike.dir + 1) & 3;
    if (bike.boost === config.boostTicks)
      work.changes.events.push({ type: 'boost', slot: bike.slot });
  }

  substep(
    work,
    work.bikes.filter((bike) => bike.alive),
  );
  substep(
    work,
    work.bikes.filter((bike) => bike.alive && bike.boost > 0),
  );

  for (const bike of work.bikes) {
    if (bike.boost > 0) bike.boost -= 1;
    if (bike.cooldown > 0) bike.cooldown -= 1;
    if (bike.alive) bike.life += 1;
  }

  return {
    state: { ...prev, field: work.field, bikes: work.bikes, seed, tick: prev.tick + 1 },
    changes: work.changes,
  };
}
```

`packages/game/src/modes/cycles/index.ts`:

```ts
import type { CyclesConfig } from './config';
import { sideFor } from './field';
import type { Spot } from './spawn';
import {
  type Bike,
  type CyclesInput,
  type CyclesResultRow,
  type CyclesState,
} from './state';
import { place, type Work } from './step';
import { emptyTrail, forEachCell } from './trail';

export { CYCLES_CONFIG, type CyclesConfig } from './config';
export {
  type Bike,
  type CyclesInput,
  type CyclesResultRow,
  type CyclesState,
  createCyclesState,
  type Turn,
} from './state';
export { type CyclesEvent, step, type TickChanges } from './step';

/** A bike waiting in the lobby: no position until a round places it. */
function newBike(slot: number, publicId: string, bot: boolean, config: CyclesConfig): Bike {
  return {
    slot,
    publicId,
    bot,
    alive: false,
    left: false,
    x: 0,
    y: 0,
    dir: 0,
    trail: emptyTrail(config.trailMax),
    cap: config.trail,
    rubber: config.rubber,
    regen: 0,
    boost: 0,
    cooldown: 0,
    turns: [],
    // A late joiner waits out a respawn and enters the running round; in the lobby it is ignored.
    respawnIn: config.respawnTicks,
    kills: 0,
    deaths: 0,
    life: 0,
    longest: 0,
  };
}

export function addPlayer(
  state: CyclesState,
  publicId: string,
  bot: boolean,
  config: CyclesConfig,
): CyclesState {
  if (state.index[publicId] !== undefined) return state;
  const bike = newBike(state.bikes.length + 1, publicId, bot, config);
  return {
    ...state,
    bikes: [...state.bikes, bike],
    index: { ...state.index, [publicId]: state.bikes.length },
  };
}

/**
 * Outside a round only. Slots are renumbered so they stay 1…n and fit the field, and the field
 * is cleared because its cells name the old slots; the next round rebuilds it anyway.
 */
export function removePlayers(state: CyclesState, publicIds: string[]): CyclesState {
  if (publicIds.length === 0) return state;
  const leaving = new Set(publicIds);
  const bikes = state.bikes
    .filter((bike) => !leaving.has(bike.publicId))
    .map((bike, position) => ({ ...bike, slot: position + 1, alive: false }));
  const index: Record<string, number> = {};
  bikes.forEach((bike, position) => {
    index[bike.publicId] = position;
  });
  return { ...state, bikes, index, field: new Uint16Array(state.side * state.side) };
}

/**
 * Start positions on an even lattice: √n columns by √n rows, each bike in the middle of its own
 * block, rows alternating east and west so neighbours ride apart. O(n). Placing every bike with
 * the respawn search instead would cost a full pass over the field per bike — O(n × cells), and
 * cells grow with n, so the start of a round would be quadratic in the players.
 */
function startSpot(position: number, count: number, side: number): Spot {
  const columns = Math.ceil(Math.sqrt(count));
  const column = position % columns;
  const row = Math.floor(position / columns);
  return {
    x: Math.floor(((2 * column + 1) * side) / (2 * columns)),
    y: Math.floor(((2 * row + 1) * side) / (2 * columns)),
    dir: row % 2 === 0 ? 0 : 2,
  };
}

/** Sizes the field for whoever is here and spreads the bikes evenly over it. */
export function startRound(state: CyclesState, config: CyclesConfig): CyclesState {
  const staying = state.bikes.filter((bike) => !bike.left);
  const side = sideFor(staying.length, config);
  const work: Work = {
    field: new Uint16Array(side * side),
    side,
    bikes: staying.map((bike, position) => newBike(position + 1, bike.publicId, bike.bot, config)),
    changes: { added: [], freed: [], events: [] },
    config,
  };
  work.bikes.forEach((bike, position) => {
    place(work, bike, startSpot(position, work.bikes.length, side));
  });
  const index: Record<string, number> = {};
  work.bikes.forEach((bike, position) => {
    index[bike.publicId] = position;
  });
  return { ...state, side, field: work.field, bikes: work.bikes, index, tick: 0, results: null };
}

function withBike(state: CyclesState, position: number, bike: Bike): CyclesState {
  const bikes = [...state.bikes];
  bikes[position] = bike;
  return { ...state, bikes };
}

export function applyInput(
  state: CyclesState,
  publicId: string,
  input: CyclesInput,
  config: CyclesConfig,
): CyclesState {
  const position = state.index[publicId];
  const bike = position === undefined ? undefined : state.bikes[position];
  if (position === undefined || bike === undefined || !bike.alive) return state;

  if (input.type === 'turn') {
    if (bike.turns.length >= config.turnQueue) return state;
    return withBike(state, position, { ...bike, turns: [...bike.turns, input.side] });
  }
  if (bike.boost > 0 || bike.cooldown > 0) return state;
  return withBike(state, position, {
    ...bike,
    boost: config.boostTicks,
    cooldown: config.boostTicks + config.boostCooldownTicks,
  });
}

/**
 * A player who left mid-round. Its bike is taken off the field with no one to blame, and it
 * keeps its slot until the round ends: renumbering now would rewrite every cell it ever owned.
 */
export function leave(state: CyclesState, publicId: string): CyclesState {
  const position = state.index[publicId];
  const bike = position === undefined ? undefined : state.bikes[position];
  if (position === undefined || bike === undefined || bike.left) return state;
  const field = state.field.slice();
  forEachCell(bike.trail, (cell) => {
    field[cell] = 0;
  });
  return {
    ...withBike(state, position, {
      ...bike,
      alive: false,
      left: true,
      trail: emptyTrail(bike.trail.cells.length),
      longest: Math.max(bike.longest, bike.life),
    }),
    field,
  };
}

/**
 * Most kills first; then fewest deaths; then the longest single life, counting the one still
 * running. The built-in sort is stable and adaptive, which is all a table of twenty needs.
 */
export function finish(state: CyclesState, names: Record<string, string>): CyclesState {
  const results: CyclesResultRow[] = state.bikes
    .map((bike) => ({
      publicId: bike.publicId,
      name: names[bike.publicId] ?? '',
      kills: bike.kills,
      deaths: bike.deaths,
      longest: Math.max(bike.longest, bike.life),
      rank: 0,
      slot: bike.slot,
    }))
    .sort(
      (a, b) =>
        b.kills - a.kills || a.deaths - b.deaths || b.longest - a.longest || a.slot - b.slot,
    )
    .map(({ slot: _slot, ...row }, position) => ({ ...row, rank: position + 1 }));
  return { ...state, results };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @clicker/game exec vitest run test/cycles-step.test.ts test/cycles-game.test.ts`
Expected: `Tests  29 passed (29)`.

- [ ] **Step 5: Prove the tests can fail**

Внести по одной поломке в `step.ts`, прогнать `test/cycles-step.test.ts`, убедиться, что упал хотя бы один тест, вернуть строку. Все восемь проверены при написании плана:

| Поломка | Заменить | На |
|---|---|---|
| хвосты не уступают клетку | `if ((tails[i] ?? -1) >= 0) vacated.add(tails[i] ?? -1);` | пустую строку |
| нет гибели в общей клетке | `} else if ((aimed.get(target) ?? 0) > 1) {` | `} else if (false) {` |
| убийство без виновника | `kill(work, bike, owner === 0 \|\| owner === bike.slot ? null : owner);` | `kill(work, bike, null);` |
| нет резины | `if (bike.rubber > 0) {` | `if (false) {` |
| нет второго подшага | `substep(work, work.bikes.filter((bike) => bike.alive && bike.boost > 0));` | пустую строку |
| шаг портит вход | `field: prev.field.slice(),` | `field: prev.field,` |
| след мертвеца остаётся | в `kill` убрать `work.field[cell] = 0;` и `work.changes.freed.push(cell);` | — |
| нет неподвижной точки | после `if (!changed) break;` добавить `break;` | — |

- [ ] **Step 6: Check and commit**

```bash
pnpm format && pnpm check && pnpm typecheck && pnpm test
```

```bash
git add packages/game/src/modes/cycles/spawn.ts packages/game/src/modes/cycles/bot.ts \
  packages/game/src/modes/cycles/step.ts packages/game/src/modes/cycles/index.ts \
  packages/game/test/cycles-step.test.ts packages/game/test/cycles-game.test.ts
git commit -m "feat(game): add the light-cycle tick, respawn and bots"
```

---

### Task 4: Гейты асимптотики и чистоты

**Files:**
- Modify: `packages/game/test/complexity.ts` (функция `counted`)
- Modify: `packages/game/test/purity.test.ts`
- Test: `packages/game/test/cycles-complexity.test.ts`

- [ ] **Step 1: Write the complexity tests**

`packages/game/test/cycles-complexity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addPlayer, createCyclesState, startRound } from '../src/modes/cycles';
import { decide } from '../src/modes/cycles/bot';
import { clearance } from '../src/modes/cycles/spawn';
import type { Bike } from '../src/modes/cycles/state';
import { step } from '../src/modes/cycles/step';
import { counted, growth, LINEAR, scanCost, type Tally } from './complexity';
import { arena, cyclesConfig } from './cycles-support';

/**
 * The shapes the spec promises: a tick is linear in the players, a bot's decision does not grow
 * with the field, a respawn search is linear in the cells. `size` is the variable each test
 * scales — players for the tick, cells for the searches.
 */

/**
 * Trails of one cell are full from the first tick, so every tick also runs the path where tails
 * make way. With the default length a fresh round never reaches it, and a scan hidden there went
 * unnoticed the first time this test was written.
 */
const config = cyclesConfig({ trail: 1 });

function round(players: number) {
  let state = createCyclesState(1);
  for (let i = 0; i < players; i += 1) state = addPlayer(state, `p${i}`, false, config);
  return startRound(state, config);
}

/** A side that gives `size × 100` cells, so a tenfold `size` is a tenfold field. */
const sideOf = (size: number) => Math.round(Math.sqrt(size * 100));

describe('a tick', () => {
  it('touches each bike a fixed number of times', () => {
    const work = (players: number) => {
      const tally: Tally = { touches: 0 };
      const state = round(players);
      step({ ...state, bikes: counted(state.bikes, tally) }, config);
      return tally.touches;
    };
    expect(growth(work)).toBeLessThan(LINEAR * 2);
  });

  it('never scans a list that grows with the players', () => {
    const work = (players: number) => {
      const state = round(players);
      return scanCost(() => step(state, config));
    };
    expect(growth(work)).toBeLessThan(LINEAR);
  });
});

describe('a bot’s decision', () => {
  it('costs the same on a field ten times larger', () => {
    const work = (size: number) => {
      const side = sideOf(size);
      const state = arena(side, [{ x: side - 2, y: Math.floor(side / 2), dir: 0, bot: true }]);
      const tally: Tally = { touches: 0 };
      decide(counted(state.field, tally), side, state.bikes[0] as Bike, config, 1);
      return tally.touches;
    };
    expect(growth(work)).toBeLessThan(2);
  });
});

describe('the respawn search', () => {
  it('is one pass over the cells, however many trails there are', () => {
    const work = (size: number) => {
      const side = sideOf(size);
      const field = new Uint16Array(side * side);
      for (let cell = 0; cell < field.length; cell += 7) field[cell] = 1;
      const tally: Tally = { touches: 0 };
      clearance(counted(field, tally), side);
      return tally.touches;
    };
    expect(growth(work)).toBeLessThan(LINEAR * 2);
  });
});
```

- [ ] **Step 2: Run them to see the instrument fail**

Run: `pnpm --filter @clicker/game exec vitest run test/cycles-complexity.test.ts`
Expected: FAIL in «costs the same on a field ten times larger» — `TypeError: Method get TypedArray.prototype.length called on incompatible receiver`.

- [ ] **Step 3: Fix the counting proxy**

В `packages/game/test/complexity.ts` заменить ловушку `get` в `counted`:

```ts
    get(target, key) {
      tally.touches += 1;
      // The target, not the proxy, is the receiver: typed arrays refuse to run their own
      // getters, such as `length`, on anything but a real typed array.
      return Reflect.get(target, key);
    },
```

Run: `pnpm --filter @clicker/game exec vitest run test/cycles-complexity.test.ts test/complexity.test.ts`
Expected: `Tests  10 passed (10)`.

- [ ] **Step 4: Extend the purity gate**

В `packages/game/test/purity.test.ts` добавить импорты после `import { describe, expect, it } from 'vitest';`:

```ts
import { addPlayer, createCyclesState, startRound, step } from '../src/modes/cycles';
import { CYCLES_CONFIG } from '../src/modes/cycles/config';
```

Перед комментарием `/** Replaces every ambient source of time and randomness ... */` вставить:

```ts
/**
 * The light-cycle rules will also run on the client to predict a player's own bike, and only
 * arithmetic that IEEE 754 rounds exactly is guaranteed to agree bit for bit across engines.
 * `+ − × ÷` and `Math.sqrt` are; the transcendental functions are not.
 */
const TRANSCENDENTAL =
  /\bMath\s*\.\s*(?:sin|cos|tan|asin|acos|atan2?|exp|expm1|log\w*|pow|cbrt|hypot)\b/;

describe('the light-cycle rules', () => {
  it('use only arithmetic every engine rounds the same way', () => {
    const offenders = sources(join(SOURCE, 'modes', 'cycles')).filter((path) =>
      TRANSCENDENTAL.test(code(path)),
    );
    expect(offenders).toEqual([]);
  });
});
```

В конец `describe('the rules at runtime', ...)`, после теста «plays a full round…», добавить:

```ts
  it('plays a round of bots, deaths and respawns included, without the clock or the dice', () => {
    expect(() =>
      sealed(() => {
        let state = createCyclesState(3);
        for (let i = 0; i < 6; i += 1) state = addPlayer(state, `bot-${i}`, true, CYCLES_CONFIG);
        state = startRound(state, CYCLES_CONFIG);
        for (let tick = 0; tick < 600; tick += 1) state = step(state, CYCLES_CONFIG).state;
      }),
    ).not.toThrow();
  });
```

Run: `pnpm --filter @clicker/game exec vitest run test/purity.test.ts`
Expected: `Tests  15 passed (15)`.

- [ ] **Step 5: Prove the gates can fail**

Каждая поломка вносится по одной и возвращается; при написании плана все пойманы:

| Поломка | Где | Какой тест падает |
|---|---|---|
| бот заливает всё поле: убрать `&& seen.size < budget` из цикла `room` | `bot.ts` | «costs the same on a field ten times larger» |
| скан на каждый занятый: `if (field[cell] !== 0 && field.indexOf(0) >= -1) {` в первом цикле `clearance` | `spawn.ts` | «is one pass over the cells» |
| скан движущихся на каждого: `if ((tails[i] ?? -1) >= 0 && !movers.some((m) => m.slot < 0)) vacated.add(tails[i] ?? -1);` | `step.ts` | «never scans a list that grows with the players» |
| `Math.pow(participants, 0.5)` вместо `Math.sqrt(participants)` в `sideFor` | `field.ts` | «use only arithmetic every engine rounds the same way» |

- [ ] **Step 6: Check and commit**

```bash
pnpm format && pnpm check && pnpm typecheck && pnpm test
```

Expected: все пакеты зелёные, в `packages/game` — `Tests  119 passed (119)`.

```bash
git add packages/game/test/complexity.ts packages/game/test/purity.test.ts \
  packages/game/test/cycles-complexity.test.ts
git commit -m "test(game): hold the light-cycle rules to their shapes and purity"
```

---

### Task 5: Сверить спецификацию с реальностью

**Files:**
- Modify: `docs/superpowers/specs/2026-10-10-light-cycles-design.md`

- [ ] **Step 1: Record the two divergences**

В разделе 4, подраздел «Смерть, очки, респаун», после пункта про респаун добавить:

```markdown
- **Старт раунда — решёткой, а не поиском.** √n колонок на √n рядов, каждый байк в середине своего
  блока, ряды едут попеременно на восток и на запад. Поиск самой свободной точки для каждого байка
  стоил бы O(n × клеток), а клеток тем больше, чем больше игроков, — квадрат (план 6, находка 4).
- После смерти хвост возвращается к базовой длине: удлинения за убийства живут одну жизнь.
```

В разделе 4, подраздел «Боты», после пункта про заливку добавить:

```markdown
- Ничья по площади решается длиной свободного прогона (до 32 клеток), затем случайно из ГПСЧ;
  случайный поворот на простом участке проходит ту же проверку площадью. Без этого боты въезжали в
  стены, в тупики и закручивались спиралью внутрь (план 6, находки 1–3). Одиночный бот гибнет в
  среднем 0,7 раза за раунд — гейт от ухудшения, а не цель.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-10-10-light-cycles-design.md
git commit -m "docs: record where the light-cycle rules diverged from the spec"
```

---

## Самопроверка плана

- Раздел 4 спецификации: поле, байк, тик (подшаги, неподвижная точка, хвосты, встречные, общая клетка), резина, рывок, смерть и виновник, респаун, таблица, боты — задачи 2–3. Раунд и тик в 20 Гц — план 7.
- Раздел 10: правила, детерминизм, асимптотика, чистота, боты — задачи 3–4. Сервер, сквозной тест и снимки — планы 7 и 8.
- Типы `CyclesState`, `Bike`, `Trail`, `TickChanges`, `CyclesEvent`, `CyclesInput` определены в задачах 2–3 и используются в тестах под теми же именами.
