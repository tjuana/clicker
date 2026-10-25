import { describe, expect, it } from 'vitest';
import { addPlayer, createCyclesState, startRound } from '../src/modes/cycles';
import { wantsWall } from '../src/modes/cycles/bot';
import type { Bike } from '../src/modes/cycles/state';
import { step } from '../src/modes/cycles/step';
import { arena, cyclesConfig } from './cycles-support';

const button = cyclesConfig({ walls: 'button' });

function wants(rivalOffset: [number, number], overrides: { energy?: number } = {}, mode = button) {
  const [dx, dy] = rivalOffset;
  const state = arena(
    30,
    [
      { x: 15, y: 15, dir: 0, bot: true, lit: false, ...overrides },
      { x: 15 + dx, y: 15 + dy, dir: 0, lit: false },
    ],
    mode,
  );
  return wantsWall(state.field, state.side, state.bikes[0] as Bike, state.bikes, mode);
}

describe('when a bot wants its wall', () => {
  it('never, when it is alone on the field', () => {
    let state = createCyclesState(3);
    state = addPlayer(state, 'bot-0', true, button);
    state = startRound(state, button);
    for (let tick = 0; tick < 300; tick += 1) {
      state = step(state, button).state;
      const bike = state.bikes[0] as Bike;
      expect(bike.lit).toBe(false);
      expect(bike.trail.size).toBe(1);
    }
  });

  it('when a rival’s head is within four cells, on either axis or diagonally', () => {
    expect(wants([4, 0])).toBe(true);
    expect(wants([-4, 0])).toBe(true);
    expect(wants([0, 4])).toBe(true);
    expect(wants([-4, -4])).toBe(true);
  });

  it('not when the rival is five cells away on an axis', () => {
    expect(wants([5, 0])).toBe(false);
    expect(wants([0, -5])).toBe(false);
  });

  it('not without energy, even with a rival next to it', () => {
    expect(wants([1, 0], { energy: 0 })).toBe(false);
  });

  it('not in always mode, where every wall is lit anyway', () => {
    expect(wants([1, 0], {}, cyclesConfig())).toBe(false);
  });

  it('not for a rival’s wall that is not its head', () => {
    const state = arena(
      30,
      [
        { x: 15, y: 15, dir: 0, bot: true, lit: false },
        { x: 25, y: 25, dir: 0, behind: [[16, 15]] },
      ],
      button,
    );
    expect(wantsWall(state.field, 30, state.bikes[0] as Bike, state.bikes, button)).toBe(false);
  });

  it('lights the wall in the step when a rival is near, and puts it out when the rival is gone', () => {
    const state = arena(
      30,
      [
        { x: 10, y: 15, dir: 0, bot: true, lit: false },
        { x: 14, y: 19, dir: 2, lit: false },
      ],
      button,
    );
    const after = step(state, button).state;
    expect((after.bikes[0] as Bike).lit).toBe(true);
    const alone = arena(30, [{ x: 10, y: 15, dir: 0, bot: true, lit: true }], button);
    expect((step(alone, button).state.bikes[0] as Bike).lit).toBe(false);
  });
});

describe('a bot that has run out of energy', () => {
  it('does not light on every unit it regrows: its wall comes in runs, never dots', () => {
    // No lookahead, so the bot keeps its course instead of steering around the rival it rides by.
    const config = { ...button, botLookahead: 0 };
    // The seed is chosen so that the bot's one in thirty wander never takes it away from the rival.
    let state = arena(
      130,
      [
        { x: 5, y: 60, dir: 0, bot: true, lit: false, energy: 0 },
        // Rides beside it at the same pace, so a rival stays within reach the whole way.
        { x: 2, y: 63, dir: 0, lit: false },
      ],
      config,
    );
    state = { ...state, seed: 8 };
    // A wall is laid in a tick when the trail grows; `lit` is already false again by then if
    // that tick spent the last unit.
    const lit: boolean[] = [];
    for (let tick = 0; tick < 100; tick += 1) {
      const before = (state.bikes[0] as Bike).trail.size;
      state = step(state, config).state;
      lit.push((state.bikes[0] as Bike).trail.size > before);
    }

    const runs = lit
      .join(',')
      .split('false')
      .map((chunk) => chunk.split(',').filter((flag) => flag === 'true').length)
      .filter((length) => length > 0);
    expect(runs.length).toBeGreaterThan(0);
    expect(Math.min(...runs)).toBeGreaterThanOrEqual(button.energyTicks / 4);
  });
});
