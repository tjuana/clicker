import { create } from 'zustand';
import { browserStorage, type Memory } from './audio/mute';

const KEY = 'clicker.frameMeter';

/** A window of frames, in milliseconds. */
export interface Spread {
  median: number;
  p95: number;
}

/** What the scene measured over its last window of frames. */
export interface FrameReadout {
  /** Null where the browser has no GPU timer: Safari, Firefox, headless Chromium. */
  gpu: Spread | null;
  cpu: Spread;
  /** Of the last frame, every pass of it: shadows, reflections and post-processing included. */
  calls: number;
  triangles: number;
}

interface FrameView {
  /** Off by default: an instrument for whoever builds the game, not a player's line. */
  shown: boolean;
  toggle: () => void;
  /** Null while no scene measures. */
  readout: FrameReadout | null;
  publish: (readout: FrameReadout | null) => void;
}

/**
 * Whether the line is shown, kept between visits, and what it says. Storage that throws (a private
 * window) leaves the line working for this visit and forgotten after it.
 */
export function createFrameView(storage: Memory | null) {
  const read = (): boolean => {
    try {
      return storage?.getItem(KEY) === '1';
    } catch {
      return false;
    }
  };

  return create<FrameView>((set, get) => ({
    shown: read(),
    readout: null,
    toggle: () => {
      const shown = !get().shown;
      set({ shown });
      try {
        storage?.setItem(KEY, shown ? '1' : '0');
      } catch {
        // Not remembered; nothing else to do.
      }
    },
    publish: (readout) => set({ readout }),
  }));
}

export const useFrameView = createFrameView(browserStorage());

/** The scene calls this a few times a second while it measures, and with null when it stops. */
export function publishFrame(readout: FrameReadout | null): void {
  useFrameView.getState().publish(readout);
}
