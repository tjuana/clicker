import { beforeEach, describe, expect, it } from 'vitest';
import { createLatency, EXPIRY_MS, type Latency, WINDOW } from '../src/client/cycles/latency';

/**
 * Directions are the protocol's: 0 east, 1 south, 2 west, 3 north. A right turn adds one, a left
 * turn takes one away, both modulo four. Time is whatever number the test hands in.
 */
describe('how long a turn takes to show', () => {
  let latency: Latency;
  beforeEach(() => {
    latency = createLatency();
  });

  /** The bike is seen riding in `dir` on both ends, before any turn is made. */
  function ride(dir: number, now = 0): void {
    latency.observeServer(dir, now);
    latency.observeScreen(dir, now);
  }

  it('says nothing before a turn has been seen', () => {
    ride(0);
    expect(latency.read()).toEqual({ server: null, screen: null });
  });

  it('measures a turn from its sending to each end where the new direction first shows', () => {
    ride(0);
    latency.sent('right', 1_000);

    expect(latency.observeServer(0, 1_050)).toBeNull();
    expect(latency.observeServer(1, 1_142)).toBe(142);
    expect(latency.observeScreen(0, 1_200)).toBeNull();
    expect(latency.observeScreen(1, 1_318)).toBe(318);

    expect(latency.read()).toEqual({
      server: { last: 142, median: 142 },
      screen: { last: 318, median: 318 },
    });
  });

  it('keeps the two ends apart: one seeing a turn does not use it up for the other', () => {
    ride(2);
    latency.sent('left', 500);
    latency.observeServer(1, 640);
    latency.sent('left', 700);
    // The screen is still showing the first turn when the second has been sent.
    expect(latency.observeScreen(1, 800)).toBe(300);
    expect(latency.observeServer(0, 810)).toBe(110);
    expect(latency.observeScreen(0, 960)).toBe(260);
  });

  it('matches turns in the order they were sent, each with its own time', () => {
    ride(0);
    latency.sent('right', 1_000);
    latency.sent('right', 1_030);

    expect(latency.observeServer(1, 1_130)).toBe(130);
    expect(latency.observeServer(2, 1_255)).toBe(225);
    // A turn back the other way, sent while the first two were still waiting.
    latency.sent('left', 1_300);
    expect(latency.observeServer(1, 1_380)).toBe(80);
  });

  it('matches by the direction, so a turn the bike never made does not shift the ones after it', () => {
    ride(0);
    // The first never took effect: the server did not have room for it, or the bike was already dead.
    latency.sent('right', 1_000);
    latency.sent('left', 1_100);
    // So the bike faces north, where the second turn alone takes it and the two together do not.
    expect(latency.observeServer(3, 1_240)).toBeNull();

    latency.sent('right', 1_500);
    expect(latency.observeServer(0, 1_620)).toBe(120);
    expect(latency.read().server).toEqual({ last: 120, median: 120 });
  });

  it('takes the later turn when one look at the bike spans two of them', () => {
    ride(0);
    latency.sent('right', 1_000);
    latency.sent('right', 1_100);

    // A frame after a stall: the bike has turned twice since the last one drawn.
    expect(latency.observeScreen(2, 1_400)).toBe(300);
    // Nothing is left of the first: the next change is explained by the next turn.
    latency.sent('left', 1_500);
    expect(latency.observeScreen(1, 1_650)).toBe(150);
  });

  it('forgets a turn that has waited too long, and the turns after it are not measured against it', () => {
    ride(0);
    latency.sent('right', 1_000);

    // Just inside the limit it still counts.
    expect(latency.observeServer(1, 1_000 + EXPIRY_MS)).toBe(EXPIRY_MS);

    ride(1, 5_000);
    latency.sent('right', 6_000);
    latency.sent('right', 6_000 + EXPIRY_MS + 1);
    // The first is gone by now, so this change belongs to the second.
    expect(latency.observeServer(2, 6_000 + EXPIRY_MS + 90)).toBe(89);
  });

  it('does not match a turn that expired to a change that happens after it', () => {
    ride(0);
    latency.sent('right', 1_000);

    expect(latency.observeServer(1, 1_000 + EXPIRY_MS + 1)).toBeNull();
    expect(latency.read().server).toBeNull();
  });

  it('drops the turns waiting when the bike dies, so the first turn of the next life stands alone', () => {
    ride(0);
    latency.sent('right', 1_000);
    latency.observeServer(null, 1_100);
    // The screen still draws the bike alive, and the player turns it.
    latency.sent('right', 1_150);
    latency.observeServer(null, 1_200);
    latency.observeScreen(null, 1_300);

    // It comes back facing wherever the room puts it. Either turn that was waiting would lead to
    // the direction the next one does, since all three go the same way.
    latency.observeServer(3, 1_900);
    latency.observeScreen(3, 2_000);
    latency.sent('right', 2_100);
    expect(latency.observeServer(0, 2_220)).toBe(120);
    expect(latency.observeScreen(0, 2_400)).toBe(300);
  });

  it('gives the median of the last ten, and the last one on its own', () => {
    ride(0);
    let dir = 0;
    let at = 0;
    // 1, 2, ... 12 ms: the first two fall out of the window of ten.
    for (let ms = 1; ms <= WINDOW + 2; ms += 1) {
      at += 1_000;
      latency.sent('right', at);
      dir = (dir + 1) & 3;
      latency.observeServer(dir, at + ms);
    }

    // 3 to 12: the middle two are 7 and 8.
    expect(latency.read().server).toEqual({ last: 12, median: 7.5 });
  });

  it('takes the middle one while fewer than ten are in', () => {
    ride(0);
    let dir = 0;
    for (const [at, ms] of [
      [1_000, 300],
      [2_000, 100],
      [3_000, 200],
    ] as const) {
      latency.sent('right', at);
      dir = (dir + 1) & 3;
      latency.observeServer(dir, at + ms);
    }

    expect(latency.read().server).toEqual({ last: 200, median: 200 });
  });

  it('hands out the same readout until something new is measured', () => {
    ride(0);
    const before = latency.read();
    expect(latency.read()).toBe(before);

    latency.sent('right', 10);
    latency.observeServer(1, 60);
    const after = latency.read();
    expect(after).not.toBe(before);
    expect(latency.read()).toBe(after);
  });

  it('starts from nothing again on a reset', () => {
    ride(0);
    latency.sent('right', 10);
    latency.observeServer(1, 60);
    latency.sent('right', 100);

    latency.reset();

    expect(latency.read()).toEqual({ server: null, screen: null });
    // The turn that was waiting is not there to be matched by whatever comes first.
    expect(latency.observeServer(2, 150)).toBeNull();
    expect(latency.observeServer(3, 200)).toBeNull();
  });
});
