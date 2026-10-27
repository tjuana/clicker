import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLES_SETTINGS } from '../src/modes/cycles/config';
import { random } from '../src/modes/cycles/random';
import { raceMode } from '../src/modes/race';
import { RACE } from '../src/modes/race/config';
import { standings } from '../src/modes/race/race';
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
});
