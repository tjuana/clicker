import { describe, expect, it } from 'vitest';
import { addPlayer, applyInput, createCyclesState, startRound } from '../src/modes/cycles';
import type { CyclesState } from '../src/modes/cycles/state';
import { step, type TickChanges } from '../src/modes/cycles/step';
import { arena, cyclesConfig } from './cycles-support';

/** What a client does with a tick: write each reported cell, in the order reported. */
function replay(field: Uint16Array, changes: TickChanges): Uint16Array {
  const rebuilt = field.slice();
  for (let i = 0; i < changes.cells.length; i += 2) {
    rebuilt[changes.cells[i] as number] = changes.cells[i + 1] as number;
  }
  return rebuilt;
}

function livingHeads(state: CyclesState): number[] {
  return state.bikes.flatMap((bike) =>
    bike.alive
      ? [bike.slot, bike.y * state.side + bike.x, bike.dir, bike.rubber, bike.cooldown]
      : [],
  );
}

describe('what a tick reports', () => {
  it('rebuilds the field even when a cell is written and freed within the tick', () => {
    // Bike 1 boosts: it enters (3,4) in the first half-step and rides into bike 2's trail in
    // the second, dying and taking (3,4) back out. Added-then-freed must not leave a ghost.
    const config = cyclesConfig({ rubber: 0 });
    const state = applyInput(
      arena(
        10,
        [
          { x: 2, y: 4, dir: 0 },
          {
            x: 4,
            y: 7,
            dir: 1,
            behind: [
              [4, 3],
              [4, 4],
              [4, 5],
              [4, 6],
            ],
            cap: 9,
          },
        ],
        config,
      ),
      '1',
      { type: 'boost' },
      config,
    );
    const { state: after, changes } = step(state, config);
    expect(after.bikes[0]?.alive).toBe(false);
    expect(Array.from(replay(state.field, changes))).toEqual(Array.from(after.field));
  });

  it('lists each cell once, with what it holds after the tick', () => {
    const { state: after, changes } = step(
      arena(10, [{ x: 2, y: 5, dir: 0, behind: [[1, 5]], cap: 2 }]),
      cyclesConfig(),
    );
    expect(changes.cells).toEqual([5 * 10 + 1, 0, 5 * 10 + 3, 1]);
    expect(after.field[5 * 10 + 3]).toBe(1);
  });

  it('carries the rubber and the boost cooldown of each living bike, which the client cannot work out', () => {
    // Bike 1 stands against the east wall and has just boosted; bike 2 is riding free.
    const config = cyclesConfig();
    const state = applyInput(
      arena(
        10,
        [
          { x: 9, y: 2, dir: 0 },
          { x: 2, y: 7, dir: 0 },
        ],
        config,
      ),
      '1',
      { type: 'boost' },
      config,
    );

    const { changes } = step(state, config);

    const [slot1, , , rubber1, cooldown1, slot2, , , rubber2, cooldown2] = changes.heads;
    expect([slot1, slot2]).toEqual([1, 2]);
    expect(rubber1).toBeLessThan(config.rubber);
    expect(cooldown1).toBeGreaterThan(0);
    expect(rubber2).toBe(config.rubber);
    expect(cooldown2).toBe(0);
  });

  it('keeps the field and the head list replayable through whole games', () => {
    const config = cyclesConfig();
    for (let seed = 1; seed <= 8; seed += 1) {
      let state = createCyclesState(seed);
      for (let i = 0; i < 6; i += 1) state = addPlayer(state, `bot-${i}`, true, config);
      state = startRound(state, config);
      // A tiny LCG, not Math.random: the test must replay the same game on every run.
      let lcg = seed;
      const next = (bound: number): number => {
        lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
        return lcg % bound;
      };
      for (let tick = 0; tick < 400; tick += 1) {
        if (next(10) < 3) {
          const bot = state.bikes[next(state.bikes.length)];
          if (bot !== undefined) state = applyInput(state, bot.publicId, { type: 'boost' }, config);
        }
        const { state: after, changes } = step(state, config);
        const where = `seed ${seed}, tick ${tick}`;
        expect(Array.from(replay(state.field, changes)), where).toEqual(Array.from(after.field));
        expect(changes.heads, where).toEqual(livingHeads(after));
        state = after;
      }
    }
  });
});
