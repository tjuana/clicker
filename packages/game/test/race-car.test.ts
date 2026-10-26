import { describe, expect, it } from 'vitest';
import { BRAKE, type Car, drive, GAS, LEFT, RIGHT } from '../src/modes/race/car';
import { RACE } from '../src/modes/race/config';
import { TILE, TURN } from '../src/modes/race/fixed';
import { buildTrack, point, project, type TrackData, walk } from '../src/modes/race/track';
import { TRACKS } from '../src/modes/race/tracks';

const track = buildTrack(TRACKS.ring as TrackData);
const LAST = track.pieces.length - 1;
const LIMIT = RACE.wall - RACE.radius;

/** A car standing on the road, facing along it. */
function carAt(piece: number, along: number, lateral: number, over: Partial<Car> = {}): Car {
  const spot = point(track, piece, along, lateral);
  return {
    slot: 0,
    publicId: 'a',
    bot: false,
    x: spot.x,
    y: spot.y,
    heading: spot.heading,
    speed: 0,
    piece,
    lap: 0,
    keys: 0,
    finish: null,
    best: null,
    lapStart: 0,
    pace: 100,
    wall: 0,
    ...over,
  };
}

function run(car: Car, ticks: number, keys: number): number[] {
  const speeds: number[] = [];
  car.keys = keys;
  for (let i = 0; i < ticks; i += 1) {
    drive(car, track, RACE);
    speeds.push(car.speed);
  }
  return speeds;
}

describe('speed', () => {
  it('rises to top speed in about 75 ticks and goes no further', () => {
    const car = carAt(LAST - 1, 0, 0);
    const speeds = run(car, 95, GAS);
    const reached = speeds.findIndex((v) => v >= RACE.topSpeed) + 1;
    expect(reached).toBeGreaterThanOrEqual(70);
    expect(reached).toBeLessThanOrEqual(80);
    expect(Math.max(...speeds)).toBe(RACE.topSpeed);
  });

  it('is limited to the grass speed on grass', () => {
    const car = carAt(LAST, 0, RACE.road + 40, { speed: 100 });
    const speeds = run(car, 100, GAS);
    expect(speeds.at(-1)).toBe(RACE.grassSpeed);
    expect(Math.max(...speeds.slice(30))).toBe(RACE.grassSpeed);
  });

  it('coasts to a stop with no keys, and stays stopped', () => {
    const car = carAt(LAST - 1, 0, 0, { speed: 100 });
    const speeds = run(car, 150, 0);
    expect(speeds[99]).toBe(0);
    expect(speeds.at(-1)).toBe(0);
    expect(Math.min(...speeds)).toBe(0);
  });

  it('reverses when braking past zero, up to the reverse limit', () => {
    const car = carAt(LAST - 1, 2 * TILE, 0, { speed: 20 });
    const speeds = run(car, 60, BRAKE);
    expect(Math.min(...speeds)).toBe(-RACE.reverseSpeed);
    expect(speeds.at(-1)).toBe(-RACE.reverseSpeed);
  });
});

describe('steering', () => {
  it('does nothing at rest', () => {
    const car = carAt(LAST, 0, 0);
    const before = car.heading;
    run(car, 10, RIGHT);
    expect(car.heading).toBe(before);
  });

  it('turns right with the right key and left with the left, the other way when reversing', () => {
    const turned = (speed: number, keys: number) => {
      const car = carAt(LAST - 1, 2 * TILE, 0, { speed });
      const before = car.heading;
      car.keys = keys;
      drive(car, track, RACE);
      return ((car.heading - before + TURN / 2) & (TURN - 1)) - TURN / 2;
    };
    expect(turned(150, RIGHT)).toBeGreaterThan(0);
    expect(turned(150, LEFT)).toBeLessThan(0);
    expect(turned(-40, RIGHT)).toBeLessThan(0);
  });

  it('turns less at top speed than at moderate speed', () => {
    const turned = (speed: number) => {
      const car = carAt(LAST - 1, 2 * TILE, 0, { speed, keys: RIGHT | GAS });
      drive(car, track, RACE);
      return car.heading;
    };
    expect(turned(RACE.topSpeed)).toBeLessThan(turned(RACE.turnSpeed + 20));
  });
});

describe('walls', () => {
  /** Fully throttled at a wall of the straight, `degrees` off its direction towards it. */
  function hit(degrees: number): { car: Car; before: number } {
    const heading = (-Math.round((degrees * TURN) / 360) + TURN) & (TURN - 1);
    const car = carAt(LAST, TILE, -(LIMIT + 30), { heading, speed: RACE.topSpeed, keys: GAS });
    drive(car, track, RACE);
    return { car, before: RACE.topSpeed };
  }

  it('pushes the car back inside the corridor', () => {
    const { car } = hit(30);
    expect(project(track, car.piece, car.x, car.y).lateral).toBeGreaterThanOrEqual(-LIMIT - 2);
  });

  it('never speeds the car up, and a glancing hit keeps more than a head-on one (A6)', () => {
    const angles = [0, 10, 20, 30, 45, 60, 75, 90, 120, 150, 180];
    const speeds = angles.map((degrees) => hit(degrees).car.speed);
    for (const speed of speeds) {
      expect(Math.abs(speed)).toBeLessThanOrEqual(RACE.topSpeed);
    }
    for (let i = 1; i < 8; i += 1) {
      expect(speeds[i] as number).toBeLessThanOrEqual(speeds[i - 1] as number);
    }
    expect(speeds[1] as number).toBeGreaterThan(speeds[6] as number);
    expect(speeds[7]).toBe(0);
  });

  it('does not trap a car that hit head-on', () => {
    const car = carAt(LAST, TILE, -(LIMIT + 30), {
      heading: (3 * TURN) / 4,
      speed: RACE.topSpeed,
    });
    const hitTicks: number[] = [];
    car.keys = GAS | RIGHT;
    for (let tick = 0; tick < 30; tick += 1) {
      drive(car, track, RACE);
      if (car.wall > 0) hitTicks.push(tick);
    }
    expect(hitTicks.length).toBeGreaterThan(0);
    expect(car.wall).toBe(0);
    expect(car.speed).toBeGreaterThan(0);
  });

  it('keeps a car that drives straight at the outside of a corner in the corridor', () => {
    const car = carAt(LAST, 0, 0, { speed: RACE.topSpeed, keys: GAS });
    for (let tick = 0; tick < 200; tick += 1) {
      drive(car, track, RACE);
      const place = walk(track, car.piece, car.x, car.y);
      expect(Math.abs(place.lateral)).toBeLessThanOrEqual(RACE.wall);
    }
  });
});

describe('the start line', () => {
  it('reports a forward crossing, once', () => {
    const car = carAt(LAST, 2 * TILE - 400, 0, { speed: 100, keys: GAS });
    const crossings = Array.from({ length: 10 }, () => drive(car, track, RACE));
    expect(crossings.filter((c) => c !== 0)).toEqual([1]);
    expect(car.piece).toBe(0);
  });
});
