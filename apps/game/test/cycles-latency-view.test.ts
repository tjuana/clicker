import { describe, expect, it } from 'vitest';
import type { Memory } from '../src/client/audio/mute';
import { createLatencyView } from '../src/client/cycles/latency-store';

/** Storage that behaves like the browser's: strings in, strings out. */
function memory(): Memory {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

/** A private window or blocked storage: every touch throws. */
const blocked: Memory = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('the turn timing line', () => {
  it('is shown to begin with', () => {
    expect(createLatencyView(memory()).getState().shown).toBe(true);
  });

  it('is hidden and shown again by its switch', () => {
    const view = createLatencyView(memory());

    view.getState().toggle();
    expect(view.getState().shown).toBe(false);
    view.getState().toggle();
    expect(view.getState().shown).toBe(true);
  });

  it('is still hidden, and still shown, the next time the page opens', () => {
    const storage = memory();

    createLatencyView(storage).getState().toggle();
    expect(createLatencyView(storage).getState().shown).toBe(false);

    const again = createLatencyView(storage);
    again.getState().toggle();
    expect(createLatencyView(storage).getState().shown).toBe(true);
  });

  it('still works when the browser will not keep anything', () => {
    const view = createLatencyView(blocked);
    expect(view.getState().shown).toBe(true);

    view.getState().toggle();
    expect(view.getState().shown).toBe(false);
  });

  it('works with no storage at all', () => {
    const view = createLatencyView(null);

    view.getState().toggle();
    expect(view.getState().shown).toBe(false);
  });
});
