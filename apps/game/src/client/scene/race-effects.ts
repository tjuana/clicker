import type { Sample } from '../race/timeline';

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

// Stub: emits nothing yet.
export function createRaceEffects(
  _pools: { dust: Spawner; sparks: Spawner },
  _random: () => number,
) {
  return { update(_sample: Sample, _now: number, _dt: number): void {} };
}
