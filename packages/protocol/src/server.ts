import {
  type ClickerState,
  type CyclesSettings,
  type CyclesState,
  carFlags,
  carsInOrder,
  comparePublicIds,
  configFor,
  forEachCell,
  type GameEvent,
  RACE,
  type RaceChanges,
  type RaceState,
  type RoomState,
  SPEEDS,
  tickMsFor,
  toModeData,
  WALL_MODES,
} from '@clicker/game';
import * as v from 'valibot';
import { PROTOCOL_VERSION } from './client';

/** A full round is far bigger than a snapshot: twenty trails of up to 400 cells. */
export const MAX_SERVER_MESSAGE_BYTES = 128 * 1024;

const versionSchema = v.literal(PROTOCOL_VERSION);
const phaseSchema = v.picklist(['lobby', 'countdown', 'running', 'results']);

const errorCodeSchema = v.picklist([
  'not_joined',
  'not_host',
  'wrong_phase',
  'room_full',
  'invalid_message',
  'bad_version',
  'not_supported',
]);

export const welcomeSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('welcome'),
  you: v.string(),
  isHost: v.boolean(),
});

/** The mode's slot. The room never looks inside it. */
export const clickerDataSchema = v.strictObject({
  scores: v.record(v.string(), v.number()),
  results: v.nullable(
    v.array(
      v.strictObject({
        id: v.string(),
        name: v.string(),
        clicks: v.number(),
        rank: v.number(),
      }),
    ),
  ),
});

export const cyclesDataSchema = v.strictObject({
  /** Cells a second; the lobby shows it and the host changes it. */
  speed: v.picklist(SPEEDS),
  /** Whether a wall is always laid or only while its player holds a key. */
  walls: v.picklist(WALL_MODES),
  results: v.nullable(
    v.array(
      v.strictObject({
        id: v.string(),
        name: v.string(),
        kills: v.number(),
        deaths: v.number(),
        longest: v.number(),
        rank: v.number(),
      }),
    ),
  ),
});

export const raceDataSchema = v.strictObject({
  /** Milliseconds a tick lasts: the results are in ticks, and this turns them into time. */
  tickMs: v.number(),
  results: v.nullable(
    v.array(
      v.strictObject({
        id: v.string(),
        name: v.string(),
        /** The car's colour on the results screen is the one it raced in. */
        slot: v.number(),
        rank: v.number(),
        /** Laps completed. */
        laps: v.number(),
        /** The best lap in ticks, or null if none was completed. */
        best: v.nullable(v.number()),
        /** The tick the car finished on, or null. */
        finish: v.nullable(v.number()),
        /** Units short of the finish for a car that did not make it, or null. */
        short: v.nullable(v.number()),
      }),
    ),
  ),
});

/** What every mode's snapshot has; the mode picks only the `data` slot. */
const snapshotFields = {
  v: versionSchema,
  type: v.literal('snapshot'),
  serverNow: v.number(),
  phase: phaseSchema,
  players: v.array(
    v.strictObject({
      id: v.string(),
      name: v.string(),
      connected: v.boolean(),
      bot: v.boolean(),
    }),
  ),
  round: v.nullable(v.strictObject({ goAt: v.number(), endsAt: v.number() })),
  notice: v.nullable(v.literal('round_aborted')),
};

/** The data is tied to the mode: a light-cycle snapshot carrying scores is a bug, not a message. */
export const snapshotSchema = v.variant('mode', [
  v.strictObject({ ...snapshotFields, mode: v.literal('clicker'), data: clickerDataSchema }),
  v.strictObject({ ...snapshotFields, mode: v.literal('cycles'), data: cyclesDataSchema }),
  v.strictObject({ ...snapshotFields, mode: v.literal('race'), data: raceDataSchema }),
]);

const eventSchema = v.variant('type', [
  v.strictObject({ type: v.literal('died'), slot: v.number(), by: v.nullable(v.number()) }),
  v.strictObject({ type: v.literal('respawned'), slot: v.number() }),
  v.strictObject({ type: v.literal('boost'), slot: v.number() }),
]);

