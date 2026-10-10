import { describe, expect, it } from 'vitest';
import { modeFor } from '../src/modes';
import { clickerMode } from '../src/modes/clicker/mode';
import { cyclesMode } from '../src/modes/cycles/mode';
import { configFor } from '../src/room/config';
import { config } from './support';

describe('the mode interface', () => {
  it('gives each mode id its own mode, and only the cycles are alive', () => {
    expect(modeFor('clicker')).not.toBe(modeFor('cycles'));
    expect(modeFor('clicker').step).toBeNull();
    expect(modeFor('cycles').step).toBeTypeOf('function');
  });

  it('ignores a click sent to the cycles: the state comes back as it was', () => {
    let state = cyclesMode.create(1);
    state = cyclesMode.addPlayer(state, '1', false, 0, config());
    state = cyclesMode.startRound(state, 0, config());

    expect(cyclesMode.applyInput(state, '1', { type: 'click' }, 10, config())).toBe(state);
  });

  it('ignores a turn sent to the clicker: the state comes back as it was', () => {
    let state = clickerMode.create(1);
    state = clickerMode.addPlayer(state, '1', false, 0, config());
    state = clickerMode.startRound(state, 0, config());

    expect(clickerMode.applyInput(state, '1', { type: 'turn', side: 'left' }, 10, config())).toBe(
      state,
    );
    expect(clickerMode.applyInput(state, '1', { type: 'boost' }, 10, config())).toBe(state);
  });

  it('counts a click for the clicker, so the test above is not passing on a dead path', () => {
    let state = clickerMode.create(1);
    state = clickerMode.addPlayer(state, '1', false, 0, config());
    state = clickerMode.startRound(state, 0, config());

    const clicked = clickerMode.applyInput(state, '1', { type: 'click' }, 10, config());
    expect(clicked.scores['1']?.clicks).toBe(1);
  });
});

describe('clearing a living mode', () => {
  function playedRound() {
    let state = cyclesMode.create(5);
    for (let i = 1; i <= 6; i += 1) {
      state = cyclesMode.addPlayer(state, String(i), true, 0, config());
    }
    state = cyclesMode.startRound(state, 0, config());
    // Long enough for deaths, kills and a trail on the field: clearing nothing proves nothing.
    for (let tick = 0; tick < 600 && cyclesMode.step !== null; tick += 1) {
      state = cyclesMode.step(state).state;
    }
    return state;
  }

  it('leaves a lobby: an empty field, no living bike, no score', () => {
    const played = playedRound();
    expect(played.bikes.some((bike) => bike.kills + bike.deaths > 0)).toBe(true);
    expect(played.field.some((cell) => cell !== 0)).toBe(true);

    const cleared = cyclesMode.clear(played);

    expect(cleared.field.every((cell) => cell === 0)).toBe(true);
    expect(cleared.bikes.some((bike) => bike.alive)).toBe(false);
    expect(cleared.bikes.map((bike) => bike.kills)).toEqual(cleared.bikes.map(() => 0));
    expect(cleared.bikes.map((bike) => bike.deaths)).toEqual(cleared.bikes.map(() => 0));
    expect(cleared.bikes.every((bike) => bike.trail.size === 0)).toBe(true);
  });

  it('keeps the players and their slots', () => {
    const played = playedRound();
    const cleared = cyclesMode.clear(played);

    const seats = (state: typeof played) =>
      state.bikes.map((bike) => [bike.slot, bike.publicId, bike.bot]);
    expect(seats(cleared)).toEqual(seats(played));
    expect(cleared.index).toEqual(played.index);
  });
});

describe('what a mode changes about the room', () => {
  it('ticks the cycles at 20 Hz and leaves the clicker without a tick', () => {
    expect(configFor('cycles').tickMs).toBe(50);
    expect(configFor('clicker').tickMs).toBeNull();
  });

  it('keeps everything a mode does not name from the base config', () => {
    const base = config({ lateGraceMs: 999 });
    expect(configFor('cycles', base).lateGraceMs).toBe(999);
    expect(configFor('cycles', base).roundMs).toBe(180_000);
  });
});
