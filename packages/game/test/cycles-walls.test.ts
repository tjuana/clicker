import { describe, expect, it } from 'vitest';
import { addPlayer, applyInput, createCyclesState, leave, startRound } from '../src/modes/cycles';
import type { CyclesState } from '../src/modes/cycles/state';
import { step } from '../src/modes/cycles/step';
import { arena, contradiction, cyclesConfig, trailOf } from './cycles-support';

const button = cyclesConfig({ walls: 'button' });

function wall(state: CyclesState, publicId: string, on: boolean, config = button): CyclesState {
  return applyInput(state, publicId, { type: 'wall', on }, config);
}

function ride(state: CyclesState, ticks: number, config = button): CyclesState {
  let current = state;
  for (let tick = 0; tick < ticks; tick += 1) current = step(current, config).state;
  return current;
}

function bikeOf(state: CyclesState, slot: number) {
  const bike = state.bikes[slot - 1];
  if (bike === undefined) throw new Error(`no bike ${slot}`);
  return bike;
}

describe('a bike that is not laying its wall', () => {
  it('leaves its previous cell empty as it moves, and its trail does not grow', () => {
    const state = arena(10, [{ x: 3, y: 3, dir: 0, behind: [[2, 3]] }], button);
    const { state: after } = step(state, button);
    expect(after.field[3 * 10 + 3]).toBe(0);
    expect(after.field[3 * 10 + 4]).toBe(1);
    expect(trailOf(after, 1)).toEqual([
      [2, 3],
      [4, 3],
    ]);
    expect(contradiction(after)).toBeNull();
  });

  it('is not laying a wall at all when freshly placed in button mode', () => {
    let state = createCyclesState(3);
    state = addPlayer(state, 'a', false, button);
    state = addPlayer(state, 'b', true, button);
    state = startRound(state, button);
    expect(state.bikes.map((bike) => bike.lit)).toEqual([false, false]);
    expect(state.bikes.map((bike) => bike.energy)).toEqual([
      button.energyTicks,
      button.energyTicks,
    ]);
  });

  it('regains one unit of energy per two ticks, and never more than its capacity', () => {
    const state = arena(40, [{ x: 2, y: 20, dir: 0, energy: 0, energyCap: 4 }], button);
    const energies = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(
      (ticks) => bikeOf(ride(state, ticks), 1).energy,
    );
    expect(energies).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4, 4]);
  });
});

describe('a bike laying its wall', () => {
  it('spends one unit per cell, and two per tick while boosting', () => {
    let state = arena(60, [{ x: 2, y: 20, dir: 0, energy: 10 }], button);
    state = wall(state, '1', true);
    expect(bikeOf(state, 1).lit).toBe(true);
    expect(bikeOf(ride(state, 3), 1).energy).toBe(7);
    const boosting = applyInput(state, '1', { type: 'boost' }, button);
    expect(bikeOf(ride(boosting, 1), 1).energy).toBe(8);
    expect(trailOf(ride(boosting, 1), 1)).toHaveLength(3);
  });

  it('stops laying at zero, is not relit by holding on, and relights on a fresh press', () => {
    let state = arena(60, [{ x: 2, y: 20, dir: 0, energy: 2 }], button);
    state = ride(wall(state, '1', true), 2);
    expect(bikeOf(state, 1).energy).toBe(0);
    expect(bikeOf(state, 1).lit).toBe(false);
    // The key is still down. A press while held changes nothing, and energy coming back does not light it.
    state = ride(wall(state, '1', true), 4);
    expect(bikeOf(state, 1).energy).toBeGreaterThan(0);
    expect(bikeOf(state, 1).lit).toBe(false);
    const behind = bikeOf(state, 1).x - 1;
    expect(state.field[20 * 60 + behind]).toBe(0);

    state = wall(wall(state, '1', false), '1', true);
    expect(bikeOf(state, 1).lit).toBe(true);
    const after = ride(state, 1);
    expect(after.field[20 * 60 + bikeOf(state, 1).x]).toBe(1);
  });

  it('cannot be lit with no energy', () => {
    const state = wall(arena(20, [{ x: 2, y: 5, dir: 0, energy: 0 }], button), '1', true);
    expect(bikeOf(state, 1).lit).toBe(false);
  });

  it('goes out when the key is released', () => {
    let state = arena(20, [{ x: 2, y: 5, dir: 0 }], button);
    state = wall(wall(state, '1', true), '1', false);
    expect(bikeOf(state, 1).lit).toBe(false);
  });

  it('is not touched by a repeated press', () => {
    const state = wall(arena(20, [{ x: 2, y: 5, dir: 0 }], button), '1', true);
    expect(wall(state, '1', true)).toBe(state);
  });
});

