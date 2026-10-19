import type { DeltaMessage, FullMessage, SnapshotMessage } from '@clicker/protocol';
import { create } from 'zustand';
import { applyDelta, type CyclesModel, fromFull } from './model';
import { createTimeline, type Timeline } from './timeline';

/** One line of the kill feed. `killer` is `null` for a crash into a wall or a trail's end. */
export interface FeedItem {
  seq: number;
  killer: number | null;
  victim: number;
}

/** The feed shows the last few; older ones have nothing left to say. */
const FEED_LENGTH = 4;

interface CyclesStore {
  model: CyclesModel | null;
  /** The scene reads this on every frame; it is replaced by each full. */
  timeline: Timeline | null;
  /**
   * A gap was found and the whole round asked for: deltas mean nothing until it comes. The time
   * of the last ask, so a lost answer can be asked for again; `null` when nothing is awaited.
   */
  askedAt: number | null;
  /** Newest last; the HUD fades each line by itself. */
  feed: FeedItem[];
}

/** The server answers a connection's `resync` at most once a second; asking again sooner is noise. */
export const RESYNC_RETRY_MS = 1500;

const EMPTY: CyclesStore = { model: null, timeline: null, askedAt: null, feed: [] };

let feedSeq = 0;

export const useCycles = create<CyclesStore>(() => EMPTY);

export function clearCycles(): void {
  useCycles.setState(EMPTY);
}

type RoundEvents = DeltaMessage['events'];
const eventListeners = new Set<(events: RoundEvents) => void>();

/**
 * Hears what happened in each tick as it arrives: the sound needs the events, and the store keeps
 * only the ones the feed shows. A listener is called after the store holds the tick, so it reads
 * a round that already includes what it is told about. Returns the way to stop listening.
 */
export function onRoundEvents(listener: (events: RoundEvents) => void): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

/**
 * A room that is not in a round keeps no round. Without this the lobby, and the countdown of the
 * next round, would still hold the last one's model until its `full` arrived.
 */
export function followPhase(phase: SnapshotMessage['phase']): void {
  if (phase !== 'lobby' && phase !== 'results') return;
  if (useCycles.getState().model !== null) clearCycles();
}

/**
 * Takes one `full` or `delta` into the round. `now` is the local clock the scene also reads
 * (`performance.now()`). Returns `'resync'` on a gap: the caller then asks the server for the
 * whole round, and every delta is ignored until that `full` arrives. The ask can be lost or
 * refused, so while stuck it is repeated — on the next delta after `RESYNC_RETRY_MS`, never
 * sooner. Deltas keep coming whatever the answer, so they are the clock; no timer is needed.
 */
export function feedCycles(message: FullMessage | DeltaMessage, now: number): 'resync' | null {
  if (message.type === 'full') {
    const { model, walls } = fromFull(message);
    const { model: before, timeline: running, feed } = useCycles.getState();
    // The room sends everyone the round again when a bike joins in the middle of it, and a client
    // that asked after a gap gets it too. That is the same round, not a new one: what it has
    // built up (the feed, the clock) is still true. A round of another size or speed, or one
    // that began again from an earlier tick, shares none of it.
    const sameRound =
      before !== null &&
      running !== null &&
      before.side === model.side &&
      before.tickMs === model.tickMs &&
      before.tick <= model.tick;
    const timeline = sameRound ? running : createTimeline(model.tickMs);
    timeline.arrive({ tick: model.tick, walls, heads: model.heads, events: [], reset: true }, now);
    useCycles.setState({ model, timeline, askedAt: null, feed: sameRound ? feed : [] });
    return null;
  }

  const { model, timeline, askedAt } = useCycles.getState();
  // Before its own full a connection can be sent deltas of a round it knows nothing about.
  if (model === null || timeline === null) return null;
  if (askedAt !== null) {
    if (now - askedAt < RESYNC_RETRY_MS) return null;
    useCycles.setState({ askedAt: now });
    return 'resync';
  }

  const result = applyDelta(model, message);
  if (result === null) {
    useCycles.setState({ askedAt: now });
    return 'resync';
  }
  // The same model back means the delta was old news: there is no tick to place.
  if (result.model === model) return null;

  timeline.arrive(
    {
      tick: result.model.tick,
      walls: result.walls,
      heads: result.model.heads,
      events: result.events,
      reset: false,
    },
    now,
  );
  const lines: FeedItem[] = [];
  for (const event of result.events) {
    if (event.type === 'died') {
      feedSeq += 1;
      lines.push({ seq: feedSeq, killer: event.by, victim: event.slot });
    }
  }
  useCycles.setState({
    model: result.model,
    ...(lines.length === 0
      ? {}
      : { feed: [...useCycles.getState().feed, ...lines].slice(-FEED_LENGTH) }),
  });
  if (result.events.length > 0) {
    for (const listener of eventListeners) listener(result.events);
  }
  return null;
}
