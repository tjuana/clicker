import { AT_WALL, ON_GRASS, TILE, TOUCHING, TURN } from '@clicker/game';
import { MAX_SLOTS, type Sample } from '../race/timeline';
import { DUST, SPARKS } from './race-look';

export interface Spawner {
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    now: number,
  ): void;
}

/** Rules units a tick to tiles a second, as the prototype found it reads right on screen. */
const SPEED = 30 / 4096;

/**
 * Which car emits what, from the flags every delta carries. Dust: on the grass at speed. Sparks:
 * scraping a wall at speed, and one burst when contact with another car begins. The rate is paid
 * by a fractional debt per pool, so 1/60 frames still give the rate over a second.
 */
export function createRaceEffects(pools: { dust: Spawner; sparks: Spawner }, random: () => number) {
  /** Per slot, whether it was touching at the last update; kept while the slot is away. */
  const touching = new Uint8Array(MAX_SLOTS);
  let dustDebt = 0;
  let sparkDebt = 0;

  function spark(x: number, z: number, c: number, s: number, v: number, now: number): void {
    pools.sparks.spawn(
      x + c * 0.1,
      0.05,
      z + s * 0.1,
      c * v * 0.5 + (random() - 0.5) * 1.2,
      0.4 + random() * 0.8,
      s * v * 0.5 + (random() - 0.5) * 1.2,
      SPARKS.life,
      SPARKS.size,
      now,
    );
  }

  return {
    update(sample: Sample, now: number, dt: number): void {
      dustDebt += dt * DUST.rate;
      sparkDebt += dt * SPARKS.rate;
      const dustN = Math.floor(dustDebt);
      const sparkN = Math.floor(sparkDebt);
      dustDebt -= dustN;
      sparkDebt -= sparkN;
      for (let k = 0; k < sample.count; k += 1) {
        const car = sample.cars[k];
        if (car === undefined) continue;
        const a = (car.heading / TURN) * 2 * Math.PI;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const x = car.x / TILE;
        const z = car.y / TILE;
        const v = car.speed * SPEED;
        if ((car.flags & ON_GRASS) !== 0 && car.speed >= DUST.minSpeed) {
          for (let n = 0; n < dustN; n += 1) {
            pools.dust.spawn(
              x - c * 0.12,
              0.02,
              z - s * 0.12,
              -c * v * 0.2 + (random() - 0.5) * 0.2,
              0.1 + random() * 0.1,
              -s * v * 0.2 + (random() - 0.5) * 0.2,
              DUST.life,
              DUST.size,
              now,
            );
          }
        }
        if ((car.flags & AT_WALL) !== 0 && car.speed >= SPARKS.minSpeed) {
          for (let n = 0; n < sparkN; n += 1) spark(x, z, c, s, v, now);
        }
        const now1 = (car.flags & TOUCHING) !== 0 ? 1 : 0;
        if (now1 === 1 && touching[car.slot] === 0) {
          for (let n = 0; n < SPARKS.burst; n += 1) spark(x, z, c, s, v, now);
        }
        touching[car.slot] = now1;
      }
    },
  };
}
