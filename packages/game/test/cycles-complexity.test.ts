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
