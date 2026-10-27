import { describe, expect, it } from 'vitest';
import { carFlags } from '../src/modes/race';
import { BRAKE, type Car, GAS, LEFT } from '../src/modes/race/car';
import { RACE } from '../src/modes/race/config';
import { cos, ONE, sin } from '../src/modes/race/fixed';
import { over, raceResults, standings, startRace, stepRace } from '../src/modes/race/race';
import { emptyRace, newCar, type RaceState } from '../src/modes/race/state';
import { buildTrack, point, project, type TrackData } from '../src/modes/race/track';
import { TRACKS } from '../src/modes/race/tracks';

const track = buildTrack(TRACKS.ring as TrackData);
const last = track.pieces.length - 1;
const lastLength = track.pieces[last]?.length ?? 0;

function field(count: number, bots = false): RaceState {
  const cars = Array.from({ length: count }, (_, slot) => newCar(slot, `p${slot}`, bots));
  return startRace(emptyRace('ring', 7, cars), track, RACE);
}

/** One car put on the road at a place, facing along it. */
function placed(
  piece: number,
  along: number,
  over_: Partial<ReturnType<typeof newCar>> = {},
  tick = 0,
): RaceState {
  const where = point(track, piece, along, 0);
  const car = {
    ...newCar(0, 'p0', false),
    x: where.x,
    y: where.y,
    heading: where.heading,
    piece,
    ...over_,
  };
  return { ...emptyRace('ring', 7, [car]), tick };
}

function run(state: RaceState, ticks: number): RaceState {
  let now = state;
  for (let i = 0; i < ticks; i += 1) now = stepRace(now, track, RACE).state;
  return now;
}

/** The distance between the nearest circles of two cars. */
function gap(a: Car, b: Car): number {
  const circles = (c: Car) =>
    [RACE.reach, -RACE.reach].map((end) => ({
      x: c.x + Math.trunc((end * cos(c.heading)) / ONE),
      y: c.y + Math.trunc((end * sin(c.heading)) / ONE),
    }));
  let best = Number.POSITIVE_INFINITY;
  for (const p of circles(a)) {
    for (const q of circles(b)) best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
  }
  return best;
}

describe('the grid', () => {
  it('puts twenty cars on the road, facing the way round, none inside another', () => {
    const { cars } = field(20);
    for (const car of cars) {
      const place = project(track, car.piece, car.x, car.y);
      expect(Math.abs(place.lateral)).toBeLessThan(RACE.wall - RACE.radius);
      const tangent = point(track, car.piece, place.along, 0).heading;
      expect(cos(car.heading - tangent)).toBeGreaterThan(ONE * 0.99);
      expect(car.lap).toBe(0);
      expect(car.speed).toBe(0);
    }
    for (let i = 0; i < cars.length; i += 1) {
      for (let j = i + 1; j < cars.length; j += 1) {
        const a = cars[i];
        const b = cars[j];
        if (!a || !b) throw new Error('missing car');
        expect(gap(a, b)).toBeGreaterThan(2 * RACE.radius);
      }
    }
  });

  it('stands behind the start line, in slot order, pole first', () => {
    const { cars } = field(6);
    const order = standings(startRace(emptyRace('ring', 1, cars), track, RACE), track);
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
    for (const c of cars) expect(c.piece).toBe(last);
  });

  it('gives bots a pace of their own and humans the full top speed', () => {
    const mixed = startRace(
      emptyRace('ring', 3, [
        newCar(0, 'h', false),
        ...[1, 2, 3, 4].map((s) => newCar(s, `b${s}`, true)),
      ]),
      track,
      RACE,
    );
    expect(mixed.cars[0]?.pace).toBe(100);
    const paces = mixed.cars.slice(1).map((c) => c.pace);
    for (const pace of paces) {
      expect(pace).toBeGreaterThanOrEqual(88);
      expect(pace).toBeLessThanOrEqual(97);
    }
    expect(new Set(paces).size).toBeGreaterThan(1);
  });
});

