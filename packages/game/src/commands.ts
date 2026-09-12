import type { Phase } from './state';

export interface JoinCommand {
  type: 'join';
  playerId: string;
  name: string;
  hostKey?: string;
}

export type Command =
  | JoinCommand
  | { type: 'leave'; playerId: string }
  | { type: 'start'; playerId: string }
  | { type: 'click'; playerId: string }
  | { type: 'tick' };

export type ErrorCode = 'not_joined' | 'not_host' | 'wrong_phase' | 'room_full';

export type GameEvent =
  | { type: 'welcome'; playerId: string; publicId: string; isHost: boolean }
  | { type: 'rejected'; playerId: string; code: ErrorCode }
  | { type: 'phaseChanged'; phase: Phase };
