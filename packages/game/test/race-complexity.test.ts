import { describe, expect, it } from 'vitest';
import { carsInOrder } from '../src/modes/race';
import { bump } from '../src/modes/race/bump';
import type { Car } from '../src/modes/race/car';
import { RACE } from '../src/modes/race/config';
import { TILE } from '../src/modes/race/fixed';
import { emptyRace, newCar } from '../src/modes/race/state';
import { counted, growth, LINEAR, type Tally, traversalCost } from './complexity';

function car(slot: number, x: number, y: number): Car {
  return {
    slot,
    publicId: `p${slot}`,
    bot: false,
    out: false,
    abandoned: false,
    x,
    y,
    heading: 0,
    speed: 100,
    piece: 0,
    lap: 0,
    keys: 0,
    finish: null,
    best: null,
    lapStart: 0,
    pace: 100,
    wall: 0,
    touch: 0,
  };
}

describe('bumping cars', () => {
  it('grows with the number of cars, not with its square', () => {
    // One car per tile in a strip, as spread out as a field can be: the work is the cars and
    // their neighbours. Every read of a car is counted, and so is every pair compared.
    const ratio = growth((size) => {
      const tally: Tally = { touches: 0 };
      const cars = Array.from({ length: size }, (_, i) =>
        counted(car(i, i * TILE + TILE / 2, TILE / 2), tally),
      );
      const pairs = bump(cars, { x: 0, y: 0, width: size, height: 1 }, RACE);
      return tally.touches + pairs;
    });
    expect(ratio).toBeGreaterThan(LINEAR * 0.5);
    expect(ratio).toBeLessThan(LINEAR * 2);
  });

  it('compares each car with a handful of others, however many there are', () => {
    const pairs = growth((size) =>
      bump(
        Array.from({ length: size }, (_, i) => car(i, i * TILE + TILE / 2, TILE / 2)),
        { x: 0, y: 0, width: size, height: 1 },
        RACE,
      ),
    );
    expect(pairs).toBeGreaterThan(LINEAR * 0.5);
    expect(pairs).toBeLessThan(LINEAR * 2);
  });
});

describe('putting the cars in the order of the race', () => {
  // Done once a tick for the delta, so it may not grow faster than the field.
  it('walks the cars a fixed number of times, however many there are', () => {
    const ratio = growth((size) => {
      const cars = Array.from({ length: size }, (_, i) => ({
        ...newCar(i, `p${i}`, false),
        lap: 1 + (i % 3),
      }));
      const state = emptyRace('ring', 1, cars);
      return traversalCost(() => carsInOrder(state));
    });
    expect(ratio).toBeGreaterThan(LINEAR * 0.5);
    expect(ratio).toBeLessThan(LINEAR * 2);
  });
});
