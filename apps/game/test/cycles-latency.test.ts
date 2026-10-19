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
    expect(latency.read()).toEqual({ server: null, screen: null, overshoot: null });
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
      // Nobody said where the bike was seen, or where it turned: there is nothing to count.
      overshoot: null,
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

    expect(latency.read()).toEqual({ server: null, screen: null, overshoot: null });
    // The turn that was waiting is not there to be matched by whatever comes first.
    expect(latency.observeServer(2, 150)).toBeNull();
    expect(latency.observeServer(3, 200)).toBeNull();
  });

  /** A place on the field, in cells, on a straight going east (`dir` 0) or south (anything else). */
  const spot = (dir: number, along: number): { x: number; z: number } =>
    dir === 0 ? { x: along, z: 5.5 } : { x: 5.5, z: along };

  /** The screen draws the player's bike pointing `dir` at `at`, as of `now`. */
  const seenAt = (dir: number, at: { x: number; z: number }, now = 0): void => {
    latency.observeScreen(dir, now, at.x, at.z);
  };

  describe('how many cells late the turn lands', () => {
    it.each([
      ['east', 0, { x: 10.3, z: 5.5 }, { x: 12.5, z: 5.5 }, 2.2],
      ['south', 1, { x: 4.5, z: 10.2 }, { x: 4.5, z: 13.5 }, 3.3],
      ['west', 2, { x: 20.4, z: 3.5 }, { x: 17.5, z: 3.5 }, 2.9],
      ['north', 3, { x: 6.5, z: 20.2 }, { x: 6.5, z: 18.5 }, 1.7],
    ])('counts them along the way the bike was going: %s', (_, dir, saw, corner, cells) => {
      ride(dir);
      seenAt(dir, saw);
      latency.sent('right', 1_000);

      latency.observeServer((dir + 1) & 3, 1_090, corner);

      expect(latency.read().overshoot?.last).toBeCloseTo(cells, 9);
      expect(latency.read().overshoot?.median).toBeCloseTo(cells, 9);
    });

    it('is one cell when the bike was seen at the middle of the cell before the corner', () => {
      ride(0);
      seenAt(0, { x: 10.5, z: 5.5 });
      latency.sent('left', 1_000);

      latency.observeServer(3, 1_100, { x: 11.5, z: 5.5 });

      expect(latency.read().overshoot?.last).toBeCloseTo(1, 9);
    });

    it('is a little less than nothing when the corner was a hair behind what was seen', () => {
      ride(0);
      // Drawn just past the middle of its cell on the way to the next, and turned in that cell.
      seenAt(0, { x: 10.7, z: 5.5 });
      latency.sent('right', 1_000);

      latency.observeServer(1, 1_100, { x: 10.5, z: 5.5 });

      expect(latency.read().overshoot?.last).toBeCloseTo(-0.2, 9);
    });

    it('takes the place the bike was drawn at when the turn was sent, not one drawn after', () => {
      ride(0);
      seenAt(0, { x: 9.2, z: 5.5 }, 940);
      seenAt(0, { x: 9.9, z: 5.5 }, 990);
      latency.sent('right', 1_000);
      // Frames after the press say nothing about where it was when the turn was sent.
      seenAt(0, { x: 10.6, z: 5.5 }, 1_050);

      latency.observeServer(1, 1_090, { x: 12.5, z: 5.5 });

      expect(latency.read().overshoot?.last).toBeCloseTo(2.6, 9);
    });

    it('still gives the time when there was no corner to measure to, as from a full', () => {
      ride(0);
      seenAt(0, { x: 10.5, z: 5.5 });
      latency.sent('right', 1_000);

      expect(latency.observeServer(1, 1_090)).toBe(90);

      expect(latency.read().server?.last).toBe(90);
      expect(latency.read().overshoot).toBeNull();
    });

    it('still gives the time when no bike was on screen to see, and counts the next turn alone', () => {
      ride(0);
      latency.observeScreen(null, 900);
      latency.sent('right', 1_000);
      latency.observeServer(1, 1_090, { x: 12.5, z: 5.5 });

      expect(latency.read().server?.last).toBe(90);
      expect(latency.read().overshoot).toBeNull();

      seenAt(1, { x: 5.5, z: 10.4 }, 1_200);
      latency.sent('left', 1_300);
      latency.observeServer(0, 1_400, { x: 5.5, z: 12.5 });
      expect(latency.read().overshoot?.last).toBeCloseTo(2.1, 9);
    });

    it('leaves out a turn sent before the one ahead of it had shown: it is not on a straight', () => {
      ride(0);
      seenAt(0, { x: 10.3, z: 5.5 });
      latency.sent('right', 1_000);
      // The screen has not turned yet, so the second is sent with the bike still drawn going east
      // while the server already has it going south.
      seenAt(0, { x: 10.8, z: 5.5 }, 1_060);
      latency.sent('right', 1_060);

      latency.observeServer(1, 1_130, { x: 12.5, z: 5.5 });
      latency.observeServer(2, 1_255, { x: 12.5, z: 7.5 });

      expect(latency.read().server?.last).toBe(195);
      expect(latency.read().overshoot).toEqual({
        last: expect.closeTo(2.2, 9),
        median: expect.closeTo(2.2, 9),
      });
    });

    it('forgets the turn that was waiting when the bike died, and the place it was seen at', () => {
      ride(0);
      seenAt(0, { x: 10.3, z: 5.5 });
      latency.sent('right', 1_000);
      latency.observeServer(null, 1_100);
      latency.observeScreen(null, 1_300);

      // It comes back going north, and the first turn it makes is counted on its own.
      latency.observeServer(3, 1_900);
      seenAt(3, { x: 7.5, z: 12.2 }, 2_000);
      latency.sent('right', 2_100);
      expect(latency.observeServer(0, 2_220, { x: 7.5, z: 11.5 })).toBe(120);

      // North is the way of falling z: from 12.2 to 11.5 is 0.7 of a cell along the way.
      expect(latency.read().overshoot?.last).toBeCloseTo(0.7, 9);
    });

    it('does not carry the place a bike was seen at over its death into the next life', () => {
      ride(0);
      seenAt(0, { x: 10.3, z: 5.5 });
      latency.observeScreen(null, 1_300);
      latency.observeServer(null, 1_100);
      latency.observeServer(0, 1_900);
      // No frame has drawn the new life yet: there is nothing seen to measure from.
      latency.sent('right', 2_000);

      latency.observeServer(1, 2_100, { x: 3.5, z: 5.5 });

      expect(latency.read().server?.last).toBe(100);
      expect(latency.read().overshoot).toBeNull();
    });

    it('gives the median of the last ten, and the last one on its own', () => {
      ride(0);
      let dir = 0;
      let at = 0;
      // 0.1, 0.2, ... 1.2 cells: the first two fall out of the window of ten.
      for (let k = 1; k <= WINDOW + 2; k += 1) {
        at += 1_000;
        const saw = 10.5;
        seenAt(dir, spot(dir, saw), at - 10);
        latency.sent(dir === 0 ? 'right' : 'left', at);
        const next = dir === 0 ? 1 : 0;
        latency.observeServer(next, at + 50, spot(dir, saw + k / 10));
        dir = next;
      }

      // 0.3 to 1.2: the middle two are 0.7 and 0.8.
      expect(latency.read().overshoot?.last).toBeCloseTo(1.2, 9);
      expect(latency.read().overshoot?.median).toBeCloseTo(0.75, 9);
    });
  });
});
