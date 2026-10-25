import { describe, expect, it } from 'vitest';
import { addPlayer, createCyclesState, startRound } from '../src/modes/cycles';
import { decide, wantsWall } from '../src/modes/cycles/bot';
import { clearance } from '../src/modes/cycles/spawn';
import type { Bike } from '../src/modes/cycles/state';
import { step } from '../src/modes/cycles/step';
import {
  counted,
  growth,
  keyedCost,
  LINEAR,
  scanCost,
  type Tally,
  traversalCost,
} from './complexity';
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

  it('makes a number of passes over its bikes that grows with the players, not their square', () => {
    const work = (players: number) => {
      const state = round(players);
      return traversalCost(() => step(state, config));
    };
    expect(growth(work)).toBeLessThan(LINEAR * 2);
  });

  it('settles a chain of bikes each following the next one’s tail in work linear in the chain', () => {
    // Every bike's tail is its own head and the one ahead is blocked by a wall, so the stall
    // travels down the whole chain: one bike per step of it. A settling loop that rescans every
    // bike each time something changes would walk the chain once per bike.
    const chain = (size: number) => {
      const side = size + 2;
      const specs = Array.from({ length: size }, (_, position) => ({
        x: side - size + position,
        y: 1,
        dir: 0,
        cap: 1,
      }));
      return arena(side, specs, config);
    };
    // Two instruments, because the loops that make a chain quadratic come in two kinds: a pass
    // over the bikes, and a lookup in a table that is rebuilt on every pass.
    const passes = (size: number) => {
      const state = chain(size);
      return traversalCost(() => step(state, config));
    };
    const lookups = (size: number) => {
      const state = chain(size);
      return keyedCost(() => step(state, config));
    };
    expect(growth(passes)).toBeLessThan(LINEAR * 2);
    expect(growth(lookups)).toBeLessThan(LINEAR * 2);
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

describe('a bot’s wish for a wall', () => {
  const button = cyclesConfig({ walls: 'button' });

  /** A bot in the middle of a field of `side`, with `rivals` bikes whose heads are all in the window. */
  function crowd(side: number, rivals: number) {
    const middle = Math.floor(side / 2);
    return arena(
      side,
      [
        { x: middle, y: middle, dir: 0, bot: true },
        // Rivals far from the window, so that only the scan of the window, not a hit, is measured.
        ...Array.from({ length: rivals }, (_, i) => ({ x: 1 + i, y: 1, dir: 0 })),
      ],
      button,
    );
  }

  it('reads the same number of cells on a field ten times larger', () => {
    const work = (size: number) => {
      const side = size === 100 ? 40 : 400;
      const state = crowd(side, 1);
      const tally: Tally = { touches: 0 };
      wantsWall(counted(state.field, tally), side, state.bikes[0] as Bike, state.bikes, button);
      return tally.touches;
    };
    expect(growth(work)).toBeLessThan(2);
  });

  it('touches the same number of bikes when there are ten times as many', () => {
    const work = (size: number) => {
      const state = crowd(60, size === 100 ? 2 : 20);
      const tally: Tally = { touches: 0 };
      wantsWall(state.field, 60, state.bikes[0] as Bike, counted(state.bikes, tally), button);
      return tally.touches;
    };
    expect(growth(work)).toBeLessThan(2);
  });
});
