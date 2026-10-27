import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CYCLES_SETTINGS } from '../src/modes/cycles/config';
import { carFlags, raceMode } from '../src/modes/race';
import { TILE } from '../src/modes/race/fixed';
import { TRACKS } from '../src/modes/race/tracks';
import { config as gameConfig } from './support';

const config = gameConfig();
const settings = DEFAULT_CYCLES_SETTINGS;

function grid() {
  let state = raceMode.create(1);
  state = raceMode.addPlayer(state, '1', false, 0, config, settings);
  return raceMode.startRound(state, 0, config, settings);
}

describe('the flags of a car', () => {
  afterEach(() => {
    delete TRACKS.shifted;
  });

  it('are worked out on the track of the race, not on a track the module likes best', () => {
    const base = grid();
    const car = base.cars[0] as NonNullable<(typeof base.cars)[0]>;
    const ring = TRACKS[base.track] as NonNullable<(typeof TRACKS)[string]>;
    // The same road twenty tiles to the east, so the grid's place is no longer on it.
    TRACKS.shifted = {
      ...ring,
      id: 'shifted',
      start: { ...ring.start, x: ring.start.x + 20 * TILE },
    };

    expect(carFlags(base, car) & 2).toBe(0);
    expect(carFlags({ ...base, track: 'shifted' }, car) & 2).toBe(2);
  });

  it('are clear for a car sitting on the grid', () => {
    const car = grid().cars[0];
    expect(carFlags(grid(), { ...(car as NonNullable<typeof car>) })).toBe(0);
  });

  it('say the car has finished in bit 0', () => {
    const car = grid().cars[0] as NonNullable<ReturnType<typeof grid>['cars'][0]>;
    expect(carFlags(grid(), { ...car, finish: 900 }) & 1).toBe(1);
  });

  it('say the car is on grass in bit 1, and only when it is', () => {
    const car = grid().cars[0] as NonNullable<ReturnType<typeof grid>['cars'][0]>;
    // Half a tile to the side of the grid slot: past the kerb, before the wall.
    const off = { ...car, x: car.x, y: car.y - 4000 };
    expect(carFlags(grid(), car) & 2).toBe(0);
    expect(carFlags(grid(), off) & 2).toBe(2);
  });

  it('say the car touches a wall in bit 2', () => {
    const car = grid().cars[0] as NonNullable<ReturnType<typeof grid>['cars'][0]>;
    expect(carFlags(grid(), { ...car, wall: 3 }) & 4).toBe(4);
    expect(carFlags(grid(), { ...car, wall: 0 }) & 4).toBe(0);
  });

  it('say the car touches another car in bit 3', () => {
    const car = grid().cars[0] as NonNullable<ReturnType<typeof grid>['cars'][0]>;
    expect(carFlags(grid(), { ...car, touch: 2 }) & 8).toBe(8);
    expect(carFlags(grid(), { ...car, touch: 0 }) & 8).toBe(0);
  });
});
