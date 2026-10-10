import {
  type ClickerState,
  type CyclesState,
  comparePublicIds,
  forEachCell,
  type RoomState,
  type TickChanges,
  toModeData,
} from '@clicker/game';
import * as v from 'valibot';
import { PROTOCOL_VERSION } from './client';

/** A full round is far bigger than a snapshot: twenty trails of up to 400 cells. */
export const MAX_SERVER_MESSAGE_BYTES = 128 * 1024;

const versionSchema = v.literal(PROTOCOL_VERSION);
const phaseSchema = v.picklist(['lobby', 'countdown', 'running', 'results']);
const modeSchema = v.picklist(['clicker', 'cycles']);

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

export const snapshotSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('snapshot'),
  serverNow: v.number(),
  mode: modeSchema,
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
  data: v.union([clickerDataSchema, cyclesDataSchema]),
});

const eventSchema = v.variant('type', [
  v.strictObject({ type: v.literal('died'), slot: v.number(), by: v.nullable(v.number()) }),
  v.strictObject({ type: v.literal('respawned'), slot: v.number() }),
  v.strictObject({ type: v.literal('boost'), slot: v.number() }),
]);

/** Everything about the round right now. Sent on joining, on rejoining and on request. */
export const fullSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('full'),
  tick: v.number(),
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
      respawnIn: v.number(),
    }),
  ),
});

/** One tick, the same string for everyone. */
export const deltaSchema = v.strictObject({
  v: versionSchema,
  type: v.literal('delta'),
  t: v.number(),
  /** Flat pairs: cell, what it holds after the tick (0 = empty). Apply in any order. */
  cells: v.array(v.number()),
  /** Flat triples for every living bike: slot, head cell, direction. */
  heads: v.array(v.number()),
  events: v.array(eventSchema),
});

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
export type DeltaMessage = v.InferOutput<typeof deltaSchema>;
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
  return result.success ? result.output : null;
}

/** What the mode adds to the snapshot. The room's own fields are the same for every mode. */
function dataOf(state: RoomState): SnapshotMessage['data'] {
  if (state.mode === 'clicker') return toModeData(state.modeState as ClickerState);
  const { results } = state.modeState as CyclesState;
  return {
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

/** The secret playerId and hostKey never get in here. */
export function toSnapshot(state: RoomState, now: number): SnapshotMessage {
  const players = Object.values(state.players).map((player) => ({
    id: player.publicId,
    name: player.name,
    connected: player.connectionIds.length > 0,
    bot: player.bot,
  }));
  return {
    v: PROTOCOL_VERSION,
    type: 'snapshot',
    serverNow: now,
    mode: state.mode,
    phase: state.phase,
    players: players.sort((a, b) => comparePublicIds(a.id, b.id)),
    round: state.round === null ? null : { goAt: state.round.goAt, endsAt: state.round.endsAt },
    notice: state.notice,
    data: dataOf(state),
  };
}

/** `null` for a mode with no field, or a light-cycle room before its first round. */
export function toFull(state: RoomState): FullMessage | null {
  if (state.mode !== 'cycles') return null;
  const cycles = state.modeState as CyclesState;
  if (cycles.side === 0) return null;
  return {
    v: PROTOCOL_VERSION,
    type: 'full',
    tick: cycles.tick,
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
        respawnIn: bike.respawnIn,
      };
    }),
  };
}

export function toDelta(tick: number, changes: TickChanges): DeltaMessage {
  return {
    v: PROTOCOL_VERSION,
    type: 'delta',
    t: tick,
    cells: changes.cells,
    heads: changes.heads,
    events: changes.events,
  };
}
