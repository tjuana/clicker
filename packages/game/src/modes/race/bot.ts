import type { Bins } from './bins';
import { BRAKE, type Car, GAS, LEFT, RIGHT } from './car';
import type { RaceConfig } from './config';
import { cos, ONE, sin, TILE } from './fixed';
import { point, project, type Track } from './track';

/** The cars in the same bin and the eight round it, `index` itself excluded. */
function neighbours(bins: Bins, index: number): number[] {
  const { width, height, head, next } = bins;
  const home = bins.bin[index] as number;
  const bx = home % width;
  const by = Math.floor(home / width);
  const found: number[] = [];
  for (let ny = Math.max(0, by - 1); ny <= Math.min(height - 1, by + 1); ny += 1) {
    for (let nx = Math.max(0, bx - 1); nx <= Math.min(width - 1, bx + 1); nx += 1) {
      for (let j = head[ny * width + nx] as number; j >= 0; j = next[j] as number) {
        if (j !== index) found.push(j);
      }
    }
  }
  return found;
}

/**
 * The lane to drive in: the bot's own, unless a car ahead in it is close, in which case the
 * freer side of that car, if nobody is driving there alongside.
 *
 * Only the cars in the bot's own and neighbouring bins are looked at, so the cost does not grow
 * with the field. A prototype that scanned every car for every bot was the O(n²) this replaces.
 */
function chooseLane(
  index: number,
  cars: Car[],
  bins: Bins,
  track: Track,
  config: RaceConfig,
  mine: number,
  lane: number,
): number {
  const { bot } = config;
  const { length } = track;
  const wrap = (d: number) => ((d % length) + length) % length;
  const near = neighbours(bins, index).map((j) => {
    const other = cars[j] as Car;
    const place = project(track, other.piece, other.x, other.y);
    const there = (track.pieces[other.piece]?.start ?? 0) + place.along;
    // Round the lap: a car just behind the line is just behind it, not nearly a lap ahead.
    return { slot: other.slot, ahead: wrap(there - mine), lateral: place.lateral };
  });

  let blocker: (typeof near)[number] | null = null;
  for (const o of near) {
    if (o.ahead <= 0 || o.ahead > bot.blockGap || Math.abs(o.lateral - lane) >= bot.blockWidth) {
      continue;
    }
    // The nearest, the lower slot on a tie: the answer must not depend on the cars' order.
    if (
      blocker === null ||
      o.ahead < blocker.ahead ||
      (o.ahead === blocker.ahead && o.slot < blocker.slot)
    ) {
      blocker = o;
    }
  }
  if (blocker === null) return lane;

  const want =
    blocker.lateral > 0
      ? Math.max(-bot.swerveMax, blocker.lateral - bot.swerve)
      : Math.min(bot.swerveMax, blocker.lateral + bot.swerve);
  const taken = near.some((o) => {
    const alongside = Math.abs(wrap(o.ahead + length / 2) - length / 2);
    return alongside < bot.freeGap && Math.abs(o.lateral - want) < bot.freeWidth;
  });
  return taken ? lane : want;
}

/** The speed to hold: top speed at the bot's pace, or less for the slowest corner it will reach. */
function speedLimit(car: Car, along: number, track: Track, config: RaceConfig): number {
  const { pieces } = track;
  const { bot } = config;
  let limit = Math.round((config.topSpeed * car.pace) / 100);
  const speed = Math.max(0, car.speed);
  // Distance to stop from here at the brakes' pace, plus room; a corner nearer than this
  // (and a horizon beyond) must already be taken at its own speed. The loop therefore visits
  // the few pieces in that distance, not the track.
  const reach = (speed * speed) / (2 * config.brake) + bot.slack + bot.horizon;
  let at = car.piece;
  let distance = (pieces[at]?.length ?? 0) - along;
  const take = (i: number) => {
    const piece = pieces[i];
    if (piece?.kind !== 'corner') return;
    const size = Math.round((piece.rc + TILE / 2) / TILE);
    limit = Math.min(limit, bot.cornerSpeed[size - 1] ?? limit);
  };
  take(at);
  while (distance < reach) {
    at = (at + 1) % pieces.length;
    take(at);
    distance += pieces[at]?.length ?? 0;
  }
  return limit;
}

/**
 * The key mask of bot `index` for this tick: steer at a point on its lane a little ahead, with
 * the gas down until the speed it may hold, the brake down when it is far over. `bins` are the
 * cars as they stand at the start of the tick, so that every bot decides from the same picture.
 */
export function decide(
  index: number,
  cars: Car[],
  bins: Bins,
  track: Track,
  config: RaceConfig,
): number {
  const car = cars[index] as Car;
  const { bot } = config;
  const { pieces } = track;
  const here = project(track, car.piece, car.x, car.y);
  const mine = (pieces[car.piece]?.start ?? 0) + here.along;
  const lane = chooseLane(index, cars, bins, track, config, mine, ((car.slot % 3) - 1) * bot.lane);

  const ahead =
    bot.lookBase + Math.round((bot.lookSpeed * Math.max(0, car.speed)) / config.topSpeed);
  let at = car.piece;
  let along = here.along + ahead;
  while (along > (pieces[at]?.length ?? 0)) {
    along -= pieces[at]?.length ?? 0;
    at = (at + 1) % pieces.length;
  }
  const target = point(track, at, along, lane);
  // The cross product's sign says which side the target is on; no angle is ever computed.
  const cross = Math.trunc(
    (cos(car.heading) * (target.y - car.y) - sin(car.heading) * (target.x - car.x)) / ONE,
  );

  const limit = speedLimit(car, here.along, track, config);
  let keys = 0;
  if (cross > bot.deadZone) keys |= RIGHT;
  else if (cross < -bot.deadZone) keys |= LEFT;
  if (car.speed < limit) keys |= GAS;
  else if (car.speed > limit + config.brake) keys |= BRAKE;
  return keys;
}