describe('kills and respawns in button mode', () => {
  const config = cyclesConfig({ walls: 'button', rubber: 0, respawnTicks: 1 });
  // Bike 2 rides south into the wall of bike 1, which is lit and riding east along y = 3.
  const staged = (energyCap: number) =>
    arena(
      12,
      [
        {
          x: 5,
          y: 3,
          dir: 0,
          behind: [
            [2, 3],
            [3, 3],
            [4, 3],
          ],
          cap: 9,
          lit: true,
          energy: 30,
          energyCap,
        },
        { x: 3, y: 2, dir: 1, behind: [[3, 1]], cap: 9 },
      ],
      config,
    );

  it('grows the killer capacity by the kill reward, and its energy as much', () => {
    const killer = bikeOf(step(staged(80), config).state, 1);
    expect(killer.kills).toBe(1);
    expect(killer.energyCap).toBe(80 + config.energyKillTicks);
    // One cell was ridden lit, then the reward came.
    expect(killer.energy).toBe(29 + config.energyKillTicks);
    expect(killer.cap).toBe(9);
  });

  it('stops growing the capacity at the maximum', () => {
    const killer = bikeOf(step(staged(config.energyMaxTicks - 5), config).state, 1);
    expect(killer.energyCap).toBe(config.energyMaxTicks);
    expect(killer.energy).toBe(29 + config.energyKillTicks);
  });

  it('never lifts the energy above the capacity', () => {
    const state = staged(40);
    const full = { ...state, bikes: [{ ...bikeOf(state, 1), energy: 40 }, bikeOf(state, 2)] };
    const killer = bikeOf(step(full, config).state, 1);
    expect(killer.energy).toBeLessThanOrEqual(killer.energyCap);
  });

  it('gives a respawned bike the starting capacity and a full store', () => {
    let state = arena(12, [{ x: 11, y: 5, dir: 0, lit: true, energy: 7, energyCap: 120 }], config);
    state = ride(state, 1, config);
    expect(bikeOf(state, 1).alive).toBe(false);
    state = ride(state, 2, config);
    const reborn = bikeOf(state, 1);
    expect(reborn.alive).toBe(true);
    expect(reborn.energy).toBe(config.energyTicks);
    expect(reborn.energyCap).toBe(config.energyTicks);
    expect(reborn.lit).toBe(false);
  });
});

describe('two bikes without walls', () => {
  it('face to face in neighbouring cells, both stall instead of swapping places', () => {
    const state = arena(
      10,
      [
        { x: 3, y: 3, dir: 0 },
        { x: 4, y: 3, dir: 2 },
      ],
      button,
    );
    const after = step(state, button).state;
    expect(trailOf(after, 1)).toEqual([[3, 3]]);
    expect(trailOf(after, 2)).toEqual([[4, 3]]);
    expect(bikeOf(after, 1).rubber).toBe(button.rubber - 1);
    expect(bikeOf(after, 2).rubber).toBe(button.rubber - 1);
    expect(contradiction(after)).toBeNull();
  });

  it('both advance when one follows directly behind the other', () => {
    const state = arena(
      10,
      [
        { x: 4, y: 3, dir: 0 },
        { x: 3, y: 3, dir: 0 },
      ],
      button,
    );
    const after = step(state, button).state;
    expect(trailOf(after, 1)).toEqual([[5, 3]]);
    expect(trailOf(after, 2)).toEqual([[4, 3]]);
    expect(bikeOf(after, 1).rubber).toBe(button.rubber);
    expect(bikeOf(after, 2).rubber).toBe(button.rubber);
  });

  it('a lit follower keeps its wall behind the bike in front', () => {
    const state = arena(
      10,
      [
        { x: 4, y: 3, dir: 0 },
        { x: 3, y: 3, dir: 0, lit: true },
      ],
      button,
    );
    const after = step(state, button).state;
    expect(trailOf(after, 1)).toEqual([[5, 3]]);
    expect(trailOf(after, 2)).toEqual([
      [3, 3],
      [4, 3],
    ]);
  });
});

