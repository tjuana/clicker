import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLES_SETTINGS } from '../src/modes/cycles/config';
import { carFlags, raceMode } from '../src/modes/race';
import { config as gameConfig } from './support';

const config = gameConfig();
const settings = DEFAULT_CYCLES_SETTINGS;

function grid() {
  let state = raceMode.create(1);
  state = raceMode.addPlayer(state, '1', false, 0, config, settings);
  return raceMode.startRound(state, 0, config, settings);
}

describe('the flags of a car', () => {
  it('are clear for a car sitting on the grid', () => {
    const car = grid().cars[0];
    expect(carFlags({ ...(car as NonNullable<typeof car>) })).toBe(0);
  });

  it('say the car has finished in bit 0', () => {
    const car = grid().cars[0] as NonNullable<ReturnType<typeof grid>['cars'][0]>;
    expect(carFlags({ ...car, finish: 900 }) & 1).toBe(1);
  });

  it('say the car is on grass in bit 1, and only when it is', () => {
    const car = grid().cars[0] as NonNullable<ReturnType<typeof grid>['cars'][0]>;
    // Half a tile to the side of the grid slot: past the kerb, before the wall.
    const off = { ...car, x: car.x, y: car.y - 4000 };
    expect(carFlags(car) & 2).toBe(0);
    expect(carFlags(off) & 2).toBe(2);
  });

  it('say the car touches a wall in bit 2', () => {
    const car = grid().cars[0] as NonNullable<ReturnType<typeof grid>['cars'][0]>;
    expect(carFlags({ ...car, wall: 3 }) & 4).toBe(4);
    expect(carFlags({ ...car, wall: 0 }) & 4).toBe(0);
  });
});
