import { create } from 'zustand';

const KEY = 'clicker.muted';

/** The two things of `localStorage` this uses, so a test can hand in a fake one. */
export interface Memory {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * Reading `localStorage` itself can throw (a blocked cookie setting), so it is guarded too. It is
 * reached through `globalThis` because the tests compile this file without the DOM types, and in
 * the tests' runtime it is simply not there.
 */
export function browserStorage(): Memory | null {
  try {
    return (globalThis as { localStorage?: Memory }).localStorage ?? null;
  } catch {
    return null;
  }
}

interface MuteState {
  muted: boolean;
  toggle: () => void;
}

/**
 * The sound switch, kept between visits. A private window or blocked storage still plays: the
 * switch then works for this visit and is forgotten, which is the only thing it can do there.
 */
export function createMute(storage: Memory | null) {
  const read = (): boolean => {
    try {
      return storage?.getItem(KEY) === '1';
    } catch {
      return false;
    }
  };

  return create<MuteState>((set, get) => ({
    muted: read(),
    toggle: () => {
      const muted = !get().muted;
      set({ muted });
      try {
        storage?.setItem(KEY, muted ? '1' : '0');
      } catch {
        // Not remembered; nothing else to do.
      }
    },
  }));
}

export const useMuted = createMute(browserStorage());
