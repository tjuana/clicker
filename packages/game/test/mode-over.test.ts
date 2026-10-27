import { describe, expect, it } from 'vitest';
import { RACE } from '../src/modes/race/config';
import type { RaceState } from '../src/modes/race/state';
import { apply } from '../src/room/apply';
import { configFor } from '../src/room/config';
import type { RoomState } from '../src/room/state';
import { cyclesOf, lobbyWithHost, raceOf, run } from './support';

const RACE_CONFIG = configFor('race');
const CYCLES = configFor('cycles');

/** A running round of `mode` with the host and two bots; `goAt` is when it began. */
function running(mode: 'race' | 'cycles', settings = configFor(mode)) {
  const lobby = run(
    lobbyWithHost(),
    [
      { type: 'setMode', playerId: 'host', mode },
      { type: 'addBot', playerId: 'host' },
      { type: 'addBot', playerId: 'host' },
    ],
    0,
    settings,
  );
  const started = apply(lobby, { type: 'start', playerId: 'host' }, 0, settings).state;
  const goAt = started.round?.goAt ?? 0;
  const state = apply(started, { type: 'tick' }, goAt, settings).state;
  expect(state.phase).toBe('running');
  return { state, goAt, settings };
}

function withRace(state: RoomState, change: (race: RaceState) => RaceState): RoomState {
  return { ...state, modeState: change(raceOf(state)) };
}

describe('a mode that ends its own round', () => {
  it('moves a race whose cars have all finished to the results at the next command', () => {
    const { state, goAt } = running('race');
    const done = withRace(state, (race) => ({
      ...race,
      tick: 200,
      firstFinish: 150,
      cars: race.cars.map((car) => ({ ...car, finish: 150 })),
    }));

    const next = apply(done, { type: 'tick' }, goAt + 1, RACE_CONFIG);

    expect(next.state.phase).toBe('results');
    expect(next.events).toContainEqual({ type: 'phaseChanged', phase: 'results' });
    expect(raceOf(next.state).results).toHaveLength(3);
  });

  it('keeps a race going while a car is still on the road', () => {
    const { state, goAt } = running('race');
    const one = withRace(state, (race) => ({
      ...race,
      tick: 200,
      firstFinish: 150,
      cars: race.cars.map((car, i) => (i === 0 ? { ...car, finish: 150 } : car)),
    }));

    expect(apply(one, { type: 'tick' }, goAt + 1, RACE_CONFIG).state.phase).toBe('running');
  });

  it('ends a race thirty seconds of ticks after the first finisher', () => {
    const { state, goAt } = running('race');
    const at = (tick: number) =>
      withRace(state, (race) => ({
        ...race,
        tick,
        firstFinish: 100,
        cars: race.cars.map((car, i) => (i === 0 ? { ...car, finish: 100 } : car)),
      }));

    const before = apply(at(100 + RACE.afterFirst - 1), { type: 'tick' }, goAt + 1, RACE_CONFIG);
    const after = apply(at(100 + RACE.afterFirst), { type: 'tick' }, goAt + 1, RACE_CONFIG);

    expect(before.state.phase).toBe('running');
    expect(after.state.phase).toBe('results');
  });

  it('never ends a light-cycle round this way, whoever is left on the field', () => {
    const { state, goAt } = running('cycles', CYCLES);
    const dead = {
      ...state,
      modeState: {
        ...cyclesOf(state),
        bikes: cyclesOf(state).bikes.map((bike) => ({ ...bike, alive: false })),
      },
    };

    expect(apply(dead, { type: 'tick' }, goAt + 1, CYCLES).state.phase).toBe('running');
  });
});
