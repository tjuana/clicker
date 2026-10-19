import { type ClickerScore, type ClickerState, emptyScore } from '../src/modes/clicker/state';
import type { CyclesState } from '../src/modes/cycles/state';
import { apply } from '../src/room/apply';
import type { Command } from '../src/room/commands';
import { DEFAULT_CONFIG, type GameConfig } from '../src/room/config';
import { createRoomState, type Player, type RoomState } from '../src/room/state';

export function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

/** Freezes the state: if code tries to mutate it, the test fails. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/** A generic room player. Nothing about a specific game belongs here. */
export function player(overrides: Partial<Player> & { publicId: string }): Player {
  return {
    name: 'player',
    connectionIds: ['conn-1'],
    disconnectedAt: null,
    bot: false,
    ...overrides,
  };
}

/** A score row for the clicker mode, keyed by publicId in modeState.scores. */
export function score(overrides: Partial<ClickerScore> = {}): ClickerScore {
  return { ...emptyScore(0, DEFAULT_CONFIG.burst), ...overrides };
}

export function room(overrides: Partial<RoomState> = {}): RoomState {
  return { ...createRoomState(), ...overrides };
}

/** The clicker's slice of a room, for tests that read scores: `modeState` is a union of modes. */
export function clickerOf(state: RoomState): ClickerState {
  if (state.mode !== 'clicker') throw new Error(`expected a clicker room, got ${state.mode}`);
  return state.modeState as ClickerState;
}

/** The light cycles' slice of a room. */
export function cyclesOf(state: RoomState): CyclesState {
  if (state.mode !== 'cycles') throw new Error(`expected a cycles room, got ${state.mode}`);
  return state.modeState as CyclesState;
}

/** A lobby with a host ("host", publicId 1) and nobody else. Every later publicId follows from 2. */
export function lobbyWithHost(): RoomState {
  return apply(
    createRoomState(),
    { type: 'join', playerId: 'host', connectionId: 'c-host', name: 'Host', hostKey: 'key' },
    0,
  ).state;
}

/** Runs commands one after another at the same moment and returns the last state. */
export function run(
  state: RoomState,
  commands: Command[],
  now = 0,
  settings = config(),
): RoomState {
  return commands.reduce((current, command) => apply(current, command, now, settings).state, state);
}
