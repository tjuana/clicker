import type { RaceDeltaMessage, RaceFullMessage, SnapshotMessage } from '@clicker/protocol';
import { create } from 'zustand';
import { applyDelta, fromFull, type RaceModel } from './model';
import { createRaceTimeline, type RaceTimeline } from './timeline';

interface RaceStore {
  model: RaceModel | null;
  /** The scene reads this on every frame. */
  timeline: RaceTimeline | null;
  /**
   * A car the model does not know appeared and the whole race was asked for: deltas mean nothing
   * until it comes. The time of the last ask, so a lost answer can be asked for again; `null`
   * when nothing is awaited.
   */
  askedAt: number | null;
}

/** The server answers a connection's `resync` at most once a second; asking again sooner is noise. */
export const RACE_RESYNC_RETRY_MS = 1500;

const EMPTY: RaceStore = { model: null, timeline: null, askedAt: null };

export const useRace = create<RaceStore>(() => EMPTY);

export function clearRace(): void {
  useRace.setState(EMPTY);
}

type RaceEvents = RaceDeltaMessage['events'];
const eventListeners = new Set<(events: RaceEvents) => void>();

/**
 * Hears what happened in each tick as it arrives (laps, finishes, bumps): the sound needs them.
 * Called after the store holds the tick. Returns the way to stop listening.
 */
export function onRaceEvents(listener: (events: RaceEvents) => void): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

/** A room that is not in a round keeps no race: the lobby must not hold the last one's cars. */
export function followRacePhase(phase: SnapshotMessage['phase']): void {
  if (phase !== 'lobby' && phase !== 'results') return;
  if (useRace.getState().model !== null) clearRace();
}

/**
 * Takes one `full` or `delta` into the race. `now` is the local clock the scene also reads
 * (`performance.now()`). Returns `'resync'` when a delta names a car the model has never seen; a
 * gap in the ticks is not one, since each delta holds every car. While the answer is awaited
 * deltas are dropped, and the ask is repeated on the next delta after `RACE_RESYNC_RETRY_MS`.
 */
export function feedRace(
  message: RaceFullMessage | RaceDeltaMessage,
  now: number,
): 'resync' | null {
  if (message.type === 'full') {
    const model = fromFull(message);
    const { model: before, timeline: running } = useRace.getState();
    // The same race sent again (a car joined, or this client asked) keeps its clock. Another
    // track or pace, or a race that began again from an earlier tick, shares none of it.
    const sameRace =
      before !== null &&
      running !== null &&
      before.track === model.track &&
      before.tickMs === model.tickMs &&
      before.tick <= model.tick;
    const timeline = sameRace ? running : createRaceTimeline(model.tickMs);
    timeline.arrive(model, now, false);
    useRace.setState({ model, timeline, askedAt: null });
    return null;
  }

  const { model, timeline, askedAt } = useRace.getState();
  // Before its own full a connection can be sent deltas of a race it knows nothing about.
  if (model === null || timeline === null) return null;
  if (askedAt !== null) {
    if (now - askedAt < RACE_RESYNC_RETRY_MS) return null;
    useRace.setState({ askedAt: now });
    return 'resync';
  }
  const result = applyDelta(model, message);
  if (result === null) {
    useRace.setState({ askedAt: now });
    return 'resync';
  }
  // The same model back means the delta was old news.
  if (result.model === model) return null;
  timeline.arrive(result.model, now, true);
  useRace.setState({ model: result.model });
  if (result.events.length > 0) {
    for (const listener of eventListeners) listener(result.events);
  }
  return null;
}
