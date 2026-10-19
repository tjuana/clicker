import { create } from 'zustand';
import { browserStorage, type Memory } from '../audio/mute';
import { createLatency, type Readout, type Spot } from './latency';

const KEY = 'clicker.turnLatency';

interface LatencyView {
  /** On by default: the line is for finding out how the game feels, and costs a row. */
  shown: boolean;
  toggle: () => void;
  /** Replaced only when a turn is measured, a few times a second at most. */
  readout: Readout;
}

/**
 * Whether the line is shown, kept between visits, and what it says. Storage that throws (a private
 * window) leaves the line working for this visit and forgotten after it.
 */
export function createLatencyView(storage: Memory | null) {
  const read = (): boolean => {
    try {
      return storage?.getItem(KEY) !== '0';
    } catch {
      return true;
    }
  };

  return create<LatencyView>((set, get) => ({
    shown: read(),
    readout: { server: null, screen: null, overshoot: null },
    toggle: () => {
      const shown = !get().shown;
      set({ shown });
      try {
        storage?.setItem(KEY, shown ? '1' : '0');
      } catch {
        // Not remembered; nothing else to do.
      }
    },
  }));
}

export const useLatencyView = createLatencyView(browserStorage());

/** One tracker for the page: the turn is sent from the connection, seen by the store and by the scene. */
const tracker = createLatency();

const publish = (): void => useLatencyView.setState({ readout: tracker.read() });

export function turnSent(side: 'left' | 'right', now: number): void {
  tracker.sent(side, now);
}

/**
 * The scene calls this on every frame with where it drew the player's bike, so it takes numbers
 * and costs a comparison unless a turn was just measured.
 */
export function seenOnScreen(dir: number | null, now: number, x: number, z: number): void {
  if (tracker.observeScreen(dir, now, x, z) !== null) publish();
}

/** `corner`: the cell the bike rode from in this message, if the message is a step from a known one. */
export function seenByServer(dir: number | null, now: number, corner: Spot | null = null): void {
  if (tracker.observeServer(dir, now, corner) !== null) publish();
}

export function forgetTurns(): void {
  tracker.reset();
  publish();
}
