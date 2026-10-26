import { randomBelow } from '../cycles/random';
import { bump } from './bump';
import { BRAKE, type Car, drive } from './car';
import type { RaceConfig } from './config';
import type { RaceChanges, RaceResultRow, RaceState } from './state';
import { point, project, type Track } from './track';

/**
 * How far round the track a car is, in units: the laps it has completed, the pieces before its
 * own and the distance into it. Lap 1 begins when the start line is first crossed, so a car
 * still on the grid is a little short of zero.
 */
function progress(car: Car, track: Track): number {
  const piece = track.pieces[car.piece];
  const along = project(track, car.piece, car.x, car.y).along;
  return (car.lap - 1) * track.length + (piece?.start ?? 0) + along;
}

/** Cars in the order they stand in the race, as indices into `state.cars`. */
function order(state: RaceState, track: Track): number[] {
  const { cars } = state;
  // Worked out once per car: the comparator below runs n log n times.
  const covered = cars.map((car) => progress(car, track));
  return cars
    .map((_, i) => i)
    .sort((a, b) => {
      const x = cars[a] as Car;
      const y = cars[b] as Car;
      if (x.finish !== null && y.finish !== null) return x.finish - y.finish || x.slot - y.slot;
      if (x.finish !== null) return -1;
      if (y.finish !== null) return 1;
      return (covered[b] as number) - (covered[a] as number) || x.slot - y.slot;
    });
}

/** Slots in race order: finishers by their finish tick, then the rest by progress. */
export function standings(state: RaceState, track: Track): number[] {
  return order(state, track).map((i) => (state.cars[i] as Car).slot);
}

/**
 * Cars two abreast behind the start line, back along the centreline in slot order, facing the
 * way round. A new race: the clock, the finish and the results are cleared. Bots draw their
 * pace from the seed here, so a replay from this state is the same race.
 */
export function startRace(state: RaceState, track: Track, config: RaceConfig): RaceState {
  const rank = state.cars
    .map((_, i) => i)
    .sort((a, b) => (state.cars[a] as Car).slot - (state.cars[b] as Car).slot);
  let seed = state.seed;
  const count = track.pieces.length;
  const cars = state.cars.map((car) => ({ ...car }));
  rank.forEach((index, place) => {
    const car = cars[index] as Car;
    let piece = count - 1;
    let along =
      (track.pieces[piece]?.length ?? 0) -
      config.gridFront -
      Math.floor(place / 2) * config.gridRow;
    while (along < 0) {
      piece = (piece + count - 1) % count;
      along += track.pieces[piece]?.length ?? 0;
    }
    const where = point(
      track,
      piece,
      along,
      place % 2 === 0 ? -config.gridLateral : config.gridLateral,
    );
    let pace = 100;
    if (car.bot) {
      const drawn = randomBelow(seed, 10);
      seed = drawn.seed;
      pace = 88 + drawn.value;
    }
    Object.assign(car, {
      x: where.x,
      y: where.y,
      heading: where.heading,
      speed: 0,
      piece,
      lap: 0,
      keys: 0,
      finish: null,
      best: null,
      lapStart: 0,
      pace,
      wall: 0,
    });
  });
  return { ...state, cars, seed, tick: 0, firstFinish: null, results: null };
}

export function over(state: RaceState, config: RaceConfig): boolean {
  if (state.tick >= config.cap) return true;
  if (state.firstFinish !== null && state.tick >= state.firstFinish + config.afterFirst)
    return true;
  return state.cars.every((car) => car.finish !== null);
}

export function raceResults(state: RaceState, track: Track, config: RaceConfig): RaceResultRow[] {
  return order(state, track).map((i, place) => {
    const car = state.cars[i] as Car;
    const done = car.finish !== null;
    return {
      rank: place + 1,
      slot: car.slot,
      publicId: car.publicId,
      laps: done ? config.laps : Math.max(0, Math.min(config.laps, car.lap - 1)),
      best: car.best,
      finish: car.finish,
      short: done ? null : Math.max(0, config.laps * track.length - progress(car, track)),
    };
  });
}

/**
 * One tick of the race. The cars are copied and the copies driven, so the state it was given
 * is left as it was. Order: drive, bump, then the start line, because a lap belongs to what the
 * car did and not to where a push left it.
 */
export function stepRace(
  state: RaceState,
  track: Track,
  config: RaceConfig,
): { state: RaceState; changes: RaceChanges } {
  const tick = state.tick + 1;
  const cars = state.cars.map((car) => ({ ...car }));
  const crossings = new Int8Array(cars.length);
  for (let i = 0; i < cars.length; i += 1) {
    const car = cars[i] as Car;
    // A finished car is frozen: it brakes to a stop and its keys no longer matter.
    if (car.finish !== null) car.keys = car.speed > 0 ? BRAKE : 0;
    crossings[i] = drive(car, track, config);
  }

  const beforeX = Int32Array.from(cars, (car) => car.x);
  const beforeY = Int32Array.from(cars, (car) => car.y);
  bump(cars, track.bounds, config);

  const changes: RaceChanges = { laps: [], finished: [], bumped: [] };
  let firstFinish = state.firstFinish;
  for (let i = 0; i < cars.length; i += 1) {
    const car = cars[i] as Car;
    if (car.x !== beforeX[i] || car.y !== beforeY[i]) changes.bumped.push(car.slot);
    if (car.finish !== null) continue;
    const crossed = crossings[i] as number;
    if (crossed < 0) {
      car.lap += crossed;
      // The lap being driven was cut short; its time would be a lie.
      car.lapStart = -1;
    } else if (crossed > 0) {
      car.lap += crossed;
      if (car.lap >= 2 && car.lapStart >= 0) {
        const time = tick - car.lapStart;
        car.best = car.best === null ? time : Math.min(car.best, time);
      }
      car.lapStart = tick;
      changes.laps.push({ slot: car.slot, lap: car.lap });
      if (car.lap > config.laps) {
        car.finish = tick;
        firstFinish ??= tick;
        changes.finished.push(car.slot);
      }
    }
  }

  const next: RaceState = { ...state, cars, tick, firstFinish };
  if (over(next, config)) next.results = raceResults(next, track, config);
  return { state: next, changes };
}
