import { describe, expect, it } from 'vitest';
import type { Memory } from '../src/client/audio/mute';
import { createFrameView } from '../src/client/frame-store';

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

const sample = {
  gpu: { median: 1.2, p95: 1.33 },
  cpu: { median: 0.3, p95: 1.2 },
  calls: 15,
  triangles: 64_222,
};

describe('the frame cost line', () => {
  it('is hidden to begin with: it is for whoever builds the game, not for players', () => {
    expect(createFrameView(memory()).getState().shown).toBe(false);
  });

  it('is shown and hidden again by its switch', () => {
    const view = createFrameView(memory());
    view.getState().toggle();
    expect(view.getState().shown).toBe(true);
    view.getState().toggle();
    expect(view.getState().shown).toBe(false);
  });

  it('is still shown the next time the page opens', () => {
    const storage = memory();
    createFrameView(storage).getState().toggle();
    expect(createFrameView(storage).getState().shown).toBe(true);
  });

  it('still works when the browser will not keep anything', () => {
    const view = createFrameView(blocked);
    expect(view.getState().shown).toBe(false);
    view.getState().toggle();
    expect(view.getState().shown).toBe(true);
  });

  it('carries what the scene last measured, and nothing once it stops', () => {
    const view = createFrameView(null);
    expect(view.getState().readout).toBeNull();
    view.getState().publish(sample);
    expect(view.getState().readout).toEqual(sample);
    view.getState().publish(null);
    expect(view.getState().readout).toBeNull();
  });
});
