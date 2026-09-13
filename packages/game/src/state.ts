export type Phase = 'lobby' | 'countdown' | 'running' | 'results';

export type Notice = 'round_aborted';

export interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface Player {
  /** Public identifier: only this one goes out to clients. */
  publicId: string;
  name: string;
  /** ids of this player's open connections. */
  connectionIds: string[];
  disconnectedAt: number | null;
  clicks: number;
  lastCountedAt: number | null;
  bucket: Bucket;
}

export interface ResultRow {
  publicId: string;
  name: string;
  clicks: number;
  rank: number;
}

export interface Round {
  goAt: number;
  endsAt: number;
}

export interface RoomState {
  phase: Phase;
  hostKey: string | null;
  /** playerId of the hosts. */
  hosts: string[];
  /** Keyed by the secret playerId. */
  players: Record<string, Player>;
  nextSeq: number;
  round: Round | null;
  results: ResultRow[] | null;
  notice: Notice | null;
}

export function createRoomState(): RoomState {
  return {
    phase: 'lobby',
    hostKey: null,
    hosts: [],
    players: {},
    nextSeq: 1,
    round: null,
    results: null,
    notice: null,
  };
}
