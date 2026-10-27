import type { ModeId, ModeInput, ModeTypes } from '../modes';
import type { Speed, WallMode } from '../modes/cycles/config';
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
  | { type: 'tick' }
  | { type: 'step' }
  | { type: 'setMode'; playerId: string; mode: ModeId }
  | { type: 'setSpeed'; playerId: string; speed: Speed }
  | { type: 'setWalls'; playerId: string; walls: WallMode }
  | { type: 'addBot'; playerId: string }
  | { type: 'removeBot'; playerId: string };

export type ErrorCode = 'not_joined' | 'not_host' | 'wrong_phase' | 'room_full' | 'not_supported';

export type GameEvent =
  | { type: 'welcome'; playerId: string; publicId: string; isHost: boolean }
  | { type: 'rejected'; playerId: string; code: ErrorCode }
  | { type: 'phaseChanged'; phase: Phase }
  | ({ type: 'stepped'; tick: number } & Stepped);

/**
 * The changes come with the mode that made them, so a reader has to narrow before it looks
 * inside. One member for every mode that steps; the clicker, whose changes are `never`, has none.
 */
export type Stepped = {
  [K in ModeId]: [ModeTypes[K]['changes']] extends [never]
    ? never
    : { mode: K; changes: ModeTypes[K]['changes'] };
}[ModeId];