describe('laps', () => {
  it('reports the lap in the tick it is crossed', () => {
    const start = placed(last, lastLength - 10, { speed: 150, keys: GAS, lap: 0 });
    const { state, changes } = stepRace(start, track, RACE);
    expect(changes.laps).toEqual([{ slot: 0, lap: 1, time: null }]);
    expect(state.cars[0]?.lap).toBe(1);
  });

  it('says how many ticks the lap took, counted between two crossings', () => {
    const start = placed(
      last,
      lastLength - 10,
      { speed: 150, keys: GAS, lap: 1, lapStart: 40 },
      99,
    );
    const { changes, state } = stepRace(start, track, RACE);
    expect(changes.laps).toEqual([{ slot: 0, lap: 2, time: state.tick - 40 }]);
    expect(state.cars[0]?.best).toBe(state.tick - 40);
  });

  it('gives a lap no time when the one before was cut short', () => {
    const start = placed(last, lastLength - 10, { speed: 150, keys: GAS, lap: 1, lapStart: -1 });
    expect(stepRace(start, track, RACE).changes.laps).toEqual([{ slot: 0, lap: 2, time: null }]);
  });

  it('gives nothing for driving back over the line and forward again', () => {
    let state = placed(0, 150, { speed: -50, keys: BRAKE, lap: 1 });
    state = run(state, 8);
    expect(state.cars[0]?.lap).toBe(0);
    state = run({ ...state, cars: state.cars.map((c) => ({ ...c, keys: GAS })) }, 150);
    expect(state.cars[0]?.lap).toBe(1);
    expect(state.cars[0]?.finish).toBeNull();
  });

  it('counts a lap once when a bump pushes the car back over the line', () => {
    // A crosses the line at speed into B, which stands just past it: the bump shoves A back
    // behind the line in the same tick it crossed it.
    const a = placed(last, lastLength - 20, { speed: 150, keys: GAS, lap: 0 }).cars[0] as Car;
    const spot = point(track, 0, 300, 0);
    const b: Car = {
      ...newCar(1, 'p1', false),
      x: spot.x,
      y: spot.y,
      heading: spot.heading,
      piece: 0,
      lap: 1,
    };
    let state: RaceState = emptyRace('ring', 7, [a, b]);
    let events = 0;
    let lowest = 0;
    for (let i = 0; i < 400; i += 1) {
      const step = stepRace(state, track, RACE);
      events += step.changes.laps.filter((l) => l.slot === 0).length;
      const lap = step.state.cars[0]?.lap ?? 0;
      expect(lap).toBeGreaterThanOrEqual(lowest);
      lowest = lap;
      state = step.state;
    }
    // Every lap on the card was announced once, and the car did get over the line in the end.
    expect(events).toBe(state.cars[0]?.lap);
    expect(events).toBe(1);
  });

  it('records no best lap for a re-crossing after reversing over the line', () => {
    let state = placed(0, 150, { speed: -50, keys: BRAKE, lap: 2, lapStart: 5 }, 30);
    state = run(state, 8);
    expect(state.cars[0]?.lap).toBe(1);
    state = run({ ...state, cars: state.cars.map((c) => ({ ...c, keys: GAS })) }, 150);
    expect(state.cars[0]?.lap).toBe(2);
    expect(state.cars[0]?.best).toBeNull();
  });

  it('records the best lap from the tick the lap began', () => {
    const start = placed(
      last,
      lastLength - 10,
      {
        speed: 150,
        keys: GAS,
        lap: 1,
        lapStart: 100,
      },
      900,
    );
    const { state } = stepRace(start, track, RACE);
    expect(state.cars[0]?.lap).toBe(2);
    expect(state.cars[0]?.best).toBe(901 - 100);
    expect(state.cars[0]?.lapStart).toBe(901);
  });
});