describe('the always mode', () => {
  const always = cyclesConfig();
  it('ignores a wall input', () => {
    const state = arena(10, [{ x: 3, y: 3, dir: 0 }], always);
    expect(wall(state, '1', true, always)).toBe(state);
    expect(wall(state, '1', false, always)).toBe(state);
  });

  it('keeps laying a wall and spends nothing', () => {
    const state = arena(40, [{ x: 3, y: 3, dir: 0 }], always);
    const after = ride(state, 5, always);
    expect(bikeOf(after, 1).lit).toBe(true);
    expect(bikeOf(after, 1).energy).toBe(always.energyTicks);
    expect(trailOf(after, 1)).toHaveLength(6);
  });
});

describe('replays', () => {
  function round(seed: number): CyclesState {
    let state = createCyclesState(seed);
    state = addPlayer(state, 'human', false, button);
    for (let i = 0; i < 5; i += 1) state = addPlayer(state, `bot-${i}`, true, button);
    state = startRound(state, button);
    // A tiny LCG, not Math.random: the test must replay the same game on every run.
    let lcg = seed;
    const next = (bound: number): number => {
      lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
      return lcg % bound;
    };
    for (let tick = 0; tick < 400; tick += 1) {
      const roll = next(10);
      if (roll < 4) state = wall(state, 'human', roll < 2);
      if (roll === 4) state = applyInput(state, 'human', { type: 'boost' }, button);
      if (roll === 5) state = applyInput(state, 'human', { type: 'turn', side: 'left' }, button);
      state = step(state, button).state;
      const broken = contradiction(state);
      if (broken !== null) throw new Error(`seed ${seed}, tick ${tick}: ${broken}`);
    }
    return state;
  }

  it('give bit-identical states from the same inputs, with walls on a key', () => {
    for (const seed of [1, 2, 3]) {
      const a = round(seed);
      const b = round(seed);
      expect(Array.from(a.field)).toEqual(Array.from(b.field));
      const summary = (state: CyclesState) =>
        state.bikes.map((bike) => [
          bike.x,
          bike.y,
          bike.dir,
          bike.energy,
          bike.energyCap,
          bike.energyRegen,
          bike.lit,
          bike.held,
          bike.kills,
          bike.deaths,
        ]);
      expect(summary(a)).toEqual(summary(b));
      expect(a.seed).toBe(b.seed);
    }
  });
});

describe('a rider who comes back', () => {
  function twoRiders(): CyclesState {
    let state = createCyclesState(3);
    state = addPlayer(state, 'a', false, button);
    state = addPlayer(state, 'b', false, button);
    return startRound(state, button);
  }

  it('does not remember the key it let go of while its socket was down', () => {
    let state = twoRiders();
    state = wall(state, 'a', true);
    state = leave(state, 'a');
    state = ride(state, 1);
    // The key was released while the connection was closed; the room never heard of it.
    state = addPlayer(state, 'a', false, button);
    state = ride(state, button.respawnTicks + 1);
    expect(bikeOf(state, 1).alive).toBe(true);

    state = wall(state, 'a', true);

    expect(bikeOf(state, 1).lit).toBe(true);
  });

  it('keeps its wall when the same player joins again from a second tab', () => {
    const always = cyclesConfig({ walls: 'always' });
    let state = createCyclesState(3);
    state = addPlayer(state, 'a', false, always);
    state = addPlayer(state, 'b', false, always);
    state = ride(startRound(state, always), 3, always);

    state = addPlayer(state, 'a', false, always);

    expect(bikeOf(state, 1).lit).toBe(true);
    expect(bikeOf(state, 1).alive).toBe(true);
  });
});
