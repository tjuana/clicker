import type { ClickerState } from '../modes/clicker/state';
import { createClickerState } from '../modes/clicker/state';

export type Phase = 'lobby' | 'countdown' | 'running' | 'results';

export type Notice = 'round_aborted';

/** Only one mode exists today; the union is where the next one is added. */
export type ModeId = 'clicker';

/** Generic room player. Nothing about a specific game belongs here. */
export interface Player {
  /** Public identifier: this is the only one clients ever see. */
  publicId: string;
  name: string;
  /** Ids of the open connections of this player. */
  connectionIds: string[];
  disconnectedAt: number | null;
}

export interface Round {
  goAt: number;
  endsAt: number;
}

export interface RoomState {
  /** Chosen when the room is created and never changes afterwards. */
  mode: ModeId;
  phase: Phase;
  hostKey: string | null;
  /** playerIds of the hosts. */
  hosts: string[];
  /** Keyed by the secret playerId. */
  players: Record<string, Player>;
  nextSeq: number;
  round: Round | null;
  notice: Notice | null;
  /** Everything only the mode knows: scores, results, its own timers. */
  modeState: ClickerState;
}

export function createRoomState(): RoomState {
  return {
    mode: 'clicker',
    phase: 'lobby',
    hostKey: null,
    hosts: [],
    players: {},
    nextSeq: 1,
    round: null,
    notice: null,
    modeState: createClickerState(),
  };
}