/** Everything about the round right now. Sent on joining, on rejoining and on request. */
export const cyclesFullSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('full'),
  mode: v.literal('cycles'),
  tick: v.number(),
  /** Milliseconds between ticks: the client needs it to place a tick in time. */
  tickMs: v.number(),
  side: v.number(),
  bikes: v.array(
    v.strictObject({
      slot: v.number(),
      id: v.string(),
      alive: v.boolean(),
      dir: v.number(),
      /** Oldest first; the head is the last cell. Empty for a dead bike. */
      trail: v.array(v.number()),
      kills: v.number(),
      deaths: v.number(),
      rubber: v.number(),
      boost: v.number(),
      cooldown: v.number(),
      energy: v.number(),
      cap: v.number(),
      lit: v.boolean(),
      respawnIn: v.number(),
    }),
  ),
});

export const raceFullSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('full'),
  mode: v.literal('race'),
  tick: v.number(),
  tickMs: v.number(),
  track: v.string(),
  /** Laps to complete. */
  laps: v.number(),
  /**
   * Every car on the field, in the order of the race; one that joined mid-race waits off it and
   * is not listed.
   */
  cars: v.array(
    v.strictObject({
      slot: v.number(),
      id: v.string(),
      bot: v.boolean(),
      x: v.number(),
      y: v.number(),
      heading: v.number(),
      speed: v.number(),
      lap: v.number(),
      /** The tick the car finished on, or null. */
      finish: v.nullable(v.number()),
      /** The best lap in ticks, or null: lap times survive a resync. */
      best: v.nullable(v.number()),
      /** The tick the current lap began on, or -1 if it was cut short and has no time. */
      lapStart: v.number(),
    }),
  ),
});

export const fullSchema = v.variant('mode', [cyclesFullSchema, raceFullSchema]);

/** One tick, the same string for everyone. */
export const cyclesDeltaSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('delta'),
  mode: v.literal('cycles'),
  t: v.number(),
  /** Flat pairs: cell, what it holds after the tick (0 = empty). Apply in any order. */
  cells: v.array(v.number()),
  /** Flat 8-tuples for every living bike: slot, head cell, direction, rubber left, boost cooldown left, energy, energy capacity, lit (1 or 0). */
  heads: v.array(v.number()),
  events: v.array(eventSchema),
});

const raceEventSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('lap'),
    slot: v.number(),
    lap: v.number(),
    /** The lap just finished, in ticks; null for the crossing that only starts lap 1 or after a lap cut short. */
    time: v.nullable(v.number()),
  }),
  v.strictObject({ type: v.literal('finished'), slot: v.number() }),
  v.strictObject({ type: v.literal('bump'), slot: v.number() }),
]);

export const raceDeltaSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('delta'),
  mode: v.literal('race'),
  t: v.number(),
  /**
   * Flat 7-tuples for every car on the field, in the order of the race: slot, x, y, heading, speed, lap, flags (bit 0
   * finished, bit 1 on grass, bit 2 touching a wall, bit 3 touching another car). All integers.
   */
  cars: v.array(v.pipe(v.number(), v.integer())),
  events: v.array(raceEventSchema),
});

export const deltaSchema = v.variant('mode', [cyclesDeltaSchema, raceDeltaSchema]);

/** Sent to one connection only: a role, a word, a hand of cards. */
export const privateSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('private'),
  data: v.unknown(),
});

export const errorSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('error'),
  code: errorCodeSchema,
});

/** What the server says to a tab of another version, read whatever version the frame carries. */
const staleTabSchema = v.strictObject({
  v: v.number(),
  type: v.literal('error'),
  code: v.literal('bad_version'),
});

export const serverMessageSchema = v.variant('type', [
  welcomeSchema,
  snapshotSchema,
  privateSchema,
  errorSchema,
  fullSchema,
  deltaSchema,
]);

