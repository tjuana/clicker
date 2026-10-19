import { describe, expect, it } from 'vitest';
import { createMute, type Memory } from '../src/client/audio/mute';

/** Storage that behaves like the browser's: strings in, strings out. */
function memory(): Memory & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
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

describe('the mute switch', () => {
  it('starts with the sound on', () => {
    expect(createMute(memory()).getState().muted).toBe(false);
  });

  it('turns the sound off and on again', () => {
    const mute = createMute(memory());

    mute.getState().toggle();
    expect(mute.getState().muted).toBe(true);
    mute.getState().toggle();
    expect(mute.getState().muted).toBe(false);
  });

  it('is still off, and still on, the next time the page opens', () => {
    const storage = memory();

    createMute(storage).getState().toggle();
    expect(createMute(storage).getState().muted).toBe(true);

    const again = createMute(storage);
    again.getState().toggle();
    expect(createMute(storage).getState().muted).toBe(false);
  });

  it('keeps working where storage is blocked, just without remembering', () => {
    const mute = createMute(blocked);
    expect(mute.getState().muted).toBe(false);

    expect(() => mute.getState().toggle()).not.toThrow();
    expect(mute.getState().muted).toBe(true);
  });

  it('works with no storage at all', () => {
    const mute = createMute(null);

    mute.getState().toggle();
    expect(mute.getState().muted).toBe(true);
  });

  it('takes a value it does not recognise for the sound being on', () => {
    const storage = memory();
    storage.setItem('clicker.muted', 'maybe');

    expect(createMute(storage).getState().muted).toBe(false);
  });
});
