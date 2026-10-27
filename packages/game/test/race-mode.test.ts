import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLES_SETTINGS } from '../src/modes/cycles/config';
import { random } from '../src/modes/cycles/random';
import { raceMode } from '../src/modes/race';
import { RACE } from '../src/modes/race/config';
import { over, raceResults, standings } from '../src/modes/race/race';
import type { RaceState } from '../src/modes/race/state';
import { buildTrack, type TrackData } from '../src/modes/race/track';
import { TRACKS } from '../src/modes/race/tracks';
import { config as gameConfig } from './support';

const config = gameConfig();
const settings = DEFAULT_CYCLES_SETTINGS;

function build(ids: string[], humans: Set<string>): RaceState {
  let state = raceMode.create(42);
  for (const id of ids) state = raceMode.addPlayer(state, id, !humans.has(id), 0, config, settings);
  return raceMode.startRound(state, 0, config, settings);
}

const ids = Array.from({ length: 20 }, (_, i) => `c${String(i).padStart(2, '0')}`);
const humans = new Set(['c03', 'c11']);

/** Every tick's state as text, with the humans fed masks from a seeded generator. */
function play(order: string[], ticks: number): { frames: string[]; last: RaceState } {
  let state = build(order, humans);
  let seed = 9;
  const frames: string[] = [];
  const sorted = [...humans].sort();
  for (let t = 0; t < ticks; t += 1) {
    for (const id of sorted) {
      const drawn = random(seed);
      seed = drawn.seed;
      state = raceMode.applyInput(
        state,
        id,
        { type: 'keys', mask: Math.floor(drawn.value * 16) },
        t,
        config,
        settings,
      );
    }
    state = (raceMode.step as NonNullable<typeof raceMode.step>)(state, settings).state;
    frames.push(JSON.stringify(state));
  }
  return { frames, last: state };
}

