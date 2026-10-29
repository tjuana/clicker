import { describe, expect, it } from 'vitest';
import { binCars } from '../src/modes/race/bins';
import { decide } from '../src/modes/race/bot';
import { BRAKE, type Car, GAS, LEFT, RIGHT } from '../src/modes/race/car';
import { RACE } from '../src/modes/race/config';
import { TILE } from '../src/modes/race/fixed';
import { startRace, stepRace } from '../src/modes/race/race';
import { emptyRace, newCar, type RaceState } from '../src/modes/race/state';
import { buildTrack, point, type TrackData } from '../src/modes/race/track';
import { TRACKS } from '../src/modes/race/tracks';
import { counted, growth } from './complexity';
import { bodyOverlap } from './race-body';

const track = buildTrack(TRACKS.ring as TrackData);

function bots(count: number, seed = 1): RaceState {
  const cars = Array.from({ length: count }, (_, slot) => newCar(slot, `b${slot}`, true));
  return startRace(emptyRace('ring', seed, cars), track, RACE);
}

/** A bot on the road at a place, facing along the track, at a speed. */
function bot(piece: number, along: number, lateral: number, speed: number, slot = 1): Car {
  const where = point(track, piece, along, lateral);
  return { ...newCar(slot, `b${slot}`, true), ...where, piece, speed, lap: 1 };
}

function keysOf(car: Car, others: Car[] = []): number {
  const cars = [car, ...others];
  return decide(0, cars, binCars(cars, track.bounds), track, RACE);
}

/** The deepest two bodies sink into each other, by an exact all-pairs check. */
function deepest(cars: Car[]): number {
  let worst = 0;
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      worst = Math.max(worst, bodyOverlap(cars[i] as Car, cars[j] as Car));
    }
  }
  return worst;
}

interface Run {
  state: RaceState;
  wallTicks: number[];
  slowSpell: number;
  /** The longest run of ticks any car spent touching a wall. */
  worstWall: number;
  overlap: number;
}

function race(count: number, ticks: number): Run {
  let state = bots(count);
  const wallTicks = state.cars.map(() => 0);
  const spell = state.cars.map(() => 0);
  let slowSpell = 0;
  let worstWall = 0;
  let overlap = 0;
  for (let t = 0; t < ticks && !state.cars.every((c) => c.finish !== null); t += 1) {
    state = stepRace(state, track, RACE).state;
    state.cars.forEach((c, i) => {
      if (c.wall > 0) wallTicks[i] = (wallTicks[i] ?? 0) + 1;
      worstWall = Math.max(worstWall, c.wall);
      spell[i] = c.finish === null && Math.abs(c.speed) < 10 ? (spell[i] ?? 0) + 1 : 0;
      slowSpell = Math.max(slowSpell, spell[i] ?? 0);
    });
    if (count > 1) overlap = Math.max(overlap, deepest(state.cars));
  }
  return { state, wallTicks, slowSpell, worstWall, overlap };
}

