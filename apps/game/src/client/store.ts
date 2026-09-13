import type { ServerErrorCode, SnapshotMessage } from '@clicker/protocol';
import { create } from 'zustand';

export type Status = 'connecting' | 'open' | 'reconnecting';

interface ClientState {
  status: Status;
  you: string | null;
  isHost: boolean;
  snapshot: SnapshotMessage | null;
  /** Разница между часами сервера и браузера, по максимуму последних значений. */
  offset: number;
  localClicks: number;
  /** `goAt` текущего раунда: по нему видно, что начался новый раунд, даже если снимок пропущен. */
  currentGoAt: number | null;
  lastError: ServerErrorCode | 'invalid_message' | null;
  setStatus: (status: Status) => void;
  welcome: (you: string, isHost: boolean) => void;
  receive: (snapshot: SnapshotMessage) => void;
  fail: (code: ServerErrorCode | 'invalid_message') => void;
  countClick: () => void;
}

const OFFSET_SAMPLES = 10;
const samples: number[] = [];

export const useClient = create<ClientState>((set) => ({
  status: 'connecting',
  you: null,
  isHost: false,
  snapshot: null,
  offset: 0,
  localClicks: 0,
  currentGoAt: null,
  lastError: null,
  setStatus: (status) => set({ status }),
  welcome: (you, isHost) => set({ you, isHost }),
  receive: (snapshot) => {
    // Задержка сети только уменьшает разницу, поэтому берём максимум из последних замеров.
    samples.push(snapshot.serverNow - Date.now());
    if (samples.length > OFFSET_SAMPLES) samples.shift();
    set((state) => {
      const goAt = snapshot.round?.goAt ?? null;
      return {
        snapshot,
        offset: Math.max(...samples),
        currentGoAt: goAt,
        localClicks: goAt !== state.currentGoAt ? 0 : state.localClicks,
      };
    });
  },
  fail: (code) => set({ lastError: code }),
  countClick: () => set((state) => ({ localClicks: state.localClicks + 1 })),
}));

/** Серверное время по часам браузера. */
export function serverNow(): number {
  return Date.now() + useClient.getState().offset;
}
