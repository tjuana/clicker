import {
  apply,
  type Command,
  configFor,
  createRoomState,
  type RaceState,
  type RoomState,
  TURN,
} from '@clicker/game';
import {
  PROTOCOL_VERSION,
  type RaceDeltaMessage,
  type RaceFullMessage,
  toDelta,
  toFull,
} from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { applyDelta, fromFull, GRASS, TOUCHING } from '../src/client/race/model';

/** A race the real rules ran, in the form it goes over the wire, and the cars after every tick. */
function record(ticks: number): {
  full: RaceFullMessage;
  deltas: RaceDeltaMessage[];
  states: RaceState[];
} {
  const config = configFor('race');
  let state: RoomState = createRoomState();
  const run = (command: Command, now: number) => {
    const result = apply(state, command, now, config);
    state = result.state;
    return result.events;
  };
  run({ type: 'join', playerId: 'host', connectionId: 'c', name: 'Host', hostKey: 'k' }, 0);
  run({ type: 'setMode', playerId: 'host', mode: 'race' }, 0);
  for (let bot = 0; bot < 7; bot += 1) run({ type: 'addBot', playerId: 'host' }, 0);
  run({ type: 'start', playerId: 'host' }, 0);
  const goAt = state.round?.goAt ?? 0;
  run({ type: 'tick' }, goAt);

  const full = toFull(state);
  if (full?.mode !== 'race') throw new Error('a started race has a field');
  const deltas: RaceDeltaMessage[] = [];
  const states: RaceState[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    // The host plays too: gas, then gas and steering, so a person's cars differ from the bots'.
    const mask = tick < 20 ? 1 : tick % 40 < 20 ? 1 | 4 : 1 | 8;
    run({ type: 'input', playerId: 'host', input: { type: 'keys', mask } }, goAt);
    for (const event of run({ type: 'step' }, goAt)) {
      if (event.type !== 'stepped' || event.mode !== 'race') continue;
      const delta = toDelta(state, event);
      if (delta.mode === 'race') deltas.push(delta);
      states.push(state.modeState as RaceState);
    }
  }
  return { full, deltas, states };
}

describe('replaying a recorded race', () => {
  const ticks = 600;
  const { full, deltas, states } = record(ticks);

  it('is a race worth replaying: cars move, turn, change places and get touched', () => {
    expect(deltas).toHaveLength(ticks);
    const last = deltas.at(-1) as RaceDeltaMessage;
    const first = deltas[0] as RaceDeltaMessage;
    expect(last.cars.slice(1, 3)).not.toEqual(first.cars.slice(1, 3));
    const orders = new Set(deltas.map((d) => d.cars.filter((_, i) => i % 7 === 0).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('ends every tick with every car where the rules have it, keyed by slot', () => {
    let model = fromFull(full);
    deltas.forEach((delta, index) => {
      const result = applyDelta(model, delta);
      if (result === null) throw new Error(`delta ${delta.t} was refused`);
      model = result.model;
      const race = states[index] as RaceState;
      expect(model.tick).toBe(race.tick);
      expect(model.cars.size).toBe(race.cars.filter((car) => !car.out).length);
      for (const car of race.cars) {
        const mine = model.cars.get(car.slot);
        if (car.out) continue;
        expect(
          [mine?.x, mine?.y, mine?.heading, mine?.speed, mine?.lap],
          `slot ${car.slot} after tick ${delta.t}`,
        ).toEqual([car.x, car.y, car.heading, car.speed, car.lap]);
      }
    });
  });

  it('lists the slots in the order of the race', () => {
    const delta = deltas.at(-1) as RaceDeltaMessage;
    const result = applyDelta(fromFull(full), delta);
    expect(result?.model.order).toEqual(delta.cars.filter((_, i) => i % 7 === 0));
  });
});

function fullOf(slots: number[]): RaceFullMessage {
  return {
    v: PROTOCOL_VERSION,
    type: 'full',
    mode: 'race',
    tick: 10,
    tickMs: 50,
    track: 'ring',
    laps: 3,
    cars: slots.map((slot) => ({
      slot,
      id: String(slot + 1),
      bot: false,
      x: 0,
      y: 0,
      heading: 0,
      speed: 0,
      lap: 0,
      finish: slot === 5 ? 9 : null,
      best: null,
      lapStart: 0,
    })),
  };
}

function deltaOf(
  t: number,
  cars: number[],
  events: RaceDeltaMessage['events'] = [],
): RaceDeltaMessage {
  return { v: PROTOCOL_VERSION, type: 'delta', mode: 'race', t, cars, events };
}

describe('applyDelta', () => {
  it('keys cars by slot whatever their order in the message', () => {
    const model = fromFull(fullOf([3, 1]));
    const result = applyDelta(
      model,
      deltaOf(11, [1, 100, 200, 300, 400, 1, GRASS, 3, 5, 6, 0, 7, 0, 0]),
    );
    expect(result?.model.order).toEqual([1, 3]);
    expect(result?.model.cars.get(1)).toMatchObject({ x: 100, y: 200, heading: 300, flags: GRASS });
    expect(result?.model.cars.get(3)).toMatchObject({ x: 5, speed: 7 });
  });

  it('takes the finish from the full as a flag', () => {
    expect(fromFull(fullOf([5, 1])).cars.get(5)?.flags).toBe(1);
    expect(fromFull(fullOf([5, 1])).cars.get(1)?.flags).toBe(0);
  });

  it('asks for the whole race when a slot appears that it has never seen', () => {
    const model = fromFull(fullOf([0, 1]));
    expect(applyDelta(model, deltaOf(11, [0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('ignores a tick it has already seen, which a connection gets before its own full', () => {
    const model = fromFull(fullOf([0]));
    const old = applyDelta(model, deltaOf(10, [0, 9, 9, 9, 9, 9, 0]));
    const older = applyDelta(model, deltaOf(3, [0, 9, 9, 9, 9, 9, 0]));
    expect(old?.model).toBe(model);
    expect(older?.events).toEqual([]);
  });

  it('takes a gap in the ticks as it comes: each delta is every car, only events were lost', () => {
    const model = fromFull(fullOf([0]));
    const result = applyDelta(
      model,
      deltaOf(25, [0, 7, 8, 9, 1, 0, TOUCHING], [{ type: 'bump', slot: 0 }]),
    );
    expect(result?.model.tick).toBe(25);
    expect(result?.model.cars.get(0)?.x).toBe(7);
    expect(result?.events).toEqual([{ type: 'bump', slot: 0 }]);
  });

  it('keeps headings as they came, within one turn', () => {
    const model = fromFull(fullOf([0]));
    const result = applyDelta(model, deltaOf(11, [0, 0, 0, TURN - 1, 0, 0, 0]));
    expect(result?.model.cars.get(0)?.heading).toBe(TURN - 1);
  });
});
