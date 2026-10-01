import { describe, expect, it } from 'vitest';
import { applyInput, finish, removePlayers, toData } from '../src/modes/clicker';
import type { ClickerState } from '../src/modes/clicker/state';
import { advance } from '../src/room/advance';
import type { RoomState } from '../src/room/state';
import { counted, growth, LINEAR, scanCost, type Tally } from './complexity';
import { config, player, room, score } from './support';

/**
 * How the room behaves as it fills. The rules are the one layer where a bad curve cannot be
 * worked around later: a Durable Object is single-threaded, so every wasted pass over the
 * players is time no other player in that room gets.
 *
 * These assert a shape, not a speed. A threshold here says "linear, not quadratic", and the
 * gap between those is a factor of ten — wide enough that ordinary refactoring never trips it
 * and a genuine regression always does.
 */

function scoresOf(size: number): ClickerState {
  const scores: ClickerState['scores'] = {};
  for (let index = 0; index < size; index += 1) scores[String(index)] = score();
  return { scores, results: null };
}

/** Every player disconnected long enough ago to be dropped, and every one of them a host. */
function abandonedRoom(size: number): RoomState {
  const players: RoomState['players'] = {};
  const hosts: string[] = [];
  for (let index = 0; index < size; index += 1) {
    const id = String(index);
    players[`secret-${id}`] = player({ publicId: id, connectionIds: [], disconnectedAt: 0 });
    hosts.push(`secret-${id}`);
  }
  return room({ phase: 'lobby', players, hosts, modeState: scoresOf(size) });
}

describe('counting a click', () => {
  function work(size: number): number {
    const tally: Tally = { touches: 0 };
    const state = scoresOf(size);
    const probed: ClickerState = { ...state, scores: counted(state.scores, tally) };
    applyInput(probed, '0', { type: 'click' }, 1000, config());
    return tally.touches;
  }

  /**
   * A click copies the whole score table, because the state is immutable and that is the
   * price of it. Linear per click means the round as a whole costs players × clicks × players,
   * which is what sets the ceiling on room size — so the cost is pinned here deliberately.
   * If this ever has to go, the answer is structural sharing, not a mutable table.
   */
  it('costs one pass over the scores, never more', () => {
    expect(growth(work)).toBeLessThan(LINEAR * 2);
  });
});

describe('advancing time in an abandoned room', () => {
  function passes(size: number): number {
    const tally: Tally = { touches: 0 };
    const state = abandonedRoom(size);
    advance({ ...state, players: counted(state.players, tally) }, 1_000_000, config());
    return tally.touches;
  }

  function scans(size: number): number {
    const state = abandonedRoom(size);
    return scanCost(() => advance(state, 1_000_000, config()));
  }

  it('stays one pass over the players', () => {
    expect(growth(passes)).toBeLessThan(LINEAR * 2);
  });

  /**
   * Dropping the expired players must not scan for each one. Checking every host against an
   * array of the expired is a scan inside a pass, and a room everyone has left is the case
   * that makes it quadratic — rare, but it is the shape of the code that matters here, not
   * how often the shape is reached.
   */
  it('never scans a list that grows with the room', () => {
    expect(growth(scans)).toBeLessThan(LINEAR);
  });
});

describe('dropping players', () => {
  function work(size: number): number {
    const tally: Tally = { touches: 0 };
    const state = scoresOf(size);
    const leaving = Object.keys(state.scores);
    removePlayers({ ...state, scores: counted(state.scores, tally) }, leaving);
    return tally.touches;
  }

  it('deletes by key rather than scanning for each one', () => {
    expect(growth(work)).toBeLessThan(LINEAR * 2);
  });
});

describe('building the snapshot payload', () => {
  function work(size: number): number {
    const tally: Tally = { touches: 0 };
    const state = scoresOf(size);
    toData({ ...state, scores: counted(state.scores, tally) });
    return tally.touches;
  }

  /** Built once per broadcast, ten times a second, so a second pass here is paid for all round. */
  it('stays one pass over the scores', () => {
    expect(growth(work)).toBeLessThan(LINEAR * 2);
  });
});

describe('ranking the results', () => {
  function work(size: number): number {
    const tally: Tally = { touches: 0 };
    const state = scoresOf(size);
    const names: Record<string, string> = {};
    for (const publicId of Object.keys(state.scores)) names[publicId] = `player ${publicId}`;
    finish({ ...state, scores: counted(state.scores, tally) }, names);
    return tally.touches;
  }

  /**
   * A sort, so the honest bound is n log n rather than n: across a tenfold input that is about
   * fifteen, not ten. The threshold allows the logarithm and still catches a quadratic, which
   * is what a tie-break that scanned the table on every comparison would produce.
   */
  it('sorts without rescanning the table on every comparison', () => {
    expect(growth(work)).toBeLessThan(LINEAR * 3);
  });
});
