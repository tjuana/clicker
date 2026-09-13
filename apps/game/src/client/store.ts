import type { ServerErrorCode, SnapshotMessage } from '@clicker/protocol';
import { create } from 'zustand';

export type Status = 'connecting' | 'open' | 'reconnecting';

interface ClientState {
  status: Status;
  you: string | null;
  isHost: boolean;
  snapshot: SnapshotMessage | null;
  /** Difference between the server's and the browser's clocks, taken as the max of recent samples. */
  offset: number;
  localClicks: number;
  /** `goAt` of the current round: it shows a new round has started even if a snapshot was missed. */
  currentGoAt: number | null;
  lastError: ServerErrorCode | null;
  setStatus: (status: Status) => void;
  welcome: (you: string, isHost: boolean) => void;
  receive: (snapshot: SnapshotMessage) => void;
  fail: (code: ServerErrorCode) => void;
  clearError: () => void;
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
    // Network latency only shrinks the difference, so we take the max of the recent samples.
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
  clearError: () => set({ lastError: null }),
  countClick: () => set((state) => ({ localClicks: state.localClicks + 1 })),
}));

/** Server time, computed from the browser's clock. */
export function serverNow(): number {
  return Date.now() + useClient.getState().offset;
}
