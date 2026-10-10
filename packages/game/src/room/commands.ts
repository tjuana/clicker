import type { ModeInput } from '../modes';
import type { Phase } from './state';

export interface JoinCommand {
  type: 'join';
  playerId: string;
  connectionId: string;
  name: string;
  hostKey?: string;
}

/** The mode decides what an input means; the room only routes it. */
export interface InputCommand {
  type: 'input';
  playerId: string;
  input: ModeInput;
}

export type Command =
  | JoinCommand
  | { type: 'leave'; playerId: string; connectionId: string }
  | { type: 'start'; playerId: string }
  | InputCommand
  | { type: 'tick' };

export type ErrorCode = 'not_joined' | 'not_host' | 'wrong_phase' | 'room_full';

export type GameEvent =
  | { type: 'welcome'; playerId: string; publicId: string; isHost: boolean }
  | { type: 'rejected'; playerId: string; code: ErrorCode }
  | { type: 'phaseChanged'; phase: Phase };
