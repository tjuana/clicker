/** How many measurements the median is taken over. */
export const WINDOW = 10;
/**
 * A turn that has not shown after this long never will: the room had no space for it, or the bike
 * died first. Far above the longest honest wait, which is a few ticks of the slowest speed.
 */
export const EXPIRY_MS = 2_000;

/** Directions are the protocol's, 0 to 3 clockwise: a right turn adds one, a left turn adds three. */
const STEP = { left: 3, right: 1 } as const;

/** The last measurement and the median of the last `WINDOW`, in milliseconds. */
export interface Figure {
  last: number;
  median: number;
}

/** What the HUD shows; `null` until something was measured. A new object per measurement, never mutated. */
export interface Readout {
  server: Figure | null;
  screen: Figure | null;
}

interface Waiting {
  sentAt: number;
  step: number;
}

/**
 * One end of the trip. Turns wait here in the order they were sent, and each look at the bike's
 * direction either explains a change by one of them or finds none.
 */
function createEnd() {
  const waiting: Waiting[] = [];
  const seen: number[] = [];
  /** Where the bike pointed the last time it was looked at; `null` while it has none. */
  let facing: number | null = null;
  let figure: Figure | null = null;

  const median = (): number => {
    const sorted = [...seen].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  };

  return {
    sent: (step: number, sentAt: number): void => {
      waiting.push({ sentAt, step });
    },
    figure: (): Figure | null => figure,
    reset: (): void => {
      waiting.length = 0;
      seen.length = 0;
      facing = null;
      figure = null;
    },
    /** Looks at the bike at `now`; returns how long the turn that explains its new direction took. */
    look: (dir: number | null, now: number): number | null => {
      while (waiting.length > 0 && now - (waiting[0] as Waiting).sentAt > EXPIRY_MS) {
        waiting.shift();
      }
      // A bike that is dead, or was just brought back, has no turn waiting: the ones sent to its
      // last life were lost with it, and the rules throw away a turn sent to a dead bike.
      if (dir === null || facing === null) {
        waiting.length = 0;
        facing = dir;
        return null;
      }
      if (dir === facing) return null;

      // Not simply the oldest turn: one that never took effect (no room for it in the server's
      // queue) would then be taken for every change after it, and each would be measured against
      // the turn before. The direction each turn leads to, counted from where the bike was, says
      // which one this was, and turns skipped on the way are the ones that never showed.
      // What this cannot tell apart: a refused turn followed by one to the same side leads to the
      // refused turn's direction, so the next change is read as the refused one until it expires.
      // A turn to the other side leads nowhere we hold, which starts the count over below.
      let leads: number = facing;
      for (let i = 0; i < waiting.length; i += 1) {
        const turn = waiting[i] as Waiting;
        leads = (leads + turn.step) & 3;
        if (leads !== dir) continue;
        waiting.splice(0, i + 1);
        facing = dir;
        const took = now - turn.sentAt;
        seen.push(took);
        if (seen.length > WINDOW) seen.shift();
        figure = { last: took, median: median() };
        return took;
      }
      // No turn leads here, so what we hold is out of step with the bike: start over from it.
      waiting.length = 0;
      facing = dir;
      return null;
    },
  };
}

export interface Latency {
  /** The player sent a turn at `now`. */
  sent: (side: 'left' | 'right', now: number) => void;
  /**
   * The server's message that arrived at `now` has the player's bike pointing `dir`, or `null`
   * when it has none. Returns the time the turn that changed it took, or `null` if none did.
   */
  observeServer: (dir: number | null, now: number) => number | null;
  /** The same for the first frame, at `now`, that draws the player's bike pointing `dir`. */
  observeScreen: (dir: number | null, now: number) => number | null;
  /** The same object until something new is measured, so a view can compare it by reference. */
  read: () => Readout;
  reset: () => void;
}

/**
 * How long a turn takes to show, measured where the player is and nowhere else: from the moment it
 * is sent to the arrival of the first server message that has the bike turned (the round trip and
 * the wait for the next tick), and to the first frame that draws it turned (all of that and the
 * render delay on top).
 *
 * The two ends see the same bike at different times and each can lose a turn the other found, so
 * each keeps its own line of waiting turns. Pure: the time is always handed in.
 */
export function createLatency(): Latency {
  const server = createEnd();
  const screen = createEnd();
  let readout: Readout = { server: null, screen: null };

  const publish = (took: number | null): number | null => {
    if (took !== null) readout = { server: server.figure(), screen: screen.figure() };
    return took;
  };

  return {
    sent: (side, now) => {
      server.sent(STEP[side], now);
      screen.sent(STEP[side], now);
    },
    observeServer: (dir, now) => publish(server.look(dir, now)),
    observeScreen: (dir, now) => publish(screen.look(dir, now)),
    read: () => readout,
    reset: () => {
      server.reset();
      screen.reset();
      readout = { server: null, screen: null };
    },
  };
}
