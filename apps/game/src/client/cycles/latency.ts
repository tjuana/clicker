/** How many measurements the median is taken over. */
export const WINDOW = 10;
/**
 * A turn that has not shown after this long never will: the room had no space for it, or the bike
 * died first. Far above the longest honest wait, which is a few ticks of the slowest speed.
 */
export const EXPIRY_MS = 2_000;

/** Directions are the protocol's, 0 to 3 clockwise: a right turn adds one, a left turn adds three. */
const STEP = { left: 3, right: 1 } as const;
/** East, south, west, north in the field's (x, z), as the scene lays them out. */
const DIR_X = [1, 0, -1, 0];
const DIR_Z = [0, 1, 0, -1];

/** A place on the field, in cells: the centre of cell k is k + 0.5. */
export interface Spot {
  x: number;
  z: number;
}

/** The centre of a cell of a field `side` cells across. */
export const centreOf = (cell: number, side: number): Spot => ({
  x: (cell % side) + 0.5,
  z: Math.floor(cell / side) + 0.5,
});

/** How far a place is along a direction: the one number of it that a straight run changes. */
const alongOf = (dir: number, x: number, z: number): number =>
  x * (DIR_X[dir] as number) + z * (DIR_Z[dir] as number);

/** The last measurement and the median of the last `WINDOW`. */
export interface Figure {
  last: number;
  median: number;
}

/**
 * What the HUD shows; `null` until something was measured. A new object per measurement, never
 * mutated. The times are in milliseconds, the overshoot in cells.
 */
export interface Readout {
  server: Figure | null;
  screen: Figure | null;
  /** How many cells past where the player saw the bike the turn landed; negative if before. */
  overshoot: Figure | null;
}

/** Where, and which way, the player saw their bike when they turned. */
interface Seen {
  dir: number;
  along: number;
}

interface Waiting {
  sentAt: number;
  step: number;
  seen: Seen | null;
}

/** The last `WINDOW` values of something, with the last one and their median. */
function createFigure() {
  const values: number[] = [];
  let figure: Figure | null = null;

  const median = (): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  };

  return {
    add: (value: number): void => {
      values.push(value);
      if (values.length > WINDOW) values.shift();
      figure = { last: value, median: median() };
    },
    get: (): Figure | null => figure,
    reset: (): void => {
      values.length = 0;
      figure = null;
    },
  };
}

/**
 * One end of the trip. Turns wait here in the order they were sent, and each look at the bike's
 * direction either explains a change by one of them or finds none.
 */
function createEnd() {
  const waiting: Waiting[] = [];
  const took = createFigure();
  const overshoot = createFigure();
  /** Where the bike pointed the last time it was looked at; `null` while it has none. */
  let facing: number | null = null;

  return {
    sent: (step: number, sentAt: number, seen: Seen | null): void => {
      waiting.push({ sentAt, step, seen });
    },
    took: took.get,
    overshoot: overshoot.get,
    reset: (): void => {
      waiting.length = 0;
      took.reset();
      overshoot.reset();
      facing = null;
    },
    /**
     * Looks at the bike at `now`; returns how long the turn that explains its new direction took.
     * `corner`, when the end knows it, is the cell the bike turned at.
     */
    look: (dir: number | null, now: number, corner: Spot | null): number | null => {
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
      const before: number = facing;
      let leads = before;
      for (let i = 0; i < waiting.length; i += 1) {
        const turn = waiting[i] as Waiting;
        leads = (leads + turn.step) & 3;
        if (leads !== dir) continue;
        waiting.splice(0, i + 1);
        facing = dir;
        const trip = now - turn.sentAt;
        took.add(trip);
        // Only a turn made on a straight has a "where it was seen" that means something to the
        // corner: one sent before the turn ahead of it had shown was seen going the way the bike
        // went before that one, and its corner lies on the next straight, not on that one.
        if (corner !== null && turn.seen !== null && turn.seen.dir === before) {
          overshoot.add(alongOf(before, corner.x, corner.z) - turn.seen.along);
        }
        return trip;
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
   * when it has none. `corner` is the cell the bike was in before this message, from which it
   * set off in `dir`: the cell it turned at, not the one it reached. Returns the time the turn
   * that changed the direction took, or `null` if none did.
   */
  observeServer: (dir: number | null, now: number, corner?: Spot | null) => number | null;
  /**
   * The same for the first frame, at `now`, that draws the player's bike pointing `dir` at (`x`,
   * `z`). The place is kept for the next turn to be sent: that is where the player saw the bike.
   * Called on every frame, so it takes numbers and builds nothing.
   */
  observeScreen: (dir: number | null, now: number, x?: number, z?: number) => number | null;
  /** The same object until something new is measured, so a view can compare it by reference. */
  read: () => Readout;
  reset: () => void;
}

/**
 * How long a turn takes to show, measured where the player is and nowhere else: from the moment it
 * is sent to the arrival of the first server message that has the bike turned (the round trip and
 * the wait for the next tick), and to the first frame that draws it turned (all of that and the
 * render delay on top). And how far that is in cells: the player presses where they see the bike,
 * which is a little behind where it is, and the bike turns at the next step the server takes.
 *
 * The two ends see the same bike at different times and each can lose a turn the other found, so
 * each keeps its own line of waiting turns. Pure: the time is always handed in.
 */
export function createLatency(): Latency {
  const server = createEnd();
  const screen = createEnd();
  let readout: Readout = { server: null, screen: null, overshoot: null };
  /** How the last frame drew the player's bike: the direction, `null` for no bike, and the place. */
  let drawnDir: number | null = null;
  let drawnX = 0;
  let drawnZ = 0;

  const publish = (took: number | null): number | null => {
    if (took !== null) {
      readout = { server: server.took(), screen: screen.took(), overshoot: server.overshoot() };
    }
    return took;
  };

  return {
    sent: (side, now) => {
      const seen =
        drawnDir === null ? null : { dir: drawnDir, along: alongOf(drawnDir, drawnX, drawnZ) };
      server.sent(STEP[side], now, seen);
      screen.sent(STEP[side], now, seen);
    },
    observeServer: (dir, now, corner = null) => publish(server.look(dir, now, corner)),
    observeScreen: (dir, now, x = 0, z = 0) => {
      drawnDir = dir;
      drawnX = x;
      drawnZ = z;
      return publish(screen.look(dir, now, null));
    },
    read: () => readout,
    reset: () => {
      server.reset();
      screen.reset();
      drawnDir = null;
      readout = { server: null, screen: null, overshoot: null };
    },
  };
}
