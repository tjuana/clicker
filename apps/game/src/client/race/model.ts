import { FINISHED } from '@clicker/game';
import type { RaceDeltaMessage, RaceFullMessage } from '@clicker/protocol';

/** Numbers per car in a delta: slot, x, y, heading, speed, lap, flags. */
const TUPLE = 7;

export interface RaceCar {
  slot: number;
  x: number;
  y: number;
  /** In steps of a turn (`TURN`), 0 ≤ heading < TURN. */
  heading: number;
  speed: number;
  lap: number;
  flags: number;
}

/** What a car keeps for the whole race; a delta does not repeat it. */
export interface CarInfo {
  id: string;
  bot: boolean;
  /** The tick it finished on, or null. */
  finish: number | null;
  /** Its best lap in ticks, or null. */
  best: number | null;
  /** The tick its current lap began on, or -1. */
  lapStart: number;
}

export interface RaceModel {
  track: string;
  laps: number;
  tickMs: number;
  /** Tick of the last message applied. */
  tick: number;
  /** slot → what is fixed for the race, from the last full. A slot not here is unknown. */
  info: Map<number, CarInfo>;
  /** Slots in the order of the race: the first is leading. Its index is the place. */
  order: number[];
  /** The latest state of every car, keyed by slot. */
  cars: Map<number, RaceCar>;
}

/** Starts over from a full message. Cars arrive in race order; they are keyed by slot, not by place. */
export function fromFull(full: RaceFullMessage): RaceModel {
  const info = new Map<number, CarInfo>();
  const order: number[] = [];
  const cars = new Map<number, RaceCar>();
  for (const car of full.cars) {
    info.set(car.slot, {
      id: car.id,
      bot: car.bot,
      finish: car.finish,
      best: car.best,
      lapStart: car.lapStart,
    });
    order.push(car.slot);
    cars.set(car.slot, {
      slot: car.slot,
      x: car.x,
      y: car.y,
      heading: car.heading,
      speed: car.speed,
      lap: car.lap,
      // A full says nothing of grass or contact: the next delta does.
      flags: car.finish !== null ? FINISHED : 0,
    });
  }
  return {
    track: full.track,
    laps: full.laps,
    tickMs: full.tickMs,
    tick: full.tick,
    info,
    order,
    cars,
  };
}

/**
 * Applies one delta. Every delta carries every car as it stands, so a gap in the ticks loses only
 * events and is not an error. Returns null when it names a slot the model has never seen — a car
 * that joined after the last full — and the caller then asks for the whole race, the model left
 * as it was. Returns the same model for a tick already seen, which a connection can receive before
 * its own full.
 *
 * Not the obvious copy: this runs thirty times a second, so the car objects, the `cars` map and
 * the `order` array of the model passed in are rewritten and handed on inside a new model object.
 * What the store sees change is the model object itself, and everything reads the model through
 * selectors that compute from it (a place, a flag, a count) on each update, never holding a car or
 * the array across one. Do not keep `model.cars` or `model.order` from before a delta.
 */
export function applyDelta(
  model: RaceModel,
  delta: RaceDeltaMessage,
): { model: RaceModel; events: RaceDeltaMessage['events'] } | null {
  if (delta.t <= model.tick) return { model, events: [] };

  // All slots are checked before any car is written: a refusal must leave the model whole.
  for (let i = 0; i + TUPLE <= delta.cars.length; i += TUPLE) {
    if (!model.info.has(delta.cars[i] as number)) return null;
  }

  const { order, cars } = model;
  order.length = 0;
  for (let i = 0; i + TUPLE <= delta.cars.length; i += TUPLE) {
    const slot = delta.cars[i] as number;
    order.push(slot);
    let car = cars.get(slot);
    if (car === undefined) {
      car = { slot, x: 0, y: 0, heading: 0, speed: 0, lap: 0, flags: 0 };
      cars.set(slot, car);
    }
    car.x = delta.cars[i + 1] as number;
    car.y = delta.cars[i + 2] as number;
    car.heading = delta.cars[i + 3] as number;
    car.speed = delta.cars[i + 4] as number;
    car.lap = delta.cars[i + 5] as number;
    car.flags = delta.cars[i + 6] as number;
  }
  // A car the delta no longer lists has left the field. Rare, so the scan may be slow.
  if (cars.size > order.length) {
    for (const slot of [...cars.keys()]) if (!order.includes(slot)) cars.delete(slot);
  }
  return { model: { ...model, tick: delta.t }, events: delta.events };
}
