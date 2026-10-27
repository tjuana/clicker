import { describe, expect, it } from 'vitest';
import { createHeldKeys } from '../src/client/race/held-keys';

/** A socket that can be closed: a send while closed fails, as `send` in net.ts does. */
function socket() {
  const sent: number[] = [];
  const state = { open: true };
  return {
    sent,
    state,
    send: (mask: number): boolean => {
      if (!state.open) return false;
      sent.push(mask);
      return true;
    },
  };
}

describe('the keys held across a reconnect', () => {
  it('sends the mask again when the room has welcomed the connection back', () => {
    const s = socket();
    const held = createHeldKeys(s.send);
    held.set(1);
    s.state.open = false;
    s.state.open = true;
    held.resend();
    expect(s.sent).toEqual([1, 1]);
  });

  it('sends a change made while the socket was closed once it is back', () => {
    const s = socket();
    const held = createHeldKeys(s.send);
    s.state.open = false;
    held.set(5);
    expect(s.sent).toEqual([]);
    s.state.open = true;
    held.resend();
    expect(s.sent).toEqual([5]);
  });

  it('says nothing on a welcome when no key is held', () => {
    const s = socket();
    const held = createHeldKeys(s.send);
    held.set(1);
    held.set(0);
    held.resend();
    expect(s.sent).toEqual([1, 0]);
  });
});