describe('the finish', () => {
  const crossing = (lap: number) =>
    placed(last, lastLength - 10, { speed: 150, keys: GAS, lap }, 500);

  it('is reached by completing the third lap, and not before', () => {
    const early = stepRace(crossing(2), track, RACE);
    expect(early.state.cars[0]?.lap).toBe(3);
    expect(early.state.cars[0]?.finish).toBeNull();
    const done = stepRace(crossing(3), track, RACE);
    expect(done.state.cars[0]?.finish).toBe(501);
    expect(done.state.firstFinish).toBe(501);
    expect(done.changes.finished).toEqual([0]);
  });

  it('goes on under its own steam, whatever the keys say, and counts no more laps', () => {
    // Somebody is still racing, or the race would be over and the step would do nothing.
    const start = crossing(3);
    const other = { ...newCar(1, 'p1', false), piece: 3, lap: 1 };
    let state = stepRace({ ...start, cars: [...start.cars, other] }, track, RACE).state;
    state = run({ ...state, cars: state.cars.map((c) => ({ ...c, keys: BRAKE | LEFT })) }, 400);
    const car = state.cars[0];
    expect(car?.finish).toBe(501);
    expect(car?.lap).toBe(4);
    // Cruising at half the top speed rather than reversing as the keys asked, and never stopped:
    // a car left standing on the line is a wall for those still racing.
    expect(car?.speed).toBeGreaterThan(0);
    expect(car?.speed).toBeLessThanOrEqual(RACE.topSpeed / 2);
  });

  it('counts no more laps when it drives over the line again', () => {
    // Finished, and about five tiles short of the line: at its cruising pace the line is crossed
    // inside the 600 ticks, and the race is not yet over (it ends 900 ticks after the first finish).
    const piece = track.pieces.findIndex((p) => track.length - p.start < 5 * 4096);
    const done = placed(piece, 0, {
      finish: 500,
      lap: 4,
      pace: RACE.coolPace,
      speed: 100,
    });
    const other = { ...field(2).cars[1], keys: 0 } as Car;
    let state: RaceState = { ...done, cars: [...done.cars, other], tick: 501, firstFinish: 500 };
    let wrapped = false;
    for (let i = 0; i < 600; i += 1) {
      const before = state.cars[0]?.piece ?? 0;
      state = stepRace(state, track, RACE).state;
      if ((state.cars[0]?.piece ?? 0) < before) wrapped = true;
    }
    expect(wrapped).toBe(true);
    expect(state.cars[0]?.lap).toBe(4);
    expect(state.cars[0]?.best).toBeNull();
    expect(state.cars[0]?.finish).toBe(500);
  });
});

describe('standings', () => {
  function three(): RaceState {
    const base = field(4);
    const cars = base.cars.map((c) => ({ ...c }));
    const set = (i: number, patch: Partial<(typeof cars)[number]>) =>
      Object.assign(cars[i] ?? {}, patch);
    const at = (i: number, piece: number, along: number, lap: number) => {
      const w = point(track, piece, along, 0);
      set(i, { x: w.x, y: w.y, heading: w.heading, piece, lap });
    };
    at(0, 2, 500, 1);
    at(1, 5, 100, 1);
    at(2, 2, 500, 2);
    at(3, 2, 500, 1);
    return { ...base, cars };
  }

  it('orders by lap, then by place on the track, then by slot', () => {
    expect(standings(three(), track)).toEqual([2, 1, 0, 3]);
  });

  it('puts finishers first, by their finish tick, whatever their progress', () => {
    const state = three();
    state.cars[3] = { ...(state.cars[3] as (typeof state.cars)[number]), finish: 900 };
    state.cars[0] = { ...(state.cars[0] as (typeof state.cars)[number]), finish: 800 };
    expect(standings(state, track)).toEqual([0, 3, 2, 1]);
  });

  it('breaks a tie of finish ticks by slot', () => {
    const state = three();
    for (const i of [1, 3]) {
      state.cars[i] = { ...(state.cars[i] as (typeof state.cars)[number]), finish: 800 };
    }
    expect(standings(state, track).slice(0, 2)).toEqual([1, 3]);
  });
});

describe('over', () => {
  const done = (finish: number | null) => ({ ...field(2), firstFinish: finish });
  const finishedCar = (state: RaceState, i: number): RaceState => ({
    ...state,
    cars: state.cars.map((c, k) => (k === i ? { ...c, finish: 100 } : c)),
  });

  it('holds while somebody is still racing', () => {
    expect(over({ ...done(null), tick: 100 }, RACE)).toBe(false);
    expect(over({ ...finishedCar(done(100), 0), tick: 500 }, RACE)).toBe(false);
  });

  it('ends when every car has finished', () => {
    expect(over(finishedCar(finishedCar(done(100), 0), 1), RACE)).toBe(true);
  });

  it('ends thirty seconds after the first finisher', () => {
    const state = finishedCar(done(100), 0);
    expect(over({ ...state, tick: 100 + 30 * 30 - 1 }, RACE)).toBe(false);
    expect(over({ ...state, tick: 100 + 30 * 30 }, RACE)).toBe(true);
  });

  it('ends at the five-minute cap', () => {
    expect(over({ ...done(null), tick: 5 * 60 * 30 - 1 }, RACE)).toBe(false);
    expect(over({ ...done(null), tick: 5 * 60 * 30 }, RACE)).toBe(true);
  });
});

