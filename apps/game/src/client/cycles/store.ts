import type { DeltaMessage, FullMessage } from '@clicker/protocol';
import { create } from 'zustand';
import { applyDelta, type CyclesModel, fromFull } from './model';
import { createTimeline, type Timeline } from './timeline';

interface CyclesStore {
  model: CyclesModel | null;
  /** The scene reads this on every frame; it is replaced by each full. */
  timeline: Timeline | null;
  /** A gap was found and the whole round asked for: deltas mean nothing until it comes. */
  awaitingFull: boolean;
}

const EMPTY: CyclesStore = { model: null, timeline: null, awaitingFull: false };

export const useCycles = create<CyclesStore>(() => EMPTY);

export function clearCycles(): void {
  useCycles.setState(EMPTY);
}

/**
 * Takes one `full` or `delta` into the round. `now` is the local clock the scene also reads
 * (`performance.now()`). Returns `'resync'` exactly once per gap: the caller then asks the
 * server for the whole round, and every delta is ignored until that `full` arrives.
 */
export function feedCycles(message: FullMessage | DeltaMessage, now: number): 'resync' | null {
  if (message.type === 'full') {
    const { model, walls } = fromFull(message);
    const timeline = createTimeline(model.tickMs);
    timeline.arrive({ tick: model.tick, walls, heads: model.heads, events: [], reset: true }, now);
    useCycles.setState({ model, timeline, awaitingFull: false });
    return null;
  }

  const { model, timeline, awaitingFull } = useCycles.getState();
  // Before its own full a connection can be sent deltas of a round it knows nothing about.
  if (model === null || timeline === null || awaitingFull) return null;

  const result = applyDelta(model, message);
  if (result === null) {
    useCycles.setState({ awaitingFull: true });
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
  useCycles.setState({ model: result.model });
  return null;
}