describe('the race mode', () => {
  it('runs twenty cars bit-identically twice', () => {
    const a = play(ids, 300);
    const b = play(ids, 300);
    expect(a.frames).toEqual(b.frames);
  });

  it('ranks the same whatever order the players were added in', () => {
    const shuffled = [...ids].reverse();
    shuffled.push(shuffled.splice(3, 1)[0] as string);
    const track = buildTrack(TRACKS.ring as TrackData);
    const rank = (s: RaceState) =>
      standings(s, track).map((slot) => s.cars.find((c) => c.slot === slot)?.publicId);
    const a = play(shuffled, 300).last;
    const b = play(ids, 300).last;
    expect(rank(a)).toEqual(rank(b));
    expect(JSON.stringify(a.cars.map((c) => [c.publicId, c.x, c.y]).sort())).toBe(
      JSON.stringify(b.cars.map((c) => [c.publicId, c.x, c.y]).sort()),
    );
  });

  it('never mutates the state it steps', () => {
    const state = build(ids, humans);
    const before = structuredClone(state);
    (raceMode.step as NonNullable<typeof raceMode.step>)(state, settings);
    expect(state).toEqual(before);
  });

  it('keeps only the four key bits', () => {
    const state = build(['a'], new Set(['a']));
    const next = raceMode.applyInput(state, 'a', { type: 'keys', mask: 0xff }, 0, config, settings);
    expect(next.cars[0]?.keys).toBe(15);
  });

  it('ignores foreign input, bots and finished cars', () => {
    const state = build(['a', 'b'], new Set(['a']));
    expect(raceMode.applyInput(state, 'a', { type: 'click' } as never, 0, config, settings)).toBe(
      state,
    );
    const keys = { type: 'keys', mask: 1 } as const;
    expect(raceMode.applyInput(state, 'b', keys, 0, config, settings)).toBe(state);
    const done = {
      ...state,
      cars: state.cars.map((c) => ({ ...c, finish: 5 })),
    };
    expect(raceMode.applyInput(done, 'a', keys, 0, config, settings)).toBe(done);
  });

  it('keeps the car of a player who left, and drives it on', () => {
    let state = build(['a', 'b'], new Set(['a', 'b']));
    state = raceMode.applyInput(state, 'a', { type: 'keys', mask: 1 }, 0, config, settings);
    state = raceMode.abandon(state, 'a');
    const step = raceMode.step as NonNullable<typeof raceMode.step>;
    for (let i = 0; i < 60; i += 1) state = step(state, settings).state;
    expect(state.cars).toHaveLength(2);
    expect(state.cars[0]?.speed).toBeGreaterThan(0);
  });

  it('finishes with results and clears back to a lobby', () => {
    const state = raceMode.finish(build(ids, humans), {});
    expect(state.results).toHaveLength(20);
    const cleared = raceMode.clear(state, settings);
    expect(cleared.results).toBeNull();
    expect(cleared.tick).toBe(0);
    expect(cleared.cars).toHaveLength(20);
    expect(RACE.laps).toBe(3);
  });

  describe('a player who joins in the middle of a race', () => {
    const step = raceMode.step as NonNullable<typeof raceMode.step>;
    function running(): RaceState {
      let state = build(['1', '2'], new Set(['1']));
      for (let i = 0; i < 40; i += 1) state = step(state, settings).state;
      return raceMode.addPlayer(state, '0', false, 0, config, settings);
    }
    const track = buildTrack(TRACKS.ring as TrackData);

    it('sits where it was put, off the field, and does not move', () => {
      let state = running();
      state = raceMode.applyInput(state, '0', { type: 'keys', mask: 1 }, 0, config, settings);
      const before = JSON.stringify(state.cars[state.index['0'] as number]);
      for (let i = 0; i < 30; i += 1) state = step(state, settings).state;
      expect(JSON.stringify(state.cars[state.index['0'] as number])).toBe(before);
      expect(standings(state, track)).not.toContain(state.cars[state.index['0'] as number]?.slot);
      expect(raceResults(state, track, RACE).map((r) => r.publicId)).not.toContain('0');
    });

    it('does not keep the race from ending when everyone else has finished', () => {
      const state = running();
      const done = {
        ...state,
        cars: state.cars.map((c) => (c.publicId === '0' ? c : { ...c, finish: 100 })),
      };
      expect(over(done, RACE)).toBe(true);
    });

    it('races from the grid in the next round', () => {
      const next = raceMode.startRound(running(), 0, config, settings);
      const late = next.cars[next.index['0'] as number];
      expect(standings(next, track)).toContain(late?.slot);
      let state = raceMode.applyInput(next, '0', { type: 'keys', mask: 1 }, 0, config, settings);
      for (let i = 0; i < 30; i += 1) state = step(state, settings).state;
      expect(state.cars[state.index['0'] as number]?.speed).toBeGreaterThan(0);
    });
  });

  describe('a player who comes back to a car', () => {
    const step = raceMode.step as NonNullable<typeof raceMode.step>;

    it('finds no key held: the autopilot never asked the client for any', () => {
      let state = build(['1', '2'], new Set(['1', '2']));
      state = raceMode.abandon(state, '1');
      for (let i = 0; i < 30; i += 1) state = step(state, settings).state;
      state = raceMode.rejoin(state, '1', settings);
      expect(state.cars[state.index['1'] as number]).toMatchObject({ bot: false, keys: 0 });
    });

    it('is handed the full pace, but a finished car keeps cruising', () => {
      let state = build(['1', '2'], new Set(['1', '2']));
      state = {
        ...state,
        cars: state.cars.map((c) => (c.publicId === '1' ? { ...c, finish: 50, bot: true } : c)),
      };
      state = raceMode.rejoin(state, '1', settings);
      expect(state.cars[state.index['1'] as number]?.pace).toBe(RACE.coolPace);
      const racing = raceMode.rejoin(
        raceMode.abandon(build(['1'], new Set(['1'])), '1'),
        '1',
        settings,
      );
      expect(racing.cars[0]?.pace).toBe(100);
    });
  });

  describe('a human who was abandoned before the start', () => {
    function lobby(ids: string[], gone: string[]): RaceState {
      let state = raceMode.create(42);
      for (const id of ids) state = raceMode.addPlayer(state, id, id !== '1', 0, config, settings);
      for (const id of gone) state = raceMode.abandon(state, id);
      return raceMode.startRound(state, 0, config, settings);
    }
    const pace = (s: RaceState, id: string) => s.cars[s.index[id] as number]?.pace;

    it('cruises instead of racing, and is driven on by the autopilot', () => {
      const state = lobby(['1', '2', '3'], ['1']);
      expect(pace(state, '1')).toBe(RACE.coolPace);
      const step = raceMode.step as NonNullable<typeof raceMode.step>;
      const later = step(step(state, settings).state, settings).state;
      expect(later.cars[later.index['1'] as number]?.speed).toBeGreaterThan(0);
    });

    it('does not change what the bots draw', () => {
      const withHim = lobby(['1', '2', '3'], ['1']);
      const without = lobby(['2', '3'], []);
      expect(pace(withHim, '2')).toBe(pace(without, '2'));
      expect(pace(withHim, '3')).toBe(pace(without, '3'));
    });

    it('races again at full pace once he is back', () => {
      const back = raceMode.rejoin(lobby(['1', '2'], ['1']), '1', settings);
      expect(raceMode.startRound(back, 0, config, settings).cars[0]?.pace).toBe(100);
    });
  });
});
