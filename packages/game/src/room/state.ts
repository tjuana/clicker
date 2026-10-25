import type { ModeId, ModeState } from '../modes';
import { createClickerState } from '../modes/clicker/state';
import { type CyclesSettings, DEFAULT_CYCLES_SETTINGS } from '../modes/cycles/config';

export type Phase = 'lobby' | 'countdown' | 'running' | 'results';

export type Notice = 'round_aborted';

/** Generic room player. Nothing about a specific game belongs here. */
export interface Player {
  /** Public identifier: this is the only one clients ever see. */
  publicId: string;
  name: string;
  /** Ids of the open connections of this player. */
  connectionIds: string[];
  disconnectedAt: number | null;
  /** Seated by the host, not by a connection: it has none, and so never expires. */
  bot: boolean;
}

export interface Round {
  goAt: number;
  endsAt: number;
}

export interface RoomState {
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
  /** The light cycles' pace and walls. Live here, not in the mode, so they outlast a trip through the clicker. */
  settings: CyclesSettings;
  /** Everything only the mode knows: scores, results, its own timers. */
  modeState: ModeState;
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
    settings: DEFAULT_CYCLES_SETTINGS,
    modeState: createClickerState(),
  };
}
