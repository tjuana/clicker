import type { Phase } from './state';

export interface JoinCommand {
  type: 'join';
  playerId: string;
  /** id of the connection the command arrived on. */
  connectionId: string;
  name: string;
  hostKey?: string;
}

export interface LeaveCommand {
  type: 'leave';
  playerId: string;
  /** id of the connection that closed. */
  connectionId: string;
}

export type Command =
  | JoinCommand
  | LeaveCommand
  | { type: 'start'; playerId: string }
  | { type: 'click'; playerId: string }
  | { type: 'tick' };

export type ErrorCode = 'not_joined' | 'not_host' | 'wrong_phase' | 'room_full';

export type GameEvent =
  | { type: 'welcome'; playerId: string; publicId: string; isHost: boolean }
  | { type: 'rejected'; playerId: string; code: ErrorCode }
  | { type: 'phaseChanged'; phase: Phase };
