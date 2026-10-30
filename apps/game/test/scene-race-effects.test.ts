import { AT_WALL, ON_GRASS, TOUCHING, TURN } from '@clicker/game';
import { describe, expect, it } from 'vitest';
import type { Sample, SampledCar } from '../src/client/race/timeline';
import { createRaceEffects } from '../src/client/scene/race-effects';
import { DUST, SPARKS } from '../src/client/scene/race-look';

interface Birth {
  x: number;
  y: number;
  z: number;
}

function harness() {
  const dust: Birth[] = [];
  const sparks: Birth[] = [];
  const recorder = (into: Birth[]) => ({
    spawn: (x: number, y: number, z: number) => void into.push({ x, y, z }),
  });
  const fx = createRaceEffects({ dust: recorder(dust), sparks: recorder(sparks) }, () => 0.5);
  return { dust, sparks, fx };
}

const car = (slot: number, over: Partial<SampledCar> = {}): SampledCar => ({
  slot,
  x: 0,
  y: 0,
  heading: 0,
  speed: 0,
  lap: 0,
  flags: 0,
  alpha: 1,
  ...over,
});
const sample = (...cars: SampledCar[]): Sample => ({ alpha: 1, count: cars.length, cars });

const DT = 1 / 60;
/** Frames for `seconds`, the sample being the same each time; returns the clock after. */
function run(fx: ReturnType<typeof harness>['fx'], s: Sample, seconds: number, from = 0): number {
  let now = from;
  for (let i = 0; i < Math.round(seconds * 60); i += 1) {
    fx.update(s, now, DT);
    now += DT;
  }
  return now;
}

const fast = (floor: number) => floor + 50;

describe('dust', () => {
  it('is not raised by a car on the road', () => {
    const h = harness();
    run(h.fx, sample(car(0, { speed: fast(DUST.minSpeed) })), 1);
    expect(h.dust).toHaveLength(0);
  });

  it('comes at its rate a second from a car on the grass at speed', () => {
    const h = harness();
    run(h.fx, sample(car(0, { flags: ON_GRASS, speed: fast(DUST.minSpeed) })), 1);
    expect(Math.abs(h.dust.length - DUST.rate)).toBeLessThanOrEqual(1);
    expect(h.sparks).toHaveLength(0);
  });

  it('is raised behind the car, on the side opposite its heading', () => {
    for (const quarter of [0, 1, 2, 3]) {
      const h = harness();
      const heading = (quarter * TURN) / 4;
      const c = car(0, { x: 5000, y: -3000, heading, flags: ON_GRASS, speed: fast(DUST.minSpeed) });
      run(h.fx, sample(c), 1);
      expect(h.dust.length).toBeGreaterThan(0);
      const a = (heading / TURN) * 2 * Math.PI;
      const cx = c.x / 4096;
      const cz = c.y / 4096;
      for (const b of h.dust) {
        expect((b.x - cx) * Math.cos(a) + (b.z - cz) * Math.sin(a)).toBeLessThan(0);
      }
    }
  });

  it('is not raised below the minimum speed', () => {
    const h = harness();
    run(h.fx, sample(car(0, { flags: ON_GRASS, speed: DUST.minSpeed - 1 })), 1);
    expect(h.dust).toHaveLength(0);
  });
});

describe('sparks at a wall', () => {
  it('come at their rate a second while scraping at speed', () => {
    const h = harness();
    run(h.fx, sample(car(0, { flags: AT_WALL, speed: fast(SPARKS.minSpeed) })), 1);
    expect(Math.abs(h.sparks.length - SPARKS.rate)).toBeLessThanOrEqual(1);
    expect(h.dust).toHaveLength(0);
  });

  it('do not come below the minimum speed', () => {
    const h = harness();
    run(h.fx, sample(car(0, { flags: AT_WALL, speed: SPARKS.minSpeed - 1 })), 1);
    expect(h.sparks).toHaveLength(0);
  });
});

describe('sparks on contact', () => {
  const touching = (slot = 0) => car(slot, { flags: TOUCHING, speed: 10 });
  const apart = (slot = 0) => car(slot, { speed: 10 });

  it('burst once when contact begins, and not again while it lasts', () => {
    const h = harness();
    const now = run(h.fx, sample(apart()), 0.1);
    run(h.fx, sample(touching()), 1, now);
    expect(h.sparks).toHaveLength(SPARKS.burst);
  });

  it('burst again when contact ends and begins anew', () => {
    const h = harness();
    let now = run(h.fx, sample(touching()), 0.2);
    now = run(h.fx, sample(apart()), 0.2, now);
    run(h.fx, sample(touching()), 0.2, now);
    expect(h.sparks).toHaveLength(2 * SPARKS.burst);
  });

  it('keep each car its own state', () => {
    const h = harness();
    let now = run(h.fx, sample(touching(0), apart(1)), 0.2);
    expect(h.sparks).toHaveLength(SPARKS.burst);
    now = run(h.fx, sample(touching(0), touching(1)), 0.2, now);
    expect(h.sparks).toHaveLength(2 * SPARKS.burst);
    run(h.fx, sample(apart(0), touching(1)), 0.2, now);
    expect(h.sparks).toHaveLength(2 * SPARKS.burst);
  });

  it('are not repeated for a contact a slot had before it left and came back', () => {
    const h = harness();
    let now = run(h.fx, sample(touching(0), apart(1)), 0.2);
    const bursts = h.sparks.length;
    now = run(h.fx, sample(apart(1)), 0.2, now);
    run(h.fx, sample(touching(0), apart(1)), 0.2, now);
    expect(h.sparks).toHaveLength(bursts);
  });
});
