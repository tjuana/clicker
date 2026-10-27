import type { Mode } from '..';
import { BRAKE, type Car, GAS, LEFT, RIGHT } from './car';
import { RACE } from './config';
import { raceResults, startRace, stepRace } from './race';
import { emptyRace, newCar, type RaceChanges, type RaceState } from './state';
import { buildTrack, type TrackData } from './track';
import { TRACKS } from './tracks';

export interface RaceInput {
  type: 'keys';
  /** Gas, brake, left, right in the low four bits. The protocol refuses the rest; here they are masked off. */
  mask: number;
}

const KEYS = GAS | BRAKE | LEFT | RIGHT;
const TRACK_ID = 'ring';
// Built once at load: a track is derived from constant data, and the step needs it every tick.
const TRACK = buildTrack(TRACKS[TRACK_ID] as TrackData);

function withCars(state: RaceState, cars: Car[]): RaceState {
  return { ...state, cars, index: emptyRace(state.track, state.seed, cars).index };
}

export const raceMode: Mode<RaceState, RaceInput, RaceChanges> = {
  create: (seed) => emptyRace(TRACK_ID, seed),
  addPlayer: (state, publicId, bot) => {
    if (state.index[publicId] !== undefined) return state;
    return withCars(state, [...state.cars, newCar(state.cars.length, publicId, bot)]);
  },
  // Slots are renumbered so they stay 0…n-1, as the grid expects.
  removePlayers: (state, publicIds) => {
    if (publicIds.length === 0) return state;
    const leaving = new Set(publicIds);
    const cars = state.cars
      .filter((car) => !leaving.has(car.publicId))
      .map((car, slot) => ({ ...car, slot }));
    return withCars(state, cars);
  },
  // Slots are given here, in the order of the public ids, and not when a player joins: the
  // grid, the bots' pace and every tie-break follow the slot, and none of them may depend on
  // who happened to connect first.
  startRound: (state) => {
    const cars = [...state.cars]
      .sort((a, b) => (a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0))
      .map((car, slot) => ({ ...car, slot }));
    return startRace(withCars(state, cars), TRACK, RACE);
  },
  applyInput: (state, publicId, input) => {
    if (input.type !== 'keys') return state;
    const i = state.index[publicId];
    const car = i === undefined ? undefined : state.cars[i];
    if (i === undefined || car === undefined || car.bot || car.finish !== null) return state;
    const keys = input.mask & KEYS;
    if (keys === car.keys) return state;
    const cars = [...state.cars];
    cars[i] = { ...car, keys };
    return { ...state, cars };
  },
  step: (state) => stepRace(state, TRACK, RACE),
  // A person is back: the car the autopilot has been driving is theirs again. Called only for
  // people, so a bot's car is never taken by this.
  rejoin: (state, publicId) => {
    const i = state.index[publicId];
    const car = i === undefined ? undefined : state.cars[i];
    if (i === undefined || car === undefined || !car.bot) return state;
    const cars = [...state.cars];
    cars[i] = { ...car, bot: false, pace: 100 };
    return { ...state, cars };
  },
  // The car stays and is driven on by the autopilot, like a finished car: a parked car would be
  // a wall for the others. Its keys are released so that it does not hold the last ones forever.
  abandon: (state, publicId) => {
    const i = state.index[publicId];
    const car = i === undefined ? undefined : state.cars[i];
    if (i === undefined || car === undefined || car.bot) return state;
    const cars = [...state.cars];
    cars[i] = { ...car, bot: true, keys: 0, pace: RACE.coolPace };
    return { ...state, cars };
  },
  finish: (state) => ({ ...state, results: raceResults(state, TRACK, RACE) }),
  // Back to a lobby: the same players, none of the round.
  clear: (state) =>
    withCars(
      { ...state, tick: 0, firstFinish: null, results: null },
      state.cars.map((car) => newCar(car.slot, car.publicId, car.bot)),
    ),
  bots: true,
};
