import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  createCyclesState,
  finish,
  leave,
  removePlayers,
  startRound,
} from '../src/modes/cycles';
import { decide, room } from '../src/modes/cycles/bot';
import { freeRun } from '../src/modes/cycles/field';
import { clearance, pickSpawn } from '../src/modes/cycles/spawn';
import type { CyclesState } from '../src/modes/cycles/state';
import { step } from '../src/modes/cycles/step';
import { arena, contradiction, cyclesConfig, trailOf } from './cycles-support';

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
  rules = config,
): CyclesState {
  let current = state;
  for (let tick = 0; tick < ticks; tick += 1) {
    current = step(current, rules).state;
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

  it('starts every bike facing open road, whatever the head count', () => {
    for (let count = 1; count <= 20; count += 1) {
      const { bikes, field, side } = botRound(count, count);
      for (const bike of bikes) {
        const run = freeRun(field, side, bike.x, bike.y, bike.dir, side);
        expect(run, `${count} bikes, slot ${bike.slot}`).toBeGreaterThanOrEqual(
          Math.floor(side / 6),
        );
      }
    }
  });

  it('puts two bikes side by side on the middle row, not both in the top quarter', () => {
    const { bikes, side } = botRound(2, 1);
    const [a, b] = bikes;
    expect(Math.min(a?.x ?? 0, b?.x ?? 0)).toBeLessThan(side / 2);
    expect(Math.max(a?.x ?? 0, b?.x ?? 0)).toBeGreaterThanOrEqual(side / 2);
    expect(a?.y).toBe(b?.y);
    expect(Math.abs((a?.y ?? 0) - side / 2)).toBeLessThanOrEqual(side / 8);
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

  it('marks a leaver and leaves the taking-off to the next tick, crediting no one', () => {
    const riding = play(botRound(2, 9), 5);
    const trail = trailOf(riding, 1).map(([x, y]) => y * riding.side + x);
    expect(trail.length).toBeGreaterThan(1);

    const marked = leave(riding, 'bot-0');
    expect(marked.bikes[0]?.left).toBe(true);
    // Nothing else has moved: a client only ever hears of this through the tick.
    expect(marked.field).toBe(riding.field);

    const { state, changes } = step(marked, config);
    expect(state.bikes[0]?.alive).toBe(false);
    expect(state.bikes[0]?.deaths).toBe(1);
    expect(changes.events).toContainEqual({ type: 'died', slot: 1, by: null });
    for (const cell of trail) {
      expect(state.field[cell]).toBe(0);
      expect(changes.cells[changes.cells.indexOf(cell) + 1]).toBe(0);
    }
    expect(state.bikes.map((bike) => bike.kills)).toEqual([0, 0]);
    expect(contradiction(state)).toBeNull();

    const later = play(state, 100);
    expect(later.bikes[0]?.alive).toBe(false);
    expect(contradiction(later)).toBeNull();
  });

  it('ignores a second leave and a leave of nobody', () => {
    const state = leave(botRound(2, 9), 'bot-0');
    expect(leave(state, 'bot-0')).toBe(state);
    expect(leave(state, 'nobody')).toBe(state);
  });

  it('lets a leaver come back, and rides again after the usual wait', () => {
    const gone = step(leave(play(botRound(2, 9), 3), 'bot-0'), config).state;
    expect(gone.bikes[0]?.alive).toBe(false);

    let back = addPlayer(gone, 'bot-0', true, config);
    expect(back.bikes[0]?.left).toBe(false);
    expect(back.bikes).toHaveLength(2);
    back = play(back, config.respawnTicks - 1);
    expect(back.bikes[0]?.alive).toBe(false);
    back = play(back, 1);
    expect(back.bikes[0]?.alive).toBe(true);
  });

  it('keeps a bike that came back before the next tick', () => {
    const state = addPlayer(leave(botRound(2, 9), 'bot-0'), 'bot-0', true, config);
    expect(step(state, config).changes.events).not.toContainEqual(
      expect.objectContaining({ type: 'died' }),
    );
  });

  it('leaves no trail behind in a lobby after players are removed', () => {
    const removed = removePlayers(play(botRound(3, 4), 5), ['bot-1']);
    expect(removed.bikes.map((bike) => bike.trail.size)).toEqual([0, 0]);
    expect(contradiction(removed)).toBeNull();
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

  it('rarely dies alone with walls on a key either, where it never lights them', () => {
    const button = cyclesConfig({ walls: 'button' });
    let deaths = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      let state = createCyclesState(seed);
      state = addPlayer(state, 'bot-0', true, button);
      deaths += play(startRound(state, button), 3600, undefined, button).bikes[0]?.deaths ?? 0;
    }
    expect(deaths).toBeLessThanOrEqual(30);
  });
});
