import type { Car } from './car';

export interface RaceChanges {
  /** Cars that crossed the start line forward this tick, with the lap they are now on. */
  laps: { slot: number; lap: number }[];
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
  return { track, cars, index, tick: 0, seed, firstFinish: null, results: null };
}
