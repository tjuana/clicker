import type { RaceDeltaMessage, RaceFullMessage } from '@clicker/protocol';

/** The bits of `RaceCar.flags`, as the rules set them. */
export const FINISHED = 1;
export const GRASS = 2;
export const WALL = 4;
export const TOUCHING = 8;

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
 * that joined after the last full — and the caller then asks for the whole race. Returns the same
 * model for a tick already seen, which a connection can receive before its own full.
 */
export function applyDelta(
  model: RaceModel,
  delta: RaceDeltaMessage,
): { model: RaceModel; events: RaceDeltaMessage['events'] } | null {
  if (delta.t <= model.tick) return { model, events: [] };

  const order: number[] = [];
  const cars = new Map<number, RaceCar>();
  for (let i = 0; i + TUPLE <= delta.cars.length; i += TUPLE) {
    const slot = delta.cars[i] as number;
    if (!model.info.has(slot)) return null;
    order.push(slot);
    cars.set(slot, {
      slot,
      x: delta.cars[i + 1] as number,
      y: delta.cars[i + 2] as number,
      heading: delta.cars[i + 3] as number,
      speed: delta.cars[i + 4] as number,
      lap: delta.cars[i + 5] as number,
      flags: delta.cars[i + 6] as number,
    });
  }
  return { model: { ...model, tick: delta.t, order, cars }, events: delta.events };
}
