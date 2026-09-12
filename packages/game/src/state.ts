export type Phase = 'lobby' | 'countdown' | 'running' | 'results';

export type Notice = 'round_aborted';

export interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface Player {
  /** Публичный идентификатор: только он уходит клиентам. */
  publicId: string;
  name: string;
  /** Сколько соединений открыто с этим playerId. */
  connections: number;
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
  /** playerId хостов. */
  hosts: string[];
  /** Ключ — секретный playerId. */
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