describe('a lone bot', () => {
  it('runs three laps of the Ring in 70 seconds, hardly touching a wall', () => {
    const { state, wallTicks } = race(1, 70 * 30);
    const finish = state.cars[0]?.finish;
    expect(finish).not.toBeNull();
    expect(finish ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(70 * 30);
    expect(wallTicks[0]).toBeLessThanOrEqual(10);
  });
});

describe('twenty bots', () => {
  const result = race(20, 90 * 30);

  it('all finish within 90 seconds', () => {
    expect(result.state.cars.filter((c) => c.finish === null).length).toBe(0);
  });

  it('never stand still for more than two and a half seconds', () => {
    expect(result.slowSpell).toBeLessThanOrEqual(75);
  });

  it('never stay on a wall for more than two seconds', () => {
    // Spec section 5: a car that has touched a wall for 60 ticks in a row is stuck. Measured: 16.
    expect(result.worstWall).toBeLessThanOrEqual(60);
  });

  it('are never seen inside one another: no overlap of 0.03 tile', () => {
    expect(result.overlap).toBeLessThan(0.03 * TILE);
  });
});

describe('what one bot decides', () => {
  it('steers back towards its lane', () => {
    const lane = RACE.bot.lane;
    // Slot 2 drives 0.17 tile right of the centre; this one stands left of that.
    const keys = keysOf(bot(1, 1000, lane - 400, 100, 2));
    expect(keys & RIGHT).toBeTruthy();
    expect(keys & LEFT).toBeFalsy();
  });

  it('rides straight in its lane, with the gas down while slow', () => {
    const keys = keysOf(bot(1, 1000, 0, 100));
    expect(keys & (LEFT | RIGHT)).toBe(0);
    expect(keys & GAS).toBeTruthy();
  });

  it('brakes for a tight corner it is too fast for', () => {
    // The Ring's third piece is a straight into a size-1 corner a few pieces on.
    const tight = track.pieces.findIndex((p) => p.kind === 'corner' && p.rc < TILE);
    const before = tight - 1;
    const length = track.pieces[before]?.length ?? 0;
    const keys = keysOf(bot(before, length - 600, 0, RACE.topSpeed));
    expect(keys & BRAKE).toBeTruthy();
    expect(keys & GAS).toBeFalsy();
  });

  it('keeps off the brakes on an open straight at top speed', () => {
    const keys = keysOf(bot(1, 200, 0, Math.round(RACE.topSpeed * 0.9)));
    expect(keys & BRAKE).toBeFalsy();
  });

  it('swerves round a slower car ahead in its lane', () => {
    const me = bot(1, 400, 0, 200);
    const slow = bot(1, 400 + 1000, 0, 100, 2);
    expect(keysOf(me, [slow]) & (LEFT | RIGHT)).toBeTruthy();
    expect(keysOf(me) & (LEFT | RIGHT)).toBe(0);
  });

  it('does not swerve into a lane that is taken alongside', () => {
    const me = bot(1, 400, 0, 200);
    const slow = bot(1, 400 + 1000, 0, 100, 2);
    const beside = bot(1, 400 + 100, 0.2 * TILE, 200, 3);
    expect(keysOf(me, [slow, beside]) & (LEFT | RIGHT)).toBe(0);
  });
});

/** Pieces and cars as a tally sees them: every read through a proxy counts one. */
describe('the cost of a decision', () => {
  it('does not grow with the length of the track', () => {
    const ratio = growth((size) => {
      const tally = { touches: 0 };
      const pieces = Array.from({ length: size }, (_, i) => ({
        kind: 'straight' as const,
        x: i * 2 * TILE,
        y: TILE / 2,
        dir: 0,
        start: i * 2 * TILE,
        length: 2 * TILE,
      }));
      const long = {
        ...track,
        pieces: counted(pieces, tally),
        length: size * 2 * TILE,
        bounds: { x: 0, y: 0, width: 2 * size, height: 1 },
      };
      const car = {
        ...newCar(1, 'b1', true),
        x: size * TILE + 500,
        y: TILE / 2,
        speed: RACE.topSpeed,
        piece: Math.floor(size / 2),
        lap: 1,
      };
      decide(0, [car], binCars([car], long.bounds), long, RACE);
      return tally.touches;
    });
    expect(ratio).toBeLessThan(2);
  });

  it('does not grow with the number of cars on the track', () => {
    const ratio = growth((size) => {
      const tally = { touches: 0 };
      const pieces = Array.from({ length: size }, (_, i) => ({
        kind: 'straight' as const,
        x: i * TILE,
        y: TILE / 2,
        dir: 0,
        start: i * TILE,
        length: TILE,
      }));
      const strip = {
        ...track,
        pieces,
        length: size * TILE,
        bounds: { x: 0, y: 0, width: size, height: 1 },
      };
      const cars = Array.from({ length: size }, (_, i) => ({
        ...newCar(i, `b${i}`, true),
        x: i * TILE + TILE / 2,
        y: TILE / 2,
        speed: 100,
        piece: i,
        lap: 1,
      }));
      const bins = binCars(cars, strip.bounds);
      const seen = cars.map((c) => counted(c, tally));
      decide(Math.floor(size / 2), seen, bins, strip, RACE);
      return tally.touches;
    });
    expect(ratio).toBeLessThan(2);
  });
});
