import { type ClickerScore, emptyScore } from '../src/modes/clicker/state';
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
