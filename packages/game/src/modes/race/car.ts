import type { RaceConfig } from './config';
import { cos, ONE, sin, TURN } from './fixed';
import { point, project, type Track, walk } from './track';

export const GAS = 1;
export const BRAKE = 2;
export const LEFT = 4;
export const RIGHT = 8;

export interface Car {
  slot: number;
  /** The id other players see; the secret one never reaches the rules. */
  publicId: string;
  bot: boolean;
  x: number;
  y: number;
  /** In `TURN` steps; 0 is east, increasing clockwise as drawn (y down). */
  heading: number;
  /** Signed, along the heading: negative is reversing. */
  speed: number;
  piece: number;
  lap: number;
  keys: number;
  finish: number | null;
  best: number | null;
  lapStart: number;
  /** Percent of top speed this car can use; 100 for a human. */
  pace: number;
  /** Consecutive ticks the car has been touching a wall. */
  wall: number;
}

function accelerate(car: Car, config: RaceConfig, top: number): void {
  const { keys } = car;
  if (keys & GAS) {
    // Never pulled down by the gas itself: the grass drag slows a car entering grass gradually.
    if (car.speed < top) car.speed = Math.min(top, car.speed + config.accel);
  } else if (keys & BRAKE) {
    car.speed =
      car.speed > 0
        ? Math.max(0, car.speed - config.brake)
        : Math.max(-config.reverseSpeed, car.speed - config.accel);
  } else if (car.speed > 0) {
    car.speed = Math.max(0, car.speed - config.drag);
  } else {
    car.speed = Math.min(0, car.speed + config.drag);
  }
}

function steer(car: Car, config: RaceConfig): void {
  const wheel = ((car.keys & RIGHT) !== 0 ? 1 : 0) - ((car.keys & LEFT) !== 0 ? 1 : 0);
  if (wheel === 0) return;
  const speed = Math.abs(car.speed);
  // Integer form of turnRate × min(1, v / turnSpeed) × (1 − understeer × v / topSpeed).
  const rate = Math.round(
    (config.turnRate *
      Math.min(speed, config.turnSpeed) *
      (100 * config.topSpeed - config.understeer * speed)) /
      (config.turnSpeed * 100 * config.topSpeed),
  );
  car.heading = (car.heading + wheel * rate * (car.speed < 0 ? -1 : 1)) & (TURN - 1);
}

/**
 * One tick of a car: speed from the keys and the surface, heading from the wheel, a move, the
 * walk to the right piece, then the walls. Mutates the car, which is the step's own copy.
 * Returns how the start line was crossed on the way, +1 forward and -1 backward.
 */
export function drive(car: Car, track: Track, config: RaceConfig): number {
  const onRoad = Math.abs(walk(track, car.piece, car.x, car.y).lateral) <= config.road;
  const top = Math.round(((onRoad ? config.topSpeed : config.grassSpeed) * car.pace) / 100);
  accelerate(car, config, top);
  if (!onRoad && car.speed > config.grassSpeed) {
    car.speed = Math.max(config.grassSpeed, car.speed - config.grassDrag);
  }
  steer(car, config);
  car.x += Math.trunc((car.speed * cos(car.heading)) / ONE);
  car.y += Math.trunc((car.speed * sin(car.heading)) / ONE);

  const moved = walk(track, car.piece, car.x, car.y);
  car.piece = moved.piece;
  const hit = wall(car, track, config);
  if (!hit) return moved.crossed;
  const settled = walk(track, car.piece, car.x, car.y);
  car.piece = settled.piece;
  return moved.crossed + settled.crossed;
}

/**
 * Both circles are checked, and the deeper one decides. The car is pushed back by the overlap;
 * its speed is scaled by the cosine between heading and wall, taken once, so a glancing hit
 * keeps nearly all of it and a head-on hit none; and the nose turns a quarter of the way to the
 * wall's direction. Without that last part a car that hit head-on stays pointed into the wall at
 * zero speed, where the wheel does nothing, and never gets out.
 */
function wall(car: Car, track: Track, config: RaceConfig): boolean {
  const limit = config.wall - config.radius;
  let deepest = 0;
  let along = 0;
  let side = 0;
  for (const end of [config.reach, -config.reach]) {
    const cx = car.x + Math.trunc((end * cos(car.heading)) / ONE);
    const cy = car.y + Math.trunc((end * sin(car.heading)) / ONE);
    const place = project(track, car.piece, cx, cy);
    const over = Math.abs(place.lateral) - limit;
    if (over > deepest) {
      deepest = over;
      along = place.along;
      side = Math.sign(place.lateral);
    }
  }
  if (deepest === 0) {
    car.wall = 0;
    return false;
  }

  const tangent = point(track, car.piece, along, 0).heading;
  // The right-hand normal of the wall; the push is against the side that was crossed.
  const back = -side * deepest;
  car.x += Math.round((back * -sin(tangent)) / ONE);
  car.y += Math.round((back * cos(tangent)) / ONE);

  const dot = Math.max(
    -ONE,
    Math.min(
      ONE,
      Math.trunc((cos(car.heading) * cos(tangent) + sin(car.heading) * sin(tangent)) / ONE),
    ),
  );
  car.speed = Math.trunc((car.speed * Math.abs(dot)) / ONE);
  const target = dot >= 0 ? tangent : tangent + TURN / 2;
  const diff = ((target - car.heading + TURN / 2) & (TURN - 1)) - TURN / 2;
  car.heading = (car.heading + Math.round(diff / 4)) & (TURN - 1);
  car.wall += 1;
  return true;
}
