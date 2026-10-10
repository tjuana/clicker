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