describe('results', () => {
  it('ranks finishers by time and the rest by the distance they were short', () => {
    const state = field(3);
    const cars = state.cars.map((c, i) => ({
      ...c,
      finish: i === 2 ? 700 : i === 0 ? 900 : null,
      lap: i === 1 ? 2 : 4,
      best: i === 2 ? 600 : null,
    }));
    const rows = raceResults({ ...state, cars }, track, RACE);
    expect(rows.map((r) => [r.rank, r.slot])).toEqual([
      [1, 2],
      [2, 0],
      [3, 1],
    ]);
    expect(rows[0]).toMatchObject({ laps: 3, best: 600, finish: 700, short: null });
    expect(rows[2]?.laps).toBe(1);
    expect(rows[2]?.short).toBeGreaterThan(0);
  });

  it('is filled in the tick the race ends', () => {
    const start = placed(last, lastLength - 10, { speed: 150, keys: GAS, lap: 3 }, 500);
    expect(start.results).toBeNull();
    expect(stepRace(start, track, RACE).state.results?.[0]?.rank).toBe(1);
  });
});

describe('the step', () => {
  it('leaves the state it was given as it found it', () => {
    const state = field(6);
    const moving = { ...state, cars: state.cars.map((c) => ({ ...c, keys: GAS })) };
    const before = structuredClone(moving);
    stepRace(moving, track, RACE);
    expect(moving).toEqual(before);
  });

  it('does nothing once the race is over', () => {
    const racing = {
      ...field(2),
      cars: field(2).cars.map((c) => ({ ...c, keys: GAS, speed: 100 })),
    };
    for (const over_ of [{ tick: RACE.cap }, { tick: 500, firstFinish: 500 - RACE.afterFirst }]) {
      const ended = { ...racing, ...over_ };
      const { state, changes } = stepRace(ended, track, RACE);
      expect(state).toEqual(ended);
      expect(changes).toEqual({ laps: [], finished: [], bumped: [] });
    }
  });

  it('moves every car and the clock', () => {
    const state = run({ ...field(2), cars: field(2).cars.map((c) => ({ ...c, keys: GAS })) }, 10);
    expect(state.tick).toBe(10);
    for (const c of state.cars) expect(c.speed).toBeGreaterThan(0);
  });

  it('bumps cars that touch and says who', () => {
    const base = field(2);
    const [a, b] = base.cars as [(typeof base.cars)[number], (typeof base.cars)[number]];
    const state = {
      ...base,
      cars: [a, { ...b, x: a.x + 100, y: a.y, heading: a.heading, piece: a.piece }],
    };
    const { changes } = stepRace(state, track, RACE);
    expect(changes.bumped).toEqual([0, 1]);
  });

  describe('two cars held in contact', () => {
    // The rear car keeps its foot down on a car standing still in front of it: every tick it
    // drives into the other, is pushed back, and drives into it again.
    function held() {
      const base = field(2);
      const [a, b] = base.cars as [(typeof base.cars)[number], (typeof base.cars)[number]];
      let state: RaceState = {
        ...base,
        cars: [
          { ...a, speed: 0, keys: 0 },
          {
            ...b,
            x: a.x - Math.trunc((1000 * cos(a.heading)) / ONE),
            y: a.y - Math.trunc((1000 * sin(a.heading)) / ONE),
            heading: a.heading,
            piece: a.piece,
            speed: 0,
            keys: GAS,
          },
        ],
      };
      let bumps = 0;
      const touching: boolean[] = [];
      for (let i = 0; i < 60; i += 1) {
        const stepped = stepRace(state, track, RACE);
        state = stepped.state;
        bumps += stepped.changes.bumped.length;
        touching.push(state.cars.every((car) => (carFlags(state, car) & 8) !== 0));
      }
      return { bumps, touching };
    }

    it('bump once, on the tick the contact begins', () => {
      // One event for the pair is two slots: each car was bumped by the other.
      expect(held().bumps).toBe(2);
    });

    it('are flagged as touching on every tick of the contact', () => {
      expect(held().touching).toEqual(Array(60).fill(true));
    });
  });
});
