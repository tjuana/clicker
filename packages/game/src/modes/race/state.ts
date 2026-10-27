import type { Car } from './car';

export interface RaceChanges {
  /** Cars that crossed the start line forward this tick, with the lap they are now on. */
  /**
   * `time` is the lap just finished, in ticks between this crossing and the previous one. It is
   * null when there is no such lap: the first crossing only starts lap 1, and a lap that was cut
   * short (the car reversed over the line) has no honest start. Null exactly when the car's
   * best lap is left unchanged.
   * `best` is the car's best lap after this crossing (null while it has none), so that a client
   * never works the rule out for itself.
   */
  laps: { slot: number; lap: number; time: number | null; best: number | null }[];
  /** Slots that completed the last lap this tick. */
  finished: number[];
  /** Slots of cars that began touching another car this tick: one event per contact, not per tick of it. */
  bumped: number[];
}

export interface RaceResultRow {
  rank: number;
  slot: number;
  publicId: string;
  /** As the room knew the player at the finish; the room may have forgotten them by the time the results are read. */
  name: string;
  /** Laps completed, never more than the race has. */
  laps: number;
  best: number | null;
  /** The tick the car finished, or null. */
  finish: number | null;
  /** Units short of the finish for a car that did not make it. */
  short: number | null;
}

export interface RaceState {
  track: string;
  cars: Car[];
  /** Public id to the car's place in `cars`. */
  index: Record<string, number>;
  tick: number;
  /** The cars stand on the grid and the lights are not out: from `startRace` to the first step. */
  onGrid: boolean;
  /** The generator's state; it only moves when bots are given their pace. */
  seed: number;
  firstFinish: number | null;
  results: RaceResultRow[] | null;
}

export function newCar(slot: number, publicId: string, bot: boolean): Car {
  return {
    slot,
    publicId,
    bot,
    out: false,
    abandoned: false,
    x: 0,
    y: 0,
    heading: 0,
    speed: 0,
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

export function emptyRace(track: string, seed: number, cars: Car[] = []): RaceState {
  const index: Record<string, number> = {};
  cars.forEach((car, i) => {
    index[car.publicId] = i;
  });
  return { track, cars, index, tick: 0, onGrid: false, seed, firstFinish: null, results: null };
}