export type ServerMessage = v.InferOutput<typeof serverMessageSchema>;
export type SnapshotMessage = v.InferOutput<typeof snapshotSchema>;
export type FullMessage = v.InferOutput<typeof fullSchema>;
export type CyclesFullMessage = v.InferOutput<typeof cyclesFullSchema>;
export type RaceFullMessage = v.InferOutput<typeof raceFullSchema>;
export type DeltaMessage = v.InferOutput<typeof deltaSchema>;
export type CyclesDeltaMessage = v.InferOutput<typeof cyclesDeltaSchema>;
export type RaceDeltaMessage = v.InferOutput<typeof raceDeltaSchema>;
export type PrivateMessage = v.InferOutput<typeof privateSchema>;
export type ServerErrorCode = v.InferOutput<typeof errorCodeSchema>;

export function parseServerMessage(raw: string): ServerMessage | null {
  if (raw.length > MAX_SERVER_MESSAGE_BYTES) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = v.safeParse(serverMessageSchema, data);
  if (result.success) return result.output;
  // The one frame a tab of any version must understand: it is how an out-of-date tab learns to
  // reload instead of sitting blank. The frame is handed on as this build's own.
  const stale = v.safeParse(staleTabSchema, data);
  return stale.success ? { v: PROTOCOL_VERSION, type: 'error', code: 'bad_version' } : null;
}

function cyclesDataOf(
  state: CyclesState,
  settings: CyclesSettings,
): v.InferOutput<typeof cyclesDataSchema> {
  const { results } = state;
  return {
    speed: settings.speed,
    walls: settings.walls,
    results:
      results === null
        ? null
        : results.map((row) => ({
            id: row.publicId,
            name: row.name,
            kills: row.kills,
            deaths: row.deaths,
            longest: row.longest,
            rank: row.rank,
          })),
  };
}

function raceDataOf(state: RoomState): v.InferOutput<typeof raceDataSchema> {
  const { results } = state.modeState as RaceState;
  const tickMs = raceTickMs();
  if (results === null) return { tickMs, results: null };
  return {
    tickMs,
    results: results.map((row) => ({
      id: row.publicId,
      // Fixed into the row at the finish. Rows stored by an earlier build have no name.
      name: row.name ?? '',
      slot: row.slot,
      rank: row.rank,
      laps: row.laps,
      best: row.best,
      finish: row.finish,
      short: row.short,
    })),
  };
}

function raceTickMs(): number {
  const tickMs = configFor('race').tickMs;
  if (tickMs === null) throw new Error('the race has a tick of its own');
  return tickMs;
}

/** The secret playerId and hostKey never get in here. */
export function toSnapshot(state: RoomState, now: number): SnapshotMessage {
  const players = Object.values(state.players).map((player) => ({
    id: player.publicId,
    name: player.name,
    connected: player.connectionIds.length > 0,
    bot: player.bot,
  }));
  // What the mode adds to the snapshot is its `data`; the room's own fields are the same for all.
  const common = {
    v: PROTOCOL_VERSION,
    type: 'snapshot',
    serverNow: now,
    phase: state.phase,
    players: players.sort((a, b) => comparePublicIds(a.id, b.id)),
    round: state.round === null ? null : { goAt: state.round.goAt, endsAt: state.round.endsAt },
    notice: state.notice,
  } as const;
  // A switch with a `never` default: a mode added to `ModeTypes` is a compile error here until
  // it has its case, instead of quietly falling into the last branch.
  switch (state.mode) {
    case 'clicker':
      return { ...common, mode: 'clicker', data: toModeData(state.modeState as ClickerState) };
    case 'cycles':
      return {
        ...common,
        mode: 'cycles',
        data: cyclesDataOf(state.modeState as CyclesState, state.settings),
      };
    case 'race':
      return { ...common, mode: 'race', data: raceDataOf(state) };
    default:
      return state.mode satisfies never;
  }
}

