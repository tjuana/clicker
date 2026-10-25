import { CYCLES_CONFIG, type CyclesConfig } from '../src/modes/cycles/config';
import type { Bike, CyclesState } from '../src/modes/cycles/state';
import { emptyTrail, forEachCell, pushNewest } from '../src/modes/cycles/trail';

export function cyclesConfig(overrides: Partial<CyclesConfig> = {}): CyclesConfig {
  return { ...CYCLES_CONFIG, ...overrides };
}

export interface BikeSpec {
  x: number;
  y: number;
  dir: number;
  /** Earlier cells of the trail, oldest first; the head is appended after them. */
  behind?: [number, number][];
  cap?: number;
  rubber?: number;
  bot?: boolean;
  turns?: ('left' | 'right')[];
  /** Laying a wall now; defaults to what the config's wall mode gives a fresh bike. */
  lit?: boolean;
  energy?: number;
  energyCap?: number;
}

/**
 * A hand-built field: the only honest way to stage a head-on collision or a tail chase at an
 * exact cell, which a random game would reach rarely and never on purpose.
 */
export function arena(side: number, specs: BikeSpec[], config = cyclesConfig()): CyclesState {
  const field = new Uint16Array(side * side);
  const bikes: Bike[] = specs.map((spec, position) => {
    const slot = position + 1;
    const trail = emptyTrail(config.trailMax);
    for (const [x, y] of [...(spec.behind ?? []), [spec.x, spec.y] as [number, number]]) {
      pushNewest(trail, y * side + x);
      field[y * side + x] = slot;
    }
    return {
      slot,
      publicId: String(slot),
      bot: spec.bot ?? false,
      alive: true,
      left: false,
      x: spec.x,
      y: spec.y,
      dir: spec.dir,
      trail,
      cap: spec.cap ?? config.trail,
      rubber: spec.rubber ?? config.rubber,
      regen: 0,
      boost: 0,
      cooldown: 0,
      turns: spec.turns ?? [],
      respawnIn: 0,
      kills: 0,
      deaths: 0,
      life: 0,
      longest: 0,
      held: false,
      lit: spec.lit ?? config.walls === 'always',
      energy: spec.energy ?? config.energyTicks,
      energyCap: spec.energyCap ?? config.energyTicks,
      energyRegen: 0,
    };
  });
  const index: Record<string, number> = {};
  bikes.forEach((bike, position) => {
    index[bike.publicId] = position;
  });
  return { side, field, bikes, index, seed: 7, tick: 0, results: null };
}

export function trailOf(state: CyclesState, slot: number): [number, number][] {
  const bike = state.bikes[slot - 1];
  const cells: [number, number][] = [];
  if (bike === undefined) return cells;
  forEachCell(bike.trail, (cell) => cells.push([cell % state.side, Math.floor(cell / state.side)]));
  return cells;
}

/**
 * What must hold after every tick of every game: the field and the trails tell the same story.
 * Returns a description of the first contradiction, or null.
 */
export function contradiction(state: CyclesState): string | null {
  let owned = 0;
  for (const bike of state.bikes) {
    if (bike.trail.size > bike.cap && bike.alive) return `slot ${bike.slot}: trail longer than cap`;
    let broken: string | null = null;
    forEachCell(bike.trail, (cell) => {
      if (state.field[cell] !== bike.slot) broken = `slot ${bike.slot}: cell ${cell} not in field`;
    });
    if (broken !== null) return broken;
    owned += bike.trail.size;
    if (!bike.alive && bike.trail.size !== 0) return `slot ${bike.slot}: dead bike keeps a trail`;
    if (bike.alive) {
      const head = bike.y * state.side + bike.x;
      const newest =
        bike.trail.cells[(bike.trail.start + bike.trail.size - 1) % bike.trail.cells.length];
      if (head !== newest) return `slot ${bike.slot}: head is not the newest trail cell`;
    }
  }
  let occupied = 0;
  for (const cell of state.field) if (cell !== 0) occupied += 1;
  if (occupied !== owned) return `field has ${occupied} occupied cells, trails own ${owned}`;
  return null;
}
