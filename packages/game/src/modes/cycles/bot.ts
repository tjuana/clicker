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

/**
 * How far from its head a bot looks for a rival, in cells each way: a 9 × 9 window. About a
 * second's ride at the default speed, enough to light a wall before a head-on pass but not so
 * wide that bots spend their energy on rivals they will never meet. A constant, so the cost of
 * the question stays put as the field and the crowd grow.
 */
const WALL_RADIUS = 4;

/**
 * Whether a bot lays its wall this tick: only while it has energy and a rival's head is close.
 * Bots have no key, so none of the fresh-press rule people live under applies to them.
 *
 * Reads the field window, not the bikes: a cell holding a slot `s` is a head when `bikes[s - 1]`
 * is alive and stands exactly there. That relies on `bikes` being ordered by slot with slot `n`
 * at index `n - 1`, which `addPlayer` and `startRound` guarantee. At most 81 cells and one
 * lookup per occupied cell, whatever the field or the number of bikes.
 */
export function wantsWall(
  field: Uint16Array,
  side: number,
  bike: Bike,
  bikes: Bike[],
  config: CyclesConfig,
): boolean {
  if (config.walls !== 'button') return false;
  // Hysteresis: a bot that lit keeps its wall while it has energy, but one that is dark lights
  // only with a reserve (a quarter of a life's store, a second). Gating on empty alone relights
  // the tick one unit regrows and lays a wall of single dots, which is the pattern the fresh-press
  // rule stops people from making.
  if (bike.energy <= 0 || (!bike.lit && bike.energy < config.energyTicks / 4)) return false;
  const top = Math.max(0, bike.y - WALL_RADIUS);
  const bottom = Math.min(side - 1, bike.y + WALL_RADIUS);
  const left = Math.max(0, bike.x - WALL_RADIUS);
  const right = Math.min(side - 1, bike.x + WALL_RADIUS);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const cell = y * side + x;
      const slot = field[cell] ?? 0;
      if (slot === 0 || slot === bike.slot) continue;
      const other = bikes[slot - 1];
      if (other?.alive && other.y * side + other.x === cell) return true;
    }
  }
  return false;
}
