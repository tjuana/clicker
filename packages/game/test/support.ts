import { DEFAULT_CONFIG, type GameConfig } from '../src/config';
import { createRoomState, type Player, type RoomState } from '../src/state';

export function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

/** Замораживает состояние: если код попробует его изменить, тест упадёт. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function player(overrides: Partial<Player> & { publicId: string }): Player {
  return {
    name: 'player',
    connectionIds: ['conn-1'],
    disconnectedAt: null,
    clicks: 0,
    lastCountedAt: null,
    bucket: { tokens: 15, updatedAt: 0 },
    ...overrides,
  };
}

export function room(overrides: Partial<RoomState> = {}): RoomState {
  return { ...createRoomState(), ...overrides };
}
