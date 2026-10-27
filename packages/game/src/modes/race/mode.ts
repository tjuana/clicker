import type { Mode } from '..';
import { comparePublicIds } from '../clicker';
import { BRAKE, type Car, GAS, LEFT, RIGHT } from './car';
import { RACE } from './config';
import { gridSpot, over, raceOrder, raceResults, startRace, stepRace } from './race';
import { emptyRace, newCar, type RaceChanges, type RaceState } from './state';
import { buildTrack, type Track, walk } from './track';
import { TRACKS } from './tracks';

export interface RaceInput {
  type: 'keys';
  /** Gas, brake, left, right in the low four bits. The protocol refuses the rest; here they are masked off. */
  mask: number;
}

const KEYS = GAS | BRAKE | LEFT | RIGHT;
const TRACK_ID = 'ring';

// Built once per track and then kept: a track is derived from constant data, and the step needs
// it every tick. Keyed by the id the state carries, so the rules follow the race they are given.
const built = new Map<string, Track>();
function trackOf(state: RaceState): Track {
  let track = built.get(state.track);
  if (track === undefined) {
    const data = TRACKS[state.track];
    if (data === undefined) throw new Error(`no track called ${state.track}`);
    track = buildTrack(data);
    built.set(state.track, track);
  }
  return track;
}

/**
 * What a client needs to know about a car besides where it is: bit 0 finished, bit 1 on grass,
 * bit 2 touching a wall, bit 3 touching another car. Worked out here, where the track is, so
 * the wire format needs none.
 */
export function carFlags(state: RaceState, car: Car): number {
  const onGrass = Math.abs(walk(trackOf(state), car.piece, car.x, car.y).lateral) > RACE.road;
  return (
    (car.finish !== null ? 1 : 0) |
    (onGrass ? 2 : 0) |
    (car.wall > 0 ? 4 : 0) |
    (car.touch !== 0 ? 8 : 0)
  );
}

/** The cars on the field in the order of the race: what a client lists as the standings. */
export function carsInOrder(state: RaceState): Car[] {
  return raceOrder(state, trackOf(state));
}

function withCars(state: RaceState, cars: Car[]): RaceState {
  return { ...state, cars, index: emptyRace(state.track, state.seed, cars).index };
}

export const raceMode: Mode<RaceState, RaceInput, RaceChanges> = {
  create: (seed) => emptyRace(TRACK_ID, seed),
  addPlayer: (state, publicId, bot) => {
    if (state.index[publicId] !== undefined) return state;
    // A new car takes the next free slot.
    const slot = state.cars.reduce((top, car) => Math.max(top, car.slot + 1), 0);
    // In the countdown the cars stand still on the grid: the newcomer takes the next spot, where
    // `startRace` would have put it, and races. Slots were numbered from zero at the start, so
    // the slot is the place.
    if (state.onGrid && state.tick === 0) {
      const car = { ...newCar(slot, publicId, bot), ...gridSpot(trackOf(state), RACE, slot) };
      return withCars(state, [...state.cars, car]);
    }
    // Otherwise off the field until the next round: a car put on the grid's origin mid-race
    // would walk back over the line, be shoved by a wall and keep the race from ever being over.
    // The round that follows brings everybody in (`startRace`).
    return withCars(state, [...state.cars, { ...newCar(slot, publicId, bot), out: true }]);
  },
  // Slots are left alone: the results are drawn per slot and are on the screen between races, so
  // a player leaving must not repaint the others. `startRound` numbers them afresh.
  removePlayers: (state, publicIds) => {
    if (publicIds.length === 0) return state;
    const leaving = new Set(publicIds);
    const cars = state.cars.filter((car) => !leaving.has(car.publicId));
    return withCars(state, cars);
  },
  // Slots are given here, in the room's order of the public ids, and not when a player joins: the
  // grid, the bots' pace and every tie-break follow the slot, and none of them may depend on
  // who happened to connect first.
  startRound: (state) => {
    const cars = [...state.cars]
      .sort((a, b) => comparePublicIds(a.publicId, b.publicId))
      .map((car, slot) => ({ ...car, slot }));
    return startRace(withCars(state, cars), trackOf(state), RACE);
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
  step: (state) => stepRace(state, trackOf(state), RACE),
  // A person is back: the car the autopilot has been driving is theirs again. Called only for
  // people, so a bot's car is never taken by this.
  rejoin: (state, publicId) => {
    const i = state.index[publicId];
    const car = i === undefined ? undefined : state.cars[i];
    if (i === undefined || car === undefined || !car.bot) return state;
    const cars = [...state.cars];
    // No keys: the autopilot has been setting them each tick and the client sends a mask only
    // when it changes, so a key left over would be held until the player pressed and released it.
    // A finished car keeps cruising; the full pace would make it a faster roadblock.
    cars[i] = {
      ...car,
      bot: false,
      abandoned: false,
      keys: 0,
      pace: car.finish === null ? 100 : RACE.coolPace,
    };
    return { ...state, cars };
  },
  // The car stays and is driven on by the autopilot, like a finished car: a parked car would be
  // a wall for the others. Its keys are released so that it does not hold the last ones forever.
  abandon: (state, publicId) => {
    const i = state.index[publicId];
    const car = i === undefined ? undefined : state.cars[i];
    if (i === undefined || car === undefined || car.bot) return state;
    const cars = [...state.cars];
    cars[i] = { ...car, bot: true, abandoned: true, keys: 0, pace: RACE.coolPace };
    return { ...state, cars };
  },
  finish: (state, names) => ({
    ...state,
    results: raceResults(state, trackOf(state), RACE, names),
  }),
  // Back to a lobby: the same players, none of the round.
  clear: (state) =>
    withCars(
      { ...state, tick: 0, onGrid: false, firstFinish: null, results: null },
      state.cars.map((car) => ({
        ...newCar(car.slot, car.publicId, car.bot),
        abandoned: car.abandoned,
      })),
    ),
  over: (state) => over(state, RACE),
  bots: true,
};