/** `null` for a mode with no field, or a room before its first round. */
export function toFull(state: RoomState): FullMessage | null {
  switch (state.mode) {
    case 'clicker':
      return null;
    case 'cycles':
      return cyclesFullOf(state);
    case 'race':
      return raceFullOf(state);
    default:
      return state.mode satisfies never;
  }
}

function cyclesFullOf(state: RoomState): CyclesFullMessage | null {
  const cycles = state.modeState as CyclesState;
  if (cycles.side === 0) return null;
  return {
    v: PROTOCOL_VERSION,
    type: 'full',
    mode: 'cycles',
    tick: cycles.tick,
    tickMs: tickMsFor(state.settings.speed),
    side: cycles.side,
    bikes: cycles.bikes.map((bike) => {
      const trail: number[] = [];
      forEachCell(bike.trail, (cell) => trail.push(cell));
      return {
        slot: bike.slot,
        id: bike.publicId,
        alive: bike.alive,
        dir: bike.dir,
        trail,
        kills: bike.kills,
        deaths: bike.deaths,
        rubber: bike.rubber,
        boost: bike.boost,
        cooldown: bike.cooldown,
        energy: bike.energy,
        cap: bike.energyCap,
        lit: bike.lit,
        respawnIn: bike.respawnIn,
      };
    }),
  };
}

/** Null in a lobby: nobody stands on the grid until `startRound` places them. */
function raceFullOf(state: RoomState): RaceFullMessage | null {
  if (state.phase === 'lobby') return null;
  const race = state.modeState as RaceState;
  return {
    v: PROTOCOL_VERSION,
    type: 'full',
    mode: 'race',
    tick: race.tick,
    tickMs: raceTickMs(),
    track: race.track,
    laps: RACE.laps,
    cars: carsInOrder(race).map((car) => ({
      slot: car.slot,
      id: car.publicId,
      bot: car.bot && !car.abandoned,
      x: car.x,
      y: car.y,
      heading: car.heading,
      speed: car.speed,
      lap: car.lap,
      finish: car.finish,
      best: car.best,
      lapStart: car.lapStart,
    })),
  };
}

/**
 * Takes the room's state as well as the event: the light cycles' tick reports everything that
 * changed, but a car moves every tick, so the race's delta is the cars as they stand, and only
 * its events come from the tick. Called after the state has been replaced by the stepped one.
 */
export function toDelta(
  state: RoomState,
  stepped: Extract<GameEvent, { type: 'stepped' }>,
): DeltaMessage {
  switch (stepped.mode) {
    case 'cycles': {
      const { changes } = stepped;
      return {
        v: PROTOCOL_VERSION,
        type: 'delta',
        mode: 'cycles',
        t: stepped.tick,
        cells: changes.cells,
        heads: changes.heads,
        events: changes.events,
      };
    }
    case 'race':
      return raceDeltaOf(state, stepped.tick, stepped.changes);
    default:
      return stepped satisfies never;
  }
}

function raceDeltaOf(state: RoomState, tick: number, changes: RaceChanges): RaceDeltaMessage {
  const race = state.modeState as RaceState;
  const cars: number[] = [];
  // In the order of the race, which costs no bytes: the client reads the standings off the order.
  for (const car of carsInOrder(race)) {
    cars.push(car.slot, car.x, car.y, car.heading, car.speed, car.lap, carFlags(race, car));
  }
  return {
    v: PROTOCOL_VERSION,
    type: 'delta',
    mode: 'race',
    t: tick,
    cars,
    events: [
      ...changes.laps.map((lap) => ({
        type: 'lap' as const,
        slot: lap.slot,
        lap: lap.lap,
        time: lap.time,
      })),
      ...changes.finished.map((slot) => ({ type: 'finished' as const, slot })),
      ...changes.bumped.map((slot) => ({ type: 'bump' as const, slot })),
    ],
  };
}
